'use strict';

// K-03 — keranjang. Murni: tanpa React, tanpa database.
//
// Yang diuji di sini adalah aturan yang menentukan apa yang kasir LIHAT
// sebelum menekan Bayar. Total finalnya tetap dihitung `computeOrderTotals`
// di packages/domain (dibagi server); keranjang hanya menyusun barisnya.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../apps/kasir/src/kasir/keranjang.ts';

const V1 = { id: 'v1', nama: 'Regular', harga: 20000, sumberHarga: 'outlet', barcode: null, lacakStok: true };
const V2 = { id: 'v2', nama: 'Large', harga: 25000, sumberHarga: 'variation', barcode: null, lacakStok: true };
const ITEM = { id: 'i1', nama: 'Kopi Susu', categoryId: 'c1', variations: [V1, V2] };

const GULA = { id: 'm1', nama: 'Ekstra gula', harga: 3000, qtyMilli: 1000 };

// ---------------------------------------------------------------------------

test('tambah: baris baru, kuantitas x1000', async () => {
  const { keranjangKosong, tambah } = await import(MOD);

  // `CLAUDE.md`: kuantitas INTEGER x1000. `0.5 kg` -> `500`. Terbukti lewat
  // pengukuran bahwa REAL membuat `WHERE stok = 0` gagal diam-diam.
  const k = tambah(keranjangKosong(), { item: ITEM, variation: V1, modifier: [], idBaris: () => 'b1' });
  assert.equal(k.baris.length, 1);
  assert.equal(k.baris[0].quantityMilli, 1000);
  assert.equal(k.baris[0].unitPrice, 20000);
  assert.equal(k.baris[0].itemName, 'Kopi Susu');
  assert.equal(k.baris[0].variationName, 'Regular');
});

test('⛔ variation BERBEDA dari item yang sama tidak digabung', async () => {
  const { keranjangKosong, tambah } = await import(MOD);

  let k = keranjangKosong();
  k = tambah(k, { item: ITEM, variation: V1, modifier: [], idBaris: () => 'b1' });
  k = tambah(k, { item: ITEM, variation: V2, modifier: [], idBaris: () => 'b2' });

  // Regular dan Large harganya berbeda. Menggabungkannya menghasilkan struk
  // yang totalnya benar tapi barisnya bohong — dan refund sebagian, yang
  // menyebut baris, jadi mustahil.
  assert.equal(k.baris.length, 2);
});

test('item + variation + modifier yang sama DIGABUNG jadi satu baris', async () => {
  const { keranjangKosong, tambah } = await import(MOD);

  let k = keranjangKosong();
  k = tambah(k, { item: ITEM, variation: V1, modifier: [], idBaris: () => 'b1' });
  k = tambah(k, { item: ITEM, variation: V1, modifier: [], idBaris: () => 'b2' });

  assert.equal(k.baris.length, 1, 'dua kopi yang sama = satu baris qty 2');
  assert.equal(k.baris[0].quantityMilli, 2000);
});

test('⛔ modifier BERBEDA memisahkan baris', async () => {
  const { keranjangKosong, tambah } = await import(MOD);

  let k = keranjangKosong();
  k = tambah(k, { item: ITEM, variation: V1, modifier: [], idBaris: () => 'b1' });
  k = tambah(k, { item: ITEM, variation: V1, modifier: [GULA], idBaris: () => 'b2' });

  // Satu kopi biasa dan satu kopi ekstra gula bukan "dua kopi". Barista
  // membaca struk ini.
  assert.equal(k.baris.length, 2);
  assert.equal(k.baris[1].modifier[0].nama, 'Ekstra gula');
});

test('modifier dalam urutan berbeda tetap dianggap SAMA', async () => {
  const { keranjangKosong, tambah } = await import(MOD);
  const es = { id: 'm2', nama: 'Es sedikit', harga: 0, bawaan: false };

  let k = keranjangKosong();
  k = tambah(k, { item: ITEM, variation: V1, modifier: [GULA, es], idBaris: () => 'b1' });
  k = tambah(k, { item: ITEM, variation: V1, modifier: [es, GULA], idBaris: () => 'b2' });

  // Urutan penekanan tombol tidak boleh menghasilkan dua baris untuk pesanan
  // yang identik.
  assert.equal(k.baris.length, 1);
  assert.equal(k.baris[0].quantityMilli, 2000);
});

test('ubah kuantitas, dan nol MENGHAPUS baris', async () => {
  const { keranjangKosong, tambah, ubahQty } = await import(MOD);

  let k = tambah(keranjangKosong(), { item: ITEM, variation: V1, modifier: [], idBaris: () => 'b1' });
  k = ubahQty(k, 'b1', 3000);
  assert.equal(k.baris[0].quantityMilli, 3000);

  // Kasir yang menurunkan kuantitas ke nol bermaksud membuang barisnya.
  // Baris ber-kuantitas nol yang tertinggal akan ikut ke server dan muncul di
  // struk sebagai "0× Kopi Susu".
  k = ubahQty(k, 'b1', 0);
  assert.deepEqual(k.baris, []);
});

test('hapus baris, dan kosongkan', async () => {
  const { keranjangKosong, tambah, hapusBaris, kosongkan } = await import(MOD);

  let k = keranjangKosong();
  k = tambah(k, { item: ITEM, variation: V1, modifier: [], idBaris: () => 'b1' });
  k = tambah(k, { item: ITEM, variation: V2, modifier: [], idBaris: () => 'b2' });

  assert.equal(hapusBaris(k, 'b1').baris.length, 1);
  assert.deepEqual(kosongkan(k).baris, []);
});

