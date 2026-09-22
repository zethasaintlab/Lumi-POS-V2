'use strict';

// K-12 — kasir harus dapat menyatakan angka yang sistemnya sendiri hasilkan.
//
// ## ⛔ Cacat yang penjaga ini tutup
//
// Sampai 22 September 2026 satu-satunya cara memasukkan hitungan fisik laci
// adalah enam tombol pecahan: `[1000, 5000, 10000, 50000, 100000]`. Tidak ada
// field bebas.
//
// `outlet.rounding_increment` bawaannya **100** (`packages/domain/src/money.ts`),
// jadi saldo laci mendarat di kelipatan 100 — fixture galeri menghasilkan
// **Rp 670.500**. Tombol-tombol itu hanya dapat menyusun kelipatan 1.000.
//
// ⛔ Akibatnya SELISIH NOL tidak dapat dicapai, dan itu bukan ketidaknyamanan:
// setiap tutup kas menghasilkan selisih palsu, selisih palsu menuntut alasan
// dari daftar tertutup, yang melewati ambang menuntut PIN manajer, dan FR-G5 X7
// (selisih kas per kasir) menandai kasirnya. Kontrol kas berhenti mengukur
// kelalaian dan mulai mengukur ketidakmampuan layarnya sendiri.
//
// Mockup `ds-bundle/ui_kits/pos/TutupKasScreen.jsx` memakai `<Field size="lg"
// prefix="Rp" inputMode="numeric">`, dan `PRD:210` menggambar `[_______]`.
// Keduanya benar sejak awal; yang dibangun hanya tombolnya.
//
// ## ⛔ Kenapa DOM, bukan unit test
//
// Yang rusak bukan aritmetikanya — `hitungSaldoSeharusnya` selalu benar. Yang
// rusak adalah tidak adanya JALAN bagi kasir untuk mengetikkan angkanya. Itu
// hanya ada di layar, dan hanya terlihat dengan merendernya.
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

/**
 * Saldo seharusnya pada fixture galeri `normal`.
 *
 * ⛔ Angkanya bukan pilihan test ini — ia hasil `saldo_awal + SUM(delta)` atas
 * fixture yang sudah ada, dan justru KARENA ia tidak bulat ia membuktikan
 * sesuatu. Fixture yang kebetulan bulat akan membuat penjaga ini hijau dengan
 * tombol pecahan saja.
 */
const SALDO_SEHARUSNYA = 670_500;

/** Pecahan terkecil yang tombolnya sediakan. */
const PECAHAN_TERKECIL = 1_000;

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
    res.writeHead(200, {
      'content-type': JENIS[path.extname(berkas)] ?? 'application/octet-stream',
    });
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

async function bukaK12(keadaan = 'normal') {
  const hal = await peramban.newPage({ viewport: { width: 1280, height: 800 } });
  const galat = [];
  hal.on('pageerror', (e) => galat.push(e.message));
  hal.on('console', (m) => {
    if (m.type() === 'error' && /Failed to load resource/.test(m.text())) return;
    if (m.type() === 'error') galat.push(m.text());
  });
  await hal.goto(`${alamat}/harness-galeri.html?layar=K-12&keadaan=${keadaan}`, {
    waitUntil: 'load',
  });
  await hal.waitForSelector('.kasir-konten', { timeout: 10_000 });
  await hal.waitForTimeout(1200);
  return { hal, galat };
}

// ---------------------------------------------------------------------------

test('⛔ SENTINEL: saldo fixture TIDAK dapat disusun dari tombol pecahan saja', (t) => {
  /* Penjaga di bawah hijau dengan tombol saja bila angkanya kebetulan bulat,
     dan hijaunya akan berarti "tombolnya cukup" — kebalikan dari yang
     dibuktikan. Baris ini membuat premisnya eksplisit dan gagal keras bila
     fixture berubah menjadi bulat. */
  assert.notEqual(
    SALDO_SEHARUSNYA % PECAHAN_TERKECIL,
    0,
    `Rp ${SALDO_SEHARUSNYA} habis dibagi ${PECAHAN_TERKECIL}, jadi tombol pecahan ` +
      'dapat menyusunnya dan penjaga di bawah berhenti membuktikan perlunya field ' +
      'bebas. Fixture galeri harus menghasilkan saldo yang TIDAK bulat.'
  );
  t.diagnostic(
    `saldo seharusnya Rp ${SALDO_SEHARUSNYA.toLocaleString('id-ID')}; sisa ` +
      `terhadap pecahan terkecil: ${SALDO_SEHARUSNYA % PECAHAN_TERKECIL}`
  );
});

