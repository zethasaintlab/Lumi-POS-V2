/**
 * Warna kategori produk — DITURUNKAN dari namanya, bukan disimpan.
 *
 * ## ⛔ Kenapa diturunkan, bukan sebuah kolom
 *
 * Kategori adalah milik merchant: "Kopi", "Non-Kopi", "Makanan", "Pastry" di
 * satu kafe, "Rokok", "Sembako", "Minuman" di kafe berikutnya. Tidak ada
 * kosakata tetap yang dapat kami petakan di muka.
 *
 * Menyimpannya sebagai kolom `category.color` terdengar lebih fleksibel dan
 * justru lebih buruk: ia menambah kolom pada tabel yang direplikasi (setiap
 * perangkat membangun ulang raw table-nya, dan riwayat penjualan lokalnya
 * hilang — lihat migrasi `0035`), menuntut layar pemilih warna yang tidak
 * seorang pun minta, dan membiarkan merchant memilih enam kategori berwarna
 * sama sehingga warnanya berhenti membedakan apa pun.
 *
 * Turunan dari nama memberi dua sifat yang justru dibutuhkan:
 *
 *   1. **Stabil** — "Kopi" selalu mendapat warna yang sama, di kasir maupun di
 *      back-office, tanpa apa pun yang perlu disepakati antar aplikasi.
 *   2. **Nol biaya skema** — tidak ada kolom baru, tidak ada migrasi, tidak ada
 *      perangkat yang kehilangan riwayatnya.
 *
 * ## ⛔ Warna tidak pernah berdiri sendiri
 *
 * Aturan design system #5: status tidak pernah dikodekan warna saja. Di sini
 * aturan itu berlaku dua kali lipat — chip kategori WAJIB memuat nama
 * kategorinya. Warnanya mempercepat pemindaian grid produk; ia tidak
 * menggantikan satu kata pun. Kasir yang buta warna tetap membaca "Kopi".
 *
 * ## ⛔ Ini pengkodean DATA, bukan status
 *
 * Slotnya punya token sendiri (`--kat-1..6`) dan sengaja TIDAK memakai ulang
 * `--success`/`--warning`/`--danger`. Hijau dan merah sudah punya arti di
 * produk ini (stok aman, stok minus, selisih kas); kategori yang mendarat di
 * hijau akan terbaca sebagai penilaian, bukan sebagai kelompok.
 */

/** Jumlah slot warna kategori. Sepakat dengan `--kat-1..6` di `colors.css`. */
export const JUMLAH_SLOT_KATEGORI = 6;

/**
 * Slot warna (1..6) untuk sebuah nama kategori.
 *
 * ⛔ Dinormalkan sebelum di-hash: "kopi", "Kopi", dan " KOPI " adalah kategori
 * yang sama di mata merchant, dan tiga warna berbeda untuk satu kata akan
 * terlihat seperti kerusakan. Normalisasinya `trim` + `toLowerCase`, TIDAK
 * lebih — membuang spasi di tengah akan menyatukan "Es Kopi" dengan "Eskopi",
 * dua kategori yang merchant sengaja pisahkan.
 *
 * FNV-1a, konvensi yang sama dengan sidik jari skema lokal: yang dibutuhkan
 * sebaran yang stabil, bukan ketahanan terhadap lawan.
 */
export function slotKategori(nama: string): number {
  const kanonik = nama.trim().toLowerCase();
  // ⛔ Nama KOSONG selalu slot 1, bukan hasil hash string kosong yang kebetulan.
  // Produk tanpa kategori adalah keadaan nyata (`TANPA_KATEGORI`), dan ia harus
  // tampil konsisten alih-alih mewarisi warna acak.
  if (kanonik === '') return 1;

  let h = 0x811c9dc5;
  for (let i = 0; i < kanonik.length; i += 1) {
    h ^= kanonik.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h % JUMLAH_SLOT_KATEGORI) + 1;
}

/**
 * Properti CSS untuk chip kategori.
 *
 * Dikembalikan sebagai custom property, bukan warna langsung: komponennya
 * memakai `var(--chip)` dan `var(--chip-soft)`, jadi tema mana pun yang kelak
 * mengganti token `--kat-*` ikut berlaku tanpa satu komponen pun disunting.
 */
export function gayaKategori(
  nama: string,
  daftar?: readonly string[]
): { '--chip': string; '--chip-soft': string } {
  const slot = daftar === undefined ? slotKategori(nama) : slotDariDaftar(nama, daftar);
  return {
    '--chip': `var(--kat-${slot})`,
    '--chip-soft': `var(--kat-${slot}-soft)`,
  };
}

/**
 * Slot dari POSISI di dalam daftar kategori yang sebenarnya ada.
 *
 * ⛔ HASH SAJA TIDAK CUKUP, dan itu terukur — bukan dugaan.
 *
 * Versi pertama fungsi ini hanya meng-hash nama ke enam slot. Diperiksa di
 * browser terhadap data seed yang punya empat kategori, dan **"Makanan"
 * mendarat di warna yang sama dengan "Kopi"**. Itu bukan nasib buruk: empat
 * benda ke dalam enam laci bertabrakan pada sekitar 70% kemungkinan (masalah
 * ulang tahun). Kategori yang berwarna sama membatalkan seluruh alasan warna
 * kategori ada.
 *
 * Posisi di dalam daftar yang DIURUTKAN memberi jaminan yang hash tidak dapat:
 * selama kategorinya ≤ 6, tidak ada dua yang pernah sewarna.
 *
 * Harganya dinyatakan: menambah kategori baru dapat menggeser warna kategori
 * lain. Itu pertukaran yang benar di sini — warna adalah alat pemindaian, dan
 * dua kategori sewarna merusaknya setiap hari, sementara pergeseran hanya
 * terjadi pada hari merchant menyunting daftar kategorinya.
 *
 * Nama yang TIDAK ADA di daftar jatuh kembali ke hash: kategori yang diarsipkan
 * masih muncul di riwayat penjualan lama, dan ia tetap harus berwarna.
 */
function slotDariDaftar(nama: string, daftar: readonly string[]): number {
  const kanonik = nama.trim().toLowerCase();
  const urut = [...new Set(daftar.map((d) => d.trim().toLowerCase()))].sort();
  const i = urut.indexOf(kanonik);
  if (i === -1) return slotKategori(nama);
  return (i % JUMLAH_SLOT_KATEGORI) + 1;
}
