'use strict';

// bacaRupiah — angka rupiah yang DIKETIK manusia. Salah baca di sini = uang salah 10× tanpa error.
// Aturan: spasi hanya sah di tepi dan sesudah "Rp"; di dalam angka → null (Task 16 fix 2).

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../packages/domain/src/uang-tampilan.ts';

const NBSP = ' ';

const SAH = [
  ['0', 0], ['250000', 250_000], ['1.500.000', 1_500_000], ['670.550', 670_550], ['123457', 123_457],
  ['Rp 750.000', 750_000], ['rp750.000', 750_000], ['RP  750.000', 750_000],
  ['  750000  ', 750_000], [`${NBSP}750000${NBSP}`, 750_000], [`Rp${NBSP}750.000`, 750_000],
  ['9007199254740991', Number.MAX_SAFE_INTEGER],
];

const TIDAK_SAH = [
  '', '   ', 'abc', '25.5', '25,5', '12,34', '-50000', '1,500,000', '12,500', '1.5000', '1..000',
  // spasi DI DALAM angka: "25 5" dahulu menjadi 255 (10× salah), "750 000" menjadi 750000
  '25 5', '7 50', '750 000', '1.500 000', '1. 500.000', `25${NBSP}5`, `7${NBSP}50`, 'Rp 25 5', '2\t5',
  // di atas batas aman: tidak boleh menjadi angka yang tampak sah tetapi dibulatkan
  '9007199254740992', '99999999999999999999',
];

for (const [teks, harapan] of SAH) {
  test(`bacaRupiah(${JSON.stringify(teks)}) = ${harapan}`, async () => {
    const { bacaRupiah } = await import(MOD);
    assert.equal(bacaRupiah(teks), harapan);
  });
}

for (const teks of TIDAK_SAH) {
  test(`⛔ bacaRupiah(${JSON.stringify(teks)}) = null, bukan angka lain`, async () => {
    const { bacaRupiah } = await import(MOD);
    assert.equal(bacaRupiah(teks), null, `"${teks}" dibaca ${bacaRupiah(teks)} — masukan tidak sah lolos sebagai angka`);
  });
}

test('⛔ bacaRupiah tidak pernah mengembalikan angka di luar rentang aman', async () => {
  const { bacaRupiah } = await import(MOD);
  for (const teks of ['9007199254740992', '99999999999999999999', '1.000.000.000.000.000.000']) {
    const n = bacaRupiah(teks);
    assert.ok(n === null || Number.isSafeInteger(n), `"${teks}" → ${n}`);
  }
});

test('rupiahTerlaluBesar: bentuk sah tetapi di atas MAX_SAFE_INTEGER (alasan terpisah dari "tidak sah")', async () => {
  const { rupiahTerlaluBesar } = await import(MOD);
  assert.equal(rupiahTerlaluBesar('99999999999999999999'), true);
  assert.equal(rupiahTerlaluBesar('9007199254740992'), true);
  assert.equal(rupiahTerlaluBesar('9.007.199.254.740.992'), true);
  assert.equal(rupiahTerlaluBesar('9007199254740991'), false);
  assert.equal(rupiahTerlaluBesar('25,5'), false, 'bentuk tidak sah BUKAN terlalu besar');
  assert.equal(rupiahTerlaluBesar('99999999999999999999 5'), false);
  assert.equal(rupiahTerlaluBesar(''), false);
});