test('⛔ kasir dapat memasukkan hitungan fisik TEPAT Rp 670.500 — dalam bentuk berkelompok', async () => {
  const { hal, galat } = await bukaK12();

  /* `getByLabel` — bukan pencarian lewat elemen induk. Kalau ia tidak
     menemukan apa pun, labelnya tidak terhubung ke inputnya dan pembaca layar
     mengumumkan "edit teks" tanpa nama (lihat `Bidang.tsx`). */
  const bidang = hal.getByLabel(/hitungan fisik/i);
  await bidang.waitFor({ state: 'visible', timeout: 5_000 });

  /* ⛔ Bentuk BERKELOMPOK, bukan digit polos, dan itu yang diuji di sini.
     Kasir membaca total laci dari kalkulator atau mesin hitung uang, dan yang
     tertulis di sana `670.500`. Field yang menolaknya memaksa kasir mengetik
     ulang tanpa titik — dan mengetik ulang angka uang adalah tempat digit
     hilang. `bacaRupiah` menerima bentuk ini dan MENOLAK desimal; aturan itu
     miliknya, bukan milik layar. */
  await bidang.fill('670.500');
  await hal.waitForTimeout(300);

  const isiField = await bidang.inputValue();
  assert.equal(
    isiField,
    '670.500',
    `field mengubah apa yang diketik kasir menjadi "${isiField}". Teks yang ` +
      'ditulis ulang sambil diketik adalah pemformat KEDUA; `CLAUDE.md` ' +
      'menetapkan hanya boleh ada satu.'
  );

  /* Tahap review membuktikan angkanya SAMPAI, bukan sekadar terketik — dan di
     sana ia melewati `rupiah()`, satu-satunya pemformat di repo ini. */
  await hal.getByRole('button', { name: 'Lanjut' }).click();
  await hal.waitForTimeout(1000);
  const baris = await hal.evaluate(() =>
    [...document.querySelectorAll('.kasir-subtotal')].map((e) =>
      e.innerText.replace(/\s+/g, ' ').trim()
    )
  );
  await hal.close();
  assert.equal(galat.length, 0, `galat konsol: ${galat.join(' | ')}`);

  const fisik = baris.find((b) => /^Hitungan fisik/i.test(b));
  assert.ok(fisik, `baris "Hitungan fisik" tidak ada. Yang terbaca: ${baris.join(' · ')}`);
  assert.match(
    fisik,
    /Rp\s*670\.500$/,
    `hitungan yang diketik tidak sampai utuh: "${fisik}".\n` +
      `  Yang terbaca: ${baris.join(' · ')}`
  );
});

test('⛔ SELISIH NOL dapat dicapai — kontrol kas mengukur laci, bukan layarnya', async () => {
  const { hal, galat } = await bukaK12();

  const bidang = hal.getByLabel(/hitungan fisik/i);
  await bidang.waitFor({ state: 'visible', timeout: 5_000 });
  await bidang.fill(String(SALDO_SEHARUSNYA));
  await hal.getByRole('button', { name: 'Lanjut' }).click();
  await hal.waitForTimeout(1000);

  /* ⛔ Selisih dibaca dari PANELNYA, bukan dari baris `.kasir-subtotal`.
     Sampai 22 September 2026 ia satu baris di antara baris rincian; sejak
     panel selisih lahir ia punya elemennya sendiri, dengan `data-arah` yang
     menyatakan keadaannya. Yang diuji tetap sama — selisih nol dapat dicapai —
     dan `data-arah` membuatnya lebih kuat: nol yang dirender dengan perlakuan
     "kurang" tetap salah meski angkanya benar. */
  const hasil = await hal.evaluate(() => {
    const panel = document.querySelector('.kasir-selisih');
    return {
      ada: panel !== null,
      teks: panel ? panel.innerText.replace(/\s+/g, ' ').trim() : '',
      arah: panel ? panel.getAttribute('data-arah') : null,
      baris: [...document.querySelectorAll('.kasir-subtotal')].map((e) =>
        e.innerText.replace(/\s+/g, ' ').trim()
      ),
    };
  });
  await hal.close();
  assert.equal(galat.length, 0, `galat konsol: ${galat.join(' | ')}`);

  assert.ok(
    hasil.ada,
    `panel selisih tidak ada. Yang terbaca: ${hasil.baris.join(' · ')}`
  );
  assert.match(
    hasil.teks,
    /Rp\s*0(\s|$)/,
    'hitungan yang TEPAT sama dengan saldo seharusnya tetap menghasilkan selisih ' +
      'bukan nol.\n  ⛔ Selisih palsu menuntut alasan, dapat menuntut PIN manajer, ' +
      'dan menandai kasirnya di FR-G5 X7 — untuk laci yang isinya benar.\n' +
      `  Panel: "${hasil.teks}"\n  Baris: ${hasil.baris.join(' · ')}`
  );
  assert.equal(
    hasil.arah,
    'pas',
    `selisih nol dirender dengan perlakuan "${hasil.arah}". Laci yang cocok ` +
      'adalah kabar baik, dan kabar baik yang terlihat seperti kabar buruk ' +
      'membuat kasir mencari uang yang tidak hilang.'
  );
});
