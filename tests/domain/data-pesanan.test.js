'use strict';

// Nama pemesan, nomor meja, catatan pesanan (sub-proyek 2 Kasir, PR 2C Task 11;
// keputusan user P5(b) dan P6(a)). Dibagi perangkat dan server: satu aturan,
// bukan dua salinan yang menyimpang.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../packages/domain/src/data-pesanan.ts';

const KASUS = [
  ['periksaNamaPemesan', 'MAKS_NAMA_PEMESAN', 40],
  ['periksaNomorMeja', 'MAKS_NOMOR_MEJA', 16],
  ['periksaCatatan', 'MAKS_CATATAN', 140],
];

for (const [fn, konstanta, batas] of KASUS) {
  test(`${fn}: batas tepat ${batas} lolos, ${batas + 1} ditolak VALIDATION_ERROR berpesan batasnya`, async () => {
    const m = await import(MOD);
    assert.equal(m[konstanta], batas, `${konstanta} bukan ${batas}`);
    assert.equal(m[fn]('a'.repeat(batas)), null, `${batas} karakter ditolak`);
    const g = m[fn]('a'.repeat(batas + 1));
    assert.notEqual(g, null, `${batas + 1} karakter lolos — kolom CHECK database akan menolak dengan 500`);
    assert.equal(g.kode, 'VALIDATION_ERROR');
    assert.ok(g.pesan.includes(String(batas)), `pesan tidak menyebut batas ${batas}: ${g.pesan}`);
  });

  test(`${fn}: kosong dan spasi saja → null, bukan galat; bukan string → VALIDATION_ERROR`, async () => {
    const m = await import(MOD);
    for (const kosong of [undefined, null, '', '   ', '\t\n']) {
      assert.equal(m[fn](kosong), null, `${JSON.stringify(kosong)} dianggap galat — field opsional`);
    }
    for (const bukan of [42, {}, [], true]) {
      assert.equal(m[fn](bukan)?.kode, 'VALIDATION_ERROR', `${JSON.stringify(bukan)} lolos`);
    }
  });

  test(`${fn}: batas dihitung SESUDAH trim`, async () => {
    const m = await import(MOD);
    assert.equal(m[fn](`  ${'a'.repeat(batas)}  `), null, 'spasi pinggir ikut dihitung');
  });

  test(`⛔ ${fn}: nomor kartu → POSSIBLE_CARD_NUMBER, termasuk berpemisah`, async () => {
    const m = await import(MOD);
    for (const pan of ['4111111111111111', '4111 1111 1111 1111', '4111-1111-1111-1111']) {
      const g = m[fn](pan);
      assert.equal(g?.kode, 'POSSIBLE_CARD_NUMBER', `${pan} lolos ke ${fn}`);
    }
  });
}

test('nomor meja sah: "4", "A3", "12 B" lolos; nomor telepon 12 digit juga lolos (Q7: tidak ada pola telepon)', async () => {
  const { periksaNomorMeja, periksaNamaPemesan } = await import(MOD);
  for (const v of ['4', 'A3', '12 B']) assert.equal(periksaNomorMeja(v), null);
  assert.equal(periksaNamaPemesan('081234567890'), null, 'pola telepon ditolak — Q7 memutuskan label, bukan pola');
});

test('normalkanTeksPesanan: trim; kosong → null', async () => {
  const { normalkanTeksPesanan } = await import(MOD);
  assert.equal(normalkanTeksPesanan('  Budi  '), 'Budi');
  assert.equal(normalkanTeksPesanan('   '), null);
  assert.equal(normalkanTeksPesanan(undefined), null);
  assert.equal(normalkanTeksPesanan(null), null);
});
