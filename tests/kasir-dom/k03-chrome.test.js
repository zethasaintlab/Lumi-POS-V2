'use strict';

// K-03 — anggaran tinggi chrome, dan aksi yang benar-benar sampai ke slotnya.
//
// ## ⛔ Kenapa DUA penjaga ini ada, dan kenapa keduanya DOM
//
// Keduanya menjaga hal yang tidak menghasilkan satu pun error saat rusak.
//
// 1. ANGGARAN CHROME. `IA:62` menuntut >= 12 kartu terlihat tanpa scroll. Tinggi
//    topbar dan bilah nav adalah ruang yang diambil dari grid, dan angka itu
//    sudah MENABRAK DUA KALI dalam satu hari: bilah nav berikon (+17px) dan
//    baris toolbar melintang (+57px), keduanya memangkas grid dari 12 kartu
//    menjadi 8. Tangkapan layarnya tetap terlihat wajar — kartunya besar dan
//    rapi — jadi mata tidak menangkapnya.
//
//    `tools/tangkap-galeri.mjs` sudah mengukurnya, tapi ia BUKAN test: ia
//    dijalankan manual saat seseorang ingat. Penjaga ini menjalankan pengukuran
//    yang sama di dalam `test:kasir-dom`, yang CI jalankan pada setiap push.
//
// 2. PORTAL AKSI. Ketiga aksi K-03 dirender ke slot milik `ShellKasir` lewat
//    `createPortal`. Kalau slotnya hilang, id-nya berubah, atau portalnya gagal
//    mount, `PortalAksi` mengembalikan `null` — DIAM, sesuai rancangannya,
//    supaya layar tetap dapat dirender di harness tanpa shell. Konsekuensinya
//    ketiga tombol lenyap dari layar kasir tanpa satu pun error di konsol.
//    Diam yang disengaja tetap menuntut penjaga yang tidak diam.
//
// ## ⛔ Kenapa galeri, bukan harness K-06
//
// `dist-harness-k06` hanya memuat `Pembayaran` dan `PanelQris` — tidak ada
// shell, tidak ada grid. Yang diukur di sini justru hubungan antara keduanya,
// jadi yang dibutuhkan build yang merender K-03 UTUH di dalam shellnya.
//
// ## Prasyarat
//
//   npm run build:galeri
//
// `npm run test:kasir-dom` menjalankannya sendiri lewat `pretest:kasir-dom`, dan
// `.github/workflows/test.yml` menjalankannya sebagai langkah tersendiri —
// sejajar `build:harness-k06`.
//
// ⛔ Berkas ini MENEGASKAN build itu ada; ia tidak membangunnya sendiri, dan
// itu bukan selera. Empat berkas di direktori ini memakai `dist-galeri`, dan
// `node --test` menjalankan berkas secara PARALEL. Versi sebelumnya memakai
// `existsSync` lalu `build:galeri`: keempatnya memeriksa sebelum build pertama
// selesai, jadi keempatnya membangun — ke `outDir` yang sama, dengan
// `emptyOutDir: true`. Build kedua MENGHAPUS `dist-galeri/` selagi server
// statis berkas pertama melayaninya, chunk JS dijawab 404, halaman tidak
// pernah mount, dan gejalanya `waitForSelector` yang timeout 10 detik pada
// selector yang CSS-nya benar — nol error, nol peringatan konsol.
//
// ⛔ Ia merah di CI dan hijau di lokal, karena lokal hampir selalu punya
// `dist-galeri` dari run sebelumnya sehingga tidak satu pun berkas membangun.
// Bentuk "nol baris, bukan error" (`docs/verifikasi/KELAS-GAGAL.md`), kali ini
// pada perkakas testnya sendiri.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const AKAR = path.resolve(__dirname, '..', '..');
const DIST = path.join(AKAR, 'dist-galeri');

/** `IA:62`. Angka ini milik produk, bukan milik test. */
const MINIMAL_KARTU = 12;

/* Jalur Chromium — bentuk yang sama dengan `k06-penjaga.test.js`, dan alasannya
   sama: jalur yang dipaku hijau di satu container dan gagal di semua yang lain,
   dengan pesan yang tidak menyebut penjaga mana pun. */
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
};

let server;
let alamat;
let peramban;

