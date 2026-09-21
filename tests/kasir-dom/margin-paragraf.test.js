'use strict';

// `<p>` di layar kasir tidak membawa margin bawaan PERAMBAN.
//
// ## ⛔ Kenapa penjaga ini ada
//
// `ds-bundle/base.css` me-reset margin `body` dan berhenti di situ; `p` tidak
// pernah disebut. Jadi setiap paragraf membawa `margin: 1em 0` bawaan UA — 30
// px per paragraf pada `--text-body` 15px — dan jarak itu tidak pernah
// diputuskan siapa pun. Ia warisan stylesheet peramban yang menumpuk di atas
// `gap` yang memang dipilih.
//
// ⛔ Ia tidak terlihat selama berbulan-bulan karena selama layar menggulir
// seluruhnya, 30 px tambahan tidak mengubah apa pun yang dapat diperhatikan.
// Ia menjadi mahal saat tinggi sebuah layar DIBATASI: di K-14 ketiga
// paragrafnya memakan 90 px yang seharusnya milik tabel item gagal, dan di
// K-12 keempatnya membuat layar menggulir untuk 34 px yang tidak ada isinya.
//
// ## ⛔ Kenapa DOM, bukan mencocokkan teks CSS
//
// Penjaga yang men-grep `p { margin: 0 }` di `packages/ds/lumi.css` membuktikan
// barisnya ADA — bukan bahwa ia BERLAKU. Satu selektor yang lebih khusus di
// berkas lain, satu urutan `@import` yang berubah, atau satu layar yang
// membungkus paragrafnya dalam konteks berbeda, dan barisnya tetap di sana
// sementara marginnya kembali. Yang diukur di sini `getComputedStyle`.
//
// ## ⛔ Kenapa lima layar, bukan satu
//
// Resetnya GLOBAL, jadi bukti bahwa ia berlaku harus global juga. Satu layar
// yang diperiksa tidak dapat membedakan "reset berlaku" dari "layar ini
// kebetulan tidak punya paragraf".

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const AKAR = path.resolve(__dirname, '..', '..');
const DIST = path.join(AKAR, 'dist-galeri');

/** Kelima layar galeri, dan skenario yang paling banyak paragrafnya. */
const SEL = [
  ['K-03', 'keranjang-penuh'],
  ['K-08', 'normal'],
  ['K-12', 'normal'],
  ['K-14', 'offline'],
  ['K-15', 'normal'],
];

/**
 * Jumlah paragraf minimum yang harus benar-benar terukur.
 *
 * ⛔ Tanpa ini penjaga hijau pada galeri yang gagal memuat: nol paragraf
 * menghasilkan nol margin, dan nol margin adalah jawaban yang dituntut.
 * Angkanya dari pengukuran 21 September 2026 — K-12 empat, K-14 tiga, K-15
 * dua, K-03 satu — dan dipasang di bawahnya supaya satu paragraf yang dihapus
 * dari sebuah layar tidak mematikan penjaganya.
 */
const MINIMAL_PARAGRAF = 8;

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
  if (!fs.existsSync(path.join(DIST, 'harness-galeri.html'))) {
    execFileSync('npm', ['run', '-s', 'build:galeri'], { cwd: AKAR, stdio: 'inherit' });
  }
  assert.ok(
    fs.existsSync(path.join(DIST, 'harness-galeri.html')),
    '`npm run build:galeri` selesai tetapi dist-galeri/harness-galeri.html tidak ada.'
  );

  server = http.createServer((req, res) => {
    const nama = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const berkas = path.join(DIST, nama === '/' ? 'harness-galeri.html' : nama);
    if (!berkas.startsWith(DIST) || !fs.existsSync(berkas) || fs.statSync(berkas).isDirectory()) {
      res.writeHead(404).end('tidak ada');
      return;
    }
    res.writeHead(200, {
      'content-type': JENIS[path.extname(berkas)] ?? 'application/octet-stream',
    });
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

// ---------------------------------------------------------------------------

test('⛔ tidak satu pun `<p>` di layar kasir membawa margin bawaan peramban', async (t) => {
  const pelanggar = [];
  let diukur = 0;

  for (const [layarId, keadaan] of SEL) {
    const hal = await peramban.newPage({ viewport: { width: 1280, height: 800 } });
    const galat = [];
    hal.on('pageerror', (e) => galat.push(e.message));
    hal.on('console', (m) => {
      if (m.type() === 'error' && /Failed to load resource/.test(m.text())) return;
      if (m.type() === 'error') galat.push(m.text());
    });
    await hal.goto(`${alamat}/harness-galeri.html?layar=${layarId}&keadaan=${keadaan}`, {
      waitUntil: 'load',
    });
    await hal.waitForSelector('.kasir-konten', { timeout: 10_000 });
    await hal.waitForTimeout(1200);

    const hasil = await hal.evaluate(() => {
      const ps = [...document.querySelectorAll('.kasir-konten p')];
      return ps.map((e) => {
        const c = getComputedStyle(e);
        return {
          atas: parseFloat(c.marginTop),
          bawah: parseFloat(c.marginBottom),
          kiri: parseFloat(c.marginLeft),
          kanan: parseFloat(c.marginRight),
          teks: (e.innerText ?? '').replace(/\s+/g, ' ').slice(0, 40),
        };
      });
    });
    await hal.close();
    assert.equal(galat.length, 0, `galat konsol di ${layarId}/${keadaan}: ${galat.join(' | ')}`);

    diukur += hasil.length;
    for (const p of hasil) {
      /* ⛔ Keempat sisi, bukan hanya atas dan bawah. Margin bawaan UA memang
         `1em 0`, tetapi yang dijaga di sini adalah "tidak ada margin yang tidak
         seorang pun pilih" — dan sisi kiri/kanan yang muncul kelak akan menggeser
         teks secara mendatar tanpa satu pun error. */
      if (p.atas || p.bawah || p.kiri || p.kanan) {
        pelanggar.push(
          `  ${layarId}/${keadaan}: ${p.atas}/${p.kanan}/${p.bawah}/${p.kiri} px — "${p.teks}"`
        );
      }
    }
  }

  /* ⛔ SENTINEL DI DEPAN. Nol paragraf menghasilkan nol pelanggar, dan nol
     pelanggar adalah jawaban yang dituntut — galeri yang gagal memuat lolos
     tanpa satu pun assertion menyala. */
  assert.ok(
    diukur >= MINIMAL_PARAGRAF,
    `hanya ${diukur} paragraf yang terukur di kelima layar — dituntut minimal ` +
      `${MINIMAL_PARAGRAF}. Penjaga ini hijau karena hampa; periksa apakah galerinya ` +
      'benar-benar merender isinya.'
  );

  assert.deepEqual(
    pelanggar,
    [],
    'paragraf berikut membawa margin (atas/kanan/bawah/kiri):\n' +
      pelanggar.join('\n') +
      '\n\n  `ds-bundle/base.css` me-reset margin `body` dan TIDAK me-reset `p`, jadi ' +
      'tanpa override setiap paragraf membawa `margin: 1em 0` bawaan UA — jarak yang ' +
      'tidak pernah diputuskan siapa pun, menumpuk di atas `gap` yang memang dipilih.\n' +
      '  Resetnya ada di `packages/ds/lumi.css`. ⛔ `ds-bundle/` adalah artefak VENDOR ' +
      'dan tidak pernah disunting langsung.'
  );

  t.diagnostic(`${diukur} paragraf diukur di ${SEL.length} layar, nol bermargin.`);
});
