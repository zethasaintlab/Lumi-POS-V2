'use strict';

// Kunci tab nav (Task 8, spec § 7 "Wadah"): modul murni yang dibaca `ShellKasir`
// dan ditulis `Pembayaran`. Pola `kasir/simpanan.ts`.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../apps/kasir/src/rute/kunci-nav.ts';

test('⛔ kunci nav: bawaan TIDAK terkunci, alasan tersimpan, null melepas', async () => {
  const { setelKunciNav, kunciNavSekarang } = await import(MOD);
  assert.equal(kunciNavSekarang(), null, 'bawaan harus tidak terkunci');
  setelKunciNav('QRIS menunggu');
  assert.equal(kunciNavSekarang(), 'QRIS menunggu');
  setelKunciNav(null);
  assert.equal(kunciNavSekarang(), null, 'null tidak melepas kunci');
});

test('⛔ kunci nav: pelanggan diberi tahu, berhenti setelah berhenti berlangganan, dan satu yang melempar tidak menghalangi sisanya', async () => {
  const { setelKunciNav, langgananKunciNav } = await import(MOD);
  let a = 0;
  let b = 0;
  const lepasA = langgananKunciNav(() => {
    a += 1;
    throw new Error('pelanggan rusak');
  });
  const lepasB = langgananKunciNav(() => {
    b += 1;
  });
  setelKunciNav('x');
  assert.deepEqual([a, b], [1, 1], 'pelanggan yang melempar menghalangi pelanggan lain');
  setelKunciNav('x');
  assert.deepEqual([a, b], [1, 1], 'nilai sama dipancarkan ulang');
  lepasA();
  setelKunciNav(null);
  assert.deepEqual([a, b], [1, 2], 'berhenti berlangganan tidak berlaku');
  lepasB();
  setelKunciNav('y');
  assert.deepEqual([a, b], [1, 2]);
  setelKunciNav(null);
});
