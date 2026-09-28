'use strict';

// Skala teks final BERLAKU di layar — 32/20/15/13, diukur, bukan dibaca.
//
// ## ⛔ Kenapa penjaga ini ada
//
// Task 4, kampanye "Hidupkan desain" (26 September 2026). Skala teks final
// punya EMPAT ukuran: 32/20/15/13 (`docs/superpowers/specs/
// 2026-09-26-fondasi-desain-design.md` § 5). `--t-metric` (24px) DIHAPUS —
// `.stat .t-title-lg` sekarang memakai `var(--text-display)` (32px), bukan
// ukuran kelima. Membaca `lumi.css` tidak membuktikan APA yang sungguh
// dirender: pengarahan token yang lupa ditulis, atau kelas yang masih memakai
// nama bundle lama, tetap lolos baca sambil ukurannya salah di peramban.
//
// ## Cakupan
//
// SETIAP layar galeri, dan daftar layarnya DIBACA DARI HALAMAN
// (`.galeri-grup[aria-label="Layar"] button`) — bukan diketik ulang di sini.
// `apps/kasir/src/galeri/Galeri.tsx` sudah menyatakan daftar `LAYAR` sekali;
// menyalinnya ke berkas ini menciptakan tempat KEDUA yang harus diingat setiap
// kali layar baru masuk galeri, dan yang lupa membuat layar baru itu lolos
// tanpa diperiksa — bentuk cacat "nol baris, bukan error" yang sama dengan
// yang `CLAUDE.md` daftarkan.
//
// Diukur di dalam `.galeri-panggung` saja — bilah galeri (tombol pemilih
// layar/keadaan, kalimat "Pertanyaan yang layar ini harus jawab") adalah
// CHROME galeri, bukan bagian layar produk yang diverifikasi kampanye ini.
//
// Elemen yang DIPERIKSA: setiap elemen yang punya NODE TEKS langsung (anak
// `childNodes` bertipe TEXT_NODE, bukan hanya turunan lewat elemen anak) yang
// tidak kosong sesudah di-trim. Ini menghindari menghitung kontainer (`<div>`
// pembungkus) yang "teks"-nya sebenarnya milik anaknya — dan menghindari
// menghitung elemen yang sama dua kali lewat leluhur dan keturunannya.
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

/** Skala teks final — spec § 5. Empat ukuran, tidak lebih. */
const SKALA_SAH = new Set(['32px', '20px', '15px', '13px']);

/** Diperiksa minimal sekian elemen — lihat § "membuktikan ia memindai sesuatu" di CLAUDE.md. */
const MINIMAL_ELEMEN = 200;

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

/** Daftar layar DIBACA dari halaman — lihat komentar berkas § Cakupan. */
async function bacaDaftarLayar() {
  const hal = await bukaLayar('fondasi');
  const daftar = await hal.evaluate(() =>
    Array.from(document.querySelectorAll('.galeri-grup[aria-label="Layar"] button')).map((b) =>
      b.textContent.trim()
    )
  );
  await hal.close();
  assert.ok(daftar.length > 0, 'tidak ada tombol layar ditemukan di bilah galeri — halaman mungkin gagal muat');
  return daftar;
}

/** Selektor RINGKAS untuk pesan galat — tag + kelas, tanpa isi teks penuh. */
function selektorRingkas({ tag, kelas }) {
  const kelasBersih = (kelas || '').trim().split(/\s+/).filter(Boolean).join('.');
  return kelasBersih ? `${tag.toLowerCase()}.${kelasBersih}` : tag.toLowerCase();
}

