/**
 * K-17 — mengenali masukan SCANNER dari ketikan manusia.
 *
 * `research/07` §4: mayoritas scanner USB beroperasi sebagai **HID keyboard** —
 * ia "mengetik" isi barcode lalu menekan Enter. Tidak ada driver, tidak ada
 * izin browser, tidak ada perbedaan antara scanner kabel dan Bluetooth.
 *
 * Konsekuensinya: dari sudut pandang aplikasi, scanner dan kasir memakai pintu
 * yang **sama persis**. Yang membedakan hanya kecepatan.
 *
 * ## Kenapa modul murni tanpa DOM
 *
 * Yang diuji di sini adalah HEURISTIKNYA — jeda antar karakter, panjang
 * minimum, terminator. Menguji itu lewat `KeyboardEvent` sungguhan menuntut
 * browser dan waktu nyata, dan hasilnya menjadi test yang lambat dan
 * sesekali merah. Di sini waktunya di-INJECT, jadi setiap kasus batas dapat
 * ditulis persis.
 *
 * Pemasangan listener-nya ada di `apps/kasir` — itu yang butuh DOM.
 *
 * ## ⛔ Kenapa heuristik, bukan kepastian
 *
 * Tidak ada cara membedakan scanner dari keyboard di web: keduanya
 * `KeyboardEvent` tanpa penanda perangkat. Heuristik ini karena itu dapat
 * SALAH dua arah, dan keduanya harus tidak berbahaya:
 *
 *   - kasir yang mengetik sangat cepat lalu menekan Enter → dianggap scan.
 *     Akibatnya pencarian barcode yang tidak menemukan apa-apa. Tidak ada
 *     yang rusak.
 *   - scanner yang lambat (Bluetooth jauh, baterai lemah) → dianggak ketikan.
 *     Kasir mengetik ulang. Menjengkelkan, bukan berbahaya.
 *
 * Yang TIDAK boleh terjadi adalah scan yang diam-diam menambahkan produk
 * salah — dan itu dijaga di tempat lain: pencocokan barcode PERSIS, bukan
 * substring (`apps/kasir/src/katalog/baca.ts`).
 */

/**
 * Jeda maksimum antar karakter yang masih dianggap satu scan, dalam
 * milidetik.
 *
 * `research/07` §4 menyebut scanner biasanya di bawah **30 ms** antar
 * karakter. Angka di sini lebih longgar: scanner Bluetooth dan perangkat yang
 * sedang sibuk merender dapat melewatinya, dan kasir yang benar-benar
 * mengetik 50 ms per karakter (1.200 ketukan per menit) praktis tidak ada.
 *
 * ⛔ `[ASUMSI]` — belum diukur terhadap scanner sungguhan. Ia menunggu OQ-14
 * bersama printer Bluetooth.
 */
export const JEDA_MAKS_MS = 50;

/**
 * Panjang minimum yang dianggap barcode.
 *
 * EAN-8 adalah barcode terpendek yang lazim. Di bawah itu, yang tertangkap
 * adalah kasir yang menekan beberapa tombol lalu Enter.
 */
export const PANJANG_MIN = 4;

export interface KeadaanPemindai {
  /** Karakter yang sudah terkumpul sejak ketukan pertama. */
  buffer: string;
  /** Waktu ketukan terakhir, milidetik. */
  terakhirMs: number;
}

export function keadaanAwal(): KeadaanPemindai {
  return { buffer: '', terakhirMs: 0 };
}

export type HasilKetukan =
  /** Belum selesai; simpan keadaannya dan tunggu ketukan berikutnya. */
  | { jenis: 'kumpulkan'; keadaan: KeadaanPemindai }
  /** Terminator diterima dan bufernya lolos heuristik. */
  | { jenis: 'terpindai'; kode: string; keadaan: KeadaanPemindai }
  /** Terminator diterima tapi bufernya BUKAN hasil scan. */
  | { jenis: 'abaikan'; keadaan: KeadaanPemindai };

/**
 * Satu ketukan tombol.
 *
 * @param key `KeyboardEvent.key`. Hanya karakter tunggal dan `'Enter'` yang
 *   berarti; sisanya (`'Shift'`, `'Tab'`, `'F1'`) tidak mengubah keadaan.
 * @param sekarangMs Waktu ketukan. Di-INJECT — modul ini tidak pernah
 *   memanggil `Date.now()`, karena itu yang membuatnya dapat diuji.
 */
export function ketuk(
  keadaan: KeadaanPemindai,
  key: string,
  sekarangMs: number
): HasilKetukan {
  if (key === 'Enter') {
    const kode = keadaan.buffer;
    // ⛔ Buffer SELALU dikosongkan, termasuk saat diabaikan. Sisa ketikan
    // manusia yang tertinggal akan menempel di depan scan berikutnya, dan
    // barcode yang tercemar tidak cocok apa pun — gejalanya "scanner
    // kadang tidak jalan", yang mustahil dilacak.
    const bersih = keadaanAwal();
    if (kode.length >= PANJANG_MIN) return { jenis: 'terpindai', kode, keadaan: bersih };
    return { jenis: 'abaikan', keadaan: bersih };
  }

  // Tombol kendali diabaikan tanpa mengubah apa pun — termasuk `terakhirMs`.
  // Menyentuh waktunya akan membuat `Shift` di tengah barcode (huruf besar
  // pada Code 39) memperpanjang jendela jeda secara tidak sengaja.
  if (key.length !== 1) return { jenis: 'kumpulkan', keadaan };

  // Jeda terlalu panjang = ketukan ini memulai masukan BARU. Ini yang membuat
  // kasir yang mengetik pelan tidak pernah menumpuk menjadi "barcode".
  const lanjut = keadaan.buffer !== '' && sekarangMs - keadaan.terakhirMs <= JEDA_MAKS_MS;
  return {
    jenis: 'kumpulkan',
    keadaan: { buffer: lanjut ? keadaan.buffer + key : key, terakhirMs: sekarangMs },
  };
}
