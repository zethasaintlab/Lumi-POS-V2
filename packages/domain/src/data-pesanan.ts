/**
 * Data pesanan: nama pemesan, nomor meja, catatan — tiga kolom `order`
 * (migrasi 0037; keputusan user P5(b) dan P6(a), 28 September 2026).
 *
 * Dibagi perangkat dan server supaya aturannya satu: perangkat menolak di
 * dialog, server menolak di `POST /orders`. Ketiganya OPSIONAL — kosong adalah
 * `null`, bukan galat.
 *
 * ⛔ Nama saja, tanpa telepon (keputusan user). Ditegakkan lewat label dan
 * satu kolom, BUKAN lewat pola telepon (Q7 terbuka, tidak ada penolakan pola).
 * Yang ditolak hanya nomor kartu (FR-C5): field bebas mana pun dapat menjadi
 * tempat PAN diketik.
 *
 * `MAKS_NOMOR_MEJA = 16` adalah [ASUMSI] (spec kasir § 12).
 */
import { periksaBukanNomorKartu, type GalatBayar } from './pembayaran-manual.ts';

export const MAKS_NAMA_PEMESAN = 40;
export const MAKS_NOMOR_MEJA = 16;
export const MAKS_CATATAN = 140;

/** Trim; kosong atau bukan string → `null`. */
export function rapikanDataPesanan(nilai: unknown): string | null {
  if (typeof nilai !== 'string') return null;
  const t = nilai.trim();
  return t.length === 0 ? null : t;
}

/** U+0000–U+001F dan U+007F. Tanpa regex: `no-control-regex` menolak rentang itu. */
function adaKarakterKendali(teks: string): boolean {
  for (let i = 0; i < teks.length; i += 1) {
    const c = teks.charCodeAt(i);
    if (c <= 0x1f || c === 0x7f) return true;
  }
  return false;
}

function periksa(nilai: unknown, maks: number, label: string): GalatBayar | null {
  if (nilai === undefined || nilai === null) return null;
  if (typeof nilai !== 'string') {
    return { kode: 'VALIDATION_ERROR', pesan: `${label} harus berupa teks.` };
  }
  const t = nilai.trim();
  if (t.length === 0) return null;
  // ⛔ Karakter kendali (NUL, ESC, CR/LF, TAB, DEL) merusak byte ESC/POS struk dan
  // kolom teks; teks satu baris tidak butuh satu pun.
  if (adaKarakterKendali(t)) {
    return { kode: 'VALIDATION_ERROR', pesan: `${label} tidak boleh memuat karakter kendali.` };
  }
  // Nomor kartu diperiksa LEBIH DULU: sinyal POSSIBLE_CARD_NUMBER tidak boleh
  // tertutup galat panjang (PAN berpemisah melebihi batas nomor meja).
  const kartu = periksaBukanNomorKartu(t, label);
  if (kartu !== null) return kartu;
  if (t.length > maks) {
    return { kode: 'VALIDATION_ERROR', pesan: `${label} maksimal ${maks} karakter.` };
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
