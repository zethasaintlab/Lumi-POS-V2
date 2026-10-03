'use strict';

// Data pesanan: nama pemesan, nomor meja, catatan (sub-proyek 2 Kasir, Task 11;
// keputusan user P5(b) dan P6(a), 28 September 2026). Aturan dibagi perangkat
// dan server: batas panjang, kosong = null, dan nomor kartu ditolak (FR-C5).

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../packages/domain/src/data-pesanan.ts';

const KASUS = [
  { fn: 'periksaNamaPemesan', maks: 'MAKS_NAMA_PEMESAN', batas: 40, label: 'Nama pemesan' },
  { fn: 'periksaNomorMeja', maks: 'MAKS_NOMOR_MEJA', batas: 16, label: 'Nomor meja' },
  { fn: 'periksaCatatan', maks: 'MAKS_CATATAN', batas: 140, label: 'Catatan' },
];

for (const k of KASUS) {
  test(`batas ${k.fn}: ${k.batas} lolos, ${k.batas + 1} ditolak dengan pesan batasnya`, async () => {
    const m = await import(MOD);
    assert.equal(m[k.maks], k.batas, `${k.maks} bukan ${k.batas}`);
    assert.equal(m[k.fn]('a'.repeat(k.batas)), null);
    const g = m[k.fn]('a'.repeat(k.batas + 1));
    assert.notEqual(g, null, `${k.batas + 1} karakter lolos`);
    assert.equal(g.kode, 'VALIDATION_ERROR');
    assert.match(g.pesan, new RegExp(`${k.label}.*${k.batas}`));
  });

  test(`kosong dan spasi saja → null, bukan galat (${k.fn})`, async () => {
    const m = await import(MOD);
    for (const v of [undefined, null, '', '   ', '\t\n']) {
      assert.equal(m[k.fn](v), null, `${JSON.stringify(v)} dianggap galat`);
    }
  });

  test(`batas dihitung SESUDAH trim (${k.fn})`, async () => {
    const m = await import(MOD);
    assert.equal(m[k.fn](`  ${'a'.repeat(k.batas)}  `), null);
  });

  test(`⛔ nomor kartu di ${k.fn} → POSSIBLE_CARD_NUMBER, termasuk berpemisah`, async () => {
    const m = await import(MOD);
    for (const v of ['4111111111111111', '4111 1111 1111 1111', '4111-1111-1111-1111']) {
      const g = m[k.fn](v);
      assert.notEqual(g, null, `${v} lolos`);
      assert.equal(g.kode, 'POSSIBLE_CARD_NUMBER');
    }
  });

  test(`bukan string → VALIDATION_ERROR (${k.fn})`, async () => {
    const m = await import(MOD);
    const g = m[k.fn](42);
    assert.notEqual(g, null);
    assert.equal(g.kode, 'VALIDATION_ERROR');
  });
}

test('rapikan: trim, kosong → null', async () => {
  const { rapikanDataPesanan } = await import(MOD);
  assert.equal(rapikanDataPesanan('  Budi '), 'Budi');
  assert.equal(rapikanDataPesanan('   '), null);
  assert.equal(rapikanDataPesanan(null), null);
  assert.equal(rapikanDataPesanan(undefined), null);
});

test('Q7: tidak ada penolakan pola telepon (nama berisi angka pendek sah)', async () => {
  const { periksaNamaPemesan } = await import(MOD);
  assert.equal(periksaNamaPemesan('Budi 0812'), null);
});

// Fix round Task 11 (M-6): karakter kendali merusak struk ESC/POS dan kolom teks.
for (const k of KASUS) {
  test(`⛔ karakter kendali ditolak VALIDATION_ERROR (${k.fn}), termasuk di tengah teks`, async () => {
    const m = await import(MOD);
    for (const v of ['Bu\x00di', 'Bu\x1bdi', 'Budi\x7f', 'a\nb', 'a\tb', 'a\rb', '\x07x']) {
      const g = m[k.fn](v);
      assert.notEqual(g, null, `${JSON.stringify(v)} lolos`);
      assert.equal(g.kode, 'VALIDATION_ERROR');
      assert.match(g.pesan, /karakter kendali/);
    }
    // Spasi di ujung dibuang trim, bukan dianggap karakter kendali; spasi biasa di tengah sah.
    assert.equal(m[k.fn]('  a b  '), null);
    assert.equal(m[k.fn]('Café ñ'), null);
  });
}
