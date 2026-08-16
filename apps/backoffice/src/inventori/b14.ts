import { bacaKuantitas, kuantitasTampil } from './b12.ts';

/**
 * B-14 — aturan layar Opname (FR-E7).
 *
 * ## ⛔ Selisih di layar dihitung terhadap `expectedQty` yang server kirim
 *
 * `expectedQty` adalah saldo pada waktu T, dibekukan server. Layar **tidak
 * boleh** menghitungnya ulang dari daftar stok yang sedang tampil — daftar itu
 * memuat saldo SEKARANG, dan penjualan yang terjadi selama opname akan membuat
 * selisih di layar berbeda dari selisih yang server catat.
 */

export type StatusOpname = 'draft' | 'counting' | 'approved';

export const LABEL_STATUS_OPNAME: Record<string, string> = {
  draft: 'Draf',
  counting: 'Sedang dihitung',
  approved: 'Selesai',
};

export function labelStatusOpname(kode: string): string {
  return LABEL_STATUS_OPNAME[kode] ?? kode;
}

export function nadaStatusOpname(kode: string): 'success' | 'warning' | 'neutral' {
  if (kode === 'approved') return 'success';
  if (kode === 'counting') return 'warning';
  return 'neutral';
}

export interface RingkasOpname {
  id: string;
  outletId: string;
  status: string;
  snapshotAt: string | null;
  startedBy: string;
  startedByNama: string;
  approvedBy: string | null;
  approvedByNama: string | null;
  jumlahBaris: number;
  jumlahDihitung: number;
  jumlahBerselisih: number;
}

export interface BarisOpname {
  variationId: string;
  itemName: string;
  variationName: string;
  expectedQty: string;
  countedQty: string | null;
  selisih: string | null;
  reasonCode: string | null;
}

export interface DetailOpname {
  id: string;
  outletId: string;
  status: string;
  snapshotAt: string | null;
  startedBy: string;
  startedByNama: string;
  approvedBy: string | null;
  approvedByNama: string | null;
  lines: BarisOpname[];
}

/** Arah selisih opname. Sama bentuknya dengan selisih kas, sengaja. */
export type ArahSelisihStok = 'cocok' | 'kurang' | 'lebih' | 'belum';

export function arahSelisihStok(selisih: string | null): ArahSelisihStok {
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
 * ⛔ "Kurang" dan "Lebih" tidak pernah ditukar.
 *
 * Kurang berarti barang fisik lebih sedikit daripada catatan — susut, hilang,
 * atau penjualan yang tidak tercatat. Lebih berarti ada barang yang tidak
 * diketahui asalnya. Keduanya masalah, dan merchant menanganinya dengan cara
 * yang berbeda.
 */
export const LABEL_SELISIH_STOK: Record<ArahSelisihStok, string> = {
  cocok: 'Cocok',
  kurang: 'Kurang',
  lebih: 'Lebih',
  belum: 'Belum dihitung',
};

export function nadaSelisihStok(arah: ArahSelisihStok): 'success' | 'warning' | 'neutral' {
  if (arah === 'cocok') return 'success';
  if (arah === 'belum') return 'neutral';
  return 'warning';
}

/** Selisih terbaca manusia, dengan tandanya sendiri. */
export function selisihTampil(selisih: string | null): string {
  if (selisih === null) return '—';
  let n: bigint;
  try {
    n = BigInt(selisih);
  } catch {
    return '—';
  }
  if (n === 0n) return '0';
  const abs = n < 0n ? -n : n;
  return `${n < 0n ? '−' : '+'} ${kuantitasTampil(abs)}`;
}

export interface IsianHitung {
  variationId: string;
  /** Apa yang diketik merchant, apa adanya. */
  teks: string;
}

export interface GalatBaris {
  variationId: string;
  pesan: string;
}

/**
 * Menyiapkan muatan `PUT .../lines`.
 *
 * ⛔ Baris yang KOSONG dilewati, bukan dikirim sebagai nol. Kosong berarti
 * "belum dihitung"; nol berarti "dihitung, hasilnya tidak ada". Mengirim yang
 * pertama sebagai yang kedua akan menghapus seluruh stok barang yang petugas
 * belum sempat hitung — dan opname yang menyelesaikan diri sendiri seperti itu
 * adalah cara tercepat menghancurkan catatan stok.
 */
export function susunBarisHitung(isian: readonly IsianHitung[]): {
  lines: { variationId: string; countedQty: string }[];
  galat: GalatBaris[];
} {
  const lines: { variationId: string; countedQty: string }[] = [];
  const galat: GalatBaris[] = [];

  for (const i of isian) {
    const teks = i.teks.trim();
    if (teks === '') continue; // Belum dihitung — dilewati, bukan dikirim nol.

    // ⛔ `bacaKuantitas` menolak nol; opname justru MEMBUTUHKANNYA — "dihitung,
    // hasilnya nol" adalah temuan yang sah dan sering. Nol karena itu
    // ditangani di sini, sebelum fungsi itu dipanggil.
    if (/^0+([.,]0+)?$/.test(teks)) {
      lines.push({ variationId: i.variationId, countedQty: '0' });
      continue;
    }

    const milli = bacaKuantitas(teks);
    if (milli === null || milli.startsWith('-')) {
      galat.push({
        variationId: i.variationId,
        pesan: 'Isi jumlah fisik, misalnya 10 atau 2,5. Tidak boleh negatif.',
      });
      continue;
    }
    lines.push({ variationId: i.variationId, countedQty: milli });
  }

  return { lines, galat };
}

/** Ringkasan untuk tombol "Selesaikan". */
export function ringkasHitungan(lines: readonly BarisOpname[]): {
  total: number;
  dihitung: number;
  berselisih: number;
} {
  let dihitung = 0;
  let berselisih = 0;
  for (const l of lines) {
    if (l.countedQty === null) continue;
    dihitung += 1;
    if (arahSelisihStok(l.selisih) !== 'cocok') berselisih += 1;
  }
  return { total: lines.length, dihitung, berselisih };
}
