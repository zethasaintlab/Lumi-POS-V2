import type { FastifyRequest } from 'fastify';
import type { Pool } from '../../../db.ts';
import { withTenantTransaction } from '../../../db.ts';
import { getActorId, getTenantId } from '../../../tenant-context.ts';
import { assertUserVisible, bolehkahAktor } from '../../identity/index.ts';
import { assertOutletVisible } from '../../tenancy/index.ts';
import { STATUS_PENJUALAN_LIST } from '../../../../../../packages/domain/src/posisi-penjualan.ts';
import { assertRentang } from './rentang.ts';
// ⛔ Aturan tampilan kuantitas dibagi dengan layar kasir — dua salinan akan
// menyimpang pada pemisah desimal, dan angka kuantitas yang berbeda antara
// struk dan laporan adalah perbedaan yang paling sulit dijelaskan.
import { tampilkanKuantitas } from '../../../../../../packages/domain/src/kuantitas.ts';

/**
 * `GET /reports/products` — FR-G1, BARANG yang keluar pada rentang tanggal
 * bisnis.
 *
 * ## ⛔ Ini bukan laporan uang, dan istilahnya sengaja berbeda
 *
 * Metriknya `kuantitas` dan `nilaiKotor` — **bukan "omzet"**. Omzet punya satu
 * definisi tunggal di `packages/domain/src/posisi-penjualan.ts` (FR-G3), dan
 * angka di sini TIDAK sama dengannya: ia mengagregasi `order_line`, tidak
 * mengurangkan refund, dan tidak pernah menyentuh `order.total`.
 *
 * `CLAUDE.md`: *"basis laporan per produk adalah `sebelum void & refund`, dan
 * itu bukan kelalaian: baris produk menyatakan barang apa yang keluar, dan
 * refund uang tidak selalu mengembalikan barang"*.
 *
 * ## Void diabaikan, refund TIDAK
 *
 * Pesanan yang dibatalkan tidak pernah menghasilkan barang keluar — ia
 * dikeluarkan lewat `NOT EXISTS` atas pembatalnya, aturan yang sama yang
 * dipakai `posisiPenjualan`. Pesanan yang direfund SUDAH menghasilkan barang
 * keluar; `lines: []` pada refund berarti uang kembali **tanpa** barang
 * kembali, jadi ia tetap dihitung.
 *
 * ## ⛔ Per VARIATION, bukan per produk
 *
 * `order_line` tidak punya `item_id` sama sekali — hanya `variation_id`
 * beserta snapshot `item_name` dan `variation_name`. Menambahkan id produk
 * menuntut join ke `item_variation` yang dimiliki modul **catalog**, dan
 * invariant #4 melarang modul ordering meng-query tabel milik modul lain.
 *
 * Nama yang dikembalikan adalah SNAPSHOT saat penjualan. Produk yang berganti
 * nama tetap dapat dijelaskan di laporan lama — itu justru gunanya snapshot.
 *
 * ## ⛔ Daftar status dari domain, bukan ditulis lagi di SQL
 *
 * `STATUS_PENJUALAN_LIST` diturunkan dari `STATUS_PENJUALAN` yang dipakai
 * `posisiPenjualan`. Dua daftar status akan menyimpang pada status berikutnya
 * yang ditambahkan, dan laporan produk akan menghitung barang dari pesanan
 * yang laporan penjualan anggap belum terjadi.
 *
 * ## Penjaga `satu-sumber-omzet` tetap berlaku
 *
 * `SUM(...)` di bawah beroperasi atas `order_line`; `"order"` hanya di-JOIN,
 * dan tabel utamanya `order_line`. Itu bukan siasat terhadap penjaganya — ini
 * memang bukan agregasi nilai order, dan itulah alasan hasilnya tidak boleh
 * disebut omzet.
 */

