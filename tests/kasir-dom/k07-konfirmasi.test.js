'use strict';

// K-07 — konfirmasi transaksi menurut mockup, dan hasil cetak yang TERBACA.
//
// Fase 3.3 rebuild UI kasir (`docs/RENCANA-REBUILD-UI.md`). Selisih "dapat
// dikejar" di `docs/referensi-visual/BANDING.md` § K-07, diukur di overlay
// galeri (jalur K-03 → Bayar → tunai → Simpan Penjualan):
//
//   1. Kartu 536 px (mockup), bukan kartu pembayaran 728.
//   2. Ikon centang dalam lingkaran lembut + judul "Transaksi selesai".
//   3. Kembalian di panel `--accent-soft`, angka 32 px. Angkanya tetap warna
//      teks: aksen adalah warna AKSI (DS #2), mockup mewarnainya — ditolak.
//   4. Tombol "Cetak ulang struk" lewat jalur cetak ulang yang SAMA dengan K-09
//      (`cetak/cetak-ulang.ts`), dan "Transaksi Baru" di kanan bawah, 56 px.
//
// ⛔ Dan satu cacat yang ditemukan saat membaca K-07: `HasilPenjualan.cetak`
// dikembalikan `simpanPenjualan` justru supaya layar dapat berkata "struk
// gagal dicetak, transaksi tersimpan" (`CLAUDE.md` § F4) — dan K-07 tidak
// pernah membacanya. Kegagalan cetak pertama tidak terlihat di mana pun.
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

const LEBAR_MOCKUP = 536;

async function bukaK07(lebar) {
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
  await hal.waitForTimeout(500);
  for (let i = 0; i < 6; i += 1) await hal.getByRole('button', { name: '+ Rp 100.000' }).click();
  await hal.getByRole('button', { name: 'Simpan Penjualan' }).click();
  await hal.waitForSelector('text=Transaksi Baru', { timeout: 10_000 });
  await hal.waitForTimeout(400);
  return { hal, galat };
}

async function ukur(hal) {
  return hal.evaluate(() => {
    const r = (e) => {
      const x = e.getBoundingClientRect();
      return { l: Math.round(x.left), t: Math.round(x.top), r: Math.round(x.right), w: Math.round(x.width), h: Math.round(x.height) };
    };
    /* Nilai token sebagai rgb(), lewat elemen uji — pembanding latar. */
    const token = (nama) => {
      const e = document.createElement('div');
      e.style.background = `var(${nama})`;
      document.body.appendChild(e);
      const v = getComputedStyle(e).backgroundColor;
      e.remove();
      return v;
    };
    const dialog = document.querySelector('.overlay .dialog');
    const tombol = (t) => [...dialog.querySelectorAll('button')].find((b) => b.textContent.trim() === t);
    const baru = tombol('Transaksi Baru');
    const ulang = tombol('Cetak ulang struk');
    const kembalian = [...dialog.querySelectorAll('*')].find(
      (e) => e.children.length > 0 && [...e.children].some((c) => c.textContent.trim() === 'Kembalian')
    );
    const angka = kembalian?.querySelector('.num');
    const ikon = dialog.querySelector('svg');
    let latarIkon = null;
    for (let e = ikon; e && e !== dialog; e = e.parentElement) {
      const b = getComputedStyle(e).backgroundColor;
      if (b !== 'rgba(0, 0, 0, 0)') { latarIkon = b; break; }
    }
    return {
      panggung: Math.round(document.querySelector('.galeri-panggung > *').getBoundingClientRect().width),
      dialog: r(dialog),
      judul: [...dialog.querySelectorAll('h1,h2')].map((h) => h.textContent.trim()),
      latarIkon,
      latarKembalian: kembalian ? getComputedStyle(kembalian).backgroundColor : null,
      angkaKembalian: angka ? `${getComputedStyle(angka).fontSize}` : null,
      warnaAngka: angka ? getComputedStyle(angka).color : null,
      status: [...dialog.querySelectorAll('[role="status"]')].map((e) => e.textContent.trim()),
      baru: baru && r(baru),
      ulang: ulang && r(ulang),
      /* ⛔ `--accent` dibaca lewat LATAR elemen uji yang TERPASANG, sama dengan
         kedua token lain. Versi pertama membaca `color` elemen terlepas —
         string kosong — dan penjaga DS #2 di bawah hijau pada angka yang
         diwarnai aksen; sabotase yang menemukannya. */
      token: { accentSoft: token('--accent-soft'), successSoft: token('--success-soft'), accent: token('--accent') },
    };
  });
}

// ---------------------------------------------------------------------------

