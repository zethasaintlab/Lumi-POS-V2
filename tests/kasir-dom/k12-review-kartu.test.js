'use strict';

// K-12 tahap REVIEW — dua kartu berdampingan, menurut mockup.
//
// Fase 3.10 rebuild UI kasir (`docs/RENCANA-REBUILD-UI.md`). BANDING § K-12:
// "Dua kartu berdampingan … dapat dikejar: tata letak dua kartu cocok untuk
// tahap `review`". Rincian saldo di kartu kiri; sejak keputusan kampanye
// Hidupkan desain (keputusan bawaan #1, 28 Sep 2026) selisih + alasan ikut kartu
// Rekonsiliasi kiri dan kartu kanan = Ringkasan shift.
//
// ⛔ HANYA tahap `review`. Tahap `hitung` tetap hitungan buta (FR-D2,
// `k12-hitungan-buta.test.js`): mockup menaruh rekonsiliasi dan input di satu
// layar sekaligus, dan itu ditolak (#7). Aksi tetap di slot bilah nav
// (`k12-aksi-slot.test.js`).
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

/* Hitungan jauh dari saldo seharusnya — selisih melewati ambang, keenam radio
   alasan tampil: review yang PALING penuh (pola `k12-aksi-slot`). */
async function bukaReview(keadaan, { hitungan = '300000', query = '' } = {}) {
  const hal = await peramban.newPage({ viewport: { width: 1280, height: 800 } });
  const galat = [];
  hal.on('pageerror', (e) => galat.push(e.message));
  await hal.goto(`${alamat}/harness-galeri.html?layar=K-12&keadaan=${keadaan}${query}`, { waitUntil: 'load' });
  await hal.waitForSelector('.kasir-konten', { timeout: 10_000 });
  await hal.waitForTimeout(1200);
  const bidang = hal.getByLabel(/hitungan fisik/i);
  await bidang.waitFor({ state: 'visible', timeout: 5_000 });
  const teksHitung = await hal.evaluate(() => document.querySelector('.kasir-konten').innerText);
  await bidang.fill(hitungan);
  await hal.getByRole('button', { name: 'Lanjut' }).click();
  await hal.waitForTimeout(1000);
  return { hal, galat, teksHitung };
}

const ukur = (hal) =>
  hal.evaluate(() => {
    const konten = document.querySelector('.kasir-konten');
    const kartuDari = (e) => {
      for (let x = e?.parentElement; x && x !== konten; x = x.parentElement) {
        const c = getComputedStyle(x);
        if (c.boxShadow !== 'none' && c.backgroundColor !== 'rgba(0, 0, 0, 0)') return x;
      }
      return null;
    };
    const cari = (teks) => [...konten.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent.trim() === teks);
    const diharapkan = cari('Kas diharapkan');
    const selisih = konten.querySelector('.kasir-selisih');
    const alasan = [...konten.querySelectorAll('legend')].find((l) => l.textContent.trim() === 'Alasan selisih');
    const judulKiri = [...konten.querySelectorAll('h2')].find((h) => h.textContent.trim() === 'Rekonsiliasi kas');
    const judulKanan = [...konten.querySelectorAll('h2')].find((h) => h.textContent.trim() === 'Ringkasan shift');
    const kiri = kartuDari(diharapkan);
    const kanan = kartuDari(judulKanan);
    const r = (e) => e && (({ left, right, top }) => ({ l: Math.round(left), r: Math.round(right), t: Math.round(top) }))(e.getBoundingClientRect());
    return {
      ada: {
        diharapkan: Boolean(diharapkan),
        selisih: Boolean(selisih),
        alasan: Boolean(alasan),
        judulKiri: Boolean(judulKiri),
        judulKanan: Boolean(judulKanan),
      },
      judulKiriDiKiri: Boolean(judulKiri && kiri && kiri.contains(judulKiri)),
      selisihDiKiri: Boolean(selisih && kiri && kiri.contains(selisih)),
      kiri: r(kiri),
      kanan: r(kanan),
      berbeda: kiri !== null && kanan !== null && kiri !== kanan,
      alasanDiKiri: Boolean(alasan && kiri && kiri.contains(alasan)),
    };
  });

for (const keadaan of ['normal', 'offline']) {
  test(`⛔ ${keadaan}: review dalam dua kartu — Rekonsiliasi kas kiri (rincian, selisih, alasan), Ringkasan shift kanan`, async (t) => {
    const { hal, galat } = await bukaReview(keadaan);
    const u = await ukur(hal);
    await hal.close();
    t.diagnostic(JSON.stringify(u));
    assert.deepEqual(galat, []);
    /* SENTINEL: review yang PENUH benar-benar tercapai. */
    assert.deepEqual(u.ada, { diharapkan: true, selisih: true, alasan: true, judulKiri: true, judulKanan: true }, 'tahap review penuh tidak tercapai');
    assert.ok(u.kiri, 'rincian saldo tidak di dalam kartu');
    assert.ok(u.kanan, '"Ringkasan shift" tidak di dalam kartu');
    assert.ok(u.berbeda, 'Rekonsiliasi dan Ringkasan shift berada di kartu yang SAMA');
    assert.ok(u.kanan.l > u.kiri.r, 'kartu Ringkasan shift tidak di kanan kartu Rekonsiliasi');
    assert.equal(u.kanan.t, u.kiri.t, 'kedua kartu tidak sejajar di atas');
    assert.ok(u.judulKiriDiKiri, 'judul "Rekonsiliasi kas" tidak di kartu kiri');
    assert.ok(u.selisihDiKiri, 'panel selisih tidak di kartu Rekonsiliasi (kiri)');
    assert.ok(u.alasanDiKiri, 'alasan selisih tidak di kartu Rekonsiliasi (kiri)');
  });
}

