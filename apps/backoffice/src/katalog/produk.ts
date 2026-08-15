/**
 * B-06/B-07 — muatan produk dan variation. Murni: form masuk, muatan keluar.
 *
 * ## ⛔ `item_variation.price` BEKU setelah variation dibuat
 *
 * `updateItemVariation` **tidak menerima `price`** — lihat
 * `packages/contracts/openapi.yaml`. Itu permanen, bukan penundaan
 * (`CLAUDE.md` § keputusan katalog): harga awal adalah anak tangga paling
 * bawah resolusi tiga tingkat, dan setiap perubahan hidup di `price_history`
 * (layar B-10).
 *
 * Konsekuensinya untuk layar, dan ini yang harus dibaca sebelum menyunting
 * berkas ini: **B-07 tidak boleh menampilkan field harga yang dapat diketik
 * untuk variation yang sudah ada.** Field yang terlihat dapat disunting lalu
 * diam-diam tidak terkirim adalah kebohongan antarmuka — merchant mengira
 * harganya sudah naik, kasir tetap menagih harga lama, dan tidak ada satu pun
 * error di mana pun.
 *
 * `buatMuatanVariationUbah` karena itu TIDAK menyalin `price`, dan ada test
 * yang menurunkan daftar kunci yang sah dari kontrak OpenAPI itu sendiri.
 *
 * ## ⛔ `conversionFactor` adalah DESIMAL di sini, bukan ×1000
 *
 * API menerimanya sebagai `number` (0,5). Skala ×1000 adalah bentuk kolom di
 * skema **SQLite lokal**, dan konversinya terjadi di `put` raw table pada
 * jalur turun (`CLAUDE.md`). Mengalikannya di sini berarti menulis `500` ke
 * kolom `numeric` PostgreSQL — 1000× terlalu besar, dan stok setiap penjualan
 * ikut salah sebesar itu.
 */

export interface ItemVariation {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  price: number | bigint | string;
  stockingUnit?: string;
  sellingUnit?: string;
  conversionFactor?: number;
  trackStock?: boolean;
  archivedAt: string | null;
}

export interface Item {
  id: string;
  name: string;
  categoryId: string | null;
  description?: string | null;
  sortOrder: number;
  archivedAt: string | null;
  variations: ItemVariation[];
  modifierLists: { id: string; name: string; archivedAt?: string | null }[];
}

/* ------------------------------------------------------------------ uang -- */

/**
 * `Rp 1.847.000` — titik ribuan, tanpa desimal (`CLAUDE.md`).
 *
 * ⛔ Menerima `bigint`, `number`, DAN `string`. Uang adalah bigint rupiah utuh
 * di server; JSON membawanya sebagai number; kolom INTEGER besar dapat datang
 * sebagai bigint atau string tergantung driver — temuan `@powersync/web` yang
 * sudah tercatat. Guard yang hanya memeriksa `number` tidak pernah mengambil
 * cabangnya, dan itu hijau di test sambil salah di aplikasi.
 */
