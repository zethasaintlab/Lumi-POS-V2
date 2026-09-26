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
// (permukaan kartu), `.kasir-konten`/`.galeri-panggung` (permukaan area
// konten — lihat § Ronde perbaikan 1). Warna lencana TIDAK diperiksa: ia
// bergantung pada kulit komponen Task 9.
//
// ## ⛔ Ronde perbaikan 1 (sabotase independen, lihat task-2-report.md)
//
// F1b — sabotase `@media (max-width: 1100px) { :root { --primary: #b94747; } }`
// TIDAK terlihat oleh penjaga ini sebelumnya: hanya viewport 1280×800 yang
// diukur, dan media query dengan ambang 1100px tidak pernah berlaku di sana.
// 1024×768 adalah lebar tablet kasir yang DITETAPKAN `IA:62` (penjaga
// `k03-chrome.test.js` sudah mengukur di lebar ini) — penjaga ini sekarang
// mengukur di KEDUA viewport, bukan hanya 1280×800.
//
// F4 — hanya elemen PERTAMA yang cocok `.btn-primary`/`.card` yang terukur
// (`document.querySelector`), dan hanya `body` sebagai permukaan halaman.
// Warna hover, `.btn-primary` kedua/di dialog, dan latar area KONTEN
// (`.kasir-konten`) bisa berganti token tanpa ketahuan — dibuktikan lewat
// sabotase S9/S14 pada laporan sabotase independen. Diperbaiki:
// `querySelectorAll` untuk SETIAP elemen yang cocok pada selektor yang
// diukur, ditambah pemeriksaan latar `.kasir-konten` dan panggung galeri
// `.galeri-panggung` terhadap `--background` mockup.
//
// ⛔ Batas yang dinyatakan (S9, sabotase independen): `.btn-primary:hover`,
// `.dialog .btn-primary`, dan `.btn-primary ~ .btn-primary` TIDAK tertangkap
// oleh `querySelectorAll` — diverifikasi dengan menjalankan sabotase itu
// sungguhan setelah perbaikan ini: penjaga tetap hijau. Ketiganya menuntut
// KEADAAN yang potret statis "keadaan normal" tidak pernah punya: hover
// disimulasikan, dialog dibuka, atau dua `.btn-primary` bertetangga langsung
// di DOM. Ini bukan lubang yang tertutup oleh `querySelectorAll` — laporan
// sabotase sendiri menandainya "batas cakupan, bukan hampa murni". Menutupnya
// menuntut mensimulasikan interaksi (hover/dialog), di luar lingkup ronde
// perbaikan ini.
//
// ⛔ `.kasir-konten`/`.galeri-panggung` TIDAK menyetel `background-color`
// eksplisit pada pohon yang bersih — keduanya TRANSPARAN dan membiarkan
// warna `body` di baliknya terlihat (diukur: `rgba(0, 0, 0, 0)` pada kelima
// layar). Itu SAH: transparan berarti "tidak menimpa" permukaan di
// baliknya, yang secara visual tetap `--background`. Yang TIDAK sah adalah
// nilai OPAK selain `--background` — itu yang S14 buktikan (kedua selektor
// diganti `var(--kat-4-soft)`, warna kategori plum). `HARAP` untuk kedua
// selektor ini karena itu menerima DUA nilai: transparan, ATAU `--background`
// — bukan hanya satu, supaya pohon bersih tetap hijau sekaligus S14 tetap
// merah.
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

/** `background-color` bawaan CSS untuk elemen yang tidak menyetelnya sendiri. */
const TRANSPARAN = 'rgba(0, 0, 0, 0)';

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
  /* ⛔ Ditambah Ronde perbaikan 1, F4 — lihat komentar berkas di atas. Nilai
     yang diterima array: TRANSPARAN (bawaan, sah) ATAU `--background` mockup
     — bukan hanya satu, supaya pohon bersih (transparan) tetap hijau
     sekaligus sabotase yang mengganti latar ke warna lain (S14) tetap merah. */
  '.kasir-konten': { backgroundColor: [TRANSPARAN, tokenRgb('--background')] },
  '.galeri-panggung': { backgroundColor: [TRANSPARAN, tokenRgb('--background')] },
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
  /* `.kasir-konten` opsional di sini: `fondasi` dirender `tanpaShell` (sama
     seperti K-01), jadi tidak ada `ShellKasir` dan tidak ada `.kasir-konten`
     sama sekali — diverifikasi lewat pengukuran DOM (lihat laporan task).
     `.card` DIKECUALIKAN (bukan sekadar opsional) — lihat `kecualikan`. */
  { id: 'fondasi', opsional: ['.btn-primary', '.kasir-konten'], kecualikan: ['.card'] },
];

/**
 * `.galeri-panggung`, bukan `.kasir-konten`: `fondasi` dirender `tanpaShell`
 * (sama seperti K-01), dan `.kasir-konten` hanya ada di dalam `ShellKasir`.
 * `.galeri-panggung` ada pada KEDUA jalur render galeri.
 */
