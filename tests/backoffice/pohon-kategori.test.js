'use strict';

// B-08 — pohon kategori dua tingkat.
//
// ⛔ Server menolak tingkat KETIGA dengan 409. Yang di sini menolaknya lebih
// dulu dan MENJELASKAN — pemilih induk yang menawarkan kategori bertingkat dua
// adalah pemilih yang setiap pilihannya gagal.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../apps/backoffice/src/katalog/pohon.ts';

const KOPI = { id: 'k', name: 'Kopi', parentId: null, sortOrder: 0, archivedAt: null };
const PANAS = { id: 'p', name: 'Panas', parentId: 'k', sortOrder: 1, archivedAt: null };
const DINGIN = { id: 'd', name: 'Dingin', parentId: 'k', sortOrder: 0, archivedAt: null };
const ROTI = { id: 'r', name: 'Roti', parentId: null, sortOrder: 1, archivedAt: null };

const SEMUA = [PANAS, ROTI, KOPI, DINGIN];

// ---------------------------------------------------------------------------

test('daftar datar menjadi pohon dua tingkat, terurut sortOrder lalu nama', async () => {
  const { susunPohon } = await import(MOD);
  const pohon = susunPohon(SEMUA);

  assert.deepEqual(
    pohon.map((n) => [n.kategori.name, n.anak.map((a) => a.name)]),
    [
      ['Kopi', ['Dingin', 'Panas']],
      ['Roti', []],
    ]
  );
});

test('⛔ urutan dimiliki JS, bukan diwarisi dari urutan datang', async () => {
  // Daftar datang dari `GET /categories`. Kalau urutannya hanya dijamin SQL,
  // ia tidak dapat diuji sama sekali — pelajaran yang sudah tercatat di
  // `CLAUDE.md` ("fake juga tidak menegakkan ORDER BY").
  const { susunPohon } = await import(MOD);
  const terbalik = susunPohon([...SEMUA].reverse());
  assert.deepEqual(
    terbalik.map((n) => n.kategori.name),
    ['Kopi', 'Roti']
  );
  assert.deepEqual(terbalik[0].anak.map((a) => a.name), ['Dingin', 'Panas']);
});

test('sortOrder sama diurutkan menurut nama, bukan dibiarkan acak', async () => {
  const { susunPohon } = await import(MOD);
  const pohon = susunPohon([
    { id: 'b', name: 'Bakery', parentId: null, sortOrder: 0, archivedAt: null },
    { id: 'a', name: 'Aneka', parentId: null, sortOrder: 0, archivedAt: null },
  ]);
  assert.deepEqual(pohon.map((n) => n.kategori.name), ['Aneka', 'Bakery']);
});

test('⛔ anak yang induknya TIDAK ADA di daftar tetap muncul, sebagai akar', async () => {
  // Terjadi nyata: induknya terarsip dan daftar dimuat tanpa yang terarsip.
  // Menjatuhkannya diam-diam membuat kategori hilang dari layar sementara
  // produk di dalamnya tetap menunjuknya — merchant mencarinya dan tidak
  // menemukannya di mana pun.
  const { susunPohon } = await import(MOD);
  const pohon = susunPohon([PANAS]);
  assert.deepEqual(pohon.map((n) => n.kategori.name), ['Panas']);
});

test('⛔ induk yang menunjuk dirinya sendiri tidak membuat layar menggantung', async () => {
  // Server menolaknya (409), tapi baris seperti ini dapat lahir dari data lama
  // atau dari jalur lain. Pohon yang menyusunnya dengan rekursi naif berputar
  // selamanya dan membekukan tab.
  const { susunPohon } = await import(MOD);
  const pohon = susunPohon([{ id: 'x', name: 'X', parentId: 'x', sortOrder: 0, archivedAt: null }]);
  assert.equal(pohon.length, 1);
  assert.equal(pohon[0].kategori.name, 'X');
  assert.deepEqual(pohon[0].anak, []);
});

// --- pemilihan induk --------------------------------------------------------

test('⛔ kategori yang SUDAH punya induk tidak boleh jadi induk', async () => {
  // Itu tingkat ketiga, dan server menjawab 409. Menawarkannya di pemilih
  // berarti setiap pilihan itu gagal setelah dikirim.
  const { indukYangBoleh } = await import(MOD);
  const boleh = indukYangBoleh(SEMUA, null).map((k) => k.name);
  assert.deepEqual(boleh, ['Kopi', 'Roti']);
});

test('⛔ kategori tidak boleh jadi induk DIRINYA SENDIRI', async () => {
  // Diuji lewat "Roti" — akar TANPA anak. Memakai "Kopi" di sini akan menguji
  // dua aturan sekaligus (dirinya sendiri DAN punya-anak) dan tidak dapat
  // membedakan mana yang menyala; versi pertama test ini melakukan itu, lalu
  // menuntut hasil yang bertentangan dengan test di bawahnya.
  const { indukYangBoleh } = await import(MOD);
  assert.deepEqual(indukYangBoleh(SEMUA, 'r').map((k) => k.name), ['Kopi']);
});

test('⛔ kategori yang PUNYA ANAK tidak dapat dipindahkan ke bawah induk mana pun', async () => {
  // Memindahkan "Kopi" (punya Panas + Dingin) ke bawah "Roti" menjadikan
  // keduanya tingkat KETIGA. Server menolaknya 409; layar tidak boleh
  // menawarkan satu pun pilihan — daftarnya KOSONG, dan layar menjelaskannya.
  const { indukYangBoleh } = await import(MOD);
  assert.deepEqual(indukYangBoleh(SEMUA, 'k'), []);
});

test('kategori TERARSIP tidak ditawarkan sebagai induk', async () => {
  const { indukYangBoleh } = await import(MOD);
  const dengan = [...SEMUA, { id: 'z', name: 'Lama', parentId: null, sortOrder: 9, archivedAt: '2026-01-01T00:00:00Z' }];
  assert.ok(!indukYangBoleh(dengan, null).some((k) => k.id === 'z'));
});

test('daun tanpa anak boleh dipindahkan ke induk mana pun kecuali dirinya', async () => {
  const { indukYangBoleh } = await import(MOD);
  assert.deepEqual(indukYangBoleh(SEMUA, 'p').map((k) => k.id), ['k', 'r']);
});
