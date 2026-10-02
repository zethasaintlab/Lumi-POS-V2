'use strict';

// K-06 — tata letak kartu pembayaran menurut mockup, di bawah sembilan
// penjaga `k06-penjaga.test.js`.
//
// Task 8 (PR 2B, kampanye Hidupkan desain, spec § 7): K-06 menjadi HALAMAN di
// dalam shell — kartu pembayaran bertoggle menurut mockup `Payment`
// (`docs/referensi-visual/BANDING.md` § K-06), diukur di DOM galeri (K-03 →
// Bayar, `Kasir.tsx` sungguhan di dalam `ShellKasir`), bukan harness.
//
//   1. Kartu 728 px (mockup). "Kembali ke kasir" di ATAS kartu, bukan di
//      bilah aksi.
//   2. Segmented empat tab (Tunai · QRIS · Kartu · Transfer), tinggi 40 px,
//      dalam wadah `--secondary`. Tampil 40, area tekan 56 (`.sentuh-uang`).
//   3. Isi metode ≥ 355 px (min-h mockup).
//   4. Aksi utama "Konfirmasi bayar" 56 px di kanan bawah kartu.
//   5. Header tetap terlihat; grid K-03 tidak ada di DOM (K-03 di-unmount).
//
// Keputusan yang MEMBALIK penjaga lama (dinyatakan, bukan diam-diam): metode 56
// px satu baris → segmented 40 px (mockup menang atas "tab 40 px ditolak #10";
// area tekannya tetap 56); Total di blok aksi → di blok atas (P9).
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
      return { l: Math.round(x.left), t: Math.round(x.top), r: Math.round(x.right), b: Math.round(x.bottom), w: Math.round(x.width), h: Math.round(x.height) };
    };
    const probe = (nama) => {
      const e = document.createElement('div');
      e.style.background = `var(${nama})`;
      document.body.appendChild(e);
      const v = getComputedStyle(e).backgroundColor;
      e.remove();
      return v;
    };
    const kartu = document.querySelector('.kasir-bayar-kartu');
    const tab = document.querySelector('.kasir-bayar-tab');
    const isi = document.querySelector('.kasir-bayar-isi');
    const aksi = document.querySelector('.kasir-bayar-aksi');
    const primer = aksi?.querySelector('.btn-primary');
    const kembali = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Kembali ke kasir');
    return {
      panggung: r(document.querySelector('.galeri-panggung > *')),
      kartu: kartu && r(kartu),
      tab: tab && { ...r(tab), latar: getComputedStyle(tab).backgroundColor },
      tombolTab: tab ? [...tab.querySelectorAll('button')].map((b) => ({ nama: b.textContent.trim(), sentuh: b.classList.contains('sentuh-uang'), ...r(b) })) : [],
      isi: isi && { ...r(isi), gulir: isi.scrollHeight },
      aksi: aksi && r(aksi),
      primer: primer && { teks: primer.textContent.trim(), ...r(primer) },
      kembali: kembali && r(kembali),
      secondary: probe('--secondary'),
      /* ⛔ TERLIHAT, bukan sekadar ada di DOM: overlay lama `position: fixed`
         menutup header yang tetap ter-mount di bawahnya. Yang diukur adalah
         elemen yang menjawab di titik tengah header. */
      header: (() => {
        const h = document.querySelector('.kasir-header');
        if (!h) return false;
        const x = h.getBoundingClientRect();
        const di = document.elementFromPoint(x.left + 12, x.top + x.height / 2);
        return !!di && !!di.closest('.kasir-header');
      })(),
      dalamOverlay: !!kartu?.closest('.overlay'),
      gridK03: !!document.querySelector('.kasir-grid'),
    };
  });
}

// ---------------------------------------------------------------------------

