'use strict';

// Task 5B — jejak audit pembatalan keranjang (`cart_cleared`).
// Keputusan user 28 September 2026 (issue #76): pembatalan keranjang sesudah
// barang di-scan adalah pola kecurangan kasir. Ringkasannya murni, dan
// `total` berupa STRING supaya presisi di atas 2^53 tidak hilang lewat JSON.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../packages/domain/src/keranjang-batal.ts';
const AUDIT = '../../packages/domain/src/audit-peristiwa.ts';

test('ringkasKeranjangBatal: jumlah baris, quantity_milli dijumlah, total string', async () => {
  const { ringkasKeranjangBatal } = await import(MOD);
  const r = ringkasKeranjangBatal(
    { baris: [{ quantityMilli: 2000 }, { quantityMilli: 500 }, { quantityMilli: 1000 }] },
    55000n
  );
  assert.deepEqual(r, { line_count: 3, quantity_milli: 3500, total: '55000' });
});

test('⛔ total di atas 2^53 tetap tepat (string, bukan number)', async () => {
  const { ringkasKeranjangBatal } = await import(MOD);
  const besar = 9007199254740993n; // 2^53 + 1, tidak terwakili sebagai number
  const r = ringkasKeranjangBatal({ baris: [{ quantityMilli: 1000 }] }, besar);
  assert.equal(typeof r.total, 'string');
  assert.equal(r.total, '9007199254740993');
  assert.equal(JSON.parse(JSON.stringify(r)).total, '9007199254740993');
});

test('EVENT_KERANJANG_DIBATALKAN adalah cart_cleared', async () => {
  const { EVENT_KERANJANG_DIBATALKAN } = await import(MOD);
  assert.equal(EVENT_KERANJANG_DIBATALKAN, 'cart_cleared');
});

test('cart_cleared terdaftar di PERISTIWA_AUDIT, kelompok transaksi', async () => {
  const { kelompokPeristiwa, adalahPeristiwaAudit, PERISTIWA_BELUM_DIPANCARKAN } = await import(AUDIT);
  assert.equal(adalahPeristiwaAudit('cart_cleared'), true, 'cart_cleared tidak terdaftar');
  assert.equal(kelompokPeristiwa('cart_cleared'), 'transaksi');
  // Tidak ada di daftar spec-f:288, jadi tidak boleh mengubah selisih spec.
  assert.equal(PERISTIWA_BELUM_DIPANCARKAN.includes('cart_cleared'), false);
});
