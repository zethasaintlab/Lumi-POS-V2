'use strict';

// Area sentuh tak terlihat: `.sentuh` (≥44) dan `.sentuh-uang` (≥56) —
// diukur lewat `document.elementFromPoint`, bukan dibaca dari CSS.
//
// ## ⛔ Kenapa penjaga ini ada
//
// Task 5, kampanye "Hidupkan desain" (26 September 2026). Constraint
// kampanye (`docs/RENCANA-HIDUPKAN-DESAIN.md`): "elemen yang di mockup lebih
// kecil dari 44px tampil PERSIS ukuran mockup, dengan area sentuh diperluas
// TANPA TERLIHAT ke 44px, dan 56px untuk aksi uang." Spec § 6 (`docs/
// superpowers/specs/2026-09-26-fondasi-desain-design.md`) "Mekanisme area
// sentuh tak terlihat". Membaca `lumi.css` tidak membuktikan apa yang
// SUNGGUH dapat ditekan di peramban — `::before` yang salah ukuran, atau
// yang tidak menerima pointer sama sekali, tetap lolos baca.
//
// Elemen uji: 28×28 (`data-uji="sentuh-tunggal"` dan
// `data-uji="sentuh-uang-tunggal"`) di bagian `bentuk`, `?layar=fondasi`
// (`apps/kasir/src/galeri/Fondasi.tsx`). Angka ±21/±23 dan ±27/±29 adalah
// SETENGAH dari 44 dan 56, ±1 — titik di dalam target harus kena, titik SATU
// px di luarnya harus meleset. Ini membuktikan yang diukur adalah kotak 44
// (atau 56), bukan seluruh halaman: elemen apa pun sebesar itu tanpa
// mekanisme ini juga akan "kena" di ±21, tapi HANYA mekanisme yang benar akan
// MELESET tepat di ±23.
//
// ## ⛔ Step 1b — tetangga tidak boleh bertumpuk (keputusan user 26 Sep 2026)
//
// Area sentuh yang bertumpuk membuat ketukan di tepi mengenai TETANGGA yang
// salah — di kasir itu berarti produk yang salah masuk keranjang. Test kedua
// di berkas ini memindai SETIAP halaman galeri (daftar dibaca dari halaman,
// bukan diketik ulang — lihat § Cakupan di `skala-teks.test.js`), termasuk
// setiap layar kasir yang HARI INI belum punya satu pun elemen `.sentuh`
// (jumlah pasangan yang diperiksa untuk layar itu karena itu boleh nol — yang
// tidak boleh nol adalah `fondasi`, yang punya baris tiga tombol 28×28
// berjarak 8px sengaja dibuat rapat untuk kasus ini).
//
// Kedekatan pasangan dihitung dari PERLUASAN BAWAAN (simetris, dari kelasnya
// — 44 untuk `.sentuh`, 56 untuk `.sentuh-uang`) atas kotak TAMPILAN
// (`getBoundingClientRect`), bukan dari override per-sisi yang sungguh
// terpasang — itu yang membuat pemeriksaan ini menemukan pasangan yang PERLU
// mekanisme anti-tumpang-tindih, terlepas dari apakah mekanisme itu sudah
// dipasang atau belum. Untuk setiap pasangan yang lolos ambang itu, titik
// diambil di GARIS TENGAH CELAH antara kedua kotak TAMPILAN (bukan kotak
// perluasan), sedikit ke masing-masing sisi (±2px) supaya tidak jatuh tepat
// di batas yang ambigu — dan setiap titik harus dijawab `elementFromPoint`
// oleh elemen yang kotak tampilannya lebih dekat, bukan tetangganya.
//
// ⛔ `elementFromPoint` memakai KOORDINAT VIEWPORT: elemen yang berada di luar
// jendela terlihat (halaman `fondasi` panjang, di-scroll) mengembalikan
// `null` atau elemen LAIN pada titik yang sama — bukan cacat mekanisme,
// melainkan elemen itu sedang tidak di layar. Setiap pengukuran titik di
// berkas ini karena itu didahului `scrollIntoView` pada elemen yang diukur.
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
  /* ⛔ MENEGASKAN, bukan membangun. Lihat `k03-chrome.test.js` § kenapa. */
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

