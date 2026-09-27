'use strict';

// Wordmark "LumiPOS" (Task 8, kampanye "Hidupkan desain") — penjaga DOM.
//
// ## ⛔ Kenapa DOM, bukan cukup baca `Wordmark.tsx`
//
// Tiga hal tidak dapat dibuktikan dari kode sumber saja:
//
//   1. `.wordmark-ikon` benar-benar 36×36 dengan latar `--primary` DAN
//      radius `--radius-control` — nilai token dapat menyimpang dari
//      `lumi.css` ke browser lewat urutan import yang salah, kelas yang sama
//      dengan yang `palet-berlaku.test.js` ada untuk menangkap.
//   2. `<svg>` di dalam kotak itu memang node Lucide `store`, bukan ikon lain
//      yang kebetulan dirender di posisi yang sama — dibandingkan atribut
//      `d` dengan `packages/ds/ikon-data.ts`, sama seperti
//      `ikon-bundle.test.js`.
//   3. Teks "Lumi POS" (dengan spasi) TIDAK ADA di mana pun di DOM galeri
//      kasir — ia satu-satunya tempat string itu pernah dirender (lihat
//      `ShellKasir.tsx` lama), dan sabotase yang mengembalikannya harus
//      tertangkap di SETIAP layar berselubung `ShellKasir`, bukan hanya K-03.
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

// Node Lucide `store` — dibaca dari sumbernya, bukan ditulis ulang. Kalau
// `ikon-data.ts` berubah (mis. Lucide dinaikkan versi), pembanding ikut.
const { NODES } = require(path.join(AKAR, 'packages/ds/ikon-data.ts'));
const PATH_STORE = NODES.store.filter(([tag]) => tag === 'path').map(([, attrs]) => attrs.d);
assert.ok(PATH_STORE.length > 0, 'ikon-data.ts tidak punya node `store` — periksa sumber pembanding.');

let server;
let alamat;
let peramban;

before(async () => {
  /* ⛔ MENEGASKAN, bukan membangun. Lihat `k03-chrome.test.js` § kenapa. */
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

async function bukaLayar(id) {
  const hal = await peramban.newPage({ viewport: { width: 1280, height: 800 } });
  const galat = [];
  hal.on('console', (m) => {
    /* ⛔ Kegagalan probe keterjangkauan (K-14) BUKAN galat — sama persis
       dengan saringan di `k14-keadaan.test.js`. K-14 menembak
       `<baseUrl>/health` ke port yang sengaja menolak koneksi di galeri;
       penjaga ini tidak menguji K-14 sama sekali, jadi kegagalan MEMUAT
       SUMBER itu tidak boleh menolak test wordmark. */
    if (m.type() === 'error' && /Failed to load resource/.test(m.text())) return;
    if (m.type() === 'error') galat.push(m.text());
  });
  await hal.goto(`${alamat}/harness-galeri.html?layar=${id}&keadaan=normal`, { waitUntil: 'load' });
  await hal.waitForSelector('.galeri-panggung', { timeout: 10_000 });
  await hal.waitForFunction(
    () => (document.querySelector('.galeri-panggung')?.textContent ?? '').trim().length > 0,
    { timeout: 10_000 }
  );
  await hal.waitForTimeout(300);
  return { hal, galat };
}

// Setiap layar galeri yang dirender DI DALAM `ShellKasir` (§ 3 "Wordmark
// dipakai di ShellKasir") — bukan hanya K-03. `K-01` dan `fondasi` sengaja
// TIDAK ikut: keduanya `tanpaShell` (`Galeri.tsx`), jadi tidak ada
// `ShellKasir` dan karenanya tidak ada `.wordmark` di sana sama sekali —
// itu bukan hal yang penjaga ini uji.
const LAYAR_BERSHELL = ['K-03', 'K-02', 'K-08', 'K-09', 'K-12', 'K-14', 'K-15'];

test('⛔ .wordmark-teks berbunyi "LumiPOS", 20px bobot 600 (K-03)', async () => {
  const { hal, galat } = await bukaLayar('K-03');
  const ukur = await hal.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    const el = document.querySelector('.wordmark-teks');
    if (!el) return { ada: false };
    const cs = getComputedStyle(el);
    return {
      ada: true,
      teks: el.textContent,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      tokenUkuran: s.getPropertyValue('--text-title').trim(),
      tokenBobot: s.getPropertyValue('--weight-medium').trim(),
    };
  });
  await hal.close();

  assert.equal(galat.length, 0, `galat konsol saat memuat K-03: ${galat.join(' | ')}`);
  assert.ok(ukur.ada, '.wordmark-teks tidak ada di DOM K-03.');
  assert.equal(ukur.teks, 'LumiPOS', `.wordmark-teks berbunyi "${ukur.teks}", harap "LumiPOS".`);
  assert.equal(
    ukur.fontSize,
    ukur.tokenUkuran,
    `.wordmark-teks font-size ${ukur.fontSize}, harap ${ukur.tokenUkuran} (--text-title).`
  );
  assert.equal(
    ukur.fontWeight,
    ukur.tokenBobot,
    `.wordmark-teks font-weight ${ukur.fontWeight}, harap ${ukur.tokenBobot} (--weight-medium, 20px bobot 600).`
  );
});

