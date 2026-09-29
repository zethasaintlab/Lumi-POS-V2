'use strict';

// G-HEADER, G-KELUAR, lonceng, pita, dan label cari — Task 3 kampanye
// Hidupkan desain (26 September 2026, PR 2A sub-proyek 2 Kasir).
//
// ## ⛔ Kenapa header, keluar, lonceng, pita, dan label cari BERBAGI satu
//    berkas
//
// Kelimanya lahir dari SATU perubahan struktur — `.kasir-topbar` +
// `.kasir-bilah` digabung jadi `.kasir-header`, `SLOT_AKSI`/`PortalAksi`
// dihapus — dan penjaga terpisah untuk masing-masing akan menduplikasi
// boilerplate server+Chromium lima kali untuk hal yang sebenarnya satu
// pertanyaan: apakah header satu baris BENAR sekaligus tidak merusak apa
// pun di sekelilingnya (Keluar, lonceng, pita, label cari).
//
// ## ⛔ Kenapa viewport SELALU 1280×800, dan "1024" datang dari CSS override
//
// `galeri.css` menyusutkan panggung (`transform: scale`) untuk jendela
// peramban < 1088px — mekanisme itu untuk MELIHAT galeri di HP, bukan
// bagian dari layar kasir. Membuka Playwright persis di lebar 1024 memicu
// penyusutan itu dan membuat setiap pengukuran piksel SALAH tanpa satu pun
// error. Pola yang benar (disalin dari `k03-kepadatan.test.js`): viewport
// SELALU 1280×800 (di atas ambang 1088px), dan panggung 1024×768 didapat
// dari nilai BAWAAN `.galeri-panggung > *` — hanya "1280" yang perlu
// override CSS eksplisit.
//
// ## Prasyarat
//
//   npm run build:galeri
//
// Lihat kepala `k03-chrome.test.js` untuk alasan "MENEGASKAN, bukan
// membangun".

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
 * Membuka K-03 dan mengembalikan panggung pada lebar 1024 ATAU 1280.
 *
 * `lebar === 1280` menimpa `.galeri-panggung > *` lewat CSS injeksi (pola
 * `k03-kepadatan.test.js`); `lebar === 1024` memakai nilai BAWAAN.
 */
async function buka(keadaan, lebar) {
  const hal = await peramban.newPage({ viewport: { width: 1280, height: 800 } });
  const galat = [];
  hal.on('pageerror', (e) => galat.push(e.message));
  hal.on('console', (m) => {
    if (m.type() === 'error' && /Failed to load resource/.test(m.text())) return;
    if (m.type() === 'error') galat.push(m.text());
  });
  await hal.goto(`${alamat}/harness-galeri.html?layar=K-03&keadaan=${keadaan}`, { waitUntil: 'load' });
  if (lebar === 1280) {
    await hal.addStyleTag({
      content:
        '.galeri-bar,.galeri-tanya{display:none!important}' +
        '.galeri-panggung{padding:0!important;overflow:hidden!important}' +
        '.galeri-panggung>*{width:1280px!important;height:800px!important;border:0!important;border-radius:0!important;box-shadow:none!important}',
    });
  }
  await hal.waitForSelector('.kasir-header', { timeout: 10_000 });
  await hal.evaluate(() => document.fonts.ready);
  await hal.waitForTimeout(800);
  return { hal, galat };
}

// ---------------------------------------------------------------------------
// G-HEADER
// ---------------------------------------------------------------------------

/** Nilai hex `--nama:` di blok `:root` teratas `tokens-mockup.css`. */
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
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}
const PRIMARY_RGB = hexKeRgb(bacaRootHex(path.join(AKAR, 'packages/ds/tokens-mockup.css'))['--primary']);

