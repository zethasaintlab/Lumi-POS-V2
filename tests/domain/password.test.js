'use strict';

// FR-F2b — aturan password back-office (`spec-f:174`).
//
// Aturannya sudah hidup sejak F3, tapi sebagai konstanta PRIVAT di dalam
// `identity/handlers/auth.ts`. Pendaftaran merchant (F5) menetapkan password
// PERTAMA dan tunduk pada aturan yang sama persis — dan dua salinan aturan
// yang sama adalah dua salinan yang akan menyimpang.
//
// Yang diuji di sini adalah aturannya sebagai fungsi MURNI: tanpa database,
// tanpa hashing, tanpa HTTP.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../packages/domain/src/password.ts';

test('password yang memenuhi syarat diterima', async () => {
  const { periksaPassword } = await import(MOD);
  assert.deepEqual(periksaPassword('kopi susu gula aren'), { ok: true });
});

test('⛔ password kurang dari 10 karakter ditolak (spec-f:174)', async () => {
  const { periksaPassword, PANJANG_MINIMUM } = await import(MOD);
  assert.equal(PANJANG_MINIMUM, 10);

  const hasil = periksaPassword('123456789');
  assert.equal(hasil.ok, false);
  assert.equal(hasil.kode, 'PASSWORD_TOO_SHORT');
  assert.match(hasil.pesan, /10/, 'pesan harus menyebut angkanya, bukan "terlalu pendek"');

  // ⛔ BUKAN '1234567890' — nilai itu ada di daftar bocor, jadi ia ditolak
  // karena alasan yang lain sama sekali. Batas panjang yang diuji lewat nilai
  // yang juga gagal aturan kedua tidak menguji batasnya.
  assert.equal(periksaPassword('aren-manis').ok, true, 'tepat 10 harus DITERIMA, bukan ditolak');
});

test('⛔ password yang pernah bocor ditolak, tanpa memandang besar-kecil huruf', async () => {
  const { periksaPassword } = await import(MOD);

  const hasil = periksaPassword('password123');
  assert.equal(hasil.ok, false);
  assert.equal(hasil.kode, 'PASSWORD_BREACHED');

  assert.equal(periksaPassword('PASSWORD123').ok, false, 'daftar bocor harus case-insensitive');
  assert.equal(periksaPassword('PassWord123').ok, false);
});

test('⛔ bukan-string ditolak, tidak dilempar', async () => {
  // Handler memanggilnya dengan `req.body.password` yang bertipe `unknown`.
  // Melempar TypeError di sini berarti 500, dan 500 untuk password kosong
  // adalah kesalahan server yang menyalahkan dirinya sendiri.
  const { periksaPassword } = await import(MOD);
  for (const nilai of [undefined, null, 123, {}, []]) {
    const hasil = periksaPassword(nilai);
    assert.equal(hasil.ok, false, `${JSON.stringify(nilai)} harus ditolak`);
    assert.equal(hasil.kode, 'PASSWORD_TOO_SHORT');
  }
});

test('⛔ daftar bocor memuat pola Indonesia, bukan hanya pola Inggris', async () => {
  // Batas daftar ini dicatat di `auth.ts`: ia menangkap tebakan pertama,
  // bukan serangan kamus. Yang membuatnya berarti untuk merchant Indonesia
  // adalah pola lokal — daftar rockyou tidak memuatnya, dan daftar sungguhan
  // tidak dapat di-bundle.
  const { periksaPassword } = await import(MOD);
  for (const p of ['indonesia123', 'bismillah123', 'rahasia123', 'jakarta1234']) {
    assert.equal(periksaPassword(p).ok, false, `${p} harus ada di daftar bocor`);
  }
});