interface BarisDb {
  variation_id: string;
  item_name: string;
  variation_name: string;
  kuantitas: string;
  nilai_kotor: string;
  hpp: string;
  jumlah_baris: string;
  baris_tanpa_hpp: string;
}

/**
 * Kolom margin — ADA hanya bila pemanggilnya berhak (`spec-g:99`).
 *
 * ⛔ Kuncinya HILANG, bukan bernilai `null`. Kolom kosong di layar tetap
 * memberi tahu bahwa margin ADA dan tidak boleh dilihat, dan itu mengundang
 * pertanyaan yang tidak dapat dijawab kasirnya sendiri. Yang tidak berhak
 * tidak melihat kolomnya sama sekali.
 */
export interface MarginProduk {
  /** HPP total baris ini, rupiah utuh. STRING — uang tidak lewat JSON number. */
  hpp: string;
  /** `nilaiKotor - hpp`. Boleh NEGATIF: produk yang dijual rugi itu nyata. */
  margin: string;
  /**
   * Margin sebagai persen dari nilai kotor, satu digit desimal.
   *
   * ⛔ `null` bila nilai kotornya NOL — bukan 0%. Produk yang seluruhnya
   * terjual dengan diskon 100% tidak punya margin persen yang berarti, dan
   * "0%" untuknya adalah pernyataan yang salah.
   */
  marginPersen: number | null;
  /**
   * ⛔ Berapa baris penjualan produk ini yang HPP-nya nol saat terjual.
   *
   * Nol dapat berarti dua hal yang sangat berbeda: merchant belum mengisi
   * HPP, atau produknya memang tidak berbiaya. Keduanya menghasilkan margin
   * 100% yang terlihat meyakinkan — dan yang pertama adalah angka karangan.
   * Layar menyebutkannya; laporan yang tidak menyebutkannya akan dipercaya.
   */
  barisTanpaHpp: number;
  jumlahBaris: number;
}


/** Data laporan produk. Diekspor untuk dipakai `GET /reports/export`. */
export async function ambilProduk(
  client: import('../../../db.ts').PoolClient,
  {
    from,
    to,
    outletId,
    sertakanMargin = false,
  }: {
    from: string;
    to: string;
    outletId: string | null;
    /**
     * ⛔ Diputuskan PEMANGGIL lewat `assertBoleh(view_margin)`, bukan di sini.
     * Fungsi ini juga dipakai `GET /reports/export`, dan penjaga peran yang
     * disalin ke dua tempat akan menyimpang di tempat ketiga.
     */
    sertakanMargin?: boolean;
  }
) {
        const { rows } = await client.query<BarisDb>(
    `SELECT ol.variation_id,
            MIN(ol.item_name)      AS item_name,
            MIN(ol.variation_name) AS variation_name,
            SUM(ol.quantity)       AS kuantitas,
            -- ⛔ Dibagi 1000: quantity adalah INTEGER x1000 (konvensi
            -- repo). Tanpa pembagian ini nilainya 1000x terlalu besar,
            -- dan tidak ada satu pun error yang menandainya.
            SUM(ol.quantity * ol.unit_price / 1000) AS nilai_kotor,
            -- ⛔ cost_at_sale adalah SNAPSHOT saat penjualan, bukan JOIN ke
            -- item_variation.cost. spec-a:227 menuntutnya persis begitu:
            -- merchant yang harga belinya naik pekan depan tidak boleh
            -- mendapati margin bulan lalu ikut berubah. JOIN ke katalog juga
            -- akan melanggar invariant #4: tabel itu milik modul catalog.
            SUM(ol.quantity * ol.cost_at_sale / 1000) AS hpp,
            COUNT(*)                                  AS jumlah_baris,
            COUNT(*) FILTER (WHERE ol.cost_at_sale = 0) AS baris_tanpa_hpp
       FROM order_line ol
       JOIN "order" o ON o.id = ol.order_id
      WHERE o.business_date BETWEEN $1 AND $2
        AND ($3::text IS NULL OR o.outlet_id = $3)
        AND o.status = ANY($4::text[])
        -- Pesanan yang PUNYA pembatal dikeluarkan. Aturan yang sama
        -- dengan posisiPenjualan; refund TIDAK dikeluarkan.
        AND NOT EXISTS (
          SELECT 1 FROM "order" v WHERE v.voided_by_order_id = o.id
        )
      GROUP BY ol.variation_id
      -- Urutan dijamin di sini DAN di JS: kuantitas menurun, lalu nama.
      ORDER BY SUM(ol.quantity) DESC, MIN(ol.item_name) ASC`,
    [from, to, outletId, STATUS_PENJUALAN_LIST]
  );

  return rows.map((r) => {
    const dasar = {
      variationId: r.variation_id,
      itemName: r.item_name,
      variationName: r.variation_name,
      kuantitas: String(r.kuantitas),
      kuantitasTampil: tampilkanKuantitas(String(r.kuantitas)),
      nilaiKotor: String(r.nilai_kotor),
    };
    if (!sertakanMargin) return dasar;
    return { ...dasar, ...hitungMargin(r) };
  });
}

