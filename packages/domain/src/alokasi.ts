/**
 * Alokasi proporsional sebuah nilai uang ke sekumpulan bobot, **tanpa rupiah
 * hilang atau tercipta**.
 *
 * ## Kenapa berdiri sendiri
 *
 * Ia lahir di `tax.ts` untuk AC FR-C8 kelima (diskon order dibagi proporsional
 * ke baris). Pemakai kedua adalah refund parsial: kasir memilih **baris**,
 * sementara yang dikembalikan adalah **uang** — dan `order.total` memuat pajak,
 * pembulatan, dan service charge yang tidak satu pun tersimpan per baris.
 *
 * ⛔ Menjumlahkan `order_line.line_total` untuk menghitung nilai refund adalah
 * jawaban yang SALAH dan salahnya diam: `line_total` **belum kena pajak
 * eksklusif**, jadi refund "seluruh baris" akan lebih kecil daripada yang
 * pelanggan bayar. Untuk pajak inklusif ia sudah termasuk — jadi tidak ada
 * satu rumus penjumlahan yang benar untuk keduanya.
 *
 * Yang benar adalah membagi `order.total` itu sendiri dengan `line_total`
 * sebagai bobot: apa pun bentuk pajaknya, `SUM(alokasi) === total` dijamin,
 * dan refund seluruh baris mengembalikan tepat sebesar yang dibayar.
 *
 * Menyalinnya ke modul kedua berarti dua aturan pembulatan sisa, dan itu
 * persis cara angka mulai berbeda satu rupiah antara layar dan yang tersimpan.
 */

/**
 * @param total Nilai yang dibagi. Nol menghasilkan seluruh alokasi nol.
 * @param weights Bobot per penerima. Jumlah bobot nol menghasilkan nol semua.
 * @returns Larik sepanjang `weights`, dan `SUM(hasil) === total` selalu.
 */
export function allocateProportionally(
  total: bigint,
  weights: ReadonlyArray<bigint>
): bigint[] {
  const sum = weights.reduce((s, w) => s + w, 0n);
  if (sum === 0n || total === 0n) return weights.map(() => 0n);

  const allocated = weights.map((w) => (total * w) / sum);
  let remainder = total - allocated.reduce((s, a) => s + a, 0n);

  // Sisa dibagikan satu per satu mulai dari bobot terbesar — deterministik,
  // bukan bergantung urutan masukan.
  const order = weights
    .map((w, i) => ({ w, i }))
    .sort((a, b) => (b.w > a.w ? 1 : b.w < a.w ? -1 : a.i - b.i));
  let k = 0;
  while (remainder > 0n && order.length > 0) {
    allocated[order[k % order.length].i] += 1n;
    remainder -= 1n;
    k += 1;
  }
  return allocated;
}
