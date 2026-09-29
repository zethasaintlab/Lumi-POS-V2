'use strict';

// Laci kas — layar K-18 (FR-D5 + K-16 + riwayat shift), menurut mockup.
//
// Task 4 PR 2A, kampanye "Hidupkan desain" (26 September 2026, spec § 9).
// Penjaga lama (Fase 3.6 rebuild UI) memaku dialog kas masuk/keluar yang dibuka
// dari K-03 dengan toggle 56 px. Digantikan: kas manual dan buka laci pindah ke
// LAYAR tersendiri (tab "Laci kas", `/laci`) — dua kartu berdampingan, dan
// toggle arah tampil 44 px (mockup: 186×44) dengan area TEKAN ≥ 56 lewat
// `.sentuh-uang` (constraint kampanye: "elemen yang di mockup lebih kecil dari
// 44px tampil PERSIS ukuran mockup, area sentuh diperluas tak terlihat, 56px
// untuk aksi uang"). Yang tetap dikejar: tanpa gulir pada 1024×768 dan
// 1280×800 untuk KEDUA arah, termasuk alasan "Lainnya" yang menambah kolom
// catatan.
//
// Yang TIDAK dikejar: keterangan teks bebas (alasan daftar tertutup, FR-D6).
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

/** Membuka K-18 pada viewport lebar×tinggi. `.galeri-panggung` dipaksa
    selebar viewport: yang diukur adalah layar, bukan bingkai galeri. */
async function bukaLaci(lebar, tinggi, keadaan = 'normal') {
  const hal = await peramban.newPage({ viewport: { width: lebar, height: tinggi } });
  const galat = [];
  hal.on('pageerror', (e) => galat.push(e.message));
  await hal.goto(`${alamat}/harness-galeri.html?layar=K-18&keadaan=${keadaan}`, { waitUntil: 'load' });
  await hal.addStyleTag({
    content:
      '.galeri-bar,.galeri-tanya{display:none!important}' +
      '.galeri-panggung{padding:0!important;overflow:hidden!important}' +
      `.galeri-panggung>*{width:${lebar}px!important;height:${tinggi}px!important;border:0!important;border-radius:0!important;box-shadow:none!important}`,
  });
  /* ⛔ Galeri jatuh ke K-03 untuk id layar yang tidak dikenal. Yang ditunggu
     JUDUL layar Laci kas, bukan sembarang isi — K-03 yang menyamar tidak lolos. */
  await hal
    .getByRole('heading', { name: 'Operasional laci' })
    .waitFor({ timeout: 10_000 })
    .catch(() => {
      throw new Error('layar K-18 (Laci kas) tidak ada: kartu "Operasional laci" tidak dirender');
    });
  await hal.evaluate(() => document.fonts.ready);
  return { hal, galat };
}

