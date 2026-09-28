'use strict';

// Nunito Sans di-self-host — pengganti Inter (Task 3, kampanye "Hidupkan
// desain"). Diukur di peramban, bukan dibaca dari CSS.
//
// ## ⛔ Kenapa DOM, bukan grep berkas
//
// `--font-sans` didefinisikan di `ds-bundle/tokens/typography.css` (VENDOR,
// tidak pernah disunting) sebagai Inter. Nilai efektif di peramban bergantung
// pada `lumi.css` mengarahkannya ulang DAN diimpor paling akhir — urutan yang
// sudah salah sebelumnya untuk token lain (`palet-berlaku.test.js`). Membaca
// `lumi.css` tidak membuktikan `getComputedStyle(body).fontFamily` sungguh
// berubah; hanya peramban yang tahu siapa yang menang.
//
// Empat hal diperiksa, semuanya lewat pengukuran:
//
//   1. `body` memakai Nunito Sans sebagai font pertama, di K-03 dan di
//      halaman Fondasi.
//   2. Bobot 400 dan 600 sungguh TERDAFTAR sebagai `FontFace` TERUNDUH di
//      `document.fonts`, dengan bobot PERSIS 400/600 pada entrinya.
//   3. Setiap `.num` di K-03 memakai `font-variant-numeric: tabular-nums`
//      (kelas ini dipakai untuk angka uang/kuantitas — aturan DS #4).
//   4. Nunito Sans TETAP tabular untuk digit sekalipun kelasnya tidak
//      dipakai — diukur langsung dengan tiga `<span>` uji berisi digit
//      berbeda (1, 0, 8) dan membandingkan lebarnya. Catatan brief: diukur
//      90,02 px per sepuluh digit pada 15 px — **diukur di sini, bukan
//      diasumsikan dari catatan itu**.
//
// ## ⛔ `document.fonts.check()`/`.load()` DIBUANG, dan itu ditemukan lewat
//    percobaan sabotase manual — BUKAN diasumsikan aman dari nama API-nya.
//
// Keduanya memakai algoritma PENCOCOKAN FONT CSS: saat family "Nunito Sans"
// hanya punya SATU `@font-face` (bobot 400) dan diminta bobot 600, peramban
// mencocokkan ke wajah TERDEKAT yang tersedia (400) dan mengembalikannya
// sebagai "match" — `check('600 ...')` dan `load('600 ...')` KEDUANYA
// menjawab true/loaded sekalipun impor bobot 600 dihapus total. Diverifikasi
// langsung: hapus `@import` bobot 500/600 dari `packages/ds/styles.css`,
// build ulang, dan `check('600 15px "Inter"')` tetap `true`. Test yang
// memakai keduanya HIJAU pada sabotase yang seharusnya membuatnya MERAH —
// persis kelas "penjaga hampa" yang `CLAUDE.md` minta disabotase sebelum
// dipercaya.
//
// Yang dipakai sebagai gantinya: `Array.from(document.fonts)` lalu SARING
// entrinya sendiri berdasarkan `family` DAN `weight`. Ini membaca `FontFace`
// yang benar-benar terdaftar dari `@font-face` di stylesheet — bukan hasil
// pencocokan/fallback API loader — sehingga entri bobot 600 yang tidak ada
// TIDAK MUNCUL sama sekali, alih-alih disamarkan sebagai entri 400 yang
// "cocok".
//
// Ditambah satu pemeriksaan berkas: tidak ada `inter-*.woff2` yang tersisa di
// `dist-galeri` — font lama harus benar-benar hilang dari bundel, bukan
// sekadar tidak lagi dipakai `--font-sans`.
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
  await hal.goto(`${alamat}/harness-galeri.html?layar=${id}&keadaan=normal`, { waitUntil: 'load' });
  await hal.waitForSelector('.galeri-panggung', { timeout: 10_000 });
  await hal.waitForFunction(
    () => (document.querySelector('.galeri-panggung')?.textContent ?? '').trim().length > 0,
    { timeout: 10_000 }
  );
  await hal.waitForTimeout(300);
  return hal;
}

for (const id of ['K-03', 'fondasi']) {
  test(`⛔ body memakai Nunito Sans di ${id}`, async () => {
    const hal = await bukaLayar(id);
    try {
      const fontFamily = await hal.evaluate(() => getComputedStyle(document.body).fontFamily);
      /* Nama font boleh muncul berkutip (`"Nunito Sans", system-ui, ...`) atau
         tidak, tergantung mesin render — yang diperiksa adalah bahwa font
         PERTAMA dalam daftar, sesudah kutip dilucuti, adalah "Nunito Sans". */
      const pertama = fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');
      assert.equal(
        pertama,
        'Nunito Sans',
        `${id}: font pertama body harap "Nunito Sans", peramban "${fontFamily}"`
      );
    } finally {
      await hal.close();
    }
  });
}