async function ukurHeader(hal) {
  return hal.evaluate((primaryRgb) => {
    const header = document.querySelector('.kasir-header');
    if (!header) return { err: '.kasir-header tidak ada' };
    const rHeader = header.getBoundingClientRect();
    const anak = [...header.children];
    if (anak.length === 0) return { err: '.kasir-header tidak punya anak' };
    const kotak = anak.map((a) => a.getBoundingClientRect());
    const pusat = kotak.map((r) => r.top + r.height / 2);

    const tabs = [...header.querySelectorAll('[role="tab"]')];
    const tabAktif = tabs.find((t) => t.getAttribute('aria-selected') === 'true');
    const labelAktif = tabAktif ? tabAktif.querySelector('span') : null;
    const ikonAktif = tabAktif ? tabAktif.querySelector('svg') : null;

    const tombolPengguna = document.querySelector('.kasir-menu-pengguna-tombol');
    const namaSpan = tombolPengguna ? tombolPengguna.querySelector('.kasir-menu-pengguna-teks > span:first-child') : null;
    const outletSpan = tombolPengguna ? tombolPengguna.querySelector('.kasir-menu-pengguna-teks > span:last-child') : null;

    return {
      tinggiHeader: Math.round(rHeader.height),
      pusatMin: Math.min(...pusat),
      pusatMax: Math.max(...pusat),
      semuaDalamHeader: kotak.every((r) => r.top >= rHeader.top - 0.5 && r.bottom <= rHeader.bottom + 0.5),
      semuaDalamHeaderMendatar: kotak.every((r) => r.left >= rHeader.left - 0.5 && r.right <= rHeader.right + 0.5),
      luapMendatar: { scroll: header.scrollWidth, client: header.clientWidth },
      jumlahTab: tabs.length,
      lebarTabMin: tabs.length ? Math.min(...tabs.map((t) => t.getBoundingClientRect().width)) : 0,
      labelAktifUkuran: labelAktif ? getComputedStyle(labelAktif).fontSize : null,
      labelAktifBobot: labelAktif ? getComputedStyle(labelAktif).fontWeight : null,
      ikonAktifTinggi: ikonAktif ? Math.round(ikonAktif.getBoundingClientRect().height) : null,
      ikonDiAtasLabel: ikonAktif && labelAktif ? ikonAktif.getBoundingClientRect().bottom <= labelAktif.getBoundingClientRect().top + 1 : null,
      tabAktifAda: !!tabAktif,
      warnaTabAktif: tabAktif ? getComputedStyle(tabAktif).color : null,
      warnaCocok: tabAktif ? getComputedStyle(tabAktif).color === primaryRgb : null,
      teksTombolPengguna: tombolPengguna ? tombolPengguna.innerText.trim().replace(/\s+/g, ' ') : null,
      outletTerbaca: outletSpan ? outletSpan.textContent.trim() : null,
      namaScrollWidth: namaSpan ? namaSpan.scrollWidth : null,
      namaClientWidth: namaSpan ? namaSpan.clientWidth : null,
      tabScroll: tabs.map((t) => ({ scroll: t.scrollWidth, client: t.clientWidth })),
    };
  }, PRIMARY_RGB);
}

