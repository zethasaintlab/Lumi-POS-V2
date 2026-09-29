'use strict';

// Task 5C — jejak audit penurunan qty / penghapusan baris keranjang
// (`cart_line_reduced`). Keputusan user 28 September 2026 (issue #76, Q2):
// kalau Batalkan tercatat tapi menghapus baris satu per satu tidak, kecurangan
// hanya pindah cara.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../packages/domain/src/keranjang-baris.ts';
const AUDIT = '../../packages/domain/src/audit-peristiwa.ts';

const dasar = (sebelum, sesudah, satuan = 25000n) => ({
  variationId: 'v1',
  itemName: 'Kopi Susu',
  variationName: 'Regular',
  quantityBeforeMilli: sebelum,
  quantityAfterMilli: sesudah,
  unitPrice: satuan,
});

test('EVENT_BARIS_DIKURANGI adalah cart_line_reduced, terdaftar di kelompok transaksi', async () => {
  const { EVENT_BARIS_DIKURANGI } = await import(MOD);
  const { adalahPeristiwaAudit, kelompokPeristiwa, PERISTIWA_BELUM_DIPANCARKAN } = await import(AUDIT);
  assert.equal(EVENT_BARIS_DIKURANGI, 'cart_line_reduced');
  assert.equal(adalahPeristiwaAudit('cart_line_reduced'), true, 'cart_line_reduced tidak terdaftar');
  assert.equal(kelompokPeristiwa('cart_line_reduced'), 'transaksi');
  assert.equal(PERISTIWA_BELUM_DIPANCARKAN.includes('cart_line_reduced'), false);
});

test('⛔ PROPERTY: jejak ada ⇔ sesudah < sebelum, dan nilai = satuan × (sebelum − sesudah) / 1000 dalam bigint', async () => {
  const { ringkasPenguranganBaris } = await import(MOD);
  const SEBELUM = [1000, 2000, 5000, 1500];
  const SESUDAH = [0, 500, 1000, 1500, 2000, 5000, 7000];
  for (const sebelum of SEBELUM) {
    for (const sesudah of SESUDAH) {
      const r = ringkasPenguranganBaris(dasar(sebelum, sesudah));
      if (sesudah < sebelum) {
        assert.notEqual(r, null, `sebelum ${sebelum} sesudah ${sesudah}: turun tetapi tidak ada jejak`);
        assert.equal(r.quantity_before_milli, sebelum);
        assert.equal(r.quantity_after_milli, sesudah);
        assert.equal(
          r.reduced_value,
          ((25000n * BigInt(sebelum - sesudah)) / 1000n).toString(),
          `nilai berkurang salah untuk ${sebelum} → ${sesudah}`
        );
        assert.equal(typeof r.reduced_value, 'string');
        assert.equal(r.unit_price, '25000');
      } else {
        assert.equal(r, null, `sebelum ${sebelum} sesudah ${sesudah}: tidak turun tetapi ada jejak`);
      }
    }
  }
});

test('⛔ uang di atas 2^53 tetap tepat (bigint → string): satuan 2^53+1 tidak terwakili sebagai number', async () => {
  const { ringkasPenguranganBaris } = await import(MOD);
  const r = ringkasPenguranganBaris(dasar(3000, 1000, 9007199254740993n));
  // (2^53 + 1) × 2000 / 1000 = 2^54 + 2. Lewat `Number` satuannya sudah 2^53
  // dan hasilnya 2^54 — selisih 2 yang tidak menghasilkan error apa pun.
  assert.equal(r.unit_price, '9007199254740993');
  assert.equal(r.reduced_value, '18014398509481986');
  assert.equal(JSON.parse(JSON.stringify(r)).reduced_value, '18014398509481986');
});

test('identitas item ikut: variation id + nama item + nama variasi', async () => {
  const { ringkasPenguranganBaris } = await import(MOD);
  const r = ringkasPenguranganBaris(dasar(2000, 0));
  assert.equal(r.variation_id, 'v1');
  assert.equal(r.item_name, 'Kopi Susu');
  assert.equal(r.variation_name, 'Regular');
});

test('masukan tak sah dilempar, bukan diam: sebelum < 1, sesudah negatif, bukan bilangan bulat', async () => {
  const { ringkasPenguranganBaris } = await import(MOD);
  for (const [b, s] of [[0, 0], [-1000, 0], [2000, -1], [2000.5, 0], [2000, 0.5], [NaN, 0]]) {
    assert.throws(() => ringkasPenguranganBaris(dasar(b, s)), RangeError, `${b} → ${s} lolos`);
  }
  assert.throws(() => ringkasPenguranganBaris(dasar(2000, 0, -1n)), RangeError, 'harga negatif lolos');
});
