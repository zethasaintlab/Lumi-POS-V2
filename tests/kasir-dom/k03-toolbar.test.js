'use strict';

// K-03 — G-TOOLBAR sebagian (Task 5, kampanye "Hidupkan desain"): Item
// manual + Diskon. Spec § 4 (tabel baris 1, 2 + "Aturan tombol"), § 11
// G-TOOLBAR. Plan `.superpowers/sdd/2026-09-28-kasir-2a/task-5-brief.md`
// § Interfaces mendefinisikan `LABEL_TOOLBAR_MOCKUP`/`TERPASANG`/`SEMENTARA`
// di sini — bukan di app code — supaya Task 5B/10/11/12 memperluas
// `TERPASANG` tanpa menyunting definisi ini, dan Task 12 mengganti
// assertion-nya jadi `deepEqual` penuh saat `SEMENTARA` kosong.
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

/** Urutan MOCKUP lengkap, delapan tombol (spec § 4). */
const LABEL_TOOLBAR_MOCKUP = [
  'Item manual',
  'Diskon',
  'Pajak',
  'Catatan',
  'Pelanggan',
  'No. Meja',
  'Batalkan',
  'Pesanan tahan',
];
/** Label mockup yang SUDAH dibangun (Task 5). Task 5B/10/11/12 menambah. */
const TERPASANG = new Set(['Item manual', 'Diskon']);
/** Label NON-mockup yang masih di toolbar sampai Task 4 (Laci kas) selesai. */
const SEMENTARA = new Set(['Buka laci', 'Kas masuk / keluar']);

/** `barcode` fixture — HARUS sama persis dengan `KODE_BARCODE_FIXTURE`
    (`apps/kasir/src/galeri/skenario.ts`), pada variation "Kopi Tubruk
    ORIGEN". Dua literal disengaja (test tidak boleh mengimpor TS app code) —
    keduanya diperiksa lewat namanya sendiri kalau salah satu berubah tanpa
    yang lain: test ini akan gagal "kode dikenal" persis seperti kode asing. */
const KODE_BARCODE_FIXTURE = '8992761111017';

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
 * `?matikan=<kunci>` — kill switch dipaksa MATI di galeri tanpa menambah
 * keadaan baru (`OpsiDbPalsu.matikanFitur`, `db-palsu.ts`). `keadaan` opsional
 * karena beberapa test butuh cart TERISI (`keranjang-penuh`).
 */
async function bukaK03(opsi = {}) {
  const { keadaan = 'normal', matikan = [] } = opsi;
  const hal = await peramban.newPage({ viewport: { width: 1280, height: 800 } });
  const galat = [];
  hal.on('pageerror', (e) => galat.push(e.message));
  hal.on('console', (m) => {
    if (m.type() === 'error') galat.push(m.text());
  });
  const q = new URLSearchParams({ layar: 'K-03', keadaan });
  if (matikan.length > 0) q.set('matikan', matikan.join(','));
  await hal.goto(`${alamat}/harness-galeri.html?${q.toString()}`, { waitUntil: 'load' });
  await hal.waitForSelector('.kasir-toolbar', { timeout: 10_000 });
  return { hal, galat };
}

// ---------------------------------------------------------------------------

