/**
 * B-17 — Laporan Produk. Murni.
 *
 * ## ⛔ Operasional, bukan finansial
 *
 * `nilaiKotor` **bukan omzet**. Ia nilai barang yang keluar — sebelum diskon
 * baris, sebelum pajak, dan sebelum refund. Omzet punya satu definisi tunggal
 * di `packages/domain/src/posisi-penjualan.ts`, dan angka ini tidak akan sama
 * dengannya.
 *
 * Layar harus menyatakannya. Dua angka berbeda yang memakai satu nama adalah
 * cara tercepat menghancurkan kepercayaan pada laporan — `spec-g:29` menyebut
 * akibatnya dengan kata-kata itu.
 *
 * ## ⛔ Rentang tanggal DIPAKAI ULANG dari B-16
 *
 * `setelRentang` dan `rentangSiap` di-re-export, bukan ditulis lagi. Dua
 * pemilih rentang yang menyimpang akan membuat satu laporan menerima rentang
 * yang laporan lain tolak — di aplikasi yang sama, pada hari yang sama.
 */

export { setelRentang, rentangSiap, type Rentang } from './b16.ts';

export interface BarisProduk {
  variationId: string;
  itemName: string;
  variationName: string;
  /** INTEGER ×1000 sebagai string — `bigint` di database. */
  kuantitas: string;
  /** Bentuk desimalnya, dihitung server. */
  kuantitasTampil: string;
  /** Rupiah utuh sebagai string. */
  nilaiKotor: string;
}

/** `BigInt` yang tidak pernah melempar — baris cacat tidak menjatuhkan layar. */
function keBigInt(nilai: string): bigint {
  try {
    return BigInt(String(nilai ?? '').trim() || '0');
  } catch {
    return 0n;
  }
}

/**
 * Terlaris di atas, lalu nama.
 *
 * ⛔ Server sudah mengurutkannya, dan itu benar. Tapi jaminan yang **hanya**
 * hidup di SQL tidak dapat diuji sama sekali (`CLAUDE.md`) — dan "terlaris di
 * atas" adalah seluruh gunanya laporan ini.
 *
 * ⛔ Dibandingkan sebagai `bigint`. Perbandingan string menempatkan `"9000"`
 * di atas `"10000"` — sembilan gelas terlihat lebih laris daripada sepuluh —
 * dan `Number` membuang presisi pada kuantitas besar.
 */
export function urutkanProduk(semua: readonly BarisProduk[]): BarisProduk[] {
  return [...semua].sort((a, b) => {
    const qa = keBigInt(a.kuantitas);
    const qb = keBigInt(b.kuantitas);
    if (qa !== qb) return qb > qa ? 1 : -1;
    return a.itemName.localeCompare(b.itemName, 'id');
  });
}

export interface TotalProduk {
  kuantitas: string;
  kuantitasTampil: string;
  nilaiKotor: string;
  jumlahVarian: number;
}

/** `2000` → `"2"`, `500` → `"0,5"`. Lewat `bigint`, bukan `Number(x) / 1000`. */
function tampilkanKuantitas(skala: bigint): string {
  const negatif = skala < 0n;
  const abs = negatif ? -skala : skala;
  const utuh = abs / 1000n;
  const sisa = (abs % 1000n).toString().padStart(3, '0').replace(/0+$/, '');
  const teks = sisa.length > 0 ? `${utuh},${sisa}` : utuh.toString();
  return negatif ? `−${teks}` : teks;
}

/**
 * Baris total.
 *
 * ⛔ Dijumlahkan lewat `bigint`. `Number` di sini membuang presisi tepat pada
 * laporan bulanan — angka yang paling sering dilihat, dan yang paling besar.
 */
export function totalProduk(semua: readonly BarisProduk[]): TotalProduk {
  let kuantitas = 0n;
  let nilaiKotor = 0n;
  for (const b of semua) {
    kuantitas += keBigInt(b.kuantitas);
    nilaiKotor += keBigInt(b.nilaiKotor);
  }
  return {
    kuantitas: kuantitas.toString(),
    kuantitasTampil: tampilkanKuantitas(kuantitas),
    nilaiKotor: nilaiKotor.toString(),
    jumlahVarian: semua.length,
  };
}

/**
 * Nama gabungan.
 *
 * ⛔ Varian disebut hanya bila ia MENAMBAH informasi. "Kopi Susu · Regular"
 * berguna; "Kopi Susu · Kopi Susu" tidak — dan bentuk itu muncul nyata dari
 * impor katalog yang tidak menyebut varian, karena `POST /items` menuntut
 * minimal satu varian dan importer memberinya nama produknya.
 */
export function namaLengkap(b: BarisProduk): string {
  const varian = String(b.variationName ?? '').trim();
  if (varian.length === 0 || varian === b.itemName) return b.itemName;
  return `${b.itemName} · ${varian}`;
}

/**
 * ⛔ Kosong dibedakan dari galat, sama seperti B-16.
 *
 * Periode tanpa penjualan bukan kegagalan. Menampilkannya sebagai error
 * membuat merchant mengira laporannya rusak di hari libur.
 */
export function periodeKosong(semua: readonly BarisProduk[]): boolean {
  return semua.length === 0;
}
