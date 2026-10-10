'use strict';

// K-08 — riwayat sebagai TABEL dalam kartu, dengan judul halaman.
//
// Fase 3.9 rebuild UI kasir (`docs/RENCANA-REBUILD-UI.md`). BANDING § K-08:
// mockup "Riwayat transaksi" 20 px + subjudul, tabel dalam kartu dengan kepala
// kolom, baris 61 px; repo tanpa judul, daftar tanpa kartu, baris 48 px.
// Yang dikejar:
//
//   1. Judul halaman 20 px + subjudul, juga pada keadaan kosong.
//   2. Daftar di dalam kartu (`--surface` + bayangan) dengan kepala kolom
//      Waktu · Nomor struk · Total · Status — Waktu PERTAMA, seperti mockup.
//   3. Baris ≥ 60 px.
//   4. Kosong: kalimatnya di DALAM kartu, judul tetap tampil.
//
// Task 14 (sub-proyek 2): penyaring Tanggal + Metode bayar, kolom Item + Metode.
//
// ⛔ Yang TIDAK: nomor `TRX-…` (#9), status tunggal "Selesai" (status turun
// dari rantai koreksi + status kirim).
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

async function bukaK08(keadaan) {
  const hal = await peramban.newPage({ viewport: { width: 1280, height: 800 } });
  const galat = [];
  hal.on('pageerror', (e) => galat.push(e.message));
  await hal.goto(`${alamat}/harness-galeri.html?layar=K-08&keadaan=${keadaan}`, { waitUntil: 'load' });
  await hal.waitForSelector('.kasir-konten', { timeout: 10_000 });
  await hal.evaluate(() => document.fonts.ready);
  await hal.waitForTimeout(1000);
  return { hal, galat };
}

const ukur = (hal) =>
  hal.evaluate(() => {
    const konten = document.querySelector('.kasir-konten');
    const h1 = konten.querySelector('h1');
    const baris = [...konten.querySelectorAll('.kasir-riwayat-baris')];
    const kartuDari = (e) => {
      for (let x = e?.parentElement; x && x !== konten; x = x.parentElement) {
        const c = getComputedStyle(x);
        if (c.boxShadow !== 'none' && c.backgroundColor !== 'rgba(0, 0, 0, 0)') return x;
      }
      return null;
    };
    const kepala = konten.querySelector('.kasir-riwayat-kepala');
    const kosong = konten.querySelector('.empty');
    const pertama = baris[0];
    const sel = pertama ? [...pertama.children].filter((c) => c.textContent.trim() !== '') : [];
    return {
      judul: h1 ? { teks: h1.textContent.trim(), ukuran: getComputedStyle(h1).fontSize } : null,
      baris: baris.map((b) => Math.round(b.getBoundingClientRect().height)),
      barisDiKartu: pertama ? Boolean(kartuDari(pertama)) : null,
      kepala: kepala ? [...kepala.children].map((c) => c.textContent.trim()).filter(Boolean) : null,
      selPertama: sel.map((c) => c.textContent.trim()),
      kosongDiKartu: kosong ? Boolean(kartuDari(kosong)) : null,
    };
  });

test('⛔ K-08 normal: judul 20 px, tabel dalam kartu, kepala kolom, Waktu pertama, baris >= 60 px', async (t) => {
  const { hal, galat } = await bukaK08('normal');
  const u = await ukur(hal);
  await hal.close();
  t.diagnostic(JSON.stringify(u));
  assert.deepEqual(galat, []);
  assert.ok(u.baris.length >= 3, 'riwayat galeri tanpa baris — penjaga hampa');
  assert.deepEqual(u.judul, { teks: 'Riwayat transaksi', ukuran: '20px' }, `judul halaman: ${JSON.stringify(u.judul)}`);
  assert.equal(u.barisDiKartu, true, 'baris riwayat tidak di dalam kartu');
  assert.deepEqual(u.kepala, ['Waktu', 'Nomor struk', 'Item', 'Metode', 'Total', 'Status'], `kepala kolom: ${JSON.stringify(u.kepala)}`);
  assert.match(u.selPertama[0] ?? '', /^\d{2}[.:]\d{2}$/, `sel pertama bukan jam: ${JSON.stringify(u.selPertama)}`);
  assert.ok(Math.min(...u.baris) >= 60, `baris riwayat ${Math.min(...u.baris)} px — mockup 61`);
});

test('⛔ K-08 kosong: judul tetap tampil, kalimat kosong di dalam kartu', async () => {
  const { hal, galat } = await bukaK08('kosong');
  const u = await ukur(hal);
  await hal.close();
  assert.deepEqual(galat, []);
  assert.equal(u.baris.length, 0, 'keadaan kosong punya baris');
  assert.equal(u.judul?.teks, 'Riwayat transaksi', 'judul hilang pada keadaan kosong');
  assert.equal(u.kosongDiKartu, true, 'kalimat kosong tidak di dalam kartu');
});

