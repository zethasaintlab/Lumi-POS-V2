'use strict';

// Task 10 fix round 2 (D16/D20) -- ringkasan lembar Pajak: dua tarif per kanal digabung " + ",
// kanal tanpa tarif disebut "tanpa pajak", dan `sama` hanya bila daftar nama identik.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../apps/kasir/src/kasir/kanal.ts';
const hitungan = (...nama) => ({ pajak: { lines: nama.map((name) => ({ name })) } });

test('⛔ sebutTarif: dua tarif sekanal digabung " + ", satu apa adanya, nol -> "tanpa pajak"', async () => {
  const { sebutTarif } = await import(MOD);
  assert.equal(sebutTarif(['PBJT 10%', 'Layanan Daerah 5%']), 'PBJT 10% + Layanan Daerah 5%');
  assert.equal(sebutTarif(['PPN 11%']), 'PPN 11%');
  assert.equal(sebutTarif([]), 'tanpa pajak');
});

test('⛔ ringkasKanal: dua tarif di Dine in, satu di Takeaway -> nama per kanal, sama=false; urutan takeaway lalu dine_in', async () => {
  const { ringkasKanal } = await import(MOD);
  const r = ringkasKanal({ dine_in: hitungan('PBJT 10%', 'Retribusi'), takeaway: hitungan('PPN 11%') });
  assert.deepEqual(r.map((x) => x.kanal), ['takeaway', 'dine_in']);
  assert.deepEqual(r[0].namaTarif, ['PPN 11%']);
  assert.deepEqual(r[1].namaTarif, ['PBJT 10%', 'Retribusi']);
  assert.ok(r.every((x) => x.sama === false));
  const sama = ringkasKanal({ dine_in: hitungan('PPN 11%'), takeaway: hitungan('PPN 11%') });
  assert.ok(sama.every((x) => x.sama === true));
});
