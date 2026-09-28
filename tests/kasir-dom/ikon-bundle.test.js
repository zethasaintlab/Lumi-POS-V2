'use strict';

// Penjaga DOM Task 7 — plugin Vite `ikonLumi()` (`packages/ds/vite-ikon.ts`).
//
// ## ⛔ Kenapa DOM, bukan cukup baca kode
//
// `resolveId` adalah mekanisme BUILD TIME: membuktikan ia benar menuntut
// membangun galeri sungguhan lalu membaca apa yang MENDARAT di DOM, bukan
// membaca konfigurasi dan mempercayainya. Config yang lupa memasang plugin
// (atau memasangnya di array plugin yang salah) tetap membangun dengan
// SUKSES — Vite menyelesaikan `../forms/Icon.jsx` ke file bundel yang
// sungguhan ada di disk, tanpa satu pun error atau peringatan. Kelas
// "nol baris, bukan error" yang sama, kali ini pada resolusi modul.
//
// Dua pengukuran:
//
//   1. K-03 galeri (skenario `kosong` — perangkat belum terdaftar, lihat
//      `perangkatTerdaftarUntuk` di `galeri/db-palsu.ts` — memaksa
//      `SyncIndicator` ke state `offline-only`, yang merender
//      `<Icon name="wifi-off">`). `SyncIndicator` MEMANGGIL `Icon` dari
//      `ds-bundle/components/forms/Icon.jsx` secara INTERNAL — komponen
//      bundel ini sendiri tidak pernah diimpor ulang oleh kode kita, jadi
//      satu-satunya cara ikonnya berubah adalah resolusi impornya
//      benar-benar dialihkan. Anak PERTAMA svg-nya dibandingkan atribut
//      `d` dengan node Lucide `wifi-off` di fixture — path bundel lama
//      (gambar ulang "gaya Lucide") punya `d` yang BERBEDA (lihat komentar
//      kepala `ikon.tsx` § kenapa hanya beberapa entri `PETA_BUNDLE`
//      "identik").
//   2. `?layar=fondasi` bagian `ikon` — SETIAP nama di `iconNames` (Task 6)
//      dirender lewat `<Icon>` publik `ds`, dan jumlah anak svg-nya
//      dibandingkan dengan node fixture. Ini TIDAK melewati plugin (Task 6
//      publik sudah menunjuk `ikon.tsx` langsung, resolusi modul biasa),
//      tapi ada di sini karena Task 7 yang mengisi bagian galeri ini —
//      lihat `Fondasi.tsx`.
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
};

let server;
let alamat;
let peramban;

