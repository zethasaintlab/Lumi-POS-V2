'use strict';

// K-03 — membaca katalog dari SQLite lokal, dengan harga yang sudah
// diresolusi.
//
// ⛔ Harga diresolusi DI SINI, bukan dibaca dari `item_variation.price`.
// Anak tangga paling bawah itu beku sejak variation dibuat (`CLAUDE.md`);
// memakainya langsung berarti setiap perubahan harga yang pernah dibuat
// merchant diabaikan diam-diam saat offline.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../apps/kasir/src/katalog/baca.ts';

function dbPalsu(data) {
  return {
    async getAll(sql) {
      if (/FROM item\b/.test(sql)) return data.item ?? [];
      if (/FROM price_history/.test(sql)) return data.price_history ?? [];
      if (/FROM modifier_list/.test(sql)) return data.modifier_list ?? [];
      if (/FROM modifier\b/.test(sql)) return data.modifier ?? [];
      if (/FROM category/.test(sql)) return data.category ?? [];
      return [];
    },
    async execute() {
      return { rowsAffected: 0 };
    },
    async transaction(fn) {
      return fn(this);
    },
  };
}

const ITEM = [
  {
    item_id: 'i1', item_name: 'Kopi Susu', category_id: 'c1',
    variation_id: 'v1', variation_name: 'Regular', harga_dasar: 20000,
    barcode: '899123', track_stock: 1, archived_at: null, sort_order: 0,
  },
  {
    item_id: 'i1', item_name: 'Kopi Susu', category_id: 'c1',
    variation_id: 'v2', variation_name: 'Large', harga_dasar: 25000,
    barcode: null, track_stock: 1, archived_at: null, sort_order: 1,
  },
];

const PADA = new Date('2026-08-11T10:00:00Z');

// ---------------------------------------------------------------------------

test('katalog: variation dikelompokkan di bawah itemnya', async () => {
  const { bacaKatalog } = await import(MOD);
  const hasil = await bacaKatalog(dbPalsu({ item: ITEM }), { outletId: 'o1', pada: PADA });

  assert.equal(hasil.length, 1, 'satu item, bukan dua');
  assert.equal(hasil[0].nama, 'Kopi Susu');
  assert.equal(hasil[0].variations.length, 2);
  assert.deepEqual(hasil[0].variations.map((v) => v.nama), ['Regular', 'Large']);
});

test('⛔ harga diresolusi lewat tangga, bukan dibaca dari harga dasar', async () => {
  const { bacaKatalog } = await import(MOD);

  const hasil = await bacaKatalog(
    dbPalsu({
      item: ITEM,
      price_history: [
        { variation_id: 'v1', outlet_id: 'o1', price: 15000, effective_from: '2026-08-01T00:00:00Z' },
        { variation_id: 'v2', outlet_id: null, price: 23000, effective_from: '2026-08-01T00:00:00Z' },
      ],
    }),
    { outletId: 'o1', pada: PADA }
  );

  const [v1, v2] = hasil[0].variations;
  assert.equal(v1.harga, 15000, 'harga outlet menang');
  assert.equal(v1.sumberHarga, 'outlet');
  assert.equal(v2.harga, 23000, 'harga tenant menang atas harga dasar');
  assert.equal(v2.sumberHarga, 'tenant');
});

test('harga diresolusi pada `pada`, bukan sekarang (FR-H6)', async () => {
  const { bacaKatalog } = await import(MOD);

  // `spec-h:77` — order yang antre offline berjam-jam dihitung dengan harga
  // saat penjualan TERJADI. Layar juga harus menunjukkan harga itu.
  const riwayat = [
    { variation_id: 'v1', outlet_id: 'o1', price: 15000, effective_from: '2026-08-01T00:00:00Z' },
    { variation_id: 'v1', outlet_id: 'o1', price: 30000, effective_from: '2026-08-20T00:00:00Z' },
  ];
  const db = dbPalsu({ item: ITEM, price_history: riwayat });

  const sebelum = await bacaKatalog(db, { outletId: 'o1', pada: PADA });
  assert.equal(sebelum[0].variations[0].harga, 15000);

  const sesudah = await bacaKatalog(db, { outletId: 'o1', pada: new Date('2026-08-21T00:00:00Z') });
  assert.equal(sesudah[0].variations[0].harga, 30000);
});

test('cari: nama dan barcode, tidak peka huruf besar-kecil', async () => {
  const { cariItem } = await import(MOD);
  const katalog = await (await import(MOD)).bacaKatalog(dbPalsu({ item: ITEM }), {
    outletId: 'o1',
    pada: PADA,
  });

  assert.equal(cariItem(katalog, 'kopi').length, 1);
  assert.equal(cariItem(katalog, 'KOPI').length, 1);
  assert.equal(cariItem(katalog, 'teh').length, 0);
  assert.equal(cariItem(katalog, '').length, 1, 'kueri kosong menampilkan semua');

  // Barcode dicari di VARIATION. `IA:76` menempatkan scanner sebagai listener
  // global (K-17); tanpa pencarian barcode, memindai tidak melakukan apa pun.
  assert.equal(cariItem(katalog, '899123').length, 1);
});

