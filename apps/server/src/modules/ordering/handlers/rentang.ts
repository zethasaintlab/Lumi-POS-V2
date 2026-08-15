import { HttpError } from '../../../http-error.ts';

/**
 * Validasi rentang tanggal bisnis, dipakai SETIAP endpoint laporan.
 *
 * ⛔ Diangkat ke berkas sendiri saat `GET /reports/products` menjadi pemakai
 * kedua. Salinan kedua akan menyimpang tepat pada jebakan yang paling halus di
 * sini — `2026-02-31` lolos regex, dan `Date` menormalkannya jadi 3 Maret
 * secara diam-diam — dan laporan kedua akan menerima rentang yang laporan
 * pertama tolak.
 */

const POLA_TANGGAL = /^\d{4}-\d{2}-\d{2}$/;

export function assertTanggal(nilai: unknown, nama: string): string {
  if (typeof nilai !== 'string' || !POLA_TANGGAL.test(nilai)) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      `Parameter ${nama} harus tanggal bisnis berformat YYYY-MM-DD.`
    );
  }
  const [t, b, h] = nilai.split('-').map(Number);
  const d = new Date(Date.UTC(t, b - 1, h));
  if (d.getUTCFullYear() !== t || d.getUTCMonth() !== b - 1 || d.getUTCDate() !== h) {
    throw new HttpError(400, 'VALIDATION_ERROR', `Parameter ${nama} bukan tanggal yang ada.`);
  }
  return nilai;
}

export interface Rentang {
  from: string;
  to: string;
  outletId: string | null;
}

export function assertRentang(q: { from?: string; to?: string; outlet_id?: string }): Rentang {
  const from = assertTanggal(q.from, 'from');
  const to = assertTanggal(q.to, 'to');

  // ⛔ Ditolak, bukan dijawab nol.
  //
  // Rentang terbalik menghasilkan nol baris, dan nol yang terlihat seperti
  // "tidak ada penjualan" adalah jawaban paling berbahaya yang dapat diberikan
  // laporan. Perbandingan string aman: `YYYY-MM-DD` berurutan leksikografis.
  if (from > to) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Tanggal awal tidak boleh setelah tanggal akhir.');
  }

  return {
    from,
    to,
    outletId: q.outlet_id !== undefined && q.outlet_id !== '' ? q.outlet_id : null,
  };
}
