'use strict';

// B-28 — kode pemasangan perangkat.
//
// ⛔ Perangkat kasir butuh ENAM nilai untuk tersambung, bukan satu:
// `deviceId`, `deviceCode`, `tenantId`, `outletId`, `baseUrl`, `tokenSecret`
// (`packages/sync-client/src/perangkat.ts`). `tokenSecret` sendiri 43
// karakter base64url dari CSPRNG.
//
// "PIN sementara" karena itu tidak dapat membawa pemasangan ini — yang dapat
// adalah satu baris yang MEMBUNGKUS keenamnya. Layar K-15 kasir menyebut
// bentuk yang dituju dengan namanya sendiri: "kasir memindai/MENEMPELKANNYA
// sekali".

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../apps/backoffice/src/perangkat/kode-pemasangan.ts';

const KONFIG = {
  deviceId: '018f2a10-0000-7000-8000-000000000001',
  deviceCode: 'K1',
  tenantId: '018f2a10-0000-7000-8000-000000000002',
  outletId: '018f2a10-0000-7000-8000-000000000003',
  baseUrl: 'https://api.lumipos.id',
  tokenSecret: 'aVeryLongBase64UrlSecretValue_1234567890abc',
};

// ---------------------------------------------------------------------------

test('bungkus lalu buka mengembalikan konfigurasi yang sama persis', async () => {
  const { bungkusKodePemasangan, bukaKodePemasangan } = await import(MOD);
  assert.deepEqual(bukaKodePemasangan(bungkusKodePemasangan(KONFIG)), KONFIG);
});

test('⛔ kodenya AMAN disalin — tanpa spasi, baris baru, atau padding', async () => {
  // Ia disalin dari layar back-office lalu ditempel di tablet kasir. Karakter
  // yang dipotong pemilih teks atau diubah aplikasi pesan membuat pemasangan
  // gagal dengan cara yang mustahil didiagnosis merchant.
  const { bungkusKodePemasangan } = await import(MOD);
  const kode = bungkusKodePemasangan(KONFIG);

  assert.ok(!/[\s=+/]/.test(kode), `kode memuat karakter rapuh: ${kode}`);
  assert.match(kode, /^LUMI1\./, 'tanpa awalan bertanda versi');
});

test('⛔ awalan versi ada, dan kode versi lain DITOLAK', async () => {
  // Bentuk paketnya akan berubah — `schemaVersion` atau kredensial perangkat
  // yang berubah bentuk. Kode lama yang diterima diam-diam oleh pembaca baru
  // menghasilkan perangkat yang tersambung setengah, dan gejalanya muncul di
  // outlet berhari-hari kemudian.
  const { bungkusKodePemasangan, bukaKodePemasangan } = await import(MOD);
  const kode = bungkusKodePemasangan(KONFIG);
  assert.equal(bukaKodePemasangan(kode.replace('LUMI1.', 'LUMI2.')), null);
  assert.equal(bukaKodePemasangan(kode.replace('LUMI1.', '')), null);
});

test('⛔ kode rusak MENGEMBALIKAN null, tidak melempar', async () => {
  // Ia diketik/ditempel manusia. Melempar berarti layar kasir jatuh karena
  // satu karakter yang hilang saat menyalin.
  const { bukaKodePemasangan } = await import(MOD);
  for (const buruk of ['', 'LUMI1.', 'LUMI1.bukan-base64!!', 'sembarang teks', 'LUMI1.YWJj']) {
    assert.equal(bukaKodePemasangan(buruk), null, `"${buruk}" diterima`);
  }
});

test('⛔ konfigurasi yang KURANG satu field ditolak, bukan diterima separuh', async () => {
  // Perangkat yang tersambung tanpa `outletId` akan mengirim penjualan tanpa
  // outlet — dan itu ditolak server jauh kemudian, setelah kasir mengira
  // pemasangannya berhasil.
  const { bungkusKodePemasangan, bukaKodePemasangan } = await import(MOD);
  for (const kunci of Object.keys(KONFIG)) {
    const kurang = { ...KONFIG };
    delete kurang[kunci];
    const kode = bungkusKodePemasangan(kurang);
    assert.equal(bukaKodePemasangan(kode), null, `konfigurasi tanpa "${kunci}" diterima`);
  }
});

test('⛔ field KOSONG ditolak sama seperti field yang hilang', async () => {
  // `baseUrl: ''` lolos pemeriksaan "ada" tapi menghasilkan perangkat yang
  // menembak alamat kosong.
  const { bungkusKodePemasangan, bukaKodePemasangan } = await import(MOD);
  const kode = bungkusKodePemasangan({ ...KONFIG, baseUrl: '' });
  assert.equal(bukaKodePemasangan(kode), null);
});

test('spasi di tepi saat menempel diabaikan', async () => {
  // Menyalin dari layar hampir selalu membawa spasi atau baris baru.
  const { bungkusKodePemasangan, bukaKodePemasangan } = await import(MOD);
  const kode = bungkusKodePemasangan(KONFIG);
  assert.deepEqual(bukaKodePemasangan(`  ${kode}\n`), KONFIG);
});

test('⛔ karakter non-ASCII di nilai tetap utuh', async () => {
  // Nama outlet dan kode perangkat boleh memuat huruf beraksen. `btoa` mentah
  // melempar untuk itu — yang dipakai harus melewati UTF-8 lebih dulu.
  const { bungkusKodePemasangan, bukaKodePemasangan } = await import(MOD);
  const konfig = { ...KONFIG, deviceCode: 'Kasir Ñ 1 — depan' };
  assert.deepEqual(bukaKodePemasangan(bungkusKodePemasangan(konfig)), konfig);
});

test('⛔ kode TIDAK dapat dibaca sekilas, tapi ia BUKAN enkripsi', async () => {
  // Ia base64 — siapa pun yang memegangnya memegang secret perangkat. Test
  // ini menyematkan kenyataan itu supaya tidak ada yang menyimpulkan dari
  // bentuknya yang acak bahwa ia aman disebar.
  const { bungkusKodePemasangan, bukaKodePemasangan } = await import(MOD);
  const kode = bungkusKodePemasangan(KONFIG);
  assert.ok(!kode.includes(KONFIG.tokenSecret), 'secret terbaca apa adanya di kode');
  assert.equal(bukaKodePemasangan(kode).tokenSecret, KONFIG.tokenSecret, 'dan tetap dapat dibuka siapa pun');
});
