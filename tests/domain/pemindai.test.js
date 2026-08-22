'use strict';

// K-17 — heuristik pengenalan scanner. Murni, waktu di-INJECT.
//
// ⛔ Yang paling penting diuji di sini adalah PERILAKU SAAT HEURISTIKNYA
// SALAH, bukan saat ia benar. Tidak ada cara membedakan scanner dari keyboard
// di web — keduanya `KeyboardEvent` tanpa penanda perangkat — jadi salah dua
// arah pasti terjadi, dan keduanya harus tidak berbahaya.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../packages/domain/src/pemindai.ts';

/** Mengetik `teks` dengan jeda tetap, lalu Enter. */
async function ketikkan(teks, jedaMs, { enter = true, mulai = 1000 } = {}) {
  const { ketuk, keadaanAwal } = await import(MOD);
  let k = keadaanAwal();
  let t = mulai;
  let hasil = { jenis: 'kumpulkan', keadaan: k };
  for (const c of teks) {
    hasil = ketuk(k, c, t);
    k = hasil.keadaan;
    t += jedaMs;
  }
  if (enter) {
    hasil = ketuk(k, 'Enter', t);
  }
  return hasil;
}

test('scanner: ketikan cepat + Enter dikenali sebagai scan', async () => {
  const h = await ketikkan('8991234567890', 8);
  assert.equal(h.jenis, 'terpindai');
  assert.equal(h.kode, '8991234567890');
});

test('manusia: ketikan pelan + Enter TIDAK dikenali sebagai scan', async () => {
  // 200 ms per karakter — kecepatan mengetik biasa. Jeda memutus buffer, jadi
  // yang tersisa saat Enter hanya karakter terakhir.
  const h = await ketikkan('8991234567890', 200);
  assert.equal(h.jenis, 'abaikan');
});

test('⛔ buffer dikosongkan JUGA saat diabaikan', async () => {
  const { ketuk, keadaanAwal } = await import(MOD);
  // Sisa ketikan manusia yang tertinggal akan menempel di depan scan
  // berikutnya, dan barcode yang tercemar tidak cocok apa pun — gejalanya
  // "scanner kadang tidak jalan", yang mustahil dilacak.
  let k = keadaanAwal();
  k = ketuk(k, 'a', 1000).keadaan;
  const h = ketuk(k, 'Enter', 1010);
  assert.equal(h.jenis, 'abaikan');
  assert.deepEqual(h.keadaan, keadaanAwal());
});

test('⛔ jeda tepat di ambang masih satu scan; sedikit di atasnya bukan', async () => {
  const { JEDA_MAKS_MS } = await import(MOD);
  const pas = await ketikkan('12345678', JEDA_MAKS_MS);
  assert.equal(pas.jenis, 'terpindai', 'jeda TEPAT di ambang harus lolos (<=)');

  const lewat = await ketikkan('12345678', JEDA_MAKS_MS + 1);
  assert.equal(lewat.jenis, 'abaikan');
});

test('⛔ kode terlalu pendek diabaikan, bukan dicari', async () => {
  const { PANJANG_MIN } = await import(MOD);
  const pendek = await ketikkan('1'.repeat(PANJANG_MIN - 1), 5);
  assert.equal(pendek.jenis, 'abaikan');

  const pas = await ketikkan('1'.repeat(PANJANG_MIN), 5);
  assert.equal(pas.jenis, 'terpindai');
});

test('tombol kendali tidak mengubah keadaan sama sekali', async () => {
  const { ketuk, keadaanAwal } = await import(MOD);
  // ⛔ Termasuk `terakhirMs`. `Shift` di tengah barcode (huruf besar pada
  // Code 39) yang menyentuh waktunya akan memperpanjang jendela jeda secara
  // tidak sengaja — dan ketikan manusia yang kebetulan diselingi Shift
  // menjadi "scan".
  let k = keadaanAwal();
  k = ketuk(k, '1', 1000).keadaan;
  const sebelum = { ...k };
  for (const key of ['Shift', 'Control', 'Tab', 'F1', 'ArrowLeft']) {
    k = ketuk(k, key, 5000).keadaan;
  }
  assert.deepEqual(k, sebelum);
});

test('Shift di tengah barcode tidak memutus scan', async () => {
  const { ketuk, keadaanAwal } = await import(MOD);
  let k = keadaanAwal();
  let t = 1000;
  for (const key of ['A', 'Shift', 'B', 'C', 'D', 'E']) {
    k = ketuk(k, key, (t += 10)).keadaan;
  }
  const h = ketuk(k, 'Enter', t + 10);
  assert.equal(h.jenis, 'terpindai');
  assert.equal(h.kode, 'ABCDE');
});

test('scan kedua tidak tercemar oleh scan pertama', async () => {
  const { ketuk, keadaanAwal } = await import(MOD);
  let k = keadaanAwal();
  let t = 1000;
  for (const c of '11112222') k = ketuk(k, c, (t += 8)).keadaan;
  const satu = ketuk(k, 'Enter', (t += 8));
  assert.equal(satu.kode, '11112222');

  k = satu.keadaan;
  // Scan kedua datang JAUH kemudian — jedanya panjang, dan itu tidak boleh
  // menghalanginya: buffer kosong berarti karakter pertama selalu diterima.
  t += 60_000;
  for (const c of '33334444') k = ketuk(k, c, (t += 8)).keadaan;
  const dua = ketuk(k, 'Enter', (t += 8));
  assert.equal(dua.jenis, 'terpindai');
  assert.equal(dua.kode, '33334444');
});

test('Enter tanpa apa pun sebelumnya tidak menghasilkan scan kosong', async () => {
  const { ketuk, keadaanAwal } = await import(MOD);
  const h = ketuk(keadaanAwal(), 'Enter', 1000);
  assert.equal(h.jenis, 'abaikan');
});

test('⛔ modul tidak pernah membaca jam sendiri', async () => {
  const { readFileSync } = require('node:fs');
  const { join } = require('node:path');
  const isi = readFileSync(join(__dirname, '..', '..', 'packages', 'domain', 'src', 'pemindai.ts'), 'utf8');
  // Waktu di-INJECT — itu yang membuat setiap kasus batas di atas dapat
  // ditulis persis, dan yang membuat test ini tidak pernah merah sesekali.
  const tanpaKomentar = isi.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  assert.ok(!/Date\.now|new Date|performance\.now/.test(tanpaKomentar), 'modul menyentuh jam');
});