for (const lebar of [1024, 1280]) {
  for (const keadaan of ['normal', 'panjang', 'antrean-panjang']) {
    test(`⛔ G-HEADER: satu baris 68 px pada ${lebar}, keadaan ${keadaan}`, async (t) => {
      const { hal, galat } = await buka(keadaan, lebar);
      const u = await ukurHeader(hal);
      await hal.close();

      t.diagnostic(`${lebar}/${keadaan}: ${JSON.stringify(u)}`);
      assert.equal(galat.length, 0, `galat konsol di ${lebar}/${keadaan}: ${galat.join(' | ')}`);
      assert.equal(u.err, undefined, u.err);

      assert.ok(
        Math.abs(u.tinggiHeader - 68) <= 1,
        `header tingginya ${u.tinggiHeader}px pada ${lebar}/${keadaan}, bukan 68 ± 1px.`
      );
      assert.ok(
        u.semuaDalamHeader,
        `ada anak header yang keluar dari kotak header pada ${lebar}/${keadaan} — header MEMBUNGKUS.`
      );
      assert.ok(
        u.semuaDalamHeaderMendatar,
        `ada anak header yang keluar dari kotak header SECARA MENDATAR pada ${lebar}/${keadaan} ` +
          `(scrollWidth ${u.luapMendatar.scroll} > clientWidth ${u.luapMendatar.client}) — header meluap ke samping, ` +
          'menu pengguna terdorong ke luar layar.'
      );
      assert.ok(
        u.pusatMax - u.pusatMin <= 4,
        `pusat vertikal anak header berselisih ${(u.pusatMax - u.pusatMin).toFixed(1)}px pada ` +
          `${lebar}/${keadaan} (> 4px) — ada yang tidak sejajar, tanda header membungkus.`
      );

      assert.equal(u.jumlahTab, 4, `header punya ${u.jumlahTab} tab, bukan 4 (Kasir · Riwayat · Laci kas · Tutup shift).`);
      assert.ok(u.lebarTabMin >= 76, `tab tersempit ${u.lebarTabMin}px, spec § 3 menuntut >= 76px.`);
      assert.equal(u.labelAktifUkuran, '13px', `label tab aktif ${u.labelAktifUkuran}, bukan 13px.`);
      assert.equal(u.labelAktifBobot, '600', `label tab aktif bobot ${u.labelAktifBobot}, bukan 600.`);
      assert.equal(u.ikonAktifTinggi, 18, `ikon tab aktif ${u.ikonAktifTinggi}px, bukan 18px.`);
      assert.ok(u.ikonDiAtasLabel, 'ikon tab aktif tidak berada DI ATAS labelnya.');
      assert.ok(u.tabAktifAda, 'tidak ada tab dengan aria-selected="true".');
      assert.ok(
        u.warnaCocok,
        `warna tab aktif ${u.warnaTabAktif}, bukan --primary (${PRIMARY_RGB}).`
      );

      assert.ok(u.teksTombolPengguna, 'tombol pengguna tidak ditemukan.');
      assert.ok(
        u.outletTerbaca && u.outletTerbaca.includes('·'),
        `teks "outlet · device" tidak terbaca di tombol pengguna: "${u.outletTerbaca}".`
      );
    });
  }
}

// R2 (spec § 14): bila header tidak muat pada 1024, NAMA pengguna yang
// terpotong lebih dulu — bukan tab.
test('⛔ R2: pada 1024, nama pengguna panjang terpotong ellipsis, keempat tab tetap utuh', async (t) => {
  const { hal, galat } = await buka('panjang', 1024);
  const u = await ukurHeader(hal);
  await hal.close();
  assert.equal(galat.length, 0, `galat konsol: ${galat.join(' | ')}`);
  t.diagnostic(JSON.stringify(u));

  /* ⛔ STRICT `<`, bukan `<=`. Versi pertama penjaga ini memakai `<=` (lewat
     `< scrollWidth + 1`), yang HIJAU KARENA HAMPA saat scrollWidth ===
     clientWidth — yaitu TIDAK ADA pemotongan sama sekali. Ditemukan lewat
     pengukuran DOM (412 === 412) pada sabotase `align-items: flex-start` di
     `.kasir-menu-pengguna-teks`, bukan dengan membaca CSS. */
  assert.ok(
    u.namaClientWidth > 0 && u.namaClientWidth < u.namaScrollWidth,
    `nama pengguna tidak terpotong pada 1024 (scrollWidth ${u.namaScrollWidth}, clientWidth ` +
      `${u.namaClientWidth}) — nama panjang seharusnya di-ellipsis, bukan meluap.`
  );
  for (const [i, s] of u.tabScroll.entries()) {
    assert.ok(
      s.scroll <= s.client + 1,
      `tab ke-${i + 1} terpotong (scrollWidth ${s.scroll} > clientWidth ${s.client}) — R2 menuntut ` +
        'tab tetap UTUH, nama pengguna yang mengalah lebih dulu.'
    );
  }
});

// ---------------------------------------------------------------------------
// G-KELUAR
// ---------------------------------------------------------------------------

async function bukaMenu(hal) {
  await hal.locator('.kasir-menu-pengguna-tombol').click();
  await hal.locator('.kasir-menu-pengguna-daftar').waitFor({ state: 'visible', timeout: 5_000 });
}

