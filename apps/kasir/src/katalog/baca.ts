import type { DbLokal } from '../../../../packages/sync-client/src/ports.ts';
import {
  resolusiHarga,
  type BarisRiwayatHarga,
  type SumberHarga,
} from '../../../../packages/domain/src/harga.ts';

/**
 * Membaca katalog dari SQLite lokal, dengan harga yang SUDAH diresolusi.
 *
 * ## ⛔ Kenapa harga tidak dibaca langsung dari `item_variation.price`
 *
 * Kolom itu beku sejak variation dibuat (`CLAUDE.md`: "harga awal, anak
 * tangga paling bawah resolusi"). Membacanya langsung berarti setiap
 * perubahan harga yang pernah dibuat merchant diabaikan diam-diam saat
 * offline — kasir menjual dengan harga lama, struk tercetak, dan selisihnya
 * baru terlihat di laporan.
 *
 * Tangganya ada di `packages/domain/src/harga.ts` dan dibagi dengan server.
 *
 * ## Kenapa satu query untuk seluruh katalog
 *
 * Grid K-03 menampilkan ≥12 kartu tanpa scroll (`IA:62`), dan kafe kecil
 * punya puluhan sampai ratusan variation. Query per variation akan menjadi
 * N+1 di atas WASM SQLite — jauh lebih mahal daripada di PostgreSQL.
 */

export interface VariationKatalog {
  id: string;
  nama: string;
  harga: number;
  sumberHarga: SumberHarga;
  barcode: string | null;
  lacakStok: boolean;
}

export interface ItemKatalog {
  id: string;
  nama: string;
  categoryId: string | null;
  variations: VariationKatalog[];
}

interface BarisItem {
  item_id: string;
  item_name: string;
  category_id: string | null;
  variation_id: string;
  variation_name: string;
  harga_dasar: number;
  barcode: string | null;
  track_stock: number;
}

const SQL_ITEM = `
  SELECT i.id AS item_id, i.name AS item_name, i.category_id,
         v.id AS variation_id, v.name AS variation_name,
         v.price AS harga_dasar, v.barcode, v.track_stock
    FROM item i
    JOIN item_variation v ON v.item_id = i.id
   WHERE i.archived_at IS NULL AND v.archived_at IS NULL
   ORDER BY i.sort_order, i.name, v.sort_order, v.name`;

export async function bacaKatalog(
  db: DbLokal,
  { outletId, pada }: { outletId: string | null; pada: Date }
): Promise<ItemKatalog[]> {
  const baris = await db.getAll<BarisItem>(SQL_ITEM);
  if (baris.length === 0) return [];

  // Seluruh riwayat sekali, lalu dikelompokkan di memori. Tabelnya tumbuh
  // dengan jumlah PERUBAHAN harga, bukan dengan volume penjualan.
  const riwayat = await db.getAll<BarisRiwayatHarga & { variation_id: string }>(
    `SELECT variation_id, outlet_id, price, effective_from FROM price_history`
  );
  const perVariation = new Map<string, BarisRiwayatHarga[]>();
  for (const r of riwayat) {
    const daftar = perVariation.get(r.variation_id);
    if (daftar) daftar.push(r);
    else perVariation.set(r.variation_id, [r]);
  }

  const item = new Map<string, ItemKatalog>();
  for (const b of baris) {
    let masuk = item.get(b.item_id);
    if (!masuk) {
      masuk = { id: b.item_id, nama: b.item_name, categoryId: b.category_id, variations: [] };
      item.set(b.item_id, masuk);
    }
    const { harga, sumber } = resolusiHarga({
      hargaDasar: b.harga_dasar,
      riwayat: perVariation.get(b.variation_id) ?? [],
      outletId,
      pada,
    });
    masuk.variations.push({
      id: b.variation_id,
      nama: b.variation_name,
      harga,
      sumberHarga: sumber,
      barcode: b.barcode,
      lacakStok: b.track_stock === 1,
    });
  }

  return [...item.values()];
}

/**
 * Pencarian nama dan barcode (K-17).
 *
 * Barcode dicocokkan PERSIS, nama secara substring: scanner mengirim kode
 * lengkap, sementara kasir mengetik potongan. Mencocokkan barcode secara
 * substring akan membuat satu digit yang diketik cocok dengan puluhan produk.
 */
export function cariItem(katalog: readonly ItemKatalog[], kueri: string): ItemKatalog[] {
  const q = kueri.trim().toLowerCase();
  if (q === '') return [...katalog];
  return katalog.filter(
    (i) =>
      i.nama.toLowerCase().includes(q) ||
      i.variations.some((v) => v.barcode === kueri.trim() || v.nama.toLowerCase().includes(q))
  );
}

export interface KategoriKatalog {
  id: string;
  nama: string;
}