export function rupiah(nilai: number | bigint | string): string {
  // ⛔ STRING diubah lewat `BigInt` LANGSUNG, tidak lewat `Number`.
  //
  // Versi pertama menulis `BigInt(Math.trunc(Number(nilai) || 0))` untuk
  // semua bentuk non-bigint. Itu benar untuk harga produk — dan membuang
  // presisi tepat pada nilai yang `GET /reports/sales` kirim sebagai string
  // justru untuk menjaganya: `Number('9007199254740993')` menghasilkan
  // …992, satu rupiah hilang tanpa satu pun error.
  //
  // Endpoint laporan mengirim uang sebagai string karena `PosisiPenjualan`
  // memakai `bigint`. Mengubahnya kembali jadi `number` di titik tampilan
  // membatalkan seluruh alasan itu.
  let n: bigint;
  try {
    if (typeof nilai === 'bigint') n = nilai;
    else if (typeof nilai === 'number') n = BigInt(Math.trunc(nilai));
    else {
      const teks = String(nilai).trim();
      // ⛔ `BigInt('')` mengembalikan **0n**, tidak melempar — berbeda dari
      // `BigInt('abc')`. Nilai yang hilang karena itu akan tampil sebagai
      // "Rp 0" yang meyakinkan, dan merchant membacanya sebagai penjualan nol
      // alih-alih data yang tidak sampai.
      if (teks.length === 0) return 'Rp —';
      n = BigInt(teks);
    }
  } catch {
    // `BigInt('abc')` MELEMPAR, tidak seperti `Number('abc')` yang
    // menghasilkan NaN diam-diam. Layar yang jatuh karena satu field tak
    // terduga lebih buruk daripada layar yang menampilkan tanda tanya.
    return 'Rp —';
  }

  const negatif = n < 0n;
  const teks = (negatif ? -n : n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  // `−` (U+2212), bukan hyphen — format yang `CLAUDE.md` tetapkan untuk nilai
  // negatif adalah `− Rp 8.000`.
  return negatif ? `− Rp ${teks}` : `Rp ${teks}`;
}

/**
 * Angka rupiah yang diketik manusia → integer, atau `null`.
 *
 * ⛔ `null`, bukan `NaN` dan bukan `0`. `Number('')` adalah **0**, dan harga 0
 * yang lahir dari field kosong adalah produk yang dijual gratis — kegagalan
 * yang tidak menghasilkan error dan baru terlihat di laporan.
 *
 * Nol yang benar-benar DIKETIK tetap diterima: produk gratis itu sah.
 */
export function bacaRupiah(teks: string): number | null {
  // ⛔ Bentuknya diperiksa SEBELUM titik dibuang, bukan sesudah.
  //
  // Versi pertama membuang setiap titik lalu memeriksa sisanya. `25.5` —
  // desimal, yang tidak sah untuk rupiah — menjadi `255`: diterima, dan
  // **salah 10×**. Ditemukan test, bukan review.
  //
  // Titik hanya sah sebagai pemisah RIBUAN, yaitu dalam kelompok tepat tiga
  // digit. Spasi dibuang lebih dulu karena ia tidak pernah menjadi pemisah
  // desimal.
  const bersih = String(teks ?? '')
    .replace(/rp/gi, '')
    .replace(/\s/g, '')
    .trim();
  if (bersih.length === 0) return null;

  const polos = /^\d+$/;
  const berkelompok = /^\d{1,3}(\.\d{3})+$/;
  if (!polos.test(bersih) && !berkelompok.test(bersih)) return null;

  return Number.parseInt(bersih.replace(/\./g, ''), 10);
}

/** `0,5` maupun `0.5`. Papan ketik Indonesia menulis yang pertama. */
function bacaDesimal(teks: string): number | null {
  const bersih = String(teks ?? '').replace(',', '.').trim();
  if (bersih.length === 0) return null;
  if (!/^\d*\.?\d+$/.test(bersih)) return null;
  const n = Number.parseFloat(bersih);
  return Number.isFinite(n) ? n : null;
}

/* ------------------------------------------------------------------ item -- */

export interface FormItem {
  nama: string;
  categoryId: string;
  deskripsi: string;
  sortOrder: string;
}

export type Hasil<T, B> = { ok: true; muatan: T } | { ok: false; bidang: B; pesan: string };

export function buatMuatanItem(
  form: FormItem,
  id: string
): Hasil<
  { id: string; name: string; categoryId: string | null; description: string | null; sortOrder: number },
  keyof FormItem
> {
  const nama = String(form.nama ?? '').trim();
  if (nama.length === 0) {
    return { ok: false, bidang: 'nama', pesan: 'Nama produk wajib diisi.' };
  }

  const urutan = Number.parseInt(String(form.sortOrder ?? '0'), 10);
  if (!Number.isFinite(urutan) || urutan < 0) {
    return { ok: false, bidang: 'sortOrder', pesan: 'Urutan harus angka 0 atau lebih.' };
  }

  const kategori = String(form.categoryId ?? '').trim();
  const deskripsi = String(form.deskripsi ?? '').trim();

  return {
    ok: true,
    muatan: {
      id,
      name: nama,
      // `null`, bukan string kosong — kolomnya nullable, dan `categoryId: ''`
      // adalah FK ke kategori bernama kosong yang server tolak 404.
      categoryId: kategori.length > 0 ? kategori : null,
      description: deskripsi.length > 0 ? deskripsi : null,
      sortOrder: urutan,
    },
  };
}

/* ------------------------------------------------------------- variation -- */

export interface FormVariation {
  nama: string;
  sku: string;
  barcode: string;
  /** ⛔ Hanya dipakai saat MEMBUAT. Diabaikan sepenuhnya saat mengubah. */
  harga: string;
  stockingUnit: string;
  sellingUnit: string;
  conversionFactor: string;
  trackStock: boolean;
}

interface MuatanVariationUbah {
  name: string;
  sku: string | null;
  barcode: string | null;
  stockingUnit: string;
  sellingUnit: string;
  conversionFactor: number;
  trackStock: boolean;
}

type MuatanVariationBaru = MuatanVariationUbah & { id: string; price: number };

function bagianBersama(
  form: FormVariation
): Hasil<MuatanVariationUbah, keyof FormVariation> {
  const nama = String(form.nama ?? '').trim();
  if (nama.length === 0) {
    return { ok: false, bidang: 'nama', pesan: 'Nama varian wajib diisi.' };
  }

  // ⛔ Server menolak `conversionFactor <= 0` (`VALIDATION_ERROR`, items.ts),
  // dan alasannya tercatat di sana: nol adalah divide-by-zero laten untuk
  // Modul E. Ditolak juga di sini supaya pesannya menyebut fieldnya.
  const konversi = bacaDesimal(form.conversionFactor);
  if (konversi === null || konversi <= 0) {
    return {
      ok: false,
      bidang: 'conversionFactor',
      pesan: 'Faktor konversi harus angka lebih besar dari 0.',
    };
  }

  const sku = String(form.sku ?? '').trim();
  const barcode = String(form.barcode ?? '').trim();

  return {
    ok: true,
    muatan: {
      name: nama,
      sku: sku.length > 0 ? sku : null,
      // Barcode kosong WAJIB `null`, bukan `''`: index unik barcode akan
      // menganggap dua variation ber-barcode kosong sebagai duplikat, dan
      // variation kedua ditolak 409 tanpa alasan yang terbaca merchant.
      barcode: barcode.length > 0 ? barcode : null,
      stockingUnit: String(form.stockingUnit ?? '').trim() || 'pcs',
      sellingUnit: String(form.sellingUnit ?? '').trim() || 'pcs',
      conversionFactor: konversi,
      trackStock: form.trackStock === true,
    },
  };
}

export function buatMuatanVariationBaru(
  form: FormVariation,
  id: string
): Hasil<MuatanVariationBaru, keyof FormVariation> {
  const bersama = bagianBersama(form);
  if (!bersama.ok) return bersama;

  const harga = bacaRupiah(form.harga);
  if (harga === null) {
    return { ok: false, bidang: 'harga', pesan: 'Harga wajib diisi, dalam rupiah utuh.' };
  }

  return { ok: true, muatan: { id, price: harga, ...bersama.muatan } };
}

/**
 * Produk BARU — item beserta varian pertamanya, satu muatan.
 *
 * ⛔ `POST /items` menolak item tanpa variation (`ITEM_NO_VARIATION`,
 * `minItems: 1` di kontrak), dan alasannya produk: yang dijual kasir adalah
 * VARIAN, bukan produknya. Item tanpa varian tidak muncul di grid sama sekali
 * dan tidak dapat dijual siapa pun.
 *
 * Ditemukan dengan MENJALANKANNYA. Versi pertama layar membuat produk dengan
 * nama sementara lalu membuka B-07 untuk sisanya — dan server menjawab *"body
 * must have required property 'variations'"*. Tidak ada test yang menangkapnya
 * karena tidak ada test yang menyentuh bentuk permintaan itu.
 *
 * Kegagalan varian menunjuk field VARIAN, bukan field produk: pesan yang
 * menunjuk "nama" saat yang kosong adalah "harga" membuat merchant memperbaiki
 * yang sudah benar.
 */
export function buatMuatanProdukBaru(
  formItem: FormItem,
  formVarian: FormVariation,
  id: { itemId: string; variationId: string }
): Hasil<
  {
    id: string;
    name: string;
    categoryId: string | null;
    description: string | null;
    sortOrder: number;
    variations: MuatanVariationBaru[];
  },
  keyof FormItem | keyof FormVariation
> {
  const item = buatMuatanItem(formItem, id.itemId);
  if (!item.ok) return item;

  const varian = buatMuatanVariationBaru(formVarian, id.variationId);
  if (!varian.ok) return varian;

  return { ok: true, muatan: { ...item.muatan, variations: [varian.muatan] } };
}

/**
 * ⛔ TIDAK menyalin `price`, dan itu bukan kelalaian.
 *
 * `updateItemVariation` tidak menerimanya. Mengirimnya diam-diam diabaikan
 * server — dan layar yang mengirimnya akan berkata "tersimpan" untuk harga
 * yang tidak pernah berubah. Perubahan harga hidup di `price_history` (B-10).
 *
 * `form.harga` sengaja tetap ada di tipe formulir: layar menampilkannya
 * sebagai TEKS baca-saja, dan membuang fieldnya dari tipe akan membuat
 * tampilan itu kehilangan sumbernya.
 */
export function buatMuatanVariationUbah(
  form: FormVariation
): Hasil<MuatanVariationUbah, keyof FormVariation> {
  return bagianBersama(form);
}

/* --------------------------------------------------------------- daftar -- */

/** Saringan khusus untuk produk yang belum punya kategori. */
export const TANPA_KATEGORI = '__tanpa__';

export interface Saringan {
  kategoriId: string | null;
  cari: string;
  tampilArsip: boolean;
}

export function saringProduk(semua: readonly Item[], saringan: Saringan): Item[] {
  const cari = saringan.cari.trim().toLowerCase();

  return semua.filter((item) => {
    if (!saringan.tampilArsip && item.archivedAt !== null) return false;

    if (saringan.kategoriId === TANPA_KATEGORI) {
      // Impor katalog membuat produk tanpa kategori, dan justru itu yang harus
      // dibereskan merchant. Kalau ia hanya terlihat lewat "semua kategori",
      // ia tenggelam di antara ratusan yang lain.
      if (item.categoryId !== null) return false;
    } else if (saringan.kategoriId !== null && item.categoryId !== saringan.kategoriId) {
      return false;
    }

    if (cari.length === 0) return true;

    // ⛔ SKU dan barcode ikut dicari. Merchant mencari produk lewat kode yang
    // tertempel di rak, bukan lewat nama yang ia tulis berbulan-bulan lalu.
    if (item.name.toLowerCase().includes(cari)) return true;
    return item.variations.some(
      (v) =>
        (v.sku ?? '').toLowerCase().includes(cari) ||
        (v.barcode ?? '').toLowerCase().includes(cari) ||
        v.name.toLowerCase().includes(cari)
    );
  });
}