test('⛔ skala teks 32/20/15/13 berlaku di seluruh layar galeri (getComputedStyle, bukan CSS dibaca)', async () => {
  const layarIds = await bacaDaftarLayar();
  const pelanggar = [];
  let totalDiperiksa = 0;

  for (const id of layarIds) {
    const hal = await bukaLayar(id);
    const hasil = await hal.evaluate(() => {
      const panggung = document.querySelector('.galeri-panggung');
      if (!panggung) return [];
      const keluar = [];
      for (const el of panggung.querySelectorAll('*')) {
        const punyaTeksLangsung = Array.from(el.childNodes).some(
          (n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim().length > 0
        );
        if (!punyaTeksLangsung) continue;
        keluar.push({
          tag: el.tagName,
          kelas: el.className && typeof el.className === 'string' ? el.className : '',
          fontSize: getComputedStyle(el).fontSize,
          teks: el.textContent.trim().slice(0, 40),
        });
      }
      return keluar;
    });
    await hal.close();

    totalDiperiksa += hasil.length;
    for (const el of hasil) {
      if (SKALA_SAH.has(el.fontSize)) continue;
      pelanggar.push(
        `layar ${id}, selektor "${selektorRingkas(el)}" (teks "${el.teks}"): ${el.fontSize} — ` +
          `harap salah satu dari {${[...SKALA_SAH].join(', ')}}`
      );
    }
  }

  assert.ok(
    totalDiperiksa >= MINIMAL_ELEMEN,
    `hanya ${totalDiperiksa} elemen berteks diperiksa lintas ${layarIds.length} layar — ` +
      `harap >= ${MINIMAL_ELEMEN}. Penjaga yang memeriksa terlalu sedikit elemen tidak ` +
      'membuktikan ia memindai apa pun (lihat CLAUDE.md § "nol baris, bukan error").'
  );

  assert.deepEqual(
    pelanggar,
    [],
    `${pelanggar.length} elemen di luar skala teks final (32/20/15/13):\n  ` + pelanggar.join('\n  ')
  );
});

// ---------------------------------------------------------------------------
// G-LH — tinggi baris. Task 1, kampanye "Hidupkan desain" (PR 2A, kasir).
//
// ## ⛔ Kenapa DUA aturan (ketat/longgar), bukan satu
//
// Spec § 10.1 mengikat `line-height` ke EMPAT rasio mockup: display 1,15 ·
// title 1,3 · body 1,5 · small 1,4. Kelas bundle yang memetakan LANGSUNG ke
// peran itu (`t-display`, `t-title`, `t-body`, `t-body-md`, `t-caption`)
// dijaga KETAT — rasio harus PERSIS pasangan ukuran↔rasio-nya, bukan sekadar
// salah satu dari empat rasio itu. Elemen LAIN (label, badge, tab, judul
// wordmark, dst — yang ukurannya benar lewat token tapi TIDAK memakai kelas
// t-* bundle) dijaga LONGGAR: rasio harus salah satu dari empat nilai yang
// sah, tapi tidak dituntut PASANGAN ukuran tertentu — mockup tidak menuliskan
// aturan per-kelas untuk elemen di luar tujuh kelas bundle itu.
//
// `line-height: normal` pada elemen berteks adalah pelanggaran di KEDUA
// jalur: ia tidak PERNAH salah satu dari empat rasio (browser menghitungnya
// dari metrik font, bukan dari token kita), dan ia gejala paling umum dari
// "lupa mengarahkan" — elemen yang ukurannya sudah benar (skala 32/20/15/13)
// tapi tinggi barisnya masih warisan `ds-bundle` yang tidak menyetel apa pun.
//
// ## Prasyarat
//
//   npm run build:galeri

const RASIO_SAH = [1.15, 1.3, 1.5, 1.4];
const KELAS_KETAT = /** @type {const} */ (['t-display', 't-title', 't-body', 't-body-md', 't-caption']);
const RASIO_KELAS = { 't-display': 1.15, 't-title': 1.3, 't-body': 1.5, 't-body-md': 1.5, 't-caption': 1.4 };

/** @type {number} Minimal elemen KETAT diperiksa — lihat CLAUDE.md § "nol baris, bukan error". */
const MINIMAL_KETAT = 50;
/** @type {number} Minimal elemen LONGGAR diperiksa. */
const MINIMAL_LONGGAR = 200;

test('⛔ G-LH: line-height mengikuti token mockup — 32/1.15, 20/1.3, 15/1.5, 13/1.4', async (t) => {
  const layarIds = await bacaDaftarLayar();
  const pelanggarKetat = [];
  const pelanggarLonggar = [];
  let totalKetat = 0;
  let totalLonggar = 0;

  for (const id of layarIds) {
    const hal = await bukaLayar(id);
    const keadaanJudul = await hal.evaluate(() =>
      Array.from(document.querySelectorAll('.galeri-grup[aria-label="Keadaan"] button')).map((b) =>
        b.textContent.trim()
      )
    );

    for (const judul of keadaanJudul) {
      await hal
        .locator('.galeri-grup[aria-label="Keadaan"]')
        .getByRole('button', { name: judul, exact: true })
        .click();
      await hal.waitForTimeout(250);

      const hasil = await hal.evaluate(() => {
        const panggung = document.querySelector('.galeri-panggung');
        if (!panggung) return [];
        const keluar = [];
        for (const el of panggung.querySelectorAll('*')) {
          const punyaTeksLangsung = Array.from(el.childNodes).some(
            (n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim().length > 0
          );
          if (!punyaTeksLangsung) continue;
          const gaya = getComputedStyle(el);
          keluar.push({
            tag: el.tagName,
            kelas: el.className && typeof el.className === 'string' ? el.className : '',
            fontSize: gaya.fontSize,
            lineHeight: gaya.lineHeight,
            teks: el.textContent.trim().slice(0, 40),
          });
        }
        return keluar;
      });

      for (const el of hasil) {
        const ukuran = parseFloat(el.fontSize);
        const kelasList = (el.kelas || '').trim().split(/\s+/).filter(Boolean);
        const kelasKetat = kelasList.find((k) => KELAS_KETAT.includes(k));
        const label = `layar ${id}, keadaan "${judul}", selektor "${selektorRingkas(el)}" (teks "${el.teks}")`;

        if (el.lineHeight === 'normal') {
          if (kelasKetat) {
            totalKetat += 1;
            pelanggarKetat.push(`${label} [.${kelasKetat}]: ${el.fontSize}/normal — harap rasio ${RASIO_KELAS[kelasKetat]}`);
          } else {
            totalLonggar += 1;
            pelanggarLonggar.push(`${label}: ${el.fontSize}/normal — line-height "normal" adalah pelanggaran`);
          }
          continue;
        }

        const rasio = parseFloat(el.lineHeight) / ukuran;

        if (kelasKetat) {
          totalKetat += 1;
          const harap = RASIO_KELAS[kelasKetat];
          if (Math.abs(rasio - harap) > 0.01) {
            pelanggarKetat.push(
              `${label} [.${kelasKetat}]: ${el.fontSize}/${el.lineHeight} → rasio ${rasio.toFixed(3)}, harap ${harap}`
            );
          }
        } else {
          totalLonggar += 1;
          const cocok = RASIO_SAH.some((r) => Math.abs(rasio - r) <= 0.01);
          if (!cocok) {
            pelanggarLonggar.push(
              `${label}: ${el.fontSize}/${el.lineHeight} → rasio ${rasio.toFixed(3)}, harap salah satu dari {${RASIO_SAH.join(', ')}}`
            );
          }
        }
      }
    }
    await hal.close();
  }

  t.diagnostic(`G-LH: elemen ketat=${totalKetat}, longgar=${totalLonggar}`);

  assert.ok(
    totalKetat >= MINIMAL_KETAT,
    `hanya ${totalKetat} elemen KETAT (t-display/t-title/t-body/t-body-md/t-caption) diperiksa — ` +
      `harap >= ${MINIMAL_KETAT}. Penjaga yang memeriksa terlalu sedikit elemen tidak membuktikan ` +
      'ia memindai apa pun (lihat CLAUDE.md § "nol baris, bukan error").'
  );
  assert.ok(
    totalLonggar >= MINIMAL_LONGGAR,
    `hanya ${totalLonggar} elemen LONGGAR diperiksa — harap >= ${MINIMAL_LONGGAR}.`
  );

  const pelanggar = [...pelanggarKetat, ...pelanggarLonggar];
  assert.deepEqual(
    pelanggar,
    [],
    `${pelanggar.length} elemen dengan line-height di luar token mockup:\n  ` + pelanggar.join('\n  ')
  );
});
