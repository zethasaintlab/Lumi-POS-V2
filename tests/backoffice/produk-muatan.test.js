'use strict';

// B-06/B-07 — muatan produk dan variation.
//
// ⛔ Aturan yang paling penting di berkas ini: `item_variation.price` BEKU
// setelah variation dibuat. `updateItemVariation` tidak menerima `price` sama
// sekali (`packages/contracts/openapi.yaml`), dan itu permanen — bukan
// penundaan (`CLAUDE.md` § keputusan katalog).
//
// Field harga yang terlihat dapat disunting lalu diam-diam tidak terkirim
// adalah kebohongan antarmuka: merchant mengira harganya sudah naik, kasir
// tetap menagih harga lama, dan tidak ada satu pun error di mana pun.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../apps/backoffice/src/katalog/produk.ts';

const ID = '018f2a10-0000-7000-8000-000000000001';

// ---------------------------------------------------------------------------
// Uang
// ---------------------------------------------------------------------------

test('rupiah diformat titik ribuan tanpa desimal', async () => {
  // `CLAUDE.md`: `Rp 1.847.000` — titik ribuan, tanpa desimal. Design system
  // menetapkan tanpa desimal, dan uang adalah bigint rupiah utuh.
  const { rupiah } = await import(MOD);
  assert.equal(rupiah(1847000), 'Rp 1.847.000');
  assert.equal(rupiah(0), 'Rp 0');
  assert.equal(rupiah(25000), 'Rp 25.000');
});

test('⛔ rupiah menerima bigint, number, DAN string', async () => {
  // JSON membawanya sebagai number; kolom INTEGER besar dapat datang sebagai
  // bigint atau string tergantung driver (`CLAUDE.md` — temuan
  // `@powersync/web`). Guard yang hanya memeriksa `number` tidak pernah
  // mengambil cabangnya, dan itu hijau di test sambil salah di aplikasi.
  const { rupiah } = await import(MOD);
  assert.equal(rupiah(25000n), 'Rp 25.000');
  assert.equal(rupiah('25000'), 'Rp 25.000');
});

test('bacaRupiah menerima yang diketik manusia', async () => {
  const { bacaRupiah } = await import(MOD);
  assert.equal(bacaRupiah('25000'), 25000);
  assert.equal(bacaRupiah('25.000'), 25000);
  assert.equal(bacaRupiah('Rp 25.000'), 25000);
  assert.equal(bacaRupiah(' 25 000 '), 25000);
});

test('⛔ bacaRupiah menolak yang bukan angka utuh, bukan mengembalikan NaN', async () => {
  // `Number('')` adalah 0, dan `Number('abc')` adalah NaN — keduanya lolos
  // sebagai "harga" kalau tidak diperiksa. Harga 0 yang lahir dari field
  // kosong adalah produk yang dijual gratis.
  const { bacaRupiah } = await import(MOD);
  for (const buruk of ['', '   ', 'abc', '25.5', '-100', '1e5']) {
    assert.equal(bacaRupiah(buruk), null, `"${buruk}" diterima`);
  }
});

test('bacaRupiah menerima nol yang DIKETIK, karena produk gratis itu sah', async () => {
  const { bacaRupiah } = await import(MOD);
  assert.equal(bacaRupiah('0'), 0);
});

// ---------------------------------------------------------------------------
// Item
// ---------------------------------------------------------------------------

test('muatan item memangkas dan mengirim null untuk yang kosong', async () => {
  const { buatMuatanItem } = await import(MOD);
  const hasil = buatMuatanItem(
    { nama: '  Kopi Susu  ', categoryId: '', deskripsi: '  ', sortOrder: '3' },
    ID
  );
  assert.equal(hasil.ok, true);
  assert.deepEqual(hasil.muatan, {
    id: ID,
    name: 'Kopi Susu',
    categoryId: null,
    description: null,
    sortOrder: 3,
  });
});

