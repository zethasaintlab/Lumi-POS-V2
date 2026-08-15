'use strict';

// B-25 — Pajak.
//
// ⛔ Dua aturan yang menentukan seluruh bentuk layar ini:
//
//   1. `rate` WAJIB string desimal PECAHAN ("0.11"), sementara merchant
//      berpikir PERSEN ("11%"). Konversinya tidak boleh lewat pembagian —
//      `parseRateToScaled` menolak `number` justru supaya nilai itu tidak
//      pernah menyentuh IEEE754 double, dan membaginya di klien membatalkan
//      seluruh alasan modul itu ada.
//
//   2. `appliesTo` dan `appliesToIds` saling menuntut: `all_items` menuntut
//      daftar KOSONG, sisanya menuntut daftar TERISI.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../apps/backoffice/src/pajak/pajak.ts';

const ID = '018f2a10-0000-7000-8000-0000000000t5';

const FORM = {
  nama: 'PBJT Jakarta',
  tipe: 'pbjt',
  persen: '11',
  isInclusive: false,
  phase: 'subtotal',
  channel: 'all',
  appliesTo: 'all_items',
  appliesToIds: [],
  outletId: '',
};

// ---------------------------------------------------------------------------
// ⛔ Persen → pecahan, TANPA pembagian
// ---------------------------------------------------------------------------

test('⛔ persen diubah jadi pecahan lewat GESER KOMA, bukan bagi 100', async () => {
  // `1.15 / 100` di JavaScript menghasilkan 0.0115 yang bentuk desimalnya
  // bergantung pembulatan double. Menggeser koma pada STRING tidak pernah
  // menyentuh double sama sekali — pola yang sama dengan `parseRateToScaled`,
  // yang menolak `number` justru untuk alasan itu.
  const { persenKeRate } = await import(MOD);
  assert.equal(persenKeRate('11'), '0.11');
  assert.equal(persenKeRate('10'), '0.10');
  assert.equal(persenKeRate('5'), '0.05');
  assert.equal(persenKeRate('8.25'), '0.0825');
  assert.equal(persenKeRate('1.15'), '0.0115');
  assert.equal(persenKeRate('0'), '0.00');
  assert.equal(persenKeRate('100'), '1.00');
});

test('koma diterima sebagai pemisah desimal', async () => {
  // Papan ketik Indonesia menulis "11,5".
  const { persenKeRate } = await import(MOD);
  assert.equal(persenKeRate('11,5'), '0.115');
});

test('⛔ hasilnya SELALU string, dan tidak pernah number', async () => {
  // Mengirim number membuat server menolak dengan "Tarif harus dikirim
  // sebagai string desimal" — dan itu benar, tapi merchant tidak dapat
  // berbuat apa pun dengan pesan itu.
  const { persenKeRate, buatMuatanPajak } = await import(MOD);
  assert.equal(typeof persenKeRate('11'), 'string');
  assert.equal(typeof buatMuatanPajak(FORM, ID).muatan.rate, 'string');
});

test('⛔ persen berdesimal lebih dari DUA digit ditolak', async () => {
  // `numeric(6,4)` menyimpan empat digit desimal pada PECAHAN, jadi persen
  // hanya punya dua. Server menolaknya (`parseRateToScaled`), tapi pesannya
  // menyebut "4 digit" pada angka yang merchant lihat sebagai persen —
  // membingungkan tepat di titik ia perlu memperbaiki ketikannya.
  const { buatMuatanPajak } = await import(MOD);
  const hasil = buatMuatanPajak({ ...FORM, persen: '11.234' }, ID);
  assert.equal(hasil.ok, false);
  assert.equal(hasil.bidang, 'persen');
});

test('persen kosong, negatif, atau bukan angka ditolak', async () => {
  const { buatMuatanPajak } = await import(MOD);
  for (const buruk of ['', '  ', 'abc', '-5', '11%']) {
    const hasil = buatMuatanPajak({ ...FORM, persen: buruk }, ID);
    assert.equal(hasil.ok, false, `"${buruk}" diterima`);
    assert.equal(hasil.bidang, 'persen');
  }
});

test('tarif NOL sah — "none" dan pembebasan pajak itu nyata', async () => {
  const { buatMuatanPajak } = await import(MOD);
  const hasil = buatMuatanPajak({ ...FORM, tipe: 'none', persen: '0' }, ID);
  assert.equal(hasil.ok, true, hasil.ok === false ? hasil.pesan : '');
  assert.equal(hasil.muatan.rate, '0.00');
});

test('rate ditampilkan kembali sebagai persen', async () => {
  const { rateKePersen } = await import(MOD);
  assert.equal(rateKePersen('0.1100'), '11');
  assert.equal(rateKePersen('0.0825'), '8,25');
  assert.equal(rateKePersen('0.0000'), '0');
});

// ---------------------------------------------------------------------------
// ⛔ Ruang lingkup penerapan
// ---------------------------------------------------------------------------

test('⛔ all_items menuntut appliesToIds KOSONG', async () => {
  const { buatMuatanPajak } = await import(MOD);
  const hasil = buatMuatanPajak({ ...FORM, appliesTo: 'all_items', appliesToIds: ['c1'] }, ID);
  assert.equal(hasil.ok, false);
  assert.equal(hasil.bidang, 'appliesToIds');
});

