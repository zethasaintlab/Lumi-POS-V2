/**
 * Saringan katalog yang bentuknya harus SAMA di klien dan server.
 *
 * Isinya satu konstanta hari ini, dan itu cukup alasan untuk berkas
 * tersendiri: ia dikirim back-office sebagai query string dan dibaca server
 * sebagai cabang `WHERE`. Dua salinan yang menyimpang tidak menghasilkan
 * error — ia menghasilkan saringan yang mengembalikan **nol produk** alih-alih
 * produk tanpa kategori, dan nol terlihat persis seperti "memang tidak ada".
 */

/**
 * `categoryId` yang berarti "produk yang BELUM punya kategori".
 *
 * ⛔ Saringan tersendiri, bukan ketiadaan saringan. Impor katalog membuat
 * produk tanpa kategori, dan justru itu yang harus dibereskan merchant —
 * kalau ia hanya terlihat lewat "semua kategori", ia tenggelam di antara
 * ratusan yang lain.
 *
 * Nilainya sengaja tidak mungkin menjadi id sungguhan (ULID/UUIDv7).
 */
export const TANPA_KATEGORI = '__tanpa__';
