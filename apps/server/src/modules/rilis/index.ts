import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from '../../db.ts';
import { withTenantTransaction } from '../../db.ts';
import { HttpError } from '../../http-error.ts';
import { getTenantId } from '../../tenant-context.ts';
import {
  adalahAlasanWajibSegera,
  adalahTahapRollout,
  JENDELA_BAWAAN,
  MAKS_TUNDA,
  putuskanUpdate,
  type JendelaUpdate,
  type RilisAktif,
} from '../../../../../packages/domain/src/rilis.ts';
import { ambilBearer, catatPenundaanUpdate, verifikasiPerangkat } from '../identity/index.ts';
import { getKonteksRilis } from '../tenancy/index.ts';

/**
 * Modul rilis — F6, staged rollout. `ARCH:§12`, KEP-36.
 *
 * Memiliki satu tabel: `app_release`.
 *
 * ## ⛔ Ia MEMUTUSKAN, tidak MEMASANG
 *
 * Mengunduh dan memasang versi menuntut shell Tauri — utang F4 yang tercatat.
 * Yang dijawab endpoint ini adalah "versi mana yang seharusnya, dan boleh
 * dipasang sekarang atau tidak". Updater yang lahir kelak tinggal menempel
 * pada jawaban itu alih-alih memutuskan ulang, dan aturannya tidak akan
 * pernah punya dua salinan.
 *
 * ## ⛔ Kenapa modul tersendiri untuk satu tabel
 *
 * Alasan yang sama dengan `sync`, `audit`, dan `inventory` (`modules/
 * README.md`): keputusan rilis menunjuk ke tiga modul lain — `device`
 * (identity), `outlet`/`tenant` (tenancy), dan `app_release` (di sini).
 * Alternatifnya adalah salah satu dari ketiganya meng-query tabel milik yang
 * lain, dan itu invariant #4.
 *
 * ## ⛔ Diautentikasi SECRET PERANGKAT
 *
 * Sama dengan telemetri dan token sinkronisasi, lewat modul yang sama.
 * Perangkat menanyakan versinya sendiri, sering saat tidak ada orang yang
 * login.
 */

interface BarisRilis {
  version: string;
  stage: string;
  mandatory_reason: string | null;
}

/**
 * Rilis yang berlaku: yang TERBARU dan belum dihentikan.
 *
 * ⛔ `halted_at IS NULL` bukan pelengkap. Versi yang ditarik karena merusak
 * sesuatu harus berhenti ditawarkan pada permintaan berikutnya — dan barisnya
 * tetap ada justru supaya perangkat yang terlanjur memasangnya dapat
 * dijelaskan.
 *
 * `app_release` dikecualikan dari RLS (migrasi 0030): ia tidak punya
 * `tenant_id` karena tidak ada tenant yang memilikinya.
 */
export async function ambilRilisAktif(client: PoolClient): Promise<RilisAktif | null> {
  const { rows } = await client.query<BarisRilis>(
    `SELECT version, stage, mandatory_reason
       FROM app_release
      WHERE halted_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1`
  );
  const b = rows[0];
  if (b === undefined) return null;
  // Nilai asing mustahil (CHECK constraint), tapi menebak arah yang salah di
  // sini berarti menawarkan update ke perangkat yang belum gilirannya.
  if (!adalahTahapRollout(b.stage)) return null;
  return {
    versi: b.version,
    tahap: b.stage,
    wajibSegera: adalahAlasanWajibSegera(b.mandatory_reason) ? b.mandatory_reason : null,
  };
}

/**
 * Jendela outlet, atau bawaan.
 *
 * ⛔ Bawaannya diterapkan DI SINI, satu tempat, dari konstanta domain. Kolom
 * ber-`DEFAULT` di database akan membuat perubahan bawaan hanya berlaku untuk
 * outlet yang dibuat sesudahnya — dan outlet lama diam-diam memakai angka
 * lama selamanya.
 */
function jendelaDari(mulai: number | null, selesai: number | null): JendelaUpdate {
  if (mulai === null || selesai === null) return JENDELA_BAWAAN;
  return { mulaiJam: mulai, selesaiJam: selesai };
}

