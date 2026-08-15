import type { FastifyRequest } from 'fastify';
import type { Pool } from '../../../db.ts';
import { withTenantTransaction } from '../../../db.ts';
import { getActorId, getTenantId } from '../../../tenant-context.ts';
import { assertUserVisible } from '../../identity/index.ts';
import { assertOutletVisible } from '../../tenancy/index.ts';
import {
  posisiPenjualan,
  type OrderUntukPosisi,
  type PosisiPenjualan,
} from '../../../../../../packages/domain/src/posisi-penjualan.ts';
import { assertRentang } from './rentang.ts';

/**
 * `GET /reports/cashiers` — FR-G1, posisi penjualan PER KASIR.
 *
 * ## ⛔ Setiap kasir dihitung `posisiPenjualan()`, bukan SUM sendiri
 *
 * Ini laporan UANG, jadi ia tunduk pada definisi tunggal omzet (FR-G3). Yang
 * dilakukan handler: mengambil baris, MENGELOMPOKKAN di JavaScript, lalu
 * memanggil fungsi domain sekali per kasir. Tidak ada agregasi nilai order di
 * SQL sama sekali.
 *
 * Sifat yang dijaga: **jumlah seluruh kasir = angka laporan global**. Kalau
 * tidak, dua laporan di aplikasi yang sama akan menjawab pertanyaan yang sama
 * dengan angka berbeda.
 *
 * ## ⛔ Pembatal dimasukkan ke kelompok pemilik order ASLINYA
 *
 * Ini bagian yang paling mudah salah, dan salahnya diam.
 *
 * Order pembatal punya `created_by` sendiri — orang yang MENEKAN tombol void,
 * yang sering bukan kasir yang menjual. Kalau pengelompokan dilakukan lurus
 * per `created_by`, kelompok kasir penjual tidak memuat pembatalnya, `dibatalkan`
 * miliknya kosong, dan **penjualan yang sudah dibatalkan tetap masuk omzetnya**.
 *
 * Karena itu setiap kelompok berisi: order milik kasir itu, DITAMBAH setiap
 * pembatal yang menunjuk salah satu ordernya — siapa pun yang membuat pembatal
 * itu.
 *
 * Konsekuensinya disengaja: `voidAmount` melekat pada kasir yang
 * **penjualannya** dibatalkan, bukan pada yang menekan tombolnya. Manajer yang
 * membatalkan sepuluh transaksi kasir lain tidak muncul dengan void sepuluh —
 * dan jumlah seluruh kasir tetap sama dengan angka global. Penyalahgunaan void
 * dilacak laporan exception FR-G5 lewat `audit_event`, yang memang menyimpan
 * aktornya.
 */

interface BarisOrder {
  id: string;
  status: string;
  total: string;
  tax_amount: string;
  voided_by_order_id: string | null;
  created_by: string;
}

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

export function createCashierReportHandlers(pool: Pool): Record<string, unknown> {
  return {
    async getCashierReport(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const q = req.query as { from?: string; to?: string; outlet_id?: string };
      const { from, to, outletId } = assertRentang(q);

      return withTenantTransaction(pool, tenantId, async (client) => {
        await assertUserVisible(client, actorId);
        if (outletId !== null) await assertOutletVisible(client, outletId);

        // Hanya MENGAMBIL BARIS — lihat catatan kepala berkas.
        const { rows: orders } = await client.query<BarisOrder>(
          `SELECT id, status, total, tax_amount, voided_by_order_id, created_by
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

        // Nama kasir dibaca terpisah; `order.created_by` adalah id.
        const { rows: pengguna } = await client.query<{ id: string; name: string }>(
          `SELECT id, name FROM "user"`
        );
        const nama = new Map(pengguna.map((u) => [u.id, u.name]));

        const keOrder = (o: BarisOrder): OrderUntukPosisi => ({
          id: o.id,
          status: o.status,
          total: o.total,
          taxAmount: o.tax_amount,
          voidedByOrderId: o.voided_by_order_id,
        });

        // ⛔ Pembatal dipetakan ke order yang dibatalkannya, supaya ia dapat
        // dimasukkan ke kelompok pemilik order ASLI — bukan pemilik pembatal.
        const pembatalUntuk = new Map<string, BarisOrder[]>();
        for (const o of orders) {
          if (o.voided_by_order_id === null) continue;
          const daftar = pembatalUntuk.get(o.voided_by_order_id) ?? [];
          daftar.push(o);
          pembatalUntuk.set(o.voided_by_order_id, daftar);
        }

        const perKasir = new Map<string, BarisOrder[]>();
        for (const o of orders) {
          // Pembatal TIDAK masuk lewat `created_by`-nya sendiri; ia hanya
          // ikut kelompok order yang dibatalkannya, di bawah.
          if (o.voided_by_order_id !== null) continue;
          const daftar = perKasir.get(o.created_by) ?? [];
          daftar.push(o);
          perKasir.set(o.created_by, daftar);
        }

        const kasir = [...perKasir.entries()].map(([userId, miliknya]) => {
          const idMiliknya = new Set(miliknya.map((o) => o.id));
          const pembatalnya = miliknya.flatMap((o) => pembatalUntuk.get(o.id) ?? []);

          const posisi = posisiPenjualan({
            orders: [...miliknya, ...pembatalnya].map(keOrder),
            refunds: refunds
              .filter((r) => idMiliknya.has(r.order_id))
              .map((r) => ({ orderId: r.order_id, amount: r.amount })),
          });

          return {
            userId,
            // Kasir yang barisnya sudah dihapus mustahil (`"user"` tidak
            // pernah di-DELETE), tapi RLS dapat menyembunyikannya bila
            // datanya cacat — id ditampilkan apa adanya alih-alih kosong.
            name: nama.get(userId) ?? userId,
            penjualan: keJson(posisi),
          };
        });

        // Urutan deterministik: omzet bersih menurun, lalu nama. Dibandingkan
        // sebagai `bigint` — perbandingan string menempatkan "9" di atas "10".
        kasir.sort((a, b) => {
          const oa = BigInt(a.penjualan.omzetBersih);
          const ob = BigInt(b.penjualan.omzetBersih);
          if (oa !== ob) return ob > oa ? 1 : -1;
          return a.name.localeCompare(b.name, 'id');
        });

        return { from, to, outletId, kasir };
      });
    },
  };
}