test('⛔ Nunito Sans 400 dan 600 terdaftar sebagai FontFace terunduh di document.fonts', async () => {
  const hal = await bukaLayar('fondasi');
  try {
    const entri = await hal.evaluate(async () => {
      await document.fonts.ready;
      /* `.entries()` FontFaceSet murni MEMBACA `@font-face` yang terpasang —
         tanpa pencocokan/fallback. Weight dibaca sebagai NOMOR untuk menyerap
         kedua bentuk sah CSS Font Loading API: `"600"` (satu bobot) atau
         `"600 600"` (rentang satu titik, yang dipakai beberapa peramban untuk
         `@font-face` non-variable). */
      return Array.from(document.fonts)
        .filter((f) => f.family.replace(/^["']|["']$/g, '') === 'Nunito Sans')
        .map((f) => ({ weight: f.weight, status: f.status }));
    });
    const punyaBobot = (bobot) =>
      entri.some((e) => e.status === 'loaded' && e.weight.split(' ').map(Number).includes(bobot));
    assert.ok(
      punyaBobot(400),
      `tidak ada FontFace "Nunito Sans" bobot 400 berstatus loaded. Entri: ${JSON.stringify(entri)}`
    );
    assert.ok(
      punyaBobot(600),
      `tidak ada FontFace "Nunito Sans" bobot 600 berstatus loaded. Entri: ${JSON.stringify(entri)}`
    );
  } finally {
    await hal.close();
  }
});

test('⛔ setiap .num di K-03 memakai font-variant-numeric: tabular-nums', async () => {
  const hal = await bukaLayar('K-03');
  try {
    const hasil = await hal.evaluate(() =>
      Array.from(document.querySelectorAll('.num')).map((el) => ({
        teks: el.textContent,
        fvn: getComputedStyle(el).fontVariantNumeric,
      }))
    );
    assert.ok(hasil.length > 0, 'tidak ada elemen .num ditemukan di K-03 — layar mungkin gagal memuat');
    for (const { teks, fvn } of hasil) {
      assert.ok(
        fvn.includes('tabular-nums'),
        `.num "${teks}": font-variant-numeric harap memuat tabular-nums, dapat "${fvn}"`
      );
    }
  } finally {
    await hal.close();
  }
});

test('⛔ digit Nunito Sans sama lebarnya (1/0/8), selisih <= 0,5 px', async () => {
  const hal = await bukaLayar('fondasi');
  try {
    /* Tiga elemen UJI disuntikkan langsung ke `document.body` — bukan bagian
       dari markup `Fondasi.tsx` — supaya lebar yang diukur adalah lebar font
       yang SUNGGUH dimuat halaman ini, tanpa bergantung pada susunan markup
       tempat lain memilih menampilkan digit. */
    const lebar = await hal.evaluate(async () => {
      await document.fonts.ready;
      const digit = ['1111111111', '0000000000', '8888888888'];
      const hasil = digit.map((teks) => {
        const span = document.createElement('span');
        span.className = 'num';
        span.style.position = 'absolute';
        span.style.whiteSpace = 'pre';
        span.style.fontSize = '15px';
        span.textContent = teks;
        document.body.appendChild(span);
        const lebar = span.getBoundingClientRect().width;
        span.remove();
        return lebar;
      });
      return hasil;
    });
    const [w1, w0, w8] = lebar;
    const selisihMax = Math.max(w1, w0, w8) - Math.min(w1, w0, w8);
    assert.ok(
      selisihMax <= 0.5,
      `lebar digit berbeda lebih dari 0,5px: "1"=${w1} "0"=${w0} "8"=${w8} (selisih ${selisihMax})`
    );
  } finally {
    await hal.close();
  }
});

test('⛔ nol berkas inter-*.woff2 di dist-galeri', () => {
  const assetsDir = path.join(DIST, 'assets');
  assert.ok(fs.existsSync(assetsDir), `${assetsDir} tidak ada — dist-galeri mungkin belum dibangun`);
  const tersisa = fs.readdirSync(assetsDir).filter((f) => /^inter-.*\.woff2?$/i.test(f));
  assert.deepEqual(tersisa, [], `berkas font Inter masih ada di dist-galeri/assets: ${tersisa.join(', ')}`);
});
