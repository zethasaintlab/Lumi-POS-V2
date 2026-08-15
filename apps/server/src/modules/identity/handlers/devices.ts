import type { Pool, PoolClient } from '../../../db.ts';
import { withTenantTransaction } from '../../../db.ts';
import { HttpError } from '../../../http-error.ts';
import { getTenantId, getActorId } from '../../../tenant-context.ts';
import { assertOutletVisible, assertKuota } from '../../tenancy/index.ts';
import { hitungPerangkat, assertUserVisible, assertBoleh } from '../index.ts';
import { isPrimaryKeyViolation } from './pg-error.ts';
import type { FastifyRequest, FastifyReply } from 'fastify';

// T0b (PLAN-ordering-fondasi.md §T0b) -- POST /devices, menutup FR-B6
// penuh: constraint unik ux_device_outlet_code sudah ada sejak F0
// (db/migrations/0003_identity.sql:61), tugas modul ini murni jalur
// aplikasinya.

interface DeviceRow {
  id: string;
  outlet_id: string;
  code: string;
  name: string | null;
  platform: string | null;
  app_version: string | null;
  revoked_at: string | null;
}

interface DeviceInput {
  id: string;
  outletId: string;
  code: string;
  name?: string | null;
  platform?: string | null;
  appVersion?: string | null;
}

function toDevice(row: DeviceRow) {
  return {
    id: row.id,
    outletId: row.outlet_id,
    code: row.code,
    name: row.name,
    platform: row.platform,
    appVersion: row.app_version,
    revokedAt: row.revoked_at,
  };
}

// FR-B6 AC (spec-b-kasir-order.md:214): "Pesan penolakan menyebut device
// yang sudah memakai kode tersebut". Datanya WAJIB dari SELECT yang tunduk
// RLS di transaksi pemanggil (`client`, bukan `pool` mentah) -- BUKAN dari
// detail error PostgreSQL constraint violation, seperti eksplisit diminta
// di brief. Dipanggil dua kali: sekali sebagai fallback setelah race di
// insertDevice menabrak ux_device_outlet_code.
async function fetchActiveDeviceByCode(client: PoolClient, outletId: string, code: string): Promise<DeviceRow | null> {
  const { rows } = await client.query<DeviceRow>(
    'SELECT * FROM device WHERE outlet_id = $1 AND code = $2 AND revoked_at IS NULL',
    [outletId, code]
  );
  return rows[0] ?? null;
}

function throwCodeTaken(code: string, existing: DeviceRow | null): never {
  if (existing) {
    throw new HttpError(
      409,
      'CODE_TAKEN',
      `Kode ${code} sudah dipakai device ${existing.name ?? existing.id} (id: ${existing.id}) di outlet ini.`
    );
  }
  // Defensive only: constraint violation terjadi tapi SELECT ulang tidak
  // menemukan baris aktif mana pun -- seharusnya tidak tercapai (kalau
  // constraint menabrak, HARUS ada baris aktif dengan kode ini), tapi
  // pesan tetap harus actionable, bukan melempar error kosong.
  throw new HttpError(409, 'CODE_TAKEN', `Kode ${code} sudah dipakai device lain di outlet ini.`);
}

async function fetchDeviceOrThrow(client: PoolClient, deviceId: string): Promise<DeviceRow> {
  const { rows } = await client.query<DeviceRow>('SELECT * FROM device WHERE id = $1', [deviceId]);
  if (rows.length === 0) {
    throw new HttpError(404, 'NOT_FOUND', `Device ${deviceId} tidak ditemukan.`);
  }
  return rows[0];
}

