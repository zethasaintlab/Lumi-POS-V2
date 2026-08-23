/**
 * FR-F8 — waktu ganda dan deteksi manipulasi jam. `spec-f:337`.
 *
 * *"Jam perangkat kasir dapat dimanipulasi untuk menanggalkan transaksi ke
 * shift lain dan menyembunyikan pola."*
 *
 * ## ⛔ Yang dibandingkan JAM SEKARANG, bukan `occurred_at`
 *
 * `spec-f:346` menyatakannya langsung: transaksi ber-`occurred_at` 1,5 jam
 * lebih tua daripada `recorded_at` adalah **wajar** — itu durasi offline, dan
 * seluruh produk ini dibangun supaya durasi itu ada. Menandainya sebagai
 * anomali berarti menandai setiap penjualan offline, yaitu justru penjualan
 * yang paling penting.
 *
 * Yang menandakan jam yang dimanipulasi adalah selisih antara **jam perangkat
 * saat ia mengirim** dan jam server saat menerimanya. Keduanya "sekarang"
 * menurut masing-masing, jadi selisihnya tidak dapat dijelaskan oleh apa pun
 * kecuali jam yang berbeda.
 *
 * ## ⛔ Ambangnya 5 menit, dan arahnya DUA
 *
 * `spec-f:354`. Jam yang MAJU sama berbahayanya dengan yang mundur: transaksi
 * yang ditanggalkan ke depan mendarat di shift berikutnya, dan yang mundur
 * mendarat di shift sebelumnya — keduanya menyembunyikan pola dari orang yang
 * membaca satu shift.
 */

/** `spec-f:354`. Detik. */
export const AMBANG_SKEW_DETIK = 300;

export interface Skew {
  /** Positif = jam perangkat MAJU terhadap server. */
  detik: number;
  menyimpang: boolean;
}

/**
 * Selisih jam perangkat terhadap jam server.
 *
 * ⛔ Menerima milidetik epoch, bukan `Date`. Fungsi domain tidak menyentuh jam
 * mana pun — kedua sisinya diserahkan pemanggil, dan yang server pakai adalah
 * jam DATABASE (aturan `CLAUDE.md`: "waktu selalu dari jam database, tidak
 * pernah `new Date()` di Node"). Perbandingan yang salah satu sisinya jam
 * proses Node akan menandai anomali karena dua mesin, bukan karena
 * manipulasi.
 */
export function hitungSkew(perangkatMs: number, serverMs: number): Skew {
  if (!Number.isFinite(perangkatMs) || !Number.isFinite(serverMs)) {
    throw new TypeError('Kedua jam harus angka milidetik epoch.');
  }
  const detik = Math.round((perangkatMs - serverMs) / 1000);
  return { detik, menyimpang: Math.abs(detik) > AMBANG_SKEW_DETIK };
}

/**
 * Menguraikan jam perangkat dari header, dengan `null` untuk apa pun yang
 * tidak sah.
 *
 * ⛔ Header yang HILANG bukan anomali. Klien versi N-1 tidak mengirimnya, dan
 * menandai seluruh armada lama sebagai jam termanipulasi membuat laporannya
 * tidak dapat dibaca siapa pun (`ARCH` — versi lama hidup minimal 12 bulan).
 *
 * ⛔ Header yang CACAT juga bukan anomali, dan itu keputusan yang berbeda:
 * bentuk yang tidak dapat diurai tidak memberi tahu apa pun tentang jamnya.
 * Menandainya berarti melaporkan tebakan.
 */
export function uraikanJamPerangkat(nilai: unknown): number | null {
  if (typeof nilai !== 'string' || nilai.trim() === '') return null;
  const ms = Date.parse(nilai);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Apakah selisih ini layak dicatat SEKARANG, mengingat kapan terakhir dicatat.
 *
 * ⛔ Dibatasi satu per perangkat per jam. Perangkat yang jamnya meleset 10
 * menit akan mengirim puluhan permintaan sehari, dan satu `audit_event` per
 * permintaan mengubur seluruh audit trail di bawah satu perangkat yang salah
 * setel — audit yang tidak dapat dibaca adalah audit yang tidak ada.
 *
 * ⛔ Diturunkan dari `audit_event` yang sudah ada, bukan dari kolom hitungan
 * di `device`. Pola yang sama dengan ambang no-sale (`CLAUDE.md`): kolom
 * hitungan adalah angka kedua yang harus dijaga sepakat dengan jejaknya, dan
 * yang menyimpang di antaranya tidak dapat diputuskan mana yang benar.
 */
export const JEDA_CATAT_SKEW_DETIK = 3600;

export function layakDicatat(terakhirDicatatMs: number | null, sekarangMs: number): boolean {
  if (terakhirDicatatMs === null) return true;
  return sekarangMs - terakhirDicatatMs >= JEDA_CATAT_SKEW_DETIK * 1000;
}
