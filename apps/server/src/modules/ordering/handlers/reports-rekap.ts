import type { FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from '../../../db.ts';
import { withTenantTransaction } from '../../../db.ts';
import { getActorId, getTenantId } from '../../../tenant-context.ts';
import { assertUserVisible } from '../../identity/index.ts';
import { assertOutletVisible } from '../../tenancy/index.ts';
import { assertRentang } from './rentang.ts';
import {
  rekapPenjualan,
  STATUS_PENJUALAN_LIST,
} from '../../../../../../packages/domain/src/posisi-penjualan.ts';
import { ambilPembayaran } from './reports-pembayaran.ts';

/**
 * `GET /reports/recap` — FR-C13, rekapitulasi penjualan untuk pelaporan pajak.
 *
 * `spec-c:442`: *"Menggantikan integrasi API Coretax (OQ-04). Merchant atau
 * akuntannya memakai hasil ekspor untuk pelaporan."*
 *
 * Isinya persis yang `spec-c:444` daftarkan: periode · outlet · jumlah
 * transaksi · omzet kotor · total diskon · total service charge · **total
 * pajak dipisah per nama tarif dan per yurisdiksi** · total pembulatan ·
 * omzet bersih · rincian per metode pembayaran.
 *
 * ## ⛔ Angkanya BUKAN dihitung ulang di sini
 *
 * Omzet, void, refund, pajak terkumpul, dan jumlah transaksi datang dari
 * `rekapPenjualan`, yang memanggil `posisiPenjualan` — fungsi yang sama yang
 * `GET /reports/sales` pakai. AC FR-C13 kedua menuntut *"total di ekspor cocok
 * dengan laporan penjualan pada periode yang sama"*, dan satu-satunya cara
 * membuat itu benar menurut KONSTRUKSI adalah memakai fungsi yang sama.
 *
 * Ada test yang menjalankan keduanya untuk periode yang sama dan
 * `assert.deepEqual` angkanya — pola yang sama dengan B-01.
 *
 * ## ⛔ Pajak dipisah dari SNAPSHOT, bukan dari `tax_rate`
 *
 * `order_line.tax_rate_name` (migrasi 0022) dan `order_line.tax_jurisdiction`
 * (migrasi 0028) adalah salinan nilai saat penjualan. Meresolusinya lewat JOIN
 * ke `tax_rate` berarti tarif yang di-rename atau dipindah yurisdiksi mengubah
 * rekapitulasi periode yang **sudah dilaporkan** — dan ekspor kedua akan
 * dibaca sebagai koreksi atas yang pertama meski tidak ada satu pun transaksi
 * yang berubah.
 *
 * Baris yang ditulis sebelum kedua migrasi itu tidak punya nilainya. Ia
 * dikelompokkan sebagai `null` dan ditampilkan "(tidak tercatat)" — jujur,
 * bukan ditebak dari tabel yang mungkin sudah berubah.
 *
 * ## ⛔ Batas yang dinyatakan: dua angka masih selalu NOL hari ini
 *
 * `totalDiskonOrder` dan `totalServiceCharge` dibaca dari `order.order_discount`
 * dan `order.service_charge_amount`, dan **`POST /orders` masih menulis nol ke
 * keduanya** — diskon tingkat order dan service charge belum ada di jalur
 * pembuatan order. Keduanya tetap ada di sini karena `spec-c:444` menyebutnya
 * eksplisit dan skemanya sudah menyediakan kolomnya; begitu jalur itu menulis
 * nilai sungguhan, rekapitulasi ikut benar tanpa perubahan.
 *
 * ⛔ Konsekuensinya untuk TEST: keduanya tidak dapat dibuktikan lewat
 * endpoint. Test integrasi yang mencoba akan hijau karena **hampa** — ia
 * memeriksa keadaan yang tidak dapat terjadi. Aturannya diuji di
 * `tests/domain/posisi-penjualan.test.js`, tempat barisnya dapat disusun
 * langsung.
 *
 * `totalPembulatan` TIDAK termasuk batas ini: jalur pembayaran tunai menulis
 * `rounding_adjustment` sungguhan (FR-C9).
 *
 * ## ⛔ Penjaga `satu-sumber-omzet` tetap berlaku sepenuhnya
 *
 * Tidak ada satu pun `SUM(...)` atas tabel `"order"` di berkas ini. Yang
 * diagregasi SQL hanyalah `order_line` (pajak, diskon baris) dan `payment`;
 * kolom `order` dijumlahkan di `packages/domain/src/posisi-penjualan.ts`.
 */

interface BarisOrder {
  id: string;
  status: string;
  total: string;
  tax_amount: string;
  order_discount: string;
  service_charge_amount: string;
  rounding_adjustment: string;
  voided_by_order_id: string | null;
}

interface BarisPajak {
  nama: string | null;
  yurisdiksi: string | null;
  total: string;
}

/** Kelompok pajak: nama tarif + yurisdiksi, keduanya snapshot. */
export interface KelompokPajak {
  nama: string | null;
  yurisdiksi: string | null;
  total: string;
}

export async function ambilRekap(
  client: PoolClient,
  { from, to, outletId }: { from: string; to: string; outletId: string | null }
) {
  // --- Kepala: dari fungsi yang SAMA dengan `/reports/sales` -----------------
  const { rows: orders } = await client.query<BarisOrder>(
    `SELECT id, status, total, tax_amount, order_discount,
            service_charge_amount, rounding_adjustment, voided_by_order_id
       FROM "order"
      WHERE business_date BETWEEN $1 AND $2
        AND ($3::text IS NULL OR outlet_id = $3)`,
    [from, to, outletId]
  );
  const { rows: refunds } = await client.query<{ order_id: string; amount: string }>(
    `SELECT r.order_id, r.amount
       FROM refund r
       JOIN "order" o ON o.id = r.order_id
      WHERE o.business_date BETWEEN $1 AND $2
        AND ($3::text IS NULL OR o.outlet_id = $3)`,
    [from, to, outletId]
  );

  const rekap = rekapPenjualan({
    orders: orders.map((o) => ({
      id: o.id,
      status: o.status,
      total: o.total,
      taxAmount: o.tax_amount,
      orderDiscount: o.order_discount,
      serviceChargeAmount: o.service_charge_amount,
      roundingAdjustment: o.rounding_adjustment,
      voidedByOrderId: o.voided_by_order_id,
    })),
    refunds: refunds.map((r) => ({ orderId: r.order_id, amount: r.amount })),
  });

  // --- Diskon tingkat BARIS -------------------------------------------------
  //
  // Terpisah dari diskon order, dan sengaja: keduanya angka yang berbeda bagi
  // akuntan. Menjumlahkannya jadi satu "total diskon" membuat merchant tidak
  // dapat menjawab pertanyaan "diskon ini dari promo produk atau dari
  // potongan kasir".
  const { rows: diskonBaris } = await client.query<{ total: string | null }>(
    `SELECT COALESCE(SUM(ol.discount_amount), 0)::text AS total
       FROM order_line ol
       JOIN "order" o ON o.id = ol.order_id
      WHERE o.business_date BETWEEN $1 AND $2
        AND ($3::text IS NULL OR o.outlet_id = $3)
        AND o.status = ANY($4::text[])
        AND NOT EXISTS (SELECT 1 FROM "order" v WHERE v.voided_by_order_id = o.id)`,
    [from, to, outletId, STATUS_PENJUALAN_LIST]
  );

  // --- Pajak per nama + yurisdiksi -----------------------------------------
  const { rows: pajak } = await client.query<BarisPajak>(
    `SELECT ol.tax_rate_name        AS nama,
            ol.tax_jurisdiction     AS yurisdiksi,
            SUM(ol.tax_amount)::text AS total
       FROM order_line ol
       JOIN "order" o ON o.id = ol.order_id
      WHERE o.business_date BETWEEN $1 AND $2
        AND ($3::text IS NULL OR o.outlet_id = $3)
        AND o.status = ANY($4::text[])
        AND NOT EXISTS (SELECT 1 FROM "order" v WHERE v.voided_by_order_id = o.id)
        -- Baris tanpa tarif sama sekali dikeluarkan: ia "tidak kena pajak",
        -- bukan kelompok pajak bernilai nol. Kelompok kosong di ekspor pajak
        -- akan dibaca sebagai jenis pajak yang tidak dipungut.
        AND ol.tax_rate_id IS NOT NULL
      GROUP BY ol.tax_rate_name, ol.tax_jurisdiction
      ORDER BY SUM(ol.tax_amount) DESC, ol.tax_rate_name ASC`,
    [from, to, outletId, STATUS_PENJUALAN_LIST]
  );

  // --- Rincian per metode, dengan perkiraan settlement (FR-C12) -------------
  //
  // ⛔ Dipanggil, bukan disalin. `ambilPembayaran` sudah menegakkan tiga
  // aturan yang mudah menyimpang bila query-nya ditulis ulang di sini: hanya
  // payment `confirmed` (`spec-c:223`), order yang punya pembatal
  // dikeluarkan, dan `null` yang dibedakan dari `0` pada perkiraan MDR.
  // Rekapitulasi yang berbeda dari Laporan Pembayaran untuk periode yang sama
  // adalah persis bentuk perbedaan angka yang `spec-g:29` peringatkan.
  const {
    metode: pembayaran,
    totalPerkiraanMdr,
    totalPerkiraanSettlement,
  } = await ambilPembayaran(client, { from, to, outletId });

  const totalDiterima = pembayaran.reduce((s, m) => s + BigInt(m.totalDiterima), 0n);

  return {
    jumlahTransaksi: rekap.jumlahTransaksi,
    omzetKotor: rekap.omzetKotor.toString(),
    voidAmount: rekap.voidAmount.toString(),
    refundAmount: rekap.refundAmount.toString(),
    omzetBersih: rekap.omzetBersih.toString(),
    pajakTerkumpul: rekap.pajakTerkumpul.toString(),
    rataRataPerTransaksi: rekap.rataRataPerTransaksi.toString(),
    totalDiskonOrder: rekap.totalDiskonOrder.toString(),
    totalDiskonBaris: String(diskonBaris[0]?.total ?? '0'),
    totalServiceCharge: rekap.totalServiceCharge.toString(),
    totalPembulatan: rekap.totalPembulatan.toString(),
    pajak: pajak.map(
      (p): KelompokPajak => ({
        nama: p.nama,
        yurisdiksi: p.yurisdiksi,
        total: String(p.total),
      })
    ),
    pembayaran,
    totalDiterima: totalDiterima.toString(),
    /** ⛔ PERKIRAAN — AC FR-C12 kedua. Kata itu wajib ikut sampai ke layar. */
    totalPerkiraanMdr,
    totalPerkiraanSettlement,
  };
}

export type Rekap = Awaited<ReturnType<typeof ambilRekap>>;

export function createRecapReportHandlers(pool: Pool): Record<string, unknown> {
  return {
    async getRecapReport(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const q = req.query as { from?: string; to?: string; outlet_id?: string };
      const { from, to, outletId } = assertRentang(q);

      return withTenantTransaction(pool, tenantId, async (client) => {
        await assertUserVisible(client, actorId);
        // FK klien-suplai ke tabel ber-`tenant_id` (temuan F1): tanpa cek ini
        // laporan menjadi oracle keberadaan outlet tenant lain.
        if (outletId !== null) await assertOutletVisible(client, outletId);

        return { from, to, outletId, rekap: await ambilRekap(client, { from, to, outletId }) };
      });
    },
  };
}
