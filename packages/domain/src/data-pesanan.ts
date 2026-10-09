import { periksaBukanNomorKartu, type GalatBayar } from './pembayaran-manual.ts';

/**
 * Nama pemesan, nomor meja, catatan pesanan — tiga kolom `order`
 * (keputusan user P5(b) dan P6(a), 28 September 2026; migrasi 0037).
 *
 * Satu aturan untuk perangkat dan server, supaya batasnya tidak menyimpang
 * antara dialog dan kolom CHECK database. Ketiganya field bebas, jadi ketiganya
 * dapat menjadi tempat nomor kartu diketik (FR-C5).
 *
 * Nama saja, tanpa telepon (keputusan user); Q7: ditegakkan lewat label dan
 * satu kolom, BUKAN lewat penolakan pola telepon.
 */

export const MAKS_NAMA_PEMESAN = 40;
/** [ASUMSI] spec § 12 — cukup untuk "4", "A3", "Teras 12". */
export const MAKS_NOMOR_MEJA = 16;
export const MAKS_CATATAN = 140;

/** Trim; kosong atau bukan string → `null` (field opsional, bukan galat). */
export function normalkanTeksPesanan(nilai: unknown): string | null {
  if (typeof nilai !== 'string') return null;
  const t = nilai.trim();
  return t === '' ? null : t;
}

function periksa(nilai: unknown, label: string, maks: number): GalatBayar | null {
  if (nilai === undefined || nilai === null) return null;
  if (typeof nilai !== 'string') {
    return { kode: 'VALIDATION_ERROR', pesan: `${label} harus teks.` };
  }
  const t = nilai.trim();
  if (t === '') return null;
  // Nomor kartu didahulukan atas panjang: ia sinyal yang tak boleh tertutup
  // galat "terlalu panjang" (nomor meja 16 kolom muat PAN berpemisah).
  const kartu = periksaBukanNomorKartu(t, label);
  if (kartu !== null) return kartu;
  if (t.length > maks) {
    return { kode: 'VALIDATION_ERROR', pesan: `${label} maksimal ${maks} karakter.` };
  }
  return null;
}

export function periksaNamaPemesan(nilai: unknown): GalatBayar | null {
  return periksa(nilai, 'Nama pemesan', MAKS_NAMA_PEMESAN);
}

export function periksaNomorMeja(nilai: unknown): GalatBayar | null {
  return periksa(nilai, 'Nomor meja', MAKS_NOMOR_MEJA);
}

export function periksaCatatan(nilai: unknown): GalatBayar | null {
  return periksa(nilai, 'Catatan', MAKS_CATATAN);
}

/** Ketiganya sekaligus; galat pertama menang. Dipakai jalur tulis perangkat. */
export function periksaDataPesanan(d: {
  namaPemesan: unknown;
  nomorMeja: unknown;
  catatan: unknown;
}): GalatBayar | null {
  return periksaNamaPemesan(d.namaPemesan) ?? periksaNomorMeja(d.nomorMeja) ?? periksaCatatan(d.catatan);
}
