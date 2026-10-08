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
  assert.equal(satuanKeranjang(k.baris[0]), 30000n, 'satuanKeranjang mengabaikan KUANTITAS modifier (Extra shot ×2 dihitung ×1): harga per item salah tanpa galat');
  assert.equal(subtotalKeranjang(k), 60000n, 'subtotalKeranjang tidak mengalikan harga modifier dengan kuantitasnya');
});

// --- gantiModifier (Edit Item, Task 6) ---

const ES = { id: 'm2', nama: 'Es', harga: 0, qtyMilli: 1000 };

test('gantiModifier: modifier baru menggantikan, diskon tidak tersentuh', async () => {
  const { keranjangKosong, tambah, gantiModifier, setelDiskon } = await import(MOD);
  const diskon = {
    minta: { tipe: 'persen', nilai: 1000n },
    alasanKode: 'loyal',
    alasanCatatan: null,
    approverId: 'mgr',
    nominalDisetujui: 2000n,
  };
  let k = tambah(keranjangKosong(), { item: ITEM, variation: V1, modifier: [GULA], idBaris: () => 'b1' });
  k = setelDiskon(k, diskon);
  const baru = gantiModifier(k, 'b1', [ES]);
  assert.equal(baru.baris.length, 1);
  assert.deepEqual(baru.baris[0].modifier, [ES]);
  assert.equal(baru.baris[0].id, 'b1', 'id baris berubah — jejak KEP-21 dan refund per baris putus');
  assert.equal(baru.baris[0].quantityMilli, 1000);
  assert.equal(baru.diskon, diskon, 'gantiModifier menyentuh diskon (persetujuan manajer harus tetap terikat pada nominalDisetujui)');
  // Asli tidak bermutasi.
  assert.deepEqual(k.baris[0].modifier, [GULA]);
});

test('⛔ gantiModifier yang menyamai baris lain MENGGABUNG, qty dijumlah', async () => {
  const { keranjangKosong, tambah, ubahQty, gantiModifier } = await import(MOD);
  let k = keranjangKosong();
  k = tambah(k, { item: ITEM, variation: V1, modifier: [], idBaris: () => 'polos' });
  k = tambah(k, { item: ITEM, variation: V1, modifier: [GULA], idBaris: () => 'gula' });
  k = ubahQty(k, 'polos', 2000);
  k = ubahQty(k, 'gula', 3000);
  // Baris "gula" diubah menjadi polos → sama dengan baris "polos".
  const baru = gantiModifier(k, 'gula', []);
  assert.equal(baru.baris.length, 1, 'dua baris identik tidak digabung — struk berbohong, refund per baris ambigu');
  assert.equal(baru.baris[0].quantityMilli, 5000, 'qty tidak dijumlah (2000 + 3000)');
  assert.equal(baru.baris[0].id, 'polos', 'yang HILANG harus baris yang diedit, bukan baris lain');
  // Urutan modifier tidak penting.
  let k2 = keranjangKosong();
  k2 = tambah(k2, { item: ITEM, variation: V1, modifier: [GULA, ES], idBaris: () => 'a' });
  k2 = tambah(k2, { item: ITEM, variation: V1, modifier: [GULA], idBaris: () => 'b' });
  const baru2 = gantiModifier(k2, 'b', [ES, GULA]);
  assert.equal(baru2.baris.length, 1, 'urutan modifier memisahkan baris');
  // Variation berbeda tidak pernah digabung.
  let k3 = keranjangKosong();
  k3 = tambah(k3, { item: ITEM, variation: V1, modifier: [], idBaris: () => 'r' });
  k3 = tambah(k3, { item: ITEM, variation: V2, modifier: [GULA], idBaris: () => 'l' });
  assert.equal(gantiModifier(k3, 'l', []).baris.length, 2, 'Regular dan Large digabung');
  // Kuantitas modifier ikut sidik jari.
  let k4 = keranjangKosong();
  k4 = tambah(k4, { item: ITEM, variation: V1, modifier: [GULA], idBaris: () => 'x1' });
  k4 = tambah(k4, { item: ITEM, variation: V1, modifier: [{ ...GULA, qtyMilli: 2000 }], idBaris: () => 'x2' });
  assert.equal(k4.baris.length, 2);
  assert.equal(gantiModifier(k4, 'x2', [GULA]).baris.length, 1);
});

