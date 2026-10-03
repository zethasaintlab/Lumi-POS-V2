import { periksaBukanNomorKartu, type GalatBayar } from './pembayaran-manual.ts';

/**
 * Nama pemesan, nomor meja, dan catatan pesanan (kolom `order.customer_name`,
 * `table_number`, `note`; keputusan user P5(b) dan P6(a), 28 September 2026).
 *
 * ⛔ Di domain karena perangkat dan server harus sepakat: aturan yang hanya
 * hidup di server menjadi penjualan `gagal-permanen` berjam-jam sesudah
 * pelanggan pulang. MENGEMBALIKAN, tidak melempar — pola `pembayaran-manual.ts`.
 *
 * ⛔ NAMA saja, tanpa nomor telepon (keputusan user). Ditegakkan lewat label
 * ("Nama pemesan") dan satu kolom, bukan lewat penolakan pola telepon (Q7).
 */

export const MAKS_NAMA_PEMESAN = 40;
/** `[ASUMSI]` — keputusan otonom spec § 12; belum divalidasi ke merchant. */
export const MAKS_NOMOR_MEJA = 16;
export const MAKS_CATATAN = 140;

/** Trim; kosong → `null` (field opsional, bukan galat). Bukan teks → `null` pula; periksa dulu. */
export function bersihkanTeksPesanan(nilai: unknown): string | null {
  if (typeof nilai !== 'string') return null;
  const t = nilai.trim();
  return t === '' ? null : t;
}

function periksa(nilai: unknown, maks: number, label: string): GalatBayar | null {
  if (nilai === undefined || nilai === null) return null;
  if (typeof nilai !== 'string') {
    return { kode: 'VALIDATION_ERROR', pesan: `${label} harus berupa teks.` };
  }
  const t = nilai.trim();
  if (t === '') return null;
  // ⛔ Karakter kontrol (ESC, GS, LF, NUL, DEL, …) ditolak: teks ini diteruskan ke printer
  // lewat `keAscii`, dan ESC/GS membuka laci atau merusak struk.
  if (/[\u0000-\u001f\u007f-\u009f]/.test(t)) {
    return { kode: 'VALIDATION_ERROR', pesan: `${label} tidak boleh memuat karakter kontrol.` };
  }
  // ⛔ Nomor kartu DULU: yang berpemisah melewati batas meja (16) dan akan
  // terbaca "kepanjangan" — kehilangan satu-satunya sinyal bahwa seseorang
  // mengetik data kartu ke POS.
  const kartu = periksaBukanNomorKartu(t, label);
  if (kartu !== null) return kartu;
  if (t.length > maks) {
    return { kode: 'VALIDATION_ERROR', pesan: `${label} paling banyak ${maks} karakter.` };
  }
  return null;
}

export function periksaNamaPemesan(nilai: unknown): GalatBayar | null {
  return periksa(nilai, MAKS_NAMA_PEMESAN, 'Nama pemesan');
}

export function periksaNomorMeja(nilai: unknown): GalatBayar | null {
  return periksa(nilai, MAKS_NOMOR_MEJA, 'Nomor meja');
}

export function periksaCatatan(nilai: unknown): GalatBayar | null {
  return periksa(nilai, MAKS_CATATAN, 'Catatan');
}
