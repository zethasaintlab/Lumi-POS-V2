'use strict';

// Cakupan galeri: setiap layar kasir di mockup punya padanan yang DAPAT
// DICAPAI dan merender isinya SENDIRI.
//
// Fase 2 rebuild UI (`docs/RENCANA-REBUILD-UI.md`). Sebelumnya delapan layar
// mockup tidak punya padanan di galeri, jadi tidak dapat dibandingkan dan
// tidak dapat dijaga. Pemetaannya di `docs/referensi-visual/BANDING.md`
// § Tanpa padanan di galeri.
//
// ⛔ Yang dijaga bukan "layarnya ada", melainkan bahwa ia merender data yang
// BENAR. Tiga cacat fixture ditemukan saat membangunnya, dan masing-masing
// punya assertion di bawah:
//   - rounding_increment 0 dan rounding_mode 'nearest' → K-07 tak tercapai
//   - fake DB mengabaikan `WHERE order_id = ?` → K-09 menampilkan pembayaran
//     order LAIN, dan order tanpa subtotal → "Subtotal Rp 0"
//   - K-01 dibungkus ShellKasir → login menampilkan bilah nav
//
// ## Prasyarat
//
//   npm run build:galeri

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


async function buka(layar, keadaan) {
  const hal = await peramban.newPage({ viewport: { width: 1280, height: 900 } });
  const galat = [];
  hal.on('pageerror', (e) => galat.push(e.message));
  await hal.goto(`${alamat}/harness-galeri.html?layar=${layar}&keadaan=${keadaan}`, { waitUntil: 'load' });
  await hal.waitForTimeout(1500);
  return { hal, galat };
}
const teks = (hal) => hal.evaluate(() => document.querySelector('.galeri-panggung').innerText.replace(/\s+/g, ' '));

test('⛔ K-01 login ada di galeri, TANPA shell — seperti App.tsx:45', async () => {
  const { hal, galat } = await buka('K-01', 'normal');
  const isi = await teks(hal);
  const nav = await hal.locator('.galeri-panggung [role="tablist"]').count();
  await hal.close();
  assert.deepEqual(galat, []);
  assert.match(isi, /Masukkan PIN/, `K-01 tidak merender layar login. Terbaca: ${isi.slice(0, 120)}`);
  assert.equal(nav, 0, 'login dirender di dalam ShellKasir — bilah nav tampil untuk kasir yang belum masuk');
});

test('⛔ K-02 buka shift merender FORM-nya, bukan "Shift sudah berjalan"', async () => {
  const { hal, galat } = await buka('K-02', 'normal');
  const isi = await teks(hal);
  const mulai = await hal.getByRole('button', { name: 'Mulai Shift' }).count();
  await hal.close();
  assert.deepEqual(galat, []);
  assert.doesNotMatch(isi, /Shift sudah berjalan/, 'fixture K-02 masih punya shift terbuka');
  assert.equal(mulai, 1, `tombol Mulai Shift tidak ada. Terbaca: ${isi.slice(0, 160)}`);
});

test('⛔ K-09 menampilkan baris dan pembayaran MILIK order-nya sendiri', async () => {
  const { hal, galat } = await buka('K-09', 'normal');
  const isi = await teks(hal);
  await hal.close();
  assert.deepEqual(galat, []);
  assert.match(isi, /K1-20260901-0001/, `K-09 tidak merender order ord-1. Terbaca: ${isi.slice(0, 120)}`);
  assert.doesNotMatch(isi, /Subtotal Rp 0\b/, 'Subtotal Rp 0 di atas Total yang bukan nol — fixture tanpa subtotal');
  /* ord-1 dibayar SATU kali (tunai Rp 54.000). Pembayaran order lain
     (Rp 27.000 QRIS, Rp 132.000 tunai) tidak boleh ikut. */
  const bayar = (isi.match(/diterima/g) ?? []).length;
  assert.equal(bayar, 1, `K-09 menampilkan ${bayar} pembayaran untuk order yang dibayar sekali — WHERE order_id diabaikan`);
});

test('⛔ K-07 dapat dicapai dari galeri: K-03 → Bayar → tunai → Simpan Penjualan', async () => {
  const { hal, galat } = await buka('K-03', 'keranjang-penuh');
  await hal.getByRole('button', { name: 'Bayar', exact: true }).click();
  await hal.waitForTimeout(600);
  for (let i = 0; i < 6; i += 1) await hal.getByRole('button', { name: '+ Rp 100.000' }).click();
  await hal.getByRole('button', { name: 'Simpan Penjualan' }).click();
  await hal.waitForTimeout(2500);
  const isi = await teks(hal);
  await hal.close();
  assert.deepEqual(galat, []);
  const tolak = isi.match(/Penjualan TIDAK tersimpan[^.]*\./);
  assert.equal(tolak, null, `penjualan galeri ditolak: ${tolak && tolak[0]}`);
  assert.match(isi, /Kembalian/, 'K-07 tidak tercapai');
  assert.match(isi, /Transaksi Baru/);
});

test('⛔ dialog yang dipetakan dapat dibuka dari galeri: modifier, refund, kas masuk/keluar, buka laci', async () => {
  const jalur = [
    ['K-03', 'normal', (h) => h.locator('.kasir-grid > button', { hasText: 'pilihan' }).first().click(), /Ukuran/],
    ['K-09', 'normal', (h) => h.getByRole('button', { name: 'Kembalikan dana' }).click(), /Kembalikan dana/],
    ['K-03', 'normal', (h) => h.getByRole('button', { name: /Kas masuk/ }).click(), /Kas masuk/],
    ['K-03', 'normal', (h) => h.getByRole('button', { name: /Buka laci/ }).click(), /Buka laci/],
  ];
  for (const [layar, keadaan, klik, harap] of jalur) {
    const { hal, galat } = await buka(layar, keadaan);
    await klik(hal);
    await hal.waitForTimeout(700);
    const n = await hal.locator('[role="dialog"]').count();
    const isi = await hal.evaluate(() => document.querySelector('[role="dialog"]')?.innerText ?? '');
    await hal.close();
    assert.deepEqual(galat, []);
    assert.equal(n, 1, `${layar}: jumlah dialog ${n}, harus 1`);
    assert.match(isi, harap, `${layar}: dialog yang terbuka bukan yang dipetakan`);
  }
});
