'use strict';

// K-03 — tombol Bayar berada di tempat yang SAMA berapa pun isi keranjangnya.
//
// ## ⛔ Cacat yang penjaga ini tutup
//
// Pembandingan dengan mockup (`docs/referensi-visual/BANDING.md`, 23 September
// 2026) mengukur Bayar di y=728 saat keranjang berisi, dan di **y=370** saat
// keranjang kosong — 358 px lebih tinggi. Daftar item memakai `flex: 1` dan
// mendorong blok ringkasan ke dasar panel; keadaan kosong tidak, jadi
// Subtotal dan Bayar naik ke tengah panel tepat pada keadaan yang dilihat
// kasir di awal setiap pesanan.
//
// ⛔ Tidak ada penjaga yang pernah melihatnya. Skenario galeri
// `keranjang-penuh` MENANYAKAN apakah Bayar tetap di posisi yang sama "seperti
// saat keranjang berisi tiga baris", tapi tidak satu pun test mengukurnya,
// dan tidak satu pun pertanyaan menyebut nol. Titik yang tidak diukur adalah
// titik tempat cacatnya tinggal.
//
// ## Tiga titik, bukan dua
//
// 0 (keadaan kosong), 3 (daftar lebih pendek dari panelnya), 20 (daftar lebih
// panjang dari panelnya dan menggulir). Masing-masing menempuh jalur tata
// letak yang berbeda; dua titik mana pun dapat sepakat sementara yang ketiga
// menyimpang.
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

async function bukaK03(keadaan) {
  const hal = await peramban.newPage({ viewport: { width: 1280, height: 800 } });
  const galat = [];
  hal.on('pageerror', (e) => galat.push(e.message));
  await hal.goto(`${alamat}/harness-galeri.html?layar=K-03&keadaan=${keadaan}`, { waitUntil: 'load' });
  await hal.waitForSelector('.kasir-konten', { timeout: 10_000 });
  await hal.waitForTimeout(1200);
  return { hal, galat };
}

/** Posisi Bayar RELATIF terhadap panggung galeri, plus isi keranjangnya. */
async function ukur(hal) {
  return hal.evaluate(() => {
    const panggung = document.querySelector('.galeri-panggung > *').getBoundingClientRect();
    const panel = document.querySelector('.kasir-keranjang');
    const bayar = [...panel.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Bayar');
    const r = bayar ? bayar.getBoundingClientRect() : null;
    const total = [...panel.querySelectorAll('.kasir-total')][0];
    const alasanId = bayar ? bayar.getAttribute('aria-describedby') : null;
    const alasan = alasanId ? document.getElementById(alasanId) : null;
    return {
      baris: panel.querySelectorAll('.kasir-baris').length,
      bayar: r && { y: Math.round(r.top - panggung.top), h: Math.round(r.height), bawah: Math.round(r.bottom - panggung.top) },
      bayarNonaktif: bayar ? bayar.disabled : null,
      bayarTerlihat: r ? r.width > 0 && r.height > 0 && getComputedStyle(bayar).visibility !== 'hidden' : false,
      totalAda: Boolean(total),
      alasan: alasan ? alasan.textContent.replace(/\s+/g, ' ').trim() : null,
    };
  });
}

/** Tiga item lewat ketukan kartu — hanya kartu tanpa varian ("pilihan"). */
async function isiTiga(hal) {
  const kartu = hal.locator('.kasir-grid > button').filter({ hasNotText: /pilihan/ });
  for (let i = 0; i < 3; i += 1) {
    await kartu.nth(i).click();
    await hal.waitForTimeout(250);
  }
  await hal.waitForTimeout(600);
}

// ---------------------------------------------------------------------------

test('⛔ tombol Bayar di posisi yang SAMA pada 0, 3, dan 20 item', async (t) => {
  const kosong = await bukaK03('normal');
  const u0 = await ukur(kosong.hal);
  await isiTiga(kosong.hal);
  const u3 = await ukur(kosong.hal);
  await kosong.hal.close();

  const penuh = await bukaK03('keranjang-penuh');
  const u20 = await ukur(penuh.hal);
  await penuh.hal.close();

  t.diagnostic(`0 item: ${JSON.stringify(u0.bayar)} · 3 item: ${JSON.stringify(u3.bayar)} · 20 item: ${JSON.stringify(u20.bayar)}`);
  assert.deepEqual([...kosong.galat, ...penuh.galat], [], 'galat halaman');

  /* ⛔ SENTINEL: ketiga titik benar-benar tercapai. Tanpa ini "posisinya sama"
     dapat berarti tiga pengukuran atas keadaan yang sama. */
  assert.deepEqual(
    [u0.baris, u3.baris, u20.baris],
    [0, 3, 20],
    'isi keranjang tidak sampai ke ketiga titik ukur (0, 3, 20)'
  );
  for (const [n, u] of [[0, u0], [3, u3], [20, u20]]) {
    assert.ok(u.bayar && u.bayarTerlihat, `tombol Bayar tidak terlihat pada ${n} item`);
  }

  assert.equal(
    u0.bayar.y,
    u3.bayar.y,
    `titik 0: Bayar di y=${u0.bayar.y}, sedangkan dengan 3 item di y=${u3.bayar.y} — ` +
      `melompat ${u3.bayar.y - u0.bayar.y} px saat keranjang kosong.`
  );
  assert.equal(
    u20.bayar.y,
    u3.bayar.y,
    `titik 20: Bayar di y=${u20.bayar.y}, sedangkan dengan 3 item di y=${u3.bayar.y}.`
  );
});

test('⛔ keranjang kosong: Bayar NONAKTIF dengan alasan yang terbaca, dan blok Total tetap ada', async () => {
  const { hal, galat } = await bukaK03('normal');
  const u = await ukur(hal);
  await hal.close();
  assert.deepEqual(galat, [], 'galat halaman');

  assert.equal(u.baris, 0, 'skenario `normal` seharusnya berkeranjang kosong');
  assert.ok(u.bayarTerlihat, 'Bayar HILANG saat keranjang kosong — ia harus tetap ada, nonaktif');
  assert.equal(u.bayarNonaktif, true, 'Bayar dapat ditekan pada keranjang kosong');
  /* `aria-describedby` → elemen yang ADA dan berisi kalimat. Tombol nonaktif
     tanpa alasan terbaca sebagai aplikasi yang macet. */
  assert.ok(
    u.alasan && /keranjang/i.test(u.alasan),
    `Bayar nonaktif tanpa alasan yang terhubung (aria-describedby). Terbaca: ${JSON.stringify(u.alasan)}`
  );
  assert.ok(u.totalAda, 'baris Total hilang saat keranjang kosong — blok ringkasan berubah bentuk');
});
