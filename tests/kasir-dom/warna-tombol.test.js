'use strict';

// Teks di dalam `<button>` layar kasir tidak memakai warna bawaan PERAMBAN.
//
// ## ⛔ Kenapa penjaga ini ada
//
// Stylesheet peramban memberi `<button>` warna `buttontext` (hitam murni,
// `#000000`), dan `color` elemen form TIDAK diwarisi dari induknya seperti
// elemen biasa. `ds-bundle/base.css` menyetel `body { color: var(--ink) }` dan
// berhenti di situ. Setiap tombol yang tidak menyetel `color` sendiri
// — `.product-card` di antaranya — merender teksnya `#000`, bukan `--ink`
// (`#14110F`).
//
// Ditemukan 23 September 2026 lewat pembandingan dengan mockup
// (`docs/referensi-visual/BANDING.md`): nama dan harga kartu K-03, 15 + 15
// elemen. Kelas yang SAMA dengan margin `<p>` (`margin-paragraf.test.js`):
// bawaan peramban yang tidak pernah di-reset, tanpa satu pun error.
//
// ## ⛔ Kenapa pembandingnya tombol REFERENSI, bukan konstanta `#000`
//
// Warna bawaan peramban dibaca dari `<button>` di dalam iframe `srcdoc` tanpa
// satu pun stylesheet penulis — keadaan aktif DAN nonaktif, karena peramban
// memberi tombol nonaktif warna bawaannya sendiri. Konstanta yang diketik
// akan salah diam-diam begitu peramban mengubah nilai bawaannya.
//
// ⛔ Satu keterbatasan yang dinyatakan: tombol yang SENGAJA diwarnai dengan
// nilai yang kebetulan sama persis dengan bawaan peramban akan ditandai.
// Tidak ada token repo yang bernilai `#000000` (`ds-bundle/tokens/colors.css`),
// jadi hari ini itu tidak dapat terjadi.
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

/**
 * Kelima layar galeri, dengan skenario yang merender tombol terbanyak.
 * K-03 dua kali: `normal` punya kartu produk, `keranjang-penuh` punya stepper.
 */
const SEL = [
  ['K-03', 'normal'],
  ['K-03', 'keranjang-penuh'],
  ['K-08', 'normal'],
  ['K-12', 'normal'],
  ['K-14', 'offline'],
  ['K-15', 'normal'],
];

/**
 * Jumlah teks-dalam-tombol minimum yang harus benar-benar terukur.
 *
 * ⛔ Tanpa ini penjaga hijau pada galeri yang gagal memuat: nol tombol berarti
 * nol pelanggaran. Diukur 23 September 2026: 206 teks di dalam tombol pada
 * keenam pemilihan di atas, 60 di antaranya teks `.product-card`. Dipasang
 * jauh di bawahnya supaya tombol yang dihapus dari satu layar tidak mematikan
 * penjaganya.
 */
const MINIMAL_TEKS = 100;

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

/**
 * Setiap teks di dalam `<button>` panggung galeri, dengan warnanya dan warna
 * bawaan peramban untuk keadaan tombolnya. Dipakai juga oleh pengukuran
 * sebelum/sesudah — satu fungsi, supaya yang dilaporkan dan yang dijaga sama.
 */