test('⛔ toolbar berisi label TERPASANG dalam urutan mockup (ditambah SEMENTARA), dan tidak ada di header', async () => {
  const { hal, galat } = await bukaK03();
  const hasil = await hal.evaluate(() => {
    const toolbar = document.querySelector('.kasir-toolbar');
    const header = document.querySelector('.kasir-header');
    const tombol = toolbar ? [...toolbar.querySelectorAll('button')] : [];
    return {
      label: tombol.map((b) => b.innerText.trim().replace(/\s+/g, ' ')),
      diHeader: header && toolbar ? header.contains(toolbar) : false,
    };
  });
  await hal.close();

  assert.equal(galat.length, 0, `galat konsol saat memuat K-03: ${galat.join(' | ')}`);
  assert.equal(hasil.diHeader, false, '`.kasir-toolbar` dirender di dalam `.kasir-header`.');

  const tanpaSementara = hasil.label.filter((l) => !SEMENTARA.has(l));
  const harapTerpasang = LABEL_TOOLBAR_MOCKUP.filter((l) => TERPASANG.has(l));
  assert.deepEqual(
    tanpaSementara,
    harapTerpasang,
    `label toolbar (tanpa SEMENTARA) ${JSON.stringify(hasil.label)} — harap urutan mockup ${JSON.stringify(harapTerpasang)}`
  );

  for (const l of hasil.label) {
    if (SEMENTARA.has(l)) continue;
    assert.ok(TERPASANG.has(l), `label "${l}" bukan TERPASANG maupun SEMENTARA — tombol tidak dikenal di toolbar`);
  }
});

test('⛔ ukuran toolbar mockup: tombol ≥ 70×44, ikon 17 di atas label 13/600 (bilah 68px DITOLAK, lihat R1-c)', async (t) => {
  const { hal, galat } = await bukaK03();
  const hasil = await hal.evaluate(() => {
    const toolbar = document.querySelector('.kasir-toolbar');
    const barisTinggi = toolbar ? Math.round(toolbar.getBoundingClientRect().height) : 0;
    const tombol = toolbar ? [...toolbar.querySelectorAll('button')] : [];
    return {
      barisTinggi,
      tombol: tombol.map((b) => {
        const r = b.getBoundingClientRect();
        const svg = b.querySelector('svg');
        const label = b.querySelector('.kasir-toolbar-label');
        const rs = svg ? svg.getBoundingClientRect() : null;
        const rl = label ? label.getBoundingClientRect() : null;
        const cs = label ? getComputedStyle(label) : null;
        return {
          teks: b.innerText.trim().replace(/\s+/g, ' '),
          w: Math.round(r.width),
          h: Math.round(r.height),
          ikonAda: !!svg,
          ikonW: rs ? Math.round(rs.width) : null,
          ikonH: rs ? Math.round(rs.height) : null,
          ikonDiAtasLabel: rs && rl ? rs.bottom <= rl.top + 1 : null,
          labelAda: !!label,
          labelFontSize: cs ? cs.fontSize : null,
          labelFontWeight: cs ? cs.fontWeight : null,
        };
      }),
    };
  });
  await hal.close();

  assert.equal(galat.length, 0, `galat konsol saat memuat K-03: ${galat.join(' | ')}`);
  /* ⛔ Bilah 68px (spec § 4) DITOLAK — R1-c (`task-5-report.md` § Temuan):
     `.kasir-grid-panel` SELALU kelebihan konten (`overflow-y: auto`), jadi
     memaksa `flex-shrink: 0` + `height: 68px` membuat G-IA62-PITA merah
     (1024×768 `gambar-antrean` turun ke 8 kartu). Bilah tetap NATURAL —
     tingginya sama dengan tombol tertingginya (44px), tanpa padding
     tersembunyi yang mengklaim 68px yang tidak pernah dirender. Dicatat di
     sini, bukan diam-diam: angka sesungguhnya tercetak lewat `t.diagnostic`. */
  t.diagnostic(`bilah toolbar: ${hasil.barisTinggi}px (mockup 68px ditolak, lihat komentar kasir.css)`);
  assert.ok(hasil.tombol.length > 0, 'tidak ada tombol di toolbar');
  const tinggiMaksTombol = Math.max(...hasil.tombol.map((t) => t.h));
  assert.equal(
    hasil.barisTinggi,
    tinggiMaksTombol,
    `.kasir-toolbar tinggi ${hasil.barisTinggi}px tidak sama dengan tombol tertingginya (${tinggiMaksTombol}px) — ` +
      'ada padding/margin tak dijelaskan di bilah.'
  );

  for (const t of hasil.tombol) {
    assert.ok(t.w >= 70, `tombol "${t.teks}" lebar ${t.w}px, harap >= 70px (min-lebar mockup)`);
    assert.ok(t.h >= 44, `tombol "${t.teks}" tinggi ${t.h}px, harap >= 44px`);
    assert.ok(t.ikonAda, `tombol "${t.teks}" tidak punya ikon`);
    assert.equal(t.ikonW, 17, `tombol "${t.teks}" ikon lebar ${t.ikonW}px, harap 17px`);
    assert.equal(t.ikonH, 17, `tombol "${t.teks}" ikon tinggi ${t.ikonH}px, harap 17px`);
    assert.ok(t.labelAda, `tombol "${t.teks}" tidak punya \`.kasir-toolbar-label\``);
    assert.equal(t.labelFontSize, '13px', `tombol "${t.teks}" label ${t.labelFontSize}, harap 13px`);
    assert.equal(t.labelFontWeight, '600', `tombol "${t.teks}" label bobot ${t.labelFontWeight}, harap 600`);
    assert.ok(t.ikonDiAtasLabel, `tombol "${t.teks}": ikon TIDAK di atas label (bawah ikon harus <= atas label)`);
  }
});

