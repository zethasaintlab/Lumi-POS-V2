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
  const htmlHitung = await hal.evaluate(
    () =>
      document.querySelector('.kasir-konten').outerHTML +
      [...document.querySelectorAll('.kasir-konten input, .kasir-konten textarea')].map((i) => i.value).join(' ')
  );
  await bidang.fill(hitungan);
  await hal.getByRole('button', { name: 'Lanjut' }).click();
  await hal.waitForTimeout(1000);
  return { hal, galat, teksHitung, htmlHitung };
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
     baris `order`/`refund` fixture. Dengan `?ringkasanBernilai=1` fixture
     memuat void BERNILAI (ord-8 dibatalkan ord-9, 40.000) dan refund 10.000,
     jadi omzet bersih ≠ kotor ≠ kotor + void ≠ jumlah pembayaran -- penjaga
     yang memakai salah satu pengganti itu merah. (Fixture BAWAAN tanpa opsi:
     void-nya bernilai 0 dan tanpa refund, sehingga tidak membedakan apa pun.)
--------------------------------------------------------------------------- */
const LABEL = { cash: 'Tunai', qris_static: 'QRIS (statis)', transfer: 'Transfer' };

async function harapan(opsi) {
  const { buatDbPalsu } = await import('../../apps/kasir/src/galeri/db-palsu.ts');
  const { posisiPenjualan } = await import('../../packages/domain/src/posisi-penjualan.ts');
  const { rupiah } = await import('../../packages/domain/src/uang-tampilan.ts');
  const db = buatDbPalsu('normal', opsi);
  const refundBaris = await db.getAll('SELECT * FROM refund', []);
  const gerakan = await db.getAll('SELECT * FROM cash_movement', []);
  const orders = (await db.getAll('SELECT * FROM "order" WHERE shift_id = ?', ['shift-galeri'])).filter((o) => o.shift_id === undefined || o.shift_id === 'shift-galeri');
  const idShift = new Set(orders.map((o) => o.id));
  const bayar = (await db.getAll('SELECT * FROM payment WHERE status = ?', ['confirmed'])).filter((b) => idShift.has(b.order_id));
  const per = {};
  for (const b of bayar) {
    const kode = b.method === 'other' && b.provider === 'bank_transfer' ? 'transfer' : b.method;
    per[LABEL[kode]] = (per[LABEL[kode]] ?? 0) + b.amount;
  }
  const pos = posisiPenjualan({
    orders: orders.map((o) => ({ id: o.id, status: o.status, total: o.total, taxAmount: o.tax_amount, voidedByOrderId: o.voided_by_order_id })),
    refunds: refundBaris.filter((r) => idShift.has(r.order_id)).map((r) => ({ orderId: r.order_id, amount: r.amount })),
  });
  const saldo = 300_000 + gerakan.reduce((a, g) => a + g.delta, 0); // opening_float fixture + buku kas
  return { saldo: rupiah(saldo), omzetKotor: pos.omzetKotor, voidAmount: pos.voidAmount, per: Object.fromEntries(Object.entries(per).map(([k, v]) => [k, rupiah(v)])), tunai: rupiah(per.Tunai), total: rupiah(pos.omzetBersih), totalBayar: rupiah(bayar.reduce((a, b) => a + b.amount, 0)) };
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
      keteranganStat: kartu?.querySelector('.kasir-ringkas-stat > span:nth-child(3)')?.textContent.trim() ?? null,
      metode: baris('.kasir-ringkas-metode'),
    };
  });

