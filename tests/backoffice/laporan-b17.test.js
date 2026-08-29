'use strict';

// B-17 — Laporan Produk.
//
// ⛔ Ini laporan OPERASIONAL, bukan finansial. `nilaiKotor` bukan omzet: ia
// nilai barang yang keluar, sebelum diskon baris, sebelum pajak, dan sebelum
// refund. Layar harus menyatakannya — dua angka berbeda yang memakai satu nama
// adalah cara tercepat menghancurkan kepercayaan pada laporan.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../apps/backoffice/src/laporan/b17.ts';

const BARIS = (over) => ({
  variationId: 'v1',
  itemName: 'Kopi Susu',
  variationName: 'Regular',
  kuantitas: '3000',
  kuantitasTampil: '3',
  nilaiKotor: '75000',
  ...over,
});

// ---------------------------------------------------------------------------

test('⛔ urutan dimiliki JS, bukan diwarisi dari ORDER BY server', async () => {
  // Server sudah mengurutkannya (`kuantitas DESC, item_name ASC`), dan itu
  // benar. Tapi jaminan yang HANYA hidup di SQL tidak dapat diuji sama sekali
  // (`CLAUDE.md`) — dan urutan "terlaris di atas" adalah seluruh gunanya
  // laporan ini.
  const { urutkanProduk } = await import(MOD);
  const hasil = urutkanProduk([
    BARIS({ variationId: 'a', itemName: 'Aneka', kuantitas: '1000' }),
    BARIS({ variationId: 'b', itemName: 'Banyak', kuantitas: '9000' }),
    BARIS({ variationId: 'c', itemName: 'Cukup', kuantitas: '5000' }),
  ]);
  assert.deepEqual(hasil.map((b) => b.variationId), ['b', 'c', 'a']);
});

test('⛔ kuantitas dibandingkan sebagai BIGINT, bukan string', async () => {
  // Perbandingan string menempatkan "9000" di atas "10000" — sembilan gelas
  // terlihat lebih laris daripada sepuluh. Dan `Number` membuang presisi pada
  // kuantitas besar.
  const { urutkanProduk } = await import(MOD);
  const hasil = urutkanProduk([
    BARIS({ variationId: 'sembilan', kuantitas: '9000' }),
    BARIS({ variationId: 'sepuluh', kuantitas: '10000' }),
  ]);
  assert.deepEqual(hasil.map((b) => b.variationId), ['sepuluh', 'sembilan']);
});

test('kuantitas sama diurutkan menurut nama — hasilnya tidak berpindah tiap muat', async () => {
  const { urutkanProduk } = await import(MOD);
  const hasil = urutkanProduk([
    BARIS({ variationId: 'z', itemName: 'Zamrud', kuantitas: '1000' }),
    BARIS({ variationId: 'a', itemName: 'Aneka', kuantitas: '1000' }),
  ]);
  assert.deepEqual(hasil.map((b) => b.variationId), ['a', 'z']);
});

test('⛔ total dijumlahkan lewat BIGINT, tanpa float sama sekali', async () => {
  // Baris footer menjumlahkan seluruh nilai kotor. `Number` di sini membuang
  // presisi tepat pada laporan bulanan — angka yang paling sering dilihat.
  const { totalProduk } = await import(MOD);
  const total = totalProduk([
    BARIS({ kuantitas: '3000', nilaiKotor: '75000' }),
    BARIS({ variationId: 'v2', kuantitas: '500', nilaiKotor: '100000' }),
  ]);
  assert.equal(total.kuantitas, '3500');
  assert.equal(total.kuantitasTampil, '3,5');
  assert.equal(total.nilaiKotor, '175000');
  assert.equal(total.jumlahVarian, 2);
});

test('total dari daftar kosong adalah nol yang jujur', async () => {
  const { totalProduk } = await import(MOD);
  const total = totalProduk([]);
  assert.equal(total.kuantitas, '0');
  assert.equal(total.nilaiKotor, '0');
  assert.equal(total.jumlahVarian, 0);
});

test('⛔ nilai besar melewati 2^53 tetap utuh', async () => {
  const { totalProduk } = await import(MOD);
  const total = totalProduk([
    BARIS({ nilaiKotor: '9007199254740993' }),
    BARIS({ variationId: 'v2', nilaiKotor: '1' }),
  ]);
  assert.equal(total.nilaiKotor, '9007199254740994');
});

test('nama gabungan menyebut varian hanya bila ia menambah informasi', async () => {
  // "Kopi Susu Regular" berguna; "Kopi Susu Kopi Susu" tidak. Varian bernama
  // sama dengan produknya muncul dari impor katalog yang tidak menyebut varian.
  const { namaLengkap } = await import(MOD);
  assert.equal(namaLengkap(BARIS({})), 'Kopi Susu · Regular');
  assert.equal(namaLengkap(BARIS({ variationName: 'Kopi Susu' })), 'Kopi Susu');
  assert.equal(namaLengkap(BARIS({ variationName: '' })), 'Kopi Susu');
});

test('⛔ periode kosong dibedakan dari galat, sama seperti B-16', async () => {
  const { periodeKosong } = await import(MOD);
  assert.equal(periodeKosong([]), true);
  assert.equal(periodeKosong([BARIS({})]), false);
});

