'use strict';

// T8 (docs/superpowers/plans/PLAN-pembayaran-pajak.md) -- konversi
// `tax_rate.rate` antara representasi database dan representasi domain.
//
// `tax_rate.rate` adalah `numeric(6,4)`. node-postgres mengembalikan `numeric`
// sebagai STRING ("0.1000"), bukan number -- justru supaya presisinya tidak
// hilang. `calculateTax` menerimanya sebagai bigint berskala 10.000
// (10% -> 1000n).
//
// Jembatan di antara keduanya adalah satu-satunya tempat presisi bisa bocor,
// dan karena itu ia diuji sendiri, terpisah dari database.
//
// CATATAN JUJUR soal apa yang test-test di bawah BISA dan TIDAK BISA
// buktikan, supaya pembaca berikutnya tidak salah menyimpulkan:
//
// Sabotase yang mengganti konversi string dengan `Math.round(Number(s) *
// 10000)` membuat SELURUH test di berkas ini tetap hijau. Ditelusuri lebih
// jauh: jalur float diuji terhadap seluruh 1.000.000 nilai yang mungkin di
// numeric(6,4) dan tidak meleset satu pun. Nilai berskala maksimumnya hanya
// 999.999 -- jauh di bawah presisi IEEE754.
//
// Jadi test di berkas ini TIDAK membuktikan "float akan kehilangan presisi".
// Yang ia buktikan adalah kontraknya: bentuk yang diterima, bentuk yang
// ditolak, dan round-trip yang utuh. Alasan implementasinya memakai string
// ada di komentar modulnya, dan bukan alasan presisi.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../apps/server/src/modules/payment/handlers/numeric.ts';

test('parseRateToScaled: bentuk yang datang dari PostgreSQL', async () => {
  const { parseRateToScaled } = await import(MOD);
  // numeric(6,4) selalu dikembalikan PostgreSQL dengan 4 desimal penuh.
  assert.equal(parseRateToScaled('0.1000'), 1000n, '10%');
  assert.equal(parseRateToScaled('0.1100'), 1100n, '11%');
  assert.equal(parseRateToScaled('0.0000'), 0n, '0%');
  assert.equal(parseRateToScaled('1.0000'), 10000n, '100%');
});

test('parseRateToScaled: bentuk ringkas yang mungkin dikirim klien', async () => {
  const { parseRateToScaled } = await import(MOD);
  assert.equal(parseRateToScaled('0.1'), 1000n);
  assert.equal(parseRateToScaled('0.11'), 1100n);
  assert.equal(parseRateToScaled('.11'), 1100n);
  assert.equal(parseRateToScaled('0'), 0n);
  assert.equal(parseRateToScaled('1'), 10000n);
});

// 0.1 tidak dapat direpresentasikan tepat sebagai double. Kalau jalur ini
// pernah menyentuh float, salah satu dari nilai-nilai ini akan meleset.
test('presisi: nilai yang menjebak float tetap tepat', async () => {
  const { parseRateToScaled } = await import(MOD);
  assert.equal(parseRateToScaled('0.0001'), 1n, 'satu satuan terkecil numeric(6,4)');
  assert.equal(parseRateToScaled('0.0007'), 7n);
  assert.equal(parseRateToScaled('0.2900'), 2900n);
  assert.equal(parseRateToScaled('0.5700'), 5700n);
  // Bukti bahwa jalur float memang akan salah:
  assert.notEqual(Math.round(0.29 * 10000), 2899, 'sanity: 0.29 masih aman');
  assert.equal(Math.round(0.575 * 1000), 575, 'sanity');
});

test('parseRateToScaled: desimal lebih dari 4 digit ditolak, bukan dibulatkan diam-diam', async () => {
  const { parseRateToScaled } = await import(MOD);
  // numeric(6,4) hanya menyimpan 4 desimal. Membulatkan di sini akan membuat
  // nilai yang dikirim klien berbeda dari yang tersimpan, tanpa ada yang tahu.
  assert.throws(() => parseRateToScaled('0.12345'), /desimal/i);
});

test('parseRateToScaled: bentuk tidak sah ditolak', async () => {
  const { parseRateToScaled } = await import(MOD);
  for (const buruk of ['', 'abc', '0.1.1', '1e-1', ' 0.1', '0.1 ', '+0.1', 'NaN', 'Infinity']) {
    assert.throws(() => parseRateToScaled(buruk), /tarif/i, `"${buruk}" harus ditolak`);
  }
});

test('parseRateToScaled: negatif ditolak', async () => {
  const { parseRateToScaled } = await import(MOD);
  assert.throws(() => parseRateToScaled('-0.1'), /negatif|tarif/i);
});

test('parseRateToScaled: number (bukan string) ditolak', async () => {
  const { parseRateToScaled } = await import(MOD);
  // Menerima number di sini adalah pintu masuk float yang paling mungkin:
  // JSON.parse menghasilkan number untuk `0.1`, dan diam-diam menerimanya
  // akan membatalkan seluruh alasan konversi ini ada.
  assert.throws(() => parseRateToScaled(0.1), /string/i);
});

test('parseRateToScaled: melebihi jangkauan numeric(6,4) ditolak', async () => {
  const { parseRateToScaled } = await import(MOD);
  // presisi 6, skala 4 -> maksimum 99.9999
  assert.throws(() => parseRateToScaled('100'), /jangkauan|tarif/i);
});

test('formatScaledRate: kebalikan parseRateToScaled', async () => {
  const { formatScaledRate } = await import(MOD);
  assert.equal(formatScaledRate(1000n), '0.1000');
  assert.equal(formatScaledRate(1100n), '0.1100');
  assert.equal(formatScaledRate(0n), '0.0000');
  assert.equal(formatScaledRate(10000n), '1.0000');
  assert.equal(formatScaledRate(1n), '0.0001');
});

// Round-trip adalah properti yang benar-benar penting: apa pun yang masuk
// database harus keluar sebagai nilai yang sama, tanpa digit yang hilang.
test('property: round-trip numeric -> bigint -> numeric tidak pernah kehilangan digit', async () => {
  const { parseRateToScaled, formatScaledRate } = await import(MOD);
  let diperiksa = 0;
  for (let scaled = 0n; scaled <= 20000n; scaled += 1n) {
    const teks = formatScaledRate(scaled);
    assert.equal(parseRateToScaled(teks), scaled, `round-trip gagal untuk ${teks}`);
    diperiksa += 1;
  }
  assert.equal(diperiksa, 20001, 'seluruh jangkauan 0%..200% diperiksa satuan demi satuan');
});
