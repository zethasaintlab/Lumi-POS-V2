/**
 * B-04 (Laporan Shift) & B-05 (Detail Shift) — aturan layarnya.
 *
 * ## ⛔ Selisih kas adalah angka yang menuduh orang
 *
 * Ia muncul di layar dengan nama kasir di sebelahnya. Karena itu tandanya
 * harus tidak ambigu, kata-katanya harus menyebut ARAH, dan nol harus terbaca
 * sebagai "cocok" — bukan sebagai keadaan yang perlu diselidiki.
 */

/** Selisih = hitungan fisik − saldo seharusnya. Negatif berarti kas KURANG. */
export type ArahSelisih = 'cocok' | 'kurang' | 'lebih' | 'belum';

export function arahSelisih(selisih: string | null): ArahSelisih {
  if (selisih === null) return 'belum';
  let n: bigint;
  try {
    n = BigInt(selisih);
  } catch {
    return 'belum';
  }
  if (n === 0n) return 'cocok';
  return n < 0n ? 'kurang' : 'lebih';
}

/**
 * ⛔ Label SELALU menyertai warna (aturan design system #5).
 *
 * "Kurang" dan "Lebih" bukan sinonim yang dapat ditukar: yang pertama berarti
 * uang hilang dari laci, yang kedua berarti ada uang yang tidak dapat
 * dijelaskan. Keduanya masalah, tapi merchant menanganinya dengan cara yang
 * berbeda.
 */
export const LABEL_SELISIH: Record<ArahSelisih, string> = {
  cocok: 'Cocok',
  kurang: 'Kurang',
  lebih: 'Lebih',
  belum: 'Belum dihitung',
};

export function nadaSelisih(arah: ArahSelisih): 'success' | 'warning' | 'neutral' {
  if (arah === 'cocok') return 'success';
  if (arah === 'belum') return 'neutral';
  return 'warning';
}

/**
 * Nilai mutlak selisih, sebagai string.
 *
 * ⛔ `bigint`, dan tandanya dibuang di sini supaya layar dapat menuliskan
 * "− Rp 50.000" dengan tanda yang ia kendalikan sendiri. `Math.abs` atas
 * `Number` akan merusak presisi rupiah utuh yang endpoint jaga.
 */
export function besaranSelisih(selisih: string | null): string {
  if (selisih === null) return '0';
  try {
    const n = BigInt(selisih);
    return (n < 0n ? -n : n).toString();
  } catch {
    return '0';
  }
}

/** Metode pembayaran dalam kata merchant — sejajar dengan B-03. */
export const LABEL_METODE: Record<string, string> = {
  cash: 'Tunai',
  qris_dynamic: 'QRIS (dinamis)',
  qris_static: 'QRIS (statis)',
  card_edc: 'Kartu / EDC',
  other: 'Lainnya',
};

export function labelMetode(kode: string): string {
  return LABEL_METODE[kode] ?? kode;
}

/** Tipe pergerakan kas non-penjualan. */
export const LABEL_GERAK: Record<string, string> = {
  paid_in: 'Uang masuk',
  paid_out: 'Uang keluar',
  bank_deposit: 'Setoran bank',
  adjustment: 'Koreksi',
  refund: 'Refund tunai',
};

export function labelGerak(kode: string): string {
  return LABEL_GERAK[kode] ?? kode;
}

export interface BarisShift {
  id: string;
  outletId: string;
  deviceId: string;
  businessDate: string;
  status: string;
  openingFloat: string;
  openedBy: string;
  openedByNama: string;
  openedAt: string;
  closedBy: string | null;
  closedByNama: string | null;
  approvedBy: string | null;
  approvedByNama: string | null;
  closedAt: string | null;
  countedAmount: string | null;
  expectedAmount: string | null;
  difference: string | null;
  varianceReasonCode: string | null;
  varianceNote: string | null;
  totalDiterima: string;
  jumlahTransaksi: number;
}

export interface DetailShift extends BarisShift {
  perMetode: { method: string; jumlahTransaksi: number; total: string }[];
  gerakanKas: {
    id: string;
    type: string;
    delta: string;
    reasonCode: string | null;
    note: string | null;
    occurredAt: string;
  }[];
  percobaanHitungan: { hitungan: string; pada: string | null; oleh: string | null }[];
}

export function ringkasShift(daftar: readonly BarisShift[]): {
  jumlah: number;
  bermasalah: number;
} {
  let bermasalah = 0;
  for (const s of daftar) {
    const a = arahSelisih(s.difference);
    if (a === 'kurang' || a === 'lebih') bermasalah += 1;
  }
  return { jumlah: daftar.length, bermasalah };
}

export type Keadaan =
  | { jenis: 'memuat' }
  | { jenis: 'siap'; items: readonly BarisShift[] }
  | { jenis: 'galat'; pesan: string };

export interface PesanLayar {
  judul: string;
  badan: string;
}

/**
 * ⛔ Tiga keadaan dibedakan, dan yang kosong menyebut sebabnya.
 *
 * Shift yang belum ditutup TIDAK muncul secara bawaan, jadi daftar kosong
 * paling sering berarti "belum ada yang ditutup pada rentang ini" — bukan
 * "tidak ada shift". Menyamakannya membuat manajer mengira kasirnya tidak
 * bekerja.
 */
export function pesanKeadaan(keadaan: Keadaan, sertakanTerbuka: boolean): PesanLayar | null {
  if (keadaan.jenis === 'memuat') {
    return { judul: 'Memuat shift…', badan: 'Server sedang mengumpulkan shift pada rentang ini.' };
  }
  if (keadaan.jenis === 'galat') {
    return { judul: 'Laporan shift tidak dapat dimuat', badan: keadaan.pesan };
  }
  if (keadaan.items.length > 0) return null;
  return {
    judul: 'Belum ada shift yang ditutup',
    badan: sertakanTerbuka
      ? 'Tidak ada shift sama sekali pada rentang tanggal ini.'
      : 'Tidak ada shift yang sudah ditutup pada rentang ini. Shift yang masih berjalan belum ' +
        'punya hitungan kas — tekan "Tampilkan shift berjalan" untuk melihatnya.',
  };
}
