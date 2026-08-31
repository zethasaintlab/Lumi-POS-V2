'use strict';

// Warna kategori produk — diturunkan dari nama, bukan disimpan sebagai kolom.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../packages/domain/src/warna-kategori.ts';

test('kategori yang sama selalu mendapat warna yang sama', async () => {
  const { gayaKategori } = await import(MOD);
  // Stabil lintas aplikasi: kasir dan back-office tidak menyepakati apa pun,
  // jadi satu-satunya yang membuat "Kopi" sewarna di keduanya adalah fungsi ini.
  assert.deepEqual(gayaKategori('Kopi'), gayaKategori('Kopi'));
  assert.deepEqual(gayaKategori('Kopi'), gayaKategori('  kopi  '));
});

test('⛔ daftar ≤ 6 kategori TIDAK PERNAH menghasilkan dua warna yang sama', async () => {
  // ⛔ CACAT YANG DITEMUKAN DENGAN MENGUKUR, BUKAN MEMBACA.
  //
  // Versi pertama hanya meng-hash nama ke enam slot. Diperiksa di browser
  // terhadap data seed berisi empat kategori, dan "Makanan" mendarat di warna
  // yang SAMA dengan "Kopi". Bukan nasib buruk — empat benda ke enam laci
  // bertabrakan pada ~70% kemungkinan (masalah ulang tahun).
  //
  // Dua kategori sewarna membatalkan seluruh alasan warna kategori ada.
  const { gayaKategori } = await import(MOD);
  const daftar = ['Kopi', 'Non-Kopi', 'Makanan', 'Pastry'];
  const warna = daftar.map((n) => gayaKategori(n, daftar)['--chip']);
  assert.equal(new Set(warna).size, daftar.length, `warna bertabrakan: ${warna.join(', ')}`);
});

test('⛔ property: setiap daftar sampai 6 kategori bebas tabrakan', async () => {
  // Bukan satu contoh yang kebetulan lolos. Seratus daftar acak.
  const { gayaKategori, JUMLAH_SLOT_KATEGORI } = await import(MOD);
  for (let iter = 0; iter < 100; iter += 1) {
    const n = 1 + (iter % JUMLAH_SLOT_KATEGORI);
    const daftar = Array.from({ length: n }, (_, i) => `Kat${iter}_${i}_${Math.random()}`);
    const warna = daftar.map((x) => gayaKategori(x, daftar)['--chip']);
    assert.equal(new Set(warna).size, n, `tabrakan pada n=${n}: ${warna.join(', ')}`);
  }
});

test('kategori yang TIDAK ada di daftar tetap berwarna (arsip)', async () => {
  // Kategori yang diarsipkan masih muncul di riwayat penjualan lama.
  const { gayaKategori } = await import(MOD);
  const g = gayaKategori('Kategori Lama', ['Kopi', 'Pastry']);
  assert.match(g['--chip'], /^var\(--kat-[1-6]\)$/);
});

test('nama kosong stabil, bukan hash kebetulan', async () => {
  const { gayaKategori, slotKategori } = await import(MOD);
  assert.equal(slotKategori(''), 1);
  assert.equal(slotKategori('   '), 1);
  assert.deepEqual(gayaKategori(''), gayaKategori('  '));
});

test('⛔ slot selalu di dalam 1..6 — token di luar itu tidak ada di colors.css', async () => {
  const { slotKategori, JUMLAH_SLOT_KATEGORI } = await import(MOD);
  for (let i = 0; i < 500; i += 1) {
    const s = slotKategori(`kategori-${i}-${Math.random()}`);
    assert.ok(s >= 1 && s <= JUMLAH_SLOT_KATEGORI, `slot di luar rentang: ${s}`);
    assert.equal(Number.isInteger(s), true);
  }
});
