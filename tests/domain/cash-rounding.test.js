'use strict';

// T13 (docs/superpowers/plans/PLAN-pembayaran-pajak.md) -- pembulatan tunai,
// FR-C9.
//
// Yang dibulatkan adalah JUMLAH YANG DIBAYAR TUNAI, bukan nilai transaksi dan
// bukan dasar pengenaan pajak (spec-c:162). Karena itu ia mustahil dihitung
// saat order dibuat: pembulatan bergantung pada metode pembayaran, dan order
// baru belum punya pembayaran apa pun.
//
// Pembayaran campuran membulatkan SISA YANG DIBAYAR TUNAI, bukan total
// (spec-c:181). Contoh spec: total 93.555, QRIS 50.000, sisa tunai 43.555 ->
// 43.600, rounding_adjustment +45.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../packages/domain/src/money.ts';

test('half_up: 93.555 ke kelipatan 100 menjadi 93.600, selisih +45', async () => {
  const { computeCashRounding } = await import(MOD);
  const r = computeCashRounding({ outstanding: 93555n, roundingIncrement: 100n, roundingMode: 'half_up' });
  assert.equal(r.roundedOutstanding, 93600n);
  assert.equal(r.roundingAdjustment, 45n);
});

test('half_up: membulatkan ke bawah menghasilkan selisih negatif', async () => {
  const { computeCashRounding } = await import(MOD);
  const r = computeCashRounding({ outstanding: 64120n, roundingIncrement: 100n, roundingMode: 'half_up' });
  assert.equal(r.roundedOutstanding, 64100n);
  assert.equal(r.roundingAdjustment, -20n);
});

test('half_up: tepat setengah dibulatkan NAIK', async () => {
  const { computeCashRounding } = await import(MOD);
  const r = computeCashRounding({ outstanding: 64150n, roundingIncrement: 100n, roundingMode: 'half_up' });
  assert.equal(r.roundedOutstanding, 64200n);
});

// outlet.rounding_mode punya tiga nilai di skema (0002_tenancy.sql).
// `up` dan `down` bukan hiasan: merchant yang selalu membulatkan ke bawah
// memilih kehilangan rupiah demi tidak pernah menagih lebih.
test('mode up: selalu membulatkan naik, sekecil apa pun sisanya', async () => {
  const { computeCashRounding } = await import(MOD);
  const r = computeCashRounding({ outstanding: 64101n, roundingIncrement: 100n, roundingMode: 'up' });
  assert.equal(r.roundedOutstanding, 64200n);
  assert.equal(r.roundingAdjustment, 99n);
});

test('mode down: selalu membulatkan turun, sebesar apa pun sisanya', async () => {
  const { computeCashRounding } = await import(MOD);
  const r = computeCashRounding({ outstanding: 64199n, roundingIncrement: 100n, roundingMode: 'down' });
  assert.equal(r.roundedOutstanding, 64100n);
  assert.equal(r.roundingAdjustment, -99n);
});

test('nilai yang sudah kelipatan tidak berubah, apa pun modenya', async () => {
  const { computeCashRounding } = await import(MOD);
  for (const roundingMode of ['half_up', 'up', 'down']) {
    const r = computeCashRounding({ outstanding: 64200n, roundingIncrement: 100n, roundingMode });
    assert.equal(r.roundedOutstanding, 64200n, `mode ${roundingMode}`);
    assert.equal(r.roundingAdjustment, 0n, `mode ${roundingMode}`);
  }
});

test('roundingIncrement 1 berarti tanpa pembulatan', async () => {
  const { computeCashRounding } = await import(MOD);
  const r = computeCashRounding({ outstanding: 93555n, roundingIncrement: 1n, roundingMode: 'half_up' });
  assert.equal(r.roundedOutstanding, 93555n);
  assert.equal(r.roundingAdjustment, 0n);
});

// Pembayaran campuran: yang dibulatkan adalah SISA tunai, bukan total.
// Contoh spec-c:181 dijadikan test langsung.
test('spec-c:181 -- campuran: total 93.555, QRIS 50.000, sisa tunai dibulatkan', async () => {
  const { computeCashRounding } = await import(MOD);
  const total = 93555n;
  const sudahDibayar = 50000n; // QRIS
  const sisa = total - sudahDibayar; // 43.555
  const r = computeCashRounding({ outstanding: sisa, roundingIncrement: 100n, roundingMode: 'half_up' });
  assert.equal(r.roundedOutstanding, 43600n);
  assert.equal(r.roundingAdjustment, 45n);
});

test('sisa nol tidak menghasilkan pembulatan', async () => {
  const { computeCashRounding } = await import(MOD);
  const r = computeCashRounding({ outstanding: 0n, roundingIncrement: 100n, roundingMode: 'half_up' });
  assert.equal(r.roundedOutstanding, 0n);
  assert.equal(r.roundingAdjustment, 0n);
});

test('nilai number (bukan bigint) ditolak', async () => {
  const { computeCashRounding } = await import(MOD);
  assert.throws(
    () => computeCashRounding({ outstanding: 93555, roundingIncrement: 100n, roundingMode: 'half_up' }),
    /bigint/i
  );
});

test('mode tidak dikenal ditolak, bukan diam-diam jatuh ke half_up', async () => {
  const { computeCashRounding } = await import(MOD);
  assert.throws(
    () => computeCashRounding({ outstanding: 93555n, roundingIncrement: 100n, roundingMode: 'nearest' }),
    /rounding_?mode|mode/i
  );
});

// Invariant yang membuat laporan kas bisa dijelaskan: sisa yang dibulatkan
// selalu sama dengan sisa asli ditambah selisihnya, dan hasilnya selalu
// kelipatan increment. Kalau ini pernah gagal, ada rupiah yang tidak bisa
// ditelusuri ke mana pun.
test('property: roundedOutstanding == outstanding + roundingAdjustment, dan selalu kelipatan', async () => {
  const { computeCashRounding } = await import(MOD);
  let diperiksa = 0;
  for (const outstanding of [0n, 1n, 49n, 50n, 51n, 99n, 100n, 93555n, 64120n, 1_000_000n]) {
    for (const roundingIncrement of [1n, 5n, 50n, 100n, 1000n]) {
      for (const roundingMode of ['half_up', 'up', 'down']) {
        const r = computeCashRounding({ outstanding, roundingIncrement, roundingMode });
        assert.equal(
          r.roundedOutstanding,
          outstanding + r.roundingAdjustment,
          `tidak berimbang: ${outstanding}/${roundingIncrement}/${roundingMode}`
        );
        assert.equal(r.roundedOutstanding % roundingIncrement, 0n, 'harus kelipatan increment');
        assert.ok(r.roundedOutstanding >= 0n, 'tidak pernah negatif');
        diperiksa += 1;
      }
    }
  }
  assert.equal(diperiksa, 150);
});
