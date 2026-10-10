import type { DbLokal } from '../../../../packages/sync-client/src/ports.ts';
import type { KonfigPerangkat } from '../../../../packages/sync-client/src/perangkat.ts';
import { enqueue } from '../../../../packages/sync-client/src/enqueue.ts';
import {
  EVENT_KERANJANG_DIBATALKAN,
  ringkasKeranjangBatal,
} from '../../../../packages/domain/src/keranjang-batal.ts';
import { simpanHlc } from '../lokal/hlc.ts';
import { bersihkanKeranjangDi } from './keranjang-simpan.ts';
import type { Sesi } from '../identitas/login.ts';

/**
 * Batalkan keranjang K-03 — dengan jejak audit. Keputusan user 28 September
 * 2026 (issue #76).
 *
 * ## ⛔ Kenapa ada jejaknya
 *
 * Pembatalan keranjang sesudah barang di-scan adalah pola kecurangan kasir:
 * pelanggan membayar tunai, keranjang dibatalkan, uangnya tidak tercatat.
 * Keranjang bukan `order` (FR-B1: `DRAFT` yang ditinggalkan tidak menghasilkan
 * baris order), jadi yang dicatat adalah PERISTIWA-nya — aktor, jumlah baris,
 * kuantitas, dan total yang tampil di layar.
 *
 * ## ⛔ SATU transaksi lokal
 *
 * `audit_event` + outbox + hapus `keranjang_lokal`. Perangkat yang mati di
 * tengah meninggalkan "keranjang utuh, tanpa jejak" atau "keranjang kosong,
 * dengan jejak" — TIDAK PERNAH keranjang kosong tanpa jejak. Penghapusan di
 * luar transaksi membuka persis jendela itu.
 *
 * ## ⛔ `total` DIBERIKAN, tidak dihitung di sini
 *
 * Angka yang sama dengan `hitungKeranjang(...).totals.total` yang kasir lihat.
 * Aritmetika kedua (harga × qty tanpa pajak/diskon) akan menyimpang tanpa
 * error, dan jejak yang totalnya tidak cocok dengan layar tidak dapat dipakai
 * membuktikan apa pun.
 *
 * ## Offline penuh
 *
 * Tidak butuh jaringan; naik lewat outbox (`cart_cleared` →
 * `POST /shifts/{id}/cart-cleared`), idempotensi dengan id audit.
 */

export type HasilBatalKeranjang =
  | { status: 'tercatat'; id: string }
  | { status: 'keranjang_kosong' }
  | { status: 'shift_tidak_terbuka' };

export async function batalkanKeranjang({
  db,
  konfig,
  sesi,
  shiftId,
  keranjang,
  total,
  waktu,
  idBaru,
  hlc,
  hapus = bersihkanKeranjangDi,
}: {
  db: DbLokal;
  konfig: KonfigPerangkat;
  sesi: Sesi;
  shiftId: string;
  keranjang: { baris: readonly { quantityMilli: number }[] };
  /** `hitungKeranjang(...).totals.total` — angka yang tampil di layar. */
  total: bigint;
  waktu: () => Date;
  idBaru: () => string;
  hlc: () => bigint;
  /**
   * Apa yang dihapus DI DALAM transaksi jejak. Bawaan: keranjang berjalan
   * (`keranjang_lokal`). Pesanan tahan yang dibuang memberi penghapusan
   * barisnya sendiri -- jejak yang SAMA, satu transaksi, tanpa menyentuh
   * keranjang berjalan milik pesanan lain.
   */
  hapus?: (tx: DbLokal) => Promise<void>;
}): Promise<HasilBatalKeranjang> {
  // Keranjang kosong tidak menghasilkan peristiwa: tidak ada yang dibatalkan.
  if (keranjang.baris.length === 0) return { status: 'keranjang_kosong' };

  const shift = (
    await db.getAll<{ outlet_id: string; device_id: string; status: string }>(
      `SELECT outlet_id, device_id, status FROM cash_drawer_shift WHERE id = ?`,
      [shiftId]
    )
  )[0];
  if (!shift || shift.status !== 'open') return { status: 'shift_tidak_terbuka' };

  const ringkas = ringkasKeranjangBatal(keranjang, total);
  const id = idBaru();
  const occurredAt = waktu().toISOString();
  const hlcValue = hlc();

  await db.transaction(async (tx) => {
    await tx.execute(
      `INSERT INTO audit_event
         (id, tenant_id, outlet_id, device_id, actor_user_id, approver_user_id,
          event_type, entity_type, entity_id, after, reason_code, reason_note, occurred_at, hlc)
       VALUES (?, ?, ?, ?, ?, NULL, ?, 'cash_drawer_shift', ?, ?, NULL, NULL, ?, ?)`,
      [
        id,
        konfig.tenantId,
        shift.outlet_id,
        shift.device_id,
        sesi.userId,
        // DI-BIND, bukan inline: ejaan diperiksa terhadap kosakata tertutup.
        EVENT_KERANJANG_DIBATALKAN,
        shiftId,
        JSON.stringify(ringkas),
        occurredAt,
        Number(hlcValue),
      ]
    );

    // ⛔ Keadaan HLC di DALAM transaksi, alasan yang sama dengan `bukaLaci`.
    await simpanHlc(tx, hlcValue);

    await enqueue(tx, {
      id: idBaru(),
      entityType: 'cart_cleared',
      // `entity_id` adalah SHIFT: rutenya bersarang di bawahnya.
      entityId: shiftId,
      operation: 'create',
      payload: {
        id,
        lineCount: ringkas.line_count,
        quantityMilli: ringkas.quantity_milli,
        total: ringkas.total,
        hlc: hlcValue.toString(),
        occurredAt,
      },
      idempotencyKey: id,
      createdAt: occurredAt,
      actorId: sesi.userId,
    });

    // ⛔ Penghapusan keranjang DI DALAM transaksi yang sama.
    await hapus(tx);
  });

  return { status: 'tercatat', id };
}
