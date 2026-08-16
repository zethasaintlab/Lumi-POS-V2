import type { Rentang } from '../laporan/b16.ts';

/**
 * B-02 — aturan layar Riwayat Penjualan.
 *
 * Dipisahkan dari komponen karena tiga hal di sini mustahil diperiksa dengan
 * membaca JSX: kueri yang benar-benar dikirim, tumpukan kursor yang membuat
 * "Sebelumnya" tidak berbohong, dan debounce yang menentukan berapa banyak
 * permintaan berangkat saat kasir mengetik.
 */

/**
 * ⛔ Harus sama persis dengan `STATUS_TERLIHAT` di server.
 *
 * Ada test yang mengimpor keduanya dan membandingkannya. Salinan yang
 * menyimpang membuat layar mengirim status yang server **tolak** — dan
 * penolakannya `400`, bukan daftar kosong, jadi layarnya rusak total alih-alih
 * sekadar kosong.
 */
export const SEMUA_STATUS = ['terjual', 'dibatalkan', 'direfund'] as const;
export type Status = (typeof SEMUA_STATUS)[number];

/** Kata yang merchant pakai, bukan nilai kolom. */
export const LABEL_STATUS: Record<Status, string> = {
  terjual: 'Selesai',
  dibatalkan: 'Dibatalkan',
  direfund: 'Refund',
};

/**
 * Ukuran halaman.
 *
 * 25 baris muat di satu layar tanpa menggulir pada laptop, dan halaman yang
 * menuntut gulir sebelum tombol "Berikutnya" terlihat membuat paginasinya
 * tidak ditemukan orang.
 */
export const PER_HALAMAN = 25;

export interface Penyaring {
  rentang: Rentang;
  outletId: string;
  status: readonly Status[];
  cari: string;
  cursor: string | null;
}

/**
 * Kueri yang dikirim ke `GET /orders`.
 *
 * ⛔ Status diurutkan menurut `SEMUA_STATUS`, bukan menurut urutan klik. Kalau
 * tidak, dua pengguna yang memilih penyaring sama lewat urutan berbeda
 * menghasilkan dua URL berbeda, dan cache mana pun di antaranya
 * memperlakukannya sebagai dua pertanyaan.
 *
 * ⛔ Memilih SEMUA status sama dengan tidak memilih apa pun — parameternya
 * tidak dikirim. Dua keadaan yang hasilnya identik harus menghasilkan satu
 * permintaan yang identik pula.
 */
export function susunKueri(f: Penyaring): string {
  const q = new URLSearchParams({
    from: f.rentang.dari,
    to: f.rentang.sampai,
    limit: String(PER_HALAMAN),
  });

  if (f.outletId.length > 0) q.set('outlet_id', f.outletId);

  const dipilih = SEMUA_STATUS.filter((s) => f.status.includes(s));
  if (dipilih.length > 0 && dipilih.length < SEMUA_STATUS.length) {
    q.set('status', dipilih.join(','));
  }

  const cari = f.cari.trim();
  if (cari.length > 0) q.set('receipt_number', cari);

  if (f.cursor !== null) q.set('cursor', f.cursor);

  return q.toString();
}

/** Pilih atau lepas satu status. */
export function alihkanStatus(dipilih: readonly Status[], s: Status): Status[] {
  return dipilih.includes(s) ? dipilih.filter((x) => x !== s) : [...dipilih, s];
}

// ---------------------------------------------------------------------------
// ⛔ Tumpukan kursor
// ---------------------------------------------------------------------------

export interface Tumpukan {
  /** Kursor untuk halaman 2, 3, … — halaman 1 tidak punya kursor. */
  tumpukan: readonly string[];
  /** 0 = halaman pertama. */
  indeks: number;
}

export const TUMPUKAN_AWAL: Tumpukan = { tumpukan: [], indeks: 0 };

/**
 * Maju satu halaman dengan `cursorBerikut` dari respons.
 *
 * ⛔ Yang disimpan adalah kursor untuk halaman yang AKAN dibuka, dan `indeks`
 * yang menunjuk ke sana. Kesalahan yang mudah adalah membiarkan "Sebelumnya"
 * memakai kursor terakhir — ia menunjuk halaman yang sedang dilihat, jadi
 * "Sebelumnya" mengulang halaman yang sama, selamanya.
 *
 * Tumpukan dipotong di `indeks` supaya maju setelah mundur tidak menyisakan
 * kursor halaman yang sudah ditinggalkan.
 */
export function maju(t: Tumpukan, cursorBerikut: string): Tumpukan {
  const dipotong = t.tumpukan.slice(0, t.indeks);
  return { tumpukan: [...dipotong, cursorBerikut], indeks: t.indeks + 1 };
}

