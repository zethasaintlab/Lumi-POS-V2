'use strict';

// Statistik laporan exception. FR-G5, `spec-g:149`.
//
// ⛔ Prinsipnya VARIASI, bukan nilai absolut (`spec-g:153`). Kafe yang omzetnya
// besar punya refund besar; ambang rupiah tetap menandai seluruh kasirnya
// sementara kafe kecil tidak pernah menandai siapa pun.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../packages/domain/src/statistik.ts';

// ---------------------------------------------------------------------------
// Persentil
// ---------------------------------------------------------------------------

test('⛔ nearest-rank — nilainya BENAR-BENAR terjadi', async () => {
  const { persentil } = await import(MOD);
  // p90 hasil interpolasi adalah angka yang tidak pernah dibayarkan siapa pun,
  // dan menaruhnya sebagai ambang membuat laporan menyala untuk transaksi yang
  // tidak ada.
  const nilai = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  assert.equal(persentil(nilai, 90), 90);
  assert.ok(nilai.includes(persentil(nilai, 75)), 'p75 bukan nilai yang terjadi');
});

test('larik kosong: nol, bukan NaN', async () => {
  const { persentil } = await import(MOD);
  assert.equal(persentil([], 90), 0);
});

test('⛔ SATU sumber dengan telemetri', async () => {
  const { persentil } = await import(MOD);
  const telemetri = await import('../../packages/domain/src/telemetri.ts');
  // Dua implementasi nearest-rank yang menyimpang menghasilkan p95 latensi
  // yang berbeda dari p90 refund untuk bentuk data yang sama.
  assert.equal(telemetri.persentil, persentil);
});

// ---------------------------------------------------------------------------
// Rasio
// ---------------------------------------------------------------------------

test('rasio terhadap rata-rata, satu desimal sebagai STRING', async () => {
  const { rasioTerhadapRataRata } = await import(MOD);
  // Rata-rata [1,2,3,6] = 3. 6/3 = 2,0.
  assert.equal(rasioTerhadapRataRata(6, [1, 2, 3, 6]), '2.0');
});

test('⛔ STRING, bukan number — `0.30000000000000004` merusak kepercayaan', async () => {
  const { rasioTerhadapRataRata } = await import(MOD);
  const r = rasioTerhadapRataRata(1, [1, 2, 3]);
  assert.equal(typeof r, 'string');
  assert.match(r, /^\d+\.\d$/);
});

test('⛔ rata-rata NOL tidak menghasilkan Infinity', async () => {
  const { rasioTerhadapRataRata } = await import(MOD);
  // Periode tanpa satu pun peristiwa adalah keadaan normal; laporan yang
  // menampilkan Infinity untuk periode sepi berhenti dibaca.
  assert.equal(rasioTerhadapRataRata(0, [0, 0]), '0.0');
  assert.equal(rasioTerhadapRataRata(5, []), '0.0');
});

// ---------------------------------------------------------------------------
// Tren
// ---------------------------------------------------------------------------

test('⛔ deret yang terlalu pendek DATAR, bukan ditebak', async () => {
  const { arahTren, MIN_DERET_TREN } = await import(MOD);
  assert.equal(MIN_DERET_TREN, 4);
  // Dua shift tidak menunjukkan kecenderungan apa pun, dan menyebutnya "naik"
  // memberi pembaca keyakinan yang tidak dimiliki datanya.
  assert.equal(arahTren([-1000, -9000]), 'datar');
  assert.equal(arahTren([1, 2, 3]), 'datar');
});

test('selisih yang makin negatif: turun', async () => {
  const { arahTren } = await import(MOD);
  assert.equal(arahTren([-1000, -2000, -8000, -9000]), 'turun');
});

test('selisih yang makin positif: naik', async () => {
  const { arahTren } = await import(MOD);
  assert.equal(arahTren([-9000, -8000, 2000, 3000]), 'naik');
});

test('deret yang berayun tanpa arah: datar', async () => {
  const { arahTren } = await import(MOD);
  assert.equal(arahTren([1000, -1000, 1000, -1000]), 'datar');
});

// ---------------------------------------------------------------------------
// Posisi void terhadap tutup shift
// ---------------------------------------------------------------------------

const TUTUP = Date.parse('2026-08-23T15:00:00Z');

test('void di 60 menit terakhir shift', async () => {
  const { posisiVoid, MENIT_AKHIR_SHIFT } = await import(MOD);
  assert.equal(MENIT_AKHIR_SHIFT, 60);
  assert.equal(posisiVoid(TUTUP - 30 * 60_000, TUTUP), 'akhir_shift');
  assert.equal(posisiVoid(TUTUP - 60 * 60_000, TUTUP), 'akhir_shift');
  assert.equal(posisiVoid(TUTUP - 61 * 60_000, TUTUP), 'biasa');
});

test('⛔ void SESUDAH tutup adalah keadaan yang BERBEDA, bukan lebih dekat', async () => {
  const { posisiVoid } = await import(MOD);
  assert.equal(posisiVoid(TUTUP + 60_000, TUTUP), 'sesudah_tutup');
});

test('⛔ shift yang BELUM ditutup tidak punya 60 menit terakhir', async () => {
  const { posisiVoid } = await import(MOD);
  // Menghitungnya dari "sekarang" membuat setiap void pada shift berjalan
  // tertandai selama satu jam lalu berhenti tertandai sendiri — laporan yang
  // jawabannya berubah tanpa satu pun data berubah.
  assert.equal(posisiVoid(Date.now(), null), 'biasa');
});
