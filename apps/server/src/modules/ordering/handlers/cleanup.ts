import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from '../../../db.ts';
import { withTenantTransaction } from '../../../db.ts';
import { getActorId, getTenantId } from '../../../tenant-context.ts';
import type { Hlc } from '../../../../../../packages/domain/src/hlc.ts';
import { isTransitionAllowed } from '../../../../../../packages/domain/src/order-state.ts';
import { assertUserVisible, assertBoleh } from '../../identity/index.ts';
import { reverseSaleMovements } from '../../inventory/index.ts';
import { recordAuditEvent } from '../../audit/index.ts';
import { HttpError } from '../../../http-error.ts';

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


/**
 * Menutup SATU keranjang dan membebaskan stok yang dikuncinya.
 *
 * ⛔ Diekstrak justru karena ada pemanggil KEDUA sekarang: kasir yang
 * membatalkan draf QRIS dinamis (FR-C3) harus dapat membebaskan stoknya
 * SEKETIKA, bukan menunggu pembersihan massal berumur 24 jam. Dua salinan
 * aturan "apa artinya meninggalkan sebuah order" akan menyimpang, dan yang
 * menyimpang meninggalkan stok terkunci atau audit yang tidak ditulis.
 *
 * Mengembalikan `null` bila transisinya tidak sah — dan itu diperiksa terhadap
 * state machine, bukan diasumsikan dari pemanggilnya.
 */
export async function tinggalkanOrder(
  client: PoolClient,
  {
    tenantId,
    actorId,
    order,
    alasanCatatan,
    hlc,
  }: {
    tenantId: string;
    actorId: string;
    order: BarisOrder;
    alasanCatatan: string | null;
    hlc: Hlc;
  }
): Promise<{ ditulis: number; totalDikembalikan: bigint } | null> {
  if (!isTransitionAllowed(order.status, 'abandoned')) return null;

  const hasil = await reverseSaleMovements(client, {
    tenantId,
    orderId: order.id,
    type: 'void',
    reasonCode: 'order_abandoned',
    note: alasanCatatan,
    createdBy: actorId,
    hlc: hlc.tick(),
  });

  // ⛔ Satu-satunya `UPDATE` pada tabel `order` di seluruh repo, dan ia sah:
  // invariant #2 melarang UPDATE pada transaksi SELESAI, dan keranjang yang
  // belum pernah dibayar bukan salah satunya. Transisi `open → abandoned` ada
  // di tabel transisi `spec-b:57-69`.
  await client.query(`UPDATE "order" SET status = 'abandoned' WHERE id = $1`, [order.id]);

  await recordAuditEvent(client, {
    id: randomUUID(),
    tenantId,
    outletId: order.outlet_id,
    deviceId: order.device_id,
    actorUserId: actorId,
    // Bukan tindakan yang disetujui orang lain — ia pembersihan.
    approverUserId: null,
    eventType: 'order.abandoned',
    entityType: 'order',
    entityId: order.id,
    before: { status: order.status, receiptNumber: order.receipt_number },
    after: { status: 'abandoned', stokDikembalikan: hasil.totalDikembalikan.toString() },
    reasonCode: 'order_abandoned',
    reasonNote: alasanCatatan,
    hlc: hlc.tick(),
  });

  return hasil;
}

export function createCleanupHandlers(pool: Pool, hlc: Hlc): Record<string, unknown> {
  return {

    /**
     * `POST /orders/{orderId}/abandon` — kasir membatalkan SATU draf.
     *
     * ## ⛔ Kenapa ia ada di samping pembersihan massal
     *
     * Jalur QRIS dinamis (FR-C3) menulis order ke server SEBELUM pelanggan
     * membayar. Pelanggan yang batal membayar meninggalkan order `open` yang
     * memegang stok — dan pembersihan massal baru menyentuhnya setelah 24 JAM,
     * lewat endpoint bertingkat manajer. Kasir yang membatalkan di depan
     * pelanggan tidak dapat menunggu keduanya.
     *
     * ## ⛔ `sale`, bukan `stock_adjust`
     *
     * Pembersihan massal membebaskan stok SELURUH outlet dalam satu permintaan
     * — itu tingkat manajer, dan benar. Membatalkan satu draf yang kasir itu
     * sendiri baru saja buat adalah bagian dari menjual, dan kasir memang
     * satu-satunya orang yang ada di konter.
     *
     * ## ⛔ Order yang SUDAH dibayar ditolak 409, bukan dibatalkan
     *
     * Pembatalan transaksi yang sudah lunas adalah void/refund, dengan kontrol
     * dan jejaknya sendiri. Membiarkan endpoint ini menyentuhnya berarti jalan
     * kedua untuk membatalkan penjualan — tanpa restock yang benar, tanpa
     * alasan daftar tertutup, dan tanpa baris pembatal.
     */
    async abandonOrder(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const { orderId } = req.params as { orderId: string };
      const body = (req.body ?? {}) as { reasonCode?: unknown };

      return withTenantTransaction(pool, tenantId, async (client) => {
        await assertUserVisible(client, actorId);
        await assertBoleh(client, actorId, 'sale', 'membatalkan draf pembayaran');

        // FK klien-suplai ke tabel ber-`tenant_id` (temuan F1): FK PostgreSQL
        // tidak tunduk RLS, jadi keberadaannya dibuktikan SELECT ini.
        //
        // `FOR UPDATE` menahan dua pembatalan bersamaan mengembalikan stok
        // yang sama dua kali — alasan yang sama dengan pembersihan massal.
        const { rows } = await client.query<BarisOrder>(
          `SELECT id, outlet_id, device_id, status, receipt_number
             FROM "order" WHERE id = $1 FOR UPDATE`,
          [orderId]
        );
        if (rows.length === 0) {
          throw new HttpError(404, 'ORDER_NOT_FOUND', `Order ${orderId} tidak ditemukan.`);
        }
        const order = rows[0];

        const hasil = await tinggalkanOrder(client, {
          tenantId,
          actorId,
          order,
          alasanCatatan:
            typeof body.reasonCode === 'string' && body.reasonCode.trim() !== ''
              ? body.reasonCode.trim()
              : null,
          hlc,
        });
        if (hasil === null) {
          throw new HttpError(
            409,
            'ORDER_NOT_ABANDONABLE',
            `Order ${orderId} berstatus ${order.status} dan tidak dapat ditinggalkan. ` +
              'Transaksi yang sudah dibayar dibatalkan lewat void atau refund.'
          );
        }

        return {
          orderId,
          status: 'abandoned',
          movementDitulis: hasil.ditulis,
          totalStokDikembalikan: hasil.totalDikembalikan.toString(),
        };
      });
    },

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
          const hasil = await tinggalkanOrder(client, {
            tenantId,
            actorId,
            order: o,
            alasanCatatan: `Keranjang tidak dibayar lebih dari ${JAM_KEDALUWARSA} jam.`,
            hlc,
          });
          // `null` = transisinya tidak sah. Kalau ia kelak dicabut, endpoint
          // ini berhenti — bukan diam-diam menulis status yang tidak sah.
          if (hasil === null) continue;
          movementDitulis += hasil.ditulis;
          totalDikembalikan += hasil.totalDikembalikan;

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
