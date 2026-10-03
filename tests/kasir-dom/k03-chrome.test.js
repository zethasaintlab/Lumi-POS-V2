'use strict';

// K-03 — anggaran tinggi chrome, dan aksi yang benar-benar berada di toolbar.
//
// ## ⛔ Kenapa DUA penjaga ini ada, dan kenapa keduanya DOM
//
// Keduanya menjaga hal yang tidak menghasilkan satu pun error saat rusak.
//
// 1. ANGGARAN CHROME. `IA:62` menuntut >= 12 kartu terlihat tanpa scroll. Tinggi
//    header dan toolbar adalah ruang yang diambil dari grid, dan angka itu
//    sudah MENABRAK DUA KALI dalam satu hari: bilah nav berikon (+17px) dan
//    baris toolbar melintang (+57px), keduanya memangkas grid dari 12 kartu
//    menjadi 8. Tangkapan layarnya tetap terlihat wajar — kartunya besar dan
//    rapi — jadi mata tidak menangkapnya.
//
//    `tools/tangkap-galeri.mjs` sudah mengukurnya, tapi ia BUKAN test: ia
//    dijalankan manual saat seseorang ingat. Penjaga ini menjalankan pengukuran
//    yang sama di dalam `test:kasir-dom`, yang CI jalankan pada setiap push.
//
// 2. TOOLBAR K-03. ⛔ Sejak keputusan kampanye Hidupkan desain (26 September
//    2026, Task 3 PR 2A), `SLOT_AKSI`/`PortalAksi` DIHAPUS: toolbar kini
//    milik `Kasir.tsx` sendiri (`.kasir-toolbar`, di atas kolom katalog
//    saja), bukan lagi diportalkan ke slot bilah nav shell. Penjaga ini
//    memaku bahwa ketiga aksi K-03 tetap ada, tetap di tempat yang benar
//    (di atas KOLOM KATALOG, bukan di header, bukan menaungi keranjang).
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

test('⛔ anggaran chrome: grid tetap >= 12 kartu terlihat tanpa scroll (IA:62)', async (t) => {
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
    const r = (e) => e.getBoundingClientRect();
    const kartu = [...grid.children];
    /* R1 (spec § 14) — baris ke-3 kartu, dikelompokkan lewat `top` bulat yang
       sama. Sama dengan `k03-kepadatan.test.js`, diukur di sini juga supaya
       titik ukur R1-b mencakup jalur "anggaran chrome" (header 68px + toolbar
       68px, Task 3). */
    const tops = [...new Set(kartu.map((k) => Math.round(r(k).top)))].sort((a, b) => a - b);
    const yBaris3 = tops[2];
    const barisKe3 =
      yBaris3 === undefined
        ? null
        : Math.round(Math.max(...kartu.filter((k) => Math.round(r(k).top) === yBaris3).map((k) => r(k).bottom)));
    return {
      terlihat: kartu.filter((k) => r(k).bottom <= batas + 1).length,
      total: kartu.length,
      header: t('.kasir-header'),
      toolbar: t('.kasir-toolbar'),
      berfoto: kartu.filter((k) => k.querySelector('img')).length,
      batas: Math.round(batas),
      barisKe3,
    };
  });
  await hal.close();

  /* R1-b (spec § 14, indeks § "Titik ukur R1") — jalur "anggaran chrome"
     (1280×800, header 68px + toolbar 68px, Task 3). */
  t.diagnostic(
    `R1 1280 (anggaran chrome): baris-3=${ukur.barisKe3} batas=${ukur.batas} ` +
      `sisa=${ukur.barisKe3 === null ? 'n/a' : ukur.batas - ukur.barisKe3} kartu=${ukur.terlihat}`
  );

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
      `  header ${ukur.header}px · toolbar ${ukur.toolbar}px\n` +
      '  Tinggi chrome adalah ruang yang diambil dari grid. Yang paling sering ' +
      'menyebabkannya: padding baru di header atau toolbar, baris kontrol baru, ' +
      'atau tinggi kartu yang bertambah.'
  );
});

