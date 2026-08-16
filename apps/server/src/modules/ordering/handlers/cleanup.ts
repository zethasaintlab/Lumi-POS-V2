import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { Pool } from '../../../db.ts';
import { withTenantTransaction } from '../../../db.ts';
import { getActorId, getTenantId } from '../../../tenant-context.ts';
import type { Hlc } from '../../../../../../packages/domain/src/hlc.ts';
import { isTransitionAllowed } from '../../../../../../packages/domain/src/order-state.ts';
import { assertUserVisible, assertBoleh } from '../../identity/index.ts';
import { reverseSaleMovements } from '../../inventory/index.ts';
import { recordAuditEvent } from '../../audit/index.ts';

/**
 * `POST /orders/cleanup-abandoned` — menutup keranjang mati dan MEMBEBASKAN
 * stok yang dikuncinya.
 *
 * ## ⛔ Masalah yang diselesaikannya
 *
 * Movement `sale` ditulis saat order DIBUAT, bukan saat dibayar — bacaan yang
 * benar atas `spec-e:101` (barang memang sudah keluar dari rak). Tapi order
 * yang dibuat lalu ditinggalkan memegang stok itu **selamanya**: terukur di
 * `PENYELIDIKAN-b12-b13.md` §2.1 sebagai −2000 yang tidak akan pernah kembali.
 *
 * Ia lebih buruk daripada terdengar, karena keputusan B-02 menyembunyikan
 * keranjang `open` dari daftar transaksi: stok berkurang karena order yang
 * **tidak dapat dilihat siapa pun** di back-office.
 *
 * ## ⛔ Ambangnya `recorded_at`, BUKAN `occurred_at`
 *
 * `occurred_at` datang dari jam PERANGKAT — jam ketiga, yang `HANDOFF.md`
 * catat dapat menyimpang dan mundur. Order dari perangkat yang jamnya salah
 * tiga hari ke belakang akan langsung dianggap ditinggalkan pada detik ia
 * tiba, sementara kasirnya masih mengetik pesanannya.
 *
 * `recorded_at` adalah jam database, dan ia satu-satunya jam yang tidak dapat
 * dibohongi klien.
 *
 * ## ⛔ Tipe movementnya `void`, dan itu kompromi yang DINYATAKAN
 *
 * `FR-E2` memberi delapan tipe, dan tidak satu pun berarti "ditinggalkan".
 * Menambahkannya menuntut migrasi yang mengubah CHECK constraint di server
 * **dan** di skema SQLite lokal — dua tempat, dan salah satunya ada di
 * perangkat yang sedang dipakai orang.
 *
 * Yang dipakai: `void` dengan `reason_code = 'order_abandoned'`. Barisnya
 * karena itu tetap dapat dibedakan dari void sungguhan lewat satu kolom, dan
 * tidak ada laporan yang tercemar — B-21 menghitung `audit_event`, dan
 * `voidAmount` di laporan kasir dihitung dari order pembatal, yang tidak
 * dibuat di sini.
 *
 * ## ⛔ Ini BUKAN mekanisme yang `spec-b` sebut
 *
 * `spec-b:47` menuliskan transisi `open → abandoned` sebagai *"otomatis saat
 * shift ditutup, dengan konfirmasi"*. Mekanisme itu **tidak dapat dibangun
 * hari ini**: tutup shift tidak pernah sampai ke server (`PENYELIDIKAN-b02-b04.md`
 * §3), jadi tidak ada peristiwa yang dapat memicunya.
 *
 * Endpoint berbasis umur adalah penggantinya sampai jalur tutup shift ada.
 * Dicatat sebagai penyimpangan yang disadari, bukan sebagai pembacaan spec.
 */

/**
 * Umur minimum sebuah keranjang sebelum dianggap ditinggalkan.
 *
 * ⛔ Konstanta, bukan parameter. Nilai yang dapat dikirim klien mengundang
 * `olderThanHours=0`, dan itu membatalkan setiap pesanan yang sedang diketik
 * kasir di seluruh outlet — dalam satu permintaan, tanpa cara membatalkannya.
 */