test('⛔ G-KELUAR: antrean tidak kosong (offline) — Keluar menampilkan pesan FR-H4, sesi tetap', async () => {
  const { hal, galat } = await buka('offline', 1280);
  await bukaMenu(hal);
  await hal.getByRole('menuitem', { name: 'Keluar' }).click();
  await hal.waitForTimeout(300);

  const hasil = await hal.evaluate(() => ({
    headerAda: !!document.querySelector('.kasir-header'),
    pesan: document.querySelector('.kasir-menu-pengguna-daftar [role="alert"]')?.textContent ?? null,
    menuMasihAda: !!document.querySelector('.kasir-menu-pengguna-daftar'),
  }));
  await hal.close();

  assert.equal(galat.length, 0, `galat konsol: ${galat.join(' | ')}`);
  assert.ok(hasil.headerAda, 'header hilang sesudah Keluar ditolak — shell seharusnya tetap ada.');
  assert.ok(hasil.menuMasihAda, 'menu tertutup meski Keluar DITOLAK — kasir tidak sempat membaca pesannya.');
  assert.ok(
    hasil.pesan && /belum terkirim/.test(hasil.pesan),
    `pesan FR-H4 tidak tampil apa adanya. Didapat: "${hasil.pesan}"`
  );
});

test('⛔ G-KELUAR: antrean kosong (normal) — Keluar memanggil keluar() dan berhasil', async () => {
  const { hal, galat } = await buka('normal', 1280);
  await bukaMenu(hal);
  await hal.getByRole('menuitem', { name: 'Keluar' }).click();
  await hal.waitForTimeout(300);

  /* ⛔ [EKSPLORASI] Galeri tidak menavigasi ke K-01 berdasarkan sesi
     (`Galeri.tsx` selalu merender `layarId` yang dipilih terlepas dari
     `useSesi()`), dan header menerima `pengguna` sebagai PROP statis dari
     `Galeri.tsx`, bukan turunan `useSesi()` — mengubah keduanya di luar
     lingkup Task 3. Penanda `[data-keluar="selesai"]` di `MenuPengguna.tsx`
     adalah bukti PALING MINIMAL bahwa `keluar()` sungguh dipanggil dan
     sungguh berhasil (`{ berhasil: true }`), dicatat di laporan task. */
  const hasil = await hal.evaluate(() => ({
    selesai: document.querySelector('[data-keluar="selesai"]') !== null,
    headerAda: !!document.querySelector('.kasir-header'),
  }));
  await hal.close();

  assert.equal(galat.length, 0, `galat konsol: ${galat.join(' | ')}`);
  assert.ok(hasil.headerAda, 'header hilang sesudah Keluar berhasil.');
  assert.ok(hasil.selesai, 'tidak ada penanda bahwa keluar() berhasil (antrean kosong seharusnya mengizinkan).');
});

// ---------------------------------------------------------------------------
// Lonceng — P7(a)
// ---------------------------------------------------------------------------

test('⛔ lonceng: membuka panel "Pemberitahuan perangkat"; gagal kirim tampil sebagai TEKS angka', async () => {
  const { hal, galat } = await buka('offline', 1280);
  await hal.locator('.kasir-lonceng').click();
  await hal.locator('.kasir-panel-pemberitahuan').waitFor({ state: 'visible', timeout: 5_000 });
  await hal.waitForTimeout(500);

  const hasil = await hal.evaluate(() => {
    const panel = document.querySelector('.kasir-panel-pemberitahuan');
    const judul = panel?.querySelector('h2')?.textContent.trim() ?? null;
    const baris = [...(panel?.querySelectorAll('li') ?? [])].map((li) => li.innerText.trim());
    return { judul, baris };
  });
  await hal.close();

  assert.equal(galat.length, 0, `galat konsol: ${galat.join(' | ')}`);
  assert.equal(hasil.judul, 'Pemberitahuan perangkat', `judul panel "${hasil.judul}".`);

  /* Fixture `offline`: 3 gagal kirim (`skenario.ts` `antreanUntuk`). Angkanya
     harus terbaca sebagai TEKS di salah satu baris — aturan design system
     #5, "status tidak pernah warna saja". */
  assert.ok(
    hasil.baris.some((b) => /\b3\b/.test(b) && /gagal/i.test(b)),
    `jumlah gagal kirim (3) tidak tampil sebagai teks di panel. Baris: ${JSON.stringify(hasil.baris)}`
  );
});

// ---------------------------------------------------------------------------
// Pita FR-H8 setinggi banner mockup
// ---------------------------------------------------------------------------

