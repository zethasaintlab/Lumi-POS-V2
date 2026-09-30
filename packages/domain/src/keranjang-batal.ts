/**
 * Jejak audit pembatalan keranjang K-03 (`cart_cleared`).
 *
 * Keputusan user 28 September 2026 (issue #76): pembatalan keranjang sesudah
 * barang di-scan adalah pola kecurangan kasir — pelanggan membayar tunai,
 * keranjang dibatalkan, uangnya tidak tercatat. Keranjang bukan `order`, jadi
 * yang dicatat adalah PERISTIWA-nya: berapa baris, berapa kuantitas, berapa
 * total yang tampil di layar.
 *
 * Murni: tanpa I/O. Dipakai perangkat (menulis `audit_event` lokal + outbox)
 * dan dibaca server sebagai `after`.
 */

export const EVENT_KERANJANG_DIBATALKAN = 'cart_cleared';

export interface RingkasanKeranjangBatal {
  line_count: number;
  quantity_milli: number;
  /** Rupiah utuh sebagai STRING — presisi di atas 2^53 tidak lewat number. */
  total: string;
}

/**
 * ⛔ `total` DIBERIKAN pemanggil (`hitungKeranjang(...).totals.total`, angka
 * yang kasir lihat), bukan dihitung di sini — aritmetika kedua untuk
 * pertanyaan yang sama menyimpang tanpa error.
 */
export function ringkasKeranjangBatal(
  k: { baris: readonly { quantityMilli: number }[] },
  total: bigint
): RingkasanKeranjangBatal {
  return {
    line_count: k.baris.length,
    quantity_milli: k.baris.reduce((jumlah, b) => jumlah + b.quantityMilli, 0),
    total: total.toString(),
  };
}
