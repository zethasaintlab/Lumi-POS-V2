'use strict';

// G-STRUK (DOM) — pratinjau struk (Task 13, spec § 8 dan § 11). Baris yang
// tampil HARUS sama dengan `tataLetakStruk` untuk dokumen yang sama — fungsi
// yang juga dipakai `renderEscPos`, jadi pratinjau tidak menyimpang dari byte.
//
// Isi struk diuji dari K-09 (`ord-1` ada di DB palsu galeri). Dari K-07
// galeri, penjualan yang baru ditulis TIDAK ada di DB palsu, jadi pratinjau
// K-07 menampilkan keadaan "tidak dapat dibangun ulang" — itu pun diuji.
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


async function bukaPratinjauK09(profil) {
  const hal = await peramban.newPage({ viewport: { width: 1280, height: 800 } });
  const galat = [];
  hal.on('pageerror', (e) => galat.push(e.message));
  await hal.goto(`${alamat}/harness-galeri.html?layar=K-09&keadaan=normal`, { waitUntil: 'load' });
  await hal.getByRole('button', { name: 'Pratinjau struk', exact: true }).click();
  await hal.waitForSelector('[data-pratinjau="struk"] [data-struk-baris]', { timeout: 10_000 });
  return { hal, galat };
}

const bacaPratinjau = (hal) =>
  hal.evaluate(() => {
    const p = document.querySelector('[data-pratinjau="struk"]');
    return {
      lebar: Number(p.dataset.lebar),
      dokumen: JSON.parse(p.dataset.dokumen),
      baris: [...p.querySelectorAll('[data-struk-baris]')].map((e) => ({
        teks: e.textContent,
        rata: e.dataset.rata ?? null,
        textAlign: getComputedStyle(e).textAlign,
      })),
    };
  });

async function harapan(dokumen, profilNama) {
  const { tataLetakStruk } = await import('../../apps/kasir/src/cetak/escpos.ts');
  const { PROFIL_58MM, PROFIL_80MM } = await import('../../apps/kasir/src/cetak/profil.ts');
  const profil = profilNama === '80' ? PROFIL_80MM : PROFIL_58MM;
  return tataLetakStruk(dokumen, profil).map((b) => ('garis' in b ? { teks: '-'.repeat(profil.charsPerLine), rata: null } : b));
}

test('⛔ baris pratinjau di DOM = tataLetakStruk untuk dokumen yang sama; toggle 80mm mengubah lebar kolom 32 → 48', async () => {
  const { hal, galat } = await bukaPratinjauK09();
  const p58 = await bacaPratinjau(hal);
  const e58 = await harapan(p58.dokumen, '58');
  await hal.getByRole('button', { name: '80mm', exact: true }).click();
  await hal.waitForFunction(() => document.querySelector('[data-pratinjau="struk"]').dataset.lebar === '48');
  const p80 = await bacaPratinjau(hal);
  const e80 = await harapan(p80.dokumen, '80');
  await hal.close();
  assert.deepEqual(galat, []);
  assert.equal(p58.lebar, 32, 'lebar bawaan galeri (baseline 58mm)');
  assert.equal(p80.lebar, 48);
  assert.ok(e58.length > 6, 'dokumen terlalu pendek — penjaga hampa');
  assert.deepEqual(p58.baris.map((b) => b.teks), e58.map((b) => b.teks), 'baris pratinjau 58mm menyimpang dari tataLetakStruk');
  assert.deepEqual(p80.baris.map((b) => b.teks), e80.map((b) => b.teks), 'baris pratinjau 80mm menyimpang dari tataLetakStruk');
  assert.ok(p80.baris.some((b) => b.teks.length === 48), 'tidak ada baris selebar 48 kolom');
  assert.ok(p58.baris.every((b) => b.teks.length <= 32) && p80.baris.every((b) => b.teks.length <= 48));
  // Transliterasi ikut: yang tampil adalah yang TERCETAK, bukan tipografi layar.
  assert.ok([...p58.baris, ...p80.baris].every((b) => /^[\x20-\x7e]*$/.test(b.teks)), 'ada karakter non-ASCII di pratinjau');
});

