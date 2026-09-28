'use strict';

// K-03 — kepadatan grid dan keranjang menurut mockup, di bawah batas produk.
//
// Fase 3.1 rebuild UI kasir (`docs/RENCANA-REBUILD-UI.md`). Selisih "dapat
// dikejar" di `docs/referensi-visual/BANDING.md` § K-03, diukur di DOM:
//
//   1. Grid paling banyak EMPAT kolom. Mockup 4 pada 1280; galeri 6. Pada
//      1024 keduanya sudah 4, jadi batas ini hanya mengubah layar lebar.
//   2. Foto kartu SELEBAR kartu, menempel di tepi atas (mockup: `h-[72px]
//      w-full object-cover`), rasio ≈ 3:1 (213 × 72). Sebelumnya foto 16:9
//      berbingkai di dalam padding.
//   3. Judul "Keranjang" dan label "Total" 20 px (`--text-title`, token inti).
//      Bobot TETAP 500: mockup 600, tapi `--weight-bold` bundle "hanya untuk
//      --text-display" — token di kode mengalahkan mockup.
//   4. Kolom keranjang 360 px (mockup), bukan 352.
//
// ⛔ Dan dua batas yang TIDAK boleh bergeser karenanya:
//
//   - `IA:62`: ≥ 12 kartu terlihat tanpa scroll pada 1024×768 (panggung
//     galeri) DAN pada 1280×800. Kartu yang lebih lebar menjadi lebih tinggi;
//     yang menahannya adalah rasio foto, dan penjaga ini yang membuktikannya.
//   - Baris keranjang TIDAK dipendekkan (82 px, stepper 44 px, DS #3).
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

const MINIMAL_KARTU = 12;

/* Viewport ≥ 1088 → panggung galeri 1024×768 tanpa skala (`galeri.css`).
   `lebar: 1280` melepas chrome galeri dan menaruh panggung 1280×800 di (0,0),
   pola `docs/referensi-visual/alat/banding2.mjs`. */
async function bukaK03(keadaan, lebar) {
  const hal = await peramban.newPage({ viewport: { width: 1280, height: 800 } });
  const galat = [];
  hal.on('pageerror', (e) => galat.push(e.message));
  await hal.goto(`${alamat}/harness-galeri.html?layar=K-03&keadaan=${keadaan}`, { waitUntil: 'load' });
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
  await hal.waitForTimeout(1200);
  return { hal, galat };
}

