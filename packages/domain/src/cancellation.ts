import { isTransitionAllowed } from './order-state.ts';

/**
 * Aturan pembatalan transaksi (FR-B7, `product/specs/spec-b-kasir-order.md`
 * §B.4).
 *
 * ## Kenapa di packages/domain
 *
 * AC FR-B7 kelima: "Void dan refund berfungsi **offline**." Klien
 * Tauri/SQLite karena itu harus memutuskan operasi yang sama persis tanpa
 * server, dan menegakkan batas refund yang sama. Aturan yang hanya hidup di
 * handler REST tidak berlaku justru pada keadaan yang produk ini janjikan
 * berfungsi penuh.
 *
 * Murni: tanpa I/O, tanpa waktu, tanpa database.
 *
 * ## Void dan refund bukan dua varian dari satu operasi
 *
 * `spec-b:222` menegaskannya: prasyarat, efek finansial, dan konsekuensi
 * stoknya berbeda. Yang sama hanya pintunya -- kasir menekan satu tombol
 * "Batalkan transaksi" dan **sistem** memilih (`spec-b:235`).
 */

export type CancellationOperation = 'void' | 'refund';

/**
 * Alasan dari daftar tertutup (`spec-b:290-291`).
 *
 * Tertutup, bukan free text, karena `spec-b:288` menyebut alasannya langsung:
 * "free text tidak dapat diagregasi menjadi laporan fraud". Untuk void ini
 * lebih menentukan lagi -- keputusan user 1 Agustus 2026 menghapus PIN
 * manajer dari void, jadi alasan + audit adalah kontrol yang tersisa, dan
 * laporan exception FR-G5 naik jadi wajib karenanya.
 *
 * Diekspor supaya kontrak OpenAPI dan klien offline membaca sumber yang SAMA.
 * Dua salinan daftar berarti klien bisa menawarkan pilihan yang server tolak,
 * dan kasir buntu di tengah pembatalan.
 */
export const VOID_REASON_CODES = [
  'salah_input',
  'pelanggan_batal',
  'item_habis',
  'uji_coba',
  'lainnya',
] as const;

export const REFUND_REASON_CODES = [
  'barang_rusak',
  'pesanan_salah',
  'pelanggan_tidak_puas',
  'kelebihan_bayar',
  'lainnya',
] as const;

export type VoidReasonCode = (typeof VOID_REASON_CODES)[number];
export type RefundReasonCode = (typeof REFUND_REASON_CODES)[number];

const REASONS: Record<CancellationOperation, ReadonlySet<string>> = {
  void: new Set<string>(VOID_REASON_CODES),
  refund: new Set<string>(REFUND_REASON_CODES),
};

/** `spec-b:296` — "Lainnya wajib catatan bebas minimal 10 karakter." */
const REASON_OTHER = 'lainnya';
const MIN_NOTE_LENGTH = 10;

/**
 * Operasi mana yang berlaku untuk order berstatus `status`?
 *
 * ## Diturunkan dari state machine, bukan didaftar ulang
 *
 * Jawabannya dibaca dari `isTransitionAllowed`, bukan dari tabel kedua di
 * file ini. Dua daftar yang menyatakan hal yang sama akan bergeser
 * sendiri-sendiri, dan bentuk kegagalannya buruk: pembatalan diterima di sini
 * lalu ditolak beberapa lapis kemudian oleh `assertTransition`, sehingga
 * kasir menerima kegagalan yang tidak bisa dijelaskan siapa pun.
 *
 * Konsekuensinya `refunded` juga menjawab `'refund'` — `spec-b:66`
 * mengizinkan `refunded -> refunded` untuk refund parsial berulang.
 *
 * Menerima `string`, bukan `OrderStatus`, dengan alasan yang sama dengan
 * `isTransitionAllowed`: nilainya berasal dari body request atau baris lama.
 * Status tak dikenal tidak ada di allow-list mana pun, jadi ia ditolak —
 * default tertutup.
 */
export function decideCancellation(status: string): CancellationOperation {
  const bolehVoid = isTransitionAllowed(status, 'voided');
  const bolehRefund = isTransitionAllowed(status, 'refunded');

  if (bolehVoid && bolehRefund) {
    // Tidak dapat terjadi dengan tabel transisi sekarang, dan ada test yang
    // menjaganya tetap begitu. Kalau seseorang membuka keduanya untuk satu
    // status, sistem tidak lagi bisa "menentukan" seperti dituntut
    // spec-b:235 -- dan menebak diam-diam lebih buruk daripada gagal.
    throw new Error(
      `Status order "${status}" mengizinkan void DAN refund; operasi pembatalan jadi ambigu.`
    );
  }
  if (bolehVoid) {
    return 'void';
  }
  if (bolehRefund) {
    return 'refund';
  }
  throw new Error(`Order berstatus "${status}" tidak dapat dibatalkan.`);
}