/* ---------------------------------------------------------------------------
   Ringkasan shift (keputusan bawaan #1). HARAPAN datang dari fixture galeri
   dan dihitung di sini, bukan dibaca dari DOM yang sedang diuji:
   - per metode: lipatan baris `payment` fixture (label ditulis di test),
   - Total penjualan: `posisiPenjualan` (satu-satunya definisi omzet) atas
     baris `order`/`refund` fixture. Fixture memuat order batal, jadi angkanya
     BERBEDA dari jumlah pembayaran -- penjaga yang menjumlah `payment` merah.
--------------------------------------------------------------------------- */
const LABEL = { cash: 'Tunai', qris_static: 'QRIS (statis)', transfer: 'Transfer' };

async function harapan(opsi) {
  const { buatDbPalsu } = await import('../../apps/kasir/src/galeri/db-palsu.ts');
  const { posisiPenjualan } = await import('../../packages/domain/src/posisi-penjualan.ts');
  const { rupiah } = await import('../../packages/domain/src/uang-tampilan.ts');
  const db = buatDbPalsu('normal', opsi);
  const bayar = await db.getAll('SELECT * FROM payment WHERE status = ?', ['confirmed']);
  const per = {};
  for (const b of bayar) {
    const kode = b.method === 'other' && b.provider === 'bank_transfer' ? 'transfer' : b.method;
    per[LABEL[kode]] = (per[LABEL[kode]] ?? 0) + b.amount;
  }
  const orders = await db.getAll('SELECT * FROM "order"', []);
  const pos = posisiPenjualan({
    orders: orders.map((o) => ({ id: o.id, status: o.status, total: o.total, taxAmount: o.tax_amount, voidedByOrderId: o.voided_by_order_id })),
    refunds: [],
  });
  return { per, total: rupiah(Number(pos.omzetBersih)), totalBayar: rupiah(bayar.reduce((a, b) => a + b.amount, 0)) };
}

const bacaRingkasan = (hal) =>
  hal.evaluate(() => {
    const judul = [...document.querySelectorAll('h2')].find((h) => h.textContent.trim() === 'Ringkasan shift');
    const kartu = judul?.closest('section');
    const baris = (sel) =>
      Object.fromEntries(
        [...(kartu?.querySelectorAll(sel) ?? [])].map((e) => {
          const [a, b] = e.querySelectorAll(':scope > span');
          return [a.textContent.trim(), b.textContent.replace(/\s+/g, ' ').trim()];
        })
      );
    return {
      ada: Boolean(kartu),
      teks: kartu ? kartu.innerText : '',
      stat: baris('.kasir-ringkas-stat'),
      metode: baris('.kasir-ringkas-metode'),
    };
  });

for (const [nama, opsi, query, hitungan] of [
  ['QRIS + tunai, selisih nol', {}, '', '670500'],
  ['QRIS + tunai + transfer, selisih kurang', { transfer: true }, '&transfer=1', '300000'],
]) {
  test(`⛔ "Total penjualan" dan "Penjualan per metode" HANYA di tahap review -- ${nama}`, async () => {
    const h = await harapan(opsi);
    const { hal, galat, teksHitung } = await bukaReview('normal', { hitungan, query });
    const r = await bacaRingkasan(hal);
    await hal.close();
    assert.deepEqual(galat, []);
    for (const kata of ['Total penjualan', 'Penjualan per metode', 'Ringkasan shift']) {
      assert.ok(!teksHitung.includes(kata), `"${kata}" bocor ke tahap hitung (FR-D2)`);
    }
    assert.ok(r.ada, 'kartu "Ringkasan shift" tidak ada di review');
    assert.ok(r.teks.includes('Penjualan per metode'), 'judul "Penjualan per metode" tidak ada di review');
    assert.deepEqual(Object.keys(r.stat), ['Total penjualan'], 'stat Ringkasan shift');
    assert.equal(r.stat['Total penjualan'], h.total, 'Total penjualan bukan omzet bersih posisi-penjualan');
    assert.notEqual(h.total, h.totalBayar, 'fixture tidak membedakan omzet dari jumlah pembayaran -- penjaga hampa');
    assert.deepEqual(
      r.metode,
      Object.fromEntries(Object.entries(h.per).map(([k, v]) => [k, `Rp ${v.toLocaleString('id-ID')}`])),
      'baris per metode tidak sama dengan lipatan pembayaran fixture'
    );
  });
}

test('⛔ Ringkasan shift memakai labelMetode dengan provider: transfer → "Transfer", bukan "Lainnya"', async () => {
  const { hal, galat } = await bukaReview('normal', { query: '&transfer=1' });
  const r = await bacaRingkasan(hal);
  await hal.close();
  assert.deepEqual(galat, []);
  assert.ok('Transfer' in r.metode, `baris Transfer tidak ada: ${Object.keys(r.metode).join(', ')}`);
  assert.ok(!('Lainnya' in r.metode), 'transfer bersembunyi di "Lainnya"');
  assert.equal(r.metode.Transfer, 'Rp 54.000');
});
