'use strict';

// K-06 — tata letak kartu pembayaran menurut mockup, di bawah sembilan
// penjaga `k06-penjaga.test.js`.
//
// Fase 3.2 rebuild UI kasir (`docs/RENCANA-REBUILD-UI.md`). Selisih "dapat
// dikejar" di `docs/referensi-visual/BANDING.md` § K-06, diukur di DOM galeri
// (overlay sungguhan di atas K-03, bukan harness tanpa shell):
//
//   1. Kartu selebar mockup, 728 px (sebelumnya 896).
//   2. Pemilih metode SATU baris (mockup: segmented satu baris), bukan 2×2.
//      Setiap tombol tetap 56 px — memilih metode adalah aksi uang (DS #3);
//      tab 44 px mockup ditolak (#10).
//   3. Total 32 px (`--text-display`), label 20 px. Letaknya TETAP di blok aksi
//      yang menempel: P9 menjaga Total di sana, dan angka yang ditagih duduk
//      di samping tombol yang menagihnya. Mockup menaruhnya di atas — ditolak.
//   4. Aksi utama di kanan bawah, bukan selebar kartu (mockup 198×56); aksi
//      sekunder di baris yang sama, di kiri.
//
// ## Prasyarat
//
//   npm run build:galeri
//
// Lihat kepala `k03-chrome.test.js` untuk alasan berkas ini menegaskan
// `dist-galeri` alih-alih membangunnya.

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

const LEBAR_MOCKUP = 728;

/* Pola `k03-kepadatan.test.js`: `lebar` 1024 = panggung galeri asli,
   1280 = panggung dilepas ke 1280×800. */
async function bukaK06(lebar) {
  const hal = await peramban.newPage({ viewport: { width: 1280, height: 800 } });
  const galat = [];
  hal.on('pageerror', (e) => galat.push(e.message));
  await hal.route('**/health', (r) => r.fulfill({ status: 200, body: 'ok' }));
  await hal.goto(`${alamat}/harness-galeri.html?layar=K-03&keadaan=keranjang-penuh`, { waitUntil: 'load' });
  if (lebar === 1280) {
    await hal.addStyleTag({
      content:
        '.galeri-bar,.galeri-tanya{display:none!important}' +
        '.galeri-panggung{padding:0!important;overflow:hidden!important}' +
        '.galeri-panggung>*{width:1280px!important;height:800px!important;border:0!important;border-radius:0!important;box-shadow:none!important}',
    });
  }
  await hal.waitForSelector('.kasir-grid > *', { timeout: 10_000 });
  await hal.evaluate(() => document.fonts.ready);
  await hal.waitForTimeout(800);
  await hal.getByRole('button', { name: 'Bayar', exact: true }).click();
  await hal.waitForSelector('.kasir-bayar-aksi', { timeout: 10_000 });
  await hal.waitForTimeout(600);
  return { hal, galat };
}

async function ukur(hal) {
  return hal.evaluate(() => {
    const r = (e) => {
      const x = e.getBoundingClientRect();
      return { l: Math.round(x.left), t: Math.round(x.top), r: Math.round(x.right), w: Math.round(x.width), h: Math.round(x.height) };
    };
    const panggung = r(document.querySelector('.galeri-panggung > *'));
    const dialog = document.querySelector('.overlay .dialog');
    const aksi = document.querySelector('.kasir-bayar-aksi');
    const metode = [...document.querySelectorAll('.kasir-bayar-isi .kasir-pecahan')][0];
    const tot = aksi.querySelector('.kasir-total');
    const gaya = (e) => (e ? `${getComputedStyle(e).fontSize}/${getComputedStyle(e).fontWeight}` : null);
    const primer = aksi.querySelector('.btn-primary');
    const kembali = [...aksi.querySelectorAll('.btn')].find((b) => b.textContent.trim() === 'Kembali');
    return {
      panggung,
      dialog: r(dialog),
      metode: [...metode.querySelectorAll('.btn')].map((b) => ({ nama: b.textContent.trim(), ...r(b) })),
      totalLabel: gaya(tot?.firstElementChild),
      totalNilai: gaya(tot?.querySelector('.num')),
      aksi: r(aksi),
      primer: primer && { teks: primer.textContent.trim(), ...r(primer) },
      kembali: kembali && r(kembali),
    };
  });
}

// ---------------------------------------------------------------------------

for (const lebar of [1024, 1280]) {
  test(`⛔ ${lebar}: kartu pembayaran ${LEBAR_MOCKUP} px, metode SATU baris 56 px`, async (t) => {
    const { hal, galat } = await bukaK06(lebar);
    const u = await ukur(hal);
    await hal.close();
    t.diagnostic(JSON.stringify(u));
    assert.deepEqual(galat, []);
    /* SENTINEL: panggung selebar yang diklaim, dan keempat metode dirender. */
    assert.equal(u.panggung.w, lebar);
    assert.deepEqual(
      u.metode.map((m) => m.nama),
      ['Tunai', 'QRIS', 'QRIS statis', 'Kartu (EDC)'],
      'pemilih metode tidak memuat keempat metode'
    );
    assert.equal(u.dialog.w, Math.min(LEBAR_MOCKUP, lebar), `kartu pembayaran ${u.dialog.w} px — mockup ${LEBAR_MOCKUP}`);
    const puncak = new Set(u.metode.map((m) => m.t));
    assert.equal(puncak.size, 1, `pemilih metode ${puncak.size} baris — mockup satu baris`);
    for (const m of u.metode) {
      assert.ok(m.h >= 56, `tombol metode "${m.nama}" ${m.h} px — aksi uang 56 px (DS #3)`);
    }
  });

  test(`⛔ ${lebar}: Total 32 px di blok aksi; aksi utama di kanan bawah, sebaris dengan Kembali`, async () => {
    const { hal, galat } = await bukaK06(lebar);
    const u = await ukur(hal);
    await hal.close();
    assert.deepEqual(galat, []);
    assert.equal(u.totalNilai, '32px/700', `nilai Total ${u.totalNilai} — mockup 32 px, bobot 700 (skala 32/20/15/13)`);
    assert.equal(u.totalLabel, '20px/600', `label Total ${u.totalLabel} (skala 32/20/15/13)`);
    assert.ok(u.primer && u.primer.teks === 'Simpan Penjualan', 'aksi utama tidak ditemukan di blok aksi');
    assert.ok(u.primer.h >= 56, `aksi utama ${u.primer.h} px — 56 px (DS #3)`);
    assert.equal(u.primer.r, u.aksi.r, 'aksi utama tidak menempel di tepi kanan blok aksi');
    assert.ok(u.primer.w < u.aksi.w / 2, `aksi utama ${u.primer.w} px dari ${u.aksi.w} — mockup tidak selebar kartu`);
    assert.ok(u.kembali, 'tombol Kembali hilang');
    assert.equal(u.kembali.t, u.primer.t, 'Kembali tidak sebaris dengan aksi utama');
    assert.ok(u.kembali.l < u.primer.l, 'Kembali tidak di kiri aksi utama');
  });
}
