/**
 * Tampilan uang rupiah — SATU definisi untuk ketiga aplikasi.
 *
 * `CLAUDE.md` menetapkan formatnya sebagai aturan produk, bukan selera:
 * `Rp 1.847.000` (titik ribuan, tanpa desimal) dan `− Rp 8.000` untuk negatif.
 * Format yang ditulis ulang per layar akan menyimpang di tepiannya — dan
 * tepiannya adalah nilai besar, nilai negatif, dan nilai yang hilang: tepat
 * tiga keadaan yang paling perlu dibaca benar.
 *
 * Pindah dari `apps/backoffice/src/katalog/produk.ts` pada 24 Agustus 2026,
 * saat `apps/hp` (Owner mobile) menjadi aplikasi KETIGA yang membutuhkannya.
 *
 * ⛔ **Utang yang dinyatakan:** `apps/kasir` masih punya delapan salinan
 * pemformat sendiri (`Rp ${n.toLocaleString('id-ID')}`, satu per layar). Ia
 * menerima `number` alih-alih `bigint` dan TIDAK menghasilkan `−` untuk
 * negatif. Menyatukannya menyentuh setiap layar uang di aplikasi kasir dan
 * karena itu task tersendiri, bukan efek samping task ini.
 *
 * Murni: tanpa I/O, tanpa jam.
 */

/**
 * `Rp 1.847.000` — titik ribuan, tanpa desimal (`CLAUDE.md`).
 *
 * ⛔ Menerima `bigint`, `number`, DAN `string`. Uang adalah bigint rupiah utuh
 * di server; JSON membawanya sebagai number; kolom INTEGER besar dapat datang
 * sebagai bigint atau string tergantung driver — temuan `@powersync/web` yang
 * sudah tercatat. Guard yang hanya memeriksa `number` tidak pernah mengambil
 * cabangnya, dan itu hijau di test sambil salah di aplikasi.
 */
export function rupiah(nilai: number | bigint | string): string {
  // ⛔ STRING diubah lewat `BigInt` LANGSUNG, tidak lewat `Number`.
  //
  // Versi pertama menulis `BigInt(Math.trunc(Number(nilai) || 0))` untuk
  // semua bentuk non-bigint. Itu benar untuk harga produk — dan membuang
  // presisi tepat pada nilai yang `GET /reports/sales` kirim sebagai string
  // justru untuk menjaganya: `Number('9007199254740993')` menghasilkan
  // …992, satu rupiah hilang tanpa satu pun error.
  //
  // Endpoint laporan mengirim uang sebagai string karena `PosisiPenjualan`
  // memakai `bigint`. Mengubahnya kembali jadi `number` di titik tampilan
  // membatalkan seluruh alasan itu.
  let n: bigint;
  try {
    if (typeof nilai === 'bigint') n = nilai;
    else if (typeof nilai === 'number') n = BigInt(Math.trunc(nilai));
    else {
      const teks = String(nilai).trim();
      // ⛔ `BigInt('')` mengembalikan **0n**, tidak melempar — berbeda dari
      // `BigInt('abc')`. Nilai yang hilang karena itu akan tampil sebagai
      // "Rp 0" yang meyakinkan, dan merchant membacanya sebagai penjualan nol
      // alih-alih data yang tidak sampai.
      if (teks.length === 0) return 'Rp —';
      n = BigInt(teks);
    }
  } catch {
    // `BigInt('abc')` MELEMPAR, tidak seperti `Number('abc')` yang
    // menghasilkan NaN diam-diam. Layar yang jatuh karena satu field tak
    // terduga lebih buruk daripada layar yang menampilkan tanda tanya.
    return 'Rp —';
  }

  const negatif = n < 0n;
  const teks = (negatif ? -n : n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  // `−` (U+2212), bukan hyphen — format yang `CLAUDE.md` tetapkan untuk nilai
  // negatif adalah `− Rp 8.000`.
  return negatif ? `− Rp ${teks}` : `Rp ${teks}`;
}

/**
 * Angka rupiah yang diketik manusia → integer, atau `null`.
 *
 * ⛔ `null`, bukan `NaN` dan bukan `0`. `Number('')` adalah **0**, dan harga 0
 * yang lahir dari field kosong adalah produk yang dijual gratis — kegagalan
 * yang tidak menghasilkan error dan baru terlihat di laporan.
 *
 * Nol yang benar-benar DIKETIK tetap diterima: produk gratis itu sah.
 */
export function bacaRupiah(teks: string): number | null {
  // ⛔ Bentuknya diperiksa SEBELUM titik dibuang, bukan sesudah.
  //
  // Versi pertama membuang setiap titik lalu memeriksa sisanya. `25.5` —
  // desimal, yang tidak sah untuk rupiah — menjadi `255`: diterima, dan
  // **salah 10×**. Ditemukan test, bukan review.
  //
  // Titik hanya sah sebagai pemisah RIBUAN, yaitu dalam kelompok tepat tiga
  // digit. Spasi dibuang lebih dulu karena ia tidak pernah menjadi pemisah
  // desimal.
  const bersih = String(teks ?? '')
    .replace(/rp/gi, '')
    .replace(/\s/g, '')
    .trim();
  if (bersih.length === 0) return null;

  const polos = /^\d+$/;
  const berkelompok = /^\d{1,3}(\.\d{3})+$/;
  if (!polos.test(bersih) && !berkelompok.test(bersih)) return null;

  return Number.parseInt(bersih.replace(/\./g, ''), 10);
}
