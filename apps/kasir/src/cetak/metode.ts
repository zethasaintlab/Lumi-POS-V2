/**
 * Nama metode pembayaran di STRUK.
 *
 * ⛔ SATU peta untuk cetakan pertama dan cetak ulang. `spec-b:145` menuntut
 * keduanya identik, dan dua peta nama yang menyimpang menghasilkan struk kedua
 * yang menyebut metode berbeda dari struk pertama untuk transaksi yang sama —
 * tepat bentuk perbedaan yang membuat struk tidak dapat dipakai membuktikan
 * apa pun.
 *
 * Daftarnya memuat metode yang perangkat ini TIDAK dapat hasilkan sendiri
 * (`qris_dynamic`, `other`): baris pembayaran dapat datang dari server, dan
 * nama yang hilang mencetak kode mentah di struk pelanggan.
 *
 * Nama sengaja PENDEK — struk 58 mm hanya 32 kolom, dan nama metode berbagi
 * baris dengan nominalnya.
 */
export const LABEL_METODE: Record<string, string> = {
  cash: 'Tunai',
  qris_dynamic: 'QRIS',
  qris_static: 'QRIS',
  card_edc: 'Kartu',
  other: 'Lainnya',
};

/** Kode yang tidak dikenal dicetak apa adanya, bukan dihilangkan. */
export function labelMetode(metode: string): string {
  return LABEL_METODE[metode] ?? metode;
}