/**
 * Alasan wajib ada di daftar tertutup milik operasinya.
 *
 * Daftar void dan refund BERBEDA (`spec-b:290-291`), dan pemeriksaannya
 * memang per operasi: `barang_rusak` bukan alasan yang masuk akal untuk order
 * yang belum pernah diserahkan.
 *
 * `note` hanya wajib untuk `lainnya`. Panjangnya dihitung setelah `trim` dan
 * per titik kode, bukan per unit UTF-16 -- sepuluh spasi lolos hitungan
 * mentah tapi tidak menjelaskan apa pun kepada siapa pun yang membaca laporan
 * exception nanti.
 */
export function assertCancellationReason(
  operation: string,
  reasonCode: string,
  reasonNote?: string | null
): void {
  const daftar = REASONS[operation as CancellationOperation];
  if (daftar === undefined) {
    throw new Error(`Operasi pembatalan tidak dikenal: "${operation}". Harus "void" atau "refund".`);
  }
  if (!daftar.has(reasonCode)) {
    throw new Error(
      `Alasan "${reasonCode}" tidak berlaku untuk ${operation}. Pilihan: ${[...daftar].join(', ')}.`
    );
  }
  if (reasonCode === REASON_OTHER) {
    const isi = (reasonNote ?? '').trim();
    if (Array.from(isi).length < MIN_NOTE_LENGTH) {
      throw new Error(
        `Alasan "${REASON_OTHER}" wajib disertai catatan minimal ${MIN_NOTE_LENGTH} karakter.`
      );
    }
  }
}

export interface RefundLimitState {
  /** Total order, rupiah utuh. */
  orderTotal: bigint;
  /** Jumlah seluruh refund sebelumnya atas order yang sama. */
  alreadyRefunded: bigint;
}

function assertRupiah(value: unknown, label: string): asserts value is bigint {
  if (typeof value !== 'bigint') {
    // Uang tidak pernah float (CLAUDE.md konvensi data). Mengonversi diam-diam
    // akan membuat batas refund dihitung dengan aritmetika yang berbeda dari
    // seluruh jalur uang lainnya.
    throw new TypeError(`${label} harus bigint rupiah utuh, bukan ${typeof value}.`);
  }
}

/**
 * Sisa yang masih boleh direfund.
 *
 * `spec-b:271` menuntut angka ini muncul di penolakan: "ditolak; maksimum
 * yang tersisa Rp 33.600". Karena itu ia fungsi tersendiri dan bukan sekadar
 * detail di dalam assert -- handler memakainya untuk menyusun pesan, dan
 * klien memakainya untuk membatasi input sebelum kasir mengetik.
 */
export function remainingRefundable(state: RefundLimitState): bigint {
  assertRupiah(state.orderTotal, 'orderTotal');
  assertRupiah(state.alreadyRefunded, 'alreadyRefunded');
  if (state.orderTotal < 0n) {
    throw new Error(`orderTotal tidak boleh negatif: ${state.orderTotal}.`);
  }
  if (state.alreadyRefunded < 0n) {
    throw new Error(`alreadyRefunded tidak boleh negatif: ${state.alreadyRefunded}.`);
  }
  if (state.alreadyRefunded > state.orderTotal) {
    // Mengembalikan 0 di sini akan MENYEMBUNYIKAN kebocoran: keadaan ini
    // hanya bisa terjadi kalau batas ini pernah dilewati. Yang dibutuhkan
    // adalah kegagalan yang terlihat, bukan pemulihan diam-diam.
    throw new Error(
      `Invariant bocor: refund terkumpul ${state.alreadyRefunded} melebihi total order ${state.orderTotal}.`
    );
  }
  return state.orderTotal - state.alreadyRefunded;
}

export interface RefundRequest extends RefundLimitState {
  requested: bigint;
}

/**
 * AC FR-B7 ketiga: "Refund kumulatif tidak dapat melebihi total order."
 *
 * Batas ini ditegakkan di domain supaya klien offline menegakkan angka yang
 * sama. Server tetap memeriksanya ulang -- klien tidak dipercaya -- tapi
 * keduanya memanggil fungsi ini, jadi tidak ada dua jawaban yang berbeda.
 */
export function assertRefundWithinLimit(request: RefundRequest): void {
  assertRupiah(request.requested, 'requested');
  const sisa = remainingRefundable(request);
  if (request.requested <= 0n) {
    throw new Error(`Nominal refund harus lebih besar dari nol: ${request.requested}.`);
  }
  if (request.requested > sisa) {
    throw new Error(
      `Refund ${request.requested} melebihi sisa yang tersedia. Maksimum yang tersisa: ${sisa}.`
    );
  }
}
