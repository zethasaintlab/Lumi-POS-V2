'use strict';

// K-08 — riwayat sebagai TABEL dalam kartu, dengan judul halaman.
//
// Fase 3.9 rebuild UI kasir (`docs/RENCANA-REBUILD-UI.md`). BANDING § K-08:
// mockup "Riwayat transaksi" 20 px + subjudul, tabel dalam kartu dengan kepala
// kolom, baris 61 px; repo tanpa judul, daftar tanpa kartu, baris 48 px.
// Yang dikejar:
//
//   1. Judul halaman 20 px + subjudul, juga pada keadaan kosong.
//   2. Daftar di dalam kartu (`--surface` + bayangan) dengan kepala kolom
//      Waktu · Nomor struk · Total · Status — Waktu PERTAMA, seperti mockup.
//   3. Baris ≥ 60 px.
//   4. Kosong: kalimatnya di DALAM kartu, judul tetap tampil.
//
// ⛔ Yang TIDAK: nomor `TRX-…` (#9), status tunggal "Selesai" (status turun
// dari rantai koreksi + status kirim), kolom Item dan Metode (data baris
// belum dibaca K-08), penyaring tanggal/metode (fitur belum ada).
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

async function bukaK08(keadaan) {
  const hal = await peramban.newPage({ viewport: { width: 1280, height: 800 } });
  const galat = [];
  hal.on('pageerror', (e) => galat.push(e.message));
  await hal.goto(`${alamat}/harness-galeri.html?layar=K-08&keadaan=${keadaan}`, { waitUntil: 'load' });
  await hal.waitForSelector('.kasir-konten', { timeout: 10_000 });
  await hal.evaluate(() => document.fonts.ready);
  await hal.waitForTimeout(1000);
  return { hal, galat };
}

const ukur = (hal) =>
  hal.evaluate(() => {
    const konten = document.querySelector('.kasir-konten');
    const h1 = konten.querySelector('h1');
    const baris = [...konten.querySelectorAll('.kasir-riwayat-baris')];
    const kartuDari = (e) => {
      for (let x = e?.parentElement; x && x !== konten; x = x.parentElement) {
        const c = getComputedStyle(x);
        if (c.boxShadow !== 'none' && c.backgroundColor !== 'rgba(0, 0, 0, 0)') return x;
      }
      return null;
    };
    const kepala = konten.querySelector('.kasir-riwayat-kepala');
    const kosong = konten.querySelector('.empty');
    const pertama = baris[0];
    const sel = pertama ? [...pertama.children].filter((c) => c.textContent.trim() !== '') : [];
    return {
      judul: h1 ? { teks: h1.textContent.trim(), ukuran: getComputedStyle(h1).fontSize } : null,
      baris: baris.map((b) => Math.round(b.getBoundingClientRect().height)),
      barisDiKartu: pertama ? Boolean(kartuDari(pertama)) : null,
      kepala: kepala ? [...kepala.children].map((c) => c.textContent.trim()).filter(Boolean) : null,
      selPertama: sel.map((c) => c.textContent.trim()),
      kosongDiKartu: kosong ? Boolean(kartuDari(kosong)) : null,
    };
  });

test('⛔ K-08 normal: judul 20 px, tabel dalam kartu, kepala kolom, Waktu pertama, baris >= 60 px', async (t) => {
  const { hal, galat } = await bukaK08('normal');
  const u = await ukur(hal);
  await hal.close();
  t.diagnostic(JSON.stringify(u));
  assert.deepEqual(galat, []);
  assert.ok(u.baris.length >= 3, 'riwayat galeri tanpa baris — penjaga hampa');
  assert.deepEqual(u.judul, { teks: 'Riwayat transaksi', ukuran: '20px' }, `judul halaman: ${JSON.stringify(u.judul)}`);
  assert.equal(u.barisDiKartu, true, 'baris riwayat tidak di dalam kartu');
  assert.deepEqual(u.kepala, ['Waktu', 'Nomor struk', 'Total', 'Status'], `kepala kolom: ${JSON.stringify(u.kepala)}`);
  assert.match(u.selPertama[0] ?? '', /^\d{2}[.:]\d{2}$/, `sel pertama bukan jam: ${JSON.stringify(u.selPertama)}`);
  assert.ok(Math.min(...u.baris) >= 60, `baris riwayat ${Math.min(...u.baris)} px — mockup 61`);
});

test('⛔ K-08 kosong: judul tetap tampil, kalimat kosong di dalam kartu', async () => {
  const { hal, galat } = await bukaK08('kosong');
  const u = await ukur(hal);
  await hal.close();
  assert.deepEqual(galat, []);
  assert.equal(u.baris.length, 0, 'keadaan kosong punya baris');
  assert.equal(u.judul?.teks, 'Riwayat transaksi', 'judul hilang pada keadaan kosong');
  assert.equal(u.kosongDiKartu, true, 'kalimat kosong tidak di dalam kartu');
});