/**
 * Margin satu baris produk.
 *
 * ⛔ Seluruh aritmetikanya `bigint`. Uang tidak pernah menyentuh float
 * (`CLAUDE.md`), dan `nilaiKotor` di sini rutin melewati 2^53 untuk merchant
 * yang melaporkan setahun penuh.
 */
function hitungMargin(r: BarisDb): MarginProduk {
  const nilaiKotor = BigInt(r.nilai_kotor ?? 0);
  const hpp = BigInt(r.hpp ?? 0);
  const margin = nilaiKotor - hpp;
  return {
    hpp: hpp.toString(),
    margin: margin.toString(),
    // ⛔ Perkalian SEBELUM pembagian, dan pembagiannya `bigint`. Membagi lebih
    // dulu memotong ke nol untuk setiap margin yang lebih kecil dari nilai
    // kotornya — yaitu semuanya.
    marginPersen: nilaiKotor === 0n ? null : Number((margin * 1000n) / nilaiKotor) / 10,
    barisTanpaHpp: Number(r.baris_tanpa_hpp ?? 0),
    jumlahBaris: Number(r.jumlah_baris ?? 0),
  };
}

export { tampilkanKuantitas };

export function createProductReportHandlers(pool: Pool): Record<string, unknown> {
  return {
    async getProductReport(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const q = req.query as { from?: string; to?: string; outlet_id?: string };
      const { from, to, outletId } = assertRentang(q);

      return withTenantTransaction(pool, tenantId, async (client) => {
        await assertUserVisible(client, actorId);
        if (outletId !== null) await assertOutletVisible(client, outletId);

        // ⛔ Hak margin TIDAK menolak permintaannya — ia hanya menentukan
        // kolomnya ikut atau tidak. `spec-g:99` menulis *"kolom margin tidak
        // muncul untuk peran Kasir"*, bukan "laporan produk tidak dapat
        // dibuka kasir": kasir MEMANG membaca laporan produk (`spec-g:86`
        // menandainya tersedia di perangkat). 403 di sini akan menutup
        // seluruh laporan demi satu kolom.
        const sertakanMargin = await bolehkahAktor(client, actorId, 'view_margin');

        return {
          from,
          to,
          outletId,
          // ⛔ DINYATAKAN di respons, bukan disimpulkan layar dari ada/
          // tidaknya kunci `margin` pada baris pertama. Laporan yang KOSONG
          // tidak punya baris pertama, dan layar yang menyimpulkan dari sana
          // akan menyembunyikan kolomnya untuk owner — lalu owner
          // menyimpulkan haknya dicabut.
          margin: sertakanMargin,
          produk: await ambilProduk(client, { from, to, outletId, sertakanMargin }),
        };
      });
    },
  };
}
