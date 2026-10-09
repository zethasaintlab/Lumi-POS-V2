'use strict';

// Task 10 — kanal pesanan (FR-C7). `kanalPesanan` satu-satunya pembaca kanal keranjang:
// K-03, K-06, jalur tulis, dan QRIS dinamis semuanya lewat sini.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../apps/kasir/src/kasir/kanal.ts';

test('⛔ kanalPesanan: kanal dikenal dipakai; keranjang lama tanpa kanal dan nilai tak dikenal → takeaway', async () => {
  const { kanalPesanan } = await import(MOD);
  assert.equal(kanalPesanan({ kanal: 'dine_in' }), 'dine_in');
  assert.equal(kanalPesanan({ kanal: 'takeaway' }), 'takeaway');
  assert.equal(kanalPesanan({}), 'takeaway', 'keranjang tanpa kanal harus takeaway');
  assert.equal(kanalPesanan({ kanal: 'xyz' }), 'takeaway', 'kanal tak dikenal harus takeaway, bukan dipercaya');
});

test('ringkasKanal: tanpa tarif → daftar kosong dan sama; tarif berbeda → sama false; urutan Takeaway lalu Dine in', async () => {
  const { ringkasKanal } = await import(MOD);
  const h = (...nama) => ({ pajak: { lines: nama.map((name) => ({ name })) } });
  const kosong = ringkasKanal({ takeaway: h(), dine_in: h() });
  assert.deepEqual(kosong.map((r) => r.kanal), ['takeaway', 'dine_in']);
  assert.deepEqual(kosong.map((r) => r.namaTarif), [[], []]);
  assert.equal(kosong[0].sama, true);
  const beda = ringkasKanal({ takeaway: h('PPN 11%'), dine_in: h('PBJT 10%') });
  assert.equal(beda[0].sama, false);
  assert.deepEqual(beda.map((r) => r.namaTarif), [['PPN 11%'], ['PBJT 10%']]);
});
