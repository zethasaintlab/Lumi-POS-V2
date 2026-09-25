'use strict';

// K-10 — dialog refund DUA KOLOM, tanpa gulir.
//
// Fase 3.5 rebuild UI kasir (`docs/RENCANA-REBUILD-UI.md`). BANDING § K-10:
// mockup menaruh form dan "Transaksi asli" berdampingan dengan bilah aksi di
// bawah; repo satu kolom 448 px yang menggulir (768 dari 895 px). Yang
// dikejar adalah yang membuat gulir itu hilang: dua kolom — alasan di kiri,
// barang dan jumlah yang kembali di kanan — dan bilah aksi selebar dialog.
//
// ⛔ Void TETAP satu kolom sempit. Isinya hanya alasan; dialog lebar dengan
// kolom kanan kosong adalah ruang yang tidak menjelaskan apa pun.
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

/* Overlay `position: fixed` mengikuti VIEWPORT, jadi yang diuji tinggi
   viewport: 800 (tablet 1280×800) dan 768 (panggung `PRD:428`). */
async function bukaRefund(tinggi) {
  const hal = await peramban.newPage({ viewport: { width: 1280, height: tinggi } });
  const galat = [];
  hal.on('pageerror', (e) => galat.push(e.message));
  await hal.goto(`${alamat}/harness-galeri.html?layar=K-09&keadaan=normal`, { waitUntil: 'load' });
  await hal.addStyleTag({
    content:
      '.galeri-bar,.galeri-tanya{display:none!important}' +
      '.galeri-panggung{padding:0!important;overflow:hidden!important}' +
      `.galeri-panggung>*{width:1280px!important;height:${tinggi}px!important;border:0!important;border-radius:0!important;box-shadow:none!important}`,
  });
  await hal.waitForSelector('text=Kembalikan dana', { timeout: 10_000 });
  await hal.evaluate(() => document.fonts.ready);
  await hal.getByRole('button', { name: 'Kembalikan dana' }).click();
  await hal.waitForSelector('.kasir-dialog', { timeout: 10_000 });
  await hal.waitForTimeout(500);
  return { hal, galat };
}

async function ukur(hal) {
  return hal.evaluate(() => {
    const r = (e) => {
      const x = e.getBoundingClientRect();
      return { l: Math.round(x.left), t: Math.round(x.top), r: Math.round(x.right), b: Math.round(x.bottom), w: Math.round(x.width), h: Math.round(x.height) };
    };
    const d = document.querySelector('.kasir-dialog');
    const fs = [...d.querySelectorAll('fieldset')];
    const legenda = (t) => fs.find((f) => f.querySelector('legend')?.textContent.trim() === t);
    const alasan = legenda('Alasan');
    const barang = legenda('Barang yang kembali');
    const aksi = d.querySelector('.kasir-dialog-aksi');
    const tombol = aksi ? [...aksi.querySelectorAll('button')].map((b) => ({ teks: b.textContent.trim(), ...r(b) })) : [];
    return {
      dialog: r(d),
      gulir: { scroll: d.scrollHeight, client: d.clientHeight },
      alasan: alasan && r(alasan),
      barang: barang && r(barang),
      aksi: aksi && r(aksi),
      tombol,
    };
  });
}

for (const tinggi of [800, 768]) {
  test(`⛔ 1280×${tinggi}: refund dua kolom tanpa gulir, bilah aksi selebar dialog`, async (t) => {
    const { hal, galat } = await bukaRefund(tinggi);
    const u = await ukur(hal);
    await hal.close();
    t.diagnostic(JSON.stringify(u));
    assert.deepEqual(galat, []);
    /* SENTINEL: dialog REFUND dengan pemilihan barang benar-benar terbuka. */
    assert.ok(u.alasan && u.barang, 'dialog refund tanpa fieldset Alasan dan Barang yang kembali');
    assert.ok(
      u.gulir.scroll <= u.gulir.client,
      `dialog refund menggulir (${u.gulir.scroll} dari ${u.gulir.client} px) — mockup tidak`
    );
    assert.ok(u.barang.l > u.alasan.r, 'Barang yang kembali tidak berdampingan dengan Alasan');
    assert.ok(u.aksi.w >= u.barang.r - u.alasan.l - 1, 'bilah aksi tidak selebar kedua kolom');
    const kembalikan = u.tombol.find((b) => b.teks === 'Kembalikan dana');
    assert.ok(kembalikan && kembalikan.h >= 56, 'aksi Kembalikan dana hilang atau < 56 px');
    assert.equal(kembalikan.r, u.aksi.r, 'aksi utama tidak di kanan bilah aksi');
  });
}
