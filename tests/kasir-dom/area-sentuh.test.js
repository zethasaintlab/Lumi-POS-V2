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
// Test pertama di berkas ini mengukur DUA elemen terisolasi 28×28
// (`data-uji="sentuh-tunggal"` dan `data-uji="sentuh-uang-tunggal"`) di
// `?layar=fondasi` pada titik ±21/±23 dan ±27/±29 (setengah 44/56, ±1) —
// bukti bahwa mekanismenya BEKERJA di tingkat unit, dengan angka yang mudah
// diperiksa manusia.
//
// ## ⛔ Fix round 2 (26 September 2026) — sabotase independen menemukan tiga
// lubang di test KEDUA (`docs/…/task-5-sabotase-independen.md`, S5/S8/S9),
// semuanya bentuk "hampa untuk kelas ini": pengukuran hanya menyentuh dua
// elemen fixture terisolasi dan hanya keadaan `normal`, bukan SETIAP elemen
// `.sentuh`/`.sentuh-uang` di SETIAP layar × SETIAP keadaan galeri.
//
// **F1 — ukuran ≥44/≥56 kini diperiksa di SETIAP elemen `.sentuh`/
// `.sentuh-uang` yang dipindai, bukan hanya dua fixture.** Untuk setiap
// elemen: titik TENGAH, lalu untuk setiap sisi (atas/kanan/bawah/kiri) yang
// TIDAK menghadap tetangga dalam jangkauan (dihitung dari GEOMETRI — kotak
// perluasan BAWAAN simetris, sama seperti pemeriksaan tetangga di bawah —
// bukan dari daftar bertipe atau dari nama komponen), titik SATU px di dalam
// kotak target (44 atau 56, dibaca dari `--touch-min`/`--touch-critical`
// SUNGGUHAN lewat `getComputedStyle`, bukan angka 44/56 yang diketik ulang)
// harus dijawab elemen itu sendiri (atau turunannya — ikon di dalam tombol).
// Sisi yang MENGHADAP tetangga sengaja TIDAK diperiksa di sini — pemeriksaan
// tetangga (di bawah) yang menegakkannya, karena kotak targetnya di sisi itu
// boleh lebih kecil dari 44/56 (dipotong `potongSentuh`).
//
// Ini menangkap DUA bentuk regresi yang lolos sebelumnya:
//   - sisi yang dipotong TANPA tetangga sungguhan di sana (kotak menyusut di
//     bawah 44/56 tanpa alasan geometris) — S5, tombol tengah baris tiga
//     dipotong juga di atas/bawah padahal tidak ada tetangga vertikal;
//   - `::before` yang secara CSS benar tapi ikut TERPOTONG oleh leluhur
//     `overflow: hidden`/`auto` (scroll container) atau TERTUTUP elemen lain
//     — S9, chip kategori 28px di baris ber-scroll: `::before`-nya meluas
//     sesuai CSS, tapi peramban tidak pernah menyerahkan titik itu ke
//     elemen karena leluhurnya memotong hit-testing di batas kotaknya
//     sendiri. Membaca CSS tidak pernah bisa melihat ini; hanya
//     `elementFromPoint` yang bisa.
//
// **F2 — dipindai di SETIAP keadaan galeri, bukan hanya `normal`.** Daftar
// keadaan DIBACA dari bilah galeri (`.galeri-grup[aria-label="Keadaan"]
// button`), sama seperti daftar layar — bukan diketik ulang sebagai daftar
// bertipe. Alih-alih membuka ulang halaman per kombinasi (9 layar × 11
// keadaan = 99 navigasi penuh, mahal), SATU halaman dipakai dan setiap
// kombinasi dicapai lewat KLIK pada tombol Layar lalu tombol Keadaan —
// persis interaksi yang seorang kasir lakukan, dan jauh lebih cepat karena
// tidak memuat ulang aset. Ini yang membuat S8 (stepper keranjang K-03)
// terlihat: keranjang KOSONG di keadaan `normal` (0 `.stepper`), tapi
// `keranjang-penuh` merender tombol −/+ 28px sungguhan yang tumpang tindih
// DAN terpotong `overflow: hidden` leluhurnya.
//
// **F3 — pemeriksaan tetangga (non-tumpang-tindih) kini menyampel LEBIH DARI
// satu pasang titik di ±2px dari garis tengah celah.** Untuk setiap pasangan
// bertetangga, beberapa titik disampel merentang dari dekat garis tengah
// (±1px) sampai dekat tepi kotak TAMPILAN masing-masing (mendekati setengah
// celah) — kesalahan sub-2px per sisi (celah yang meleset 1px) sekarang
// tertangkap; sebelumnya hanya ±2px yang disampel.
//
// ⛔ `elementFromPoint` memakai KOORDINAT VIEWPORT: elemen yang berada di luar
// jendela terlihat mengembalikan elemen LAIN pada titik yang sama — bukan
// cacat mekanisme, melainkan elemen itu sedang tidak di layar. Setiap
// pengukuran titik di berkas ini karena itu didahului `scrollIntoView` pada
// elemen yang diukur.
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

