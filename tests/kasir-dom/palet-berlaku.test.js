'use strict';

// Palet override di `packages/ds/lumi.css` BERLAKU di halaman — diukur, bukan dibaca.
//
// `tests/runtime/palet-kontras.test.js` memeriksa nilai di BERKAS. Ia tidak
// dapat melihat apakah nilai itu yang sampai ke peramban: urutan `@import`
// yang berubah, `:root` lain yang dimuat belakangan, atau build yang tidak
// memuat `lumi.css` sama sekali, dan berkasnya tetap benar sementara layarnya
// kembali krem. Yang diukur di sini `getComputedStyle` di kelima layar galeri.
//
// Nilai harapannya dibaca dari `lumi.css` itu sendiri — satu sumber.
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


function overrideLumi() {
  const teks = fs
    .readFileSync(path.join(AKAR, 'packages/ds/lumi.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const peta = {};
  for (const blok of teks.matchAll(/:root\s*\{([^}]*)\}/g)) {
    for (const m of blok[1].matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) peta[m[1]] = m[2].toUpperCase();
  }
  return peta;
}

const LAYAR = ['K-03', 'K-08', 'K-12', 'K-14', 'K-15'];

test('⛔ setiap token warna yang ditimpa lumi.css bernilai sama di kelima layar galeri', async () => {
  const harap = overrideLumi();
  /* SENTINEL: override palet benar-benar ada untuk diperiksa. */
  assert.ok(
    ['--surface-sunk', '--surface-alt', '--border', '--ink'].every((k) => harap[k]),
    `override palet tidak ditemukan di lumi.css: ${JSON.stringify(harap)}`
  );
  const beda = [];
  for (const layar of LAYAR) {
    const hal = await peramban.newPage({ viewport: { width: 1280, height: 800 } });
    await hal.goto(`${alamat}/harness-galeri.html?layar=${layar}&keadaan=normal`, { waitUntil: 'load' });
    await hal.waitForSelector('.kasir-konten', { timeout: 10_000 });
    const nyata = await hal.evaluate((kunci) => {
      const s = getComputedStyle(document.documentElement);
      const uji = document.createElement('i');
      document.body.appendChild(uji);
      const hasil = {};
      for (const k of kunci) {
        uji.style.color = `var(${k})`;
        const [r, g, b] = getComputedStyle(uji).color.match(/\d+/g).map(Number);
        hasil[k] = { mentah: s.getPropertyValue(k).trim(), hex: '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase() };
      }
      uji.remove();
      return hasil;
    }, Object.keys(harap));
    await hal.close();
    for (const [k, v] of Object.entries(harap)) {
      if (nyata[k].hex !== v) beda.push(`${layar} ${k}: berkas ${v}, peramban ${nyata[k].hex} (${nyata[k].mentah})`);
    }
  }
  assert.deepEqual(beda, [], 'nilai token di peramban berbeda dari lumi.css');
});
