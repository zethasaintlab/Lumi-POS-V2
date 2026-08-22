/**
 * Validasi pembayaran yang dikonfirmasi ORANG — QRIS statis (FR-C2) dan EDC
 * (FR-C4).
 *
 * ## ⛔ Kenapa di domain
 *
 * Keduanya berfungsi OFFLINE: tidak ada gateway yang memverifikasi apa pun,
 * dan yang menyatakan "sudah dibayar" adalah kasir. Kontrolnya karena itu
 * harus berjalan di perangkat — aturan yang hanya hidup di server berarti
 * kasir mengetik referensi kosong, layar menerimanya, dan server menolaknya
 * berjam-jam kemudian saat antrean terkuras. Uangnya sudah diterima dan
 * pelanggannya sudah pulang; yang tersisa adalah baris outbox
 * `gagal-permanen`.
 *
 * Bentuk cacat itu sudah pernah terjadi di repo ini pada refund offline
 * (`tests/ordering/refund-offline-relay.test.js`). Berkas ini ada supaya ia
 * tidak terjadi untuk ketiga kalinya.
 *
 * ## ⛔ MENGEMBALIKAN, tidak melempar
 *
 * Server menerjemahkannya menjadi `HttpError` dengan kode yang sesuai; klien
 * menampilkannya di layar. Kodenya ikut dikembalikan justru supaya keduanya
 * tetap sama: `POSSIBLE_CARD_NUMBER` berbeda dari `VALIDATION_ERROR`, dan
 * menyamakannya membuang satu-satunya sinyal bahwa seseorang mengetik nomor
 * kartu ke dalam POS.
 */

export type KodeGalatBayar = 'VALIDATION_ERROR' | 'POSSIBLE_CARD_NUMBER';

export interface GalatBayar {
  kode: KodeGalatBayar;
  pesan: string;
}

/**
 * ⛔ Ambangnya 13, bukan 12.
 *
 * Referensi bank dan nominal rupiah rutin mencapai 12 digit, dan kontrol yang
 * menolak referensi sah akan dimatikan orang pertama yang terhalang olehnya.
 * 13 adalah panjang PAN terpendek yang beredar.
 */
const KEMUNGKINAN_PAN = /\d{13,19}/;

/** `spec-c` — panjang minimum referensi QRIS statis. */
export const MIN_PANJANG_REFERENSI = 3;

/**
 * AC FR-C5 keempat: *"Tidak ada field bebas (`notes`, `reference`) yang
 * divalidasi menerima 13-19 digit berurutan tanpa peringatan."*
 *
 * ⛔ Pemisah dibuang lebih dulu. `4111 1111 1111 1111` adalah bentuk yang
 * paling mungkin diketik orang; memeriksa digit berurutan saja meloloskannya.
 */
export function periksaBukanNomorKartu(nilai: string, label: string): GalatBayar | null {
  if (KEMUNGKINAN_PAN.test(nilai.replace(/[\s-]/g, ''))) {
    return {
      kode: 'POSSIBLE_CARD_NUMBER',
      pesan: `${label} tampak memuat nomor kartu. Data kartu tidak boleh masuk ke POS (FR-C5).`,
    };
  }
  return null;
}

/**
 * Referensi QRIS statis. WAJIB.
 *
 * Kontrol anti-fraud FR-C2, bukan formalitas: QRIS statis dikonfirmasi kasir
 * tanpa verifikasi sistem apa pun. Tanpa referensi, "sudah dibayar" hanyalah
 * pernyataan kasir tanpa jejak — dan tidak ada apa pun yang dapat
 * mencocokkannya dengan mutasi bank.
 */
export function periksaReferensi(nilai: unknown): GalatBayar | null {
  if (typeof nilai !== 'string' || nilai.trim().length < MIN_PANJANG_REFERENSI) {
    return {
      kode: 'VALIDATION_ERROR',
      pesan:
        `reference wajib untuk QRIS statis (minimal ${MIN_PANJANG_REFERENSI} karakter): ` +
        'nominal + 4 digit terakhir nomor referensi, atau catatan.',
    };
  }
  return periksaBukanNomorKartu(nilai, 'reference');
}

/** Kode approval EDC. WAJIB (FR-C4). */
export function periksaApprovalCode(nilai: unknown): GalatBayar | null {
  if (typeof nilai !== 'string' || nilai.trim().length === 0) {
    return { kode: 'VALIDATION_ERROR', pesan: 'approvalCode wajib untuk pembayaran EDC (FR-C4).' };
  }
  return periksaBukanNomorKartu(nilai, 'approvalCode');
}

/**
 * Empat digit terakhir kartu — maksimal 4 DIGIT.
 *
 * ⛔ Menuntut DIGIT, bukan sekadar panjang. Database sudah punya
 * `CHECK (length(card_last4) <= 4)`; yang di sini menutup jalan sepotong data
 * lain menyelinap ke kolom yang namanya menjanjikan empat digit terakhir
 * kartu.
 */
export function periksaCardLast4(nilai: unknown): GalatBayar | null {
  if (typeof nilai !== 'string' || !/^\d{1,4}$/.test(nilai)) {
    return {
      kode: 'VALIDATION_ERROR',
      pesan: 'cardLast4 harus 1-4 digit angka (FR-C4: tidak pernah lebih).',
    };
  }
  return null;
}

/**
 * ⛔ `confirmed_manually` HANYA untuk QRIS statis.
 *
 * Ia menandai bahwa tidak ada SISTEM yang memverifikasi pembayaran, dan
 * FR-G5 memakainya untuk laporan exception. EDC punya struk terminal dan kode
 * approval dari acquirer — bukti fisik yang dapat dicocokkan — sementara QRIS
 * statis tidak punya apa pun selain kalimat kasir.
 */
export function dikonfirmasiManual(metode: string): boolean {
  return metode === 'qris_static';
}

/**
 * ⛔ Pembulatan tunai HANYA berlaku bila ada uang tunai (FR-C9).
 *
 * QRIS dan kartu memindahkan angka, bukan lembaran; tidak ada pecahan yang
 * tidak beredar, jadi tidak ada yang perlu dibulatkan. Membulatkannya berarti
 * menagih pelanggan beberapa rupiah lebih daripada nilai transaksinya, lewat
 * saluran yang mencatat nominalnya persis.
 */
export function metodeDibulatkan(metode: string): boolean {
  return metode === 'cash';
}
