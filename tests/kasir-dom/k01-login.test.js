'use strict';

// K-01 — layar PIN sebagai KARTU di atas latar bertinta, menurut mockup.
//
// Fase 3.7 rebuild UI kasir (`docs/RENCANA-REBUILD-UI.md`). BANDING § K-01:
// mockup kartu 510 × 522 di tengah latar `#F0F6F7` dengan ikon gembok dan
// judul 20 px; repo tanpa kartu, judul 32 px, latar putih. Yang dikejar:
//
//   1. Kartu 510 px, permukaan `--surface` + `--shadow-card`, di atas latar
//      `--surface-sunk` (token repo — palet tetap keputusan Fase 1).
//   2. Ikon gembok, judul 20 px (`--text-title`). Bobot 600 ditolak
//      (`--weight-bold` hanya untuk `--text-display`).
//
// ⛔ Yang TIDAK boleh bergeser: ENAM titik PIN (`spec-f:122`, mockup 4 —
// ditolak) dan tombol angka ≥ 56 px (mockup 78 × 44 — tidak dikecilkan).
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

async function bukaK01(lebar) {
  const hal = await peramban.newPage({ viewport: { width: 1280, height: 800 } });
  const galat = [];
  hal.on('pageerror', (e) => galat.push(e.message));
  await hal.goto(`${alamat}/harness-galeri.html?layar=K-01&keadaan=normal`, { waitUntil: 'load' });
  if (lebar === 1280) {
    await hal.addStyleTag({
      content:
        '.galeri-bar,.galeri-tanya{display:none!important}' +
        '.galeri-panggung{padding:0!important;overflow:hidden!important}' +
        '.galeri-panggung>*{width:1280px!important;height:800px!important;border:0!important;border-radius:0!important;box-shadow:none!important}',
    });
  }
  await hal.waitForSelector('text=Masukkan PIN', { timeout: 10_000 });
  await hal.evaluate(() => document.fonts.ready);
  await hal.waitForTimeout(300);
  return { hal, galat };
}

const ukur = (hal) =>
  hal.evaluate(() => {
    const token = (nama) => {
      const e = document.createElement('div');
      e.style.background = `var(${nama})`;
      document.body.appendChild(e);
      const v = getComputedStyle(e).backgroundColor;
      e.remove();
      return v;
    };
    const login = document.querySelector('.kasir-login');
    const h1 = login.querySelector('h1');
    /* Kartu = leluhur terdekat h1 (di dalam .kasir-login) yang punya latar. */
    let kartu = null;
    for (let e = h1.parentElement; e && e !== login.parentElement; e = e.parentElement) {
      if (getComputedStyle(e).backgroundColor !== 'rgba(0, 0, 0, 0)') { kartu = e; break; }
    }
    const tombol = [...login.querySelectorAll('.kasir-keypad-grid button')].map((b) => Math.round(b.getBoundingClientRect().height));
    return {
      panggung: Math.round(document.querySelector('.galeri-panggung > *').getBoundingClientRect().width),
      judul: `${getComputedStyle(h1).fontSize}/${getComputedStyle(h1).fontWeight}`,
      kartu: kartu && {
        w: Math.round(kartu.getBoundingClientRect().width),
        latar: getComputedStyle(kartu).backgroundColor,
        bayangan: getComputedStyle(kartu).boxShadow,
        adalahLogin: kartu === login,
      },
      latarLogin: getComputedStyle(login).backgroundColor,
      ikon: Boolean(login.querySelector('svg')),
      titik: login.querySelectorAll('.kasir-pin-titik .kasir-titik').length,
      tombol,
      token: { surface: token('--surface'), sunk: token('--surface-sunk') },
    };
  });

for (const lebar of [1024, 1280]) {
  test(`⛔ ${lebar}: PIN di kartu 510 px di atas latar --surface-sunk, ikon + judul 20 px`, async (t) => {
    const { hal, galat } = await bukaK01(lebar);
    const u = await ukur(hal);
    await hal.close();
    t.diagnostic(JSON.stringify(u));
    assert.deepEqual(galat, []);
    assert.equal(u.panggung, lebar);
    assert.ok(u.kartu && !u.kartu.adalahLogin, 'tidak ada kartu di dalam layar login');
    assert.equal(u.kartu.w, 510, `kartu login ${u.kartu.w} px — mockup 510`);
    assert.equal(u.kartu.latar, u.token.surface, 'kartu bukan --surface');
    assert.notEqual(u.kartu.bayangan, 'none', 'kartu tanpa bayangan');
    assert.equal(u.latarLogin, u.token.sunk, `latar layar login ${u.latarLogin}, bukan --surface-sunk`);
    assert.ok(u.ikon, 'ikon gembok tidak ada');
    assert.equal(u.judul, '20px/500', `judul ${u.judul} — 20 px, bobot 500`);
  });

  test(`⛔ ${lebar}: ENAM titik PIN dan tombol angka >= 56 px tetap`, async () => {
    const { hal, galat } = await bukaK01(lebar);
    const u = await ukur(hal);
    await hal.close();
    assert.deepEqual(galat, []);
    assert.equal(u.titik, 6, `${u.titik} titik PIN — spec-f:122 menuntut tepat 6`);
    assert.ok(u.tombol.length >= 10, `keypad hanya ${u.tombol.length} tombol`);
    assert.ok(Math.min(...u.tombol) >= 56, `tombol angka ${Math.min(...u.tombol)} px — < 56`);
  });
}
