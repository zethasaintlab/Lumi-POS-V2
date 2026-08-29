import type { FastifyRequest } from 'fastify';
import type { Pool } from '../../../db.ts';
import { withTenantTransaction } from '../../../db.ts';
import { getActorId, getTenantId } from '../../../tenant-context.ts';
import { assertUserVisible } from '../../identity/index.ts';
import { assertRentang } from './rentang.ts';
import { assertOutletVisible } from '../../tenancy/index.ts';
import {
  posisiPenjualan,
  type PosisiPenjualan,
} from '../../../../../../packages/domain/src/posisi-penjualan.ts';

/**
 * `GET /reports/sales` — FR-G3/FR-G7, posisi penjualan untuk rentang tanggal
 * bisnis.
 *
 * ## Kenapa di modul `ordering`
 *
 * Invariant #4: kepemilikan tabel menentukan modul. `order` dan `refund` milik
 * `ordering` (`modules/README.md` § 15). Laporan yang hidup di modul lain akan
 * meng-query tabel milik modul ini — persis yang aturan itu larang.
 *
 * Yang di luar modul ini dipanggil lewat `index.ts` publiknya:
 * `assertUserVisible` (identity) dan `assertOutletVisible` (tenancy).
 *
 * ## ⛔ Rentang memakai `business_date`, BUKAN `occurred_at`
 *
 * `order.business_date` dihitung SEKALI saat penjualan, dari zona waktu
 * outletnya, dan sejak itu hanya DIBACA (`CLAUDE.md`: *"Tanggal bisnis dibaca
 * dari `order.business_date`, tidak dihitung ulang dari `occurred_at` —
 * menghitungnya ulang menjadikan laporan tempat kedua yang memutuskan hal yang
 * sama"*).
 *
 * Dua akibat kalau dilanggar, dan keduanya diam:
 *
 * 1. Tanggal bisnis berakhir saat **tutup shift** (default 04:00), bukan
 *    tengah malam. Penjualan pukul 01:00 milik tanggal bisnis SEBELUMNYA;
 *    memfilter `occurred_at` memindahkannya ke hari yang salah.
 * 2. `occurred_at` adalah `timestamptz` — satu instan. Outlet di WITA dan WIT
 *    punya batas hari yang berbeda, dan laporan lintas-outlet yang memotong
 *    pada instan UTC tidak akan pernah cocok dengan tutup kas di outlet mana
 *    pun.
 *
 * ## ⛔ Angkanya dihitung `posisiPenjualan()`, tidak diagregasi SQL
 *
 * `tests/domain/satu-sumber-omzet.test.js` menolak `SUM(...)` atas tabel
 * `"order"` di berkas mana pun selain `posisi-penjualan.ts` — dan itu bukan
 * sekadar formalitas: aplikasi kasir memanggil fungsi yang sama di atas SQLite
 * lokal, dan AC FR-G4 menuntut *"angka laporan lokal cocok dengan laporan
 * server"*. Dua aritmetika berbeda tidak akan pernah cocok.
 *
 * Query di bawah karena itu hanya MENGAMBIL BARIS. Tidak ada `SUM`, tidak ada
 * `GROUP BY`, tidak ada keputusan tentang apa yang dianggap batal.
 *
 * ## ⛔ Order pembatal ikut terbawa rentang
 *
 * Order pembatal MENYALIN `business_date` order aslinya (`cancel.ts`
 * `INSERT_VOID_ORDER_SQL` men-`SELECT business_date FROM "order" WHERE id =
 * …`). Rentang yang memuat order asli karena itu selalu memuat pembatalnya,
 * dan deteksi "sudah dibatalkan" tidak pernah meleset di batas rentang.
 *
 * Refund diambil lewat `business_date` ORDER-nya — sama persis dengan
 * `apps/kasir/src/laporan/harian.ts`. Menggantinya dengan tanggal refund
 * sendiri akan membuat kedua laporan berbeda untuk hari yang sama.
 */

interface BarisOrder {
  id: string;
  status: string;
  total: string;
  tax_amount: string;
  voided_by_order_id: string | null;
}