test('gantiModifier: id tak dikenal mengembalikan keranjang apa adanya', async () => {
  const { keranjangKosong, tambah, gantiModifier } = await import(MOD);
  const k = tambah(keranjangKosong(), { item: ITEM, variation: V1, modifier: [], idBaris: () => 'b1' });
  assert.deepEqual(gantiModifier(k, 'tidak-ada', [GULA]), k);
});

test('gantiModifier tidak pernah menyentuh float', async () => {
  const { keranjangKosong, tambah, ubahQty, gantiModifier, subtotalKeranjang } = await import(MOD);
  let k = tambah(keranjangKosong(), { item: ITEM, variation: V1, modifier: [], idBaris: () => 'b1' });
  k = ubahQty(k, 'b1', 1500);
  const baru = gantiModifier(k, 'b1', [GULA]); // 1,5 x (20.000 + 3.000) = 34.500
  const total = subtotalKeranjang(baru);
  assert.equal(typeof total, 'bigint');
  assert.equal(total, 34500n);
  assert.ok(Number.isInteger(baru.baris[0].quantityMilli));
});

test('⛔ gantiModifier: baris yang hanya berbeda KUANTITAS modifier TIDAK digabung', async () => {
  const { keranjangKosong, tambah, ubahQty, gantiModifier } = await import(MOD);
  // "Gula ×1" dan "Gula ×2" adalah dua pesanan berbeda dengan harga berbeda (komentar `sidik`).
  let k = keranjangKosong();
  k = tambah(k, { item: ITEM, variation: V1, modifier: [{ ...GULA, qtyMilli: 2000 }], idBaris: () => 'dua' });
  k = tambah(k, { item: ITEM, variation: V1, modifier: [GULA], idBaris: () => 'satu' });
  k = tambah(k, { item: ITEM, variation: V1, modifier: [ES], idBaris: () => 'lain' });
  k = ubahQty(k, 'lain', 4000);
  // 'lain' menjadi Gula ×1: kembarnya 'satu' (bukan 'dua', yang Gula ×2).
  const baru = gantiModifier(k, 'lain', [GULA]);
  const dua = baru.baris.find((b) => b.id === 'dua');
  const satu = baru.baris.find((b) => b.id === 'satu');
  assert.equal(baru.baris.length, 2, 'baris menjadi Gula ×1 harus bergabung dengan kembarnya SAJA');
  assert.equal(dua.quantityMilli, 1000, 'baris Gula ×2 ikut tergabung — kuantitas modifier diabaikan saat mencari kembar (total salah tanpa galat)');
  assert.equal(satu.quantityMilli, 5000, 'baris Gula ×1 tidak menerima qty gabungan (1 + 4)');
  // Tanpa kembar sama sekali: tidak ada penggabungan.
  const tanpa = gantiModifier(k, 'lain', [{ ...GULA, qtyMilli: 3000 }]);
  assert.equal(tanpa.baris.length, 3, 'Gula ×3 tidak punya kembar tetapi tergabung');
});

test('⛔ gantiModifier: cabang PENGGABUNGAN mempertahankan diskon order apa adanya', async () => {
  const { keranjangKosong, tambah, gantiModifier, setelDiskon } = await import(MOD);
  // Spec kasir § 6: "diskon tetap tingkat order … Edit Item tidak menyentuh diskon"; interface Task 6:
  // `gantiModifier` — "`diskon` tidak disentuh". Persetujuan manajer terikat pada nominalDisetujui.
  const diskon = {
    minta: { tipe: 'persen', nilai: 3000n },
    alasanKode: 'loyal',
    alasanCatatan: null,
    approverId: 'mgr',
    nominalDisetujui: 30000n,
  };
  let k = keranjangKosong();
  k = tambah(k, { item: ITEM, variation: V1, modifier: [], idBaris: () => 'polos' });
  k = tambah(k, { item: ITEM, variation: V1, modifier: [GULA], idBaris: () => 'gula' });
  k = setelDiskon(k, diskon);
  const baru = gantiModifier(k, 'gula', []); // menyamai 'polos' → CABANG GABUNG
  assert.equal(baru.baris.length, 1, 'fixture: cabang penggabungan tidak berjalan — penjaga hampa');
  assert.equal(baru.diskon, diskon, 'cabang penggabungan gantiModifier menjatuhkan/mengubah diskon order (persetujuan manajer hilang diam-diam)');
});