test('modifier list dibaca beserta modifiernya, terurut', async () => {
  const { bacaModifier } = await import(MOD);

  const db = dbPalsu({
    modifier_list: [
      { id: 'ml1', name: 'Tingkat Gula', selection_type: 'single', min_selections: 1, max_selections: 1, is_required: 1, allow_duplicate: 0, sort_order: 0 },
    ],
    modifier: [
      { id: 'm2', modifier_list_id: 'ml1', name: 'Sedang', price: 0, is_default: 0, sort_order: 1 },
      { id: 'm1', modifier_list_id: 'ml1', name: 'Normal', price: 0, is_default: 1, sort_order: 0 },
      { id: 'm3', modifier_list_id: 'ml1', name: 'Ekstra', price: 3000, is_default: 0, sort_order: 2 },
    ],
  });

  const daftar = await bacaModifier(db, 'i1');
  assert.equal(daftar.length, 1);
  assert.equal(daftar[0].nama, 'Tingkat Gula');
  assert.equal(daftar[0].wajib, true);
  assert.deepEqual(daftar[0].modifier.map((m) => m.nama), ['Normal', 'Sedang', 'Ekstra']);
  assert.equal(daftar[0].modifier[0].bawaan, true);
  assert.equal(daftar[0].modifier[2].harga, 3000);
});

test('katalog kosong bukan galat — ia keadaan yang harus punya layar', async () => {
  const { bacaKatalog } = await import(MOD);

  // Perangkat baru sebelum katalog turun. Aturan design system #7 menuntut
  // setiap komponen punya keadaan kosong; ini yang membuatnya dapat
  // dibedakan dari kegagalan.
  const hasil = await bacaKatalog(dbPalsu({}), { outletId: 'o1', pada: PADA });
  assert.deepEqual(hasil, []);
});

// ===========================================================================
// K-17 — barcode hasil SCAN
// ===========================================================================
//
// ⛔ `cariBarcode` sengaja BUKAN `cariItem`. Pencarian menyaring daftar untuk
// dilihat kasir; scan harus memutuskan SATU produk tanpa kasir melihat apa
// pun. Memakai pencarian untuk scan akan menambahkan produk pertama yang
// NAMANYA memuat angka barcode — produk yang salah, masuk keranjang tanpa
// ada yang menekan apa pun.

async function katalogUji(item = ITEM) {
  const { bacaKatalog } = await import(MOD);
  return bacaKatalog(dbPalsu({ item }), { outletId: 'o1', pada: PADA });
}

test('scan: barcode yang cocok PERSIS menunjuk satu variation', async () => {
  const { cariBarcode } = await import(MOD);
  const katalog = await katalogUji();
  const cocok = cariBarcode(katalog, '899123');
  assert.equal(cocok?.item.id, 'i1');
  assert.equal(cocok?.variation.id, 'v1', 'harus varian Regular, bukan item saja');
});

test('scan: spasi di sekitar barcode dipangkas', async () => {
  // Sebagian scanner mengirim spasi atau tab sebelum terminator.
  const { cariBarcode } = await import(MOD);
  const katalog = await katalogUji();
  assert.equal(cariBarcode(katalog, '  899123 ')?.variation.id, 'v1');
});

test('⛔ scan: kecocokan SUBSTRING tidak dianggap cocok', async () => {
  const { cariBarcode, cariItem } = await import(MOD);
  const katalog = await katalogUji();
  // `cariItem` memang menyaring dengan substring pada NAMA — dan itu benar
  // untuk pencarian. Untuk scan, satu digit yang terpotong tidak boleh
  // menambahkan produk apa pun.
  assert.equal(cariBarcode(katalog, '89912'), null);
  assert.equal(cariBarcode(katalog, '8991234'), null);
  // Sentinel: pencarian biasa tetap berperilaku seperti sebelumnya.
  assert.equal(cariItem(katalog, 'kopi').length, 1);
});

test('⛔ barcode GANDA tidak memilih siapa pun', async () => {
  // Barcode ganda adalah data katalog yang cacat. Menebak salah satunya
  // berarti setengah penjualan produk itu tercatat pada produk lain, tanpa
  // satu pun error.
  const { cariBarcode } = await import(MOD);
  const katalog = await katalogUji([
    ...ITEM,
    {
      item_id: 'i2', item_name: 'Teh Tarik', category_id: 'c1',
      variation_id: 'v3', variation_name: 'Regular', harga_dasar: 18000,
      barcode: '899123', track_stock: 1, archived_at: null, sort_order: 0,
    },
  ]);
  assert.equal(cariBarcode(katalog, '899123'), null);
});

test('scan: barcode kosong atau tidak dikenal → null', async () => {
  const { cariBarcode } = await import(MOD);
  const katalog = await katalogUji();
  assert.equal(cariBarcode(katalog, ''), null);
  assert.equal(cariBarcode(katalog, '   '), null);
  assert.equal(cariBarcode(katalog, '000000'), null);
});

test('scan: variation TANPA barcode tidak pernah cocok dengan string kosong', async () => {
  // `variation.barcode === null` dan `kode === ''` keduanya "kosong";
  // perbandingan yang longgar akan membuat Enter tunggal menambahkan produk.
  const { cariBarcode } = await import(MOD);
  const katalog = await katalogUji();
  const tanpaBarcode = katalog[0].variations.find((v) => v.barcode === null);
  assert.ok(tanpaBarcode, 'fixture harus punya variation tanpa barcode');
  assert.equal(cariBarcode(katalog, ''), null);
});
