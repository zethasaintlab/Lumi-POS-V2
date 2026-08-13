import { createHlc, type Hlc } from '../../../../packages/domain/src/hlc.ts';
import type { DbLokal } from '../../../../packages/sync-client/src/ports.ts';

/**
 * HLC perangkat — keadaannya bertahan melewati restart.
 *
 * ## ⛔ Lubang yang ditutup berkas ini
 *
 * I10 (monotonisitas HLC per perangkat) dijaga harness DST sejak F2, tapi
 * jalur penjualan sungguhan memakai `Date.now()` apa adanya sampai sekarang.
 * Jam perangkat yang mundur — NTP menyesuaikan, pengguna mengubah zona,
 * baterai RTC habis — menghasilkan dua order yang HLC-nya tidak berurutan,
 * dan urutan kausal di server jadi salah **tanpa satu pun error**.
 *
 * `createHlc` sudah menangani jam mundur (counter naik, physical tidak
 * turun). Yang belum ada adalah INGATANNYA: instance yang lahir ulang setiap
 * boot memulai dari nol, dan setiap order berikutnya ber-HLC lebih kecil
 * daripada yang sudah tersimpan.
 *
 * ## Kenapa penyimpanannya harus di transaksi PENJUALAN
 *
 * Kalau `hlc_state` ditulis di luar transaksi yang menulis order, ada jendela
 * di antara keduanya. Perangkat yang mati di jendela itu memuat nilai LAMA
 * saat boot, dan tick berikutnya dapat menghasilkan HLC yang **sudah dipakai**
 * order yang sudah ter-commit.
 *
 * Dua order dengan HLC sama adalah pelanggaran I10 yang tidak menghasilkan
 * error apa pun — ia hanya membuat "mana yang lebih dulu" tidak dapat dijawab,
 * di tempat yang paling membutuhkannya (void, refund, rekonsiliasi).
 *
 * Karena itu `simpanHlc` menerima `tx`, bukan `db`: ia dipanggil DI DALAM
 * transaksi pemanggil, sejajar dengan `enqueue` di packages/sync-client.
 */

/**
 * Membuat HLC yang melanjutkan dari keadaan tersimpan.
 *
 * @param sekarang jam dinding, di-inject (prasyarat DST).
 */
export async function muatHlc(db: DbLokal, sekarang: () => number): Promise<Hlc> {
  const baris = await db.getAll<{ hlc_teks: unknown; hlc_state: unknown }>(
    `SELECT hlc_teks, hlc_state FROM device_config WHERE id = 1`
  );
  return createHlc({ now: sekarang }, awalYangAman(baris[0], sekarang));
}

/**
 * Nilai awal, dengan penanganan keadaan rusak.
 *
 * Baris yang disunting tangan atau migrasi yang setengah jalan dapat
 * meninggalkan `hlc_state` yang tidak dapat diurai. Dua jalan keluar yang
 * salah:
 *
 *   - melempar → aplikasi tidak dapat dibuka sama sekali, dan kasir tidak
 *     dapat berjualan karena satu kolom bookkeeping;
 *   - jatuh ke nol → HLC mundur diam-diam, tepat yang berkas ini cegah.
 *
 * Yang dipilih: jatuh ke JAM SEKARANG dalam bentuk terkemas. Ia hampir pasti
 * lebih besar daripada nilai lama mana pun, karena physical HLC adalah
 * milidetik epoch.
 */
function awalYangAman(
  baris: { hlc_teks?: unknown; hlc_state?: unknown } | undefined,
  sekarang: () => number
): bigint {
  const teks = keBigIntAman(baris?.hlc_teks);
  if (teks !== null && teks > 0n) return teks;

  // ⛔ Perangkat LAMA: nilainya hanya ada di kolom INTEGER, dan sudah melewati
  // double sebelum sampai ke sini — presisinya hilang di atas 2^53.
  //
  // Menolaknya (yang versi pertama berkas ini lakukan) berarti jatuh ke jam
  // dinding, dan jam yang sedang mundur membuat HLC TURUN setelah restart.
  // Itu persis pelanggaran yang berkas ini ada untuk mencegah, dan ia
  // ditemukan dengan menjalankan aplikasi — bukan lewat test.
  //
  // Yang dilakukan: pakai nilainya, lalu MAJUKAN satu milidetik fisik penuh.
  // Kehilangan presisi double pada nilai sebesar ini paling banyak beberapa
  // puluh satuan counter; satu langkah physical melampauinya dengan jauh, dan
  // HLC yang melompat sedikit ke depan tidak merusak apa pun — yang merusak
  // hanya HLC yang mundur.
  // ⛔ Tipenya `bigint`, `number`, ATAU string — dan itu diukur, bukan
  // diasumsikan. `@powersync/web` mengembalikan kolom INTEGER yang besar
  // sebagai **bigint**; versi pertama fungsi ini hanya memeriksa `number`,
  // jadi cabang ini TIDAK PERNAH diambil dan perangkat lama tetap jatuh ke
  // jam dinding. Ketahuan dengan mencetak `typeof` dari database sungguhan.
  const lama = baris?.hlc_state;
  const lamaBig = keBigIntAman(lama);
  if (lamaBig !== null && lamaBig > 0n) {
    // Dimajukan satu milidetik fisik penuh. Nilai yang sempat melewati double
    // kehilangan beberapa satuan counter; satu langkah physical melampauinya
    // dengan jauh. HLC yang melompat sedikit ke depan tidak merusak apa pun —
    // yang merusak hanya HLC yang mundur.
    return ((lamaBig >> COUNTER_BITS) + 1n) << COUNTER_BITS;
  }

  return BigInt(sekarang()) << COUNTER_BITS;
}

/** Sama dengan `COUNTER_BITS` di packages/domain/src/hlc.ts. */
const COUNTER_BITS = 16n;

/** Menerima ketiga bentuk yang benar-benar keluar dari driver SQLite. */
function keBigIntAman(nilai: unknown): bigint | null {
  if (typeof nilai === 'bigint') return nilai;
  if (typeof nilai === 'number' && Number.isFinite(nilai)) return BigInt(Math.trunc(nilai));
  if (typeof nilai === 'string' && /^\d+$/.test(nilai)) return BigInt(nilai);
  return null;
}

/**
 * Menyimpan keadaan HLC, DI DALAM transaksi pemanggil.
 *
 * ⛔ TEKS, bukan angka. HLC adalah bilangan 57-bit yang melebihi presisi
 * double; SQLite menyimpan angka sebesar itu sebagai `REAL` dan
 * membulatkannya diam-diam, jadi nilai yang dimuat kembali tidak sama dengan
 * yang ditulis. Alasan yang sama membuat `hlc` dikirim sebagai string di
 * payload REST.
 */
export async function simpanHlc(tx: DbLokal, nilai: bigint): Promise<void> {
  // Ditulis ke `hlc_teks` (TEXT), BUKAN `hlc_state` (INTEGER). Kolom INTEGER
  // mengembalikannya sebagai `number` yang sudah kehilangan presisi — lihat
  // komentar di `db/local/001-initial.sql`.
  await tx.execute(`UPDATE device_config SET hlc_teks = ? WHERE id = 1`, [nilai.toString()]);
}