async function ukurTombol(hal) {
  /* Referensi: tombol tanpa stylesheet penulis. `srcdoc` mewarisi skema warna
     halaman; tidak ada CSS kita yang masuk ke sana. */
  await hal.evaluate(
    () =>
      new Promise((selesai) => {
        const f = document.createElement('iframe');
        f.id = 'referensi-bawaan';
        f.style.cssText = 'position:absolute;left:-9999px;width:10px;height:10px';
        f.srcdoc = '<!doctype html><button id="a">a</button><button id="n" disabled>n</button>';
        f.onload = () => selesai();
        document.body.appendChild(f);
      })
  );
  return hal.evaluate(() => {
    const ref = document.getElementById('referensi-bawaan').contentDocument;
    const warnaRef = ref.defaultView.getComputedStyle.bind(ref.defaultView);
    const bawaan = {
      aktif: warnaRef(ref.getElementById('a')).color,
      nonaktif: warnaRef(ref.getElementById('n')).color,
    };
    const panggung = document.querySelector('.galeri-panggung > *');
    const hasil = [];
    for (const tombol of panggung.querySelectorAll('button')) {
      const jalan = document.createTreeWalker(tombol, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = jalan.nextNode())) {
        const teks = n.textContent.replace(/\s+/g, ' ').trim();
        if (!teks) continue;
        const el = n.parentElement;
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden') continue;
        const k = typeof tombol.className === 'string' ? tombol.className.trim().split(/\s+/).join('.') : '';
        const kEl = el === tombol ? '' : ` > ${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).join('.') : ''}`;
        hasil.push({
          tombol: `button${k ? '.' + k : ''}${kEl}`,
          teks: teks.slice(0, 30),
          warna: s.color,
          latar: getComputedStyle(tombol).backgroundColor,
          nonaktif: tombol.disabled,
          bawaan: tombol.disabled ? bawaan.nonaktif : bawaan.aktif,
        });
      }
    }
    return { bawaan, hasil };
  });
}

async function ukurSemua() {
  const semua = [];
  let bawaan = null;
  for (const [layar, keadaan] of SEL) {
    const hal = await peramban.newPage({ viewport: { width: 1280, height: 800 } });
    await hal.goto(`${alamat}/harness-galeri.html?layar=${layar}&keadaan=${keadaan}`, { waitUntil: 'load' });
    await hal.waitForSelector('.kasir-konten', { timeout: 10_000 });
    await hal.waitForTimeout(1200);
    const u = await ukurTombol(hal);
    await hal.close();
    bawaan = u.bawaan;
    for (const h of u.hasil) semua.push({ layar: `${layar}/${keadaan}`, ...h });
  }
  return { bawaan, semua };
}


// ---------------------------------------------------------------------------

test('⛔ tidak satu pun teks di dalam `<button>` layar kasir memakai warna bawaan peramban', async (t) => {
  const { bawaan, semua } = await ukurSemua();
  const tombolUnik = new Set(semua.map((s) => `${s.layar}|${s.tombol}`)).size;
  t.diagnostic(`bawaan peramban: aktif ${bawaan.aktif} · nonaktif ${bawaan.nonaktif}`);
  t.diagnostic(`terukur: ${semua.length} teks di ${tombolUnik} jenis tombol per layar`);
  /* Potret lengkap untuk pembandingan sebelum/sesudah perbaikan. */
  if (process.env.WARNA_TOMBOL_POTRET) fs.writeFileSync(process.env.WARNA_TOMBOL_POTRET, JSON.stringify(semua, null, 1));

  /* ⛔ SENTINEL: penjaga harus memindai sesuatu. */
  assert.ok(
    semua.length >= MINIMAL_TEKS,
    `hanya ${semua.length} teks-dalam-tombol terukur (minimal ${MINIMAL_TEKS}). ` +
      'Galeri gagal memuat, atau tombolnya hilang — nol pelanggaran dari nol tombol bukan bukti.'
  );
  /* SENTINEL kedua: pembandingnya harus benar-benar bawaan peramban, bukan
     warna yang kebetulan sama dengan token. */
  assert.notEqual(bawaan.aktif, 'rgb(20, 17, 15)', 'referensi bawaan terbaca sama dengan --ink — iframe referensi ikut ter-style');

  const langgar = semua.filter((s) => s.warna === s.bawaan);
  const ringkas = [...new Map(langgar.map((l) => [`${l.layar} ${l.tombol}`, l])).values()];
  assert.equal(
    langgar.length,
    0,
    `${langgar.length} teks di dalam <button> memakai warna bawaan peramban:\n` +
      ringkas.map((l) => `  ${l.layar}  ${l.tombol}  "${l.teks}"  ${l.warna}${l.nonaktif ? ' (nonaktif)' : ''}`).join('\n')
  );
});