test('nama item kosong ditolak dan penolakannya menunjuk fieldnya', async () => {
  const { buatMuatanItem } = await import(MOD);
  const hasil = buatMuatanItem({ nama: '   ', categoryId: '', deskripsi: '', sortOrder: '0' }, ID);
  assert.equal(hasil.ok, false);
  assert.equal(hasil.bidang, 'nama');
});

// ---------------------------------------------------------------------------
// Variation BARU — harga wajib
// ---------------------------------------------------------------------------

test('variation baru membawa price, dan conversionFactor sebagai DESIMAL', async () => {
  // ⛔ `conversionFactor` di API adalah `number` desimal (0,5), BUKAN INTEGER
  // ×1000. Skala ×1000 adalah urusan skema SQLite LOKAL, dan konversinya
  // terjadi di `put` raw table pada jalur turun (`CLAUDE.md`). Mengalikannya
  // di sini berarti menulis 500 ke kolom `numeric` PostgreSQL — 1000× terlalu
  // besar, dan stok setiap penjualan ikut salah sebesar itu.
  const { buatMuatanVariationBaru } = await import(MOD);
  const hasil = buatMuatanVariationBaru(
    {
      nama: 'Regular',
      sku: 'KS-R',
      barcode: '',
      harga: '25.000',
      stockingUnit: 'kg',
      sellingUnit: 'gram',
      conversionFactor: '0,5',
      trackStock: true,
    },
    ID
  );

  assert.equal(hasil.ok, true, hasil.ok === false ? hasil.pesan : '');
  assert.deepEqual(hasil.muatan, {
    id: ID,
    name: 'Regular',
    sku: 'KS-R',
    barcode: null,
    price: 25000,
    stockingUnit: 'kg',
    sellingUnit: 'gram',
    conversionFactor: 0.5,
    trackStock: true,
  });
});

test('koma DAN titik diterima sebagai pemisah desimal conversionFactor', async () => {
  // Papan ketik Indonesia menulis "0,5". Menolaknya berarti field yang tidak
  // dapat diisi dengan cara yang wajar di negara tempat produk ini dipakai.
  const { buatMuatanVariationBaru } = await import(MOD);
  const dasar = { nama: 'R', sku: '', barcode: '', harga: '1000', stockingUnit: 'pcs', sellingUnit: 'pcs', trackStock: false };
  assert.equal(buatMuatanVariationBaru({ ...dasar, conversionFactor: '0,5' }, ID).muatan.conversionFactor, 0.5);
  assert.equal(buatMuatanVariationBaru({ ...dasar, conversionFactor: '0.5' }, ID).muatan.conversionFactor, 0.5);
});

test('⛔ conversionFactor NOL ditolak — divide-by-zero laten untuk Modul E', async () => {
  // Server menolaknya (`VALIDATION_ERROR`, items.ts). Ditolak juga di sini
  // supaya pesannya menyebut fieldnya.
  const { buatMuatanVariationBaru } = await import(MOD);
  const dasar = { nama: 'R', sku: '', barcode: '', harga: '1000', stockingUnit: 'pcs', sellingUnit: 'pcs', trackStock: false };
  for (const buruk of ['0', '-1', 'abc', '']) {
    const hasil = buatMuatanVariationBaru({ ...dasar, conversionFactor: buruk }, ID);
    assert.equal(hasil.ok, false, `"${buruk}" diterima`);
    assert.equal(hasil.bidang, 'conversionFactor');
  }
});

test('harga variation baru WAJIB dan divalidasi', async () => {
  const { buatMuatanVariationBaru } = await import(MOD);
  const dasar = { nama: 'R', sku: '', barcode: '', stockingUnit: 'pcs', sellingUnit: 'pcs', conversionFactor: '1', trackStock: false };
  const hasil = buatMuatanVariationBaru({ ...dasar, harga: '' }, ID);
  assert.equal(hasil.ok, false);
  assert.equal(hasil.bidang, 'harga');
});

// ---------------------------------------------------------------------------
// ⛔ Variation LAMA — harga BEKU
// ---------------------------------------------------------------------------

