'use strict';

// Kulit komponen mengikuti mockup — Task 9, kampanye "Hidupkan desain"
// (26 September 2026). Spec § 9 (`docs/superpowers/specs/
// 2026-09-26-fondasi-desain-design.md`): setiap kelas bundle yang menyentuh
// TAMPILAN komponen (tombol, lencana, field, kartu, chip, product-card, tab
// garis bawah, label grup sidebar) dikembalikan sesuai `sumber/
// components/*.jsx`, HANYA lewat selektor kelas bundle dan `var()` di
// `packages/ds/lumi.css` — tidak ada markup baru, tidak ada nilai dikarang.
//
// ## Step 0 — inventaris warna kategori (keputusan user 26 Sep 2026)
//
// `grep -rn "gayaKategori\|--kat-" apps packages` (ditulis di laporan task,
// bukan di sini) menemukan DUA pemakaian di luar back-office: chip saringan
// K-03 dan `pita-kategori` di kartu produk K-03. Keduanya BERHENTI memakai
// warna kategori (`Kasir.tsx`/`kasir.css`) — chip jadi netral (`--card`/
// `--foreground`, hanya yang aktif berwarna `--primary`), kartu produk tanpa
// foto jadi latar putih (`--card`). Token `--kat-*` dan `gayaKategori`
// sendiri TETAP ADA (dipakai `chip-kategori` back-office); menghapusnya
// diputuskan sub-proyek 2, bukan di sini — lihat laporan task untuk daftar
// lengkapnya.
//
// ## Step 1 — kulit komponen di `?layar=fondasi`
//
// Bagian `komponen` (`Fondasi.tsx`) merender setiap komponen yang tabel
// spec § 9 sebut, dengan `data-uji` per elemen (kecuali `<Chip>` bundle, yang
// props-nya dibatasi `_adherence.oxlintrc.json` — diidentifikasi lewat
// `aria-pressed` yang komponennya sendiri set). Nilai pembanding warna dibaca
// dari `tokens-mockup.css` (pola yang sama dengan `palet-berlaku.test.js`),
// bukan diketik ulang sebagai hex.
//
// ## Step 2 — Review Focus 1: kontras teks alasan Bayar
//
// Di K-03 keranjang kosong, `#bayar-alasan` (teks "Keranjang kosong...")
// adalah SIBLING dari tombol Bayar yang nonaktif, bukan descendant — opacity
// `.btn:disabled` (0.4) karena itu TIDAK mengecilkan alfa teks ini secara
// langsung. Algoritma di bawah tetap MENGALIKAN opacity setiap leluhur
// (generik, bukan diasumsikan nol) sebelum mencari latar SOLID pertama
// (backgroundColor beralfa > 0) menyusuri leluhur — `.kasir-keranjang`
// memakai `background: linear-gradient(...)` (Task 2, "Kedalaman"), yang
// membuat `backgroundColor`-nya SENDIRI transparan; latar solid yang
// ditemukan bisa jadi `--card` (galeri) atau `--background` (produksi),
// tergantung pembungkus. Rumus luminans/kontras SAMA dengan
// `tests/runtime/palet-kontras.test.js`.
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

async function bukaLayar(id, keadaan) {
  const hal = await peramban.newPage({ viewport: { width: 1280, height: 800 } });
  await hal.goto(`${alamat}/harness-galeri.html?layar=${id}&keadaan=${keadaan}`, { waitUntil: 'load' });
  await hal.waitForSelector('.galeri-panggung', { timeout: 10_000 });
  await hal.waitForFunction(
    () => (document.querySelector('.galeri-panggung')?.textContent ?? '').trim().length > 0,
    { timeout: 10_000 }
  );
  await hal.waitForTimeout(300);
  return hal;
}

/** Nilai hex `--nama:` di blok `:root` teratas suatu berkas token — pola
 * SAMA dengan `tests/kasir-dom/palet-berlaku.test.js`. */
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

/** Luminans/kontras WCAG — rumus SAMA dengan `tests/runtime/palet-kontras.test.js`,
 * bekerja atas komponen 0-255 alih-alih hex (Step 2 membaca warna yang SUDAH
 * di-blend lewat opacity leluhur, bukan token mentah). */
