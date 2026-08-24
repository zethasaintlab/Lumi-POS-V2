import { bacaRupiah } from '../../../../packages/domain/src/uang-tampilan.ts';

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

/**
 * Saringan khusus untuk produk yang belum punya kategori.
 *
 * ⛔ Di-*re-export* dari `packages/domain`, bukan didefinisikan ulang di sini.
 * Nilainya dikirim ke server sebagai `categoryId` dan dibaca di sana sebagai
 * cabang `category_id IS NULL`; dua salinan yang menyimpang menghasilkan
 * saringan yang mengembalikan NOL produk alih-alih produk tanpa kategori —
 * dan nol terlihat persis seperti "memang tidak ada".
 */
import { TANPA_KATEGORI } from '../../../../packages/domain/src/katalog-saringan.ts';

export { TANPA_KATEGORI };

export interface Saringan {
  kategoriId: string | null;
  cari: string;
  tampilArsip: boolean;
}

/* ⛔ `saringProduk` DIHAPUS, 21 Agustus 2026.
   
   Penyaringan pindah ke server (`GET /items?q=&categoryId=&includeArchived=`).
   Membiarkannya hidup berarti dua tempat memutuskan "produk mana yang cocok",
   dan yang menyimpang menghasilkan pencarian yang menemukan hal berbeda
   tergantung layar mana yang bertanya.
   
   Aturannya tidak hilang — ia dipindah, beserta testnya:
   nama/deskripsi item, nama/SKU/barcode varian, kategori (termasuk
   `TANPA_KATEGORI` → `category_id IS NULL`), dan arsip. Lihat
   `apps/server/src/modules/catalog/handlers/items.ts` dan
   `tests/catalog/items-paginasi.test.js`. */

/* ------------------------------------------------------- pencarian server -- */

/**
 * B-06 sisi server — menyusun query string `GET /items` dari saringan layar.
 *
 * ## ⛔ Kenapa pencarian pindah ke server
 *
 * Layar ini memuat SELURUH katalog dengan `includeArchived=true` lalu
 * menyaringnya di klien. Itu benar untuk katalog kecil dan mustahil untuk
 * yang besar: paket Pro mengizinkan 5.000 produk, dan setiap satu membawa
 * varian dan modifier list-nya sendiri.
 *
 * ## ⛔ Kenapa TIDAK setengah jalan
 *
 * Memuat satu halaman lalu tetap menyaring di klien menghasilkan pencarian
 * yang hanya menemukan apa yang **kebetulan sudah dimuat** — merchant
 * mengetik barcode produk ke-300, tidak ada yang muncul, dan tidak ada satu
 * pun error. Seluruh saringan karena itu dikirim ke server: `q`,
 * `categoryId`, dan `includeArchived`.
 *
 * ⛔ `TANPA_KATEGORI` diteruskan APA ADANYA. Server punya cabangnya
 * (`category_id IS NULL`); mengubahnya menjadi string kosong di sini akan
 * membuat "Tanpa kategori" berperilaku seperti "Semua".
 */
export function kueriDaftarProduk(
  saringan: Saringan,
  { limit, after }: { limit: number; after?: string | null } = { limit: 50 }
): string {
  const q = new URLSearchParams();
  if (saringan.tampilArsip) q.set('includeArchived', 'true');
  if (saringan.kategoriId !== null) q.set('categoryId', saringan.kategoriId);
  const cari = saringan.cari.trim();
  if (cari !== '') q.set('q', cari);
  q.set('limit', String(limit));
  // ⛔ Kursor hanya ikut bila SARINGANNYA tidak berubah — pemanggil yang
  // mengubah `q` lalu mengoper kursor lama akan melewatkan hasil yang berada
  // sebelum kursor itu. Layar mengosongkannya pada setiap perubahan saringan.
  if (after) q.set('after', after);
  return `/items?${q.toString()}`;
}

/**
 * B-10 — daftar produk untuk PEMILIH, dengan yang sedang dipilih dijamin ada.
 *
 * ## ⛔ Kenapa yang dipilih harus ikut
 *
 * Pemilih B-10 memakai pencarian sisi server. Merchant memilih "Kopi Susu",
 * panel riwayat harganya terbuka, lalu ia mengetik pencarian lain — dan hasil
 * baru tidak memuat Kopi Susu.
 *
 * Tanpa fungsi ini, tombol produk yang aktif lenyap dari layar sementara
 * panelnya masih menampilkan harganya. Merchant menyimpulkan pilihannya
 * hilang dan mengulang dari awal, atau lebih buruk: ia menyunting harga
 * produk yang ia kira sudah tidak dipilih.
 *
 * Yang dipilih diletakkan di DEPAN, dan urutan sisanya dipertahankan — tombol
 * yang melompat posisi saat mengetik adalah tombol yang salah diklik.
 */
export function daftarPemilih(
  hasil: readonly Item[],
  dipilih: Item | null
): Item[] {
  if (dipilih === null) return [...hasil];
  if (hasil.some((i) => i.id === dipilih.id)) return [...hasil];
  return [dipilih, ...hasil];
}
