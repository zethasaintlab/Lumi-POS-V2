import { periksaBukanNomorKartu, type GalatBayar } from './pembayaran-manual.ts';

/**
 * Nama pemesan, nomor meja, dan catatan pesanan (P5(b) + P6(a), keputusan user
 * 28 September 2026): tiga kolom opsional `order.customer_name`,
 * `order.table_number`, `order.note`. Dibagi perangkat dan server, supaya
 * kasir tidak menerima di layar apa yang server tolak berjam-jam kemudian.
 *
 * Batasnya juga CHECK di `db/migrations/0037_order_customer_table_note.sql`;
 * `tests/ordering/data-pesanan.test.js` membuktikan keduanya sepakat.
 *
 * ⛔ Nama SAJA, tanpa nomor telepon (keputusan user). Ditegakkan lewat label
 * dan satu kolom, bukan pola — penolakan pola telepon adalah Q7, terbuka.
 * `MAKS_NOMOR_MEJA = 16` adalah `[ASUMSI]` (spec § 12): "4", "A3", "Teras 2".
 *
 * ⛔ Panjang dihitung per CODE POINT, sama dengan `length()` PostgreSQL;
 * `.length` JS menghitung unit UTF-16 dan menolak 20 emoji yang CHECK terima.
 */
export const MAKS_NAMA_PEMESAN = 40;
export const MAKS_NOMOR_MEJA = 16;
export const MAKS_CATATAN = 140;

/** Trim; kosong → `null`. Nilai bukan string → `null` (tolak lewat `periksa*`). */
export function bersihkanTeksPesanan(nilai: unknown): string | null {
  if (typeof nilai !== 'string') return null;
  const t = nilai.trim();
  return t === '' ? null : t;
}

/**
 * ⛔ Karakter kendali ditolak. NUL membuat PostgreSQL menjawab 500 (`text` tidak
 * dapat memuat `\u0000`), dan baris baru/C1 merusak struk 32 kolom.
 */
function adaKarakterKendali(t: string): boolean {
  for (const c of t) {
    const k = c.codePointAt(0) ?? 0;
    if (k <= 0x1f || (k >= 0x7f && k <= 0x9f)) return true;
  }
  return false;
}

function periksa(nilai: unknown, label: string, maks: number): GalatBayar | null {
  if (nilai === null || nilai === undefined) return null;
  if (typeof nilai !== 'string') {
    return { kode: 'VALIDATION_ERROR', pesan: `${label} harus berupa teks.` };
  }
  const t = nilai.trim();
  if (t === '') return null;
  if (adaKarakterKendali(t)) {
    return { kode: 'VALIDATION_ERROR', pesan: `${label} memuat karakter yang tidak diizinkan.` };
  }
  if (Array.from(t).length > maks) {
    return { kode: 'VALIDATION_ERROR', pesan: `${label} maksimal ${maks} karakter.` };
  }
  return periksaBukanNomorKartu(t, label);
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
