import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from '../../../db.ts';
import { withTenantTransaction } from '../../../db.ts';
import { HttpError } from '../../../http-error.ts';
import { getTenantId, getActorId } from '../../../tenant-context.ts';
import { assertUserVisible, assertBoleh } from '../../identity/index.ts';
import { catatPerubahanServer, recordAuditEvent } from '../../audit/index.ts';
import { assertKuota, hitungOutlet } from '../kuota.ts';
import { bacaAmbangOutlet } from '../index.ts';
import type { Hlc } from '../../../../../../packages/domain/src/hlc.ts';
import { ZONA_WAKTU } from '../../../../../../packages/domain/src/zona-waktu.ts';
import {
  ambangBerlaku,
  periksaAmbang,
  type AmbangTersimpan,
} from '../../../../../../packages/domain/src/ambang.ts';
import { formatScaledRate } from '../../../../../../packages/domain/src/numeric.ts';
import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * `POST /outlets` — outlet kedua dan seterusnya.
 *
 * Outlet PERTAMA lahir bersama tenant di `POST /tenants`; sebuah tenant tanpa
 * outlet tidak dapat berjualan sama sekali, jadi ia tidak pernah ada sebagai
 * keadaan yang sah.
 *
 * ## Titik penegakan `max_outlets` (`research/09` § 6)
 *
 * Ini satu dari empat tempat kuota ditegakkan, dan seluruhnya adalah operasi
 * **administratif**. Tidak satu pun ada di jalur kasir.
 *
 * ## Owner-only, dan itu dari spec
 *
 * `spec-f:29` memberi Owner "membuat outlet"; `spec-f:30` menaruhnya di kolom
 * yang TIDAK BOLEH milik Manajer Area. Ditegakkan lewat `assertBoleh(…,
 * 'outlet_manage')`, bukan lewat perbandingan nama peran di handler.
 */

interface BodyOutlet {
  id: string;
  name: string;
  timezone: string;
  address?: string | null;
  verticalProfileId?: string | null;
}

/**
 * `0002_tenancy.sql` — CHECK (timezone IN (…)).
 *
 * Daftarnya dari `packages/domain`, bukan disalin ke sini: layar pendaftaran
 * B-00b harus merender pilihan yang sama, dan salinan di sisi klien akan
 * menyimpang tanpa satu pun error.
 */
const ZONA_SAH = new Set<string>(ZONA_WAKTU);

