import type { FastifyRequest } from 'fastify';
import type { Pool } from '../../../db.ts';
import { withTenantTransaction } from '../../../db.ts';
import { getActorId, getTenantId } from '../../../tenant-context.ts';
import { assertUserVisible } from '../../identity/index.ts';
import { assertOutletVisible } from '../../tenancy/index.ts';
import { assertRentang } from './rentang.ts';

/**
 * `GET /reports/payments` — FR-G1, uang masuk per METODE pembayaran.
 *
 * ## ⛔ Rekonsiliasi TIDAK termasuk
 *
 * `IA:§3.3` menamai layarnya "Laporan Pembayaran & Rekonsiliasi", tapi Modul
 * C-3 (rekonsiliasi gateway) belum dibangun sama sekali — ia P1 dan tercatat
 * sebagai sisa di `CLAUDE.md`. Endpoint ini karena itu murni agregasi per
 * metode. Batasnya dinyatakan, bukan disamarkan dengan field kosong.
 *
 * ## ⛔ Hanya payment `confirmed`
 *
 * `spec-c:223`, dan `sumConfirmed` di `payment/handlers/payments.ts` sudah
 * menegakkannya untuk pelunasan order: payment yang masih
 * `pending_confirmation` (QRIS dinamis) belum boleh dianggap uang masuk, dan
 * `failed` jelas bukan.
 *
 * ⛔ Ini BERBEDA dari laporan harian di aplikasi kasir
 * (`apps/kasir/src/laporan/harian.ts`), yang menjumlahkan payment tanpa
 * menyaring status sama sekali. Selisihnya muncul hanya bila ada payment
 * non-`confirmed` pada hari itu — dan bila itu terjadi, angka yang benar
 * adalah yang di sini. Perbedaan itu dicatat, bukan didiamkan; memperbaiki
 * sisi kasir adalah pekerjaan tersendiri di aplikasi lain.
 *
 * ## Order yang dibatalkan dikeluarkan
 *
 * Aturan yang sama dengan `posisiPenjualan` dan laporan produk: pesanan yang
 * PUNYA pembatal tidak pernah menghasilkan uang yang bertahan.
 *
 * ## Ini bukan omzet, dan tidak akan sama dengannya
 *
 * Total di sini adalah uang yang DITERIMA per metode; omzet bersih
 * mengurangkan refund, dan refund tidak menghasilkan baris `payment` negatif
 * (keputusan 7 Agustus 2026 — `payment.amount` punya `CHECK (amount > 0)`).
 * Karena itu field-nya bernama `totalDiterima`, bukan omzet.
 */

interface BarisDb {
  method: string;
  jumlah: string;
  total: string;
}

/** Data laporan pembayaran. Diekspor untuk dipakai `GET /reports/export`. */
export async function ambilPembayaran(
  client: import('../../../db.ts').PoolClient,
  { from, to, outletId }: { from: string; to: string; outletId: string | null }
) {
        const { rows } = await client.query<BarisDb>(
    `SELECT p.method,
            COUNT(*)::text   AS jumlah,
            SUM(p.amount)::text AS total
       FROM payment p
       JOIN "order" o ON o.id = p.order_id
      WHERE o.business_date BETWEEN $1 AND $2
        AND ($3::text IS NULL OR o.outlet_id = $3)
        -- spec-c:223 — hanya yang benar-benar terkonfirmasi.
        AND p.status = 'confirmed'
        -- Pesanan yang PUNYA pembatal dikeluarkan; aturan yang sama
        -- dengan posisiPenjualan.
        AND NOT EXISTS (
          SELECT 1 FROM "order" v WHERE v.voided_by_order_id = o.id
        )
      GROUP BY p.method
      ORDER BY SUM(p.amount) DESC, p.method ASC`,
    [from, to, outletId]
  );

  // ⛔ STRING. `pg` mengembalikan `bigint` sebagai string, dan
  // mengubahnya ke `number` membuang presisi di atas 2^53.
  const metode = rows.map((r) => ({
    method: r.method,
    jumlahTransaksi: Number(r.jumlah),
    totalDiterima: String(r.total),
  }));

  let total = 0n;
  for (const m of metode) total += BigInt(m.totalDiterima);

  return { metode, totalDiterima: total.toString() };
}

export function createPaymentReportHandlers(pool: Pool): Record<string, unknown> {
  return {
    async getPaymentReport(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const q = req.query as { from?: string; to?: string; outlet_id?: string };
      const { from, to, outletId } = assertRentang(q);

      return withTenantTransaction(pool, tenantId, async (client) => {
        await assertUserVisible(client, actorId);
        if (outletId !== null) await assertOutletVisible(client, outletId);

        return { from, to, outletId, ...(await ambilPembayaran(client, { from, to, outletId })) };
      });
    },
  };
}
