import { randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from '../../../db.ts';
import { withTenantTransaction } from '../../../db.ts';
import { HttpError } from '../../../http-error.ts';
import { getActorId, getTenantId } from '../../../tenant-context.ts';
import type { Hlc } from '../../../../../../packages/domain/src/hlc.ts';
import { recordAuditEvent } from '../../audit/index.ts';
import { assertOutletVisible, assertKuota } from '../../tenancy/index.ts';
import { hitungPengguna, assertUserVisible } from '../index.ts';
import {
  detectWeakPin,
  isValidPinShape,
  type PinHasher,
} from '../../../../../../packages/domain/src/pin.ts';
import {
  bolehKelolaPengguna,
  peranMelebihiCakupan,
  LABEL_PERAN,
  type Peran,
} from '../../../../../../packages/domain/src/rbac.ts';
import { isPrimaryKeyViolation } from './pg-error.ts';

// §4 PLAN-modul-f-identitas.md -- REST identitas (FR-F2, FR-F4, FR-F6).

/** `spec-f:218`: 5 percobaan gagal berturut-turut mengunci input PIN. */
const BATAS_GAGAL = 5;
/** `spec-f:219` dan `spec-f:229`. */
const KUNCI_DETIK = 60;
const KUNCI_ESKALASI_DETIK = 900;
const ESKALASI_SETELAH_PENGUNCIAN = 3;

interface PeranInput {
  role: string;
  scopeType: string;
  scopeId: string;
}

interface BarisUser {
  id: string;
  name: string;
  email: string | null;
  is_active: boolean;
  pin_must_change: boolean;
  pin_hash: string | null;
}

async function ambilUser(client: PoolClient, userId: string): Promise<BarisUser> {
  const { rows } = await client.query<BarisUser>(
    'SELECT id, name, email, is_active, pin_must_change, pin_hash FROM "user" WHERE id = $1',
    [userId]
  );
  if (rows.length === 0) {
    throw new HttpError(404, 'USER_NOT_FOUND', `Pengguna ${userId} tidak ditemukan.`);
  }
  return rows[0];
}

async function bentukUser(client: PoolClient, baris: BarisUser) {
  // ⛔ BERURUTAN, dan itu bukan pilihan gaya. Versi sebelumnya memakai
  // `Promise.all` atas SATU `PoolClient`, dan itu tidak memparalelkan apa pun:
  // `node-postgres` mengantrekan query pada koneksi yang sama, jadi
  // wall-clock-nya identik dengan berurutan — sambil memancing
  // `DeprecationWarning: Calling client.query() when the client is already
  // executing a query`, perilaku yang **dihapus di pg@9**.
  //
  // Memparalelkannya dengan sungguh-sungguh menuntut koneksi kedua, dan itu
  // berarti transaksi kedua: `SET LOCAL app.tenant_id` berlaku per transaksi
  // (invariant #8), jadi keduanya harus menyetelnya sendiri-sendiri dan
  // pengguna berhenti dibaca dari satu potret pada satu titik waktu.
  const peran = await client.query<{ role: string; scope_type: string; scope_id: string }>(
    'SELECT role, scope_type, scope_id FROM user_role WHERE user_id = $1 ORDER BY role',
    [baris.id]
  );
  const outlet = await client.query<{ outlet_id: string }>(
    'SELECT outlet_id FROM user_outlet WHERE user_id = $1 ORDER BY outlet_id',
    [baris.id]
  );
  return {
    id: baris.id,
    name: baris.name,
    email: baris.email,
    isActive: baris.is_active,
    pinMustChange: baris.pin_must_change,
    // Hash-nya sendiri TIDAK pernah keluar lewat endpoint ini. Ia hanya turun
    // lewat replikasi ke perangkat outlet tempat pengguna terdaftar
    // (spec-f:124) -- permukaan admin tidak punya alasan membacanya.
    hasPin: baris.pin_hash !== null,
    roles: peran.rows.map((r) => ({ role: r.role, scopeType: r.scope_type, scopeId: r.scope_id })),
    outletIds: outlet.rows.map((r) => r.outlet_id),
  };
}

/** Peran aktor, untuk `bolehKelolaPengguna`. */
async function peranAktor(client: PoolClient, actorId: string): Promise<string[]> {
  const { rows } = await client.query<{ role: string }>(
    'SELECT role FROM user_role WHERE user_id = $1',
    [actorId]
  );
  return rows.map((r) => r.role);
}

/**
 * Menegakkan sel bersyarat `spec-f:50` — Manajer Outlet mengelola kasir saja.
 *
 * Batasnya nyata: manajer outlet yang dapat membuat manajer outlet lain dapat
 * memberi dirinya rekan yang menyetujui refund-nya sendiri, dan pemisahan
 * tugas `spec-f:91` runtuh tanpa satu pun aturan terlihat dilanggar.
 */
async function assertBolehKelola(
  client: PoolClient,
  actorId: string,
  peranTarget: readonly string[]
): Promise<void> {
  const peran = await peranAktor(client, actorId);
  for (const target of peranTarget) {
    if (!bolehKelolaPengguna(peran, target)) {
      throw new HttpError(
        403,
        'FORBIDDEN_ROLE_MANAGEMENT',
        `Anda tidak berhak mengelola pengguna berperan ${target}.`
      );
    }
  }
}

/**
 * ⛔ Keunikan PIN per outlet, ditegakkan APLIKASI.
 *
 * `ERD:143` menulis `UNIQUE(outlet_id, pin_hash)`. Constraint itu MUSTAHIL:
 * Argon2id memakai salt per pengguna, jadi dua PIN identik menghasilkan hash
 * berbeda dan index unik akan hijau selamanya sambil membiarkan tepat keadaan
 * yang `spec-f:126` larang. Alasan lengkapnya di migrasi 0019.
 *
 * Jalan satu-satunya adalah VERIFIKASI: PIN baru diuji terhadap hash setiap
 * rekan seoutlet. Biayanya n x 23 ms dengan n = staf outlet (< 20), pada
 * operasi yang jarang.
 *
 * Pesan penolakan TIDAK menyebut siapa pemakainya. Menyebutnya berarti
 * memberi tahu pemanggil PIN siapa yang baru saja ia tebak — dan permukaan
 * ini dipakai manajer outlet, bukan hanya owner.
 */
async function assertPinBelumDipakaiDiOutlet(
  client: PoolClient,
  hasher: PinHasher,
  userId: string,
  pin: string
): Promise<void> {
  const { rows } = await client.query<{ pin_hash: string }>(
    `SELECT DISTINCT u.pin_hash
       FROM "user" u
       JOIN user_outlet uo ON uo.user_id = u.id
      WHERE u.id <> $1
        AND u.pin_hash IS NOT NULL
        AND u.is_active = true
        AND uo.outlet_id IN (SELECT outlet_id FROM user_outlet WHERE user_id = $1)`,
    [userId]
  );

  for (const baris of rows) {
    if (await hasher.verifikasi(pin, baris.pin_hash)) {
      throw new HttpError(
        409,
        'PIN_TAKEN',
        'PIN ini sudah dipakai pengguna lain di outlet yang sama. Pilih PIN lain.'
      );
    }
  }
}

export function createUserHandlers(pool: Pool, hasher: PinHasher, hlc: Hlc): Record<string, unknown> {
  return {
    /**
     * Daftar pengguna untuk layar B-27.
     *
     * ⛔ `pin_hash` dan `password_hash` TIDAK ikut — hanya `hasPin`.
     * Layar perlu tahu APAKAH PIN sudah disetel (tanpa itu pengguna tidak
     * dapat membuka aplikasi kasir sama sekali), bukan nilainya. Setiap
     * tempat yang memegang bahan kredensial tanpa membutuhkannya adalah
     * tempat ia dapat bocor.
     *
     * ⛔ Pengguna yang DINONAKTIFKAN tetap ikut. Baris `"user"` tidak pernah
     * dihapus — `audit_event.actor_user_id` menunjuknya, dan menghapusnya
     * memutus atribusi setiap peristiwa yang pernah ia lakukan.
     *
     * Urutan dijamin SQL: aktif dulu, lalu nama.
     */
    async listUsers(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);

      return withTenantTransaction(pool, tenantId, async (client) => {
        await assertUserVisible(client, actorId);
        // Yang berhak MELIHAT daftar pengguna adalah yang berhak
        // mengelolanya. `assertBolehKelola` menuntut daftar peran target;
        // untuk pembacaan, yang relevan hanya bahwa aktor mengelola SESEORANG
        // — dipakai peran terlemah yang tetap masuk akal, yaitu kasir.
        await assertBolehKelola(client, actorId, ['cashier']);

        const { rows } = await client.query<{
          id: string;
          name: string;
          email: string | null;
          is_active: boolean;
          has_pin: boolean;
          roles: string[] | null;
          outlet_ids: string[] | null;
        }>(
          `SELECT u.id, u.name, u.email, u.is_active,
                  (u.pin_hash IS NOT NULL) AS has_pin,
                  array_agg(DISTINCT ur.role) FILTER (WHERE ur.role IS NOT NULL) AS roles,
                  array_agg(DISTINCT uo.outlet_id) FILTER (WHERE uo.outlet_id IS NOT NULL) AS outlet_ids
             FROM "user" u
             LEFT JOIN user_role ur ON ur.user_id = u.id
             LEFT JOIN user_outlet uo ON uo.user_id = u.id
            GROUP BY u.id, u.name, u.email, u.is_active, u.pin_hash
            ORDER BY (u.is_active = false), u.name`
        );

        return rows.map((r) => ({
          id: r.id,
          name: r.name,
          email: r.email,
          isActive: r.is_active,
          hasPin: r.has_pin,
          roles: r.roles ?? [],
          outletIds: r.outlet_ids ?? [],
        }));
      });
    },

    async createUser(req: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const body = req.body as {
        id: string;
        name: string;
        email?: string | null;
        birthDate?: string | null;
        roles: PeranInput[];
        outletIds: string[];
      };

      // ⛔ Outlet UNIK, dan dihitung SEKALI di sini.
      //
      // Penulisan di bawah juga mem-`Set`-kannya. Kalau penjaga cakupan
      // menghitung panjang array mentah sementara penulisan menghitung yang
      // unik, `['o1','o1']` ditolak sebagai "dua outlet" — permintaan sah yang
      // gagal karena klien mengirim id yang sama dua kali.
      const outletUnik = [...new Set(body.outletIds ?? [])];

      // ⛔ DI LUAR transaksi, sebelum satu query pun jalan.
      //
      // `spec-f:31` dan `spec-f:32` memberi Manajer Outlet dan Kasir cakupan
      // "Satu outlet". Layar B-27 sudah menolaknya, dan itu TIDAK CUKUP:
      // penjaga yang hanya hidup di klien hilang begitu ada yang memanggil API
      // langsung — dan permukaan ini dipakai Manajer Outlet, bukan hanya
      // owner.
      //
      // Akibat kalau lolos: kasir muncul di layar login DUA tablet dan
      // penjualannya dapat dinisbatkan ke outlet yang tidak pernah ia
      // tempati; manajer outlet menyetujui refund di outlet yang bukan
      // tanggung jawabnya. Keduanya tidak menghasilkan error di mana pun.
      const terlaluLuas = peranMelebihiCakupan(
        body.roles.map((r) => r.role),
        outletUnik.length
      );
      if (terlaluLuas) {
        throw new HttpError(
          400,
          'ROLE_SCOPE_TOO_WIDE',
          `Peran ${LABEL_PERAN[terlaluLuas as Peran] ?? terlaluLuas} bercakupan satu outlet. ` +
            'Pilih satu outlet, atau pakai peran Manajer Area untuk beberapa outlet.'
        );
      }

      const hasil = await withTenantTransaction(pool, tenantId, async (client) => {
        await assertBolehKelola(client, actorId, body.roles.map((r) => r.role));

        // Titik penegakan `max_users` (`research/09` § 6). `hitungPengguna`
        // adalah fungsi yang SAMA yang dipakai `GET /tenants/usage`.
        await assertKuota(client, tenantId, 'pengguna', await hitungPengguna(client), 1);

        // FK klien-suplai ke tabel ber-tenant_id. Temuan F1 (CLAUDE.md),
        // bentuk keenam: FK PostgreSQL tidak tunduk RLS, jadi ia hanya
        // membuktikan outlet itu ada di SUATU tenant.
        for (const outletId of outletUnik) {
          await assertOutletVisible(client, outletId);
        }

        try {
          await client.query(
            `INSERT INTO "user" (id, tenant_id, name, email, birth_date)
             VALUES ($1, $2, $3, $4, $5)`,
            [body.id, tenantId, body.name, body.email ?? null, body.birthDate ?? null]
          );
        } catch (err) {
          if (isPrimaryKeyViolation(err)) {
            throw new HttpError(409, 'ID_ALREADY_EXISTS', `Pengguna ${body.id} sudah ada.`);
          }
          throw err;
        }

        for (const peran of body.roles) {
          await client.query(
            `INSERT INTO user_role (id, tenant_id, user_id, role, scope_type, scope_id)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [randomUUID(), tenantId, body.id, peran.role, peran.scopeType, peran.scopeId]
          );
        }

        for (const outletId of outletUnik) {
          await client.query(
            `INSERT INTO user_outlet (id, tenant_id, user_id, outlet_id) VALUES ($1, $2, $3, $4)`,
            [randomUUID(), tenantId, body.id, outletId]
          );
        }

        await recordAuditEvent(client, {
          id: randomUUID(),
          tenantId,
          outletId: body.outletIds[0] ?? null,
          actorUserId: actorId,
          approverUserId: null,
          eventType: 'user_created',
          entityType: 'user',
          entityId: body.id,
          reasonCode: null,
          reasonNote: null,
          after: { name: body.name, roles: body.roles, outletIds: body.outletIds },
          hlc: hlc.tick(),
        });

        return bentukUser(client, await ambilUser(client, body.id));
      });

      reply.code(201);
      return hasil;
    },

    async updateUser(req: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const { userId } = req.params as { userId: string };
      const body = req.body as { name?: string; email?: string | null; isActive?: boolean };

      const hasil = await withTenantTransaction(pool, tenantId, async (client) => {
        const sebelum = await ambilUser(client, userId);

        if (body.isActive === false) {
          // `spec-f:425`: "Owner menghapus dirinya sendiri -> Ditolak, minimal
          // satu owner harus ada." Diperiksa untuk SIAPA PUN yang berperan
          // owner, bukan hanya untuk aktor yang menonaktifkan dirinya sendiri
          // -- owner yang dinonaktifkan orang lain sama saja meninggalkan
          // tenant tanpa siapa pun yang dapat mengurus billing.
          const { rows } = await client.query<{ n: string }>(
            `SELECT count(*) AS n FROM user_role ur
               JOIN "user" u ON u.id = ur.user_id
              WHERE ur.role = 'owner' AND u.is_active = true AND u.id <> $1`,
            [userId]
          );
          const iniOwner = await client.query(
            `SELECT 1 FROM user_role WHERE user_id = $1 AND role = 'owner'`,
            [userId]
          );
          if (iniOwner.rows.length > 0 && Number(rows[0].n) === 0) {
            throw new HttpError(
              409,
              'LAST_OWNER',
              'Owner terakhir tidak dapat dinonaktifkan. Tetapkan owner lain terlebih dahulu.'
            );
          }
        }

        await client.query(
          `UPDATE "user"
              SET name = COALESCE($2, name),
                  email = CASE WHEN $3::boolean THEN $4 ELSE email END,
                  is_active = COALESCE($5, is_active),
                  deactivated_at = CASE WHEN $5 = false THEN now() ELSE deactivated_at END
            WHERE id = $1`,
          [
            userId,
            body.name ?? null,
            Object.hasOwn(body, 'email'),
            body.email ?? null,
            body.isActive ?? null,
          ]
        );

        if (body.isActive === false) {
          await recordAuditEvent(client, {
            id: randomUUID(),
            tenantId,
            outletId: null,
            actorUserId: actorId,
            approverUserId: null,
            eventType: 'user_deactivated',
            entityType: 'user',
            entityId: userId,
            reasonCode: null,
            reasonNote: null,
            before: { isActive: sebelum.is_active },
            after: { isActive: false },
            hlc: hlc.tick(),
          });
        }

        return bentukUser(client, await ambilUser(client, userId));
      });

      reply.code(200);
      return hasil;
    },

    async setUserPin(req: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const { userId } = req.params as { userId: string };
      const { pin, isReset = false } = req.body as { pin: string; isReset?: boolean };

      await withTenantTransaction(pool, tenantId, async (client) => {
        const { rows: pengguna } = await client.query<{ birth_date: string | null }>(
          'SELECT birth_date FROM "user" WHERE id = $1',
          [userId]
        );
        if (pengguna.length === 0) {
          throw new HttpError(404, 'USER_NOT_FOUND', `Pengguna ${userId} tidak ditemukan.`);
        }

        if (!isValidPinShape(pin)) {
          throw new HttpError(400, 'PIN_INVALID_SHAPE', 'PIN harus tepat 6 digit angka.');
        }

        // Pesan datang dari domain dan menyebut POLA MANA -- AC `spec-f:144`.
        // Pesan seragam akan membuat manajer yang ditolak tiga kali memilih
        // PIN lemah yang keempat.
        const lemah = detectWeakPin(pin, { birthDate: pengguna[0].birth_date });
        if (lemah) {
          throw new HttpError(400, 'PIN_TOO_WEAK', lemah.message);
        }

        await assertPinBelumDipakaiDiOutlet(client, hasher, userId, pin);

        const phc = await hasher.hash(pin);
        await client.query(
          `UPDATE "user"
              SET pin_hash = $2, pin_algo = 'argon2id', pin_rotated_at = now(),
                  pin_must_change = $3,
                  pin_failed_attempts = 0, pin_locked_until = NULL
            WHERE id = $1`,
          [userId, phc, isReset]
        );

        // ⛔ `before`/`after` TIDAK memuat PIN maupun hash-nya. Audit event
        // direplikasi dan diekspor, dan retensinya minimal lima tahun
        // (spec-f:372) -- hash PIN di dalamnya adalah kebocoran yang bertahan
        // selama itu.
        await recordAuditEvent(client, {
          id: randomUUID(),
          tenantId,
          outletId: null,
          actorUserId: actorId,
          approverUserId: null,
          eventType: 'pin_changed',
          entityType: 'user',
          entityId: userId,
          reasonCode: isReset ? 'reset_oleh_manajer' : null,
          reasonNote: null,
          after: { isReset },
          hlc: hlc.tick(),
        });
      });

      reply.code(204);
      return null;
    },

    /**
     * FR-F4 — hitungan dan eskalasi penguncian.
     *
     * Perangkat memverifikasi PIN secara LOKAL (`spec-f:125`) lalu melaporkan
     * hasilnya ke sini. Server memegang hitungannya supaya penguncian berlaku
     * di seluruh perangkat outlet, bukan hanya di perangkat tempat PIN salah
     * diketik — kalau tidak, orang yang ditolak tinggal pindah tablet.
     *
     * Perangkat juga menyimpan hitungannya sendiri (§6), karena saat offline
     * endpoint ini tidak dapat dicapai dan `spec-f:221` menuntut penguncian
     * "berlaku PENUH saat offline".
     */
    async recordPinAttempt(req: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const { userId } = req.params as { userId: string };
      const { outcome } = req.body as { outcome: 'failed' | 'succeeded' };

      const hasil = await withTenantTransaction(pool, tenantId, async (client) => {
        await ambilUser(client, userId);

        if (outcome === 'succeeded') {
          const { rows } = await client.query<{ pin_failed_attempts: number }>(
            `UPDATE "user" SET pin_failed_attempts = 0, pin_locked_until = NULL
              WHERE id = $1 RETURNING pin_failed_attempts`,
            [userId]
          );
          return { failedAttempts: rows[0].pin_failed_attempts, lockedUntil: null, lockSeconds: null };
        }

        // Seluruh keputusan waktu memakai jam DATABASE. Pelajaran yang sudah
        // dicatat di CLAUDE.md: dua jam berbeda di dua mesin membuat "sudah
        // lewat satu jam" dan "belum" berselisih milidetik.
        const { rows } = await client.query<{
          pin_failed_attempts: number;
          pin_lockout_count: number;
          jendela_habis: boolean;
        }>(
          `UPDATE "user"
              SET pin_failed_attempts = pin_failed_attempts + 1
            WHERE id = $1
        RETURNING pin_failed_attempts, pin_lockout_count,
                  (pin_lockout_window_start IS NULL
                   OR pin_lockout_window_start <= now() - interval '1 hour') AS jendela_habis`,
          [userId]
        );
        const baris = rows[0];

        await recordAuditEvent(client, {
          id: randomUUID(),
          tenantId,
          outletId: null,
          actorUserId: actorId,
          approverUserId: null,
          eventType: 'pin_failed',
          entityType: 'user',
          entityId: userId,
          reasonCode: null,
          reasonNote: null,
          hlc: hlc.tick(),
        });

        if (baris.pin_failed_attempts < BATAS_GAGAL) {
          return {
            failedAttempts: baris.pin_failed_attempts,
            lockedUntil: null,
            lockSeconds: null,
          };
        }

        // Jendela satu jam direset bila sudah habis; kalau tidak, hitungan
        // penguncian bertambah. `pin_locked_until` yang sudah lewat tidak
        // menyimpan apa pun tentang berapa kali ia pernah terjadi -- itulah
        // kenapa `pin_lockout_count` ada.
        const berikutnya = baris.jendela_habis ? 1 : baris.pin_lockout_count + 1;
        const detik = berikutnya >= ESKALASI_SETELAH_PENGUNCIAN ? KUNCI_ESKALASI_DETIK : KUNCI_DETIK;

        const { rows: dikunci } = await client.query<{ pin_locked_until: string }>(
          `UPDATE "user"
              SET pin_locked_until = now() + ($2 || ' seconds')::interval,
                  pin_lockout_count = $3,
                  pin_lockout_window_start = CASE WHEN $4::boolean THEN now() ELSE pin_lockout_window_start END
            WHERE id = $1
        RETURNING pin_locked_until`,
          [userId, String(detik), berikutnya, baris.jendela_habis]
        );

        await recordAuditEvent(client, {
          id: randomUUID(),
          tenantId,
          outletId: null,
          actorUserId: actorId,
          approverUserId: null,
          eventType: 'pin_lockout',
          entityType: 'user',
          entityId: userId,
          reasonCode: null,
          reasonNote: null,
          after: { lockSeconds: detik, lockoutCount: berikutnya },
          hlc: hlc.tick(),
        });

        return {
          failedAttempts: baris.pin_failed_attempts,
          lockedUntil: dikunci[0].pin_locked_until,
          lockSeconds: detik,
        };
      });

      reply.code(200);
      return hasil;
    },
  };
}
