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
  /**
   * Kolom margin — ADA hanya bila `HasilLaporan.margin` bernilai `true`.
   *
   * ⛔ Opsional di TIPE, bukan `string | null`. Server menghilangkan kuncinya
   * untuk yang tidak berhak (`spec-g:99`), dan tipe yang menuntutnya selalu
   * ada akan membuat layar merender "null" alih-alih tidak merender kolomnya.
   */
  hpp?: string;
  margin?: string;
  marginPersen?: number | null;
  barisTanpaHpp?: number;
  jumlahBaris?: number;
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
  /** Total HPP dan margin — `null` bila kolomnya tidak ada di data. */
  hpp: string | null;
  margin: string | null;
  /** Berapa baris di SELURUH laporan yang HPP-nya nol saat terjual. */
  barisTanpaHpp: number;
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
  let hpp = 0n;
  let barisTanpaHpp = 0;
  // ⛔ Kolom margin ada atau tidak ada untuk SELURUH laporan — server
  // memutuskannya sekali per permintaan. Diperiksa dari baris pertama yang
  // punya, bukan diasumsikan: laporan kosong tidak punya baris sama sekali,
  // dan totalnya harus tetap `null` alih-alih nol yang mengaku ada datanya.
  const adaMargin = semua.some((b) => b.hpp !== undefined);

  for (const b of semua) {
    kuantitas += keBigInt(b.kuantitas);
    nilaiKotor += keBigInt(b.nilaiKotor);
    if (b.hpp !== undefined) hpp += keBigInt(b.hpp);
    barisTanpaHpp += b.barisTanpaHpp ?? 0;
  }

  return {
    kuantitas: kuantitas.toString(),
    kuantitasTampil: tampilkanKuantitas(kuantitas),
    nilaiKotor: nilaiKotor.toString(),
    jumlahVarian: semua.length,
    hpp: adaMargin ? hpp.toString() : null,
    // ⛔ Total margin dihitung dari TOTAL, bukan dijumlahkan dari margin per
    // baris. Keduanya sama hari ini; menjumlahkan per baris menjadi salah pada
    // hari sebuah baris dibulatkan, dan yang salah tidak akan terlihat karena
    // selisihnya kecil.
    margin: adaMargin ? (nilaiKotor - hpp).toString() : null,
    barisTanpaHpp,
  };
}

/**
 * Margin sebagai kalimat persen.
 *
 * ⛔ `null` (nilai kotor nol) TIDAK ditampilkan sebagai "0%". Produk yang
 * seluruhnya terjual dengan potongan penuh tidak punya margin persen yang
 * berarti, dan "0%" untuknya adalah pernyataan yang salah.
 *
 * ⛔ Angka NEGATIF membawa katanya. "−60%" di kolom bernama "Margin" dibaca
 * sekilas sebagai enam puluh persen, dan baris yang rugi adalah tepat baris
 * yang paling perlu dilihat owner.
 */
export function marginPersenTampil(persen: number | null | undefined): string {
  if (persen === null || persen === undefined) return '—';
  const angka = Math.abs(persen).toFixed(1).replace('.', ',');
  if (persen < 0) return `${angka}% rugi`;
  return `${angka}%`;
}

/**
 * ⛔ Kalimat yang menyatakan berapa baris terjual TANPA HPP.
 *
 * Nol dapat berarti "merchant belum mengisi HPP" atau "produknya memang tidak
 * berbiaya", dan keduanya menghasilkan margin 100% yang terlihat meyakinkan.
 * Laporan yang tidak menyebutkannya akan dipercaya — dan owner memutuskan
 * harga jual berdasarkan margin karangan.
 *
 * `null` bila tidak ada satu pun: kalimat peringatan yang selalu tampil
 * berhenti dibaca.
 */
export function catatanHppKosong(total: TotalProduk): string | null {
  if (total.barisTanpaHpp <= 0) return null;
  return (
    `${total.barisTanpaHpp} baris penjualan terjual tanpa HPP tercatat. ` +
    'Marginnya dihitung seolah barangnya tidak berbiaya, jadi angka di bawah lebih tinggi dari yang sebenarnya.'
  );
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