async function bukaLayar(id) {
  const hal = await peramban.newPage({ viewport: { width: 1280, height: 800 } });
  await hal.goto(`${alamat}/harness-galeri.html?layar=${id}&keadaan=normal`, { waitUntil: 'load' });
  await hal.waitForSelector('.galeri-panggung', { timeout: 10_000 });
  await hal.waitForFunction(
    () => (document.querySelector('.galeri-panggung')?.textContent ?? '').trim().length > 0,
    { timeout: 10_000 }
  );
  await hal.waitForTimeout(300);
  return hal;
}

/** Daftar layar DIBACA dari halaman — lihat komentar berkas § Step 1b. */
async function bacaDaftarLayar() {
  const hal = await bukaLayar('fondasi');
  const daftar = await hal.evaluate(() =>
    Array.from(document.querySelectorAll('.galeri-grup[aria-label="Layar"] button')).map((b) =>
      b.textContent.trim()
    )
  );
  await hal.close();
  assert.ok(daftar.length > 0, 'tidak ada tombol layar ditemukan di bilah galeri — halaman mungkin gagal muat');
  return daftar;
}

test('⛔ .sentuh (≥44) dan .sentuh-uang (≥56): area TEKAN meluas, area TAMPAK tidak — elementFromPoint, bukan CSS dibaca', async () => {
  const hal = await bukaLayar('fondasi');

  const hasil = await hal.evaluate(async () => {
    function tunggu(ms) {
      return new Promise((r) => setTimeout(r, ms));
    }

    async function ujiTitik(sel, offsets) {
      const el = document.querySelector(sel);
      if (!el) return { error: `elemen "${sel}" tidak ditemukan` };
      el.scrollIntoView({ block: 'center', inline: 'center' });
      await tunggu(0);
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const titik = {};
      for (const [nama, dx, dy] of offsets) {
        const x = cx + dx;
        const y = cy + dy;
        const kena = document.elementFromPoint(x, y);
        titik[nama] = { kena: kena === el, tag: kena ? kena.tagName + (kena.getAttribute('data-uji') ? `[data-uji="${kena.getAttribute('data-uji')}"]` : '') : 'null' };
      }
      return { rect: { w: r.width, h: r.height }, titik };
    }

    const OFFSET_SENTUH = [
      ['kiri-21', -21, 0], ['kanan-21', 21, 0], ['atas-21', 0, -21], ['bawah-21', 0, 21],
      ['kiri-23', -23, 0], ['kanan-23', 23, 0], ['atas-23', 0, -23], ['bawah-23', 0, 23],
    ];
    const OFFSET_SENTUH_UANG = [
      ['kiri-27', -27, 0], ['kanan-27', 27, 0], ['atas-27', 0, -27], ['bawah-27', 0, 27],
      ['kiri-29', -29, 0], ['kanan-29', 29, 0], ['atas-29', 0, -29], ['bawah-29', 0, 29],
    ];

    const sentuh = await ujiTitik('[data-uji="sentuh-tunggal"]', OFFSET_SENTUH);
    const sentuhUang = await ujiTitik('[data-uji="sentuh-uang-tunggal"]', OFFSET_SENTUH_UANG);

    function radius(sel) {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el).borderRadius : null;
    }

    return {
      sentuh,
      sentuhUang,
      radiusKartu: radius('[data-uji="radius-kartu"]'),
      radiusTombol: radius('[data-uji="radius-tombol"]'),
    };
  });

  await hal.close();

  assert.equal(hasil.sentuh.error, undefined, hasil.sentuh.error);
  assert.equal(hasil.sentuhUang.error, undefined, hasil.sentuhUang.error);

  // Tampilan TIDAK membesar — aturan konstraint kampanye: "tampil PERSIS
  // ukuran mockup".
  assert.deepEqual(hasil.sentuh.rect, { w: 28, h: 28 }, `.sentuh: getBoundingClientRect ${JSON.stringify(hasil.sentuh.rect)}, harap 28×28`);
  assert.deepEqual(hasil.sentuhUang.rect, { w: 28, h: 28 }, `.sentuh-uang: getBoundingClientRect ${JSON.stringify(hasil.sentuhUang.rect)}, harap 28×28`);

  // ±21 (dalam 44) HARUS kena; ±23 (luar 44) TIDAK boleh kena.
  for (const [nama, titik] of Object.entries(hasil.sentuh.titik)) {
    const harapKena = nama.endsWith('-21');
    assert.equal(
      titik.kena,
      harapKena,
      `.sentuh di titik ${nama}: elementFromPoint mengembalikan ${titik.tag}, harap ${
        harapKena ? 'elemen itu sendiri (di dalam 44px)' : 'BUKAN elemen itu (di luar 44px)'
      }`
    );
  }

  // ±27 (dalam 56) HARUS kena; ±29 (luar 56) TIDAK boleh kena.
  for (const [nama, titik] of Object.entries(hasil.sentuhUang.titik)) {
    const harapKena = nama.endsWith('-27');
    assert.equal(
      titik.kena,
      harapKena,
      `.sentuh-uang di titik ${nama}: elementFromPoint mengembalikan ${titik.tag}, harap ${
        harapKena ? 'elemen itu sendiri (di dalam 56px)' : 'BUKAN elemen itu (di luar 56px)'
      }`
    );
  }

  assert.equal(hasil.radiusTombol, '10px', `--radius-control (tombol): borderRadius ${hasil.radiusTombol}, harap 10px`);
  assert.equal(hasil.radiusKartu, '12px', `--radius (kartu): borderRadius ${hasil.radiusKartu}, harap 12px`);
});