test('⛔ .wordmark-ikon 36×36, latar --primary, radius --radius-control, berisi svg node `store` (K-03)', async () => {
  const { hal, galat } = await bukaLayar('K-03');
  const ukur = await hal.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    const kotak = document.querySelector('.wordmark-ikon');
    if (!kotak) return { ada: false };
    const cs = getComputedStyle(kotak);
    const rect = kotak.getBoundingClientRect();
    const svg = kotak.querySelector('svg');
    // Bandingkan background-color TERHITUNG dengan `--primary` terhitung —
    // bukan hex mentah, supaya urutan import token yang salah (kelas cacat
    // yang sama dengan `palet-berlaku.test.js`) ikut tertangkap. Diukur di
    // evaluate YANG SAMA — halaman ditutup segera sesudah ini.
    const probe = document.createElement('div');
    probe.style.color = 'var(--primary)';
    document.body.appendChild(probe);
    const primaryRgb = getComputedStyle(probe).color;
    probe.remove();
    return {
      ada: true,
      lebar: Math.round(rect.width),
      tinggi: Math.round(rect.height),
      backgroundColor: cs.backgroundColor,
      borderRadius: cs.borderRadius,
      tokenRadiusControl: s.getPropertyValue('--radius-control').trim(),
      svgAda: !!svg,
      pathD: svg ? [...svg.querySelectorAll('path')].map((p) => p.getAttribute('d')) : [],
      primaryRgb,
    };
  });
  await hal.close();

  assert.equal(galat.length, 0, `galat konsol saat memuat K-03: ${galat.join(' | ')}`);
  assert.ok(ukur.ada, '.wordmark-ikon tidak ada di DOM K-03.');
  assert.equal(ukur.lebar, 36, `.wordmark-ikon lebar ${ukur.lebar}px, harap 36.`);
  assert.equal(ukur.tinggi, 36, `.wordmark-ikon tinggi ${ukur.tinggi}px, harap 36.`);

  assert.equal(
    ukur.backgroundColor,
    ukur.primaryRgb,
    `.wordmark-ikon background-color ${ukur.backgroundColor}, harap sama dengan --primary (${ukur.primaryRgb}).`
  );

  assert.equal(
    ukur.borderRadius,
    ukur.tokenRadiusControl,
    `.wordmark-ikon border-radius ${ukur.borderRadius}, harap ${ukur.tokenRadiusControl} (--radius-control, 10px).`
  );

  assert.ok(ukur.svgAda, '.wordmark-ikon tidak berisi <svg> apa pun.');
  assert.deepEqual(
    ukur.pathD,
    PATH_STORE,
    `<svg> di dalam .wordmark-ikon bukan node Lucide \`store\` — path yang dirender: ` +
      `${JSON.stringify(ukur.pathD)}, harap ${JSON.stringify(PATH_STORE)}.`
  );
});

test('⛔ teks "Lumi POS" (dengan spasi) tidak ada di mana pun di DOM galeri kasir', async () => {
  const ditemukan = [];
  for (const id of LAYAR_BERSHELL) {
    const { hal, galat } = await bukaLayar(id);
    const teks = await hal.evaluate(() => document.body.innerText);
    const judul = await hal.title();
    await hal.close();
    if (galat.length > 0) ditemukan.push(`${id}: galat konsol ${galat.join(' | ')}`);
    if (/Lumi POS/.test(teks)) ditemukan.push(`${id}: body.innerText memuat "Lumi POS"`);
    if (/Lumi POS/.test(judul)) ditemukan.push(`${id}: <title> memuat "Lumi POS" ("${judul}")`);
  }
  assert.equal(
    ditemukan.length,
    0,
    'Teks "Lumi POS" (dengan spasi) masih ada di galeri:\n' + ditemukan.join('\n')
  );
});
