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
/** Label mockup yang SUDAH dibangun (Task 5, 5B). Task 10/11/12 menambah. */
const TERPASANG = new Set(['Item manual', 'Diskon', 'Pajak', 'Batalkan']);
/** Label NON-mockup yang masih di toolbar. KOSONG sejak Task 4 (Laci kas):
    Buka laci dan Kas masuk / keluar pindah ke layar K-18. */
const SEMENTARA = new Set([]);

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
  const { keadaan = 'normal', matikan = [], pajakKanal = false, layanan = false } = opsi;
  const hal = await peramban.newPage({ viewport: { width: 1280, height: 800 } });
  const galat = [];
  hal.on('pageerror', (e) => galat.push(e.message));
  hal.on('console', (m) => {
    if (m.type() === 'error') galat.push(m.text());
  });
  const q = new URLSearchParams({ layar: 'K-03', keadaan });
  if (matikan.length > 0) q.set('matikan', matikan.join(','));
  if (pajakKanal) q.set('pajakKanal', '1');
  if (layanan) q.set('layanan', '1');
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
      /* Pajak: label terlihat = kanal aktif ("Takeaway"/"Dine in"), jadi dicocokkan lewat NAMA AKSESIBEL
         berawalan "Pajak" (Q8, Task 10), bukan teks terlihat. */
      label: tombol.map((b) => {
        const aria = b.getAttribute('aria-label');
        return aria && /^Pajak/.test(aria) ? 'Pajak' : b.innerText.trim().replace(/\s+/g, ' ');
      }),
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

