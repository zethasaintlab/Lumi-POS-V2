/**
 * State machine order (FR-B1, `product/specs/spec-b-kasir-order.md` §24-77).
 *
 * ## Kenapa di sini, bukan di handler REST
 *
 * AC FR-B1 pertama: "Transisi ilegal ditolak di **lapisan domain**, bukan
 * hanya UI." Dan lebih penting lagi: klien Tauri/SQLite menegakkan aturan
 * yang sama saat offline, tanpa server. Aturan yang hanya hidup di handler
 * REST tidak berlaku persis pada keadaan yang produk ini janjikan berfungsi
 * penuh.
 *
 * Modul ini **murni** -- tanpa I/O, tanpa waktu, tanpa database. Ia hanya
 * menjawab satu pertanyaan: bolehkah berpindah dari status A ke status B?
 *
 * ## DRAFT
 *
 * `draft` adalah keranjang di layar yang belum tersimpan. AC FR-B1 kedua:
 * "Order DRAFT yang ditinggalkan tidak menghasilkan baris di database."
 * Karena itu ia ada di sini sebagai titik awal, tapi tidak pernah menjadi
 * nilai kolom `order.status` -- CHECK constraint di `0007_ordering.sql`
 * memang tidak memuatnya.
 */

export type OrderStatus =
  | 'draft'
  | 'open'
  | 'paid'
  | 'closed'
  | 'voided'
  | 'refunded'
  | 'abandoned';

/**
 * Transisi legal, disalin dari tabel `spec-b-kasir-order.md:57-69`.
 *
 * Dinyatakan sebagai daftar tertutup, BUKAN sebagai daftar larangan. Bedanya
 * menentukan: dengan daftar larangan, status baru yang lupa didaftarkan akan
 * diam-diam legal ke mana saja. Dengan daftar izin, ia ditolak sampai
 * seseorang sengaja membukanya.
 *
 * | Dari | Ke | Syarat (ditegakkan pemanggil, bukan di sini) |
 * |---|---|---|
 * | draft | open | Item pertama ditambahkan |
 * | open | open | Item ditambah/dikurangi, diskon diterapkan |
 * | open | paid | SUM(payment.confirmed) >= amount_due |
 * | open | voided | Alasan dari daftar tertutup + audit |
 * | open | abandoned | Otomatis saat shift ditutup, dengan konfirmasi |
 * | paid | closed | Otomatis setelah operasi pasca-bayar selesai |
 * | paid | voided | Hanya bila belum di-settle |
 * | closed | refunded | Otorisasi manajer + alasan |
 * | refunded | refunded | Refund parsial berulang |
 *
 * Syarat di kolom ketiga adalah urusan pemanggil. Modul ini sengaja tidak
 * tahu apa-apa soal pembayaran, shift, atau otorisasi -- menariknya ke sini
 * akan membuatnya butuh I/O, dan hilanglah kemurniannya.
 */
const ALLOWED: ReadonlyArray<readonly [OrderStatus, OrderStatus]> = [
  ['draft', 'open'],
  ['open', 'open'],
  ['open', 'paid'],
  ['open', 'voided'],
  ['open', 'abandoned'],
  ['paid', 'closed'],
  ['paid', 'voided'],
  ['closed', 'refunded'],
  ['refunded', 'refunded'],
];

// Set lookup: `${from}>${to}`. Dibangun sekali saat modul dimuat.
const ALLOWED_KEYS: ReadonlySet<string> = new Set(ALLOWED.map(([f, t]) => `${f}>${t}`));

/**
 * Bolehkah berpindah dari `from` ke `to`?
 *
 * Menerima `string`, bukan `OrderStatus`, dengan sengaja: nilai yang sampai
 * ke sini bisa berasal dari body request, baris database lama, atau klien
 * versi lebih baru. Mempersempit tipenya hanya memindahkan masalah ke
 * pemanggil dan membuat kompilator seolah menjamin sesuatu yang tidak ia
 * jamin saat runtime. Status yang tidak dikenal cukup tidak ada di set, jadi
 * jawabannya `false` -- default tertutup.
 */
export function isTransitionAllowed(from: string, to: string): boolean {
  return ALLOWED_KEYS.has(`${from}>${to}`);
}

export function assertTransition(from: string, to: string): void {
  if (!isTransitionAllowed(from, to)) {
    // Pesan menyebut kedua status supaya kegagalan bisa didiagnosis dari log
    // tanpa membuka kode -- termasuk saat yang membacanya adalah merchant
    // support, bukan developer.
    throw new Error(`Transisi status order tidak diizinkan: ${from} -> ${to}.`);
  }
}
