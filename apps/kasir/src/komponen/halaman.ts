/**
 * Paginasi daftar — aturan MURNI, dipakai K-03 (TEMUAN C1) dan K-08 (D3).
 *
 * ## ⛔ `/ds-bundle` tidak punya paginasi sama sekali
 *
 * `<Table>` bundle diperiksa di sumbernya: ia merender `<thead>`/`<tbody>` dan
 * berhenti di situ. Ini salah satu dari tiga butir peninjauan yang memang harus
 * dibangun, bukan diadopsi (`docs/verifikasi/BUNDLE.md` §4).
 *
 * ## ⛔ Dua bentuk yang BERBEDA, dan bedanya bukan gaya
 *
 * | Layar | Bentuk | Kenapa |
 * |---|---|---|
 * | K-08 riwayat | halaman bernomor | daftar yang DIBACA; kasir mencari struk tertentu dan "halaman 3" adalah alamat yang dapat disebutkan |
 * | K-03 katalog | muat lebih banyak | grid yang DITEKAN CEPAT; halaman bernomor menambah ketukan pada setiap penjualan produk yang ada di halaman 2 |
 *
 * `IA:53` menuntut K-03 menampilkan **≥12 kartu tanpa scroll**, dan paginasi
 * bernomor tidak melanggarnya — yang jadi soal adalah **ketukan per
 * penjualan**. Kasir yang produknya di halaman 3 menekan dua kali sebelum
 * menemukannya, pada setiap penjualan produk itu, sepanjang hari. Saringan
 * kategori dan pencarian sudah menyelesaikan masalah yang sama dengan NOL
 * ketukan tambahan untuk produk yang sering dijual.
 *
 * ⛔ Ini **trade-off yang dinyatakan, bukan penolakan**: kalau paginasi
 * bernomor di K-03 memang yang diinginkan, `potongHalaman` di bawah sudah
 * mendukungnya — yang berubah hanya komponen yang memanggilnya.
 */

/** Ukuran halaman K-08. 25 baris memenuhi layar 800px tanpa menggulir jauh. */
export const PER_HALAMAN_RIWAYAT = 25;

/**
 * Berapa kartu yang K-03 tampilkan sebelum "Muat lebih banyak".
 *
 * ⛔ Jauh di atas 12 (`IA:53`), dan itu disengaja: batas ini ada untuk menahan
 * ONGKOS RENDER pada katalog besar, bukan untuk memecah menu. Merchant dengan
 * 40 produk tidak boleh melihat tombol "muat lebih banyak" sama sekali.
 */
export const PER_MUAT_KATALOG = 48;

export interface Halaman<T> {
  baris: T[];
  /** 1-based, seperti yang dibaca manusia. */
  nomor: number;
  jumlahHalaman: number;
  total: number;
  /** Kalimat "1–25 dari 137" — ⛔ TIDAK dirakit di layar. Lihat catatan. */
  rentang: string;
}

/**
 * Potong daftar menjadi satu halaman.
 *
 * ⛔ `nomor` DI-CLAMP, tidak pernah melempar. Halaman yang di luar jangkauan
 * adalah keadaan normal, bukan kesalahan: kasir di halaman 6 lalu mengetik
 * pencarian yang menyisakan 10 baris tetap berada di halaman 6, dan daftar
 * kosong di sana **tidak dapat dibedakan dari "tidak ada hasil"** — bentuk
 * "nol baris, bukan error" yang `docs/verifikasi/KELAS-GAGAL.md` catat.
 * Layar tetap wajib mengembalikan `nomor` ke 1 saat saringan berubah; clamp
 * ini adalah jaring kedua, bukan penggantinya.
 *
 * ⛔ Daftar KOSONG mengembalikan `jumlahHalaman: 1`, bukan 0. "Halaman 1 dari
 * 0" adalah kalimat yang tidak dapat dibaca siapa pun.
 */
export function potongHalaman<T>(
  daftar: readonly T[],
  nomor: number,
  perHalaman: number
): Halaman<T> {
  const total = daftar.length;
  const jumlahHalaman = Math.max(1, Math.ceil(total / perHalaman));
  const aman = Math.min(Math.max(1, Math.trunc(nomor) || 1), jumlahHalaman);
  const mulai = (aman - 1) * perHalaman;
  const baris = daftar.slice(mulai, mulai + perHalaman);

  return {
    baris,
    nomor: aman,
    jumlahHalaman,
    total,
    /* ⛔ Kalimatnya disusun DI SINI, bukan di dua layar yang memakainya.
       Dua salinan akan menyimpang tepat pada tepiannya — daftar kosong, dan
       halaman terakhir yang tidak penuh — dan tepian itu yang paling sering
       salah dibaca. */
    rentang:
      total === 0 ? 'Tidak ada baris' : `${mulai + 1}–${mulai + baris.length} dari ${total}`,
  };
}

/**
 * Nomor halaman yang DITAMPILKAN, dengan elipsis.
 *
 * ⛔ Riwayat 100 baris punya 4 halaman dan muat di layar; riwayat yang kelak
 * dibuka lebih lebar tidak. Merender setiap nomor membuat bilahnya menggulung
 * mendatar dan menutupi baris terakhir — dan yang tergulung adalah kontrol
 * yang gunanya justru berpindah cepat.
 *
 * `null` berarti elipsis. Ia BUKAN tombol: halaman yang tidak ditampilkan tetap
 * dapat dicapai lewat tetangganya.
 */
export function nomorHalaman(nomor: number, jumlahHalaman: number): (number | null)[] {
  if (jumlahHalaman <= 7) {
    return Array.from({ length: jumlahHalaman }, (_, i) => i + 1);
  }
  const sisi = new Set<number>([1, jumlahHalaman, nomor, nomor - 1, nomor + 1]);
  const urut = [...sisi].filter((n) => n >= 1 && n <= jumlahHalaman).sort((a, b) => a - b);

  const hasil: (number | null)[] = [];
  let sebelum = 0;
  for (const n of urut) {
    // Celah SATU halaman dirender apa adanya — elipsis yang menyembunyikan
    // tepat satu nomor memakan ruang yang sama dan menghilangkan satu tujuan.
    if (n - sebelum === 2) hasil.push(sebelum + 1);
    else if (n - sebelum > 2) hasil.push(null);
    hasil.push(n);
    sebelum = n;
  }
  return hasil;
}