test('⛔ pita FR-H8: tinggi <= 36px pada gambar-antrean, teks 13px, kalimat tidak berubah', async (t) => {
  const { hal, galat } = await buka('gambar-antrean', 1024);
  const u = await hal.evaluate(() => {
    const pita = document.querySelector('.kasir-pita');
    const teks = pita?.querySelector('span.grow');
    return {
      ada: !!pita,
      tinggi: pita ? Math.round(pita.getBoundingClientRect().height) : null,
      teksUkuran: teks ? getComputedStyle(teks).fontSize : null,
      kalimat: teks ? teks.textContent : null,
    };
  });
  await hal.close();
  t.diagnostic(JSON.stringify(u));

  assert.equal(galat.length, 0, `galat konsol: ${galat.join(' | ')}`);
  assert.ok(u.ada, 'pita FR-H8 tidak ditemukan di skenario `gambar-antrean`.');
  assert.ok(u.tinggi <= 36, `tinggi pita ${u.tinggi}px, spec § 3/§ 14 menuntut <= 36px (banner mockup).`);
  assert.equal(u.teksUkuran, '13px', `teks pita ${u.teksUkuran}, bukan 13px.`);
  /* ⛔ SALINAN kalimat hari ini (`PitaAntrean.tsx`, `pesanAntreanMenua`), bukan
     dikarang di sini — kalimat, syarat, dan tautannya TIDAK berubah Task 3. */
  assert.equal(
    u.kalimat,
    'Ada penjualan yang belum tercatat di server sejak 4 jam lalu. Penjualan tetap dapat dilanjutkan; sambungkan internet bila memungkinkan.'
  );
});

// ---------------------------------------------------------------------------
// Label "Cari produk" tersembunyi VISUAL saja (tambahan user, R1)
// ---------------------------------------------------------------------------

test('⛔ label "Cari produk" tersembunyi secara VISUAL saja: sr-only, htmlFor terhubung, getByLabel menemukan', async () => {
  const { hal, galat } = await buka('normal', 1280);

  const cocok = hal.getByLabel('Cari produk');
  await assert.doesNotReject(cocok.waitFor({ state: 'attached', timeout: 5_000 }));
  assert.equal(await cocok.count(), 1, 'getByLabel("Cari produk") tidak menemukan tepat satu input.');
  assert.equal(await cocok.evaluate((e) => e.tagName), 'INPUT');

  const label = await hal.evaluate(() => {
    const input = document.querySelector('.kasir-kontrol-grid input.field');
    if (!input || !input.id) return { err: 'input Cari produk atau id-nya tidak ada' };
    const lbl = document.querySelector(`label[for="${input.id}"]`);
    if (!lbl) return { err: `label[for="${input.id}"] tidak ada` };
    const r = lbl.getBoundingClientRect();
    const cs = getComputedStyle(lbl);
    return {
      teks: lbl.textContent.trim(),
      lebar: r.width,
      tinggi: r.height,
      clip: cs.clip,
      clipPath: cs.clipPath,
      display: cs.display,
      visibility: cs.visibility,
      ariaHidden: lbl.getAttribute('aria-hidden'),
    };
  });
  await hal.close();

  assert.equal(galat.length, 0, `galat konsol: ${galat.join(' | ')}`);
  assert.equal(label.err, undefined, label.err);
  assert.equal(label.teks, 'Cari produk');
  assert.notEqual(label.display, 'none', 'label `display: none` — nama aksesibel ikut hilang.');
  assert.notEqual(label.visibility, 'hidden', 'label `visibility: hidden` — nama aksesibel ikut hilang.');
  assert.ok(label.ariaHidden === null || label.ariaHidden === 'false', 'label `aria-hidden` — nama aksesibel diputus.');

  const kotakKecil = label.lebar <= 1 && label.tinggi <= 1;
  const terpotong = (label.clip && label.clip !== 'auto') || (label.clipPath && label.clipPath !== 'none');
  assert.ok(
    kotakKecil || terpotong,
    `label "Cari produk" masih terlihat: ${label.lebar}×${label.tinggi}px, clip=${label.clip}, ` +
      `clip-path=${label.clipPath} — bukan sr-only.`
  );
});
