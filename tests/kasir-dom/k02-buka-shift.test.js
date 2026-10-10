'use strict';

// K-02 — buka shift sebagai KARTU dua kolom, menurut mockup.
//
// Fase 3.8 rebuild UI kasir (`docs/RENCANA-REBUILD-UI.md`). BANDING § K-02:
// mockup kartu 624 × 384 dengan ikon dan subjudul, dua kolom field, "Mulai
// Shift" di kanan bawah; repo satu kolom terpusat tanpa kartu. Yang dikejar:
//
//   1. Kartu 624 px (`--surface` + bayangan) dengan ikon.
//   2. Dua kolom: kolom "Saldo awal kas" (awalan Rp, 56 px, nilai bebas)
//      di kiri, "Staf pembuka" sebagai TEKS di kanan — diambil dari sesi,
//      bukan field yang dapat diubah. Keputusan user 28 September 2026
//      (#76): tombol pecahan DIHAPUS, kolom bebas menggantikannya.
//   3. "Mulai Shift" 56 px di kanan bawah kartu.
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

async function bukaK02(lebar) {
  const hal = await peramban.newPage({ viewport: { width: 1280, height: 800 } });
  const galat = [];
  hal.on('pageerror', (e) => galat.push(e.message));
  await hal.goto(`${alamat}/harness-galeri.html?layar=K-02&keadaan=normal`, { waitUntil: 'load' });
  if (lebar === 1280) {
    await hal.addStyleTag({
      content:
        '.galeri-bar,.galeri-tanya{display:none!important}' +
        '.galeri-panggung{padding:0!important;overflow:hidden!important}' +
        '.galeri-panggung>*{width:1280px!important;height:800px!important;border:0!important;border-radius:0!important;box-shadow:none!important}',
    });
  }
  await hal.waitForSelector('text=Mulai Shift', { timeout: 10_000 });
  await hal.evaluate(() => document.fonts.ready);
  await hal.waitForTimeout(300);
  return { hal, galat };
}

const ukur = (hal) =>
  hal.evaluate(() => {
    const r = (e) => {
      const x = e.getBoundingClientRect();
      return { l: Math.round(x.left), t: Math.round(x.top), r: Math.round(x.right), w: Math.round(x.width), h: Math.round(x.height) };
    };
    const h1 = [...document.querySelectorAll('.kasir-konten h1')].find((h) => h.textContent.trim() === 'Buka Shift');
    let kartu = null;
    for (let e = h1?.parentElement; e && !e.classList.contains('kasir-konten'); e = e.parentElement) {
      if (getComputedStyle(e).boxShadow !== 'none' && getComputedStyle(e).backgroundColor !== 'rgba(0, 0, 0, 0)') { kartu = e; break; }
    }
    const semua = kartu ? [...kartu.querySelectorAll('*')] : [];
    const label = semua.find((e) => e.tagName === 'LABEL' && e.textContent.trim() === 'Saldo awal kas');
    const kolom = label && document.getElementById(label.htmlFor);
    const staf = semua.find((e) => e.children.length === 0 && e.textContent.trim() === 'Staf pembuka');
    const mulai = kartu && [...kartu.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Mulai Shift');
    const tombolPecahan = kartu ? [...kartu.querySelectorAll('button')].filter((b) => b.textContent.trim().startsWith('+')) : [];
    const token = (nama) => {
      const e = document.createElement('div');
      e.style.background = `var(${nama})`;
      document.body.appendChild(e);
      const v = getComputedStyle(e).backgroundColor;
      e.remove();
      return v;
    };
    return {
      panggung: Math.round(document.querySelector('.galeri-panggung > *').getBoundingClientRect().width),
      kartu: kartu && r(kartu),
      ikon: Boolean(kartu?.querySelector('svg')),
      kolom: kolom && r(kolom),
      staf: staf && r(staf),
      teksKartu: kartu?.innerText.replace(/\s+/g, ' ') ?? '',
      mulai: mulai && r(mulai),
      jumlahPecahan: tombolPecahan.length,
      padding: kartu ? parseFloat(getComputedStyle(kartu).paddingRight) : 0,
      latarLayar: kartu ? getComputedStyle(kartu.parentElement).backgroundColor : null,
      sunk: token('--surface-sunk'),
    };
  });

for (const lebar of [1024, 1280]) {
  test(`⛔ ${lebar}: buka shift di kartu 624 px dua kolom, Mulai Shift di kanan bawah`, async (t) => {
    const { hal, galat } = await bukaK02(lebar);
    const u = await ukur(hal);
    await hal.close();
    t.diagnostic(JSON.stringify(u));
    assert.deepEqual(galat, []);
    assert.equal(u.panggung, lebar);
    assert.ok(u.kartu, 'buka shift tidak di dalam kartu');
    assert.equal(u.kartu.w, 624, `kartu ${u.kartu.w} px — mockup 624`);
    assert.ok(u.ikon, 'kartu tanpa ikon');
    assert.ok(u.staf, '"Staf pembuka" tidak tampil');
    assert.match(u.teksKartu, /Staf pembuka Kasir Galeri/, 'nama staf pembuka bukan dari sesi');
    assert.ok(u.kolom, 'kolom "Saldo awal kas" tidak ada (keputusan user 28 September 2026, #76: kolom bebas, bukan tombol pecahan)');
    assert.ok(u.staf.l > u.kolom.r, 'Staf pembuka tidak berdampingan dengan kolom Saldo awal kas');
    assert.ok(u.kolom.h >= 56, `kolom Saldo awal kas ${u.kolom.h} px — aksi menyangkut uang 56`);
    assert.equal(u.jumlahPecahan, 0, 'tombol pecahan "+ Rp …" masih ada — keputusan user 28 September 2026 (#76) menghapusnya');
    /* Kartu putih di atas layar putih tidak terlihat sebagai kartu. */
    assert.equal(u.latarLayar, u.sunk, 'latar di belakang kartu bukan --surface-sunk');
    assert.ok(u.mulai && u.mulai.h >= 56, 'Mulai Shift hilang atau < 56 px');
    assert.equal(u.mulai.r, Math.round(u.kartu.r - u.padding), 'Mulai Shift tidak di tepi kanan kartu');
    assert.ok(u.mulai.w < u.kartu.w / 2, 'Mulai Shift selebar kartu');
  });
}
