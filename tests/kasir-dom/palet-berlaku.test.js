'use strict';

// Palet mockup BERLAKU di halaman — diukur, bukan dibaca.
//
// ## ⛔ Kenapa penjaga ini ada
//
// `tests/runtime/nol-hex-css.test.js` dan `tests/runtime/palet-kontras.test.js`
// memeriksa nilai di BERKAS. Keduanya tidak dapat melihat apakah nilai itu
// yang sungguh sampai ke peramban: urutan `@import` yang terbalik, `:root`
// lain yang dimuat belakangan dan menimpanya, atau pengarahan yang lupa
// ditulis — berkasnya tetap benar sementara layarnya kembali ke warna lama.
//
// Adaptasi dari `git show d20e814:tests/kasir-dom/palet-berlaku.test.js`
// (PR #60, tidak di-merge) — rangka server statis + Chromium dipertahankan;
// mekanisme pembandingnya ditulis ulang mengikuti Task 2 Step 2: nilai
// pembanding dibaca dari `tokens-mockup.css` (bukan dari hex yang di-scan di
// `lumi.css`, karena Task 2 mengarahkan nama bundle lewat `var()`, bukan
// menyalin ulang nilainya sebagai hex).
//
// Selektor: `body` (G4 — permukaan halaman), `.btn-primary` (G4, pengganti
// invarian aksen `#0D5C63` lama — aksen kini `--primary` mockup), `.card`
// (permukaan kartu). Warna lencana TIDAK diperiksa: ia bergantung pada kulit
// komponen Task 9.
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
const MOCKUP = path.join(AKAR, 'packages/ds/tokens-mockup.css');

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

/** Nilai hex `--nama:` di blok `:root` teratas suatu berkas token. */
function bacaRootHex(berkasAbsolut) {
  const teks = fs.readFileSync(berkasAbsolut, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const peta = {};
  for (const blok of teks.matchAll(/:root\s*\{([^}]*)\}/g)) {
    for (const m of blok[1].matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) peta[m[1]] = m[2].toUpperCase();
  }
  return peta;
}

function hexKeRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgb(${r}, ${g}, ${b})`;
}

const TOKEN = bacaRootHex(MOCKUP);
function tokenRgb(nama) {
  assert.ok(TOKEN[nama], `token ${nama} tidak ditemukan di tokens-mockup.css`);
  return hexKeRgb(TOKEN[nama]);
}

/**
 * Nilai yang HARUS berlaku di peramban, per selektor.
 *
 * ⛔ Dikonversi dari `tokens-mockup.css`, tidak diketik ulang — kalau
 * mockup-nya diperbarui, ekspektasi test ikut, bukan menyimpang diam-diam.
 */
const HARAP = {
  body: { color: tokenRgb('--foreground'), backgroundColor: tokenRgb('--background') },
  '.btn-primary': { backgroundColor: tokenRgb('--primary'), color: tokenRgb('--primary-foreground') },
  /* ⛔ `borderColor` ditambah di luar tiga properti Step 2 — DITEMUKAN lewat
     sabotase (Step 7 #1: `tokens-mockup.css` dipindah sebelum token bundle).
     `--accent`/`--primary` TERBUKTI kebal terhadap sabotase itu: lumi.css
     mengarahkan `--accent: var(--primary)` secara EKSPLISIT, dan lumi.css
     SELALU diimpor paling akhir apa pun urutan tokens-mockup vs bundle —
     jadi `.btn-primary` tidak pernah merah lewat sabotase ini. `--border`
     BERBEDA: nama yang SAMA PERSIS di mockup dan bundle tidak dapat diarahkan
     eksplisit tanpa referensi sirkuler (lihat komentar lumi.css), jadi nilai
     efektifnya MURNI bergantung pada urutan `@import` — persis yang sabotase
     ini balikkan. Tanpa baris ini, `palet-berlaku` HAMPA terhadap regresi
     yang paling mudah dilakukan orang berikutnya: menukar urutan dua baris
     `@import`. */
  '.card': { backgroundColor: tokenRgb('--card'), borderColor: tokenRgb('--border') },
};

/**
 * Kelima layar galeri yang bagian ini ukur, dan selektor yang OPSIONAL untuk
 * masing-masing — diukur di browser (bukan dibaca dari markup), lihat
 * laporan task untuk bukti pengukurannya.
 */
const LAYAR = [
  { id: 'K-03', opsional: ['.card'] },
  { id: 'K-08', opsional: ['.btn-primary'] },
  { id: 'K-12', opsional: ['.card'] },
  { id: 'K-14', opsional: ['.card'] },
  { id: 'fondasi', opsional: ['.btn-primary'] },
];

/**
 * `.galeri-panggung`, bukan `.kasir-konten`: `fondasi` dirender `tanpaShell`
 * (sama seperti K-01), dan `.kasir-konten` hanya ada di dalam `ShellKasir`.
 * `.galeri-panggung` ada pada KEDUA jalur render galeri.
 */
async function bukaLayar(peramban, alamat, id) {
  const hal = await peramban.newPage({ viewport: { width: 1280, height: 800 } });
  await hal.goto(`${alamat}/harness-galeri.html?layar=${id}&keadaan=normal`, { waitUntil: 'load' });
  await hal.waitForSelector('.galeri-panggung', { timeout: 10_000 });
  await hal.waitForFunction(
    () => (document.querySelector('.galeri-panggung')?.textContent ?? '').trim().length > 0,
    { timeout: 10_000 }
  );
  await hal.waitForTimeout(300);
  return hal;
}

test('⛔ palet mockup berlaku di getComputedStyle, di kelima layar galeri', async () => {
  const beda = [];
  let selektorDiperiksa = 0;

  for (const { id, opsional } of LAYAR) {
    const hal = await bukaLayar(peramban, alamat, id);
    const hasil = await hal.evaluate((selektorList) => {
      const keluar = {};
      for (const sel of selektorList) {
        const el = sel === 'body' ? document.body : document.querySelector(sel);
        if (!el) {
          keluar[sel] = null;
          continue;
        }
        const s = getComputedStyle(el);
        keluar[sel] = { color: s.color, backgroundColor: s.backgroundColor, borderColor: s.borderColor };
      }
      return keluar;
    }, Object.keys(HARAP));
    await hal.close();

    for (const [sel, properti] of Object.entries(HARAP)) {
      const nyata = hasil[sel];
      if (nyata === null) {
        if (opsional.includes(sel)) continue;
        beda.push(`${id} ${sel}: elemen tidak ditemukan (bukan opsional untuk layar ini)`);
        continue;
      }
      for (const [prop, nilai] of Object.entries(properti)) {
        selektorDiperiksa += 1;
        if (nyata[prop] !== nilai) {
          beda.push(`${id} ${sel} ${prop}: harap ${nilai}, peramban ${nyata[prop]}`);
        }
      }
    }
  }

  /* ⛔ SENTINEL: penjaga harus benar-benar memindai sesuatu. Lima layar × tiga
     properti (body 2 + btn-primary 2 + card 1, minus yang opsional) — jauh di
     bawah jumlah nyata supaya selektor yang hilang dari satu layar tidak
     mematikan penjaganya. */
  assert.ok(selektorDiperiksa >= 10, `hanya ${selektorDiperiksa} pasangan selektor/properti terukur — galeri mungkin gagal memuat`);

  assert.deepEqual(beda, [], 'palet mockup tidak berlaku sesuai harapan di peramban:\n  ' + beda.join('\n  '));
});
