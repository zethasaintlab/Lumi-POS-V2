/**
 * Aturan ALASAN yang berlaku untuk setiap operasi ber-otorisasi. `spec-b:288`.
 *
 * *"Free text tidak dapat diagregasi menjadi laporan fraud."* Itu kalimat yang
 * membuat setiap daftar alasan di repo ini TERTUTUP — void, refund, no-sale,
 * selisih kas, dan diskon.
 *
 * ## ⛔ Kenapa berkas tersendiri
 *
 * Aturan "Lainnya wajib catatan minimal 10 karakter" (`spec-b:296`) berlaku
 * untuk SEMUA daftar itu, dan sebelumnya ia hidup sebagai konstanta privat di
 * `cancellation.ts`. Daftar kelima yang lahir (diskon, FR-B8) akan menyalinnya
 * — dan angka yang punya dua salinan akan menyimpang pada perubahan
 * berikutnya, menghasilkan satu operasi yang menerima catatan lima karakter
 * sementara yang lain menolaknya.
 */

/** `spec-b:296`. Kode yang menuntut catatan bebas. */
export const KODE_LAINNYA = 'lainnya';

/**
 * Panjang minimum catatan untuk `lainnya`.
 *
 * ⛔ Dihitung per TITIK KODE setelah `trim`, bukan per unit UTF-16 dan bukan
 * atas string mentah. Sepuluh spasi lolos hitungan mentah tapi tidak
 * menjelaskan apa pun kepada siapa pun yang membaca laporan exception nanti.
 */
export const MIN_PANJANG_CATATAN = 10;

/** Apakah catatan memenuhi syarat panjang. Tidak melempar. */
export function catatanCukup(catatan?: string | null): boolean {
  return Array.from((catatan ?? '').trim()).length >= MIN_PANJANG_CATATAN;
}

/**
 * Memeriksa satu alasan terhadap daftar tertutupnya.
 *
 * Mengembalikan pesan kesalahan, atau `null` bila sah. ⛔ MENGEMBALIKAN,
 * bukan melempar: pemanggil di server menerjemahkannya jadi `HttpError`
 * dengan kode yang sesuai, dan pemanggil di klien menampilkannya di layar
 * tanpa harus menangkap apa pun.
 */
export function periksaAlasan(
  daftar: readonly string[],
  kode: unknown,
  catatan?: string | null
): string | null {
  if (typeof kode !== 'string' || !daftar.includes(kode)) {
    return `Alasan "${String(kode)}" tidak dikenal. Pilihan: ${daftar.join(', ')}.`;
  }
  if (kode === KODE_LAINNYA && !catatanCukup(catatan)) {
    return `Alasan "${KODE_LAINNYA}" wajib disertai catatan minimal ${MIN_PANJANG_CATATAN} karakter.`;
  }
  return null;
}