export function createOutletHandlers(pool: Pool, hlc: Hlc): Record<string, unknown> {
  return {
    /**
     * Daftar outlet — dibutuhkan setiap layar yang harus MEMILIH outlet, dan
     * B-28 adalah yang pertama.
     *
     * Tanpa ini, layar hanya dapat meminta `outletId` sebagai teks — dan
     * merchant tidak menghafal UUID outletnya, persis masalah yang sama
     * dengan field "ID Tenant" di layar masuk.
     *
     * ⛔ Outlet yang DIARSIPKAN ikut, dengan `archivedAt` terisi. Riwayat
     * penjualan menunjuknya (`order.outlet_id`), jadi ia tidak pernah
     * benar-benar hilang; menyembunyikannya membuat laporan lama menyebut
     * outlet yang tidak dapat ditemukan di mana pun.
     *
     * TIDAK ber-RBAC, dan itu disengaja: nama outlet bukan informasi
     * komersial, dan setiap peran yang dapat masuk back-office bekerja di
     * salah satunya. Yang membatasi APA yang dapat dilakukan di outlet itu
     * adalah penjaga di endpointnya masing-masing.
     */
    async listOutlets(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);

      return withTenantTransaction(pool, tenantId, async (client) => {
        await assertUserVisible(client, actorId);
        const { rows } = await client.query<{
          id: string;
          name: string;
          timezone: string;
          address: string | null;
          archived_at: string | null;
        }>(
          `SELECT id, name, timezone, address, archived_at
             FROM outlet
            ORDER BY (archived_at IS NOT NULL), name`
        );
        return rows.map((r) => ({
          id: r.id,
          name: r.name,
          timezone: r.timezone,
          address: r.address,
          archivedAt: r.archived_at,
        }));
      });
    },

    async createOutlet(req: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const body = req.body as BodyOutlet;

      if (!ZONA_SAH.has(body.timezone)) {
        throw new HttpError(
          400,
          'TIMEZONE_INVALID',
          `Zona waktu harus salah satu dari: ${[...ZONA_SAH].join(', ')}.`
        );
      }

      const hasil = await withTenantTransaction(pool, tenantId, async (client) => {
        await assertUserVisible(client, actorId);
        await assertBoleh(client, actorId, 'outlet_manage', 'mengelola outlet');

        await assertKuota(client, tenantId, 'outlet', await hitungOutlet(client), 1);

        // FK klien-suplai ke tabel ber-tenant_id. Temuan F1: FK PostgreSQL
        // tidak tunduk RLS — ia hanya membuktikan baris itu ada di SUATU
        // tenant. Profil vertikal milik merchant lain akan menentukan
        // perilaku stok negatif outlet ini.
        if (body.verticalProfileId) {
          const { rows } = await client.query('SELECT id FROM vertical_profile WHERE id = $1', [
            body.verticalProfileId,
          ]);
          if (rows.length === 0) {
            throw new HttpError(
              404,
              'VERTICAL_PROFILE_NOT_FOUND',
              `Profil vertikal ${body.verticalProfileId} tidak ditemukan.`
            );
          }
        }

        try {
          await client.query(
            `INSERT INTO outlet (id, tenant_id, name, address, timezone, vertical_profile_id)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              body.id,
              tenantId,
              body.name,
              body.address ?? null,
              body.timezone,
              // `null` berarti "warisi default tenant" — resolusinya
              // `COALESCE(profil_outlet, default_tenant)`, dan itu keputusan
              // OQ-09. Outlet baru yang tidak menyebut profil mengikuti pusat.
              body.verticalProfileId ?? null,
            ]
          );
        } catch (err) {
          if ((err as { code?: string }).code === '23505') {
            throw new HttpError(409, 'ID_ALREADY_EXISTS', `Outlet ${body.id} sudah ada.`);
          }
          throw err;
        }

        await recordAuditEvent(client, {
          id: randomUUID(),
          tenantId,
          outletId: body.id,
          deviceId: null,
          actorUserId: actorId,
          approverUserId: null,
          eventType: 'outlet_created',
          entityType: 'outlet',
          entityId: body.id,
          reasonCode: null,
          reasonNote: null,
          after: { name: body.name, timezone: body.timezone },
          hlc: hlc.tick(),
        });

        return { id: body.id, name: body.name, timezone: body.timezone };
      });

      reply.code(201);
      return hasil;
    },

    /**
     * `GET /outlets/{outletId}/thresholds` — B-26 Ambang Otorisasi.
     *
     * ⛔ Mengembalikan `tersimpan` DAN `berlaku`, dan itu bukan kelebihan
     * data. Keduanya menjawab pertanyaan yang berbeda:
     *
     * - `tersimpan.selisihKas = null` berarti outlet ini belum menyetel apa
     *   pun, dan layar harus menampilkan isian KOSONG dengan bawaannya sebagai
     *   petunjuk — bukan angka bawaan yang terlihat seperti pilihan merchant.
     * - `berlaku.selisihKas = "20000"` berarti itulah yang benar-benar
     *   menentukan hari ini.
     *
     * Mengirim hanya salah satunya memaksa layar menebak yang lain. Yang
     * menebak `tersimpan` dari `berlaku` akan menuliskan bawaan sebagai
     * pilihan pada penyimpanan berikutnya — dan sejak saat itu outlet berhenti
     * mengikuti perubahan bawaan, tanpa siapa pun memutuskannya.
     */
    async getOutletThresholds(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const { outletId } = req.params as { outletId: string };

      return withTenantTransaction(pool, tenantId, async (client) => {
        await assertUserVisible(client, actorId);
        // ⛔ MEMBACA tidak menuntut `threshold_settings`. Kasir yang ditolak
        // PIN-nya berhak tahu ambang mana yang menolaknya, dan angka itu sudah
        // turun ke perangkat lewat jalur diskon (`CLAUDE.md`). Yang dijaga
        // adalah MENULISNYA.
        return { outletId, ...(await bacaAmbang(client, outletId)) };
      });
    },

    /**
     * `PUT /outlets/{outletId}/thresholds` — menyetel ketiga ambang.
     *
     * ⛔ `PUT`, bukan `PATCH`, dan bidang yang tidak dikirim menjadi `null`
     * (kembali ke bawaan). Layarnya menampilkan keempat isian sekaligus; PATCH
     * yang menyimpan sebagian membuat "kosongkan isian ini" tidak dapat
     * dinyatakan sama sekali — dan mengosongkan adalah satu-satunya cara
     * kembali ke bawaan.
     */
    async setOutletThresholds(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const { outletId } = req.params as { outletId: string };
      const body = (req.body ?? {}) as Record<string, unknown>;

      const minta: AmbangTersimpan = {
        diskonPersenSkala: bacaBigintOpsional(body.diskonPersenSkala, 'diskonPersenSkala'),
        diskonNominal: bacaBigintOpsional(body.diskonNominal, 'diskonNominal'),
        selisihKas: bacaBigintOpsional(body.selisihKas, 'selisihKas'),
        noSale: bacaIntOpsional(body.noSale, 'noSale'),
      };

      // ⛔ Aturannya di domain, dan KLIEN memakai fungsi yang sama. Dua salinan
      // menghasilkan layar yang menerima angka yang server tolak — dan
      // penolakan yang datang setelah tombol simpan ditekan terbaca sebagai
      // kerusakan, bukan sebagai aturan.
      const periksa = periksaAmbang(minta);
      if (!periksa.ok) {
        throw new HttpError(400, 'VALIDATION_ERROR', periksa.pesan);
      }

      return withTenantTransaction(pool, tenantId, async (client) => {
        await assertUserVisible(client, actorId);
        await assertBoleh(client, actorId, 'threshold_settings', 'mengubah ambang otorisasi');

        const sebelum = await bacaAmbang(client, outletId);

        const { rowCount } = await client.query(
          `UPDATE outlet
              SET discount_threshold_percent = $2::numeric,
                  discount_threshold_amount = $3::bigint,
                  cash_variance_threshold = $4::bigint,
                  no_sale_threshold = $5::int
            WHERE id = $1 AND archived_at IS NULL`,
          [
            outletId,
            // ⛔ Persen dikirim ke `numeric` sebagai STRING lewat
            // `formatScaledRate`. Membaginya di JavaScript menghidupkan lagi
            // float di jalur yang `numeric.ts` ada untuk menjaganya.
            minta.diskonPersenSkala === null ? null : formatScaledRate(minta.diskonPersenSkala),
            minta.diskonNominal === null ? null : minta.diskonNominal.toString(),
            minta.selisihKas === null ? null : minta.selisihKas.toString(),
            minta.noSale,
          ]
        );
        if (rowCount === 0) {
          throw new HttpError(404, 'OUTLET_NOT_FOUND', `Outlet ${outletId} tidak ditemukan.`);
        }

        const sesudah = await bacaAmbang(client, outletId);

        // FR-F6 + `spec-f:297` (`threshold_changed`).
        //
        // ⛔ Yang dicatat `tersimpan`, bukan `berlaku`. Outlet yang
        // mengosongkan ambangnya kembali ke bawaan, dan audit yang mencatat
        // angka bawaan sebagai nilai baru tidak dapat dibedakan dari merchant
        // yang mengetik angka itu — dua keadaan yang berperilaku sama HARI INI
        // dan berbeda pada hari bawaannya berubah.
        await catatPerubahanServer(client, {
          tenantId,
          actorUserId: actorId,
          eventType: 'threshold_changed',
          entityType: 'outlet',
          entityId: outletId,
          outletId,
          before: sebelum.tersimpan,
          after: sesudah.tersimpan,
        });

        return { outletId, ...sesudah };
      });
    },
  };
}

/** `bigint` opsional dari muatan JSON — STRING, tidak pernah `number`. */
function bacaBigintOpsional(nilai: unknown, bidang: string): bigint | null {
  if (nilai === undefined || nilai === null || nilai === '') return null;
  // ⛔ String, dan itu bukan kerewelan: rupiah utuh melampaui 2^53 pada nilai
  // yang masih mungkin, dan `number` yang lewat di sini adalah pembulatan
  // diam-diam di jalur yang memutuskan kapan PIN manajer dituntut.
  if (typeof nilai !== 'string' || !/^-?\d+$/.test(nilai)) {
    throw new HttpError(400, 'VALIDATION_ERROR', `${bidang} harus string bilangan bulat.`);
  }
  return BigInt(nilai);
}

function bacaIntOpsional(nilai: unknown, bidang: string): number | null {
  if (nilai === undefined || nilai === null || nilai === '') return null;
  const n = typeof nilai === 'number' ? nilai : Number(nilai);
  if (!Number.isInteger(n)) {
    throw new HttpError(400, 'VALIDATION_ERROR', `${bidang} harus bilangan bulat.`);
  }
  return n;
}

/**
 * Ambang tersimpan + yang berlaku, dari satu SELECT.
 *
 * ⛔ Query-nya tunduk RLS, jadi outlet tenant lain menghasilkan nol baris dan
 * 404 — bentuk yang sama dengan `getOutletSettings`. FK tidak dilibatkan sama
 * sekali di sini, dan itu benar: temuan F1 menunjukkan FK hanya membuktikan
 * barisnya ada di SUATU tenant.
 */
async function bacaAmbang(
  client: PoolClient,
  outletId: string
): Promise<{ tersimpan: Record<string, string | number | null>; berlaku: Record<string, string | number> }> {
  const tersimpan = await bacaAmbangOutlet(client, outletId);
  const berlaku = ambangBerlaku(tersimpan);
  return {
    // ⛔ Uang dan tarif keluar sebagai STRING dari ujung ke ujung. `bigint`
    // tidak dapat di-`JSON.stringify`, dan `Number()` di titik ini adalah
    // pembulatan yang tidak akan terlihat sampai laporan tidak cocok.
    tersimpan: {
      diskonPersenSkala:
        tersimpan.diskonPersenSkala === null ? null : tersimpan.diskonPersenSkala.toString(),
      diskonNominal: tersimpan.diskonNominal === null ? null : tersimpan.diskonNominal.toString(),
      selisihKas: tersimpan.selisihKas === null ? null : tersimpan.selisihKas.toString(),
      noSale: tersimpan.noSale,
    },
    berlaku: {
      diskonPersenSkala: berlaku.diskonPersenSkala.toString(),
      diskonNominal: berlaku.diskonNominal.toString(),
      selisihKas: berlaku.selisihKas.toString(),
      noSale: berlaku.noSale,
    },
  };
}