const ukur = (hal) =>
  hal.evaluate(() => {
    const kartuDari = (judul) => {
      const h = [...document.querySelectorAll('h2, h3')].find((e) => e.textContent.trim() === judul);
      return h ? h.closest('section, .card') : null;
    };
    const kiri = kartuDari('Operasional laci');
    const kanan = kartuDari('Riwayat shift berjalan');
    const kotak = (e) => {
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const seg = kiri ? kiri.querySelector('.segmented') : null;
    const toggle = seg
      ? [...seg.querySelectorAll('button')].map((b) => {
          const r = b.getBoundingClientRect();
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          const kena = (y) => {
            const e = document.elementFromPoint(cx, y);
            return !!e && (e === b || b.contains(e));
          };
          return {
            teks: b.textContent.trim(),
            tekan: b.getAttribute('aria-pressed'),
            sentuhUang: b.classList.contains('sentuh-uang'),
            cx,
            cy,
            // 1 px DI DALAM kotak 56 px (±28 dari tengah).
            kenaAtas: kena(cy - 27),
            kenaBawah: kena(cy + 27),
          };
        })
      : [];
    const gulir = (kiri || document.body).closest('.kasir-grid-panel') || document.scrollingElement;
    return {
      kiri: kotak(kiri),
      kanan: kotak(kanan),
      seg: kotak(seg),
      toggle,
      radioArah: document.querySelectorAll('input[name="arah-kas"]').length,
      gulir: { scroll: gulir.scrollHeight, client: gulir.clientHeight },
    };
  });

for (const [lebar, tinggi] of [
  [1024, 768],
  [1280, 800],
]) {
  test(`⛔ Laci kas: dua kartu berdampingan; toggle Kas masuk/Kas keluar tampil 44 px dengan area tekan ≥ 56 (.sentuh-uang); tanpa gulir di ${lebar}×${tinggi}`, async (t) => {
    const { hal, galat } = await bukaLaci(lebar, tinggi);
    const hasil = {};
    for (const arah of ['Kas keluar', 'Kas masuk']) {
      await hal.getByRole('button', { name: arah, exact: true }).click();
      /* Kasus terburuk tinggi: alasan "Lainnya" menambah kolom catatan. */
      await hal.getByRole('radio', { name: 'Lainnya' }).check();
      hasil[arah] = await ukur(hal);
    }
    /* Area tekan diuji dengan KLIK sungguhan 27 px di atas tengah tombol
       yang belum menyala — di luar kotak 44 px `.segmented`, di dalam 56 px. */
    const masuk = hasil['Kas masuk'].toggle.find((b) => b.teks === 'Kas keluar');
    await hal.mouse.click(masuk.cx, masuk.cy - 27);
    const setelahKlik = await ukur(hal);
    await hal.close();
    t.diagnostic(JSON.stringify({ hasil, setelahKlik: setelahKlik.toggle.map((b) => [b.teks, b.tekan]) }));

    assert.deepEqual(galat, [], 'galat konsol saat membuka K-18');
    const u = hasil['Kas keluar'];
    assert.ok(u.kiri && u.kanan, 'kartu "Operasional laci" dan/atau "Riwayat shift berjalan" tidak ada');
    assert.ok(u.kiri.r <= u.kanan.l + 1, `kartu tidak berdampingan: kiri berakhir x=${u.kiri.r}, kanan mulai x=${u.kanan.l}`);
    assert.ok(Math.abs(u.kiri.t - u.kanan.t) <= 2, `kartu tidak sejajar di atas: y=${u.kiri.t} vs y=${u.kanan.t}`);
    assert.equal(u.radioArah, 0, 'arah kas masih radio, bukan toggle');
    assert.deepEqual(u.toggle.map((b) => b.teks), ['Kas masuk', 'Kas keluar'], 'urutan toggle bukan Kas masuk · Kas keluar (mockup)');
    assert.ok(u.seg && Math.abs(u.seg.h - 44) <= 1, `toggle tampil ${u.seg && u.seg.h} px, mockup 44 px (56 px tidak lagi tampil — area tekan yang 56)`);
    for (const b of u.toggle) {
      assert.ok(b.sentuhUang, `toggle "${b.teks}" tanpa kelas .sentuh-uang — area tekan uang harus ≥ 56 px`);
      assert.ok(b.kenaAtas && b.kenaBawah, `area tekan toggle "${b.teks}" kurang dari 56 px (atas ${b.kenaAtas}, bawah ${b.kenaBawah})`);
    }
    assert.deepEqual(u.toggle.map((b) => b.tekan), ['false', 'true'], 'arah bawaan bukan "keluar"');
    assert.deepEqual(hasil['Kas masuk'].toggle.map((b) => b.tekan), ['true', 'false'], 'menekan "Kas masuk" tidak memindahkan arah');
    assert.deepEqual(
      setelahKlik.toggle.map((b) => b.tekan),
      ['false', 'true'],
      'klik 27 px di atas tengah tombol (di luar 44 px, di dalam 56 px) tidak memindahkan arah — area tekan tidak bekerja'
    );
    for (const [arah, x] of Object.entries(hasil)) {
      assert.ok(x.gulir.scroll <= x.gulir.client, `Laci kas ${arah} + alasan Lainnya menggulir (${x.gulir.scroll} dari ${x.gulir.client} px) pada ${lebar}×${tinggi}`);
    }
  });
}
