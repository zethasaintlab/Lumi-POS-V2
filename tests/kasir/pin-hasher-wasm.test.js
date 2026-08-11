'use strict';

// §6 (docs/superpowers/plans/PLAN-modul-f-identitas.md) -- implementasi KLIEN
// dari port `PinHasher`, di atas Argon2 WASM.
//
// Keputusan user 11 Agustus 2026: WASM, bukan perintah Rust lewat Tauri.
// Alasannya jalur kode tetap terpadu -- node, browser, dan webview Tauri
// menjalankan biner yang sama -- dan harness browser tetap dapat menguji
// login. Perintah Tauri akan membuat login satu-satunya alur yang tidak dapat
// diuji di mana pun kecuali aplikasi rilis.
//
// ⛔ YANG DIUJI DI SINI ADALAH LINTAS IMPLEMENTASI, bukan Argon2.
//
// Server mencetak hash dengan `node:crypto`; klien memverifikasinya dengan
// `hash-wasm`. Keduanya pustaka yang sama sekali berbeda. Kalau salah satu
// menafsirkan salt, panjang tag, atau base64 dengan cara lain, gejalanya
// adalah "PIN salah" pada PIN yang benar -- kegagalan yang menunjuk ke tempat
// keliru sepenuhnya, dan yang hanya muncul setelah hash benar-benar
// direplikasi ke perangkat.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const KLIEN = '../../apps/kasir/src/identitas/pin-hasher-wasm.ts';
const SERVER = '../../apps/server/src/modules/identity/pin-hasher.ts';
const DOMAIN = '../../packages/domain/src/pin.ts';

test('⛔ hash SERVER diverifikasi KLIEN — inilah jalur sungguhannya', async () => {
  const { buatPinHasher } = await import(SERVER);
  const { buatPinHasherWasm } = await import(KLIEN);

  const server = buatPinHasher();
  const klien = buatPinHasherWasm();

  // Ini persis yang terjadi di produksi: hash dicetak server, direplikasi
  // turun, lalu diverifikasi di perangkat tanpa jaringan (`spec-f:124-125`).
  for (const pin of ['482913', '048291', '739154', '905172']) {
    const phc = await server.hash(pin);
    assert.equal(await klien.verifikasi(pin, phc), true, `${pin} harus diterima klien`);
    assert.equal(await klien.verifikasi('111111', phc), false, `${pin}: PIN lain harus ditolak`);
  }
});

test('hash KLIEN diverifikasi SERVER — arah sebaliknya juga utuh', async () => {
  const { buatPinHasher } = await import(SERVER);
  const { buatPinHasherWasm } = await import(KLIEN);

  // Arah ini belum dipakai jalur mana pun hari ini: PIN selalu diset lewat
  // server. Ia diuji supaya kesepakatan formatnya dua arah -- kalau kelak
  // perangkat mencetak hash (mis. ganti PIN saat offline, `spec-f:420`),
  // yang menahannya bukan penemuan di lapangan.
  const server = buatPinHasher();
  const klien = buatPinHasherWasm();

  const phc = await klien.hash('316847');
  assert.equal(await server.verifikasi('316847', phc), true);
  assert.equal(await server.verifikasi('316848', phc), false);
});

test('kedua implementasi mencetak PHC yang bentuknya identik', async () => {
  const { buatPinHasher } = await import(SERVER);
  const { buatPinHasherWasm } = await import(KLIEN);
  const { parsePhc, ARGON2_PARAMS } = await import(DOMAIN);

  const dariServer = parsePhc(await buatPinHasher().hash('482913'));
  const dariKlien = parsePhc(await buatPinHasherWasm().hash('482913'));

  for (const kunci of ['algorithm', 'version', 'memory', 'passes', 'parallelism']) {
    assert.equal(dariServer[kunci], dariKlien[kunci], `beda di ${kunci}`);
  }
  assert.equal(dariServer.memory, ARGON2_PARAMS.memory);
  assert.equal(dariServer.salt.length, dariKlien.salt.length, 'panjang salt harus sama');
  assert.equal(dariServer.tag.length, dariKlien.tag.length, 'panjang tag harus sama');
});

test('klien: salt acak per hash — bukan salt tetap yang di-hardcode', async () => {
  const { buatPinHasherWasm } = await import(KLIEN);
  const { parsePhc } = await import(DOMAIN);
  const klien = buatPinHasherWasm();

  // Salt tetap akan membuat seluruh test di atas hijau sambil membuat setiap
  // hash yang dicetak perangkat dapat dipecahkan sekaligus.
  const a = parsePhc(await klien.hash('482913'));
  const b = parsePhc(await klien.hash('482913'));
  assert.notEqual(a.salt, b.salt);
});

test('klien: hash rusak DITOLAK, tidak melempar', async () => {
  const { buatPinHasherWasm } = await import(KLIEN);
  const klien = buatPinHasherWasm();

  // Sama alasannya dengan sisi server: hash rusak dapat sampai ke perangkat
  // lewat replikasi yang setengah jalan. Melempar berarti layar login jatuh
  // dan kasir tidak dapat berjualan; menolak berarti ia melihat "PIN salah"
  // dan memanggil manajer.
  for (const rusak of ['', 'bukan-phc', null, undefined, '$argon2i$v=19$m=1,t=1,p=1$YQ$Yg']) {
    assert.equal(await klien.verifikasi('482913', rusak), false, `harus tolak: ${String(rusak)}`);
  }
});

test('klien: verifikasi memakai parameter DARI hash', async () => {
  const { buatPinHasherWasm } = await import(KLIEN);
  const { argon2id } = await import('hash-wasm');
  const klien = buatPinHasherWasm();

  // Parameter yang sengaja berbeda dari ARGON2_PARAMS. Implementasi yang
  // mengabaikan isi PHC akan menghitung tag lain dan menolak PIN yang benar --
  // dan itu yang membuat menaikkan parameter kelak tidak mengunci pengguna
  // yang sudah ada.
  const phcLama = await argon2id({
    password: '739154',
    salt: new Uint8Array(16).fill(3),
    parallelism: 1,
    memorySize: 8192,
    iterations: 1,
    hashLength: 32,
    outputType: 'encoded',
  });

  assert.equal(await klien.verifikasi('739154', phcLama), true);
  assert.equal(await klien.verifikasi('739155', phcLama), false);
});

test('⛔ klien TIDAK menyimpan PIN maupun hash di mana pun', async () => {
  const { readFileSync } = require('node:fs');
  const { resolve } = require('node:path');
  const sumber = readFileSync(resolve(__dirname, KLIEN), 'utf8');

  // Invariant #4 Modul F (`spec-f:19`): PIN tidak pernah meninggalkan
  // perangkat dalam bentuk plaintext. Yang dijaga di sini lebih sempit dan
  // dapat diperiksa: modul ini tidak menulis ke penyimpanan apa pun.
  for (const terlarang of ['localStorage', 'sessionStorage', 'indexedDB', 'db.execute', 'fetch(']) {
    assert.equal(sumber.includes(terlarang), false, `pin-hasher klien tidak boleh menyentuh ${terlarang}`);
  }
});
