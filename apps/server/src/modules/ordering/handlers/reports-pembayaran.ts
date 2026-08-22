import type { FastifyRequest } from 'fastify';
import type { Pool } from '../../../db.ts';
import { withTenantTransaction } from '../../../db.ts';
import { getActorId, getTenantId } from '../../../tenant-context.ts';
import { assertUserVisible } from '../../identity/index.ts';
import { assertOutletVisible } from '../../tenancy/index.ts';
import { assertRentang } from './rentang.ts';
import { metodePunyaPerkiraanMdr } from '../../../../../../packages/domain/src/mdr.ts';

/**
 * `GET /reports/payments` — FR-G1, uang masuk per METODE pembayaran.
 *
 * ## Rekonsiliasi MDR — FR-C12
 *
 * `IA:§3.3` menamai layarnya "Laporan Pembayaran & Rekonsiliasi". Sejak Modul
 * C-3, setiap baris membawa perkiraan potongan dan perkiraan settlement di
 * samping nilai transaksinya (AC FR-C12 pertama).
 *
 * ⛔ `perkiraanMdr` `null` BERBEDA dari `"0"`. `null` berarti metode itu tidak
 * punya perkiraan sama sekali — tunai tidak dipotong, dan kartu EDC dipotong
 * dengan tarif per-acquirer yang `spec-c` tidak berikan satu pun angkanya.
 * `"0"` berarti diperkirakan tidak ada potongan (UMI di bawah ambang).
 * Merchant yang melihat "Rp 0" untuk kartu akan menyimpulkan kartu tidak
 * dipotong.
 *
 * ⛔ Nilainya dibaca dari `payment.mdr_estimated` — SNAPSHOT saat transaksi,
 * bukan dihitung ulang saat laporan dibuat. Baris yang ditulis sebelum FR-C12
 * tidak punya nilainya; jumlahnya dilaporkan lewat `tanpaPerkiraan` alih-alih
 * dijumlahkan sebagai nol.
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
  mdr: string | null;
  /** Berapa baris pada metode ini yang TIDAK punya perkiraan tersimpan. */
  tanpa_mdr: string;
}

/** Data laporan pembayaran. Diekspor untuk dipakai `GET /reports/export`. */
export async function ambilPembayaran(
  client: import('../../../db.ts').PoolClient,
  { from, to, outletId }: { from: string; to: string; outletId: string | null }
) {
        const { rows } = await client.query<BarisDb>(
    `SELECT p.method,
            COUNT(*)::text                                        AS jumlah,
            SUM(p.amount)::text                                   AS total,
            SUM(COALESCE(p.mdr_estimated, 0))::text               AS mdr,
            COUNT(*) FILTER (WHERE p.mdr_estimated IS NULL)::text  AS tanpa_mdr
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
  const metode = rows.map((r) => {
    const diterima = BigInt(r.total);
    const tanpaPerkiraan = Number(r.tanpa_mdr);
    // ⛔ Diturunkan dari BARIS yang tersimpan, bukan dari metodenya saja.
    // Baris yang ditulis sebelum FR-C12 punya `mdr_estimated = NULL` meski
    // metodenya QRIS; menjumlahkannya sebagai nol akan melaporkan "tidak ada
    // potongan" untuk transaksi yang sebenarnya dipotong.
    const punyaPerkiraan =
      metodePunyaPerkiraanMdr(r.method) && tanpaPerkiraan < Number(r.jumlah);
    const mdr = punyaPerkiraan ? BigInt(r.mdr ?? '0') : null;
    return {
      method: r.method,
      jumlahTransaksi: Number(r.jumlah),
      totalDiterima: diterima.toString(),
      /** `null` = metode ini tidak punya perkiraan potongan sama sekali. */
      perkiraanMdr: mdr === null ? null : mdr.toString(),
      perkiraanSettlement: (diterima - (mdr ?? 0n)).toString(),
      tanpaPerkiraan,
    };
  });

  let total = 0n;
  let totalMdr = 0n;
  for (const m of metode) {
    total += BigInt(m.totalDiterima);
    if (m.perkiraanMdr !== null) totalMdr += BigInt(m.perkiraanMdr);
  }

  return {
    metode,
    totalDiterima: total.toString(),
    /** ⛔ PERKIRAAN — AC FR-C12 kedua. Kata itu wajib ikut sampai ke layar. */
    totalPerkiraanMdr: totalMdr.toString(),
    totalPerkiraanSettlement: (total - totalMdr).toString(),
  };
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