test('⛔ aksi K-03 ada di .kasir-toolbar di atas kolom katalog, tidak di header, dan toolbar tidak menaungi keranjang', async () => {
  const { hal, galat } = await bukaK03('normal');
  const hasil = await hal.evaluate(() => {
    const toolbar = document.querySelector('.kasir-toolbar');
    const kolomKatalog = document.querySelector('.kasir-grid-panel');
    const keranjang = document.querySelector('.kasir-keranjang');
    const header = document.querySelector('.kasir-header');
    const tombol = toolbar ? [...toolbar.querySelectorAll('button')] : [];
    return {
      toolbarAda: !!toolbar,
      /* "Pajak": label terlihat = kanal aktif (Q8); nama aksesibel berawalan "Pajak". */
      label: tombol.map((b) => {
        const nama = b.getAttribute('aria-label');
        return nama !== null && /^Pajak/.test(nama) ? 'Pajak' : b.innerText.trim().replace(/\s+/g, ' ');
      }),
      tinggiMin: tombol.length ? Math.min(...tombol.map((b) => Math.round(b.getBoundingClientRect().height))) : 0,
      diHeader: header && toolbar ? header.contains(toolbar) : false,
      toolbarKanan: toolbar ? Math.round(toolbar.getBoundingClientRect().right) : 0,
      kolomKananKatalog: kolomKatalog ? Math.round(kolomKatalog.getBoundingClientRect().right) : 0,
      diKeranjang: keranjang && toolbar ? keranjang.contains(toolbar) : false,
    };
  });
  await hal.close();

  assert.equal(galat.length, 0, `galat konsol saat memuat K-03: ${galat.join(' | ')}`);
  assert.ok(
    hasil.toolbarAda,
    'elemen `.kasir-toolbar` tidak ada di DOM — `SLOT_AKSI`/`PortalAksi` dihapus ' +
      '(keputusan kampanye 26 September 2026), toolbar kini milik `Kasir.tsx` sendiri.'
  );

  /* Label disebutkan apa adanya, dalam urutan MOCKUP. Perbandingan "ada N
     tombol" akan tetap hijau saat salah satunya diganti tombol lain — dan
     tombol yang tertukar di layar kasir berarti laci terbuka saat kasir
     bermaksud memberi diskon.

     ⛔ Sejak Task 5 (kampanye Hidupkan desain, G-TOOLBAR sebagian): "Item
     manual" masuk lebih dulu, mengikuti urutan `LABEL_TOOLBAR_MOCKUP` di
     `k03-toolbar.test.js`. Task 5B menambah "Batalkan" tepat sesudah
     "Diskon". Task 4 (Laci kas) MENGELUARKAN "Buka laci" dan "Kas masuk /
     keluar" dari toolbar ini — keduanya pindah ke layar K-18. */
  assert.deepEqual(
    hasil.label,
    ['Item manual', 'Diskon', 'Pajak', 'Batalkan'],
    'isi toolbar tidak sesuai. Empat label ini yang punya kode di repo hari ' +
      'ini (Item manual, Diskon, Pajak (Task 10), Batalkan (Task 5B)); Buka laci dan Kas masuk / ' +
      'keluar pindah ke layar Laci kas (K-18, Task 4); empat lainnya di mockup ' +
      'belum, dan tombol yang tidak melakukan apa-apa tidak boleh ditambahkan ke sini.'
  );

  /* Aturan design system #3. */
  assert.ok(
    hasil.tinggiMin >= 44,
    `tombol terpendek di toolbar ${hasil.tinggiMin}px — aturan design system #3 menuntut >= 44px.`
  );

  assert.equal(
    hasil.diHeader,
    false,
    '`.kasir-toolbar` dirender di dalam `.kasir-header` — aksi K-03 bukan bagian header ' +
      'satu baris (`spec § 4`).'
  );

  assert.ok(
    hasil.toolbarKanan <= hasil.kolomKananKatalog + 1,
    `toolbar berakhir di x=${hasil.toolbarKanan} sementara kolom katalog berakhir di ` +
      `x=${hasil.kolomKananKatalog} — toolbar menaungi keranjang di sebelahnya.`
  );

  assert.equal(
    hasil.diKeranjang,
    false,
    'toolbar aksi dirender di dalam panel keranjang. Dua tempat yang merender aksi ' +
      'yang sama menghasilkan layar dengan tombol ganda.'
  );
});
