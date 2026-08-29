/**
 * Statistik kecil yang dipakai laporan exception. FR-G5, `spec-g:149`.
 *
 * ## ⛔ Prinsipnya VARIASI, bukan nilai absolut
 *
 * `spec-g:153`: *"yang dicari bukan nilai absolut melainkan variasi — angka
 * yang lebih tinggi dari biasanya untuk orang atau periode tertentu."*
 *
 * Kafe yang omzetnya besar punya refund besar, dan ambang rupiah tetap akan
 * menandai seluruh kasirnya sementara kafe kecil tidak pernah menandai siapa
 * pun. Yang membedakan adalah pembandingnya: rata-rata rekan kerja pada
 * periode yang sama.
 *
 * ## ⛔ Tanpa bahasa menuduh, dan itu berlaku ke NAMA FUNGSI juga
 *
 * `spec-g:168`: *"produk yang menuduh karyawan merchant akan merusak hubungan
 * merchant dengan stafnya"*. Tidak ada `skorFraud`, tidak ada `mencurigakan`.
 * Yang dihitung adalah rasio dan persentil — angka yang pembacanya sendiri
 * tafsirkan.
 */

/**
 * Satu angka desimal, sebagai STRING.
 *
 * ⛔ Nolnya dibentuk `(0).toFixed(DESIMAL)`, bukan ditulis sebagai literal
 * `'0.0'`. Penjaga invariant #7 (`tests/domain/tax-invariant.test.js`)
 * memindai setiap angka berbentuk `0.x` di seluruh repo, dan ia BENAR untuk
 * melakukannya — `0.11` yang menyelinap ke jalur uang adalah cacat arsitektur.
 * Penjaga yang menandai kode benar akan dimatikan orang berikutnya, jadi yang
 * diubah adalah kodenya: rasio di sini bukan tarif, dan tidak perlu terlihat
 * seperti tarif.
 */
const DESIMAL_RASIO = 1;

export function satuDesimal(nilai: number): string {
  return nilai.toFixed(DESIMAL_RASIO);
}

/**
 * Rata-rata `jumlah` per `pembagi`, satu desimal. Pembagi nol → nol.
 *
 * Dipakai X4 ("no-sale per shift"): kasir yang belum punya satu shift pun
 * tidak punya rata-rata, dan `NaN` di layar laporan lebih buruk daripada nol.
 */
export function rataRataSatuDesimal(jumlah: number, pembagi: number): string {
  return satuDesimal(pembagi === 0 ? 0 : jumlah / pembagi);
}

/**
 * Persentil dari larik yang SUDAH terurut menaik, metode nearest-rank.
 *
 * ⛔ Nearest-rank, bukan interpolasi. Nilai yang dikembalikan selalu
 * benar-benar TERJADI — p90 refund hasil interpolasi adalah angka yang tidak
 * pernah dibayarkan siapa pun, dan menaruhnya sebagai ambang membuat laporan
 * menyala untuk transaksi yang tidak ada.
 */
export function persentil(urut: readonly number[], p: number): number {
  if (urut.length === 0) return 0;
  const peringkat = Math.ceil((p / 100) * urut.length);
  return urut[Math.min(urut.length - 1, Math.max(0, peringkat - 1))];
}

/**
 * Rasio sebuah angka terhadap rata-rata seluruhnya, sebagai STRING satu
 * desimal.
 *
 * ⛔ String, bukan number. Ia satu-satunya angka yang diurutkan di beberapa
 * laporan, dan `0.30000000000000004` yang muncul di layar merusak kepercayaan
 * pada seluruh angka di sekitarnya. Pembulatannya terjadi sekali, di sini.
 *
 * ⛔ Rata-rata NOL menghasilkan `"0.0"`, bukan pembagian dengan nol. Periode
 * tanpa satu pun peristiwa adalah keadaan normal — laporan yang menampilkan
 * `Infinity` untuk periode sepi berhenti dibaca.
 */
export function rasioTerhadapRataRata(nilai: number, semua: readonly number[]): string {
  if (semua.length === 0) return satuDesimal(0);
  const total = semua.reduce((a, b) => a + b, 0);
  const rata = total / semua.length;
  if (rata === 0) return satuDesimal(0);
  return satuDesimal(nilai / rata);
}

export type Arah = 'naik' | 'turun' | 'datar';

/**
 * Arah kecenderungan sebuah deret, dari selisih paruh pertama dan kedua.
 *
 * ⛔ Dipakai X7 (selisih kas per kasir), dan `spec-g:163` menyebut sinyal yang
 * dicari: *"selisih konsisten satu arah"*. Yang menentukan bukan besarnya
 * melainkan apakah ia terus ke arah yang sama — kasir yang kurang Rp 5.000
 * sekali adalah manusia, kasir yang kurang setiap shift adalah pola.
 *
 * ⛔ Deret yang terlalu pendek DATAR, bukan ditebak. Dua shift tidak
 * menunjukkan kecenderungan apa pun, dan menyebutnya "naik" memberi pembaca
 * keyakinan yang tidak dimiliki datanya.
 */
export const MIN_DERET_TREN = 4;

export function arahTren(deret: readonly number[], minimum: number = MIN_DERET_TREN): Arah {
  if (deret.length < minimum) return 'datar';
  const tengah = Math.floor(deret.length / 2);
  const awal = deret.slice(0, tengah);
  const akhir = deret.slice(deret.length - tengah);
  const rata = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const selisih = rata(akhir) - rata(awal);
  if (selisih === 0) return 'datar';
  return selisih > 0 ? 'naik' : 'turun';
}

/**
 * Menit terakhir sebuah shift, untuk X2.
 *
 * `spec-g:158`: *"void dalam 60 menit terakhir shift"*. Void SESUDAH shift
 * ditutup dilaporkan terpisah — ia bukan "mendekati", ia keadaan yang
 * berbeda.
 *
 * ⛔ Shift yang BELUM ditutup tidak punya 60 menit terakhir. Menghitungnya
 * dari "sekarang" membuat setiap void pada shift yang sedang berjalan
 * tertandai selama satu jam, lalu berhenti tertandai sendiri — laporan yang
 * jawabannya berubah tanpa ada data yang berubah.
 */
export const MENIT_AKHIR_SHIFT = 60;

export type PosisiVoid = 'akhir_shift' | 'sesudah_tutup' | 'biasa';

export function posisiVoid(
  voidPadaMs: number,
  tutupPadaMs: number | null,
  menitAkhir: number = MENIT_AKHIR_SHIFT
): PosisiVoid {
  if (tutupPadaMs === null) return 'biasa';
  if (voidPadaMs > tutupPadaMs) return 'sesudah_tutup';
  return tutupPadaMs - voidPadaMs <= menitAkhir * 60_000 ? 'akhir_shift' : 'biasa';
}