for (const lebar of [1024, 1280]) {
  test(`⛔ ${lebar}: kartu ${LEBAR_MOCKUP} px, segmented empat tab 40 px dalam wadah --secondary, isi metode ≥ 355`, async (t) => {
    const { hal, galat } = await bukaK06(lebar);
    const u = await ukur(hal);
    await hal.close();
    t.diagnostic(JSON.stringify(u));
    assert.deepEqual(galat, []);
    /* SENTINEL: panggung selebar yang diklaim, dan kartunya dirender. */
    assert.equal(u.panggung.w, lebar);
    assert.ok(u.kartu, 'kartu pembayaran (.kasir-bayar-kartu) tidak dirender');
    assert.ok(Math.abs(u.kartu.w - Math.min(LEBAR_MOCKUP, lebar)) <= 2, `kartu pembayaran ${u.kartu.w} px — mockup ${LEBAR_MOCKUP} (±2)`);

    assert.ok(u.tab, 'segmented metode (.kasir-bayar-tab) tidak dirender');
    assert.deepEqual(
      u.tombolTab.map((m) => m.nama),
      ['Tunai', 'QRIS', 'Kartu', 'Transfer'],
      'segmented tidak memuat keempat tab'
    );
    assert.equal(new Set(u.tombolTab.map((m) => m.t)).size, 1, 'tab metode tidak satu baris');
    for (const m of u.tombolTab) {
      assert.ok(Math.abs(m.h - 40) <= 1, `tab "${m.nama}" ${m.h} px — mockup 40`);
      assert.equal(m.sentuh, true, `tab "${m.nama}" tanpa .sentuh-uang — area tekan 56 px (DS #3, aksi uang)`);
    }
    assert.equal(u.tab.latar, u.secondary, `wadah segmented ${u.tab.latar}, bukan --secondary (${u.secondary})`);
    assert.ok(u.isi.h >= 355, `isi metode ${u.isi.h} px — mockup min 355`);
  });

  test(`⛔ ${lebar}: "Konfirmasi bayar" 56 px di kanan bawah kartu; "Kembali ke kasir" di atas kartu`, async () => {
    const { hal, galat } = await bukaK06(lebar);
    const u = await ukur(hal);
    await hal.close();
    assert.deepEqual(galat, []);
    assert.ok(u.primer && u.primer.teks === 'Konfirmasi bayar', `aksi utama bukan "Konfirmasi bayar": ${u.primer?.teks}`);
    assert.ok(u.primer.h >= 56, `aksi utama ${u.primer.h} px — 56 px (DS #3)`);
    assert.ok(u.primer.w < u.aksi.w / 2, `aksi utama ${u.primer.w} px dari ${u.aksi.w} — mockup tidak selebar kartu`);
    assert.ok(u.kartu.r - u.primer.r <= 24, `aksi utama tidak di tepi kanan kartu (jarak ${u.kartu.r - u.primer.r})`);
    assert.ok(u.kartu.b - u.primer.b <= 24, `aksi utama tidak di dasar kartu (jarak ${u.kartu.b - u.primer.b})`);
    assert.ok(u.kembali, '"Kembali ke kasir" hilang');
    assert.ok(u.kembali.b <= u.kartu.t, `"Kembali ke kasir" (bawah ${u.kembali.b}) tidak di atas kartu (atas ${u.kartu.t})`);
    assert.ok(u.kembali.h >= 44, `"Kembali ke kasir" ${u.kembali.h} px — minimal 44`);
  });

  test(`⛔ ${lebar}: header TETAP terlihat selama K-06 (halaman di dalam shell); grid K-03 tidak ada`, async () => {
    const { hal, galat } = await bukaK06(lebar);
    const u = await ukur(hal);
    await hal.close();
    assert.deepEqual(galat, []);
    assert.ok(u.kartu, 'K-06 tidak tampil — penjaga ini hampa');
    assert.equal(u.header, true, 'header (.kasir-header) tertutup selama K-06 — K-06 masih overlay yang menutup shell');
    assert.equal(u.dalamOverlay, false, 'kartu K-06 masih di dalam .overlay — bukan halaman di dalam shell');
    assert.equal(u.gridK03, false, 'grid K-03 masih di DOM selama K-06 — usePemindaiGlobal tetap hidup di belakang pembayaran');
  });
}
