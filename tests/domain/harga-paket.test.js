'use strict';

// Harga paket dan tagihan bulanan — KEP-38/KEP-39.
//
// ⛔ KEP-38: unit harga adalah **per outlet per bulan**, bukan per terminal
// atau per pengguna. Konsekuensi langsung yang mudah terlewat: outlet karena
// itu BUKAN dimensi kuota di tier berbayar. Membatasinya sekaligus menagih
// per-outlet berarti menagih merchant untuk sesuatu yang juga ditolak.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../packages/domain/src/paket.ts';

// ---------------------------------------------------------------------------
// Harga
// ---------------------------------------------------------------------------

test('⛔ harga adalah bigint rupiah utuh, tidak pernah float', async () => {
  // `CLAUDE.md`: uang selalu `bigint` rupiah utuh. Tagihan langganan adalah
  // uang sungguhan yang merchant bayar — ia tidak dikecualikan karena bukan
  // penjualan.
  const { HARGA_PAKET } = await import(MOD);
  for (const [nama, harga] of Object.entries(HARGA_PAKET)) {
    if (harga === null) continue; // enterprise: custom
    assert.equal(typeof harga, 'bigint', `${nama} bukan bigint`);
  }
});

test('harga mengikuti KEP-39', async () => {
  const { HARGA_PAKET } = await import(MOD);
  assert.equal(HARGA_PAKET.free, 0n);
  assert.equal(HARGA_PAKET.standard, 349000n);
  assert.equal(HARGA_PAKET.pro, 699000n);
});

test('⛔ enterprise TIDAK punya harga — ia negosiasi, bukan self-serve', async () => {
  // Harga angka untuk enterprise berarti seseorang dapat membelinya sendiri
  // di B-29 dengan harga yang tidak pernah disepakati siapa pun.
  const { HARGA_PAKET } = await import(MOD);
  assert.equal(HARGA_PAKET.enterprise, null);
});

test('⛔ setiap paket di KUOTA_PAKET punya entri harga', async () => {
  // Paket yang punya kuota tapi tidak punya harga adalah paket yang dapat
  // dipilih lalu gagal saat ditagih.
  const { HARGA_PAKET, KUOTA_PAKET } = await import(MOD);
  assert.deepEqual(Object.keys(HARGA_PAKET).sort(), Object.keys(KUOTA_PAKET).sort());
});

// ---------------------------------------------------------------------------
// Outlet tidak dibatasi di tier berbayar
// ---------------------------------------------------------------------------

test('⛔ tier BERBAYAR tidak membatasi outlet — harganya per outlet', async () => {
  const { KUOTA_PAKET } = await import(MOD);
  assert.equal(KUOTA_PAKET.standard.maxOutlets, null);
  assert.equal(KUOTA_PAKET.pro.maxOutlets, null);
});

test('⛔ tier GRATIS tetap membatasi outlet', async () => {
  // Kalau tidak, pendaftaran mandiri memberi outlet tanpa batas seharga Rp0.
  const { KUOTA_PAKET } = await import(MOD);
  assert.equal(KUOTA_PAKET.free.maxOutlets, 1);
});

// ---------------------------------------------------------------------------
// Tagihan
// ---------------------------------------------------------------------------

test('tagihan = harga × jumlah outlet', async () => {
  const { hitungTagihanBulanan } = await import(MOD);
  assert.equal(hitungTagihanBulanan('standard', 3), 1047000n);
  assert.equal(hitungTagihanBulanan('pro', 2), 1398000n);
});

test('satu outlet menagih harga dasarnya', async () => {
  const { hitungTagihanBulanan } = await import(MOD);
  assert.equal(hitungTagihanBulanan('standard', 1), 349000n);
});

test('gratis menagih nol berapa pun outletnya', async () => {
  const { hitungTagihanBulanan } = await import(MOD);
  assert.equal(hitungTagihanBulanan('free', 1), 0n);
});

test('⛔ enterprise MELEMPAR — tidak ada tagihan yang dapat dihitung', async () => {
  const { hitungTagihanBulanan } = await import(MOD);
  assert.throws(() => hitungTagihanBulanan('enterprise', 3), /negosiasi|custom/i);
});

test('⛔ jumlah outlet nol atau negatif MELEMPAR', async () => {
  // Tagihan Rp0 untuk paket berbayar adalah tagihan yang tidak akan pernah
  // ditanyakan siapa pun — dan tenant tanpa outlet tidak dapat berjualan,
  // jadi angka itu selalu berarti pemanggil salah menghitung.
  const { hitungTagihanBulanan } = await import(MOD);
  assert.throws(() => hitungTagihanBulanan('standard', 0), /outlet/i);
  assert.throws(() => hitungTagihanBulanan('standard', -1), /outlet/i);
});

test('⛔ paket tak dikenal MELEMPAR', async () => {
  const { hitungTagihanBulanan } = await import(MOD);
  assert.throws(() => hitungTagihanBulanan('gratisan', 1), /tidak dikenal/i);
});

test('⛔ tagihan TIDAK PERNAH menyentuh float', async () => {
  // 3.000 outlet × Rp699.000 = Rp2.097.000.000 — masih jauh di bawah 2⁵³,
  // jadi float akan "kebetulan benar" di sini. Yang diuji adalah TIPENYA,
  // karena itu yang menjaga aturan tetap tanpa pengecualian saat angkanya
  // suatu hari melewati batas itu.
  const { hitungTagihanBulanan } = await import(MOD);
  const t = hitungTagihanBulanan('pro', 3000);
  assert.equal(typeof t, 'bigint');
  assert.equal(t, 2097000000n);
});