before(async () => {
  /* ⛔ MENEGASKAN, bukan membangun — pola yang sama dengan `k03-chrome.test.js`.
     `node --test` menjalankan berkas di direktori ini PARALEL; berkas yang
     membangun sendiri saling menghapus `outDir` (`emptyOutDir: true`). */
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

async function bukaLayar(layarId, keadaan) {
  const hal = await peramban.newPage({ viewport: { width: 1280, height: 800 } });
  const galat = [];
  hal.on('pageerror', (e) => galat.push(e.message));
  hal.on('console', (m) => {
    if (m.type() === 'error') galat.push(m.text());
  });
  await hal.goto(`${alamat}/harness-galeri.html?layar=${layarId}&keadaan=${keadaan}`, {
    waitUntil: 'load',
  });
  await hal.waitForSelector('.galeri-panggung', { timeout: 10_000 });
  await hal.waitForFunction(
    () => (document.querySelector('.galeri-panggung')?.textContent ?? '').trim().length > 0,
    { timeout: 10_000 }
  );
  await hal.waitForTimeout(200);
  return { hal, galat };
}

// ---------------------------------------------------------------------------

test('⛔ SyncIndicator bundel (K-03, keadaan kosong) merender node Lucide "wifi-off" — bukan path bundel lama', async () => {
  // Skenario `kosong`: `perangkatTerdaftarUntuk('kosong') === false`, yang
  // memaksa `keadaanIndikator` ke state `offline-only` apa pun isi antrean
  // — dan `SyncIndicator` merender `<Icon name="wifi-off">` di KEDUA cabang
  // (`angkaDapatDipercaya` true maupun false). Lihat komentar kepala
  // berkas ini § pengukuran 1.
  const { hal, galat } = await bukaLayar('K-03', 'kosong');

  const hasil = await hal.evaluate(() => {
    const ind = document.querySelector('.kasir-indikator');
    if (!ind) return { err: '.kasir-indikator tidak ditemukan di K-03' };
    const svg = ind.querySelector('svg');
    if (!svg) return { err: '.kasir-indikator tidak punya <svg> — SyncIndicator tidak merender ikon' };
    const anak = svg.children[0];
    if (!anak) return { err: '<svg> di .kasir-indikator tidak punya anak' };
    return { tag: anak.tagName, d: anak.getAttribute('d') };
  });
  await hal.close();

  assert.equal(galat.length, 0, `galat konsol saat memuat K-03: ${galat.join(' | ')}`);
  assert.ok(!hasil.err, hasil.err);

  const fixture = JSON.parse(
    fs.readFileSync(path.join(AKAR, 'tests/fixture/lucide-0.468.0/nodes.json'), 'utf8')
  );
  const nodeWifiOff = fixture['wifi-off'];
  assert.ok(nodeWifiOff && nodeWifiOff.length > 0, 'fixture tidak punya node untuk "wifi-off"');

  const [tagHarap, attrsHarap] = nodeWifiOff[0];
  assert.equal(
    hasil.tag,
    tagHarap,
    `anak pertama <svg> SyncIndicator bertag "${hasil.tag}", node Lucide "wifi-off" harusnya "${tagHarap}". ` +
      'Plugin `ikonLumi()` mungkin tidak terpasang di config Vite galeri.'
  );
  assert.equal(
    hasil.d,
    attrsHarap.d,
    `atribut "d" anak pertama SyncIndicator ("${hasil.d}") berbeda dari node Lucide "wifi-off" ` +
      `("${attrsHarap.d}") — ini path BUNDEL LAMA (gambar ulang "gaya Lucide"), bukan Lucide asli. ` +
      'Plugin `ikonLumi()` mungkin tidak terpasang di config Vite galeri (`apps/kasir/vite.galeri.config.ts`).'
  );
});

test('⛔ ?layar=fondasi bagian "ikon": setiap nama di iconNames merender <svg> dengan jumlah anak = node fixture', async () => {
  const { hal, galat } = await bukaLayar('fondasi', 'normal');

  const kotak = await hal.evaluate(() => {
    const el = [...document.querySelectorAll('[data-fondasi="ikon"] [data-uji^="ikon-"]')];
    return el.map((k) => {
      const svg = k.querySelector('svg');
      return {
        uji: k.getAttribute('data-uji'),
        svgAda: !!svg,
        jumlahAnak: svg ? svg.children.length : -1,
      };
    });
  });
  await hal.close();

  assert.equal(galat.length, 0, `galat konsol saat memuat ?layar=fondasi: ${galat.join(' | ')}`);
  assert.ok(
    kotak.length > 0,
    'tidak ada kotak `[data-uji^="ikon-"]` ditemukan di bagian `[data-fondasi="ikon"]` — ' +
      'halaman mungkin gagal muat, atau bagian ikon belum dirender.'
  );

  // eslint-disable-next-line global-require
  const { iconNames, PETA_BUNDLE } = require('../../packages/ds/ikon-peta.ts');
  assert.equal(
    kotak.length,
    iconNames.length,
    `jumlah kotak ikon di galeri (${kotak.length}) != panjang iconNames (${iconNames.length}) — ` +
      'penjaga ini hampa kalau keduanya tidak sama, karena tidak setiap nama ikut terperiksa.'
  );

  const fixture = JSON.parse(
    fs.readFileSync(path.join(AKAR, 'tests/fixture/lucide-0.468.0/nodes.json'), 'utf8')
  );

  const salah = [];
  for (const { uji, svgAda, jumlahAnak } of kotak) {
    const nama = uji.replace(/^ikon-/, '');
    if (!svgAda) {
      salah.push(`${nama}: tidak punya <svg>`);
      continue;
    }
    const kebab = Object.prototype.hasOwnProperty.call(PETA_BUNDLE, nama) ? PETA_BUNDLE[nama] : nama;
    const node = fixture[kebab];
    if (!node) {
      salah.push(`${nama} (-> "${kebab}"): fixture tidak punya node ini`);
      continue;
    }
    if (jumlahAnak !== node.length) {
      salah.push(`${nama} (-> "${kebab}"): svg punya ${jumlahAnak} anak, fixture ${node.length}`);
    }
  }
  assert.deepEqual(salah, [], `ketidakcocokan jumlah anak svg vs fixture:\n${salah.join('\n')}`);
});