/**
 * ⛔ Uang dikirim sebagai STRING, bukan `number`.
 *
 * `PosisiPenjualan` memakai `bigint`, dan `JSON.stringify` melempar untuk
 * `bigint`. Mengubahnya ke `Number` akan membuang presisi di atas 2⁵³ —
 * omzet bulanan merchant dengan 20 outlet sampai ke sana, dan kehilangannya
 * tidak menghasilkan error apa pun.
 *
 * Pola yang sama dengan `TaxRate.rate`, dan dengan alasan yang sama.
 */
function keJson(p: PosisiPenjualan) {
  return {
    omzetKotor: p.omzetKotor.toString(),
    voidAmount: p.voidAmount.toString(),
    refundAmount: p.refundAmount.toString(),
    omzetBersih: p.omzetBersih.toString(),
    pajakTerkumpul: p.pajakTerkumpul.toString(),
    jumlahTransaksi: p.jumlahTransaksi,
    rataRataPerTransaksi: p.rataRataPerTransaksi.toString(),
  };
}

/**
 * Data laporan penjualan. Diekspor supaya `GET /reports/export` memakai
 * perhitungan yang SAMA — dua jalur yang menghitung sendiri akan menyimpang,
 * dan CSV yang berbeda dari layar adalah bentuk terburuk perbedaan itu:
 * merchant membawanya ke akuntannya.
 */
