'use strict';

// Laci kas — dialog kas masuk/keluar menurut mockup.
//
// Fase 3.6 rebuild UI kasir (`docs/RENCANA-REBUILD-UI.md`). BANDING § Laci:
// mockup memilih arah lewat TOGGLE "Kas masuk / Kas keluar"; repo lewat dua
// radio di dalam fieldset, dan dialognya menggulir. Yang dikejar:
//
//   1. Arah sebagai dua tombol toggle (`aria-pressed`) dalam satu baris, 56 px
//      — memindahkan uang adalah aksi uang (DS #3); tinggi 44 px mockup ditolak
//      (#10).
//   2. Dialog tidak menggulir pada 1280×768 dan 1280×800, untuk KEDUA arah.
//
// Yang TIDAK dikejar: riwayat movement shift di samping form (fitur belum
// ada), keterangan teks bebas (alasan daftar tertutup, FR-D6).
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

async function bukaKas(tinggi) {
  const hal = await peramban.newPage({ viewport: { width: 1280, height: tinggi } });
  const galat = [];
  hal.on('pageerror', (e) => galat.push(e.message));
  await hal.goto(`${alamat}/harness-galeri.html?layar=K-03&keadaan=normal`, { waitUntil: 'load' });
  await hal.addStyleTag({
    content:
      '.galeri-bar,.galeri-tanya{display:none!important}' +
      '.galeri-panggung{padding:0!important;overflow:hidden!important}' +
      `.galeri-panggung>*{width:1280px!important;height:${tinggi}px!important;border:0!important;border-radius:0!important;box-shadow:none!important}`,
  });
  await hal.waitForSelector('.kasir-grid > *', { timeout: 10_000 });
  await hal.evaluate(() => document.fonts.ready);
  await hal.getByRole('button', { name: /Kas masuk/ }).click();
  await hal.waitForSelector('.kasir-dialog', { timeout: 10_000 });
  await hal.waitForTimeout(400);
  return { hal, galat };
}

const ukur = (hal) =>
  hal.evaluate(() => {
    const d = document.querySelector('.kasir-dialog');
    const toggle = [...d.querySelectorAll('button[aria-pressed]')].map((b) => {
      const r = b.getBoundingClientRect();
      return { teks: b.textContent.trim(), tekan: b.getAttribute('aria-pressed'), t: Math.round(r.top), h: Math.round(r.height) };
    });
    return {
      toggle,
      radioArah: d.querySelectorAll('input[name="arah-kas"]').length,
      gulir: { scroll: d.scrollHeight, client: d.clientHeight },
    };
  });

for (const tinggi of [800, 768]) {
  test(`⛔ 1280×${tinggi}: arah kas sebagai toggle 56 px sebaris, dialog tanpa gulir di kedua arah`, async (t) => {
    const { hal, galat } = await bukaKas(tinggi);
    const keluar = await ukur(hal);
    const masuk = keluar.toggle.length === 2
      ? (await hal.getByRole('button', { name: 'Kas masuk', exact: true }).click(), await hal.waitForTimeout(200), await ukur(hal))
      : null;
    await hal.close();
    t.diagnostic(JSON.stringify({ keluar, masuk }));
    assert.deepEqual(galat, []);
    assert.equal(keluar.radioArah, 0, 'arah kas masih radio');
    assert.deepEqual(keluar.toggle.map((b) => b.teks), ['Kas keluar', 'Kas masuk'], 'toggle arah tidak ada');
    assert.equal(new Set(keluar.toggle.map((b) => b.t)).size, 1, 'toggle arah tidak sebaris');
    for (const b of keluar.toggle) assert.ok(b.h >= 56, `toggle "${b.teks}" ${b.h} px — 56 px (DS #3)`);
    /* Toggle benar-benar berpindah — bukan dua tombol hiasan. */
    assert.deepEqual(keluar.toggle.map((b) => b.tekan), ['true', 'false'], 'arah bawaan bukan "keluar"');
    assert.deepEqual(masuk.toggle.map((b) => b.tekan), ['false', 'true'], 'menekan "Kas masuk" tidak memindahkan arah');
    for (const [nama, u] of [['keluar', keluar], ['masuk', masuk]]) {
      assert.ok(u.gulir.scroll <= u.gulir.client, `dialog kas ${nama} menggulir (${u.gulir.scroll} dari ${u.gulir.client} px)`);
    }
  });
}
