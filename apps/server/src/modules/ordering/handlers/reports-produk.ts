import type { FastifyRequest } from 'fastify';
import type { Pool } from '../../../db.ts';
import { withTenantTransaction } from '../../../db.ts';
import { getActorId, getTenantId } from '../../../tenant-context.ts';
import { assertUserVisible } from '../../identity/index.ts';
import { assertOutletVisible } from '../../tenancy/index.ts';
import { STATUS_PENJUALAN_LIST } from '../../../../../../packages/domain/src/posisi-penjualan.ts';
import { assertRentang } from './rentang.ts';

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
}

/**
 * `2000` → `"2"`, `500` → `"0,5"`.
 *
 * ⛔ Dihitung dari STRING lewat `bigint`, bukan `Number(x) / 1000`. Kuantitas
 * adalah `bigint` di database, dan pembagian float akan menghasilkan
 * `0.30000000000000004` untuk nilai yang seharusnya `0,3`.
 *
 * Koma sebagai pemisah desimal — format Indonesia (`CLAUDE.md`).
 */
export function tampilkanKuantitas(skala: string): string {
  let n: bigint;
  try {
    n = BigInt(String(skala).trim());
  } catch {
    return '—';
  }
  const negatif = n < 0n;
  const abs = negatif ? -n : n;
  const utuh = abs / 1000n;
  const sisa = (abs % 1000n).toString().padStart(3, '0').replace(/0+$/, '');
  const teks = sisa.length > 0 ? `${utuh},${sisa}` : utuh.toString();
  return negatif ? `−${teks}` : teks;
}

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

        const { rows } = await client.query<BarisDb>(
          `SELECT ol.variation_id,
                  MIN(ol.item_name)      AS item_name,
                  MIN(ol.variation_name) AS variation_name,
                  SUM(ol.quantity)       AS kuantitas,
                  -- ⛔ Dibagi 1000: quantity adalah INTEGER x1000 (konvensi
                  -- repo). Tanpa pembagian ini nilainya 1000x terlalu besar,
                  -- dan tidak ada satu pun error yang menandainya.
                  SUM(ol.quantity * ol.unit_price / 1000) AS nilai_kotor
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

        return {
          from,
          to,
          outletId,
          produk: rows.map((r) => ({
            variationId: r.variation_id,
            itemName: r.item_name,
            variationName: r.variation_name,
            // ⛔ STRING. `pg` mengembalikan `bigint` sebagai string, dan
            // mengubahnya ke `number` membuang presisi di atas 2^53 — sama
            // seperti uang di `/reports/sales`.
            kuantitas: String(r.kuantitas),
            kuantitasTampil: tampilkanKuantitas(String(r.kuantitas)),
            nilaiKotor: String(r.nilai_kotor),
          })),
        };
      });
    },
  };
}