test('⛔ Diskon HILANG (bukan nonaktif) saat diskon_kasir mati', async () => {
  const { hal, galat } = await bukaK03({ keadaan: 'keranjang-penuh', matikan: ['diskon_kasir'] });
  const hasil = await hal.evaluate(() => {
    const toolbar = document.querySelector('.kasir-toolbar');
    const tombol = toolbar ? [...toolbar.querySelectorAll('button')] : [];
    return tombol.map((b) => b.innerText.trim().replace(/\s+/g, ' '));
  });
  await hal.close();

  assert.equal(galat.length, 0, `galat konsol saat memuat K-03: ${galat.join(' | ')}`);
  assert.ok(
    hasil.every((l) => !/Diskon/.test(l)),
    `Diskon masih ada di toolbar (${JSON.stringify(hasil)}) padahal diskon_kasir mati — harus HILANG, bukan nonaktif`
  );
});

test('tombol yang tidak berlaku NONAKTIF dengan alasan terbaca: keranjang kosong → Diskon disabled + aria-describedby', async () => {
  const { hal, galat } = await bukaK03({ keadaan: 'normal' });
  const hasil = await hal.evaluate(() => {
    const toolbar = document.querySelector('.kasir-toolbar');
    const diskon = toolbar
      ? [...toolbar.querySelectorAll('button')].find((b) => /Diskon/.test(b.innerText))
      : null;
    if (!diskon) return { ada: false };
    const idAlasan = diskon.getAttribute('aria-describedby');
    const elAlasan = idAlasan ? document.getElementById(idAlasan) : null;
    return {
      ada: true,
      disabled: diskon.disabled,
      idAlasan,
      teksAlasan: elAlasan ? elAlasan.textContent.trim() : null,
    };
  });
  await hal.close();

  assert.equal(galat.length, 0, `galat konsol saat memuat K-03: ${galat.join(' | ')}`);
  assert.ok(hasil.ada, 'tombol Diskon tidak ditemukan di toolbar (keranjang kosong, diskon_kasir bawaan menyala)');
  assert.equal(hasil.disabled, true, 'Diskon tidak nonaktif padahal keranjang kosong');
  assert.ok(hasil.idAlasan, 'Diskon nonaktif tanpa `aria-describedby`');
  assert.ok(
    hasil.teksAlasan && hasil.teksAlasan.length > 0,
    `\`aria-describedby="${hasil.idAlasan}"\` menunjuk elemen dengan teks kosong/tidak ada`
  );
});

