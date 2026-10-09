'use strict';

// Nama pemesan, nomor meja, catatan pesanan (sub-proyek 2 Kasir, PR 2C Task 11;
// keputusan user P5 dan P6, 28 September 2026). Dibagi perangkat dan server:
// aturan yang hanya hidup di server berarti kasir menyimpan penjualan lalu
// outbox-nya `gagal-permanen` berjam-jam kemudian.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../packages/domain/src/data-pesanan.ts';

const BIDANG = [
  ['periksaNamaPemesan', 'MAKS_NAMA_PEMESAN', 40],
  ['periksaNomorMeja', 'MAKS_NOMOR_MEJA', 16],
  ['periksaCatatan', 'MAKS_CATATAN', 140],
];

test('batas ditetapkan: 40 / 16 / 140', async () => {
  const m = await import(MOD);
  for (const [, konstanta, batas] of BIDANG) assert.equal(m[konstanta], batas, konstanta);
});

test('batas tepat lolos, batas+1 ditolak VALIDATION_ERROR yang menyebut batasnya', async () => {
  const m = await import(MOD);
  for (const [fn, , batas] of BIDANG) {
    assert.equal(m[fn]('a'.repeat(batas)), null, `${fn} ${batas}`);
    const g = m[fn]('a'.repeat(batas + 1));
    assert.ok(g, `${fn} ${batas + 1} harus ditolak`);
    assert.equal(g.kode, 'VALIDATION_ERROR');
    assert.match(g.pesan, new RegExp(String(batas)), `pesan ${fn} menyebut batas ${batas}`);
  }
});

test('panjang dihitung SESUDAH trim', async () => {
  const m = await import(MOD);
  for (const [fn, , batas] of BIDANG) {
    assert.equal(m[fn](`  ${'a'.repeat(batas)}  `), null, fn);
  }
});

test('⛔ nomor kartu di nama/meja/catatan → POSSIBLE_CARD_NUMBER, termasuk berpemisah', async () => {
  const m = await import(MOD);
  for (const [fn] of BIDANG) {
    for (const v of ['4111111111111111', '4111 1111 1111 1111', '4111-1111-1111-1111', 'a 4111 1111 1111 1111']) {
      const g = m[fn](v);
      assert.ok(g, `${fn} harus menolak ${v}`);
      assert.equal(g.kode, 'POSSIBLE_CARD_NUMBER', `${fn} ${v}`);
    }
    assert.equal(m[fn]('123456789012'), null, `${fn}: 12 digit sah`);
  }
});

test('kosong dan spasi saja → null, bukan galat', async () => {
  const m = await import(MOD);
  for (const [fn] of BIDANG) {
    for (const v of [undefined, null, '', '   ']) assert.equal(m[fn](v), null, `${fn} ${JSON.stringify(v)}`);
  }
});

test('bukan string (angka, objek) → VALIDATION_ERROR', async () => {
  const m = await import(MOD);
  for (const [fn] of BIDANG) {
    for (const v of [42, {}, ['a'], true]) {
      const g = m[fn](v);
      assert.ok(g, `${fn} ${JSON.stringify(v)}`);
      assert.equal(g.kode, 'VALIDATION_ERROR');
    }
  }
});