test('⛔ rentang tanggal memakai fungsi yang SAMA dengan B-16', async () => {
  // Dua pemilih rentang yang menyimpang akan membuat satu laporan menerima
  // rentang yang laporan lain tolak, di aplikasi yang sama.
  const b16 = await import('../../apps/backoffice/src/laporan/b16.ts');
  const b17 = await import(MOD);
  assert.equal(b17.setelRentang, b16.setelRentang, 'B-17 punya setelRentang sendiri');
  assert.equal(b17.rentangSiap, b16.rentangSiap, 'B-17 punya rentangSiap sendiri');
});

// ---------------------------------------------------------------------------
// FR-A7 AC ketiga — kolom margin di B-17
// ---------------------------------------------------------------------------

const barisMargin = (over = {}) => ({
  variationId: 'v1',
  itemName: 'Kopi Susu',
  variationName: 'Regular',
  kuantitas: '2000',
  kuantitasTampil: '2',
  nilaiKotor: '40000',
  hpp: '16000',
  margin: '24000',
  marginPersen: 60,
  barisTanpaHpp: 0,
  jumlahBaris: 2,
  ...over,
});

test('⛔ total HPP dan margin null bila kolomnya TIDAK ADA di data', async () => {
  // Kasir menerima baris tanpa kunci margin sama sekali (`spec-g:99`). Total
  // yang mengembalikan "0" untuknya mengaku HPP-nya nol — dan nol berarti
  // margin 100%.
  const { totalProduk } = await import(MOD);
  const t = totalProduk([
    { variationId: 'v1', itemName: 'A', variationName: 'R', kuantitas: '1000', kuantitasTampil: '1', nilaiKotor: '5000' },
  ]);
  assert.equal(t.hpp, null);
  assert.equal(t.margin, null);
  assert.equal(t.nilaiKotor, '5000', 'angka non-margin tetap dihitung');
});

test('⛔ total margin dihitung dari TOTAL, dan lewat bigint', async () => {
  const { totalProduk } = await import(MOD);
  const t = totalProduk([
    barisMargin(),
    barisMargin({ variationId: 'v2', nilaiKotor: '10000', hpp: '4000', margin: '6000' }),
  ]);
  assert.equal(t.hpp, '20000');
  assert.equal(t.margin, '30000');
  assert.equal(typeof t.margin, 'string', 'uang tidak pernah number');
});

test('⛔ total margin BENAR untuk nilai di atas 2^53', async () => {
  // `Number` membuang presisi tepat pada laporan tahunan — angka yang paling
  // besar, dan yang paling jarang diperiksa ulang.
  const { totalProduk } = await import(MOD);
  const t = totalProduk([
    barisMargin({ nilaiKotor: '9007199254740993', hpp: '1', margin: '9007199254740992' }),
  ]);
  assert.equal(t.nilaiKotor, '9007199254740993');
  assert.equal(t.margin, '9007199254740992');
});

test('⛔ persen null ditampilkan "—", bukan "0%"', async () => {
  const { marginPersenTampil } = await import(MOD);
  assert.equal(marginPersenTampil(null), '—');
  assert.equal(marginPersenTampil(undefined), '—');
  assert.doesNotMatch(marginPersenTampil(null), /0/);
});

test('⛔ persen NEGATIF membawa katanya, dan besarannya tanpa tanda', async () => {
  // "−60%" di kolom bernama "Margin" dibaca sekilas sebagai enam puluh persen,
  // dan baris yang rugi adalah tepat baris yang paling perlu dilihat owner.
  const { marginPersenTampil } = await import(MOD);
  const rugi = marginPersenTampil(-60);
  assert.match(rugi, /rugi/i);
  assert.match(rugi, /60,0%/);
  assert.doesNotMatch(rugi, /[-−]\s*\d/, rugi);
  assert.notEqual(rugi, marginPersenTampil(60));
});

test('persen memakai KOMA dan satu digit desimal', async () => {
  const { marginPersenTampil } = await import(MOD);
  assert.equal(marginPersenTampil(12.34), '12,3%');
});

test('⛔ catatan HPP kosong MENYATAKAN arah kesalahannya', async () => {
  // "Angkanya lebih tinggi dari yang sebenarnya" dapat ditindaklanjuti;
  // "sebagian HPP kosong" tidak memberi tahu apakah marginnya terlalu tinggi
  // atau terlalu rendah.
  const { catatanHppKosong, totalProduk } = await import(MOD);
  const t = totalProduk([barisMargin({ barisTanpaHpp: 3 })]);
  const pesan = catatanHppKosong(t);
  assert.match(pesan, /3 baris/);
  assert.match(pesan, /lebih tinggi/i);
});

test('⛔ catatan HPP null bila semua baris punya HPP — peringatan yang selalu ada berhenti dibaca', async () => {
  const { catatanHppKosong, totalProduk } = await import(MOD);
  assert.equal(catatanHppKosong(totalProduk([barisMargin()])), null);
});

test('barisTanpaHpp dijumlahkan lintas varian', async () => {
  const { totalProduk } = await import(MOD);
  const t = totalProduk([
    barisMargin({ barisTanpaHpp: 2 }),
    barisMargin({ variationId: 'v2', barisTanpaHpp: 5 }),
  ]);
  assert.equal(t.barisTanpaHpp, 7);
});
