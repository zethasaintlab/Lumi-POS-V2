/**
 * Jejak audit penurunan qty / penghapusan baris keranjang K-03
 * (`cart_line_reduced`). Keputusan user 28 September 2026 (issue #76, Q2).
 *
 * Kalau Batalkan (`cart_cleared`) tercatat tapi menghapus baris satu per satu
 * tidak, kecurangannya cuma pindah cara. Satu jenis untuk keduanya: baris
 * yang dihapus adalah penurunan ke `quantity_after_milli = 0`.
 *
 * Murni: tanpa I/O. Dipakai perangkat (`audit_event` lokal + outbox) dan
 * dibaca server sebagai `after`.
 */

export const EVENT_BARIS_DIKURANGI = 'cart_line_reduced';

export interface RingkasanBarisDikurangi {
  variation_id: string;
  item_name: string;
  variation_name: string;
  /** ×1000. */
  quantity_before_milli: number;
  quantity_after_milli: number;
  /** Rupiah utuh sebagai STRING — presisi di atas 2^53 tidak lewat number. */
  unit_price: string;
  /** `unit_price × (sebelum − sesudah) / 1000`, string. */
  reduced_value: string;
}

/**
 * `null` = tidak ada penurunan, jadi tidak ada peristiwa (kenaikan qty dan
 * perubahan modifier tanpa penurunan tidak dicatat).
 *
 * ⛔ `unitPrice` DIBERIKAN pemanggil (`satuanKeranjang` baris SEBELUM diedit,
 * harga yang kasir lihat), bukan dihitung di sini — aritmetika kedua
 * menyimpang tanpa error. Pembagian `bigint` memotong, sama dengan
 * `subtotalKeranjang`.
 */
export function ringkasPenguranganBaris(i: {
  variationId: string;
  itemName: string;
  variationName: string;
  quantityBeforeMilli: number;
  quantityAfterMilli: number;
  unitPrice: bigint;
}): RingkasanBarisDikurangi | null {
  if (!Number.isSafeInteger(i.quantityBeforeMilli) || i.quantityBeforeMilli < 1) {
    throw new RangeError('quantityBeforeMilli harus bilangan bulat >= 1');
  }
  if (!Number.isSafeInteger(i.quantityAfterMilli) || i.quantityAfterMilli < 0) {
    throw new RangeError('quantityAfterMilli harus bilangan bulat >= 0');
  }
  if (i.unitPrice < 0n) throw new RangeError('unitPrice tidak boleh negatif');
  if (i.quantityAfterMilli >= i.quantityBeforeMilli) return null;
  return {
    variation_id: i.variationId,
    item_name: i.itemName,
    variation_name: i.variationName,
    quantity_before_milli: i.quantityBeforeMilli,
    quantity_after_milli: i.quantityAfterMilli,
    unit_price: i.unitPrice.toString(),
    reduced_value: ((i.unitPrice * BigInt(i.quantityBeforeMilli - i.quantityAfterMilli)) / 1000n).toString(),
  };
}