test('subtotal memasukkan harga modifier dan kuantitas', async () => {
  const { keranjangKosong, tambah, ubahQty, subtotalKeranjang } = await import(MOD);

  let k = keranjangKosong();
  k = tambah(k, { item: ITEM, variation: V1, modifier: [GULA], idBaris: () => 'b1' });
  k = ubahQty(k, 'b1', 2000);

  // (20.000 + 3.000) x 2 = 46.000
  assert.equal(subtotalKeranjang(k), 46000n);
});

test('⛔ keranjang TIDAK PERNAH menyentuh float', async () => {
  const { keranjangKosong, tambah, ubahQty, subtotalKeranjang } = await import(MOD);

  // Kuantitas berskala 1000 dan harga rupiah utuh: hasil kalinya harus
  // bigint. Aturan "jalur uang tidak menyentuh float" tidak punya
  // pengecualian, dan keranjang adalah tempat pertama angka itu muncul di
  // layar.
  let k = tambah(keranjangKosong(), { item: ITEM, variation: V1, modifier: [], idBaris: () => 'b1' });
  k = ubahQty(k, 'b1', 1500); // 1,5 x 20.000 = 30.000
  const total = subtotalKeranjang(k);
  assert.equal(typeof total, 'bigint');
  assert.equal(total, 30000n);
});

test('keranjang kosong: subtotal nol, bukan galat', async () => {
  const { keranjangKosong, subtotalKeranjang } = await import(MOD);
  assert.equal(subtotalKeranjang(keranjangKosong()), 0n);
});

// --- FR-E4: kuantitas kumulatif per variation ---

test('⛔ qty di keranjang dijumlahkan LINTAS baris untuk variation yang sama', async () => {
  // Modifier berbeda memisahkan baris (aturan yang sudah ada), tapi stoknya
  // satu. Kasir yang menambah 2 Kopi biasa lalu 2 Kopi extra-shot sudah
  // mengambil 4 dari rak — memeriksa per baris akan meloloskan penjualan yang
  // melewati stok tanpa satu pun peringatan.
  const { keranjangKosong, tambah, qtyDiKeranjang } = await import(MOD);
  const item = { id: 'i1', nama: 'Kopi', variations: [{ id: 'v1', nama: 'Regular', harga: 20000 }] };
  const v = { id: 'v1', nama: 'Regular', harga: 20000 };

  let k = keranjangKosong();
  k = tambah(k, { item, variation: v, modifier: [], idBaris: () => 'b1', qtyMilli: 2000 });
  k = tambah(k, {
    item, variation: v,
    modifier: [{ id: 'm1', nama: 'Extra shot', harga: 5000, qtyMilli: 1000 }],
    idBaris: () => 'b2', qtyMilli: 2000,
  });

  assert.equal(k.baris.length, 2, 'modifier berbeda tetap memisahkan baris');
  assert.equal(qtyDiKeranjang(k, 'v1'), 4000, 'kuantitas harus dijumlahkan lintas baris');
});

test('variation yang belum ada di keranjang: nol', async () => {
  const { keranjangKosong, qtyDiKeranjang } = await import(MOD);
  assert.equal(qtyDiKeranjang(keranjangKosong(), 'v-belum'), 0);
});

// ---------------------------------------------------------------------------
// FR-A3 — kuantitas modifier (`allow_duplicate`)
// ---------------------------------------------------------------------------

test('⛔ kuantitas modifier MEMISAHKAN baris', async () => {
  const { keranjangKosong, tambah } = await import(MOD);
  const item = { id: 'i1', nama: 'Kopi', variations: [{ id: 'v1', nama: 'Regular', harga: 20000 }] };
  const v = { id: 'v1', nama: 'Regular', harga: 20000 };
  const satu = [{ id: 'm1', nama: 'Extra shot', harga: 5000, qtyMilli: 1000 }];
  const dua = [{ id: 'm1', nama: 'Extra shot', harga: 5000, qtyMilli: 2000 }];

  let k = keranjangKosong();
  k = tambah(k, { item, variation: v, modifier: satu, idBaris: () => 'b1' });
  k = tambah(k, { item, variation: v, modifier: dua, idBaris: () => 'b2' });

  // "Extra Shot ×1" dan "Extra Shot ×2" adalah dua pesanan dengan harga
  // berbeda. Menggabungkannya membuat pelanggan kedua menerima kopi pelanggan
  // pertama, dan totalnya salah tanpa satu pun error.
  assert.equal(k.baris.length, 2, 'kuantitas modifier tidak masuk sidik jari');
});

test('⛔ subtotal MENGALIKAN harga modifier dengan kuantitasnya', async () => {
  const { keranjangKosong, tambah, subtotalKeranjang, satuanKeranjang } = await import(MOD);
  const item = { id: 'i1', nama: 'Kopi', variations: [{ id: 'v1', nama: 'Regular', harga: 20000 }] };
  const v = { id: 'v1', nama: 'Regular', harga: 20000 };

  let k = keranjangKosong();
  k = tambah(k, {
    item, variation: v,
    modifier: [{ id: 'm1', nama: 'Extra shot', harga: 5000, qtyMilli: 2000 }],
    idBaris: () => 'b1',
    qtyMilli: 2000,
  });

  // 20.000 + (5.000 × 2) = 30.000 per unit; dua unit = 60.000.
  assert.equal(satuanKeranjang(k.baris[0]), 30000n);
  assert.equal(subtotalKeranjang(k), 60000n);
});
