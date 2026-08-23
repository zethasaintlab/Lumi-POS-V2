'use strict';

// FR-F8 — deteksi manipulasi jam perangkat. `spec-f:337`.
//
// "Jam perangkat kasir dapat dimanipulasi untuk menanggalkan transaksi ke
// shift lain dan menyembunyikan pola."
//
// ⛔ Yang paling menentukan di berkas ini adalah apa yang BUKAN anomali.
// Transaksi ber-`occurred_at` berjam-jam lebih tua daripada `recorded_at`
// adalah durasi offline, dan seluruh produk ini dibangun supaya durasi itu
// ada. Deteksi yang menandainya menandai setiap penjualan offline — yaitu
// justru penjualan yang paling penting.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../packages/domain/src/jam-perangkat.ts';

const T0 = Date.parse('2026-08-23T10:00:00Z');

test('jam yang sama: tidak menyimpang', async () => {
  const { hitungSkew } = await import(MOD);
  assert.deepEqual(hitungSkew(T0, T0), { detik: 0, menyimpang: false });
});

test('⛔ ambangnya 5 menit, dan tepat 5 menit BELUM menyimpang', async () => {
  const { hitungSkew, AMBANG_SKEW_DETIK } = await import(MOD);
  assert.equal(AMBANG_SKEW_DETIK, 300);
  // `spec-f:354` menulis "> 5 menit". Menandai tepat 300 detik berarti
  // menandai perangkat yang persis di batas yang merchant setujui.
  assert.equal(hitungSkew(T0 + 300_000, T0).menyimpang, false);
  assert.equal(hitungSkew(T0 + 301_000, T0).menyimpang, true);
});

test('⛔ arahnya DUA: jam yang MUNDUR sama menyimpangnya', async () => {
  const { hitungSkew } = await import(MOD);
  // Transaksi yang ditanggalkan ke depan mendarat di shift berikutnya, yang
  // mundur mendarat di shift sebelumnya — keduanya menyembunyikan pola dari
  // orang yang membaca satu shift.
  const mundur = hitungSkew(T0 - 600_000, T0);
  assert.equal(mundur.menyimpang, true);
  assert.equal(mundur.detik, -600, 'tanda selisih hilang — arahnya tidak dapat dibaca');
});

test('selisih dilaporkan dalam DETIK, dibulatkan', async () => {
  const { hitungSkew } = await import(MOD);
  assert.equal(hitungSkew(T0 + 1499, T0).detik, 1);
  assert.equal(hitungSkew(T0 + 1500, T0).detik, 2);
});

test('jam yang bukan angka DITOLAK, tidak dianggap nol', async () => {
  const { hitungSkew } = await import(MOD);
  assert.throws(() => hitungSkew(Number.NaN, T0), TypeError);
  assert.throws(() => hitungSkew(T0, Number.POSITIVE_INFINITY), TypeError);
});

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

test('header ISO diurai', async () => {
  const { uraikanJamPerangkat } = await import(MOD);
  assert.equal(uraikanJamPerangkat('2026-08-23T10:00:00.000Z'), T0);
});

test('⛔ header HILANG bukan anomali — klien N-1 tidak mengirimnya', async () => {
  const { uraikanJamPerangkat } = await import(MOD);
  // `ARCH` menjanjikan versi lama hidup minimal 12 bulan. Menandai seluruh
  // armada lama sebagai jam termanipulasi membuat laporannya tidak dapat
  // dibaca siapa pun.
  for (const nilai of [undefined, null, '', '   ', 42, {}]) {
    assert.equal(uraikanJamPerangkat(nilai), null, `${JSON.stringify(nilai)} diurai`);
  }
});

test('⛔ header CACAT juga bukan anomali, dan itu keputusan yang BERBEDA', async () => {
  const { uraikanJamPerangkat } = await import(MOD);
  // Bentuk yang tidak dapat diurai tidak memberi tahu apa pun tentang jamnya.
  // Menandainya berarti melaporkan tebakan.
  assert.equal(uraikanJamPerangkat('kemarin sore'), null);
});

// ---------------------------------------------------------------------------
// Pembatasan pencatatan
// ---------------------------------------------------------------------------

test('belum pernah dicatat: selalu layak', async () => {
  const { layakDicatat } = await import(MOD);
  assert.equal(layakDicatat(null, T0), true);
});

test('⛔ satu per jam — perangkat yang salah setel tidak mengubur audit', async () => {
  const { layakDicatat, JEDA_CATAT_SKEW_DETIK } = await import(MOD);
  assert.equal(JEDA_CATAT_SKEW_DETIK, 3600);
  // Perangkat yang jamnya meleset 10 menit mengirim puluhan permintaan
  // sehari. Satu `audit_event` per permintaan mengubur seluruh audit trail di
  // bawah satu tablet — audit yang tidak dapat dibaca adalah audit yang tidak
  // ada.
  assert.equal(layakDicatat(T0, T0 + 3_599_000), false);
  assert.equal(layakDicatat(T0, T0 + 3_600_000), true);
});