export function createRilisHandlers(pool: Pool): Record<string, unknown> {
  return {
    async getDeviceUpdate(req: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(req);
      const { deviceId } = req.params as { deviceId: string };
      const secret = ambilBearer(req);

      const hasil = await withTenantTransaction(pool, tenantId, async (client) => {
        const device = await verifikasiPerangkat(client, deviceId, secret);
        const ctx = await getKonteksRilis(client, device.outlet_id);
        const rilis = await ambilRilisAktif(client);

        // ⛔ Penundaan dihitung hanya bila ia untuk versi INI. Perangkat yang
        // menunda 1.1.0 dua kali tidak kehilangan haknya atas 1.2.0.
        const sudahTunda =
          rilis !== null && device.update_deferred_version === rilis.versi
            ? device.update_deferrals
            : 0;

        const keputusan = putuskanUpdate(rilis, {
          // `app_version` boleh `null` pada perangkat yang belum pernah
          // melapor; string kosong tidak akan pernah sama dengan versi rilis,
          // jadi ia diperlakukan sebagai "versi tidak diketahui" — dan
          // perangkat yang versinya tidak diketahui memang harus diperbarui.
          versiPerangkat: device.app_version ?? '',
          tenantId: ctx.tenantId,
          isKanari: ctx.isCanary,
          jamLokal: ctx.jamLokal,
          jendela: jendelaDari(ctx.jendelaMulai, ctx.jendelaSelesai),
          sudahTunda,
        });
        return { keputusan, ctx, sudahTunda };
      });

      reply.code(200);
      return {
        ...hasil.keputusan,
        sisaTunda: Math.max(0, MAKS_TUNDA - hasil.sudahTunda),
        jamLokal: hasil.ctx.jamLokal,
        jendela: jendelaDari(hasil.ctx.jendelaMulai, hasil.ctx.jendelaSelesai),
      };
    },

    /**
     * Merchant menekan "nanti saja".
     *
     * ⛔ Ditolak bila jatahnya habis, dan ditolak bila rilisnya wajib segera.
     * Keduanya diputuskan `putuskanUpdate` — bukan diperiksa ulang di sini
     * dengan aturan yang ditulis kedua kalinya.
     */
    async deferDeviceUpdate(req: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(req);
      const { deviceId } = req.params as { deviceId: string };
      const secret = ambilBearer(req);

      const hasil = await withTenantTransaction(pool, tenantId, async (client) => {
        const device = await verifikasiPerangkat(client, deviceId, secret);
        const ctx = await getKonteksRilis(client, device.outlet_id);
        const rilis = await ambilRilisAktif(client);
        if (rilis === null) {
          throw new HttpError(409, 'NO_ACTIVE_RELEASE', 'Tidak ada rilis yang dapat ditunda.');
        }

        const sudahTunda =
          device.update_deferred_version === rilis.versi ? device.update_deferrals : 0;
        const keputusan = putuskanUpdate(rilis, {
          versiPerangkat: device.app_version ?? '',
          tenantId: ctx.tenantId,
          isKanari: ctx.isCanary,
          jamLokal: ctx.jamLokal,
          jendela: jendelaDari(ctx.jendelaMulai, ctx.jendelaSelesai),
          sudahTunda,
        });
        if (!keputusan.bolehTunda) {
          throw new HttpError(
            409,
            'DEFERRAL_NOT_ALLOWED',
            keputusan.alasan === 'wajib_segera'
              ? 'Pembaruan ini wajib segera dan tidak dapat ditunda.'
              : `Batas penundaan (${MAKS_TUNDA}x) sudah tercapai untuk versi ${rilis.versi}.`
          );
        }

        const jumlah = await catatPenundaanUpdate(client, deviceId, rilis.versi);
        return { versi: rilis.versi, jumlah };
      });

      reply.code(200);
      return {
        versi: hasil.versi,
        sudahTunda: hasil.jumlah,
        sisaTunda: Math.max(0, MAKS_TUNDA - hasil.jumlah),
      };
    },
  };
}
