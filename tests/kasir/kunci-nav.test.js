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

test('⛔ kunci nav: `navigasi()` — pintu SEMUA jalan keluar (tab, indikator, pita, lonceng, menu) — tidak menavigasi saat terkunci, berfungsi lagi sesudah dibuka', async () => {
  // Fix round 1 Task 8: kunci yang hanya menutup tab nav meninggalkan indikator
  // sinkron, pita antrean, panel pemberitahuan, dan menu pengguna sebagai jalan keluar.
  const dorongan = [];
  const awal = globalThis.window;
  globalThis.window = {
    location: { pathname: '/' },
    history: { pushState: (_s, _t, j) => { dorongan.push(j); globalThis.window.location.pathname = j; } },
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  try {
    const { setelKunciNav } = await import(MOD);
    const { navigasi } = await import('../../apps/kasir/src/rute/navigasi.ts');
    setelKunciNav('QRIS menunggu');
    navigasi('/sync');
    navigasi('/perangkat');
    assert.deepEqual(dorongan, [], `navigasi() menembus kunci: ${JSON.stringify(dorongan)}`);
    setelKunciNav(null);
    navigasi('/sync');
    assert.deepEqual(dorongan, ['/sync'], 'navigasi() tetap tertutup sesudah kunci dilepas');
  } finally {
    setelKunciNav_reset();
    if (awal === undefined) delete globalThis.window;
    else globalThis.window = awal;
  }
  async function setelKunciNav_reset() {
    (await import(MOD)).setelKunciNav(null);
  }
});
