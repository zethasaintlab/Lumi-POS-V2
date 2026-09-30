import type { DbLokal } from '../../../../packages/sync-client/src/ports.ts';
import type { KonfigPerangkat } from '../../../../packages/sync-client/src/perangkat.ts';
import { enqueue } from '../../../../packages/sync-client/src/enqueue.ts';
import {
  EVENT_BARIS_DIKURANGI,
  ringkasPenguranganBaris,
} from '../../../../packages/domain/src/keranjang-baris.ts';
import { simpanHlc } from '../lokal/hlc.ts';
import { simpanKeranjang } from './keranjang-simpan.ts';
import { satuanKeranjang, type BarisKeranjang, type Keranjang } from './keranjang.ts';
import type { Sesi } from '../identitas/login.ts';

/**
 * Edit Item yang MENURUNKAN qty (atau menghapus baris) — dengan jejak audit.
 * Keputusan user 28 September 2026 (issue #76, Q2): kalau Batalkan tercatat
 * tapi menghapus baris satu per satu tidak, kecurangannya cuma pindah cara.
 *
 * ## ⛔ SATU transaksi lokal
 *
 * `audit_event` + outbox + `keranjang_lokal` hasil edit. Perangkat yang mati di
 * tengah meninggalkan "keranjang lama, tanpa jejak" atau "keranjang baru,
 * dengan jejak" — TIDAK PERNAH keranjang berkurang tanpa jejak. Alasan yang
 * sama dengan `batalkanKeranjang`.
 *
 * ## ⛔ Yang dicatat: penurunan, bukan perubahan
 *
 * Kenaikan qty dan perubahan modifier tanpa penurunan tidak menghasilkan
 * peristiwa. Penggabungan `gantiModifier` bukan penghapusan (qty total tidak
 * turun): keputusannya diambil dari qty DRAF baris yang diedit, bukan dari
 * bentuk keranjang hasil akhir.
 *
 * ## ⛔ Harga DIBERIKAN oleh baris SEBELUM diedit
 *
 * `satuanKeranjang(baris)` — angka yang kasir lihat (modifier ikut). Nilai
 * berkurang dihitung `ringkasPenguranganBaris` dalam `bigint`.
 */

export type HasilKurangBaris =
  | { status: 'tercatat'; id: string }
  | { status: 'tanpa_pengurangan' }
  | { status: 'shift_tidak_terbuka' };

export async function kurangiBarisKeranjang({
  db,
  konfig,
  sesi,
  shiftId,
  baris,
  qtySesudahMilli,
  keranjangBaru,
  waktu,
  idBaru,
  hlc,
}: {
  db: DbLokal;
  konfig: KonfigPerangkat;
  sesi: Sesi;
  shiftId: string;
  /** Baris SEBELUM diedit (qty dan modifier lama). */
  baris: BarisKeranjang;
  /** Qty draf hasil edit; 0 = baris dihapus. */
  qtySesudahMilli: number;
  /** Keranjang hasil akhir yang ditulis ke `keranjang_lokal` di transaksi yang sama. */
  keranjangBaru: Keranjang;
  waktu: () => Date;
  idBaru: () => string;
  hlc: () => bigint;
}): Promise<HasilKurangBaris> {
  const ringkas = ringkasPenguranganBaris({
    variationId: baris.variationId,
    itemName: baris.itemName,
    variationName: baris.variationName,
    quantityBeforeMilli: baris.quantityMilli,
    quantityAfterMilli: qtySesudahMilli,
    unitPrice: satuanKeranjang(baris),
  });
  if (ringkas === null) return { status: 'tanpa_pengurangan' };

  const shift = (
    await db.getAll<{ outlet_id: string; device_id: string; status: string }>(
      `SELECT outlet_id, device_id, status FROM cash_drawer_shift WHERE id = ?`,
      [shiftId]
    )
  )[0];
  if (!shift || shift.status !== 'open') return { status: 'shift_tidak_terbuka' };

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
        EVENT_BARIS_DIKURANGI,
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
      entityType: 'cart_line_reduced',
      // `entity_id` adalah SHIFT: rutenya bersarang di bawahnya.
      entityId: shiftId,
      operation: 'create',
      payload: {
        id,
        variationId: ringkas.variation_id,
        itemName: ringkas.item_name,
        variationName: ringkas.variation_name,
        quantityBeforeMilli: ringkas.quantity_before_milli,
        quantityAfterMilli: ringkas.quantity_after_milli,
        unitPrice: ringkas.unit_price,
        reducedValue: ringkas.reduced_value,
        hlc: hlcValue.toString(),
        occurredAt,
      },
      idempotencyKey: id,
      createdAt: occurredAt,
      actorId: sesi.userId,
    });

    // ⛔ Keranjang hasil edit DI DALAM transaksi yang sama. Keranjang kosong
    // menghapus barisnya (`simpanKeranjang`).
    await simpanKeranjang(tx, shiftId, keranjangBaru, waktu);
  });

  return { status: 'tercatat', id };
}