async function ukur(hal) {
  return hal.evaluate(() => {
    const r = (e) => e.getBoundingClientRect();
    const panggung = r(document.querySelector('.galeri-panggung > *'));
    const grid = document.querySelector('.kasir-grid');
    let sc = grid.parentElement;
    while (sc && !/auto|scroll/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement;
    const bawah = r(sc).bottom;
    const kartu = [...grid.children];
    const foto = kartu
      .filter((k) => k.querySelector('img.kasir-kartu-gambar'))
      .map((k) => {
        const a = r(k);
        const b = r(k.querySelector('img.kasir-kartu-gambar'));
        const tepi = parseFloat(getComputedStyle(k).borderLeftWidth) || 0;
        return {
          dx: Math.round(b.left - a.left - tepi),
          dy: Math.round(b.top - a.top - tepi),
          sisa: Math.round(a.right - b.right - tepi),
          w: Math.round(b.width),
          h: Math.round(b.height),
        };
      });
    const gaya = (e) => (e ? `${getComputedStyle(e).fontSize}/${getComputedStyle(e).fontWeight}` : null);
    const keranjang = document.querySelector('.kasir-keranjang');
    const baris = [...document.querySelectorAll('.kasir-baris')].map((b) => Math.round(r(b).height));

    /* ⛔ R1 (spec § 14) — di mana baris KE-3 kartu berakhir, bukan hanya
       berapa yang muat. Baris dikelompokkan lewat `top` (bulat) yang sama;
       kartu terakhir sebelum baris ke-4 adalah pembanding yang spec-nya
       tulis sebagai tabel simulasi CSS — di sini diukur, bukan disimulasikan. */
    const tops = [...new Set(kartu.map((k) => Math.round(r(k).top)))].sort((a, b) => a - b);
    const yBaris3 = tops[2];
    const barisKe3 =
      yBaris3 === undefined
        ? null
        : Math.round(Math.max(...kartu.filter((k) => Math.round(r(k).top) === yBaris3).map((k) => r(k).bottom)));

    return {
      panggung: `${Math.round(panggung.width)}×${Math.round(panggung.height)}`,
      kolom: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
      terlihat: kartu.filter((k) => r(k).bottom <= bawah + 1).length,
      total: kartu.length,
      foto,
      keranjang: Math.round(r(keranjang).width),
      // `h2` kini di dalam `.kasir-keranjang-kepala` (Task 5B: ikon kosongkan di kanannya).
      judul: gaya(keranjang.querySelector('.kasir-keranjang-kepala > h2')),
      labelTotal: gaya(keranjang.querySelector('.kasir-total > span:first-child')),
      baris,
      batas: Math.round(bawah),
      barisKe3,
    };
  });
}

// ---------------------------------------------------------------------------

for (const lebar of [1024, 1280]) {
  test(`⛔ ${lebar}: grid paling banyak 4 kolom, dan tetap >= 12 kartu terlihat (IA:62)`, async (t) => {
    const { hal, galat } = await bukaK03('normal', lebar);
    const u = await ukur(hal);
    await hal.close();
    t.diagnostic(JSON.stringify({ ...u, foto: u.foto.slice(0, 2) }));
    /* R1-a (spec § 14, indeks § "Titik ukur R1") — diukur, bukan disimulasikan. */
    t.diagnostic(
      `R1 ${lebar}: baris-3=${u.barisKe3} batas=${u.batas} sisa=${u.barisKe3 === null ? 'n/a' : u.batas - u.barisKe3} kartu=${u.terlihat}`
    );
    assert.deepEqual(galat, []);
    /* ⛔ SENTINEL: panggung yang diukur memang selebar yang diklaim, dan ada
       kartu berfoto. Tanpa foto, kartu 81 px dan 12 selalu muat — hampa. */
    assert.equal(u.panggung, lebar === 1024 ? '1024×768' : '1280×800');
    assert.ok(u.foto.length > 0, 'skenario `normal` tanpa kartu berfoto — penjaga hampa');
    assert.ok(u.kolom <= 4, `${u.kolom} kolom pada ${lebar} — mockup 4`);
    assert.ok(
      u.terlihat >= MINIMAL_KARTU,
      `hanya ${u.terlihat} dari ${u.total} kartu terlihat tanpa scroll pada ${lebar} — IA:62 menuntut >= ${MINIMAL_KARTU}`
    );
  });

  test(`⛔ ${lebar}: foto kartu selebar kartu, menempel di tepi atas, rasio ≈ 3:1`, async () => {
    const { hal, galat } = await bukaK03('normal', lebar);
    const u = await ukur(hal);
    await hal.close();
    assert.deepEqual(galat, []);
    assert.ok(u.foto.length > 0, 'tidak ada kartu berfoto — penjaga hampa');
    for (const f of u.foto) {
      assert.deepEqual(
        [f.dx, f.dy, f.sisa],
        [0, 0, 0],
        `foto berbingkai di dalam kartu (kiri ${f.dx}, atas ${f.dy}, kanan ${f.sisa} px) — mockup menempel ke tepi`
      );
      const rasio = f.w / f.h;
      assert.ok(rasio >= 2.8 && rasio <= 3.2, `rasio foto ${f.w}×${f.h} = ${rasio.toFixed(2)} — mockup 213×72 ≈ 2,96`);
    }
  });
}

// ---------------------------------------------------------------------------
// G-IA62-PITA — Task 1, kampanye "Hidupkan desain" (PR 2A, kasir).
//
// ⛔ Kombinasi kartu BERFOTO dan pita antrean FR-H8 tampil BERSAMAAN belum
// pernah diukur sebelum kampanye ini (spec § 14 R1): `BERGAMBAR` hanya berisi
// `gambar`/`normal`, dan `offline` (satu-satunya skenario dengan pita) tidak
// bergambar. IA:62 yang hanya pernah diuji dengan SATU dari dua tekanan itu
// aktif adalah penjaga yang belum pernah membuktikan skenario yang paling
// mahal. `gambar-antrean` (`galeri/skenario.ts`) menutup celah itu.
//
// ⛔ Pita di-assert ADA (bukan hanya diasumsikan dari fixture) — tanpa
// assertion ini, penjaga hijau karena hampa persis seperti kelas cacat
// "nol baris, bukan error": kartu terlihat tanpa pita bukan bukti kartu
// terlihat DENGAN pita.
test('⛔ G-IA62-PITA: ≥ 12 kartu pada 1024×768 dengan kartu berfoto DAN pita antrean tampil', async (t) => {
  const { hal, galat } = await bukaK03('gambar-antrean', 1024);
  const u = await ukur(hal);
  /* ⛔ `.kasir-pita`, BUKAN `[role="status"]` telanjang — `role="status"` juga
     dipakai `SyncIndicator` bundle dan belasan pesan lain di layar kasir
     (`Kasir.tsx`, `Paginasi.tsx`, dst), yang tampil TERLEPAS dari pita FR-H8.
     Selektor yang terlalu longgar membuat assertion ini lolos meski
     `PitaAntrean` tidak pernah merender apa pun — penjaga hampa persis
     seperti yang CLAUDE.md § "nol baris, bukan error" peringatkan, dan
     terbukti saat sabotase (2): dengan itu, jumlah `[role="status"]` TETAP
     >= 1 (dari `SyncIndicator`) walau pita sungguhan tidak ada. */
  const pita = await hal.locator('.kasir-pita').count();
  await hal.close();

  t.diagnostic(JSON.stringify({ ...u, foto: u.foto.slice(0, 2) }));
  t.diagnostic(
    `R1 1024 (gambar-antrean): baris-3=${u.barisKe3} batas=${u.batas} sisa=${u.barisKe3 === null ? 'n/a' : u.batas - u.barisKe3} kartu=${u.terlihat}`
  );

  assert.deepEqual(galat, []);
  assert.equal(u.panggung, '1024×768');
  /* ⛔ SENTINEL, pola yang sama dengan `foto.length > 0` di atas: tanpa
     pita, penjaga ini hanya mengulang IA:62 `normal` dengan nama lain. */
  assert.ok(
    pita >= 1,
    'pita FR-H8 tidak ditemukan di DOM (`.kasir-pita`) — skenario `gambar-antrean` tidak memicu ' +
      'PitaAntrean, jadi kartu yang terlihat tidak pernah diukur BERSAMA pita. Periksa `antreanUntuk` ' +
      'di `galeri/skenario.ts` dan syarat `angkaDapatDipercaya` di `ShellKasir.tsx`.'
  );
  assert.ok(u.foto.length > 0, 'skenario `gambar-antrean` tanpa kartu berfoto — penjaga hampa');
  assert.ok(
    u.terlihat >= MINIMAL_KARTU,
    `hanya ${u.terlihat} dari ${u.total} kartu terlihat tanpa scroll pada 1024 DENGAN pita antrean tampil — ` +
      `IA:62 menuntut >= ${MINIMAL_KARTU}`
  );
});

test('⛔ keranjang: kolom 360 px, judul dan label Total 20 px bobot 500, baris TIDAK dipendekkan', async () => {
  const { hal, galat } = await bukaK03('keranjang-penuh', 1024);
  const u = await ukur(hal);
  await hal.close();
  assert.deepEqual(galat, []);
  assert.equal(u.keranjang, 360, `kolom keranjang ${u.keranjang} px — mockup 360`);
  assert.equal(u.judul, '20px/600', `judul "Keranjang" ${u.judul} (skala 32/20/15/13)`);
  assert.equal(u.labelTotal, '20px/600', `label "Total" ${u.labelTotal} (skala 32/20/15/13)`);
  /* ⛔ SENTINEL + batas: keranjang penuh punya baris, dan tidak satu pun lebih
     pendek dari 82 px (stepper 44 px, DS #3). */
  assert.ok(u.baris.length >= 3, 'skenario `keranjang-penuh` tanpa baris — penjaga hampa');
  assert.ok(Math.min(...u.baris) >= 82, `baris keranjang dipendekkan: ${Math.min(...u.baris)} px (< 82)`);
});