async function bukaLayar(peramban, alamat, id, viewport) {
  const hal = await peramban.newPage({ viewport });
  await hal.goto(`${alamat}/harness-galeri.html?layar=${id}&keadaan=normal`, { waitUntil: 'load' });
  await hal.waitForSelector('.galeri-panggung', { timeout: 10_000 });
  await hal.waitForFunction(
    () => (document.querySelector('.galeri-panggung')?.textContent ?? '').trim().length > 0,
    { timeout: 10_000 }
  );
  await hal.waitForTimeout(300);
  return hal;
}

/**
 * Dua viewport, diukur KEDUANYA (F1b): 1280×800 (ukuran galeri lama) dan
 * 1024×768 — lebar tablet kasir yang ditetapkan `IA:62`. Sabotase yang hanya
 * berlaku di bawah suatu ambang `@media` (mis. `max-width: 1100px`) tidak
 * pernah terlihat pada 1280×800 saja.
 */
const VIEWPORT = [
  { width: 1280, height: 800 },
  { width: 1024, height: 768 },
];

test('⛔ palet mockup berlaku di getComputedStyle, di kelima layar galeri, di kedua viewport', async () => {
  const beda = [];
  let selektorDiperiksa = 0;

  for (const viewport of VIEWPORT) {
    for (const { id, opsional, kecualikan } of LAYAR) {
      const hal = await bukaLayar(peramban, alamat, id, viewport);
      const hasil = await hal.evaluate((selektorList) => {
        const keluar = {};
        for (const sel of selektorList) {
          const elList = sel === 'body' ? [document.body] : Array.from(document.querySelectorAll(sel));
          keluar[sel] = elList.map((el) => {
            const s = getComputedStyle(el);
            return { color: s.color, backgroundColor: s.backgroundColor, borderColor: s.borderColor };
          });
        }
        return keluar;
      }, Object.keys(HARAP));
      await hal.close();

      const label = `${id} @${viewport.width}x${viewport.height}`;

      for (const [sel, properti] of Object.entries(HARAP)) {
        /* ⛔ `kecualikan` (BUKAN `opsional`): `fondasi` mengecualikan `.card`
           sepenuhnya — halaman ini adalah GALERI TOKEN warna itu sendiri
           (`Fondasi.tsx`), dan swatch warnanya SENGAJA menimpa `background`
           per token lewat inline style (`className="card"` dipakai ulang
           sebagai bingkai netral, bukan sebagai "permukaan kartu"). Setiap
           swatch yang backgroundnya BUKAN `--card` adalah bukti token itu
           BEKERJA, bukan pelanggaran — memeriksanya di sini akan menandai
           68 elemen yang justru sengaja berwarna-warni sebagai "pelanggaran
           palet". `opsional` tidak cukup di sini: elemennya ADA (136 di
           antaranya), hanya semantiknya yang berbeda dari layar produk. */
        if (kecualikan?.includes(sel)) continue;
        const elemenList = hasil[sel];
        if (elemenList.length === 0) {
          if (opsional.includes(sel)) continue;
          beda.push(`${label} ${sel}: elemen tidak ditemukan (bukan opsional untuk layar ini)`);
          continue;
        }
        /* ⛔ F4: SETIAP elemen yang cocok diperiksa, bukan hanya yang pertama —
           `.btn-primary` kedua (mis. di dialog), atau `.card` di luar
           pandangan pertama, bisa memakai token lain tanpa ketahuan bila
           hanya elemen [0] yang terukur. */
        elemenList.forEach((nyata, idx) => {
          for (const [prop, nilaiHarap] of Object.entries(properti)) {
            selektorDiperiksa += 1;
            /* Nilai harapan bisa SATU string, atau ARRAY beberapa nilai yang
               sah (mis. `.kasir-konten`: transparan ATAU `--background`). */
            const daftarSah = Array.isArray(nilaiHarap) ? nilaiHarap : [nilaiHarap];
            if (!daftarSah.includes(nyata[prop])) {
              beda.push(
                `${label} ${sel}[${idx}] ${prop}: harap ${daftarSah.join(' atau ')}, peramban ${nyata[prop]}`
              );
            }
          }
        });
      }
    }
  }

  /* ⛔ SENTINEL: penjaga harus benar-benar memindai sesuatu. Lima layar × dua
     viewport × tiga properti — jauh di bawah jumlah nyata supaya selektor
     yang hilang dari satu layar tidak mematikan penjaganya. */
  assert.ok(selektorDiperiksa >= 20, `hanya ${selektorDiperiksa} pasangan selektor/properti terukur — galeri mungkin gagal memuat`);

  assert.deepEqual(beda, [], 'palet mockup tidak berlaku sesuai harapan di peramban:\n  ' + beda.join('\n  '));
});