before(async () => {
  /* ⛔ MENEGASKAN, bukan membangun — pola yang sama dengan `k06-penjaga.test.js`.
     Empat berkas di direktori ini memakai `dist-galeri` dan `node --test`
     menjalankannya PARALEL; berkas yang membangun sendiri saling menghapus
     `outDir` (`emptyOutDir: true`), dan yang muncul adalah halaman kosong tanpa
     satu pun error. Alasan lengkapnya di kepala `k03-chrome.test.js`. */
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
 * Membuka satu sel galeri pada viewport tablet kasir.
 *
 * ⛔ 1280×800 — `PRD:428` mengunci layar kasir ke sana, dan `tools/tangkap-
 * galeri.mjs` mengukur pada viewport yang sama. Dua penjaga yang mengukur hal
 * sama pada viewport berbeda akan memberi dua jawaban, dan yang lebih longgar
 * yang akan dipercaya.
 */
async function bukaK03(keadaan) {
  const hal = await peramban.newPage({ viewport: { width: 1280, height: 800 } });
  const galat = [];
  hal.on('pageerror', (e) => galat.push(e.message));
  hal.on('console', (m) => {
    if (m.type() === 'error') galat.push(m.text());
  });
  await hal.goto(`${alamat}/harness-galeri.html?layar=K-03&keadaan=${keadaan}`, {
    waitUntil: 'load',
  });
  await hal.waitForSelector('.kasir-grid .kasir-kartu, .kasir-grid > *', { timeout: 10_000 });
  return { hal, galat };
}

// ---------------------------------------------------------------------------

test('⛔ anggaran chrome: grid tetap >= 12 kartu terlihat tanpa scroll (IA:62)', async () => {
  const { hal, galat } = await bukaK03('normal');
  const ukur = await hal.evaluate(() => {
    const grid = document.querySelector('.kasir-grid');
    if (!grid) return { err: '.kasir-grid tidak ada' };
    let sc = grid.parentElement;
    while (sc) {
      const o = getComputedStyle(sc).overflowY;
      if (o === 'auto' || o === 'scroll') break;
      sc = sc.parentElement;
    }
    if (!sc) return { err: 'tidak ada elemen yang menggulir di atas .kasir-grid' };
    const batas = sc.getBoundingClientRect().bottom;
    const t = (s) => {
      const e = document.querySelector(s);
      return e ? Math.round(e.getBoundingClientRect().height) : 0;
    };
    return {
      terlihat: [...grid.children].filter((k) => k.getBoundingClientRect().bottom <= batas + 1).length,
      total: grid.children.length,
      topbar: t('.kasir-topbar'),
      bilah: t('.kasir-bilah'),
      berfoto: [...grid.children].filter((k) => k.querySelector('img')).length,
    };
  });
  await hal.close();

  assert.equal(galat.length, 0, `galat konsol saat memuat K-03: ${galat.join(' | ')}`);
  assert.ok(!ukur.err, ukur.err);

  /* ⛔ Kartu BERFOTO wajib ada, kalau tidak penjaga ini hijau karena hampa.
     Kartu tanpa foto tingginya 81px dan lima belas di antaranya muat di layar
     mana pun — angka 12 lolos tanpa pernah menguji anggaran yang sesungguhnya.
     Skenario `normal` sudah bergambar sejak 20 September 2026. */
  assert.ok(
    ukur.berfoto > 0,
    `skenario ini tidak punya satu pun kartu berfoto (${ukur.total} kartu). ` +
      'Penjaga anggaran chrome hanya berarti pada kartu berfoto — yang tanpa foto ' +
      'tingginya 81px dan selalu muat. Periksa `gambarUntuk` di galeri/skenario.ts.'
  );

  assert.ok(
    ukur.terlihat >= MINIMAL_KARTU,
    `hanya ${ukur.terlihat} dari ${ukur.total} kartu terlihat tanpa scroll — ` +
      `\`IA:62\` menuntut >= ${MINIMAL_KARTU}.\n` +
      `  topbar ${ukur.topbar}px · bilah nav ${ukur.bilah}px\n` +
      '  Tinggi chrome adalah ruang yang diambil dari grid. Yang paling sering ' +
      'menyebabkannya: padding baru di topbar atau bilah nav, baris kontrol baru, ' +
      'atau tinggi kartu yang bertambah.'
  );
});

test('⛔ portal aksi: ketiga tombol benar-benar mendarat di slot bilah nav', async () => {
  const { hal, galat } = await bukaK03('normal');
  const hasil = await hal.evaluate(() => {
    const slot = document.querySelector('.kasir-slot-aksi');
    const diSlot = slot ? [...slot.querySelectorAll('button')] : [];
    return {
      slotAda: !!slot,
      label: diSlot.map((b) => b.innerText.trim().replace(/\s+/g, ' ')),
      tinggiMin: diSlot.length ? Math.min(...diSlot.map((b) => Math.round(b.getBoundingClientRect().height))) : 0,
      diKeranjang: document.querySelectorAll('.kasir-keranjang .kasir-toolbar button').length,
    };
  });
  await hal.close();

  assert.equal(galat.length, 0, `galat konsol saat memuat K-03: ${galat.join(' | ')}`);
  assert.ok(
    hasil.slotAda,
    'elemen `.kasir-slot-aksi` tidak ada di DOM. `PortalAksi` mengembalikan `null` ' +
      'diam-diam saat slotnya hilang, jadi ketiga tombol lenyap TANPA satu pun error.'
  );

  /* Ketiga label disebutkan apa adanya. Perbandingan "ada tiga tombol" akan
     tetap hijau saat salah satunya diganti tombol lain — dan tombol yang
     tertukar di layar kasir berarti laci terbuka saat kasir bermaksud memberi
     diskon. */
  assert.deepEqual(
    hasil.label,
    ['Diskon', 'Buka laci', 'Kas masuk / keluar'],
    'isi slot aksi tidak sesuai. Ketiga aksi ini yang punya kode di repo; ' +
      'lima lainnya di mockup tidak, dan tombol yang tidak melakukan apa-apa ' +
      'tidak boleh ditambahkan ke sini.'
  );

  /* Aturan design system #3. Tombol yang mengecil karena ia pindah ke bilah
     yang lebih pendek melanggarnya tanpa satu pun error. */
  assert.ok(
    hasil.tinggiMin >= 44,
    `tombol terpendek di slot aksi ${hasil.tinggiMin}px — aturan design system #3 menuntut >= 44px.`
  );

  assert.equal(
    hasil.diKeranjang,
    0,
    'toolbar aksi masih dirender di dalam panel keranjang. Dua tempat yang ' +
      'merender aksi yang sama menghasilkan layar dengan tombol ganda, dan ' +
      'tinggi yang diambil dari daftar item justru yang pemindahan ini perbaiki.'
  );
});
