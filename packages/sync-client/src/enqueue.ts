import type { DbLokal } from './ports.ts';

/**
 * Jenis entitas yang BENAR-BENAR dapat dikirim hari ini.
 *
 * spec-h:46 menyebut lima (`order · shift · stock_movement · audit_event ·
 * cash_movement`), tapi server hanya mengekspos endpoint untuk empat jalur:
 * `openShift`, `createOrder`, `cancelOrder`, `createPayment`.
 *
 * Ketiga yang tidak ada di sini bukan kelalaian: `stock_movement`,
 * `audit_event`, dan `cash_movement` ditulis SERVER-SIDE di dalam transaksi
 * order/cancel (invariant #1), jadi ia ikut naik bersama order-nya dan tidak
 * pernah butuh entri outbox sendiri. `cash_movement` yang berdiri sendiri
 * (kas masuk/keluar, no-sale) memang belum punya endpoint -- itu pekerjaan
 * Modul D, dan sampai ia ada, item seperti itu TIDAK BOLEH masuk antrean.
 */
export const ENTITY_TYPES = [
  'shift',
  'order',
  'order_cancel',
  'payment',
  'sold_out',
  'no_sale',
  // FR-D5. Kas masuk/keluar dicatat di perangkat, offline — owner yang
  // mengambil uang dari laci untuk membayar pemasok tidak menunggu jaringan.
  'cash_movement',
  // FR-D2. Percobaan hitungan kas dicatat di perangkat saat tutup kas, dan
  // tutup kas berjalan tanpa jaringan. Jejaknya harus sampai meski shift-nya
  // sudah ditutup berjam-jam sebelumnya.
  'count_attempt',
  // K-15. Pilihan profil printer perangkat dicatat saat kasir memilihnya, dan
  // K-15 bertanda ✅ offline (`IA:65`) — outlet yang printernya diganti saat
  // internet mati tidak menunggu jaringan untuk mencetak dengan benar.
  'peripheral',
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export interface ItemOutbox {
  id: string;
  entityType: string;
  entityId: string;
  operation: string;
  payload: unknown;
  idempotencyKey: string;
  createdAt: string;
  /** `outbox_local.id` yang harus terkirim lebih dulu. */
  dependsOn?: string | null;
  /**
   * Kasir yang membuat item ini, DIBEKUKAN sekarang.
   *
   * ⛔ Bukan dibaca saat pengiriman. Antrean dapat terkuras berjam-jam
   * kemudian, mungkin setelah pergantian shift: memakai "siapa yang sedang
   * masuk" akan mencatat penjualan Sari atas nama Budi, dan audit server
   * percaya begitu saja.
   */
  actorId?: string | null;
  /**
   * Manajer yang menyetujui operasi ini, bila ada.
   *
   * ⛔ Dibekukan bersama itemnya, alasan yang sama dengan `actorId` — dan
   * ketiadaannya adalah cacat yang PERNAH TERJADI: setiap refund offline
   * dijawab `400 MISSING_APPROVER_ID` dan berhenti permanen di antrean,
   * sementara kasir sudah mengembalikan uangnya.
   */
  approverId?: string | null;
}

/**
 * Menulis satu item ke antrean, DI DALAM transaksi pemanggil.
 *
 * `tx` adalah transaksi yang sudah dibuka pemanggil -- fungsi ini tidak
 * membuka miliknya sendiri, dan itu bukan kelalaian. spec-h:39 menuntut item
 * outbox ditulis dalam transaksi yang SAMA dengan mutasinya; membuka
 * transaksi terpisah menciptakan jendela di mana penjualan tercatat tapi
 * antreannya belum, dan penjualan itu tidak akan pernah naik.
 *
 * Bentuknya sengaja cerminan `apps/server/src/modules/sync/index.ts`, yang
 * menolak `pool` dan hanya menerima `client` transaksi pemanggil.
 */
export async function enqueue(tx: DbLokal, item: ItemOutbox): Promise<void> {
  if (!(ENTITY_TYPES as readonly string[]).includes(item.entityType)) {
    throw new Error(
      `entity_type '${item.entityType}' tidak punya endpoint dan tidak boleh masuk antrean. ` +
        `Yang didukung: ${ENTITY_TYPES.join(', ')}.`
    );
  }

  // Dituntut ADA di sini, bukan di-generate saat pengiriman.
  //
  // Relay mengembalikan item yang tertinggal berstatus `sending` menjadi
  // `pending` setelah aplikasi mati mendadak. Itu aman hanya karena key-nya
  // sudah ditulis saat item dibuat: retry memakai key yang sama dan server
  // mengenalinya. Kalau key lahir saat pengiriman, pemulihan itu justru
  // MENGHASILKAN duplikat -- satu penjualan tercatat dua kali.
  if (!item.idempotencyKey) {
    throw new Error('idempotencyKey wajib diisi saat item dibuat, bukan saat dikirim.');
  }

  await tx.execute(
    `INSERT INTO outbox_local
       (id, entity_type, entity_id, operation, payload, idempotency_key,
        status, attempts, last_error, last_attempt_at, created_at, depends_on, actor_id,
        approver_id)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, NULL, NULL, ?, ?, ?, ?)`,
    [
      item.id,
      item.entityType,
      item.entityId,
      item.operation,
      JSON.stringify(item.payload),
      item.idempotencyKey,
      item.createdAt,
      item.dependsOn ?? null,
      item.actorId ?? null,
      item.approverId ?? null,
    ]
  );
}