// ---------------------------------------------------------------------------
// Task 14 — penyaring + kolom Item/Metode. HARAPAN dihitung dari tabel fixture
// galeri (`window.__galeriTabel`), bukan dari DOM itu sendiri: penjaga yang
// membandingkan DOM dengan DOM lulus walau kolomnya salah semua.

async function bukaVariatif() {
  const hal = await peramban.newPage({ viewport: { width: 1280, height: 800 } });
  const galat = [];
  hal.on('pageerror', (e) => galat.push(e.message));
  await hal.goto(`${alamat}/harness-galeri.html?layar=K-08&keadaan=normal&riwayatVariatif=1`, { waitUntil: 'load' });
  await hal.waitForSelector('.kasir-riwayat-baris', { timeout: 10_000 });
  await hal.waitForTimeout(500);
  return { hal, galat };
}

/** Harapan per nomor struk, dari tabel fixture. Peta label DIKETIK ULANG (bukan diimpor): kode yang diuji tidak boleh jadi sumber harapannya. */
function harapan(tabel) {
  const LABEL = { cash: 'Tunai', qris_static: 'QRIS (statis)', qris_dynamic: 'QRIS (dinamis)', card_edc: 'Kartu / EDC', other: 'Lainnya', transfer: 'Transfer' };
  const kode = (p) => (p.method === 'other' && p.provider === 'bank_transfer' ? 'transfer' : p.method);
  const hasil = {};
  for (const o of tabel.order) {
    const bayar = tabel.payment.filter((p) => p.order_id === o.id && p.status === 'confirmed');
    const kodes = [...new Set(bayar.map(kode))];
    hasil[o.receipt_number] = {
      id: o.id,
      tanggal: o.business_date,
      item: String(tabel.order_line.filter((l) => l.order_id === o.id).length),
      metode: kodes.length === 0 ? '—' : kodes.length > 1 ? 'Campuran' : LABEL[kodes[0]],
      kodes,
    };
  }
  return hasil;
}

const bacaTabel = (hal) =>
  hal.evaluate(() => ({
    kepala: [...(document.querySelector('.kasir-riwayat-kepala')?.children ?? [])].map((c) => c.textContent.trim()),
    baris: [...document.querySelectorAll('.kasir-riwayat-baris')].map((b) => ({
      sel: [...b.children].map((c) => c.textContent.trim()),
    })),
  }));

test('⛔ K-08: penyaring Tanggal dan Metode bayar, kolom Item dan Metode; nomor K1-YYYYMMDD-NNNN', async (t) => {
  const { hal, galat } = await bukaVariatif();
  const tabel = await hal.evaluate(() => JSON.parse(JSON.stringify(window.__galeriTabel)));
  const h = harapan(tabel);
  const t1 = await bacaTabel(hal);
  const sel = await hal.evaluate(() => {
    const tgl = document.querySelector('.kasir-konten input[type="date"]');
    const grup = document.querySelector('.kasir-konten [role="group"][aria-label="Metode bayar"]');
    return {
      tanggal: tgl
        ? { tinggi: tgl.getBoundingClientRect().height, label: document.querySelector(`label[for="${tgl.id}"]`)?.textContent.trim() }
        : null,
      chip: grup ? [...grup.querySelectorAll('button')].map((b) => ({ teks: b.textContent.trim(), sentuh: b.classList.contains('sentuh'), pressed: b.getAttribute('aria-pressed') })) : null,
    };
  });
  await hal.close();
  t.diagnostic(JSON.stringify({ kepala: t1.kepala, sel }));
  assert.deepEqual(galat, []);

  const iNo = t1.kepala.indexOf('Nomor struk');
  const iItem = t1.kepala.indexOf('Item');
  const iMetode = t1.kepala.indexOf('Metode');
  assert.ok(iItem > 0 && iMetode > 0, `kolom Item/Metode tidak ada: ${t1.kepala}`);
  assert.equal(t1.baris.length, Object.keys(h).length, 'jumlah baris != jumlah order fixture');
  assert.ok(new Set(Object.values(h).map((x) => x.metode)).size >= 3, 'fixture kurang beragam (butuh >= 3 label metode) — penjaga hampa');
  assert.ok(Object.values(h).some((x) => x.metode === 'Campuran') && Object.values(h).some((x) => x.metode === 'Transfer'));
  for (const b of t1.baris) {
    const no = b.sel[iNo].replace(/(Dibatalkan|Pembatalan)$/, '');
    assert.match(no, /^K1-\d{8}-\d{4}$/, `nomor struk: ${no}`);
    const e = h[no];
    assert.ok(e, `nomor ${no} tidak ada di fixture`);
    assert.equal(b.sel[iItem], e.item, `${no}: kolom Item`);
    assert.equal(b.sel[iMetode], e.metode, `${no}: kolom Metode`);
  }

  // Kontrol: ada, target sentuh >= 44 px (chip: area sentuh `.sentuh`, diukur `area-sentuh.test.js`).
  assert.ok(sel.tanggal, 'penyaring Tanggal tidak ada');
  assert.equal(sel.tanggal.label, 'Tanggal');
  assert.ok(sel.tanggal.tinggi >= 44, `target sentuh Tanggal: ${sel.tanggal.tinggi}`);
  assert.ok(sel.chip, 'penyaring Metode bayar tidak ada');
  assert.deepEqual(
    sel.chip.map((c) => c.teks),
    ['Tunai', 'QRIS (dinamis)', 'QRIS (statis)', 'Kartu / EDC', 'Lainnya', 'Transfer'],
    '"Transfer" opsi sendiri, tidak di bawah "Lainnya"'
  );
  assert.ok(sel.chip.every((c) => c.sentuh && c.pressed === 'false'), 'chip metode: .sentuh dan awalnya tidak aktif');
});