// ---------------------------------------------------------------------------
// Task 10 fix round (I-1): kanal tidak bocor ke pesanan berikutnya.

test('⛔ kanal kembali ke takeaway saat keranjang berisi→kosong (hapusBaris dan qty→0); memilih kanal pada keranjang kosong tetap boleh', async () => {
  const { keranjangKosong, tambah, setelKanal, hapusBaris, ubahQty } = await import(MOD);
  const isi = tambah(setelKanal(keranjangKosong(), 'dine_in'), { item: ITEM, variation: V1, modifier: [], idBaris: () => 'b1' });
  assert.equal(isi.kanal, 'dine_in', 'pembanding hampa: kanal dine_in tidak terpasang');

  assert.equal(hapusBaris(isi, 'b1').kanal, 'takeaway', 'hapusBaris baris terakhir membawa Dine in ke pesanan berikutnya');
  assert.equal(ubahQty(isi, 'b1', 0).kanal, 'takeaway', 'qty→0 membawa Dine in ke pesanan berikutnya');

  // Masih ada baris lain → kanal dipertahankan.
  const dua = tambah(isi, { item: ITEM, variation: V2, modifier: [], idBaris: () => 'b2' });
  assert.equal(hapusBaris(dua, 'b1').kanal, 'dine_in', 'menghapus SATU dari dua baris mengubah kanal');

  // Memilih kanal pada keranjang yang sudah kosong tetap sah.
  assert.equal(setelKanal(keranjangKosong(), 'dine_in').kanal, 'dine_in');
});

// M-2: ringkasKanal / kanalSah murni, dengan nama tarif yang BUKAN fixture mana pun.
test('ringkasKanal mengambil nama dari rincian pajak tiap kanal (nama non-fixture); sama true hanya bila daftar identik', async () => {
  const { ringkasKanal, kanalSah, kanalDari } = await import('../../apps/kasir/src/kasir/kanal.ts');
  const h = (...nama) => ({ pajak: { lines: nama.map((name) => ({ name })) } });

  const beda = ringkasKanal({ dine_in: h('Zeta Resto 7', 'Biaya Qux'), takeaway: h('Alfa Bawa 3') });
  assert.deepEqual(beda.map((r) => r.kanal), ['takeaway', 'dine_in']);
  assert.deepEqual(beda.find((r) => r.kanal === 'dine_in').namaTarif, ['Zeta Resto 7', 'Biaya Qux']);
  assert.deepEqual(beda.find((r) => r.kanal === 'takeaway').namaTarif, ['Alfa Bawa 3']);
  assert.ok(beda.every((r) => r.sama === false));

  const sama = ringkasKanal({ dine_in: h('Omega 1'), takeaway: h('Omega 1') });
  assert.ok(sama.every((r) => r.sama === true && r.namaTarif[0] === 'Omega 1'));

  const kosong = ringkasKanal({ dine_in: h(), takeaway: h() });
  assert.ok(kosong.every((r) => r.sama === true && r.namaTarif.length === 0));

  assert.equal(kanalSah('dine_in'), 'dine_in');
  assert.equal(kanalSah('takeaway'), 'takeaway');
  for (const x of ['delivery', '', null, undefined, 1, {}]) assert.equal(kanalSah(x), 'takeaway', `kanalSah(${String(x)})`);
  assert.equal(kanalDari({}), 'takeaway');
  assert.equal(kanalDari({ kanal: 'dine_in' }), 'dine_in');
});

test('⛔ setelKanal: kanal dapat kembali Dine in → Takeaway, dan tidak menyentuh baris/diskon', async () => {
  const { keranjangKosong, tambah, setelKanal } = await import(MOD);
  const isi = tambah(keranjangKosong(), { item: ITEM, variation: V1, modifier: [], idBaris: () => 'b1' });
  const dine = setelKanal(isi, 'dine_in');
  assert.equal(dine.kanal, 'dine_in', 'pembanding hampa: Dine in tidak terpasang');
  const balik = setelKanal(dine, 'takeaway');
  assert.equal(balik.kanal, 'takeaway', 'kanal tidak dapat kembali ke Takeaway');
  assert.deepEqual(balik.baris, isi.baris);
  assert.equal(balik.diskon, null);
});