export function mundur(t: Tumpukan): Tumpukan {
  if (t.indeks === 0) return t;
  return { tumpukan: t.tumpukan, indeks: t.indeks - 1 };
}

/** Kursor untuk halaman yang sedang ditampilkan. `null` = halaman pertama. */
export function kursorSekarang(t: Tumpukan): string | null {
  return t.indeks === 0 ? null : (t.tumpukan[t.indeks - 1] ?? null);
}

export function nomorHalaman(t: Tumpukan): number {
  return t.indeks + 1;
}

/**
 * ⛔ Dipanggil setiap kali penyaring berubah.
 *
 * Kursor milik satu penyaring tidak berlaku untuk penyaring lain — ia menunjuk
 * posisi di urutan yang sudah berubah. Halaman yang dihasilkan tidak salah
 * secara acak; ia **melewatkan transaksi secara diam-diam**, dan itu tepat
 * kegagalan yang layar ini tidak boleh punya.
 */
export function aturUlang(_t: Tumpukan): Tumpukan {
  return TUMPUKAN_AWAL;
}

// ---------------------------------------------------------------------------
// Debounce
// ---------------------------------------------------------------------------

export interface TimerPort {
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (h: unknown) => void;
}

export interface Debounced {
  (): void;
  batal(): void;
}

/**
 * Menunda pemanggilan sampai jeda mengetik.
 *
 * ⛔ Timer di-INJECT, sama seperti `fetch` di adapter pembayaran dan lapisan
 * sync. Tanpa itu, satu-satunya cara mengujinya adalah menunggu sungguhan —
 * dan test yang menunggu 300 ms per kasus adalah test yang dimatikan orang.
 *
 * `batal()` ada karena komponen dapat dilepas sementara timernya menyala.
 * Permintaan yang berangkat setelah layar ditutup men-set state pada komponen
 * yang sudah tidak ada.
 */
export function buatDebounce(fn: () => void, ms: number, port: TimerPort): Debounced {
  let pegangan: unknown = null;

  const d = (() => {
    if (pegangan !== null) port.clearTimer(pegangan);
    pegangan = port.setTimer(() => {
      pegangan = null;
      fn();
    }, ms);
  }) as Debounced;

  d.batal = () => {
    if (pegangan !== null) port.clearTimer(pegangan);
    pegangan = null;
  };

  return d;
}

/** Jeda ketik. Cukup panjang untuk satu kata, cukup pendek untuk terasa hidup. */
export const JEDA_KETIK_MS = 350;

// ---------------------------------------------------------------------------
// Keadaan layar
// ---------------------------------------------------------------------------

export interface BarisTransaksi {
  id: string;
  receiptNumber: string;
  businessDate: string;
  sequence: number;
  outletId: string;
  deviceId: string;
  createdBy: string;
  occurredAt: string;
  total: string;
  status: Status;
  dibatalkanOleh: string | null;
  nilaiRefund: string;
  hasCalculationVariance: boolean;
}

export interface Halaman {
  from: string;
  to: string;
  outletId: string | null;
  items: BarisTransaksi[];
  cursorBerikut: string | null;
}

export type Keadaan =
  | { jenis: 'memuat' }
  | { jenis: 'siap'; items: readonly unknown[] }
  | { jenis: 'galat'; pesan: string };

export interface PesanLayar {
  judul: string;
  badan: string;
}

/**
 * Pesan yang menggantikan tabel, atau `null` bila tabelnya yang dirender.
 *
 * ⛔ Tiga keadaan yang tampak sama dan berarti sangat berbeda: "sedang
 * memuat", "tidak ada yang cocok", dan "gagal memuat". Yang kedua adalah
 * jawaban; yang ketiga adalah tidak adanya jawaban. Layar yang menyamakannya
 * membuat kegagalan jaringan terbaca sebagai "transaksinya memang tidak ada" —
 * dan yang membuka layar ini biasanya sedang mencari satu struk tertentu untuk
 * pelanggan yang menunggu di depannya.
 */
export function pesanKeadaan(keadaan: Keadaan): PesanLayar | null {
  if (keadaan.jenis === 'memuat') {
    return { judul: 'Memuat transaksi…', badan: 'Server sedang mengambil halaman ini.' };
  }
  if (keadaan.jenis === 'galat') {
    return { judul: 'Riwayat tidak dapat dimuat', badan: keadaan.pesan };
  }
  if (keadaan.items.length > 0) return null;
  return {
    judul: 'Belum ada transaksi yang sesuai',
    badan:
      'Belum ada transaksi yang sesuai dengan filter ini. Coba lebarkan rentang tanggal, ' +
      'kosongkan pencarian nomor struk, atau pilih lebih banyak status. Perangkat kasir yang ' +
      'belum tersinkronisasi juga belum muncul di sini.',
  };
}