test('⛔ K-08: memilih tanggal dan metode menyaring baris ke harapan fixture', async () => {
  const { hal } = await bukaVariatif();
  const tabel = await hal.evaluate(() => JSON.parse(JSON.stringify(window.__galeriTabel)));
  const h = harapan(tabel);
  const nomor = async () => {
    await hal.waitForTimeout(150);
    return (await bacaTabel(hal)).baris.map((b) => b.sel[1].replace(/(Dibatalkan|Pembatalan)$/, '')).sort();
  };
  const tanggal = (nilai) => hal.getByLabel('Tanggal', { exact: true }).fill(nilai);
  const chip = (nama) => hal.locator('[role="group"][aria-label="Metode bayar"] button', { hasText: new RegExp(`^${nama.replace(/[()/]/g, '\\$&')}$`) });
  const harap = (f) => Object.entries(h).filter(([, e]) => f(e)).map(([no]) => no).sort();

  await tanggal('2026-08-31');
  assert.deepEqual(await nomor(), harap((e) => e.tanggal === '2026-08-31'));
  await tanggal('');
  await chip('Transfer').click();
  assert.deepEqual(await nomor(), harap((e) => e.kodes.includes('transfer')));
  assert.equal((await nomor()).length, 1);
  await chip('Tunai').click();
  assert.equal(await chip('Transfer').getAttribute('aria-pressed'), 'false', 'satu metode aktif sekali');
  assert.deepEqual(await nomor(), harap((e) => e.kodes.includes('cash')), 'campuran ikut penyaring Tunai');
  await tanggal('2026-08-31');
  assert.deepEqual(await nomor(), harap((e) => e.kodes.includes('cash') && e.tanggal === '2026-08-31'), 'kedua penyaring digabung');
  await chip('Tunai').click(); // ketuk chip aktif = semua metode
  assert.deepEqual(await nomor(), harap((e) => e.tanggal === '2026-08-31'), 'ketuk chip aktif = semua metode');
  await tanggal('2026-01-01');
  assert.deepEqual(await nomor(), [], 'tanggal di luar jendela: kosong, tidak dikarang');
  await hal.close();
});

test('penyaring tanpa hasil → kalimat kosong di dalam kartu, bukan tabel kosong', async () => {
  const { hal } = await bukaVariatif();
  await hal.getByLabel('Tanggal', { exact: true }).fill('2026-08-31');
  // Transfer hanya ada di 2026-09-01 (ord-1) pada fixture ini.
  await hal.locator('[role="group"][aria-label="Metode bayar"] button', { hasText: /^Transfer$/ }).click();
  await hal.waitForTimeout(200);
  const u = await hal.evaluate(() => {
    const konten = document.querySelector('.kasir-konten');
    const kosong = konten.querySelector('.empty');
    let kartu = false;
    for (let x = kosong?.parentElement; x && x !== konten; x = x.parentElement) {
      if (x.classList.contains('card')) kartu = true;
    }
    return {
      baris: konten.querySelectorAll('.kasir-riwayat-baris').length,
      kepalaTabel: Boolean(konten.querySelector('.kasir-riwayat-kepala')),
      kosong: kosong?.textContent.trim() ?? null,
      kartu,
      kontrol: konten.querySelectorAll('input[type="date"]').length + konten.querySelectorAll('[aria-label="Metode bayar"] button').length,
    };
  });
  await hal.close();
  assert.equal(u.baris, 0);
  assert.equal(u.kepalaTabel, false, 'kepala tabel tampil tanpa baris');
  assert.ok(u.kosong && /tidak ada/i.test(u.kosong), `kalimat kosong: ${u.kosong}`);
  assert.equal(u.kartu, true, 'kalimat kosong tidak di dalam kartu');
  assert.equal(u.kontrol, 7, 'penyaring harus tetap ada agar kasir dapat melepasnya');
});
