/**
 * Zona waktu outlet yang sah. Murni: tanpa I/O, tanpa waktu.
 *
 * ## Kenapa ia diangkat ke sini
 *
 * Daftar ini sudah punya tiga salinan sebelum berkas ini ada: CHECK constraint
 * di `db/migrations/0002_tenancy.sql`, `enum` di OpenAPI, dan konstanta privat
 * `ZONA_SAH` yang **sama persis** di dua handler server
 * (`tenancy/handlers/register.ts` dan `tenancy/handlers/outlets.ts`).
 *
 * Layar pendaftaran (B-00b) menjadi yang membutuhkannya di KLIEN — ia harus
 * merender pilihannya. Salinan keempat, di sisi yang tidak dapat diuji bersama
 * server, adalah yang membuat daftar ini pantas punya satu rumah.
 *
 * ⛔ Yang menyimpang tidak menghasilkan error di mana pun: pilihan yang HILANG
 * membuat outlet Indonesia Timur mustahil didaftarkan lewat UI, dan pilihan
 * yang DITAMBAHKAN menghasilkan 500 dari CHECK constraint saat merchant
 * memilihnya. Ada test yang membandingkan daftar ini dengan migrasinya.
 *
 * CHECK constraint tetap tinggal di database. Ia yang menjaga jalur yang tidak
 * lewat sini sama sekali.
 */

export type ZonaWaktu = 'Asia/Jakarta' | 'Asia/Makassar' | 'Asia/Jayapura';

/** Urutan barat → timur, dan itu urutan yang ditampilkan layar. */
export const ZONA_WAKTU: readonly ZonaWaktu[] = [
  'Asia/Jakarta',
  'Asia/Makassar',
  'Asia/Jayapura',
];

/**
 * Label WIB/WITA/WIT.
 *
 * ⛔ Ada di sini, bukan di komponen. "Asia/Jayapura" tidak dapat dibaca pemilik
 * kafe; "WIT" dapat. Kalau label hidup di layar, layar kedua yang menampilkan
 * zona (B-23 Outlet) akan menuliskannya lagi dengan kata yang sedikit berbeda.
 */
export const LABEL_ZONA: Readonly<Record<ZonaWaktu, string>> = {
  'Asia/Jakarta': 'WIB — Jakarta',
  'Asia/Makassar': 'WITA — Makassar',
  'Asia/Jayapura': 'WIT — Jayapura',
};

export function zonaSah(nilai: unknown): nilai is ZonaWaktu {
  return typeof nilai === 'string' && (ZONA_WAKTU as readonly string[]).includes(nilai);
}