for (const lebar of [1024, 1280]) {
  test(`⛔ ${lebar}: kartu K-07 ${LEBAR_MOCKUP} px, ikon + judul "Transaksi selesai", kembalian di panel lembut`, async (t) => {
    const { hal, galat } = await bukaK07(lebar);
    const u = await ukur(hal);
    await hal.close();
    t.diagnostic(JSON.stringify(u));
    assert.deepEqual(galat, []);
    assert.equal(u.panggung, lebar);
    assert.equal(u.dialog.w, Math.min(LEBAR_MOCKUP, lebar), `kartu K-07 ${u.dialog.w} px — mockup ${LEBAR_MOCKUP}`);
    assert.ok(u.judul.includes('Transaksi selesai'), `judul K-07: ${JSON.stringify(u.judul)}`);
    assert.equal(u.latarIkon, u.token.successSoft, 'ikon centang tidak di atas lingkaran --success-soft');
    assert.equal(u.latarKembalian, u.token.accentSoft, `panel kembalian ${u.latarKembalian}, bukan --accent-soft`);
    assert.equal(u.angkaKembalian, '32px', `angka kembalian ${u.angkaKembalian}`);
    /* ⛔ DS #2: aksen adalah warna AKSI. Angka yang diwarnai aksen bersaing
       dengan tombol Transaksi Baru. */
    assert.match(u.token.accent, /^rgb/, 'token --accent tidak terbaca — penjaga DS #2 hampa');
    assert.notEqual(u.warnaAngka, u.token.accent, 'angka kembalian berwarna aksen — DS #2');
  });

  test(`⛔ ${lebar}: hasil cetak terbaca, Cetak ulang di kiri, Transaksi Baru 56 px di kanan`, async () => {
    const { hal, galat } = await bukaK07(lebar);
    const u = await ukur(hal);
    assert.deepEqual(galat, []);
    /* Galeri tidak punya printer: hasil cetak pertama `tanpa_printer`, dan itu
       HARUS terbaca — merchant tanpa printer adalah kasus sah, bukan galat. */
    assert.ok(
      u.status.some((s) => /Belum ada printer terpasang/.test(s)) && u.status.length === 1,
      `hasil cetak pertama tidak dirender: ${JSON.stringify(u.status)}`
    );
    assert.ok(u.ulang, 'tombol "Cetak ulang struk" tidak ada di K-07');
    assert.ok(u.baru && u.baru.h >= 56, `Transaksi Baru ${u.baru?.h} px — 56 px`);
    assert.equal(u.ulang.t, u.baru.t, 'Cetak ulang tidak sebaris dengan Transaksi Baru');
    assert.ok(u.ulang.l < u.baru.l, 'Cetak ulang tidak di kiri');
    assert.ok(u.baru.w < u.dialog.w / 2, 'Transaksi Baru selebar kartu');

    /* Tombolnya TERSAMBUNG ke `cetakUlangOrder`: kalimat cetak ULANG muncul
       di elemennya sendiri. Di galeri kalimatnya cabang "tidak dapat dibangun
       ulang" — DB palsu galeri tidak menyimpan penjualan yang baru ditulis,
       jadi `bangunUlangStruk` tidak menemukan ordernya. Isi struk cetak ulang
       diuji `tests/kasir/cetak-ulang.test.js` di atas SQLite sungguhan; yang
       dijaga di sini kabelnya. */
    await hal.getByRole('button', { name: 'Cetak ulang struk' }).click();
    await hal.waitForTimeout(800);
    const ulang = await hal.$$eval('.overlay .dialog [data-cetak="ulang"]', (n) => n.map((e) => e.textContent.trim()));
    const pertama = await hal.$$eval('.overlay .dialog [data-cetak="pertama"]', (n) => n.map((e) => e.textContent.trim()));
    await hal.close();
    assert.equal(ulang.length, 1, 'menekan Cetak ulang tidak menghasilkan kalimat cetak ulang');
    assert.match(
      ulang[0],
      /Belum ada printer terpasang|Struk dicetak ulang|Gagal mencetak|tidak dapat dibangun ulang menjadi struk/,
      `kalimat cetak ulang tidak dikenal: ${ulang[0]}`
    );
    /* Hasil cetak PERTAMA tetap terbaca — pesan cetak ulang tidak menimpanya. */
    assert.equal(pertama.length, 1, 'hasil cetak pertama hilang setelah cetak ulang');
  });
}

test('⛔ K-09 memakai jalur cetak ulang yang SAMA, dan ordernya benar-benar dibangun ulang', async () => {
  /* `cetak/cetak-ulang.ts` dipindahkan dari `DetailTransaksi.tsx`. ord-1 ADA di
     DB palsu galeri, jadi di sini cabang "tidak dapat dibangun ulang" berarti
     pemindahannya merusak pembangunan struk. */
  const hal = await peramban.newPage({ viewport: { width: 1280, height: 800 } });
  const galat = [];
  hal.on('pageerror', (e) => galat.push(e.message));
  await hal.goto(`${alamat}/harness-galeri.html?layar=K-09&keadaan=normal`, { waitUntil: 'load' });
  await hal.waitForSelector('text=Cetak ulang struk', { timeout: 10_000 });
  await hal.getByRole('button', { name: 'Cetak ulang struk' }).click();
  await hal.waitForTimeout(800);
  const status = await hal.$$eval('.galeri-panggung [role="status"]', (n) => n.map((e) => e.textContent.trim()));
  await hal.close();
  assert.deepEqual(galat, []);
  assert.ok(
    status.some((s) => /Belum ada printer terpasang|Struk dicetak ulang|Gagal mencetak/.test(s)),
    `K-09 tidak menghasilkan kalimat cetak ulang dari struk yang dibangun: ${JSON.stringify(status)}`
  );
});