test('⛔ category dan item menuntut appliesToIds TERISI', async () => {
  // `CLAUDE.md` mencatat cacat F3 yang persis di sini: `getVariationSnapshot`
  // memetakan `itemId`/`categoryId` tanpa menyeleksinya, jadi tarif ber-scope
  // item/kategori TIDAK PERNAH BERLAKU — dua dari tiga tingkat FR-C6 mati,
  // tanpa satu pun error. Yang menyembunyikannya: test hanya menguji
  // PEMBUATAN tarif ber-scope, bukan penerapannya.
  //
  // Layar yang membiarkan daftar kosong lolos akan menghasilkan tarif yang
  // terlihat ada dan tidak pernah menyentuh satu transaksi pun.
  const { buatMuatanPajak } = await import(MOD);
  for (const scope of ['category', 'item']) {
    const hasil = buatMuatanPajak({ ...FORM, appliesTo: scope, appliesToIds: [] }, ID);
    assert.equal(hasil.ok, false, `${scope} tanpa id diterima`);
    assert.equal(hasil.bidang, 'appliesToIds');
  }
});

test('scope category dengan id lolos, dan idnya ikut', async () => {
  const { buatMuatanPajak } = await import(MOD);
  const hasil = buatMuatanPajak({ ...FORM, appliesTo: 'category', appliesToIds: ['c1', 'c2'] }, ID);
  assert.equal(hasil.ok, true, hasil.ok === false ? hasil.pesan : '');
  assert.deepEqual(hasil.muatan.appliesToIds, ['c1', 'c2']);
});

test('nilai enum di luar daftar ditolak, masing-masing menunjuk fieldnya', async () => {
  const { buatMuatanPajak } = await import(MOD);
  const kasus = [
    ['tipe', 'pph'],
    ['phase', 'akhir'],
    ['channel', 'delivery'],
    ['appliesTo', 'variation'],
  ];
  for (const [bidang, nilai] of kasus) {
    const hasil = buatMuatanPajak({ ...FORM, [bidang]: nilai }, ID);
    assert.equal(hasil.ok, false, `${bidang}="${nilai}" diterima`);
    assert.equal(hasil.bidang, bidang);
  }
});

test('outlet kosong berarti seluruh tenant — null, bukan string kosong', async () => {
  const { buatMuatanPajak } = await import(MOD);
  assert.equal(buatMuatanPajak(FORM, ID).muatan.outletId, null);
  assert.equal(buatMuatanPajak({ ...FORM, outletId: 'o1' }, ID).muatan.outletId, 'o1');
});

test('⛔ effectiveFrom TIDAK dikirim — jam database yang menstempel', async () => {
  // Sama seperti B-10: mengirim `new Date()` dari browser memperkenalkan jam
  // ketiga, dan tarif yang "belum berlaku" karena skew akan diam-diam tidak
  // dipakai `TaxCalculator`.
  const { buatMuatanPajak } = await import(MOD);
  assert.ok(!('effectiveFrom' in buatMuatanPajak(FORM, ID).muatan));
});

// ---------------------------------------------------------------------------
// Daftar
// ---------------------------------------------------------------------------

const TARIF = (over) => ({
  id: 't1', name: 'PBJT', type: 'pbjt', rate: '0.1100', isInclusive: false,
  phase: 'subtotal', channel: 'all', appliesTo: 'all_items', appliesToIds: [],
  outletId: null, effectiveFrom: '2026-01-01T00:00:00Z', effectiveTo: null, ...over,
});

test('⛔ tarif yang sudah DIAKHIRI dibedakan, dan tetap ditampilkan', async () => {
  // `GET /tax-rates` mengembalikan keduanya, dan barisnya tidak pernah dihapus
  // (invariant #2) supaya transaksi historis tetap dapat dijelaskan.
  const { pisahkanTarif } = await import(MOD);
  const hasil = pisahkanTarif([
    TARIF({ id: 'aktif' }),
    TARIF({ id: 'selesai', effectiveTo: '2026-06-01T00:00:00Z' }),
  ]);
  assert.deepEqual(hasil.aktif.map((t) => t.id), ['aktif']);
  assert.deepEqual(hasil.diakhiri.map((t) => t.id), ['selesai']);
});

test('urutan tampil dimiliki JS: terbaru dulu', async () => {
  const { pisahkanTarif } = await import(MOD);
  const hasil = pisahkanTarif([
    TARIF({ id: 'lama', effectiveFrom: '2025-01-01T00:00:00Z' }),
    TARIF({ id: 'baru', effectiveFrom: '2026-01-01T00:00:00Z' }),
  ]);
  assert.deepEqual(hasil.aktif.map((t) => t.id), ['baru', 'lama']);
});

test('⛔ setiap hasil persenKeRate DITERIMA parseRateToScaled server', async () => {
  // Penjaga silang. `parseRateToScaled` adalah satu-satunya sumber kebenaran
  // di server, dan ia menolak `number`, menolak lebih dari 4 digit desimal,
  // dan menolak bentuk yang bukan desimal.
  //
  // Tanpa test ini, konversi di klien dapat menghasilkan string yang terlihat
  // benar dan ditolak 400 di server — merchant melihat "Tarif tidak sah" untuk
  // angka yang ia ketik dengan benar.
  const { persenKeRate } = await import(MOD);
  const { parseRateToScaled } = await import('../../packages/domain/src/numeric.ts');

  const kasus = [
    ['0', 0n],
    ['5', 500n],
    ['10', 1000n],
    ['11', 1100n],
    ['8,25', 825n],
    ['1.15', 115n],
    ['100', 10000n],
  ];

  for (const [persen, skala] of kasus) {
    const rate = persenKeRate(persen);
    assert.notEqual(rate, null, `"${persen}" ditolak klien`);
    assert.equal(parseRateToScaled(rate), skala, `"${persen}" → "${rate}" salah skala`);
  }
});