/**
 * Kategori yang perangkat punya, untuk saringan grid K-03.
 *
 * ⛔ `color_hint` SENGAJA tidak dibaca. Kolomnya ada di skema dan merchant
 * dapat mengisinya, tapi aturan design system #6 melarang nilai warna di luar
 * token — warna sembarang dari back-office akan berdiri berdampingan dengan
 * aksen teal, dan yang kebetulan hijau atau merah membawa arti yang sudah
 * dipakai produk ini (stok aman, stok minus, selisih kas). Warna kategori
 * karena itu diturunkan dari POSISI di daftar
 * (`packages/domain/src/warna-kategori.ts`), bukan dari data merchant.
 * Batas yang dinyatakan.
 *
 * ⛔ Diurutkan di JS, bukan hanya di SQL: fake `DbLokal` tidak menegakkan
 * `ORDER BY` sama sekali, dan urutan inilah yang memutuskan warna mana jatuh
 * ke kategori mana. Urutan yang berbeda antara test dan aplikasi berarti
 * "Kopi" berwarna berbeda di keduanya.
 */
export async function bacaKategori(db: DbLokal): Promise<KategoriKatalog[]> {
  const baris = await db.getAll<{ id: string; name: string; sort_order: number | null }>(
    `SELECT id, name, sort_order FROM category WHERE archived_at IS NULL
      ORDER BY sort_order, name`
  );
  return [...baris]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name, 'id'))
    .map((b) => ({ id: b.id, nama: b.name }));
}

export interface ModifierPilihan {
  id: string;
  nama: string;
  harga: number;
  bawaan: boolean;
}

export interface DaftarModifier {
  id: string;
  nama: string;
  tipe: 'single' | 'multi';
  minPilih: number;
  maxPilih: number | null;
  wajib: boolean;
  bolehGanda: boolean;
  modifier: ModifierPilihan[];
}

/** Modifier list yang terpasang pada satu item (K-04). */
export async function bacaModifier(db: DbLokal, itemId: string): Promise<DaftarModifier[]> {
  const daftar = await db.getAll<{
    id: string;
    name: string;
    selection_type: 'single' | 'multi';
    min_selections: number;
    max_selections: number | null;
    is_required: number;
    allow_duplicate: number;
  }>(
    `SELECT ml.id, ml.name, ml.selection_type, ml.min_selections, ml.max_selections,
            ml.is_required, ml.allow_duplicate
       FROM modifier_list ml
       JOIN item_modifier_list iml ON iml.modifier_list_id = ml.id
      WHERE iml.item_id = ? AND ml.archived_at IS NULL
      ORDER BY iml.sort_order, ml.name`,
    [itemId]
  );
  if (daftar.length === 0) return [];

  const semua = await db.getAll<{
    id: string;
    modifier_list_id: string;
    name: string;
    price: number;
    is_default: number;
    sort_order: number;
  }>(`SELECT id, modifier_list_id, name, price, is_default, sort_order
        FROM modifier WHERE archived_at IS NULL ORDER BY sort_order, name`);

  return daftar.map((ml) => ({
    id: ml.id,
    nama: ml.name,
    tipe: ml.selection_type,
    minPilih: ml.min_selections,
    maxPilih: ml.max_selections,
    wajib: ml.is_required === 1,
    bolehGanda: ml.allow_duplicate === 1,
    // ⛔ Diurutkan DI SINI, bukan diandalkan pada `ORDER BY` di query.
    //
    // Modifier diambil sekali untuk seluruh daftar lalu DIKELOMPOKKAN ULANG
    // per list. Menggantungkan urutan per-list pada urutan global adalah
    // jaminan yang halus: ia benar hari ini, dan diam-diam patah begitu
    // query-nya berubah (mis. join ditambahkan, atau `ORDER BY` disunting
    // untuk alasan lain). Urutannya menentukan modifier bawaan muncul
    // pertama, dan kasir menekan yang pertama.
    //
    // Ia juga yang membuat jaminan ini DAPAT DIUJI tanpa SQLite sungguhan.
    modifier: semua
      .filter((m) => m.modifier_list_id === ml.id)
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
      .map((m) => ({ id: m.id, nama: m.name, harga: m.price, bawaan: m.is_default === 1 })),
  }));
}

/**
 * K-17 — barcode hasil SCAN → variation yang dituju.
 *
 * ⛔ Terpisah dari `cariItem`, dan sengaja. Pencarian menyaring daftar untuk
 * dilihat kasir; scan harus memutuskan SATU produk tanpa kasir melihat apa
 * pun. Memakai `cariItem` untuk scan akan menambahkan produk pertama yang
 * NAMANYA memuat angka barcode — dan itu produk yang salah, ditambahkan tanpa
 * ada yang menekan apa pun.
 *
 * ⛔ Kecocokan PERSIS, dan kalau ada lebih dari satu, TIDAK ADA yang dipilih.
 * Barcode ganda adalah data katalog yang cacat; menebak salah satunya berarti
 * setengah penjualan produk itu tercatat pada produk lain, dan tidak ada satu
 * pun error. Layar menampilkannya sebagai pencarian biasa dan kasir memilih.
 */
export function cariBarcode(
  katalog: readonly ItemKatalog[],
  barcode: string
): { item: ItemKatalog; variation: VariationKatalog } | null {
  const kode = barcode.trim();
  if (kode === '') return null;

  const cocok: { item: ItemKatalog; variation: VariationKatalog }[] = [];
  for (const item of katalog) {
    for (const variation of item.variations) {
      if (variation.barcode === kode) cocok.push({ item, variation });
    }
  }
  return cocok.length === 1 ? cocok[0] : null;
}
