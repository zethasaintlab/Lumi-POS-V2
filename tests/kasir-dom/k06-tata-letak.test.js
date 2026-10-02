'use strict';

// K-06 — tata letak kartu pembayaran menurut mockup, di bawah sembilan
// penjaga `k06-penjaga.test.js`.
//
// ⛔ DIGANTI keputusan kampanye Hidupkan desain (26 September 2026, spec § 7
// "Target mockup"): K-06 kini HALAMAN di dalam `kasir-konten` (header tetap),
// bukan overlay. Total di blok ATAS (32/700), segmented empat tab 40 px di
// wadah `--secondary`, tautan campuran terlihat tanpa gulir, "Konfirmasi bayar" 56 px kanan
// bawah, "Kembali ke kasir" di atas kartu. Catatan 1-4 di bawah adalah riwayat
// Fase 3.2 yang digantikan.
//
// Fase 3.2 rebuild UI kasir (`docs/RENCANA-REBUILD-UI.md`). Selisih "dapat
// dikejar" di `docs/referensi-visual/BANDING.md` § K-06, diukur di DOM galeri
// (overlay sungguhan di atas K-03, bukan harness tanpa shell):
//
//   1. Kartu selebar mockup, 728 px (sebelumnya 896).
//   2. Pemilih metode SATU baris (mockup: segmented satu baris), bukan 2×2.
//      Setiap tombol tetap 56 px — memilih metode adalah aksi uang (DS #3);
//      tab 44 px mockup ditolak (#10).
//   3. Total 32 px (`--text-display`), label 20 px. Letaknya TETAP di blok aksi
//      yang menempel: P9 menjaga Total di sana, dan angka yang ditagih duduk
//      di samping tombol yang menagihnya. Mockup menaruhnya di atas — ditolak.
//   4. Aksi utama di kanan bawah, bukan selebar kartu (mockup 198×56); aksi
//      sekunder di baris yang sama, di kiri.
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

const LEBAR_MOCKUP = 728;

/* Pola `k03-kepadatan.test.js`: `lebar` 1024 = panggung galeri asli,
   1280 = panggung dilepas ke 1280×800. */
async function bukaK06(lebar) {
  const hal = await peramban.newPage({ viewport: { width: 1280, height: 800 } });
  const galat = [];
  hal.on('pageerror', (e) => galat.push(e.message));
  await hal.route('**/health', (r) => r.fulfill({ status: 200, body: 'ok' }));
  await hal.goto(`${alamat}/harness-galeri.html?layar=K-03&keadaan=keranjang-penuh`, { waitUntil: 'load' });
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
  await hal.waitForTimeout(800);
  await hal.getByRole('button', { name: 'Bayar', exact: true }).click();
  await hal.waitForSelector('.kasir-bayar-aksi', { timeout: 10_000 });
  await hal.waitForTimeout(600);
  return { hal, galat };
}

async function ukur(hal) {
  return hal.evaluate(() => {
    const r = (e) => {
      const x = e.getBoundingClientRect();
      return { l: Math.round(x.left), t: Math.round(x.top), r: Math.round(x.right), b: Math.round(x.bottom), w: Math.round(x.width), h: Math.round(x.height) };
    };
    const panggung = r(document.querySelector('.galeri-panggung > *'));
    const kartu = document.querySelector('.kasir-bayar');
    const aksi = document.querySelector('.kasir-bayar-aksi');
    const daftarTab = document.querySelector('[role="tablist"][aria-label="Metode pembayaran"]');
    const tot = document.querySelector('.kasir-bayar-total');
    const gaya = (e) => (e ? `${getComputedStyle(e).fontSize}/${getComputedStyle(e).fontWeight}` : null);
    const primer = aksi.querySelector('.btn-primary');
    const kembali = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Kembali ke kasir'));
    const metode = document.querySelector('.kasir-bayar-metode');
    const tautan = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Bayar dengan lebih dari satu metode');
    const tr = tautan?.getBoundingClientRect();
    const titik = tr ? document.elementFromPoint(tr.left + tr.width / 2, tr.top + tr.height / 2) : null;
    const lihat = document.querySelector('.galeri-panggung > *').getBoundingClientRect();
    const probe = document.createElement('div');
    probe.style.background = 'var(--secondary)';
    document.body.appendChild(probe);
    const secondary = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return {
      panggung,
      kartu: r(kartu),
      header: document.querySelector('.kasir-header') ? r(document.querySelector('.kasir-header')) : null,
      grid: document.querySelectorAll('.kasir-grid').length,
      overlay: document.querySelectorAll('.kasir-overlay-bayar').length,
      daftarTab: { ...r(daftarTab), latar: getComputedStyle(daftarTab).backgroundColor },
      secondary,
      tab: [...daftarTab.querySelectorAll('[role="tab"]')].map((b) => ({ nama: b.textContent.trim(), ...r(b) })),
      totalLabel: tot?.firstElementChild ? gaya(tot.firstElementChild) : null,
      totalNilai: gaya(tot?.querySelector('.num')),
      total: tot ? r(tot) : null,
      metode: metode ? r(metode) : null,
      tautan: tautan ? r(tautan) : null,
      tautanTerlihat: tautan ? titik === tautan || tautan.contains(titik) : false,
      panggungBawah: Math.round(lihat.bottom),
      aksi: r(aksi),
      primer: primer && { teks: primer.textContent.trim(), ...r(primer) },
      kembali: kembali && r(kembali),
    };
  });
}