test('⛔ Item manual: kode dikenal masuk lewat jalur scan; kode asing → "Barcode tidak dikenali"', async () => {
  // --- kode dikenal ---------------------------------------------------
  {
    const { hal, galat } = await bukaK03();
    await hal.getByRole('button', { name: 'Item manual' }).click();
    await hal.waitForSelector('[role="dialog"]');
    const sebelum = await hal.locator('.kasir-baris').count();
    await hal.getByLabel('Kode barang').fill(KODE_BARCODE_FIXTURE);
    await hal.getByRole('button', { name: 'Tambah', exact: true }).click();
    await hal.waitForTimeout(300);
    const sesudah = await hal.locator('.kasir-baris').count();
    const dialogTertutup = (await hal.locator('[role="dialog"]').count()) === 0;
    await hal.close();
    assert.equal(galat.length, 0, `galat konsol (kode dikenal): ${galat.join(' | ')}`);
    assert.ok(dialogTertutup, 'dialog Item manual tetap terbuka sesudah kode dikenal ditambahkan');
    assert.ok(
      sesudah > sebelum,
      `baris keranjang tidak bertambah (${sebelum} → ${sesudah}) untuk kode fixture yang dikenal`
    );
  }

  // --- kode asing -------------------------------------------------------
  {
    const kodeAsing = '0000000000000';
    const { hal, galat } = await bukaK03();
    await hal.getByRole('button', { name: 'Item manual' }).click();
    await hal.waitForSelector('[role="dialog"]');
    const sebelum = await hal.locator('.kasir-baris').count();
    await hal.getByLabel('Kode barang').fill(kodeAsing);
    await hal.getByRole('button', { name: 'Tambah', exact: true }).click();
    await hal.waitForTimeout(300);
    const sesudah = await hal.locator('.kasir-baris').count();
    const isi = await hal.evaluate(() => document.body.innerText);
    await hal.close();
    assert.equal(galat.length, 0, `galat konsol (kode asing): ${galat.join(' | ')}`);
    assert.equal(sesudah, sebelum, 'baris keranjang bertambah untuk kode yang seharusnya tidak dikenal');
    // ⛔ Kalimat DISALIN dari `dipindai` (`Kasir.tsx`) — jalur scan dan jalur
    // Item manual harus mengucapkan hal yang PERSIS sama.
    assert.match(
      isi,
      new RegExp(`Barcode ${kodeAsing} tidak dikenali\\. Cari manual di daftar\\.`),
      `pesan kode asing tidak ditemukan. Terbaca: ${isi.slice(0, 300)}`
    );
  }
});

test('⛔ scanner global mati selama dialog toolbar terbuka', async () => {
  const { hal, galat } = await bukaK03();
  await hal.getByRole('button', { name: 'Item manual' }).click();
  await hal.waitForSelector('[role="dialog"]');
  const sebelum = await hal.locator('.kasir-baris').count();

  // Barcode "diketik" scanner lewat `keydown` PADA WINDOW (bukan pada field
  // fokus) — pola K-17, `pemindai-global.ts`. Dipancarkan dalam SATU
  // `evaluate` (sinkron) supaya jeda antar karakter jauh di bawah
  // `JEDA_MAKS_MS` (50ms) tanpa bergantung pada latensi round-trip Playwright.
  await hal.evaluate((kode) => {
    for (const ch of kode) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true, cancelable: true }));
    }
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  }, '8992761111017');
  await hal.waitForTimeout(300);

  const sesudah = await hal.locator('.kasir-baris').count();
  const dialogMasihTerbuka = (await hal.locator('[role="dialog"]').count()) === 1;
  await hal.close();

  assert.equal(galat.length, 0, `galat konsol: ${galat.join(' | ')}`);
  assert.ok(dialogMasihTerbuka, 'dialog Item manual tertutup sendiri — seharusnya hanya "Tambah"/"Batal" yang menutupnya');
  assert.equal(
    sesudah,
    sebelum,
    `keranjang berubah (${sebelum} → ${sesudah}) dari scan yang masuk SELAMA dialog toolbar terbuka — scanner global harus mati`
  );
});