export const JAM_KEDALUWARSA = 24;

interface BarisOrder {
  id: string;
  outlet_id: string;
  device_id: string;
  status: string;
  receipt_number: string;
}

export function createCleanupHandlers(pool: Pool, hlc: Hlc): Record<string, unknown> {
  return {
    async cleanupAbandonedOrders(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);

      return withTenantTransaction(pool, tenantId, async (client) => {
        await assertUserVisible(client, actorId);
        // Efeknya membebaskan stok, dan itu tingkat manajer. Kasir tidak
        // menjalankan pembersihan massal; akuntan tidak melakukan mutasi.
        await assertBoleh(client, actorId, 'stock_adjust', 'membersihkan keranjang terbengkalai');

        // ⛔ `FOR UPDATE` menahan dua pemanggilan bersamaan mengembalikan stok
        // yang sama dua kali. Tanpa itu keduanya membaca `open`, keduanya
        // membalik movement-nya, dan stok naik dua kali lipat dari yang
        // pernah dikurangi.
        const { rows } = await client.query<BarisOrder>(
          `SELECT id, outlet_id, device_id, status, receipt_number
             FROM "order"
            WHERE status = 'open'
              AND recorded_at < now() - ($1 || ' hours')::interval
            ORDER BY recorded_at
            FOR UPDATE`,
          [String(JAM_KEDALUWARSA)]
        );

        const dibersihkan: string[] = [];
        let movementDitulis = 0;
        let totalDikembalikan = 0n;

        for (const o of rows) {
          // Diperiksa terhadap state machine, bukan diasumsikan dari WHERE.
          // Kalau transisinya kelak dicabut, endpoint ini berhenti — bukan
          // diam-diam menulis status yang tidak sah.
          if (!isTransitionAllowed(o.status, 'abandoned')) continue;

          const hasil = await reverseSaleMovements(client, {
            tenantId,
            orderId: o.id,
            type: 'void',
            reasonCode: 'order_abandoned',
            note: `Keranjang tidak dibayar lebih dari ${JAM_KEDALUWARSA} jam.`,
            createdBy: actorId,
            hlc: hlc.tick(),
          });
          movementDitulis += hasil.ditulis;
          totalDikembalikan += hasil.totalDikembalikan;

          // ⛔ Satu-satunya `UPDATE` pada tabel `order` di seluruh repo, dan
          // ia sah: invariant #2 melarang UPDATE pada transaksi SELESAI, dan
          // keranjang yang belum pernah dibayar bukan salah satunya. Transisi
          // `open → abandoned` ada di tabel transisi `spec-b:57-69`.
          await client.query(`UPDATE "order" SET status = 'abandoned' WHERE id = $1`, [o.id]);

          await recordAuditEvent(client, {
            id: randomUUID(),
            tenantId,
            outletId: o.outlet_id,
            deviceId: o.device_id,
            actorUserId: actorId,
            // Bukan tindakan yang disetujui orang lain — ia pembersihan.
            approverUserId: null,
            eventType: 'order.abandoned',
            entityType: 'order',
            entityId: o.id,
            before: { status: 'open', receiptNumber: o.receipt_number },
            after: { status: 'abandoned', stokDikembalikan: hasil.totalDikembalikan.toString() },
            reasonCode: 'order_abandoned',
            reasonNote: null,
            hlc: hlc.tick(),
          });

          dibersihkan.push(o.id);
        }

        return {
          jamKedaluwarsa: JAM_KEDALUWARSA,
          jumlahDibersihkan: dibersihkan.length,
          movementDitulis,
          // Kuantitas ×1000, STRING — sama seperti uang.
          totalStokDikembalikan: totalDikembalikan.toString(),
          orderIds: dibersihkan,
        };
      });
    },
  };
}