test('⛔ muatan UBAH variation TIDAK PERNAH memuat price', async () => {
  // Ini aturan emasnya, dibuat dapat dieksekusi.
  //
  // `updateItemVariation` tidak menerima `price`. Mengirimnya diam-diam
  // diabaikan server — dan layar yang mengirimnya akan berkata "tersimpan"
  // untuk harga yang tidak pernah berubah.
  const { buatMuatanVariationUbah } = await import(MOD);
  const hasil = buatMuatanVariationUbah({
    nama: 'Regular',
    sku: 'KS-R',
    barcode: '899',
    harga: '99.000', // sengaja diisi — harus DIABAIKAN
    stockingUnit: 'pcs',
    sellingUnit: 'pcs',
    conversionFactor: '1',
    trackStock: true,
  });

  assert.equal(hasil.ok, true);
  assert.ok(!('price' in hasil.muatan), `price ikut terkirim: ${JSON.stringify(hasil.muatan)}`);
  assert.ok(!('cost' in hasil.muatan), 'cost ikut terkirim');
});

test('⛔ kunci muatan UBAH sama persis dengan yang diterima OpenAPI', async () => {
  // Penjaga yang menurunkan aturannya dari kontrak, bukan dari ingatan. Field
  // yang ditambahkan kelak ke layar tanpa ada di kontrak akan tertangkap di
  // sini alih-alih diabaikan diam-diam oleh server.
  const { buatMuatanVariationUbah } = await import(MOD);
  const { readFileSync } = require('node:fs');

  const yaml = readFileSync('packages/contracts/openapi.yaml', 'utf8');
  const blok = yaml.slice(yaml.indexOf('operationId: updateItemVariation'));
  const properti = blok.slice(blok.indexOf('properties:'), blok.indexOf('responses:'));
  const diizinkan = new Set([...properti.matchAll(/^\s{16}(\w+):/gm)].map((m) => m[1]));

  assert.ok(diizinkan.size >= 5, `kontrak tidak terbaca: ${[...diizinkan].join(',')}`);
  assert.ok(!diizinkan.has('price'), 'premis test salah: kontrak justru menerima price');

  const hasil = buatMuatanVariationUbah({
    nama: 'R', sku: '', barcode: '', harga: '1',
    stockingUnit: 'pcs', sellingUnit: 'pcs', conversionFactor: '1', trackStock: false,
  });
  for (const kunci of Object.keys(hasil.muatan)) {
    assert.ok(diizinkan.has(kunci), `"${kunci}" tidak diterima updateItemVariation`);
  }
});

// ---------------------------------------------------------------------------
// Daftar B-06
// ---------------------------------------------------------------------------

const ITEM = (over) => ({
  id: 'i1', name: 'Kopi Susu', categoryId: 'c1', sortOrder: 0,
  archivedAt: null, variations: [], modifierLists: [], ...over,
});




// ---------------------------------------------------------------------------
// ⛔ Produk BARU wajib membawa varian pertama
// ---------------------------------------------------------------------------

test('⛔ muatan produk baru menyertakan variations, minimal satu', async () => {
  // `POST /items` menolak item tanpa variation (`ITEM_NO_VARIATION`,
  // `minItems: 1` di kontrak). Alasannya produk: yang dijual kasir adalah
  // VARIAN, bukan produknya — item tanpa varian tidak muncul di grid sama
  // sekali dan tidak dapat dijual siapa pun.
  //
  // Ditemukan dengan MENJALANKANNYA: versi pertama layar membuat produk
  // dengan nama sementara lalu membuka B-07 untuk sisanya, dan server
  // menolaknya dengan "body must have required property 'variations'".
  const { buatMuatanProdukBaru } = await import(MOD);
  const hasil = buatMuatanProdukBaru(
    { nama: 'Kopi Susu', categoryId: 'c1', deskripsi: '', sortOrder: '0' },
    { nama: 'Regular', sku: '', barcode: '', harga: '25.000', stockingUnit: 'pcs', sellingUnit: 'pcs', conversionFactor: '1', trackStock: false },
    { itemId: 'i1', variationId: 'v1' }
  );

  assert.equal(hasil.ok, true, hasil.ok === false ? hasil.pesan : '');
  assert.equal(hasil.muatan.id, 'i1');
  assert.equal(hasil.muatan.name, 'Kopi Susu');
  assert.equal(hasil.muatan.variations.length, 1);
  assert.equal(hasil.muatan.variations[0].id, 'v1');
  assert.equal(hasil.muatan.variations[0].price, 25000);
});

