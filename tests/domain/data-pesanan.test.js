'use strict';

// Pelanggan, No. Meja, Catatan pesanan (sub-proyek 2 Kasir, PR 2C Task 11;
// keputusan user P5(b) dan P6(a), 28 September 2026). Aturan ini dibagi
// perangkat dan server: yang hanya hidup di server menjadi penjualan
// `gagal-permanen` berjam-jam kemudian.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../packages/domain/src/data-pesanan.ts';

const BATAS = [
  ['periksaNamaPemesan', 'MAKS_NAMA_PEMESAN', 40, 'Nama pemesan'],
  ['periksaNomorMeja', 'MAKS_NOMOR_MEJA', 16, 'Nomor meja'],
  ['periksaCatatan', 'MAKS_CATATAN', 140, 'Catatan'],
];

test('batas ditulis tepat 40 / 16 / 140', async () => {
  const m = await import(MOD);
  assert.equal(m.MAKS_NAMA_PEMESAN, 40);
  assert.equal(m.MAKS_NOMOR_MEJA, 16);
  assert.equal(m.MAKS_CATATAN, 140);
});

for (const [fn, konst, batas, label] of BATAS) {
  test(`${fn}: tepat ${batas} lolos, ${batas + 1} ditolak VALIDATION_ERROR menyebut batasnya`, async () => {
    const m = await import(MOD);
    assert.equal(m[konst], batas);
    assert.equal(m[fn]('a'.repeat(batas)), null, `${batas} karakter ditolak`);
    const g = m[fn]('a'.repeat(batas + 1));
    assert.notEqual(g, null, `${batas + 1} karakter lolos — kolom database menolaknya dengan galat 500`);
    assert.equal(g.kode, 'VALIDATION_ERROR');
    assert.ok(g.pesan.includes(String(batas)), `pesan tidak menyebut batas ${batas}: ${g.pesan}`);
    assert.ok(g.pesan.startsWith(label), `pesan tidak menyebut ${label}: ${g.pesan}`);
  });

  test(`${fn}: batas dihitung SETELAH trim`, async () => {
    const m = await import(MOD);
    assert.equal(m[fn](`  ${'a'.repeat(batas)}  `), null);
  });
}

test('⛔ nomor kartu di nama/meja/catatan → POSSIBLE_CARD_NUMBER, termasuk berpemisah', async () => {
  const m = await import(MOD);
  for (const [fn] of BATAS) {
    for (const kartu of ['4111111111111111', '4111 1111 1111 1111', '4111-1111-1111-1111', 'atas nama 4111111111111111 ya']) {
      const g = m[fn](kartu);
      assert.notEqual(g, null, `${fn}: ${JSON.stringify(kartu)} lolos — nomor kartu masuk POS`);
      assert.equal(g.kode, 'POSSIBLE_CARD_NUMBER', `${fn}: ${JSON.stringify(kartu)} → ${g.kode}`);
    }
  }
});

test('nomor biasa yang BUKAN kartu lolos: meja 12, telepon 12 digit tidak ditandai', async () => {
  const m = await import(MOD);
  assert.equal(m.periksaNomorMeja('12'), null);
  assert.equal(m.periksaNomorMeja('A-07'), null);
  assert.equal(m.periksaCatatan('tanpa gula, es sedikit'), null);
});

test('kosong dan spasi saja → null, bukan galat', async () => {
  const m = await import(MOD);
  for (const [fn] of BATAS) {
    for (const v of [undefined, null, '', '   ', '\t\n']) {
      assert.equal(m[fn](v), null, `${fn}(${JSON.stringify(v)}) bukan null`);
    }
  }
});

test('tipe bukan teks (angka, objek) → VALIDATION_ERROR', async () => {
  const m = await import(MOD);
  for (const [fn] of BATAS) {
    for (const v of [42, {}, [], true]) {
      assert.equal(m[fn](v)?.kode, 'VALIDATION_ERROR', `${fn}(${JSON.stringify(v)})`);
    }
  }
});

test('bersihkan: trim, kosong → null, selain itu teks terpangkas', async () => {
  const m = await import(MOD);
  assert.equal(m.bersihkanTeksPesanan('  Budi '), 'Budi');
  assert.equal(m.bersihkanTeksPesanan('   '), null);
  assert.equal(m.bersihkanTeksPesanan(null), null);
  assert.equal(m.bersihkanTeksPesanan(undefined), null);
});
