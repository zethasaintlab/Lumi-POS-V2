import {
  bersihkanTeksPesanan,
  periksaCatatan,
  periksaNamaPemesan,
  periksaNomorMeja,
} from '../../../../packages/domain/src/data-pesanan.ts';
import type { GalatBayar } from '../../../../packages/domain/src/pembayaran-manual.ts';
import type { Keranjang } from './keranjang.ts';

/**
 * Nama pemesan, nomor meja, catatan pesanan (P5(b), P6(a)). Murni.
 *
 * ⛔ Satu sumber: `Keranjang.dataPesanan`, dibaca lewat `dataPesananDari`.
 * Tidak ada parameter paralel di `simpanPenjualan`/`muatanOrder` — pola
 * `kanalDari` (Task 10). Aturan validasinya `packages/domain/src/data-pesanan.ts`,
 * sama dengan server.
 */
export interface DataPesanan {
  namaPemesan: string | null;
  nomorMeja: string | null;
  catatan: string | null;
}

export const DATA_PESANAN_KOSONG: DataPesanan = { namaPemesan: null, nomorMeja: null, catatan: null };

/**
 * Keranjang bentuk lama (tanpa `dataPesanan`) atau berisi sampah → semua `null`.
 * Teks dipangkas dan kosong menjadi `null`: kolom `order` tidak pernah
 * menyimpan string kosong.
 */
export function dataPesananDari(keranjang: Partial<Pick<Keranjang, 'dataPesanan'>>): DataPesanan {
  const d = keranjang.dataPesanan;
  if (typeof d !== 'object' || d === null) return DATA_PESANAN_KOSONG;
  return {
    namaPemesan: bersihkanTeksPesanan(d.namaPemesan),
    nomorMeja: bersihkanTeksPesanan(d.nomorMeja),
    catatan: bersihkanTeksPesanan(d.catatan),
  };
}

/** Galat pertama (urutan: nama, meja, catatan), atau `null` bila semuanya sah. */
export function periksaDataPesanan(d: DataPesanan): GalatBayar | null {
  return periksaNamaPemesan(d.namaPemesan) ?? periksaNomorMeja(d.nomorMeja) ?? periksaCatatan(d.catatan);
}