for (const [nama, opsi, query, hitungan] of [
  ['QRIS + tunai + void + refund, selisih nol', { ringkasanBernilai: true }, '&ringkasanBernilai=1', '670500'],
  ['QRIS + tunai + transfer + void + refund, selisih kurang', { transfer: true, ringkasanBernilai: true }, '&transfer=1&ringkasanBernilai=1', '300000'],
]) {
  test(`⛔ "Total penjualan" dan "Penjualan per metode" HANYA di tahap review -- ${nama}`, async () => {
    const h = await harapan(opsi);
    const { hal, galat, teksHitung, htmlHitung } = await bukaReview('normal', { hitungan, query });
    const r = await bacaRingkasan(hal);
    await hal.close();
    assert.deepEqual(galat, []);
    for (const kata of ['Total penjualan', 'Penjualan per metode', 'Ringkasan shift']) {
      assert.ok(!teksHitung.includes(kata), `"${kata}" bocor ke tahap hitung (FR-D2)`);
    }
    assert.ok(r.ada, 'kartu "Ringkasan shift" tidak ada di review');
    assert.ok(r.teks.includes('Penjualan per metode'), 'judul "Penjualan per metode" tidak ada di review');
    /* Angka (bukan label) dari kartu review tidak boleh ada di hitung: label lain
       ("Omzet") tidak boleh meloloskan kebocoran. Non-tunai dikecualikan (sah). */
    for (const [nama, nilai] of [['Total penjualan', h.total], ['total Tunai', h.tunai]]) {
      const angka = nilai.replace(/^Rp\s*/, '');
      assert.ok(!teksHitung.includes(angka), `${nama} (${angka}) bocor ke tahap hitung dengan label lain (FR-D2)`);
      assert.ok(r.teks.includes(angka) || r.metode.Tunai === h.tunai, `${nama} tidak ada di kartu review`);
    }
    assert.ok(r.teks.includes('Pembayaran diterima, sebelum void dan refund'), 'keterangan basis per metode (FR-G2) hilang');
    assert.ok(r.teks.includes('Hanya transaksi dari perangkat ini'), 'label cakupan perangkat (FR-G4) hilang');
    assert.deepEqual(Object.keys(r.stat), ['Total penjualan'], 'stat Ringkasan shift');
    assert.equal(r.stat['Total penjualan'], h.total, 'Total penjualan bukan omzet bersih posisi-penjualan');
    assert.notEqual(h.total, h.totalBayar, 'fixture tidak membedakan omzet dari jumlah pembayaran -- penjaga hampa');
    const { rupiah } = await import('../../packages/domain/src/uang-tampilan.ts');
    assert.notEqual(h.total, rupiah(h.omzetKotor), 'fixture tanpa refund -- bersih = kotor, penjaga hampa');
    assert.notEqual(h.total, rupiah(h.omzetKotor + h.voidAmount), 'fixture tanpa void bernilai -- penjaga hampa');
    assert.equal(r.keteranganStat, 'Setelah void dan refund', 'keterangan basis Total penjualan hilang');
    // Hitungan buta untuk ATRIBUT dan nilai input (title/aria-label/data-*/value), bukan hanya teks.
    for (const [nama, nilai] of [['Total penjualan', h.total], ['total Tunai', h.tunai], ['Saldo seharusnya', h.saldo]]) {
      const angka = nilai.replace(/^Rp\s*/, '');
      for (const bentuk of [angka, angka.replace(/\./g, '')]) {
        assert.ok(!htmlHitung.includes(bentuk), `${nama} (${bentuk}) bocor ke HTML/atribut/nilai tahap hitung (FR-D2)`);
      }
    }
    assert.deepEqual(
      r.metode,
      h.per,
      'baris per metode tidak sama dengan lipatan pembayaran fixture'
    );
  });
}

test('⛔ Ringkasan shift memakai labelMetode dengan provider: transfer → "Transfer", bukan "Lainnya"', async () => {
  const { hal, galat } = await bukaReview('normal', { query: '&transfer=1&ringkasanBernilai=1' });
  const r = await bacaRingkasan(hal);
  await hal.close();
  assert.deepEqual(galat, []);
  assert.ok('Transfer' in r.metode, `baris Transfer tidak ada: ${Object.keys(r.metode).join(', ')}`);
  assert.ok(!('Lainnya' in r.metode), 'transfer bersembunyi di "Lainnya"');
  assert.equal(r.metode.Transfer, (await harapan({ transfer: true, ringkasanBernilai: true })).per.Transfer);
});

/* C1: ringkasanShift dibaca SESUDAH hitungan tercatat. State React terbaca devtools,
   jadi urutan query pada db yang dijaga, bukan DOM. */
