'use strict';

// K-12 tahap REVIEW — dua kartu berdampingan, menurut mockup.
//
// Fase 3.10 rebuild UI kasir (`docs/RENCANA-REBUILD-UI.md`). BANDING § K-12:
// "Dua kartu berdampingan … dapat dikejar: tata letak dua kartu cocok untuk
// tahap `review`". Rincian saldo di kartu kiri, selisih + alasan di kartu
// kanan.
//
// ⛔ HANYA tahap `review`. Tahap `hitung` tetap hitungan buta (FR-D2,
// `k12-hitungan-buta.test.js`): mockup menaruh rekonsiliasi dan input di satu
// layar sekaligus, dan itu ditolak (#7). Aksi tetap di slot bilah nav
// (`k12-aksi-slot.test.js`).
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

/* Hitungan jauh dari saldo seharusnya — selisih melewati ambang, keenam radio
   alasan tampil: review yang PALING penuh (pola `k12-aksi-slot`). */
async function bukaReview(keadaan) {
  const hal = await peramban.newPage({ viewport: { width: 1280, height: 800 } });
  const galat = [];
  hal.on('pageerror', (e) => galat.push(e.message));
  await hal.goto(`${alamat}/harness-galeri.html?layar=K-12&keadaan=${keadaan}`, { waitUntil: 'load' });
  await hal.waitForSelector('.kasir-konten', { timeout: 10_000 });
  await hal.waitForTimeout(1200);
  const bidang = hal.getByLabel(/hitungan fisik/i);
  await bidang.waitFor({ state: 'visible', timeout: 5_000 });
  await bidang.fill('300000');
  await hal.getByRole('button', { name: 'Lanjut' }).click();
  await hal.waitForTimeout(1000);
  return { hal, galat };
}

const ukur = (hal) =>
  hal.evaluate(() => {
    const konten = document.querySelector('.kasir-konten');
    const kartuDari = (e) => {
      for (let x = e?.parentElement; x && x !== konten; x = x.parentElement) {
        const c = getComputedStyle(x);
        if (c.boxShadow !== 'none' && c.backgroundColor !== 'rgba(0, 0, 0, 0)') return x;
      }
      return null;
    };
    const cari = (teks) => [...konten.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent.trim() === teks);
    const diharapkan = cari('Kas diharapkan');
    const selisih = konten.querySelector('.kasir-selisih');
    const alasan = [...konten.querySelectorAll('legend')].find((l) => l.textContent.trim() === 'Alasan selisih');
    const kiri = kartuDari(diharapkan);
    const kanan = kartuDari(selisih);
    const r = (e) => e && (({ left, right, top }) => ({ l: Math.round(left), r: Math.round(right), t: Math.round(top) }))(e.getBoundingClientRect());
    return {
      ada: { diharapkan: Boolean(diharapkan), selisih: Boolean(selisih), alasan: Boolean(alasan) },
      kiri: r(kiri),
      kanan: r(kanan),
      berbeda: kiri !== null && kanan !== null && kiri !== kanan,
      alasanDiKanan: Boolean(alasan && kanan && kanan.contains(alasan)),
    };
  });

for (const keadaan of ['normal', 'offline']) {
  test(`⛔ ${keadaan}: review dalam dua kartu — rincian kiri, selisih + alasan kanan`, async (t) => {
    const { hal, galat } = await bukaReview(keadaan);
    const u = await ukur(hal);
    await hal.close();
    t.diagnostic(JSON.stringify(u));
    assert.deepEqual(galat, []);
    /* SENTINEL: review yang PENUH benar-benar tercapai. */
    assert.deepEqual(u.ada, { diharapkan: true, selisih: true, alasan: true }, 'tahap review penuh tidak tercapai');
    assert.ok(u.kiri, 'rincian saldo tidak di dalam kartu');
    assert.ok(u.kanan, 'panel selisih tidak di dalam kartu');
    assert.ok(u.berbeda, 'rincian dan selisih berada di kartu yang SAMA');
    assert.ok(u.kanan.l > u.kiri.r, 'kartu selisih tidak di kanan kartu rincian');
    assert.equal(u.kanan.t, u.kiri.t, 'kedua kartu tidak sejajar di atas');
    assert.ok(u.alasanDiKanan, 'alasan selisih tidak di kartu kanan');
  });
}