function luminansRgb([r, g, b]) {
  const conv = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [rl, gl, bl] = [r, g, b].map(conv);
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}
function kontrasRgb(a, b) {
  const [x, y] = [luminansRgb(a), luminansRgb(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// ---------------------------------------------------------------------------
// Step 0 — chip kategori netral, kartu produk tanpa foto netral (galeri K-03)
// ---------------------------------------------------------------------------

test('⛔ Step 0: chip kategori K-03 mengikuti mockup (--secondary, tanpa tepi, 36px/12px), kartu produk tanpa foto netral (--card)', async () => {
  const hal = await bukaLayar('K-03', 'normal');
  const hasil = await hal.evaluate(() => {
    const chip = Array.from(document.querySelectorAll('.kasir-saring .chip')).map((el) => {
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        aktif: el.getAttribute('aria-pressed') === 'true',
        latar: s.backgroundColor,
        warna: s.color,
        borderStyle: s.borderStyle,
        ukuran: s.fontSize,
        bobot: s.fontWeight,
        tinggi: Math.round(r.height),
        paddingKiri: s.paddingLeft,
      };
    });
    /* ⛔ Keputusan user di gerbang visual, 27 September 2026: DIBALIK dari
       Task 9 (kartu produk K-03 tanpa foto sempat tetap bergradien tipis —
       lihat `docs/RENCANA-HIDUPKAN-DESAIN.md` § Keputusan otonom). Kartu
       kini FLAT, sejalan `ProductCard.jsx` mockup — `latar --card` dan
       `backgroundImage: none` diperiksa LANGSUNG pada kartu K-03 SUNGGUHAN
       di bawah ini, bukan hanya pada demo swatch `product-card-demo` (Step
       1) yang tidak pernah memakai gradien sejak awal. */
    const kartuTanpaFoto = Array.from(document.querySelectorAll('.kasir-grid .kasir-kartu[data-gambar="tanpa"]')).map(
      (el) => {
        const s = getComputedStyle(el);
        return {
          chipVar: s.getPropertyValue('--chip').trim(),
          chipSoftVar: s.getPropertyValue('--chip-soft').trim(),
          pitaKategori: el.classList.contains('pita-kategori'),
          latar: s.backgroundColor,
          latarGambar: s.backgroundImage,
        };
      }
    );
    return { chip, kartuTanpaFoto };
  });
  await hal.close();

  assert.ok(hasil.chip.length > 1, `hanya ${hasil.chip.length} chip kategori ditemukan — galeri mungkin gagal memuat`);

  const aktif = hasil.chip.filter((c) => c.aktif);
  assert.equal(aktif.length, 1, `harap TEPAT satu chip aktif, ditemukan ${aktif.length}`);
  assert.equal(aktif[0].latar, tokenRgb('--primary'), `chip aktif: harap latar --primary, nyata ${aktif[0].latar}`);

  /* ⛔ Keputusan kampanye Hidupkan desain, 26 September 2026: mockup sumber
     kebenaran tampilan — chip kategori K-03 mengikuti `sumber/ui_kits/
     kasir/index.html:131`, bukan default bundle. Chip TIDAK aktif: latar
     `--secondary`, teks `--muted-foreground-strong-alt`, TANPA tepi
     terlihat, ukuran `--text-small` (13px) bobot 600 — bukan `--card`/
     `--foreground`/tepi 1px/`--text-body` (15px)/400 warisan `.chip`
     bundle. */
  const takAktif = hasil.chip.filter((c) => !c.aktif);
  const bedaChip = [];
  for (const [i, c] of takAktif.entries()) {
    if (c.latar !== tokenRgb('--secondary')) bedaChip.push(`chip[${i}] latar: harap --secondary, nyata ${c.latar}`);
    if (c.warna !== tokenRgb('--muted-foreground-strong-alt'))
      bedaChip.push(`chip[${i}] warna: harap --muted-foreground-strong-alt, nyata ${c.warna}`);
    if (c.borderStyle !== 'none') bedaChip.push(`chip[${i}] tepi: harap tanpa tepi (borderStyle none), nyata ${c.borderStyle}`);
    if (c.ukuran !== '13px') bedaChip.push(`chip[${i}] ukuran: harap 13px, nyata ${c.ukuran}`);
    if (c.bobot !== '600') bedaChip.push(`chip[${i}] bobot: harap 600, nyata ${c.bobot}`);
  }
  assert.deepEqual(bedaChip, [], 'chip kategori tidak mengikuti mockup:\n  ' + bedaChip.join('\n  '));

  /* ⛔ Keputusan user di gerbang visual, 27 September 2026: chip kategori
     K-03 dirender PERSIS ukuran mockup — 36px tinggi, 12px padding
     horizontal (`sumber/ui_kits/kasir/index.html:131`, `h-9 px-3`) — bukan
     `--touch-min` (44px)/`--space-4` (16px) bawaan bundle. TAMPILAN tidak
     boleh membesar; area SENTUH diperluas tak terlihat lewat `.sentuh`
     (`tests/kasir-dom/area-sentuh.test.js` menjaga ukuran hit-area itu,
     bukan berkas ini). Diperiksa untuk KEDUA keadaan (aktif dan tidak) —
     mockup tidak membedakan ukuran kotak per keadaan, hanya warnanya. */
  const bedaUkuranChip = [];
  for (const [i, c] of hasil.chip.entries()) {
    if (c.tinggi !== 36) bedaUkuranChip.push(`chip[${i}] tinggi: harap 36 (mockup h-9), nyata ${c.tinggi}`);
    if (c.paddingKiri !== '12px')
      bedaUkuranChip.push(`chip[${i}] paddingKiri: harap 12px (mockup px-3), nyata ${c.paddingKiri}`);
  }
  assert.deepEqual(bedaUkuranChip, [], 'ukuran chip kategori tidak mengikuti mockup:\n  ' + bedaUkuranChip.join('\n  '));

  assert.ok(
    hasil.kartuTanpaFoto.length > 0,
    'tidak ada kartu produk `data-gambar="tanpa"` di skenario `normal` — penjaga hampa'
  );
  const bedaKartu = [];
  for (const [i, k] of hasil.kartuTanpaFoto.entries()) {
    if (k.chipVar !== '') bedaKartu.push(`kartu[${i}] --chip masih disuntik: '${k.chipVar}'`);
    if (k.chipSoftVar !== '') bedaKartu.push(`kartu[${i}] --chip-soft masih disuntik: '${k.chipSoftVar}'`);
    if (k.pitaKategori) bedaKartu.push(`kartu[${i}] masih membawa kelas .pita-kategori`);
    if (k.latar !== tokenRgb('--card')) bedaKartu.push(`kartu[${i}] latar: harap --card, nyata ${k.latar}`);
    if (k.latarGambar !== 'none') bedaKartu.push(`kartu[${i}] backgroundImage: harap none (tanpa gradien), nyata ${k.latarGambar}`);
  }
  assert.deepEqual(bedaKartu, [], 'kartu produk tanpa foto masih diwarnai kategori:\n  ' + bedaKartu.join('\n  '));
});

// ---------------------------------------------------------------------------
// Step 1 — kulit komponen di `?layar=fondasi`
// ---------------------------------------------------------------------------

const VARIAN = ['primary', 'secondary', 'ghost', 'danger'];
const KEADAAN = ['normal', 'hover', 'nonaktif', 'kritis'];

test('⛔ Step 1: kulit komponen mengikuti mockup di ?layar=fondasi', async () => {
  const hal = await bukaLayar('fondasi', 'normal');
  const hasil = await hal.evaluate((selektor) => {
    function ambil(el) {
      if (!el) return null;
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        tinggi: Math.round(r.height),
        tinggiPersis: r.height,
        radius: s.borderRadius,
        bobot: s.fontWeight,
        ukuran: s.fontSize,
        opacity: s.opacity,
        latar: s.backgroundColor,
        warna: s.color,
        tepi: s.borderColor,
        tepiGaya: s.borderStyle,
        paddingAtas: s.paddingTop,
        paddingKiri: s.paddingLeft,
        boxShadow: s.boxShadow,
      };
    }
    const keluar = {};
    for (const [nama, sel] of selektor) keluar[nama] = ambil(document.querySelector(sel));
    return keluar;
  }, [
    ...VARIAN.flatMap((v) => KEADAAN.map((k) => [`btn-${v}-${k}`, `[data-uji="btn-${v}-${k}"]`])),
    ...['neutral', 'accent', 'success', 'warning', 'danger', 'info'].map((n) => [`badge-${n}`, `[data-uji="badge-${n}"]`]),
    ['field-normal', '[data-uji="field-normal"]'],
    ['field-galat', '[data-uji="field-galat"]'],
    ['card-demo', '[data-uji="card-demo"]'],
    ['chip-normal', '.fondasi-chip-demo .chip:not([aria-pressed="true"])'],
    ['chip-aktif', '.fondasi-chip-demo .chip[aria-pressed="true"]'],
    ['product-card-demo', '[data-uji="product-card-demo"]'],
    ['tabs-underline-tab-aktif', '[data-uji="tabs-underline-tab-aktif"]'],
    ['tabs-underline-tab-normal', '[data-uji="tabs-underline-tab-normal"]'],
    ['shell-group-demo', '[data-uji="shell-group-demo"]'],
  ]);
  await hal.close();

  let diukur = 0;
  const beda = [];
  function cek(nama, prop, nyata, harap) {
    diukur += 1;
    if (nyata !== harap) beda.push(`${nama}.${prop}: harap ${harap}, nyata ${nyata}`);
  }
  function ada(nama) {
    assert.ok(hasil[nama], `${nama} tidak ditemukan — galeri mungkin gagal memuat atau data-uji berubah`);
    return hasil[nama];
  }

  // .btn — metrik inti, diperiksa lewat btn-primary-normal (keempat varian
  // berbagi kelas dasar `.btn`, jadi satu representatif cukup untuk metrik
  // yang bukan spesifik-varian).
  {
    const el = ada('btn-primary-normal');
    cek('btn-primary-normal', 'tinggi', el.tinggi, 44);
    cek('btn-primary-normal', 'radius', el.radius, '10px');
    cek('btn-primary-normal', 'bobot', el.bobot, '600');
    cek('btn-primary-normal', 'ukuran', el.ukuran, '15px');
  }

  // .btn-critical — tinggi 56, diperiksa di seluruh varian.
  for (const v of VARIAN) {
    const el = ada(`btn-${v}-kritis`);
    cek(`btn-${v}-kritis`, 'tinggi', el.tinggi, 56);
  }

  // .btn:disabled — opacity .4, seluruh varian.
  for (const v of VARIAN) {
    const el = ada(`btn-${v}-nonaktif`);
    cek(`btn-${v}-nonaktif`, 'opacity', el.opacity, '0.4');
  }

  // Warna per varian (normal) — Button.jsx.
  cek('btn-secondary-normal', 'tepi', ada('btn-secondary-normal').tepi, tokenRgb('--input-border'));
  cek('btn-ghost-normal', 'warna', ada('btn-ghost-normal').warna, tokenRgb('--ghost-foreground'));
  cek('btn-danger-normal', 'latar', ada('btn-danger-normal').latar, tokenRgb('--destructive'));
  cek('btn-danger-normal', 'warna', ada('btn-danger-normal').warna, tokenRgb('--primary-foreground'));

  // Hover (`.paksa-hover`) — per varian.
  cek('btn-primary-hover', 'latar', ada('btn-primary-hover').latar, tokenRgb('--accent-hover'));
  cek('btn-secondary-hover', 'latar', ada('btn-secondary-hover').latar, tokenRgb('--secondary-hover'));
  cek('btn-ghost-hover', 'latar', ada('btn-ghost-hover').latar, tokenRgb('--ghost-hover-bg'));
  cek('btn-ghost-hover', 'warna', ada('btn-ghost-hover').warna, tokenRgb('--ghost-foreground'));
  cek('btn-danger-hover', 'latar', ada('btn-danger-hover').latar, tokenRgb('--destructive-hover'));

  // .badge — keenam nada. Bundle `neutral` → mockup `pending`.
  const NADA_LENCANA = {
    neutral: ['--status-pending-bg', '--status-pending-text'],
    accent: ['--accent-subtle', '--primary'],
    success: ['--status-success-bg', '--status-success-text'],
    warning: ['--status-warning-bg', '--status-warning-text'],
    danger: ['--status-danger-bg', '--status-danger-text'],
    info: ['--status-info-bg', '--status-info-text'],
  };
  for (const [nada, [bg, fg]] of Object.entries(NADA_LENCANA)) {
    const el = ada(`badge-${nada}`);
    cek(`badge-${nada}`, 'latar', el.latar, tokenRgb(bg));
    cek(`badge-${nada}`, 'warna', el.warna, tokenRgb(fg));
    cek(`badge-${nada}`, 'ukuran', el.ukuran, '13px');
    cek(`badge-${nada}`, 'bobot', el.bobot, '400');
    cek(`badge-${nada}`, 'paddingAtas', el.paddingAtas, '4px');
    cek(`badge-${nada}`, 'paddingKiri', el.paddingKiri, '10px');
    diukur += 1;
    if (!(parseFloat(el.radius) >= 999)) beda.push(`badge-${nada} radius: harap >= 999, nyata ${el.radius}`);
    /* ⛔ Tinjauan akhir Opus: `Badge.jsx` mockup TIDAK punya tepi sama
       sekali, sementara bundle memberi setiap nada tepi 1px TERLIHAT lewat
       `.badge-{nada}{border-color:…}` di atas tepi dasar
       `1px solid transparent`. Diukur (`Task 9 ronde 2`): tinggi turun dari
       29,5px (dengan tepi) ke 27,5px (tanpa) pada padding/ukuran yang sama —
       nilai itu yang dipatok di sini, bukan diasumsikan dari aritmetika
       kotak, supaya penjaga ini juga menangkap kalau `box-sizing` berubah. */
    cek(`badge-${nada}`, 'tepiGaya', el.tepiGaya, 'none');
    diukur += 1;
    if (Math.abs(el.tinggiPersis - 27.5) > 0.5)
      beda.push(`badge-${nada} tinggi: harap ~27,5px (mockup, tanpa tepi), nyata ${el.tinggiPersis}px`);
  }

  // .field / input
  {
    const normal = ada('field-normal');
    cek('field-normal', 'tinggi', normal.tinggi, 44);
    cek('field-normal', 'radius', normal.radius, '10px');
    cek('field-normal', 'tepi', normal.tepi, tokenRgb('--input-border'));
    const galat = ada('field-galat');
    cek('field-galat', 'tepi', galat.tepi, tokenRgb('--destructive'));
  }

  // .card
  {
    const el = ada('card-demo');
    cek('card-demo', 'radius', el.radius, '12px');
    cek('card-demo', 'tepi', el.tepi, tokenRgb('--border'));
    diukur += 1;
    if (el.boxShadow === 'none') beda.push('card-demo boxShadow: harap ada bayangan, nyata none');
  }

  // .chip — mockup `sumber/ui_kits/kasir/index.html:131` (keputusan kampanye
  // Hidupkan desain, 26 September 2026: mockup sumber kebenaran tampilan).
  {
    const normal = ada('chip-normal');
    cek('chip-normal', 'latar', normal.latar, tokenRgb('--secondary'));
    cek('chip-normal', 'warna', normal.warna, tokenRgb('--muted-foreground-strong-alt'));
    cek('chip-normal', 'ukuran', normal.ukuran, '13px');
    cek('chip-normal', 'bobot', normal.bobot, '600');
    cek('chip-normal', 'tepiGaya', normal.tepiGaya, 'none');
    /* ⛔ Keputusan user di gerbang visual, 27 September 2026: tampilan
       PERSIS ukuran mockup (36px tinggi, 12px padding kiri — `h-9 px-3`),
       bukan `--touch-min` (44px)/`--space-4` (16px) bawaan bundle. Area
       sentuh diperluas TAK TERLIHAT ke 44px lewat `.sentuh` di K-03
       sungguhan (Kasir.tsx) — `area-sentuh.test.js` menjaga itu; demo
       fondasi ini murni swatch kulit, bukan tempat mekanisme sentuh diuji. */
    cek('chip-normal', 'tinggi', normal.tinggi, 36);
    cek('chip-normal', 'paddingKiri', normal.paddingKiri, '12px');
    const aktif = ada('chip-aktif');
    cek('chip-aktif', 'latar', aktif.latar, tokenRgb('--primary'));
  }

  // .product-card
  {
    const el = ada('product-card-demo');
    cek('product-card-demo', 'tepi', el.tepi, tokenRgb('--card-outline'));
    /* ⛔ Demo ini FLAT — bukan `.kasir-kartu` (gradien "Kedalaman", Task 2),
       jadi `latar --card` terbukti HARFIAH di sini, sejalan Step 0. */
    cek('product-card-demo', 'latar', el.latar, tokenRgb('--card'));
  }

  // .tabs-underline
  {
    const aktif = ada('tabs-underline-tab-aktif');
    cek('tabs-underline-tab-aktif', 'ukuran', aktif.ukuran, '13px');
    cek('tabs-underline-tab-aktif', 'bobot', aktif.bobot, '600');
    cek('tabs-underline-tab-aktif', 'warna', aktif.warna, tokenRgb('--primary'));
    const normal = ada('tabs-underline-tab-normal');
    cek('tabs-underline-tab-normal', 'ukuran', normal.ukuran, '13px');
    cek('tabs-underline-tab-normal', 'bobot', normal.bobot, '600');
  }

  // .shell-group
  {
    const el = ada('shell-group-demo');
    cek('shell-group-demo', 'ukuran', el.ukuran, '13px');
    cek('shell-group-demo', 'bobot', el.bobot, '600');
  }

  /* ⛔ SENTINEL: penjaga harus benar-benar memindai sesuatu (jauh di bawah
     jumlah nyata — lihat `palet-berlaku.test.js` untuk pola yang sama). */
  assert.ok(diukur >= 20, `hanya ${diukur} pasangan komponen/properti terukur — galeri mungkin gagal memuat`);
  assert.deepEqual(beda, [], 'kulit komponen tidak sesuai mockup:\n  ' + beda.join('\n  '));
});

// ---------------------------------------------------------------------------
// Step 2 — Review Focus 1: kontras teks alasan Bayar (K-03, keranjang kosong)
// ---------------------------------------------------------------------------

test('⛔ Step 2: kontras teks alasan Bayar (K-03 keranjang kosong) >= 4,5', async () => {
  const hal = await bukaLayar('K-03', 'normal');
  const info = await hal.evaluate(() => {
    function parseRgba(str) {
      const m = str && str.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(',').map(Number);
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    }
    const el = document.getElementById('bayar-alasan');
    if (!el) return null;
    const textStyle = getComputedStyle(el);
    const teks = parseRgba(textStyle.color);
    let opacityAccum = parseFloat(textStyle.opacity || '1');
    let node = el.parentElement;
    let latar = null;
    while (node) {
      const s = getComputedStyle(node);
      opacityAccum *= parseFloat(s.opacity || '1');
      const bgc = parseRgba(s.backgroundColor);
      if (bgc && bgc.a > 0) {
        latar = bgc;
        break;
      }
      node = node.parentElement;
    }
    if (!latar) latar = { r: 255, g: 255, b: 255, a: 1 };
    const blend = (c) => latar[c] + (teks[c] - latar[c]) * opacityAccum;
    return {
      fg: [blend('r'), blend('g'), blend('b')],
      bg: [latar.r, latar.g, latar.b],
      opacityAccum,
      teksMentah: textStyle.color,
      latarMentah: textStyle.backgroundColor,
    };
  });
  await hal.close();

  assert.ok(info, '#bayar-alasan tidak ditemukan — skenario `normal` seharusnya berkeranjang kosong');
  const rasio = kontrasRgb(info.fg, info.bg);
  assert.ok(
    rasio >= 4.5,
    `kontras teks alasan Bayar ${rasio.toFixed(2)} < 4,5 ` +
      `(teks ${info.teksMentah} opacity-akumulasi ${info.opacityAccum}, latar solid terdekat rgb(${info.bg.join(', ')}))`
  );
});
