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
import {
  kodeLaporanMetode,
  LABEL_METODE as LABEL_METODE_LAYAR,
} from '../../../../packages/domain/src/metode-tampilan.ts';

export const LABEL_METODE: Record<string, string> = {
  cash: 'Tunai',
  qris_dynamic: 'QRIS',
  qris_static: 'QRIS',
  card_edc: 'Kartu',
  other: 'Lainnya',
};

/**
 * Kode tak dikenal dicetak apa adanya. ⛔ "Transfer" tidak dieja di sini:
 * datang dari domain lewat `kodeLaporanMetode`; `other` tanpa provider tetap "Lainnya".
 */
export function labelMetode(metode: string, provider?: string | null): string {
  const kode = kodeLaporanMetode(metode, provider);
  if (kode === 'transfer') return LABEL_METODE_LAYAR.transfer;
  return LABEL_METODE[metode] ?? metode;
}