test('⛔ query ringkasanShift (refund/posisi penjualan) tidak berjalan sebelum hitungan tercatat', async () => {
  const hal = await peramban.newPage({ viewport: { width: 1280, height: 800 } });
  await hal.goto(`${alamat}/harness-galeri.html?layar=K-12&keadaan=normal&ringkasanBernilai=1`, { waitUntil: 'load' });
  await hal.waitForSelector('.kasir-konten', { timeout: 10_000 });
  const bidang = hal.getByLabel(/hitungan fisik/i);
  await bidang.waitFor({ state: 'visible', timeout: 5_000 });
  await hal.waitForTimeout(1200);
  const sebelum = await hal.evaluate(() => [...window.__galeriUrutan]);
  await bidang.fill('300000');
  await hal.getByRole('button', { name: 'Lanjut' }).click();
  await hal.getByText('Ringkasan shift', { exact: true }).waitFor({ timeout: 5_000 });
  const urutan = await hal.evaluate(() => [...window.__galeriUrutan]);
  await hal.close();
  assert.ok(sebelum.includes('baca:payment'), 'sentinel: tahap hitung membaca payment (ringkasanSebelumHitung)');
  assert.equal(sebelum.filter((x) => x === 'baca:refund').length, 0, 'refund (ringkasanShift) dibaca SEBELUM kasir menekan Lanjut (FR-D2)');
  const catat = urutan.findIndex((x) => x.startsWith('tulis:') && /count_attempts/.test(x));
  const refund = urutan.indexOf('baca:refund');
  assert.ok(catat >= 0, 'sentinel: catatHitungan menulis count_attempts');
  assert.ok(refund > catat, `ringkasanShift dibaca (#${refund}) sebelum hitungan tercatat (#${catat})`);
});

/* C4: aksi uang tidak aktif sampai alasan wajib dipilih. */
test('⛔ "Tutup Shift" nonaktif sampai alasan dipilih saat selisih di atas ambang; selisih nol langsung aktif', async () => {
  const lewat = await bukaReview('normal', { hitungan: '300000' });
  const tombol = lewat.hal.getByRole('button', { name: 'Tutup Shift', exact: true });
  const mati = await tombol.isDisabled();
  await lewat.hal.getByRole('radio').first().check();
  const hidup = !(await tombol.isDisabled());
  await lewat.hal.close();
  assert.equal(mati, true, '"Tutup Shift" aktif padahal selisih di atas ambang belum beralasan');
  assert.equal(hidup, true, '"Tutup Shift" tetap nonaktif sesudah alasan dipilih');
  const nol = await bukaReview('normal', { hitungan: '670500' });
  const aktifNol = !(await nol.hal.getByRole('button', { name: 'Tutup Shift', exact: true }).isDisabled());
  await nol.hal.close();
  assert.equal(aktifNol, true, 'selisih nol tidak seharusnya menuntut alasan');
});

/* C5: Pesanan tahan memblokir Lanjut. */
test('⛔ Pesanan tahan: [data-tahanan-blokir] tampil dan "Lanjut" nonaktif', async () => {
  const hal = await peramban.newPage({ viewport: { width: 1280, height: 800 } });
  await hal.goto(`${alamat}/harness-galeri.html?layar=K-12&keadaan=normal&tahanan=1`, { waitUntil: 'load' });
  await hal.waitForSelector('.kasir-konten', { timeout: 10_000 });
  await hal.waitForTimeout(1200);
  const bidang = hal.getByLabel(/hitungan fisik/i);
  await bidang.fill('670500');
  const ada = await hal.locator('[data-tahanan-blokir]').count();
  const lanjutMati = await hal.getByRole('button', { name: 'Lanjut', exact: true }).isDisabled();
  await hal.close();
  assert.equal(ada, 1, 'daftar Pesanan tahan tidak tampil di K-12');
  assert.equal(lanjutMati, true, '"Lanjut" aktif padahal ada Pesanan tahan');
});

/* C6: ringkasan gagal dibaca tidak menahan penutupan shift. */
test('⛔ ringkasan gagal dibaca: review tercapai, pesan tampil, "Tutup Shift" tetap aktif', async () => {
  const { hal, galat } = await bukaReview('normal', { hitungan: '670500', query: '&gagalRingkasan=1' });
  const teks = await hal.evaluate(() => document.querySelector('.kasir-konten').innerText);
  const tombol = hal.getByRole('button', { name: 'Tutup Shift', exact: true });
  const adaTombol = (await tombol.count()) > 0;
  const aktif = adaTombol && !(await tombol.isDisabled());
  await hal.close();
  assert.ok(teks.includes('Kas diharapkan'), `review tidak tercapai ketika ringkasan gagal (kegagalan ringkasan menahan tahap review). galat: ${galat.join(' | ')}`);
  assert.ok(teks.includes('Ringkasan shift tidak dapat dibaca'), 'pesan galat ringkasan tidak tampil');
  assert.equal(aktif, true, 'kegagalan ringkasan menahan "Tutup Shift"');
});
