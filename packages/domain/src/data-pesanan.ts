/**
 * Nama pemesan, nomor meja, dan catatan pesanan — tiga kolom `order`
 * (`0037_order_customer_table_note.sql`; P5(b) dan P6(a), keputusan user
 * 28 September 2026). Dibagi perangkat dan server supaya batasnya satu.
 *
 * Ketiganya opsional: kosong atau spasi saja berarti TIDAK ADA (`null`), bukan
 * galat. Nama saja, tanpa nomor telepon (keputusan user); nomor kartu ditolak
 * di ketiganya karena field bebas mana pun dapat menjadi tempat PAN diketik
 * (FR-C5).
 */
import { periksaBukanNomorKartu, type GalatBayar } from './pembayaran-manual.ts';

export const MAKS_NAMA_PEMESAN = 40;
/** `[ASUMSI]` — keputusan otonom spec § 12; contoh isi: "4", "A3". */
export const MAKS_NOMOR_MEJA = 16;
export const MAKS_CATATAN = 140;

/** Trim; kosong → `null`. Bukan-string → `null` (pemanggil memeriksa lebih dulu). */
export function normalisasiTeksPesanan(nilai: unknown): string | null {
  if (typeof nilai !== 'string') return null;
  const t = nilai.trim();
  return t === '' ? null : t;
}

function periksa(nilai: unknown, label: string, maks: number): GalatBayar | null {
  if (nilai === undefined || nilai === null) return null;
  if (typeof nilai !== 'string') {
    return { kode: 'VALIDATION_ERROR', pesan: `${label} harus berupa teks.` };
  }
  const t = nilai.trim();
  if (t === '') return null;
  // Kartu lebih dulu: "4111 1111 1111 1111" melebihi batas meja, dan sinyal
  // POSSIBLE_CARD_NUMBER tidak boleh tertelan galat panjang.
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
