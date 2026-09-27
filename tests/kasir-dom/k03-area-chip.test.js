'use strict';

// K-03 — area sentuh chip saringan kategori tidak tumpang tindih, dan tidak
// mencuri ketukan dari kontrol tetangga (pencarian di atas, grid kartu di
// bawah).
//
// ## Kenapa penjaga ini ada, dan kenapa TERPISAH dari `area-sentuh.test.js`
//
// Task 5 memasang `potongSentuh(['kiri','kanan'], 'var(--space-2)')` pada
// chip `.kasir-saring` (`Kasir.tsx`) supaya perluasan area sentuh 36px→44px
// berhenti di garis tengah celah 8px (`--space-2`) antar chip, bukan
// menembus ke chip tetangga. `area-sentuh.test.js` sudah punya pemeriksaan
// tetangga umum, tapi hanya untuk PASANGAN yang `rectExpandedDefault`
// (formula BAWAAN simetris) anggap "cukup dekat" — dan chip kategori
// (label bebas dipilih merchant) biasanya sudah LEBIH LEBAR dari
// `--touch-min` sebelum dipotong sisi mana pun, jadi formula bawaan itu
// menghitung `mx=0` pada sisi horizontal dan TIDAK PERNAH menandai dua chip
// sebagai tetangga — pemeriksaan generiknya tidak pernah berjalan untuk
// kelas elemen ini. Bukan cacat pemeriksaan umum itu sendiri (chip memang
// tidak butuh perluasan horizontal untuk mencapai 44px, lebarnya sendiri
// sudah cukup) — tapi ia juga berarti pemotongan `potongSentuh` yang
// SUNGGUHAN dipasang di baris kode ini tidak pernah diverifikasi oleh
// penjaga mana pun. Berkas ini mengisi celah itu: mengukur `::before`
// SUNGGUHAN (bukan formula bawaan), untuk elemen ini secara eksplisit.
//
// Dua hal diukur, dari GEOMETRI `::before` lewat `getComputedStyle(el,
// '::before')` — bukan dari nilai token yang dibaca ulang dari CSS:
//
//   1. Overlap AREA (px²) antar setiap pasang chip — bukan sekadar boolean
//      "bertetangga" — supaya sabotase yang memperlebar SATU sisi saja
//      (kanan, kiri tetap benar) tertangkap sebagai overlap ASIMETRIS.
//   2. Overlap dengan bounding box tetangga NON-chip: elemen SEBELUM dan
//      SESUDAH `.kasir-saring` (kontrol cari/urutan di atas, grid kartu di
//      bawah) — chip pertama/terakhir tidak punya tetangga chip di sisi
//      luar, tapi area sentuhnya masih bisa mencuri ketukan dari kontrol di
//      atas/bawahnya kalau potongan vertikal salah.
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

/* Viewport ≥ 1088 → panggung galeri 1024×768 TANPA skala (`galeri.css`).
   `lebar: 1280` melepas chrome galeri dan menaruh panggung 1280×800 di (0,0)
   — pola `k03-kepadatan.test.js`, dipakai apa adanya supaya kedua berkas
   tidak menyimpang tentang cara mengukur panggung yang sama. */
