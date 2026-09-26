'use strict';

// `potongSentuh` (`packages/ds/sentuh.ts`) — pemotongan area sentuh tak
// terlihat per sisi, dari CELAH SEBENARNYA antara dua elemen bertetangga.
//
// Fix round 1, Task 5 (kampanye "Hidupkan desain"): versi pertama menghitung
// nilai TETAP (`calc(var(--space-1) * -1)`, separuh gap 8px yang dipaku) dan
// hidup hanya di `Fondasi.tsx`. Sub-proyek 2 butuh mekanisme yang GAP-DRIVEN
// dan dapat dipakai ulang di layar kasir sungguhan — dipindah ke `packages/ds`,
// menerima `celah` sebagai parameter eksplisit.
//
// Test ini murni (tidak menyentuh DOM/browser) — pelengkap
// `tests/kasir-dom/area-sentuh.test.js`, yang membuktikan efeknya di
// peramban sungguhan lewat `elementFromPoint`.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../packages/ds/sentuh.ts';

test('potongSentuh: nilainya SETENGAH celah yang diberikan, bukan konstanta', async () => {
  const { potongSentuh } = await import(MOD);

  assert.deepEqual(potongSentuh(['kanan'], 'var(--space-2)'), {
    '--sentuh-kanan': 'calc(var(--space-2) / -2)',
  });
  assert.deepEqual(potongSentuh(['kiri'], 'var(--space-2)'), {
    '--sentuh-kiri': 'calc(var(--space-2) / -2)',
  });
});

test('potongSentuh: gap BERBEDA menghasilkan ekspresi calc BERBEDA — gap-driven, bukan dipaku', async () => {
  const { potongSentuh } = await import(MOD);

  const gap8 = potongSentuh(['kanan'], 'var(--space-2)');
  const gap12 = potongSentuh(['kanan'], 'var(--space-3)');

  assert.notDeepEqual(
    gap8,
    gap12,
    'dua gap token berbeda menghasilkan objek identik — mekanismenya mengabaikan `celah`'
  );
  assert.equal(gap8['--sentuh-kanan'], 'calc(var(--space-2) / -2)');
  assert.equal(gap12['--sentuh-kanan'], 'calc(var(--space-3) / -2)');
});

test('potongSentuh: memotong SATU sisi tidak menyentuh sisi lain', async () => {
  const { potongSentuh } = await import(MOD);

  const satuSisi = potongSentuh(['kanan'], 'var(--space-2)');
  assert.deepEqual(Object.keys(satuSisi), ['--sentuh-kanan']);
  assert.equal(satuSisi['--sentuh-atas'], undefined);
  assert.equal(satuSisi['--sentuh-bawah'], undefined);
  assert.equal(satuSisi['--sentuh-kiri'], undefined);
});

test('potongSentuh: memotong DUA sisi menghasilkan dua custom property, sama-sama dari celah yang sama', async () => {
  const { potongSentuh } = await import(MOD);

  const duaSisi = potongSentuh(['kiri', 'kanan'], 'var(--space-3)');
  assert.deepEqual(duaSisi, {
    '--sentuh-kiri': 'calc(var(--space-3) / -2)',
    '--sentuh-kanan': 'calc(var(--space-3) / -2)',
  });
});

test('potongSentuh: sisi kosong mengembalikan objek kosong — bawaan simetris `lumi.css` tidak tersentuh', async () => {
  const { potongSentuh } = await import(MOD);
  assert.deepEqual(potongSentuh([], 'var(--space-2)'), {});
});

test('potongSentuh: keempat nama sisi valid dan tidak saling bertukar', async () => {
  const { potongSentuh } = await import(MOD);
  const semua = potongSentuh(['atas', 'kanan', 'bawah', 'kiri'], 'var(--space-4)');
  assert.deepEqual(semua, {
    '--sentuh-atas': 'calc(var(--space-4) / -2)',
    '--sentuh-kanan': 'calc(var(--space-4) / -2)',
    '--sentuh-bawah': 'calc(var(--space-4) / -2)',
    '--sentuh-kiri': 'calc(var(--space-4) / -2)',
  });
});