test('⛔ area sentuh tetangga tidak bertumpuk — setiap halaman galeri, ≥ 2 pasangan diperiksa di fondasi', async () => {
  const layarIds = await bacaDaftarLayar();
  const pelanggaran = [];
  const pasanganPerLayar = {};

  for (const id of layarIds) {
    const hal = await bukaLayar(id);
    const hasil = await hal.evaluate(async () => {
      function tunggu(ms) {
        return new Promise((r) => setTimeout(r, ms));
      }
      function targetSize(el) {
        return el.classList.contains('sentuh-uang') ? 56 : 44;
      }
      function labelEl(el) {
        if (!el) return 'null';
        const uji = el.getAttribute && el.getAttribute('data-uji');
        if (uji) return `[data-uji="${uji}"]`;
        const kelas = (el.className && typeof el.className === 'string' ? el.className : '').trim().split(/\s+/).filter(Boolean).join('.');
        return kelas ? `${el.tagName.toLowerCase()}.${kelas}` : el.tagName.toLowerCase();
      }
      function rectExpandedDefault(el) {
        const r = el.getBoundingClientRect();
        const t = targetSize(el);
        const mx = Math.max(0, (t - r.width) / 2);
        const my = Math.max(0, (t - r.height) / 2);
        return { left: r.left - mx, right: r.right + mx, top: r.top - my, bottom: r.bottom + my };
      }

      const panggung = document.querySelector('.galeri-panggung');
      const semua = panggung ? Array.from(panggung.querySelectorAll('.sentuh, .sentuh-uang')) : [];

      const pelanggaran = [];
      let totalPasangan = 0;

      for (let i = 0; i < semua.length; i += 1) {
        for (let j = i + 1; j < semua.length; j += 1) {
          const a = semua[i];
          const b = semua[j];
          const ea = rectExpandedDefault(a);
          const eb = rectExpandedDefault(b);
          const overlapX = ea.left < eb.right && eb.left < ea.right;
          const overlapY = ea.top < eb.bottom && eb.top < ea.bottom;
          if (!(overlapX && overlapY)) continue; // bukan tetangga dekat, tidak diperiksa

          totalPasangan += 1;

          // Bawa keduanya ke viewport SEBELUM mengukur/menekan — koordinat
          // `elementFromPoint` adalah koordinat viewport (lihat komentar
          // kepala berkas).
          a.scrollIntoView({ block: 'center', inline: 'center' });
          await tunggu(0);

          const ra = a.getBoundingClientRect();
          const rb = b.getBoundingClientRect();

          const gapX = ra.right <= rb.left ? rb.left - ra.right : rb.right <= ra.left ? ra.left - rb.right : null;
          const gapY = ra.bottom <= rb.top ? rb.top - ra.bottom : rb.bottom <= ra.top ? ra.top - rb.bottom : null;

          let sumbu = null;
          if (gapX !== null && (gapY === null || gapX <= gapY)) sumbu = 'x';
          else if (gapY !== null) sumbu = 'y';

          if (sumbu === null) {
            pelanggaran.push(
              `${labelEl(a)} vs ${labelEl(b)}: kotak TAMPILAN sudah bertumpang tindih (bukan sekadar area sentuh yang meluas)`
            );
            continue;
          }

          if (sumbu === 'x') {
            const kiri = ra.right <= rb.left ? a : b;
            const kanan = kiri === a ? b : a;
            const rk = kiri.getBoundingClientRect();
            const rn = kanan.getBoundingClientRect();
            const gapMid = (rk.right + rn.left) / 2;
            const y = (Math.max(rk.top, rn.top) + Math.min(rk.bottom, rn.bottom)) / 2;
            const titikKiri = document.elementFromPoint(gapMid - 2, y);
            const titikKanan = document.elementFromPoint(gapMid + 2, y);
            if (titikKiri !== kiri) {
              pelanggaran.push(
                `${labelEl(kiri)} vs ${labelEl(kanan)}: titik (${(gapMid - 2).toFixed(1)}, ${y.toFixed(1)}) — 2px kiri dari tengah celah — dijawab ${labelEl(titikKiri)}, harap ${labelEl(kiri)}`
              );
            }
            if (titikKanan !== kanan) {
              pelanggaran.push(
                `${labelEl(kiri)} vs ${labelEl(kanan)}: titik (${(gapMid + 2).toFixed(1)}, ${y.toFixed(1)}) — 2px kanan dari tengah celah — dijawab ${labelEl(titikKanan)}, harap ${labelEl(kanan)}`
              );
            }
          } else {
            const atas = ra.bottom <= rb.top ? a : b;
            const bawah = atas === a ? b : a;
            const rk = atas.getBoundingClientRect();
            const rn = bawah.getBoundingClientRect();
            const gapMid = (rk.bottom + rn.top) / 2;
            const x = (Math.max(rk.left, rn.left) + Math.min(rk.right, rn.right)) / 2;
            const titikAtas = document.elementFromPoint(x, gapMid - 2);
            const titikBawah = document.elementFromPoint(x, gapMid + 2);
            if (titikAtas !== atas) {
              pelanggaran.push(
                `${labelEl(atas)} vs ${labelEl(bawah)}: titik (${x.toFixed(1)}, ${(gapMid - 2).toFixed(1)}) — 2px atas dari tengah celah — dijawab ${labelEl(titikAtas)}, harap ${labelEl(atas)}`
              );
            }
            if (titikBawah !== bawah) {
              pelanggaran.push(
                `${labelEl(atas)} vs ${labelEl(bawah)}: titik (${x.toFixed(1)}, ${(gapMid + 2).toFixed(1)}) — 2px bawah dari tengah celah — dijawab ${labelEl(titikBawah)}, harap ${labelEl(bawah)}`
              );
            }
          }
        }
      }

      return { totalPasangan, pelanggaran, jumlahElemen: semua.length };
    });
    await hal.close();

    pasanganPerLayar[id] = hasil.totalPasangan;
    for (const p of hasil.pelanggaran) pelanggaran.push(`layar ${id}: ${p}`);
  }

  const ringkasan = Object.entries(pasanganPerLayar)
    .map(([id, n]) => `${id}=${n}`)
    .join(', ');

  assert.deepEqual(
    pelanggaran,
    [],
    `${pelanggaran.length} titik di garis tengah celah dijawab oleh tetangga, bukan elemen terdekat:\n  ` +
      pelanggaran.join('\n  ') +
      `\nPasangan diperiksa per layar: ${ringkasan}`
  );

  assert.ok(
    (pasanganPerLayar.fondasi ?? 0) >= 2,
    `fondasi: hanya ${pasanganPerLayar.fondasi ?? 0} pasangan .sentuh/.sentuh-uang diperiksa, harap >= 2 ` +
      `(baris tiga tombol 28×28 berjarak 8px harus menghasilkan 2 pasangan bertetangga). ` +
      `Pasangan per layar: ${ringkasan}`
  );
});