test('⛔ perataan tengah dirender dengan text-align, tidak dipadatkan dengan spasi', async () => {
  const { hal } = await bukaPratinjauK09();
  const p = await bacaPratinjau(hal);
  await hal.close();
  const tengah = p.baris.filter((b) => b.rata === 'tengah');
  assert.ok(tengah.length > 0, 'dokumen uji tidak punya baris tengah — penjaga hampa');
  for (const b of tengah) {
    assert.equal(b.textAlign, 'center', `baris tengah text-align ${b.textAlign}`);
    assert.equal(b.teks, b.teks.trim(), `baris tengah dipadatkan spasi: ${JSON.stringify(b.teks)}`);
  }
});

test('teks pratinjau --font-mono 13px, satu-satunya elemen mono di layar', async () => {
  const { hal } = await bukaPratinjauK09();
  const u = await hal.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.fontFamily = 'var(--font-mono)';
    document.body.appendChild(probe);
    const mono = getComputedStyle(probe).fontFamily;
    probe.remove();
    const baris = [...document.querySelectorAll('[data-pratinjau="struk"] [data-struk-baris]')];
    const luar = [...document.querySelectorAll('body *')].filter(
      (e) => getComputedStyle(e).fontFamily === mono && !e.closest('[data-pratinjau="struk"]')
    );
    return {
      mono,
      n: baris.length,
      salah: baris.filter((e) => getComputedStyle(e).fontFamily !== mono || getComputedStyle(e).fontSize !== '13px').map((e) => getComputedStyle(e).fontFamily + ' ' + getComputedStyle(e).fontSize),
      luar: luar.map((e) => e.tagName + '.' + e.className),
    };
  });
  await hal.close();
  assert.ok(u.n > 0);
  assert.match(u.mono, /Courier New|monospace/, `--font-mono terbaca ${u.mono}`);
  assert.deepEqual(u.salah, [], 'baris struk bukan --font-mono 13px');
  assert.deepEqual(u.luar, [], 'elemen mono di luar pratinjau');
});

test('"Cetak" di pratinjau memanggil jalur cetak ulang yang sama dengan K-09', async () => {
  const { hal } = await bukaPratinjauK09();
  await hal.getByRole('button', { name: 'Cetak', exact: true }).click();
  await hal.waitForSelector('[data-pratinjau="struk"] [data-cetak="ulang"]', { timeout: 10_000 });
  const t = await hal.$eval('[data-pratinjau="struk"] [data-cetak="ulang"]', (e) => e.textContent.trim());
  await hal.close();
  assert.match(t, /Belum ada printer terpasang|Struk dicetak ulang|Gagal mencetak/, `kalimat cetak: ${t}`);
});

test('pratinjau dapat dibuka dari K-09, dan ditutup dengan Escape', async () => {
  const { hal } = await bukaPratinjauK09();
  await hal.keyboard.press('Escape');
  await hal.waitForSelector('[data-pratinjau="struk"]', { state: 'detached', timeout: 5_000 });
  await hal.close();
});

test('pratinjau dari K-07: dibuka, keadaan "tidak dapat dibangun" terbaca, Tutup kembali ke K-07', async () => {
  const hal = await peramban.newPage({ viewport: { width: 1280, height: 800 } });
  await hal.route('**/health', (r) => r.fulfill({ status: 200, body: 'ok' }));
  await hal.goto(`${alamat}/harness-galeri.html?layar=K-03&keadaan=keranjang-penuh`, { waitUntil: 'load' });
  await hal.waitForSelector('.kasir-grid > *', { timeout: 10_000 });
  await hal.getByRole('button', { name: 'Bayar', exact: true }).click();
  await hal.getByLabel('Nominal diterima').fill('600.000');
  await hal.getByRole('button', { name: 'Konfirmasi bayar' }).click();
  await hal.waitForSelector('text=Transaksi Baru', { timeout: 10_000 });
  await hal.getByRole('button', { name: 'Cetak Struk', exact: true }).click();
  await hal.waitForSelector('[data-pratinjau^="struk"]', { timeout: 10_000 });
  const teks = await hal.$eval('[data-pratinjau^="struk"]', (e) => e.textContent);
  await hal.getByRole('button', { name: 'Tutup', exact: true }).click();
  await hal.waitForSelector('text=Transaksi Baru', { timeout: 5_000 });
  await hal.close();
  assert.match(teks, /tidak dapat dibangun ulang menjadi struk/, teks);
});
