'use strict';

// K-03 — pemeriksaan stok FR-E4/E5 pada jalur ketukan kartu dan scan.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const AKAR = path.resolve(__dirname, '..', '..');
const DIST = path.join(AKAR, 'dist-galeri');

function chromePath() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const dasar = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (dasar && fs.existsSync(dasar)) {
    const cocok = fs
      .readdirSync(dasar)
      .filter((d) => /^chromium-\d+$/.test(d))
      .map((d) => path.join(dasar, d, 'chrome-linux', 'chrome'))
      .filter((p) => fs.existsSync(p));
    if (cocok.length > 0) return cocok[cocok.length - 1];
  }
  return undefined;
}

const JENIS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
};

let server;
let alamat;
let peramban;

before(async () => {
  /* ⛔ MENEGASKAN, bukan membangun. Lihat `k03-chrome.test.js`. */
  assert.ok(
    fs.existsSync(path.join(DIST, 'harness-galeri.html')),
    'dist-galeri/ belum dibangun. Jalankan `npm run build:galeri` lebih dulu. ' +
      '(`npm run test:kasir-dom` melakukannya sendiri lewat `pretest:kasir-dom`.)'
  );

  server = http.createServer((req, res) => {
    const nama = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const berkas = path.join(DIST, nama === '/' ? 'harness-galeri.html' : nama);
    if (!berkas.startsWith(DIST) || !fs.existsSync(berkas) || fs.statSync(berkas).isDirectory()) {
      res.writeHead(404).end('tidak ada');
      return;
    }
    res.writeHead(200, { 'content-type': JENIS[path.extname(berkas)] ?? 'application/octet-stream' });
    fs.createReadStream(berkas).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  alamat = `http://127.0.0.1:${server.address().port}`;

  const { chromium } = require('playwright');
  peramban = await chromium.launch({ executablePath: chromePath() });
});

after(async () => {
  if (peramban) await peramban.close();
  if (server) await new Promise((r) => server.close(r));
});



// S1 (sabotase independen Task 6): jalur KETUKAN KARTU dan SCAN (`pilihVariation`) tidak punya penjaga DOM —
// mengabaikan `!k.boleh` menambah barang habis / stok kurang dan 714 test tetap hijau. Fixture `?stokKetat=1`
// (`db-palsu.ts`): stok TIDAK boleh negatif; Kopi Tubruk ORIGEN ditandai HABIS; Cappuccino stok 1. Keduanya
// berbarcode. Kalimat FR-E4/E5 sama persis dengan Edit Item (`periksaTambahStok`).
//
// ## Prasyarat
//
//   npm run build:galeri

const HABIS = 'Kopi Tubruk ORIGEN ditandai habis. Manajer dapat membuka kembali penandaannya.';
const TIPIS = 'Cappuccino tersisa 1. Tidak dapat menambah lagi.';
const BARCODE_HABIS = '8992761111017';
const BARCODE_TIPIS = '8992761111024';

async function bukaK03() {
  const hal = await peramban.newPage({ viewport: { width: 1280, height: 800 } });
  const galat = [];
  hal.on('pageerror', (e) => galat.push(e.message));
  await hal.goto(`${alamat}/harness-galeri.html?layar=K-03&keadaan=normal&stokKetat=1`, { waitUntil: 'load' });
  await hal.waitForSelector('.kasir-grid > *', { timeout: 10_000 });
  // Katalog + stok + penandaan habis dibaca sebelum layar siap; `.kasir-grid` muncul sesudahnya.
  return { hal, galat };
}

const kartu = (hal, nama) => hal.locator('.kasir-grid > *', { hasText: nama }).first();
const jumlahBaris = (hal) => hal.locator('.kasir-baris').count();
const qtyBaris = (hal) => hal.locator('.kasir-baris-qty').allInnerTexts();

/** Teks pesan stok (`.kasir-login-galat` di panel keranjang) atau null dalam 2 dtk. */
const pesanStok = (hal, teks) =>
  hal
    .waitForFunction(
      (t) => [...document.querySelectorAll('.kasir-keranjang .kasir-login-galat')].some((e) => e.textContent.includes(t)),
      teks,
      { timeout: 2000 }
    )
    .then(() => true)
    .catch(() => false);

async function pindai(hal, kode) {
  // Fokus bukan di kolom teks, lalu ketik cepat + Enter (pola `usePemindaiGlobal`).
  await hal.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  for (const c of kode) await hal.keyboard.type(c, { delay: 1 });
  await hal.keyboard.press('Enter');
}

test('⛔ ketukan kartu: produk ditandai HABIS ditolak dengan kalimat habis, keranjang tidak bertambah', async () => {
  const { hal, galat } = await bukaK03();
  await kartu(hal, 'Kopi Tubruk ORIGEN').click();
  assert.ok(await pesanStok(hal, HABIS), 'ketukan kartu produk ditandai habis tidak menampilkan kalimat habis (FR-E5)');
  assert.equal(await jumlahBaris(hal), 0, 'produk ditandai HABIS masuk keranjang lewat ketukan kartu (pilihVariation mengabaikan penolakan)');
  await hal.close();
  assert.deepEqual(galat, []);
});

test('⛔ ketukan kartu: stok tipis — ketukan pertama masuk, kedua melewati stok ditolak dengan kalimat FR-E4', async () => {
  const { hal } = await bukaK03();
  await kartu(hal, 'Cappuccino').click();
  await hal.waitForSelector('.kasir-baris', { timeout: 5000 });
  assert.deepEqual(await qtyBaris(hal), ['1×'], 'kontrol: ketukan pertama (1 ≤ stok 1) harus masuk — penjaga hampa bila tidak');
  await kartu(hal, 'Cappuccino').click();
  assert.ok(await pesanStok(hal, TIPIS), 'ketukan kedua melewati stok 1 tidak menampilkan kalimat FR-E4 berangka');
  assert.deepEqual(await qtyBaris(hal), ['1×'], 'qty naik melewati stok lewat ketukan kartu (2 > 1) — pilihVariation mengabaikan penolakan');
  await hal.close();
});

test('⛔ scan barcode: produk ditandai HABIS ditolak dengan kalimat habis, keranjang tidak bertambah', async () => {
  const { hal } = await bukaK03();
  await pindai(hal, BARCODE_HABIS);
  assert.ok(await pesanStok(hal, HABIS), 'scan produk ditandai habis tidak menampilkan kalimat habis (FR-E5)');
  assert.equal(await jumlahBaris(hal), 0, 'produk ditandai HABIS masuk keranjang lewat scan');
  await hal.close();
});

test('⛔ scan barcode: stok tipis — scan pertama masuk, kedua melewati stok ditolak dengan kalimat FR-E4', async () => {
  const { hal } = await bukaK03();
  await pindai(hal, BARCODE_TIPIS);
  await hal.waitForSelector('.kasir-baris', { timeout: 5000 });
  assert.deepEqual(await qtyBaris(hal), ['1×'], 'kontrol: scan pertama (1 ≤ stok 1) harus masuk — penjaga hampa bila tidak');
  await pindai(hal, BARCODE_TIPIS);
  assert.ok(await pesanStok(hal, TIPIS), 'scan kedua melewati stok 1 tidak menampilkan kalimat FR-E4 berangka');
  assert.deepEqual(await qtyBaris(hal), ['1×'], 'qty naik melewati stok lewat scan (2 > 1)');
  await hal.close();
});