// ---------------------------------------------------------------------------

for (const lebar of [1024, 1280]) {
  test(`⛔ ${lebar}: kartu pembayaran ${LEBAR_MOCKUP} px di dalam shell, segmented empat tab 40 px di wadah --secondary, tautan campuran terlihat TANPA gulir`, async (t) => {
    const { hal, galat } = await bukaK06(lebar);
    const u = await ukur(hal);
    await hal.close();
    t.diagnostic(JSON.stringify(u));
    assert.deepEqual(galat, []);
    /* SENTINEL: panggung selebar yang diklaim, dan keempat tab dirender. */
    assert.equal(u.panggung.w, lebar);
    assert.deepEqual(
      u.tab.map((m) => m.nama),
      ['Tunai', 'QRIS', 'Kartu', 'Transfer'],
      'segmented tidak memuat keempat tab'
    );
    assert.ok(u.header !== null && u.header.h === 68, `header tidak terlihat selama K-06: ${JSON.stringify(u.header)}`);
    assert.equal(u.grid, 0, 'grid K-03 masih di DOM selama K-06');
    assert.equal(u.overlay, 0, 'K-06 masih dirender sebagai overlay, bukan halaman di dalam shell');
    assert.ok(Math.abs(u.kartu.w - Math.min(LEBAR_MOCKUP, lebar)) <= 2, `kartu pembayaran ${u.kartu.w} px — mockup ${LEBAR_MOCKUP} (±2)`);
    assert.ok(u.kartu.t >= u.header.b, `kartu (atas ${u.kartu.t}) menimpa header (bawah ${u.header.b})`);
    const puncak = new Set(u.tab.map((m) => m.t));
    assert.equal(puncak.size, 1, `segmented ${puncak.size} baris — mockup satu baris`);
    assert.equal(u.daftarTab.h, 40, `segmented ${u.daftarTab.h} px — mockup 40`);
    assert.equal(u.daftarTab.latar, u.secondary, `wadah segmented ${u.daftarTab.latar}, bukan --secondary (${u.secondary})`);
    /* ⛔ Yang diukur AREA TERLIHAT, bukan kotak `min-height`: tautan pembayaran
       campuran (di bawah isi metode, di dalam `.kasir-bayar-isi` yang menggulir)
       harus terlihat tanpa gulir dan tidak tertutup blok aksi. Versi lama
       mengukur tinggi kotak >= 355 dan hijau selagi tautannya jatuh di bawah
       lipatan (1024×768: atas 735 vs terlihat sampai 542). */
    assert.ok(u.tautan, 'tautan "Bayar dengan lebih dari satu metode" tidak ada');
    assert.ok(
      u.tautan.b <= u.aksi.t && u.tautan.b <= u.panggungBawah,
      `tautan campuran DI BAWAH LIPATAN: bawah ${u.tautan.b}, blok aksi mulai ${u.aksi.t}, panggung berakhir ${u.panggungBawah}`
    );
    assert.equal(u.tautanTerlihat, true, 'titik tengah tautan campuran dijawab elemen lain (tertutup blok aksi?) — elementFromPoint');
    // "Kembali ke kasir" DI ATAS kartu.
    assert.ok(u.kembali, 'tautan "Kembali ke kasir" tidak ada');
    assert.ok(u.kembali.b <= u.kartu.t, `"Kembali ke kasir" (bawah ${u.kembali.b}) tidak di atas kartu (atas ${u.kartu.t})`);
  });

  test(`⛔ ${lebar}: Total 32 px di blok ATAS; "Konfirmasi bayar" 56 px di kanan bawah`, async () => {
    const { hal, galat } = await bukaK06(lebar);
    const u = await ukur(hal);
    await hal.close();
    assert.deepEqual(galat, []);
    assert.equal(u.totalNilai, '32px/700', `nilai Total ${u.totalNilai} — mockup 32 px, bobot 700 (skala 32/20/15/13)`);
    assert.ok(u.totalLabel?.startsWith('13px'), `label Total ${u.totalLabel} — mockup 13 px (skala 32/20/15/13)`);
    assert.ok(u.total.b <= u.daftarTab.t, `blok Total (bawah ${u.total.b}) tidak di atas tab (atas ${u.daftarTab.t})`);
    assert.ok(u.primer && u.primer.teks === 'Konfirmasi bayar', `aksi utama: ${u.primer?.teks}`);
    assert.ok(u.primer.h >= 56, `aksi utama ${u.primer.h} px — 56 px (DS #3)`);
    assert.equal(u.primer.r, u.aksi.r, 'aksi utama tidak menempel di tepi kanan blok aksi');
    assert.ok(u.primer.w < u.aksi.w / 2, `aksi utama ${u.primer.w} px dari ${u.aksi.w} — mockup tidak selebar kartu`);
    // 18 = padding kartu (`--space-4`, 16 px) + 2 px pembulatan: tombol utama menempel di dasar kartu.
    assert.ok(u.primer.b >= u.kartu.b - 18, `aksi utama (bawah ${u.primer.b}) tidak di bawah kartu (bawah ${u.kartu.b})`);
  });
}
