'use strict';

// T3.4 (docs/superpowers/plans/PLAN-modul-f-identitas.md) -- implementasi
// server dari port `PinHasher`.
//
// ⛔ Argon2id datang dari `node:crypto`, BUKAN dari dependency baru.
// Node 24.18.0 menyediakan `crypto.argon2Sync('argon2id', ...)`; diukur 23 ms
// per hash dengan parameter OWASP. `spec-f:146` menuntut Argon2id secara
// eksplisit, dan sampai ini diukur, memenuhinya terlihat seperti menuntut
// persetujuan dependency.
//
// Yang diuji di sini adalah kontrak yang harus dipenuhi implementasi KLIEN
// juga (pustaka Argon2 yang berbeda, di webview). Karena itu setiap assertion
// di bawah berbicara tentang FORMAT dan PERILAKU, bukan tentang node:crypto.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../apps/server/src/modules/identity/pin-hasher.ts';
const DOMAIN = '../../packages/domain/src/pin.ts';

test('hash: menghasilkan PHC yang dapat diurai, dengan parameter yang berlaku', async () => {
  const { buatPinHasher } = await import(MOD);
  const { parsePhc, ARGON2_PARAMS } = await import(DOMAIN);

  const hasher = buatPinHasher();
  const phc = await hasher.hash('482913');

  const terurai = parsePhc(phc);
  assert.equal(terurai.algorithm, 'argon2id');
  assert.equal(terurai.memory, ARGON2_PARAMS.memory);
  assert.equal(terurai.passes, ARGON2_PARAMS.passes);
  assert.equal(terurai.parallelism, ARGON2_PARAMS.parallelism);
});

test('hash: PIN yang sama menghasilkan hash BERBEDA (salt per pengguna)', async () => {
  const { buatPinHasher } = await import(MOD);
  const hasher = buatPinHasher();

  const a = await hasher.hash('482913');
  const b = await hasher.hash('482913');
  assert.notEqual(a, b);

  // ⛔ Inilah kenapa `UNIQUE(outlet_id, pin_hash)` di `ERD:143` MUSTAHIL
  // ditegakkan database, dan kenapa migrasi 0019 tidak membuatnya. Index unik
  // atas kolom ini akan hijau selamanya sambil membiarkan dua kasir seoutlet
  // memakai PIN yang sama -- tepat keadaan yang `spec-f:126` larang, dan
  // tepat keadaan yang menghancurkan atribusi.
  //
  // Keduanya tetap memverifikasi PIN yang sama. Itu yang membuat penegakan
  // keunikan HARUS lewat verifikasi, bukan lewat perbandingan hash.
  assert.equal(await hasher.verifikasi('482913', a), true);
  assert.equal(await hasher.verifikasi('482913', b), true);
});

test('verifikasi: benar diterima, salah ditolak', async () => {
  const { buatPinHasher } = await import(MOD);
  const hasher = buatPinHasher();

  const phc = await hasher.hash('482913');
  assert.equal(await hasher.verifikasi('482913', phc), true);
  assert.equal(await hasher.verifikasi('482914', phc), false);
  assert.equal(await hasher.verifikasi('000000', phc), false);

  // Nol di depan tidak boleh hilang di mana pun sepanjang jalur.
  const nol = await hasher.hash('048291');
  assert.equal(await hasher.verifikasi('048291', nol), true);
  assert.equal(await hasher.verifikasi('48291', nol), false);
});

test('verifikasi: memakai parameter DARI hash, bukan dari konstanta', async () => {
  const { buatPinHasher } = await import(MOD);
  const hasher = buatPinHasher();

  // Ini yang membuat rotasi parameter mungkin, dan ia tidak dapat dibuktikan
  // dengan hash yang dicetak hasher itu sendiri -- keduanya akan memakai
  // parameter yang sama, jadi implementasi yang mengabaikan isi PHC dan
  // selalu memakai ARGON2_PARAMS akan tetap hijau.
  //
  // Karena itu hash di bawah dicetak dengan parameter yang SENGAJA berbeda
  // (m=8192, t=1). Kalau verifikasi mengabaikannya, ia akan menghitung tag
  // yang lain dan menolak PIN yang benar.
  const { argon2Sync, randomBytes } = await import('node:crypto');
  const { formatPhc, toBase64NoPad } = await import(DOMAIN);

  const salt = randomBytes(16);
  const params = { memory: 8192, passes: 1, parallelism: 1 };
  const tag = argon2Sync('argon2id', {
    message: Buffer.from('739154', 'utf8'),
    nonce: salt,
    tagLength: 32,
    memory: params.memory,
    passes: params.passes,
    parallelism: params.parallelism,
  });
  const phcLama = formatPhc({
    ...params,
    salt: toBase64NoPad(new Uint8Array(salt)),
    tag: toBase64NoPad(new Uint8Array(tag)),
  });

  assert.equal(await hasher.verifikasi('739154', phcLama), true, 'hash berparameter lama tetap sah');
  assert.equal(await hasher.verifikasi('739155', phcLama), false);
});

test('verifikasi: hash rusak DITOLAK, tidak melempar', async () => {
  const { buatPinHasher } = await import(MOD);
  const hasher = buatPinHasher();

  // Hash rusak dapat sampai ke sini lewat replikasi yang setengah jalan atau
  // baris yang disunting tangan. Melempar berarti login jatuh dengan 500 dan
  // kasir tidak dapat berjualan; menolak berarti ia melihat "PIN salah" dan
  // memanggil manajer. Yang kedua yang benar.
  for (const rusak of ['', 'bukan-phc', null, undefined, '$argon2i$v=19$m=1,t=1,p=1$YQ$Yg']) {
    assert.equal(await hasher.verifikasi('482913', rusak), false, `harus tolak: ${String(rusak)}`);
  }
});

test('verifikasi: perbandingan tag panjang-tetap (timing-safe)', async () => {
  const { buatPinHasher } = await import(MOD);
  const hasher = buatPinHasher();

  // Test ini tidak dapat mengukur waktu secara andal di CI. Yang ia jaga
  // adalah hal yang BISA diperiksa: implementasi tidak boleh membandingkan
  // dengan `===` pada string, karena itu keluar di byte pertama yang berbeda.
  // Diperiksa lewat sumber -- lemah, dan dinyatakan lemah, tapi lebih baik
  // daripada tidak ada yang menjaganya sama sekali.
  const { readFileSync } = require('node:fs');
  const { resolve } = require('node:path');
  const sumber = readFileSync(resolve(__dirname, MOD), 'utf8');
  assert.match(sumber, /timingSafeEqual/, 'perbandingan tag wajib timing-safe');
});