export async function ambilPenjualan(
  client: import('../../../db.ts').PoolClient,
  { from, to, outletId }: { from: string; to: string; outletId: string | null }
) {
  const { rows: orders } = await client.query<BarisOrder>(
    `SELECT id, status, total, tax_amount, voided_by_order_id
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
  return keJson(
    posisiPenjualan({
      orders: orders.map((o) => ({
        id: o.id,
        status: o.status,
        total: o.total,
        taxAmount: o.tax_amount,
        voidedByOrderId: o.voided_by_order_id,
      })),
      refunds: refunds.map((r) => ({ orderId: r.order_id, amount: r.amount })),
    })
  );
}

export interface PenjualanOutlet {
  outletId: string;
  outletNama: string | null;
  omzetKotor: string;
  voidAmount: string;
  refundAmount: string;
  omzetBersih: string;
  pajakTerkumpul: string;
  jumlahTransaksi: number;
  rataRataPerTransaksi: string;
}

/**
 * Omzet dipecah PER OUTLET — AC FR-G6 keempat, "ringkasan agregat dengan
 * rincian per outlet dapat dibuka".
 *
 * ## ⛔ Dua query, bukan satu per outlet
 *
 * Merchant dapat punya dua puluh outlet (`PRD`), dan memanggil
 * `ambilPenjualan` sekali per outlet berarti empat puluh query untuk satu
 * layar. Barisnya diambil SEKALI dengan `outlet_id` ikut, lalu dikelompokkan
 * di JS.
 *
 * ## ⛔ Yang menghitung tetap `posisiPenjualan`, per kelompok
 *
 * Bukan `GROUP BY` dengan `SUM` di SQL. Definisi omzet hidup di satu tempat
 * (`packages/domain/src/posisi-penjualan.ts`), dan ada penjaga yang menolak
 * `SUM(...)` atas tabel `"order"` di berkas mana pun selain itu. Rincian per
 * outlet yang menjumlahkan sendiri akan menyimpang dari totalnya tepat pada
 * order yang dibatalkan — dan owner yang menjumlahkan barisnya lalu mendapat
 * angka lain dari yang tertera di atas tidak punya cara memutuskan mana yang
 * benar.
 *
 * ## ⛔ Refund menempel pada outlet ORDER-nya
 *
 * `refund` tidak punya `outlet_id`; ia diambil lewat JOIN ke ordernya. Refund
 * yang jatuh ke outlet yang salah membuat satu cabang terlihat merugi dan
 * cabang lain terlihat untung, keduanya sebesar nilai yang sama.
 *
 * ## ⛔ Pengelompokan ini bergantung pada order PEMBATAL berbagi outlet
 *
 * `posisiPenjualan` menyimpulkan sebuah order dibatalkan dari ADANYA pembatal
 * yang menunjuknya **di dalam himpunan yang diberikan**. Pengelompokan per
 * outlet karena itu hanya benar selama pembatal berada di outlet yang sama
 * dengan order aslinya — dan itu benar hari ini karena `cancel.ts` menyalin
 * `outlet_id` dari baris asli (`INSERT … SELECT`), bukan menerimanya dari
 * klien. Kalau kelak pembatalan lintas-outlet menjadi mungkin, rincian di sini
 * akan diam-diam menghitung order batal sebagai omzet pada satu cabang dan
 * mengurangkannya di cabang lain.
 */
export async function ambilPenjualanPerOutlet(
  client: import('../../../db.ts').PoolClient,
  { from, to }: { from: string; to: string }
): Promise<PenjualanOutlet[]> {
  const { rows: orders } = await client.query<BarisOrder & { outlet_id: string }>(
    `SELECT id, status, total, tax_amount, voided_by_order_id, outlet_id
       FROM "order"
      WHERE business_date BETWEEN $1 AND $2`,
    [from, to]
  );
  const { rows: refunds } = await client.query<{
    order_id: string;
    amount: string;
    outlet_id: string;
  }>(
    `SELECT r.order_id, r.amount, o.outlet_id
       FROM refund r
       JOIN "order" o ON o.id = r.order_id
      WHERE o.business_date BETWEEN $1 AND $2`,
    [from, to]
  );
  const { rows: outlets } = await client.query<{ id: string; name: string }>(
    `SELECT id, name FROM outlet`
  );
  const nama = new Map(outlets.map((o) => [o.id, o.name]));

  // ⛔ Outlet yang PUNYA order saja. Outlet tanpa satu pun transaksi hari itu
  // sengaja tidak muncul sebagai baris nol: dua puluh baris "Rp 0" mengubur
  // dua yang berisi, dan layar 390px hanya memuat beberapa baris. Owner yang
  // mencari cabang yang tidak muncul menemukannya lewat penyeleksi outlet.
  const perOutlet = new Map<string, { orders: typeof orders; refunds: typeof refunds }>();
  for (const o of orders) {
    const k = perOutlet.get(o.outlet_id) ?? { orders: [], refunds: [] };
    k.orders.push(o);
    perOutlet.set(o.outlet_id, k);
  }
  for (const r of refunds) {
    const k = perOutlet.get(r.outlet_id) ?? { orders: [], refunds: [] };
    k.refunds.push(r);
    perOutlet.set(r.outlet_id, k);
  }

  const hasil = [...perOutlet.entries()].map(([outletId, isi]) => ({
    outletId,
    outletNama: nama.get(outletId) ?? null,
    ...keJson(
      posisiPenjualan({
        orders: isi.orders.map((o) => ({
          id: o.id,
          status: o.status,
          total: o.total,
          taxAmount: o.tax_amount,
          voidedByOrderId: o.voided_by_order_id,
        })),
        refunds: isi.refunds.map((r) => ({ orderId: r.order_id, amount: r.amount })),
      })
    ),
  }));

  // Terbesar lebih dulu — yang owner cari di layar 390px adalah cabang yang
  // paling banyak bergerak, bukan yang namanya paling awal secara abjad.
  hasil.sort((a, b) => (BigInt(a.omzetBersih) < BigInt(b.omzetBersih) ? 1 : -1));
  return hasil;
}

export function createReportHandlers(pool: Pool): Record<string, unknown> {
  return {
    async getSalesReport(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const q = req.query as { from?: string; to?: string; outlet_id?: string };
      // Validasi rentang dibagi dengan `/reports/products` (`rentang.ts`) —
      // dua salinan akan menyimpang tepat pada jebakan `2026-02-31`.
      const { from, to, outletId } = assertRentang(q);

      return withTenantTransaction(pool, tenantId, async (client) => {
        await assertUserVisible(client, actorId);
        // FK klien-suplai ke tabel ber-`tenant_id` (temuan F1). Di sini idnya
        // tidak masuk INSERT mana pun, tapi tanpa cek ini laporan menjadi
        // oracle keberadaan outlet tenant lain: id asing menjawab 200 dengan
        // nol, id milik sendiri menjawab 200 dengan angka.
        if (outletId !== null) await assertOutletVisible(client, outletId);

        return { from, to, outletId, penjualan: await ambilPenjualan(client, { from, to, outletId }) };
      });
    },
  };
}
