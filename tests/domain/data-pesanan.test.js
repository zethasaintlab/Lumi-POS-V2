'use strict';

// Nama pemesan, nomor meja, catatan pesanan — satu aturan untuk perangkat dan
// server (Task 11, PR 2C; P5(b) + P6(a), keputusan user 28 September 2026).
// Batas kolom (40/16/140) juga CHECK di migrasi 0037; test server membuktikan
// keduanya sepakat.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../packages/domain/src/data-pesanan.ts';

const KASUS = [
  { fungsi: 'periksaNamaPemesan', maks: 40, konstanta: 'MAKS_NAMA_PEMESAN', label: 'Nama pemesan' },
  { fungsi: 'periksaNomorMeja', maks: 16, konstanta: 'MAKS_NOMOR_MEJA', label: 'Nomor meja' },
  { fungsi: 'periksaCatatan', maks: 140, konstanta: 'MAKS_CATATAN', label: 'Catatan' },
];

for (const k of KASUS) {
  test(`${k.fungsi}: batas tepat ${k.maks} lolos, ${k.maks + 1} ditolak VALIDATION_ERROR menyebut batasnya`, async () => {
    const m = await import(MOD);
    assert.equal(m[k.konstanta], k.maks, `${k.konstanta} bukan ${k.maks}`);
    assert.equal(m[k.fungsi]('a'.repeat(k.maks)), null, `${k.maks} karakter ditolak`);
    const g = m[k.fungsi]('a'.repeat(k.maks + 1));
    assert.notEqual(g, null, `${k.maks + 1} karakter lolos`);
    assert.equal(g.kode, 'VALIDATION_ERROR');
    assert.match(g.pesan, new RegExp(`${k.label}.*${k.maks}`), `pesan tidak menyebut batas: ${g.pesan}`);
  });

  test(`${k.fungsi}: kosong, spasi saja, null, undefined → null (bukan galat; field opsional)`, async () => {
    const m = await import(MOD);
    for (const v of ['', '   ', '\t\n', null, undefined]) {
      assert.equal(m[k.fungsi](v), null, `${JSON.stringify(v)} dianggap galat`);
    }
  });

  test(`${k.fungsi}: batas dihitung SESUDAH trim dan per code point (sama dengan length() PostgreSQL)`, async () => {
    const m = await import(MOD);
    assert.equal(m[k.fungsi](`  ${'a'.repeat(k.maks)}  `), null, 'spasi tepi ikut dihitung');
    // Satu code point di luar BMP = 2 unit UTF-16, 1 karakter bagi PostgreSQL.
    assert.equal(m[k.fungsi]('😀'.repeat(k.maks)), null, 'dihitung per unit UTF-16, bukan code point');
    assert.notEqual(m[k.fungsi]('😀'.repeat(k.maks + 1)), null);
  });

  test(`${k.fungsi}: bukan string (angka, objek) ditolak VALIDATION_ERROR`, async () => {
    const m = await import(MOD);
    for (const v of [42, true, {}, []]) {
      const g = m[k.fungsi](v);
      assert.notEqual(g, null, `${JSON.stringify(v)} lolos`);
      assert.equal(g.kode, 'VALIDATION_ERROR');
    }
  });

  test(`⛔ ${k.fungsi}: nomor kartu → POSSIBLE_CARD_NUMBER, termasuk berpemisah`, async () => {
    const m = await import(MOD);
    for (const v of ['4111111111111111', '4111 1111 1111 1111', '4111-1111-1111-1111', 'meja 4111111111111111']) {
      if (v.length > k.maks) continue;
      const g = m[k.fungsi](v);
      assert.notEqual(g, null, `"${v}" lolos sebagai ${k.label}`);
      assert.equal(g.kode, 'POSSIBLE_CARD_NUMBER', `"${v}" → ${g.kode}`);
    }
    assert.equal(m[k.fungsi]('12 digit 123456789012'.slice(0, k.maks)), null, '12 digit (bukan PAN) ditolak padahal sah');
  });
}

test('bersihkanTeksPesanan: trim, kosong → null', async () => {
  const { bersihkanTeksPesanan } = await import(MOD);
  assert.equal(bersihkanTeksPesanan('  Budi '), 'Budi');
  assert.equal(bersihkanTeksPesanan('   '), null);
  assert.equal(bersihkanTeksPesanan(null), null);
  assert.equal(bersihkanTeksPesanan(undefined), null);
});