/**
 * Daftar layar DAN keadaan DIBACA dari bilah galeri, bukan diketik ulang
 * sebagai daftar bertipe — lihat § Cakupan di `skala-teks.test.js` untuk
 * alasan yang sama berlaku di sana.
 */
async function bacaDaftarGaleri() {
  const hal = await bukaLayar('fondasi');
  const daftar = await hal.evaluate(() => ({
    layar: Array.from(document.querySelectorAll('.galeri-grup[aria-label="Layar"] button')).map((b) =>
      b.textContent.trim()
    ),
    keadaan: Array.from(document.querySelectorAll('.galeri-grup[aria-label="Keadaan"] button')).map((b) =>
      b.textContent.trim()
    ),
  }));
  await hal.close();
  assert.ok(daftar.layar.length > 0, 'tidak ada tombol layar ditemukan di bilah galeri — halaman mungkin gagal muat');
  assert.ok(
    daftar.keadaan.length > 0,
    'tidak ada tombol keadaan ditemukan di bilah galeri — halaman mungkin gagal muat'
  );
  return daftar;
}

/**
 * Pindah ke kombinasi (layar, keadaan) lewat KLIK pada bilah galeri — bukan
 * membangun URL dengan slug keadaan yang ditebak (label tombol Keadaan
 * adalah TEKS manusia, bukan nilai `?keadaan=`). Klik jauh lebih murah
 * daripada navigasi penuh: satu halaman dipakai untuk seluruh 9×11
 * kombinasi.
 */
