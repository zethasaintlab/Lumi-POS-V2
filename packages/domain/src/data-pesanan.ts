/**
 * Nama pemesan, nomor meja, dan catatan pesanan — tiga kolom `order`
 * (migrasi `0037`; keputusan user P5 dan P6, 28 September 2026).
 *
 * ⛔ Di domain karena perangkat dan server harus sepakat: penjualan offline
 * yang lolos di layar tetapi ditolak server menjadi baris outbox
 * `gagal-permanen` berjam-jam kemudian, setelah uangnya diterima.
 *
 * Opsional: kosong atau spasi saja berarti "tidak diisi" (`null`), bukan galat.
 * Ketiganya field bebas, jadi nomor kartu ditolak di sini (FR-C5).
 * Nama saja, tanpa nomor telepon (P5): ditegakkan lewat label dan satu kolom,
 * tidak lewat pola (Q7).
 */
import { periksaBukanNomorKartu, type GalatBayar } from './pembayaran-manual.ts';

export const MAKS_NAMA_PEMESAN = 40;
/** [ASUMSI] keputusan otonom spec kasir § 12 — belum divalidasi ke merchant. */
export const MAKS_NOMOR_MEJA = 16;
export const MAKS_CATATAN = 140;

function periksa(nilai: unknown, nama: string, label: string, maks: number): GalatBayar | null {
  if (nilai === undefined || nilai === null) return null;
  if (typeof nilai !== 'string') {
    return { kode: 'VALIDATION_ERROR', pesan: `${nama} harus berupa teks.` };
  }
  const teks = nilai.trim();
  if (teks === '') return null;
  // Nomor kartu didahulukan dari panjang: satu-satunya sinyal bahwa seseorang
  // mengetik data kartu ke POS tidak boleh tertutup galat "terlalu panjang".
  const kartu = periksaBukanNomorKartu(teks, label);
  if (kartu !== null) return kartu;
  if (teks.length > maks) {
    return { kode: 'VALIDATION_ERROR', pesan: `${nama} paling banyak ${maks} karakter.` };
  }
  return null;
}

export function periksaNamaPemesan(nilai: unknown): GalatBayar | null {
  return periksa(nilai, 'Nama pemesan', 'nama pemesan', MAKS_NAMA_PEMESAN);
}

export function periksaNomorMeja(nilai: unknown): GalatBayar | null {
  return periksa(nilai, 'Nomor meja', 'nomor meja', MAKS_NOMOR_MEJA);
}

export function periksaCatatan(nilai: unknown): GalatBayar | null {
  return periksa(nilai, 'Catatan', 'catatan', MAKS_CATATAN);
}

/** Bentuk yang disimpan: dipangkas, kosong menjadi `null`. */
export function bersihkanTeksPesanan(nilai: unknown): string | null {
  if (typeof nilai !== 'string') return null;
  const teks = nilai.trim();
  return teks === '' ? null : teks;
}
