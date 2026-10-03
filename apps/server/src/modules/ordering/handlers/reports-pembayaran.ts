import type { FastifyRequest } from 'fastify';
import type { Pool } from '../../../db.ts';
import { withTenantTransaction } from '../../../db.ts';
import { getActorId, getTenantId } from '../../../tenant-context.ts';
import { assertUserVisible } from '../../identity/index.ts';
import { assertOutletVisible } from '../../tenancy/index.ts';
import { assertRentang } from './rentang.ts';
import { metodePunyaPerkiraanMdr } from '../../../../../../packages/domain/src/mdr.ts';
import { kodeLaporanMetode } from '../../../../../../packages/domain/src/metode-tampilan.ts';

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
 * ## ⛔ Transfer ditampilkan sebagai "Transfer" (keputusan user P1)
 *
 * Transfer disimpan sebagai `method = 'other'` + `provider = 'bank_transfer'`.
 * Query mengelompokkan menurut `(method, provider)` lalu MELIPAT di sini lewat
 * `kodeLaporanMetode` — satu-satunya tempat aturan lipat itu ditulis (SQL
 * tidak menulis `CASE` padanannya). Field `method` respons adalah KODE
 * LAPORAN: `transfer` untuk other+bank_transfer, `other` untuk sisanya. Uang
 * bank yang terlipat ke "Lainnya" tersembunyi dari pemilik justru di layar
 * tempat ia mencocokkannya dengan mutasi rekening. Ekspor CSV, rekapitulasi
 * FR-C13, dan ringkasan HP memanggil fungsi ini dan mewarisinya.
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
  provider: string | null;
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
            p.provider,
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
      GROUP BY p.method, p.provider`,
    [from, to, outletId]
  );

  // ⛔ Lipat `(method, provider)` → kode laporan DI SINI, lalu jumlahkan baris
  // yang kodenya sama. Bigint sepanjang jalan: `pg` mengembalikan `bigint`
  // sebagai string, dan mengubahnya ke `number` membuang presisi di atas 2^53.
  const terlipat = new Map<
    string,
    { asal: string; jumlah: number; total: bigint; mdr: bigint; tanpaMdr: number }
  >();
  for (const r of rows) {
    const kode = kodeLaporanMetode(r.method, r.provider);
    const kini = terlipat.get(kode) ?? { asal: r.method, jumlah: 0, total: 0n, mdr: 0n, tanpaMdr: 0 };
    kini.jumlah += Number(r.jumlah);
    kini.total += BigInt(r.total);
    kini.mdr += BigInt(r.mdr ?? '0');
    kini.tanpaMdr += Number(r.tanpa_mdr);
    terlipat.set(kode, kini);
  }

  // Urutan tetap: SUM DESC, kode ASC (dulu `ORDER BY` di SQL; kini di TS karena
  // pengelompokan akhir baru terjadi setelah dilipat).
  const urut = [...terlipat].sort(([ka, a], [kb, b]) =>
    a.total === b.total ? (ka < kb ? -1 : ka > kb ? 1 : 0) : a.total > b.total ? -1 : 1
  );

  const metode = urut.map(([kode, v]) => {
    const diterima = v.total;
    const tanpaPerkiraan = v.tanpaMdr;
    // ⛔ Diturunkan dari BARIS yang tersimpan, bukan dari metodenya saja.
    // Baris yang ditulis sebelum FR-C12 punya `mdr_estimated = NULL` meski
    // metodenya QRIS; menjumlahkannya sebagai nol akan melaporkan "tidak ada
    // potongan" untuk transaksi yang sebenarnya dipotong. `asal` (kolom
    // `method` sebenarnya) yang ditanyakan, bukan kode laporan.
    const punyaPerkiraan = metodePunyaPerkiraanMdr(v.asal) && tanpaPerkiraan < v.jumlah;
    const mdr = punyaPerkiraan ? v.mdr : null;
    return {
      method: kode,
      jumlahTransaksi: v.jumlah,
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