test('kegagalan varian pertama menunjuk field varian, bukan field produk', async () => {
  const { buatMuatanProdukBaru } = await import(MOD);
  const hasil = buatMuatanProdukBaru(
    { nama: 'Kopi', categoryId: '', deskripsi: '', sortOrder: '0' },
    { nama: 'Regular', sku: '', barcode: '', harga: '', stockingUnit: 'pcs', sellingUnit: 'pcs', conversionFactor: '1', trackStock: false },
    { itemId: 'i1', variationId: 'v1' }
  );
  assert.equal(hasil.ok, false);
  assert.equal(hasil.bidang, 'harga');
});

// ⛔ `saringProduk` DIHAPUS bersama testnya, 21 Agustus 2026.
//
// Penyaringan pindah ke server; membiarkan keduanya hidup berarti dua tempat
// memutuskan "produk mana yang cocok", dan yang menyimpang menghasilkan
// pencarian yang menemukan hal berbeda tergantung layar mana yang bertanya.
//
// Aturan yang dulu diuji di sini kini diuji di `tests/catalog/items-paginasi.test.js`:
// nama/deskripsi item · nama/SKU/barcode varian · kategori (termasuk
// `TANPA_KATEGORI` → `category_id IS NULL`) · arsip. Yang tersisa di sini
// adalah penyusunan KUERI-nya.

test('kueri daftar produk meneruskan seluruh saringan ke server', async () => {
  const { kueriDaftarProduk, TANPA_KATEGORI } = await import(MOD);

  const kosong = kueriDaftarProduk({ kategoriId: null, cari: '', tampilArsip: false }, { limit: 50 });
  assert.ok(!kosong.includes('q='), 'kueri kosong tidak dikirim');
  assert.ok(!kosong.includes('includeArchived'), 'arsip disembunyikan secara bawaan');
  assert.ok(kosong.includes('limit=50'));

  const penuh = kueriDaftarProduk(
    { kategoriId: 'kat-1', cari: '  kopi susu  ', tampilArsip: true },
    { limit: 50 }
  );
  assert.match(penuh, /includeArchived=true/);
  assert.match(penuh, /categoryId=kat-1/);
  // Dipangkas, tapi spasi di TENGAH dipertahankan — "kopi susu" adalah dua
  // kata yang merchant memang ketik.
  assert.match(penuh, /q=kopi\+susu/);

  // ⛔ `TANPA_KATEGORI` diteruskan APA ADANYA. Server punya cabangnya
  // (`category_id IS NULL`); mengubahnya jadi string kosong di sini akan
  // membuat "Tanpa kategori" berperilaku seperti "Semua".
  const tanpa = kueriDaftarProduk(
    { kategoriId: TANPA_KATEGORI, cari: '', tampilArsip: false },
    { limit: 50 }
  );
  assert.ok(tanpa.includes(`categoryId=${encodeURIComponent(TANPA_KATEGORI)}`), tanpa);
});

test('kursor hanya ikut bila diberikan', async () => {
  const { kueriDaftarProduk } = await import(MOD);
  const saringan = { kategoriId: null, cari: '', tampilArsip: false };
  assert.ok(!kueriDaftarProduk(saringan, { limit: 50 }).includes('after='));
  assert.ok(!kueriDaftarProduk(saringan, { limit: 50, after: null }).includes('after='));
  assert.match(kueriDaftarProduk(saringan, { limit: 50, after: '0:abc' }), /after=0%3Aabc/);
});