async function pindahKe(hal, layarIdx, keadaanIdx) {
  await hal.locator('.galeri-grup[aria-label="Layar"] button').nth(layarIdx).click();
  await hal.locator('.galeri-grup[aria-label="Keadaan"] button').nth(keadaanIdx).click();
  await hal.waitForFunction(
    () => (document.querySelector('.galeri-panggung')?.textContent ?? '').trim().length > 0,
    { timeout: 10_000 }
  );
  await hal.waitForTimeout(120);
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

test('⛔ area sentuh: ukuran ≥44/56 DAN tetangga tidak bertumpuk — setiap layar × setiap keadaan galeri', async () => {
  const { layar: layarLabel, keadaan: keadaanLabel } = await bacaDaftarGaleri();

  const hal = await bukaLayar(layarLabel[0] === 'fondasi' ? 'fondasi' : layarLabel[0]);

  const pelanggaranHit = [];
  const pelanggaranTumpang = [];
  /** Per LABEL layar: pasangan terbesar dan elemen terbesar terlihat di ANTARA seluruh keadaan. */
  const pasanganMaxPerLayar = {};
  const elemenMaxPerLayar = {};
  let kombinasiDiperiksa = 0;
  let totalElemenDijumlah = 0;
  let totalPasanganDijumlah = 0;

  for (let li = 0; li < layarLabel.length; li += 1) {
    for (let ki = 0; ki < keadaanLabel.length; ki += 1) {
      await pindahKe(hal, li, ki);
      kombinasiDiperiksa += 1;

      const hasil = await hal.evaluate(async () => {
        function tunggu(ms) {
          return new Promise((r) => setTimeout(r, ms));
        }
        function nilaiToken(nama) {
          const v = getComputedStyle(document.documentElement).getPropertyValue(nama).trim();
          const n = parseFloat(v);
          return Number.isFinite(n) ? n : 0;
        }
        const TOUCH_MIN = nilaiToken('--touch-min');
        const TOUCH_CRITICAL = nilaiToken('--touch-critical');
        function targetSize(el) {
          return el.classList.contains('sentuh-uang') ? TOUCH_CRITICAL : TOUCH_MIN;
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
        /** Beberapa titik antara 1px dari garis tengah sampai dekat tepi
            kotak TAMPILAN masing-masing (F3) — bukan hanya ±2px. */
        function offsetSampel(gapHalf) {
          const batas = Math.max(1, Math.floor(gapHalf - 0.5));
          const kandidat = [1, 2, 3, batas];
          return Array.from(new Set(kandidat.filter((o) => o >= 1 && o <= batas))).sort((a, b) => a - b);
        }

        const panggung = document.querySelector('.galeri-panggung');
        const semua = panggung ? Array.from(panggung.querySelectorAll('.sentuh, .sentuh-uang')) : [];

        const pelanggaranHit = [];
        const pelanggaranTumpang = [];
        let totalPasangan = 0;

        /* ⛔ F1 — sisi yang MENGHADAP tetangga (dalam jangkauan kotak
           perluasan BAWAAN) dikecualikan dari pemeriksaan ukuran penuh;
           pemeriksaan tetangga di bawah yang menegakkannya untuk sisi itu.
           Ini dihitung dari GEOMETRI (jarak antar elemen), bukan dari nama
           komponen atau daftar bertipe. */
        const sisiTerpotong = semua.map(() => new Set());

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
              pelanggaranTumpang.push(
                `${labelEl(a)} vs ${labelEl(b)}: kotak TAMPILAN sudah bertumpang tindih (bukan sekadar area sentuh yang meluas)`
              );
              continue;
            }

            if (sumbu === 'x') {
              const kiri = ra.right <= rb.left ? a : b;
              const kanan = kiri === a ? b : a;
              sisiTerpotong[kiri === a ? i : j].add('kanan');
              sisiTerpotong[kanan === a ? i : j].add('kiri');

              const rk = kiri.getBoundingClientRect();
              const rn = kanan.getBoundingClientRect();
              const gapMid = (rk.right + rn.left) / 2;
              const gapHalf = (rn.left - rk.right) / 2;
              const y = (Math.max(rk.top, rn.top) + Math.min(rk.bottom, rn.bottom)) / 2;

              for (const off of offsetSampel(gapHalf)) {
                const titikKiri = document.elementFromPoint(gapMid - off, y);
                const titikKanan = document.elementFromPoint(gapMid + off, y);
                if (!(titikKiri === kiri || (kiri.contains && kiri.contains(titikKiri)))) {
                  pelanggaranTumpang.push(
                    `${labelEl(kiri)} vs ${labelEl(kanan)}: titik (${(gapMid - off).toFixed(1)}, ${y.toFixed(1)}) — ${off}px kiri dari tengah celah — dijawab ${labelEl(titikKiri)}, harap ${labelEl(kiri)}`
                  );
                }
                if (!(titikKanan === kanan || (kanan.contains && kanan.contains(titikKanan)))) {
                  pelanggaranTumpang.push(
                    `${labelEl(kiri)} vs ${labelEl(kanan)}: titik (${(gapMid + off).toFixed(1)}, ${y.toFixed(1)}) — ${off}px kanan dari tengah celah — dijawab ${labelEl(titikKanan)}, harap ${labelEl(kanan)}`
                  );
                }
              }
            } else {
              const atas = ra.bottom <= rb.top ? a : b;
              const bawah = atas === a ? b : a;
              sisiTerpotong[atas === a ? i : j].add('bawah');
              sisiTerpotong[bawah === a ? i : j].add('atas');

              const rk = atas.getBoundingClientRect();
              const rn = bawah.getBoundingClientRect();
              const gapMid = (rk.bottom + rn.top) / 2;
              const gapHalf = (rn.top - rk.bottom) / 2;
              const x = (Math.max(rk.left, rn.left) + Math.min(rk.right, rn.right)) / 2;

              for (const off of offsetSampel(gapHalf)) {
                const titikAtas = document.elementFromPoint(x, gapMid - off);
                const titikBawah = document.elementFromPoint(x, gapMid + off);
                if (!(titikAtas === atas || (atas.contains && atas.contains(titikAtas)))) {
                  pelanggaranTumpang.push(
                    `${labelEl(atas)} vs ${labelEl(bawah)}: titik (${x.toFixed(1)}, ${(gapMid - off).toFixed(1)}) — ${off}px atas dari tengah celah — dijawab ${labelEl(titikAtas)}, harap ${labelEl(atas)}`
                  );
                }
                if (!(titikBawah === bawah || (bawah.contains && bawah.contains(titikBawah)))) {
                  pelanggaranTumpang.push(
                    `${labelEl(atas)} vs ${labelEl(bawah)}: titik (${x.toFixed(1)}, ${(gapMid + off).toFixed(1)}) — ${off}px bawah dari tengah celah — dijawab ${labelEl(titikBawah)}, harap ${labelEl(bawah)}`
                  );
                }
              }
            }
          }
        }

        /* ⛔ F1 — ukuran ≥44/56 ditegakkan untuk SETIAP elemen, bukan hanya
           dua fixture terisolasi. Titik TENGAH selalu diperiksa; per sisi,
           hanya bila sisi itu TIDAK menghadap tetangga (lihat sisiTerpotong
           di atas) — kotak "diharapkan" adalah kotak target PENUH (44/56)
           terpusat pada elemen, bukan kotak `::before` sungguhan (yang boleh
           lebih kecil bila SENGAJA dipotong; validitas pemotongan itu
           adalah urusan pemeriksaan tetangga di atas). */
        for (let idx = 0; idx < semua.length; idx += 1) {
          const el = semua[idx];
          const terpotong = sisiTerpotong[idx];
          el.scrollIntoView({ block: 'center', inline: 'center' });
          await tunggu(0);

          const r = el.getBoundingClientRect();
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          const t = targetSize(el);
          const halfX = Math.max(r.width / 2, t / 2);
          const halfY = Math.max(r.height / 2, t / 2);

          const tengah = document.elementFromPoint(cx, cy);
          if (!(tengah === el || (el.contains && el.contains(tengah)))) {
            pelanggaranHit.push(
              `${labelEl(el)} (target ${t}px) di titik TENGAH (${cx.toFixed(1)}, ${cy.toFixed(1)}): dijawab ${labelEl(tengah)}, harap elemen itu sendiri atau turunannya`
            );
          }

          const sisiUji = [
            ['kiri', cx - (halfX - 1), cy, halfX],
            ['kanan', cx + (halfX - 1), cy, halfX],
            ['atas', cx, cy - (halfY - 1), halfY],
            ['bawah', cx, cy + (halfY - 1), halfY],
          ];
          for (const [nama, x, y, half] of sisiUji) {
            if (terpotong.has(nama)) continue; // ditegakkan oleh pemeriksaan tetangga, kotaknya boleh < target di sini
            if (half <= 1) continue; // elemen sudah >= target di sumbu ini, tidak ada margin berarti untuk diuji
            const kena = document.elementFromPoint(x, y);
            if (!(kena === el || (el.contains && el.contains(kena)))) {
              pelanggaranHit.push(
                `${labelEl(el)} sisi ${nama} (target ${t}px, tidak menghadap tetangga) di titik (${x.toFixed(1)}, ${y.toFixed(1)}): dijawab ${labelEl(kena)}, harap elemen itu sendiri atau turunannya`
              );
            }
          }
        }

        return { totalPasangan, pelanggaranHit, pelanggaranTumpang, jumlahElemen: semua.length };
      });

      const layarNama = layarLabel[li];
      for (const p of hasil.pelanggaranHit) pelanggaranHit.push(`layar ${layarNama} · keadaan ${keadaanLabel[ki]}: ${p}`);
      for (const p of hasil.pelanggaranTumpang) pelanggaranTumpang.push(`layar ${layarNama} · keadaan ${keadaanLabel[ki]}: ${p}`);

      pasanganMaxPerLayar[layarNama] = Math.max(pasanganMaxPerLayar[layarNama] ?? 0, hasil.totalPasangan);
      elemenMaxPerLayar[layarNama] = Math.max(elemenMaxPerLayar[layarNama] ?? 0, hasil.jumlahElemen);
      totalElemenDijumlah += hasil.jumlahElemen;
      totalPasanganDijumlah += hasil.totalPasangan;
    }
  }

  await hal.close();

  const ringkasan =
    `Kombinasi diperiksa: ${layarLabel.length} layar × ${keadaanLabel.length} keadaan = ${kombinasiDiperiksa}. ` +
    `Total elemen .sentuh/.sentuh-uang diperiksa (dijumlah semua kombinasi): ${totalElemenDijumlah}. ` +
    `Total pasangan bertetangga diperiksa (dijumlah semua kombinasi): ${totalPasanganDijumlah}. ` +
    `Pasangan terbanyak per layar (di antara seluruh keadaan): ` +
    Object.entries(pasanganMaxPerLayar).map(([id, n]) => `${id}=${n}`).join(', ');

  assert.deepEqual(
    pelanggaranHit,
    [],
    `${pelanggaranHit.length} elemen gagal memenuhi ukuran area sentuh minimal pada sisi yang tidak menghadap tetangga:\n  ` +
      pelanggaranHit.join('\n  ') +
      `\n${ringkasan}`
  );

  assert.deepEqual(
    pelanggaranTumpang,
    [],
    `${pelanggaranTumpang.length} titik di garis tengah celah (atau dekat tepinya) dijawab oleh tetangga, bukan elemen terdekat:\n  ` +
      pelanggaranTumpang.join('\n  ') +
      `\n${ringkasan}`
  );

  // Sentinel: penjaga ini harus MEMINDAI SESUATU pada `fondasi`, dengan
  // margin — kalau angka ini nol atau sangat kecil, penjaga hampa untuk
  // kelas ini persis seperti versi lama yang ditemukan sabotase independen.
  assert.ok(
    (elemenMaxPerLayar.fondasi ?? 0) >= 1,
    `fondasi: nol elemen .sentuh/.sentuh-uang terlihat di keadaan mana pun — penjaga ini hampa. ${ringkasan}`
  );
  assert.ok(
    (pasanganMaxPerLayar.fondasi ?? 0) >= 4,
    `fondasi: pasangan bertetangga terbanyak yang terlihat hanya ${pasanganMaxPerLayar.fondasi ?? 0}, harap >= 4 ` +
      `(dua baris tiga tombol 28×28 — jarak --space-2/8px dan --space-3/12px — masing-masing ` +
      `menghasilkan 2 pasangan bertetangga). ${ringkasan}`
  );
});