async function bukaK03(lebar) {
  const hal = await peramban.newPage({ viewport: { width: 1280, height: 800 } });
  const galat = [];
  hal.on('pageerror', (e) => galat.push(e.message));
  await hal.goto(`${alamat}/harness-galeri.html?layar=K-03&keadaan=normal`, { waitUntil: 'load' });
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

async function ukurChip(hal) {
  return hal.evaluate(() => {
    const kontainer = document.querySelector('.kasir-saring');
    if (!kontainer) return { error: '.kasir-saring tidak ditemukan di layar K-03' };

    const semuaChip = [...kontainer.querySelectorAll('.chip')];
    const chipSentuh = [...kontainer.querySelectorAll('.chip.sentuh')];

    /** Kotak TEKAN sungguhan: bounding box elemen, diperluas oleh nilai
        top/right/bottom/left `::before` (negatif = meluas keluar). Dibaca
        dari `getComputedStyle`, bukan dari token yang diketik ulang. */
    function hitRect(el) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el, '::before');
      const atas = parseFloat(cs.top) || 0;
      const kanan = parseFloat(cs.right) || 0;
      const bawah = parseFloat(cs.bottom) || 0;
      const kiri = parseFloat(cs.left) || 0;
      return {
        left: r.left + kiri,
        right: r.right - kanan,
        top: r.top + atas,
        bottom: r.bottom - bawah,
      };
    }

    function overlapArea(a, b) {
      const dx = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const dy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (dx <= 0 || dy <= 0) return 0;
      return dx * dy;
    }

    const chipData = semuaChip.map((el) => ({
      label: el.textContent.trim(),
      hit: hitRect(el),
    }));

    const pelanggaranOverlap = [];
    for (let i = 0; i < chipData.length; i += 1) {
      for (let j = i + 1; j < chipData.length; j += 1) {
        const area = overlapArea(chipData[i].hit, chipData[j].hit);
        if (area > 0.5) {
          pelanggaranOverlap.push(
            `chip "${chipData[i].label}" vs "${chipData[j].label}": area sentuh tumpang tindih ${area.toFixed(2)} px²`
          );
        }
      }
    }

    const prev = kontainer.previousElementSibling;
    const next = kontainer.nextElementSibling;
    const pelanggaranTetangga = [];
    for (const { label, hit } of chipData) {
      if (prev) {
        const rp = prev.getBoundingClientRect();
        const area = overlapArea(hit, { left: rp.left, right: rp.right, top: rp.top, bottom: rp.bottom });
        if (area > 0) {
          pelanggaranTetangga.push(
            `chip "${label}": area sentuh tumpang tindih ${area.toFixed(2)} px² dengan elemen SEBELUM ` +
              `.kasir-saring (.${prev.className.split(/\s+/).join('.')}) — kontrol pencarian/urutan`
          );
        }
      }
      if (next) {
        const rn = next.getBoundingClientRect();
        const area = overlapArea(hit, { left: rn.left, right: rn.right, top: rn.top, bottom: rn.bottom });
        if (area > 0) {
          pelanggaranTetangga.push(
            `chip "${label}": area sentuh tumpang tindih ${area.toFixed(2)} px² dengan elemen SESUDAH ` +
              `.kasir-saring (.${next.className.split(/\s+/).join('.')}) — grid kartu produk`
          );
        }
      }
    }

    return {
      jumlahChip: semuaChip.length,
      jumlahSentuh: chipSentuh.length,
      pelanggaranOverlap,
      pelanggaranTetangga,
    };
  });
}

for (const lebar of [1024, 1280]) {
  test(`⛔ ${lebar}: area sentuh chip K-03 (44px) tidak tumpang tindih antar chip maupun dengan tetangga`, async () => {
    const { hal, galat } = await bukaK03(lebar);
    const u = await ukurChip(hal);
    await hal.close();
    assert.deepEqual(galat, []);
    assert.equal(u.error, undefined, u.error);

    // Sentinel: penjaga ini harus memindai LEBIH DARI satu chip, kalau tidak
    // "nol pelanggaran" tidak dapat dibedakan dari "tidak ada apa pun yang
    // diperiksa" (`KELAS-GAGAL.md`).
    assert.ok(
      u.jumlahChip >= 2,
      `hanya ${u.jumlahChip} chip ditemukan di .kasir-saring pada ${lebar} — penjaga butuh >= 2 chip untuk berarti`
    );

    // Setiap chip di `.kasir-saring` WAJIB `.sentuh` — chip yang kehilangan
    // kelasnya tidak ikut terpindai `querySelectorAll('.chip.sentuh')` sama
    // sekali (nol pelanggaran ukuran, bukan gagal ukuran) — bentuk yang sama
    // dengan sentinel `elemenMaxPerLayar['K-03']` di `area-sentuh.test.js`,
    // di sini sebagai hitungan LANGSUNG alih-alih ambang `>= 2`.
    assert.equal(
      u.jumlahSentuh,
      u.jumlahChip,
      `.kasir-saring .chip.sentuh (${u.jumlahSentuh}) != .kasir-saring .chip (${u.jumlahChip}) pada ${lebar} — ` +
        'satu atau lebih chip kehilangan kelas `.sentuh`'
    );

    assert.deepEqual(
      u.pelanggaranOverlap,
      [],
      `${u.pelanggaranOverlap.length} pasangan chip tumpang tindih area sentuhnya pada ${lebar}:\n  ` +
        u.pelanggaranOverlap.join('\n  ')
    );

    assert.deepEqual(
      u.pelanggaranTetangga,
      [],
      `${u.pelanggaranTetangga.length} chip mencuri area tetangga NON-chip pada ${lebar}:\n  ` +
        u.pelanggaranTetangga.join('\n  ')
    );
  });
}