test('⛔ Diskon mati + keranjang kosong: teks alasan Diskon ikut HILANG (tidak ada sr-only yatim)', async () => {
  const { hal, galat } = await bukaK03({ keadaan: 'normal', matikan: ['diskon_kasir'] });
  const yatim = await hal.locator('#toolbar-diskon-alasan').count();
  await hal.close();
  assert.equal(galat.length, 0, `galat konsol: ${galat.join(' | ')}`);
  assert.equal(yatim, 0, 'teks alasan Diskon masih ada di DOM padahal tombolnya hilang — pembaca layar membacakan alasan untuk tombol yang tidak ada');
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
    // Kondisi, bukan jeda tetap; timeout dibiarkan lewat supaya assert di bawah yang menjelaskan.
    await hal
      .waitForFunction((n) => document.querySelectorAll('.kasir-baris').length > n, sebelum, { timeout: 3000 })
      .catch(() => {});
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
    await hal
      .waitForFunction((k) => document.body.innerText.includes(`Barcode ${k} tidak dikenali`), kodeAsing, {
        timeout: 3000,
      })
      .catch(() => {});
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

test('⛔ Item manual: kolom kode langsung terfokus dan Enter menambahkan (tanpa mouse)', async () => {
  const { hal, galat } = await bukaK03();
  await hal.getByRole('button', { name: 'Item manual' }).click();
  await hal.waitForSelector('[role="dialog"]');
  const sebelum = await hal.locator('.kasir-baris').count();
  const terfokus = await hal.evaluate(() => document.activeElement?.tagName === 'INPUT' && document.activeElement.closest('[role="dialog"]') !== null);
  await hal.keyboard.type(KODE_BARCODE_FIXTURE);
  await hal.keyboard.press('Enter');
  await hal
    .waitForFunction((n) => document.querySelectorAll('.kasir-baris').length > n, sebelum, { timeout: 3000 })
    .catch(() => {});
  const sesudah = await hal.locator('.kasir-baris').count();
  await hal.close();
  assert.equal(galat.length, 0, `galat konsol: ${galat.join(' | ')}`);
  assert.ok(terfokus, 'kolom Kode barang tidak terfokus saat dialog Item manual terbuka — scanner HID mengetik ke ruang kosong');
  assert.ok(sesudah > sebelum, `Enter di kolom kode tidak menambahkan barang (${sebelum} → ${sesudah})`);
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

// ---------------------------------------------------------------------------
// Task 5B — Batalkan keranjang dengan jejak `audit_event` (G-BATAL-AUDIT, sisi
// layar). Keputusan user 28 September 2026 (issue #76).
// ---------------------------------------------------------------------------

/** Penulisan yang dicatat db palsu galeri (`window.__galeriTulis`). */
const bacaTulis = (hal) => hal.evaluate(() => (window.__galeriTulis ?? []).map((t) => ({ sql: t.sql, params: t.params.map(String), dalam: t.dalam })));
const audit = (tulis) => tulis.filter((t) => /INSERT INTO audit_event/.test(t.sql));
const outbox = (tulis) => tulis.filter((t) => /INSERT INTO outbox_local/.test(t.sql));
const hapusKeranjang = (tulis) => tulis.filter((t) => /^DELETE FROM keranjang_lokal/.test(t.sql));

/** Tombol harus ADA — pesan yang menyebut apa yang dijaga, bukan timeout klik. */
async function pastikanTombol(hal, nama, keterangan) {
  const n = await hal.getByRole('button', { name: nama, exact: true }).count();
  assert.equal(n >= 1, true, `tombol "${nama}" tidak ada di K-03 (${keterangan})`);
}


/**
 * Sesudah mengklik pemicu Batalkan: KONFIRMASI harus muncul dan keranjang belum
 * berubah. Diperiksa dengan hitungan + pesan, BUKAN dengan menunggu selektor —
 * pemicu yang mengosongkan langsung (atau lewat handler lain tanpa audit)
 * harus gagal dengan kalimat yang menyebut konfirmasinya, bukan timeout 30 dtk.
 */
async function pastikanKonfirmasi(hal, sebelum, pemicu) {
  await hal.waitForSelector('[role="dialog"]', { timeout: 3000 }).catch(() => {});
  const sesudah = await keadaanKeranjang(hal);
  const dialog = await hal.locator('[role="dialog"]').count();
  assert.equal(
    sesudah.baris,
    sebelum.baris,
    `${pemicu} mengosongkan keranjang (${sebelum.baris} → ${sesudah.baris}) TANPA konfirmasi dan tanpa audit`
  );
  assert.equal(dialog, 1, `${pemicu} tidak membuka dialog konfirmasi "Kosongkan keranjang?" (dialog=${dialog})`);
  assert.equal(
    audit(await bacaTulis(hal)).length,
    0,
    `${pemicu} menulis audit SEBELUM konfirmasi`
  );
}

async function keadaanKeranjang(hal) {
  return hal.evaluate(() => ({
    baris: document.querySelectorAll('.kasir-baris').length,
    total: document.querySelector('.kasir-total .num')?.textContent ?? null,
    // Lencana qty `2×` (Task 6: keranjang tanpa stepper).
    qty: [...document.querySelectorAll('.kasir-baris .kasir-baris-qty')].reduce(
      (n, el) => n + Number((el.textContent ?? '0').replace('×', '').replace(',', '.')),
      0
    ),
  }));
}

test('⛔ Batalkan: konfirmasi "Kosongkan keranjang? N item", lalu keranjang kosong, keranjang_lokal hilang, dan SATU audit_event cart_cleared dengan total = Total yang tampil', async () => {
  const { hal, galat } = await bukaK03({ keadaan: 'keranjang-penuh' });
  await hal.waitForSelector('.kasir-baris');
  const sebelum = await keadaanKeranjang(hal);
  assert.ok(sebelum.baris > 0, 'fixture keranjang-penuh tidak punya baris');
  const totalTampil = sebelum.total.replace(/\D/g, '');
  assert.ok(totalTampil.length > 0, `Total tidak terbaca: ${sebelum.total}`);

  assert.equal((await bacaTulis(hal)).filter((t) => /audit_event/.test(t.sql)).length, 0, 'audit sudah ada sebelum konfirmasi');

  await pastikanTombol(hal, 'Batalkan', 'toolbar Batalkan belum terpasang');
  await hal.getByRole('button', { name: 'Batalkan', exact: true }).click();
  await pastikanKonfirmasi(hal, sebelum, 'tombol Batalkan');
  const teksDialog = await hal.locator('[role="dialog"]').innerText();
  assert.match(teksDialog, /Kosongkan keranjang\?/);
  assert.match(teksDialog, new RegExp(`${sebelum.qty} item`), `dialog tidak menyebut jumlah item ${sebelum.qty}: ${teksDialog}`);
  // Belum dikonfirmasi: belum ada yang tertulis.
  assert.equal(audit(await bacaTulis(hal)).length, 0, 'audit tertulis SEBELUM konfirmasi');

  await hal.getByRole('button', { name: 'Kosongkan', exact: true }).click();
  await hal.waitForFunction(() => document.querySelectorAll('.kasir-baris').length === 0, null, { timeout: 5000 });
  const tulis = await bacaTulis(hal);
  const dialogTertutup = (await hal.locator('[role="dialog"]').count()) === 0;
  await hal.close();

  assert.equal(galat.length, 0, `galat konsol: ${galat.join(' | ')}`);
  assert.ok(dialogTertutup, 'dialog konfirmasi tetap terbuka sesudah berhasil');
  assert.equal(audit(tulis).length, 0 + 1, `harus TEPAT satu audit_event; ada ${audit(tulis).length} — nol audit adalah cacat yang fitur ini cegah`);
  const p = audit(tulis)[0].params;
  assert.equal(p[5], 'cart_cleared', `event_type ${p[5]}`);
  assert.equal(p[6], 'shift-galeri', 'entity_id harus shift berjalan');
  assert.equal(p[4], 'user-galeri', `actor_user_id ${p[4]} != staf sesi (user-galeri)`);
  const after = JSON.parse(p[7]);
  assert.equal(after.total, totalTampil, `total audit ${after.total} != Total yang tampil ${totalTampil}`);
  assert.equal(after.line_count, sebelum.baris);
  assert.equal(after.quantity_milli / 1000, sebelum.qty);
  const antre = outbox(tulis);
  assert.equal(antre.length, 1, 'outbox harus tepat satu');
  assert.ok(antre[0].params.includes('cart_cleared'), 'entity_type outbox bukan cart_cleared');
  assert.ok(hapusKeranjang(tulis).length >= 1, 'baris keranjang_lokal tidak dihapus');
  // ⛔ Ketiganya DI DALAM transaksi (tx berbeda dari db di galeri): penghapusan
  // yang bocor keluar membuat keranjang kosong tanpa jejak bila perangkat mati.
  assert.equal(audit(tulis)[0].dalam, true, 'audit_event ditulis di LUAR transaksi');
  assert.equal(antre[0].dalam, true, 'outbox ditulis di LUAR transaksi');
  assert.ok(
    hapusKeranjang(tulis).some((t) => t.dalam),
    'DELETE keranjang_lokal tidak pernah terjadi DI DALAM transaksi jejaknya (bocor keluar/sesudah commit)'
  );
  assert.equal(antre[0].params.includes('user-galeri'), true, 'actor_id outbox bukan staf sesi');
});

test('⛔ batal di konfirmasi → keranjang utuh, nol audit', async () => {
  const { hal, galat } = await bukaK03({ keadaan: 'keranjang-penuh' });
  await hal.waitForSelector('.kasir-baris');
  const sebelum = await keadaanKeranjang(hal);
  const hapusAwal = hapusKeranjang(await bacaTulis(hal)).length;

  await pastikanTombol(hal, 'Batalkan', 'toolbar Batalkan belum terpasang');
  await hal.getByRole('button', { name: 'Batalkan', exact: true }).click();
  await pastikanKonfirmasi(hal, sebelum, 'tombol Batalkan');
  await hal.getByRole('button', { name: 'Batal', exact: true }).click();
  await hal.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 3000 }).catch(() => {});
  const sesudah = await keadaanKeranjang(hal);
  const tulis = await bacaTulis(hal);
  const dialogTertutup = (await hal.locator('[role="dialog"]').count()) === 0;
  await hal.close();

  assert.equal(galat.length, 0, `galat konsol: ${galat.join(' | ')}`);
  assert.ok(dialogTertutup, 'dialog tidak tertutup sesudah Batal');
  assert.equal(sesudah.baris, sebelum.baris, 'keranjang berubah padahal dibatalkan di konfirmasi');
  assert.equal(audit(tulis).length, 0, 'audit tertulis padahal kasir menekan Batal');
  assert.equal(outbox(tulis).length, 0, 'outbox tertulis padahal kasir menekan Batal');
  assert.equal(hapusKeranjang(tulis).length, hapusAwal, 'keranjang_lokal dihapus padahal kasir menekan Batal');
});

test('ikon tempat sampah kepala keranjang memanggil handler yang SAMA (audit tertulis juga)', async () => {
  const { hal, galat } = await bukaK03({ keadaan: 'keranjang-penuh' });
  await hal.waitForSelector('.kasir-baris');
  await pastikanTombol(hal, 'Kosongkan keranjang', 'ikon tempat sampah kepala keranjang belum ada');
  const sebelum = await keadaanKeranjang(hal);
  await hal.getByRole('button', { name: 'Kosongkan keranjang', exact: true }).click();
  await pastikanKonfirmasi(hal, sebelum, 'ikon tempat sampah (handler harus SAMA dengan Batalkan)');
  await hal.getByRole('button', { name: 'Kosongkan', exact: true }).click();
  await hal.waitForFunction(() => document.querySelectorAll('.kasir-baris').length === 0, null, { timeout: 5000 });
  const tulis = await bacaTulis(hal);
  await hal.close();

  assert.equal(galat.length, 0, `galat konsol: ${galat.join(' | ')}`);
  assert.equal(audit(tulis).length, 1, 'ikon tempat sampah tidak menulis audit_event');
  assert.equal(audit(tulis)[0].params[5], 'cart_cleared');
});

test('Batalkan dan ikon tempat sampah NONAKTIF dengan alasan saat keranjang kosong', async () => {
  const { hal, galat } = await bukaK03({ keadaan: 'normal' });
  const hasil = await hal.evaluate(() => {
    const baca = (b) => {
      if (!b) return { ada: false };
      const id = b.getAttribute('aria-describedby');
      const el = id ? document.getElementById(id) : null;
      return { ada: true, disabled: b.disabled, teks: el ? el.textContent.trim() : null };
    };
    const toolbar = document.querySelector('.kasir-toolbar');
    const batal = [...toolbar.querySelectorAll('button')].find((b) => /Batalkan/.test(b.innerText));
    const sampah = document.querySelector('button[aria-label="Kosongkan keranjang"]');
    return { batal: baca(batal), sampah: baca(sampah) };
  });
  await hal.close();

  assert.equal(galat.length, 0, `galat konsol: ${galat.join(' | ')}`);
  for (const [nama, h] of Object.entries(hasil)) {
    assert.ok(h.ada, `tombol ${nama} tidak ditemukan`);
    assert.equal(h.disabled, true, `${nama} tidak nonaktif padahal keranjang kosong`);
    assert.ok(h.teks && h.teks.length > 0, `${nama} nonaktif tanpa alasan terbaca`);
  }
});

async function konfirmasiGagal(kait, ringkas) {
  const { hal, galat } = await bukaK03({ keadaan: 'keranjang-penuh' });
  await hal.waitForSelector('.kasir-baris');
  const sebelum = await keadaanKeranjang(hal);
  const hapusAwal = hapusKeranjang(await bacaTulis(hal)).length;
  await pastikanTombol(hal, 'Batalkan', 'toolbar Batalkan belum terpasang');
  await hal.getByRole('button', { name: 'Batalkan', exact: true }).click();
  await pastikanKonfirmasi(hal, sebelum, 'tombol Batalkan');
  await hal.evaluate((k) => { window[k] = true; }, kait);
  await hal.getByRole('button', { name: 'Kosongkan', exact: true }).click();
  await hal.waitForTimeout(600);
  const sesudah = await keadaanKeranjang(hal);
  const dialog = await hal.locator('[role="dialog"]').count();
  const teksDialog = dialog > 0 ? await hal.locator('[role="dialog"]').innerText() : '';
  const tulis = await bacaTulis(hal);
  await hal.close();
  return { sebelum, sesudah, dialog, teksDialog, tulis, hapusAwal, galat };
}

test('⛔ shift TIDAK terbuka saat konfirmasi → keranjang TIDAK dikosongkan diam-diam, dialog menyatakannya, nol audit', async () => {
  const r = await konfirmasiGagal('__galeriShiftTutup');
  assert.equal(
    r.sesudah.baris,
    r.sebelum.baris,
    'keranjang DIKOSONGKAN padahal shift tidak terbuka dan tidak ada jejak audit (keranjang kosong tanpa jejak)'
  );
  assert.equal(r.dialog, 1, 'dialog tertutup padahal pembatalan ditolak (shift tidak terbuka)');
  assert.match(r.teksDialog, /Shift sudah tidak terbuka\. Keranjang TIDAK dibatalkan/, `dialog tidak menyatakan penolakan: ${r.teksDialog}`);
  assert.equal(audit(r.tulis).length, 0, 'audit tertulis untuk shift tidak terbuka');
  assert.equal(hapusKeranjang(r.tulis).length, r.hapusAwal, 'keranjang_lokal dihapus tanpa jejak');
});

test('⛔ penulisan jejak GAGAL (melempar) → dialog menahan dengan galat, keranjang UTUH, nol audit — tidak pernah "tercatat" palsu', async () => {
  const r = await konfirmasiGagal('__galeriGagalTulis');
  assert.equal(
    r.sesudah.baris,
    r.sebelum.baris,
    'keranjang DIKOSONGKAN padahal penulisan jejak gagal — kegagalan ditelan dan dianggap tercatat'
  );
  assert.equal(r.dialog, 1, 'dialog tertutup padahal penulisan jejak gagal');
  assert.match(r.teksDialog, /Keranjang TIDAK dibatalkan/, `dialog tidak menampilkan galat: ${r.teksDialog}`);
  assert.equal(audit(r.tulis).length, 0);
  assert.equal(outbox(r.tulis).length, 0);
  assert.equal(hapusKeranjang(r.tulis).length, r.hapusAwal, 'keranjang_lokal dihapus padahal jejak gagal');
});

// ---------------------------------------------------------------------------
// Task 10 — Pajak = pilihan kanal (FR-C7). G-KANAL / G-TANPA-LAYANAN.

const bukaLembarPajak = async (hal) => {
  await hal.getByRole('button', { name: /^Pajak:/ }).click();
  await hal.waitForSelector('[role="dialog"]');
  // Nama tarif datang dari `hitungKeranjang` secara asinkron — tunggu sampai tampil.
  await hal.waitForFunction(
    () => !/Membaca tarif/.test(document.querySelector('[role="dialog"]')?.innerText ?? ''),
    null,
    { timeout: 5000 }
  );
};
const teksDialog = (hal) => hal.locator('[role="dialog"]').innerText();
const barisRingkasan = (hal) =>
  hal.evaluate(() => [...document.querySelectorAll('.kasir-subtotal')].map((e) => e.innerText.replace(/\s+/g, ' ').trim()));

test('⛔ G-KANAL DOM: lembar Pajak menampilkan dua kanal dengan nama tarif masing-masing; memilih Dine in mengubah baris "Pajak · <nama tarif>" di keranjang', async () => {
  const { hal, galat } = await bukaK03({ keadaan: 'keranjang-penuh', pajakKanal: true });
  // Nama aksesibel + label terlihat = kanal aktif (Q8).
  const tombol = hal.getByRole('button', { name: 'Pajak: Takeaway', exact: true });
  assert.equal(await tombol.count(), 1, 'tombol toolbar tidak bernama aksesibel "Pajak: Takeaway"');
  assert.match(await tombol.innerText(), /^Takeaway$/, 'label terlihat bukan kanal aktif');
  await hal.waitForFunction(() => [...document.querySelectorAll('.kasir-subtotal')].some((e) => /PPN 11%/.test(e.innerText)), null, { timeout: 5000 });
  const sebelum = (await barisRingkasan(hal)).filter((b) => /PPN 11%|PBJT 10%/.test(b));

  await bukaLembarPajak(hal);
  const lembar = await teksDialog(hal);
  assert.match(lembar, /Takeaway · PPN 11%/, `lembar tanpa "Takeaway · PPN 11%": ${lembar}`);
  assert.match(lembar, /Dine in · PBJT 10%/, `lembar tanpa "Dine in · PBJT 10%": ${lembar}`);
  assert.doesNotMatch(lembar, /Tarif sama untuk kedua kanal/, 'kedua kanal berbeda tarif, tetapi lembar mengklaim sama');

  await hal.getByRole('button', { name: /^Dine in · PBJT 10%/ }).click();
  await hal.waitForFunction(() => document.querySelectorAll('[role="dialog"]').length === 0);
  await hal.waitForFunction(() => [...document.querySelectorAll('.kasir-subtotal')].some((e) => /PBJT 10%/.test(e.innerText)), null, { timeout: 5000 });
  const sesudah = (await barisRingkasan(hal)).filter((b) => /PPN 11%|PBJT 10%/.test(b));
  const namaBaru = await hal.getByRole('button', { name: 'Pajak: Dine in', exact: true }).count();
  await hal.close();

  assert.equal(galat.length, 0, `galat konsol: ${galat.join(' | ')}`);
  assert.equal(namaBaru, 1, 'nama aksesibel tidak berubah jadi "Pajak: Dine in"');
  assert.ok(sebelum.length === 1 && /PPN 11%/.test(sebelum[0]), `sebelum: harap baris PPN 11% saja, terbaca ${JSON.stringify(sebelum)}`);
  assert.ok(sesudah.length === 1 && /PBJT 10%/.test(sesudah[0]), `sesudah memilih Dine in: harap baris PBJT 10% saja, terbaca ${JSON.stringify(sesudah)}`);
});

test('outlet tanpa tarif per kanal: kedua pilihan menyebut tarif yang sama DAN lembarnya mengatakan itu', async () => {
  const { hal, galat } = await bukaK03({ keadaan: 'keranjang-penuh' });
  await bukaLembarPajak(hal);
  const lembar = await teksDialog(hal);
  await hal.close();
  assert.equal(galat.length, 0, `galat konsol: ${galat.join(' | ')}`);
  assert.match(lembar, /Takeaway · PPN 11%/);
  assert.match(lembar, /Dine in · PPN 11%/, `Dine in tidak menyebut tarif yang sama: ${lembar}`);
  assert.match(lembar, /Tarif sama untuk kedua kanal/, 'kedua kanal sama tarif, lembar tidak mengatakannya');
});

test('Pajak NONAKTIF dengan alasan terbaca saat keranjang kosong (Aturan tombol §4)', async () => {
  const { hal, galat } = await bukaK03({ keadaan: 'normal' });
  const hasil = await hal.evaluate(() => {
    const b = [...document.querySelectorAll('.kasir-toolbar button')].find((x) => /^Pajak/.test(x.getAttribute('aria-label') ?? ''));
    if (!b) return null;
    const id = b.getAttribute('aria-describedby');
    return { disabled: b.disabled, alasan: id ? document.getElementById(id)?.textContent.trim() : null };
  });
  await hal.close();
  assert.equal(galat.length, 0, `galat konsol: ${galat.join(' | ')}`);
  assert.ok(hasil, 'tombol Pajak tidak ada');
  assert.equal(hasil.disabled, true);
  assert.ok(hasil.alasan && hasil.alasan.length > 0, 'Pajak nonaktif tanpa alasan terbaca');
});

test('⛔ G-TANPA-LAYANAN DOM: Dine in dipilih, outlet galeri dengan service_charge_rate bukan nol → tidak ada teks /layanan|service/i di lembar Pajak dan keranjang', async () => {
  const { hal, galat } = await bukaK03({ keadaan: 'keranjang-penuh', pajakKanal: true, layanan: true });
  await bukaLembarPajak(hal);
  const lembar = await teksDialog(hal);
  await hal.getByRole('button', { name: /^Dine in · PBJT 10%/ }).click();
  await hal.waitForFunction(() => document.querySelectorAll('[role="dialog"]').length === 0);
  await hal.waitForFunction(() => [...document.querySelectorAll('.kasir-subtotal')].some((e) => /PBJT 10%/.test(e.innerText)), null, { timeout: 5000 });
  const ringkasan = (await barisRingkasan(hal)).join(' | ');
  const seluruh = await hal.evaluate(() => document.body.innerText);
  await hal.close();

  assert.equal(galat.length, 0, `galat konsol: ${galat.join(' | ')}`);
  assert.match(ringkasan, /PBJT 10%/, 'fixture: kanal Dine in tidak sampai ke keranjang');
  for (const [nama, teks] of [['lembar Pajak', lembar], ['ringkasan keranjang', ringkasan], ['seluruh K-03', seluruh]]) {
    assert.doesNotMatch(teks, /layanan|service/i, `${nama} menyiratkan biaya layanan: ${teks.match(/.{0,30}(layanan|service).{0,30}/i)?.[0]}`);
  }
});