// Try-INSERT-dulu (bukan pre-check SELECT lalu INSERT) SENGAJA: kalau
// pre-check "kode sudah dipakai?" jalan lebih dulu, retry offline dengan id
// yang SAMA PERSIS (device sendiri, request kedua setelah respons pertama
// hilang) akan menabrak pre-check itu duluan (kode miliknya sendiri
// terlihat "sudah dipakai") dan salah dilaporkan sebagai CODE_TAKEN,
// padahal seharusnya ID_ALREADY_EXISTS -- pelajaran yang sama dengan
// modules/cash/handlers/shifts.ts (lihat komentar di sana). Postgres
// mengecek index PK (dibuat inline di CREATE TABLE, oid lebih kecil)
// sebelum ux_device_outlet_code (CREATE UNIQUE INDEX belakangan, oid lebih
// besar) untuk INSERT yang menabrak keduanya sekaligus -- jadi retry id
// sama selalu jatuh ke cabang isPrimaryKeyViolation di bawah, bukan
// cabang CODE_TAKEN.
async function insertDevice(client: PoolClient, tenantId: string, input: DeviceInput): Promise<DeviceRow> {
  // SAVEPOINT wajib di sini: setelah INSERT gagal dengan error apa pun,
  // koneksi jatuh ke status transaksi "aborted" -- query LANJUTAN pada
  // client yang sama (fetchActiveDeviceByCode di bawah, untuk membangun
  // pesan CODE_TAKEN dari SELECT bukan dari detail error PG) akan ditolak
  // dengan 25P02 sampai status dipulihkan. ROLLBACK TO SAVEPOINT memulihkan
  // status TANPA membatalkan seluruh transaksi -- withTenantTransaction
  // membungkus createDevice dalam satu BEGIN/COMMIT, dan assertOutletVisible
  // yang sudah lolos sebelum INSERT ini tidak boleh ikut batal.
  await client.query('SAVEPOINT insert_device');
  try {
    const { rows } = await client.query<DeviceRow>(
      `INSERT INTO device (id, tenant_id, outlet_id, code, name, platform, app_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        input.id,
        tenantId,
        input.outletId,
        input.code,
        input.name ?? null,
        input.platform ?? null,
        input.appVersion ?? null,
      ]
    );
    return rows[0];
  } catch (err) {
    if (isPrimaryKeyViolation(err)) {
      throw new HttpError(409, 'ID_ALREADY_EXISTS', `Device dengan id ${input.id} sudah ada.`);
    }
    const pgErr = err as { code?: string; constraint?: string };
    if (pgErr.code === '23505' && pgErr.constraint === 'ux_device_outlet_code') {
      await client.query('ROLLBACK TO SAVEPOINT insert_device');
      const existing = await fetchActiveDeviceByCode(client, input.outletId, input.code);
      throwCodeTaken(input.code, existing);
    }
    throw err;
  }
}

export function createDeviceHandlers(pool: Pool) {
  return {
    async createDevice(req: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(req);
      const body = req.body as DeviceInput;
      const row = await withTenantTransaction(pool, tenantId, async (client) => {
        // Guard ini BUKAN formalitas -- FK outlet_id REFERENCES outlet(id)
        // TIDAK tunduk RLS (temuan F1, CLAUDE.md, dibuktikan sabotase 3x
        // berturut-turut di repo ini termasuk untuk price_history.outlet_id).
        await assertOutletVisible(client, body.outletId);

        // Titik penegakan `max_devices` (`research/09` § 6). `hitungPerangkat`
        // adalah fungsi yang SAMA yang dipakai `GET /tenants/usage` — angka
        // yang ditampilkan B-29 dan angka yang ditegakkan di sini tidak dapat
        // menyimpang.
        await assertKuota(client, tenantId, 'device', await hitungPerangkat(client), 1);

        return insertDevice(client, tenantId, body);
      });
      reply.code(201);
      return toDevice(row);
    },

    /**
     * Daftar perangkat untuk layar B-28.
     *
     * ⛔ `token_hash` TIDAK ikut. Ia SHA-256 dari secret perangkat, dan layar
     * hanya perlu tahu APAKAH kredensial sudah diterbitkan — bukan nilainya.
     * Mengirimkannya berarti menaruh bahan kredensial di tempat yang tidak
     * membutuhkannya, dan setiap tempat semacam itu adalah tempat ia dapat
     * bocor.
     *
     * ⛔ Perangkat yang DICABUT tetap ikut. Perangkat tidak pernah di-`DELETE`
     * — `order.device_id` menunjuknya, dan riwayat penjualan harus tetap dapat
     * menyebut perangkat mana yang membuatnya. Menyembunyikannya membuat
     * merchant mengira ia hilang, lalu membuat ulang dengan kode yang sama.
     *
     * Urutannya deterministik di SQL: aktif dulu, lalu kode. Daftar yang
     * urutannya berubah tiap muat ulang tidak dapat dibaca — dan urutan yang
     * tidak dijamin SQL adalah urutan yang tidak dapat diuji fake mana pun
     * (`CLAUDE.md`, pelajaran F3).
     */
    async listDevices(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);

      return withTenantTransaction(pool, tenantId, async (client) => {
        await assertUserVisible(client, actorId);
        // `spec-f:52` menaruh pengelolaan perangkat di luar jangkauan Kasir
        // dan Akuntan. Dipakai ulang dari matriks, bukan perbandingan nama
        // peran di sini.
        await assertBoleh(client, actorId, 'device_revoke', 'mengelola perangkat');

        const { rows } = await client.query<
          DeviceRow & {
            last_seen_at: string | null;
            ada_kredensial: boolean;
            credentials_expire_at: string | null;
          }
        >(
          `SELECT id, outlet_id, code, name, platform, app_version, revoked_at,
                  last_seen_at, credentials_expire_at,
                  (token_hash IS NOT NULL) AS ada_kredensial
             FROM device
            ORDER BY (revoked_at IS NOT NULL), code`
        );

        return rows.map((r) => ({
          ...toDevice(r),
          lastSeenAt: r.last_seen_at,
          adaKredensial: r.ada_kredensial,
          credentialsExpireAt: r.credentials_expire_at,
        }));
      });
    },

    async revokeDevice(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const { deviceId } = req.params as { deviceId: string };
      const row = await withTenantTransaction(pool, tenantId, async (client) => {
        // fetchDeviceOrThrow berjalan lewat client yang app.tenant_id-nya
        // sudah di-SET LOCAL (withTenantTransaction) -- RLS menyembunyikan
        // device tenant lain sepenuhnya, jadi deviceId lintas tenant SELALU
        // jatuh ke 404 di sini, sama seperti fetchItemOrThrow di catalog.
        await fetchDeviceOrThrow(client, deviceId);
        const { rows } = await client.query<DeviceRow>(
          'UPDATE device SET revoked_at = now() WHERE id = $1 RETURNING *',
          [deviceId]
        );
        return rows[0];
      });
      return toDevice(row);
    },
  };
}
