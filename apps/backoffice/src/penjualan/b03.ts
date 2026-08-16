/**
 * B-03 — aturan tampilan Detail Transaksi.
 *
 * Dipisahkan dari komponen karena yang paling mudah salah di sini adalah
 * aritmetika uang dan penamaan, bukan tata letak.
 */

/** Metode pembayaran, dalam kata yang merchant pakai. */
export const LABEL_METODE: Record<string, string> = {
  cash: 'Tunai',
  qris_dynamic: 'QRIS (dinamis)',
  qris_static: 'QRIS (statis)',
  card_edc: 'Kartu / EDC',
  other: 'Lainnya',
};

/**
 * Status pembayaran.
 *
 * ⛔ `pending_confirmation` TIDAK disebut "gagal" maupun "lunas". Ia keadaan
 * ketiga yang nyata: QRIS yang QR-nya sudah diminta tapi gateway belum
 * menjawab, sementara pelanggan mungkin sudah membayar (FR-C14).
 */
export const LABEL_STATUS_BAYAR: Record<string, string> = {
  confirmed: 'Terkonfirmasi',
  pending_confirmation: 'Menunggu konfirmasi',
  failed: 'Gagal',
  voided: 'Dibatalkan',
};

export function labelMetode(kode: string): string {
  return LABEL_METODE[kode] ?? kode;
}

export function labelStatusBayar(kode: string): string {
  return LABEL_STATUS_BAYAR[kode] ?? kode;
}

/**
 * Kuantitas ×1000 dibuat terbaca.
 *
 * ⛔ Dihitung dari bilangan bulat, tidak pernah lewat pembagian float —
 * `2500 / 1000` menghasilkan `2.5` yang benar, tapi `1 / 3` di kolom lain
 * kelak tidak, dan aturan "jalur uang dan kuantitas tidak menyentuh float"
 * tidak boleh punya pengecualian yang akan disalin.
 */
export function kuantitasTampil(milli: number): string {
  const utuh = Math.trunc(milli / 1000);
  const sisa = Math.abs(milli % 1000);
  if (sisa === 0) return String(utuh);
  return `${utuh},${String(sisa).padStart(3, '0').replace(/0+$/, '')}`;
}

export interface ModifierDetail {
  id: string;
  name: string;
  price: string;
  quantityMilli: number;
}

export interface BarisDetail {
  id: string;
  itemName: string;
  variationName: string;
  unitPrice: string;
  quantityMilli: number;
  discountAmount: string;
  taxAmount: string;
  isTaxInclusive: boolean;
  lineTotal: string;
  modifiers: ModifierDetail[];
}

export interface PembayaranDetail {
  id: string;
  method: string;
  amount: string;
  tenderedAmount: string | null;
  changeAmount: string | null;
  status: string;
  confirmedManually: boolean;
  cardLast4: string | null;
  occurredAt: string;
}

export interface RefundDetail {
  id: string;
  amount: string;
  method: string | null;
  reasonCode: string;
  reasonNote: string | null;
  createdByNama: string;
  approvedByNama: string;
  occurredAt: string;
}

export interface DetailTransaksi {
  id: string;
  receiptNumber: string;
  businessDate: string;
  sequence: number;
  outletId: string;
  channel: string;
  status: string;
  createdBy: string;
  createdByNama: string;
  occurredAt: string;
  subtotal: string;
  orderDiscount: string;
  serviceChargeAmount: string;
  taxAmount: string;
  roundingAdjustment: string;
  total: string;
  amountDue: string;
  hasCalculationVariance: boolean;
  varianceAmount: string | null;
  dibatalkanOleh: string | null;
  dibatalkanPada: string | null;
  lines: BarisDetail[];
  payments: PembayaranDetail[];
  refunds: RefundDetail[];
  totalDibayar: string;
  totalRefund: string;
}

export type KeadaanDetail =
  | { jenis: 'memuat' }
  | { jenis: 'siap'; detail: DetailTransaksi }
  | { jenis: 'galat'; pesan: string };

export interface PesanLayar {
  judul: string;
  badan: string;
}

/**
 * Pesan yang menggantikan isi panel, atau `null` bila detailnya yang dirender.
 *
 * ⛔ "Sedang memuat" dan "tidak ditemukan" tidak boleh terlihat sama. Yang
 * membuka panel ini biasanya sedang melayani pelanggan yang memegang struknya;
 * panel kosong yang sebenarnya masih memuat membuat kasir berkata "transaksi
 * Anda tidak ada di sistem kami".
 */
export function pesanDetail(k: KeadaanDetail): PesanLayar | null {
  if (k.jenis === 'memuat') {
    return { judul: 'Memuat detail…', badan: 'Mengambil rincian transaksi dari server.' };
  }
  if (k.jenis === 'galat') {
    return { judul: 'Detail tidak dapat dimuat', badan: k.pesan };
  }
  return null;
}

/**
 * Baris ringkasan uang, dalam urutan FR-C8 (`spec-c`).
 *
 * ⛔ Baris yang nilainya nol DIBUANG, kecuali subtotal dan total. Struk yang
 * mencantumkan "Diskon Rp 0" dan "Pembulatan Rp 0" untuk setiap transaksi
 * membuat baris yang benar-benar penting tenggelam.
 *
 * ⛔ `total` TIDAK dihitung ulang dari komponen di klien. Server sudah
 * menghitungnya, dan menghitung ulang di sini menciptakan sumber kedua yang
 * akan menyimpang — persis kelas cacat yang `posisi-penjualan.ts` ada untuk
 * mencegahnya.
 */
export function barisRingkasan(d: DetailTransaksi): { label: string; nilai: string }[] {
  const semua: { label: string; nilai: string; selaluTampil?: boolean }[] = [
    { label: 'Subtotal', nilai: d.subtotal, selaluTampil: true },
    { label: 'Diskon', nilai: d.orderDiscount },
    { label: 'Biaya layanan', nilai: d.serviceChargeAmount },
    { label: 'Pajak', nilai: d.taxAmount },
    { label: 'Pembulatan', nilai: d.roundingAdjustment },
    { label: 'Total', nilai: d.total, selaluTampil: true },
  ];
  return semua
    .filter((b) => b.selaluTampil === true || b.nilai !== '0')
    .map(({ label, nilai }) => ({ label, nilai }));
}

/**
 * Sisa yang belum dibayar, sebagai string.
 *
 * ⛔ `bigint`, bukan `Number`. Nilainya berasal dari dua string yang keduanya
 * dapat melampaui 2⁵³, dan selisih yang salah di layar detail adalah angka
 * yang akan dibawa merchant ke pelanggannya.
 */
export function sisaTagihan(d: DetailTransaksi): string {
  try {
    return (BigInt(d.amountDue) - BigInt(d.totalDibayar)).toString();
  } catch {
    return '0';
  }
}
