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
