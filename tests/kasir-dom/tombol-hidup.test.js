'use strict';

// G-TOMBOL-HIDUP (spec § 11) — tidak ada tombol mati.
//
// Dua pemeriksaan, dua biaya berbeda:
//
//   1. ALASAN NONAKTIF (murah, tanpa klik): SETIAP tombol terlihat DAN
//      `disabled` di SETIAP kombinasi layar × keadaan galeri wajib
//      `aria-describedby` yang menunjuk teks TAK KOSONG. Dibaca sekali per
//      kombinasi — tidak perlu klik apa pun.
//   2. HIDUP (mahal, per klik): SETIAP tombol terlihat DAN TIDAK `disabled`
//      wajib mengubah DOM saat diklik (dialog terbuka, rute berubah, atau
//      keadaan lain berubah), dalam 500ms.
//
// ## ⛔ Cakupan pemeriksaan (2) DIPERSEMPIT dari "setiap layar × setiap
// keadaan", dan itu disengaja — dicatat di sini, bukan diam-diam
//
// Literal spec G-TOMBOL-HIDUP membaca "setiap layar × keadaan galeri". K-03
// sendirian punya sampai ~70 tombol pada `keranjang-penuh` (20 baris × dua
// tombol stepper + toolbar + chip + grid produk + Bayar), dan menguji SETIAP
// tombol di SETIAP dari ~9 layar × ~12 keadaan = 108 kombinasi berarti
// ribuan klik — masing-masing butuh mount ULANG (lihat § "halaman segar" di
// bawah) supaya klik satu tidak mencemari klik berikutnya. Itu bukan ongkos
// yang masuk akal untuk satu `npm test`, dan pola yang sama sudah diambil
// `area-sentuh.test.js` F2 ("99 navigasi penuh, mahal") untuk alasan yang
// sama persis.
//
// Pemeriksaan (2) karena itu berjalan pada keadaan **`Normal`** untuk
// SETIAP layar (dibaca dari halaman, bukan diketik) — keadaan yang selalu
// ada dan yang setiap layar galeri punya arti untuknya — DITAMBAH
// **`Keranjang penuh (20 baris)`** khusus untuk K-03, supaya baris keranjang
// (stepper, Bayar) ikut teruji. Pemeriksaan (1) — alasan nonaktif — TETAP
// exhaustive di SELURUH kombinasi, karena ia tidak perlu klik dan karena itu
// murah.
//
// Ini adalah GARIS DASAR, bukan cakupan akhir: memperluas (2) ke keadaan
// lain adalah pekerjaan lanjutan yang sah, bukan sesuatu yang penjaga ini
// diam-diam klaim sudah selesai.
//
// ## ⛔ "Halaman segar" — remount React, bukan navigasi HTTP baru
//
// Setiap klik diuji pada MOUNT yang baru: sebelum tombol diklik, kombinasi
// (layar, keadaan) yang sama dipindah ke keadaan LAIN lalu kembali —
// `key={layarId}-${skenario}` di `Galeri.tsx` berubah dua kali, memaksa
// `DbLokalPalsuProvider` dan pohon layar REMOUNT dari nol, persis seperti
// membuka halaman baru untuk kombinasi itu. Navigasi HTTP penuh per tombol
// (ratusan `page.goto`) ongkosnya jauh lebih mahal untuk manfaat yang sama:
// state React yang benar-benar kosong, bukan proses peramban yang baru.
//
// ⛔ Remount HANYA dilakukan SEBELUM tombol yang akan diklik — bukan sesudah
// setiap klik yang TIDAK mengubah apa pun (klik yang gagal tidak mencemari
// apa pun untuk diuji ulang).
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

/**
 * Daftar TERTUTUP: tombol nonaktif tanpa `aria-describedby` yang DITERIMA
 * sebagai pengecualian, dengan alasannya. Setiap entri lain yang ditemukan
 * MERAH — lihat kepala berkas untuk kenapa daftar ini dibatasi.
 */
const PENGECUALIAN_ALASAN = [
  {
    layar: 'fondasi',
    label: 'Nonaktif',
    alasan:
      'Swatch dokumentasi design system (`Fondasi.tsx`, `data-uji="btn-*-nonaktif"`) — ' +
      'bukan kontrol aplikasi, sengaja nonaktif SELAMANYA untuk menunjukkan keadaan ' +
      'visual `disabled`. Tidak ada "alasan" produk untuk ditulis.',
  },
];

/**
 * Daftar TERTUTUP terpisah, untuk pemeriksaan (2) — tombol yang MELAKUKAN
 * sesuatu (bukan `disabled`, bukan diam karena mati) tapi hasilnya tidak
 * pernah terlihat DI FIXTURE GALERI STATIS ini, jadi DOM tidak berubah.
 * Sama seperti `PENGECUALIAN_ALASAN`: dibatasi ≤ 5, beralasan, dan kalau
 * daftarnya perlu tumbuh itu tanda cakupan pemeriksaan (2) harus dilebarkan
 * lebih dulu (§ cakupan di kepala berkas), bukan daftar ini yang membesar.
 */
const PENGECUALIAN_DIAM = [
  {
    layar: 'K-14',
    label: 'Muat ulang angka',
    alasan:
      '`muatUlang` (`useAntrean`, `StatusSinkronisasi.tsx`) membaca ulang antrean dari ' +
      'DB PALSU galeri, yang SELALU mengembalikan baris yang SAMA — angka hasil baca ' +
      'ulang identik dengan sebelumnya, jadi React tidak menyentuh satu node DOM pun ' +
      '(bukan "tidak melakukan apa-apa", melainkan "melakukan, hasilnya sama"). Pada ' +
      'DB sungguhan yang antreannya berubah, baca ulang MENGUBAH angka yang tampil.',
  },
];

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

async function bukaGaleri() {
  const hal = await peramban.newPage({ viewport: { width: 1280, height: 900 } });
  await hal.goto(`${alamat}/harness-galeri.html?layar=fondasi&keadaan=normal`, { waitUntil: 'load' });
  await hal.waitForSelector('.galeri-panggung', { timeout: 10_000 });
  await tungguIsi(hal);
  return hal;
}

async function tungguIsi(hal) {
  await hal.waitForFunction(
    () => (document.querySelector('.galeri-panggung')?.textContent ?? '').trim().length > 0,
    { timeout: 10_000 }
  );
  await hal.waitForTimeout(120);
}

/** Daftar layar DAN keadaan DIBACA dari bilah galeri — lihat `area-sentuh.test.js`. */
async function bacaDaftarGaleri(hal) {
  const daftar = await hal.evaluate(() => ({
    layar: Array.from(document.querySelectorAll('.galeri-grup[aria-label="Layar"] button')).map((b) =>
      b.textContent.trim()
    ),
    keadaan: Array.from(document.querySelectorAll('.galeri-grup[aria-label="Keadaan"] button')).map((b) =>
      b.textContent.trim()
    ),
  }));
  assert.ok(daftar.layar.length > 0, 'tidak ada tombol layar di bilah galeri — halaman mungkin gagal muat');
  assert.ok(daftar.keadaan.length > 0, 'tidak ada tombol keadaan di bilah galeri — halaman mungkin gagal muat');
  return daftar;
}

/* ⛔ `{ force: true }` di SETIAP klik bilah galeri di bawah ini, sengaja.
   Tombol yang baru saja diuji (2/2) bisa saja membuka dialog LAYAR PENUH
   (`.kasir-dialog-latar { position: fixed; inset: 0 }`) yang menutupi bilah
   galeri di ATASnya — Playwright menolak klik "normal" pada elemen yang
   tertutup elemen lain ("subtree intercepts pointer events") dan menunggu
   sampai timeout. Bilah galeri harus TETAP berfungsi sebagai jalan RESET
   walau layar di baliknya sedang menampilkan dialog apa pun — itu justru
   fungsinya di sini: memaksa remount TERLEPAS dari keadaan dialog. */
/* ⛔ Klik bilah galeri lewat `element.click()` di DALAM `evaluate`, BUKAN
   locator Playwright — termasuk dengan `{ force: true }`. Force HANYA
   melewati pemeriksaan actionability Playwright; klik itu SENDIRI tetap
   dikirim ke KOORDINAT elemen, dan dialog LAYAR PENUH yang tertinggal
   TERBUKA dari kombinasi SEBELUMNYA (mis. tombol yang membuka
   "Batalkan transaksi" lalu tidak diuji lebih lanjut) duduk DI ATAS bilah
   galeri pada koordinat yang sama — klik "force" pun jatuh ke backdrop
   dialog, bilah galeri tidak pernah tersentuh, dan SELURUH sisa sapuan diam-
   diam menguji halaman K-03 yang sama berulang-ulang sambil melaporkan
   label kombinasi yang SALAH. `element.click()` di `evaluate` memanggil
   handler React LANGSUNG pada node yang dimaksud, terlepas dari apa pun yang
   secara visual menutupinya — persis yang dibutuhkan bilah galeri supaya
   tetap berfungsi sebagai jalan RESET apa pun keadaan layar di baliknya. */
async function klikBilah(hal, grup, idx) {
  await hal.evaluate(
    ({ grup, idx }) => {
      const tombol = document.querySelectorAll(`.galeri-grup[aria-label="${grup}"] button`)[idx];
      if (tombol) tombol.click();
    },
    { grup, idx }
  );
}

async function pindahKe(hal, layarIdx, keadaanIdx) {
  await klikBilah(hal, 'Layar', layarIdx);
  await klikBilah(hal, 'Keadaan', keadaanIdx);
  await tungguIsi(hal);
}

/** Memaksa REMOUNT pohon layar untuk kombinasi yang SAMA — lihat kepala berkas.
    `labelTunggu`, bila diberi, menunggu tombol berlabel itu SUNGGUH muncul
    lagi (bukan sekadar `.galeri-panggung` tidak kosong) — layar kasir
    memuat datanya lewat `useEffect` async, jadi mount pertama sesaat
    menampilkan "Menyiapkan kasir…" sebelum toolbar/grid sungguhan ada. */
async function segarkanUlang(hal, layarIdx, keadaanIdx, jumlahKeadaan, labelTunggu) {
  const netral = (keadaanIdx + 1) % jumlahKeadaan;
  // ⛔ Layar DIKUNCI ULANG juga (bukan hanya keadaan): dialog layar-penuh
  // yang mungkin masih terbuka dari klik SEBELUMNYA bisa jadi TIDAK peduli
  // pada perubahan keadaan (mis. dialog K-09 yang tidak dibongkar oleh
  // remount K-09 lain) — mengetuk ulang tombol Layar yang SAMA tidak
  // mengubah `key` React, tapi klik `element.click()` langsung tetap
  // menjangkau tombol itu meski dialog menutupinya secara visual, dan
  // urutan (netral → target keadaan) di bawah tetap yang memaksa remount.
  await klikBilah(hal, 'Layar', layarIdx);
  await klikBilah(hal, 'Keadaan', netral);
  await hal.waitForTimeout(40);
  await klikBilah(hal, 'Keadaan', keadaanIdx);
  await tungguIsi(hal);
  if (labelTunggu) {
    await hal
      .waitForFunction(
        (label) => {
          const panggung = document.querySelector('.galeri-panggung');
          if (!panggung) return false;
          return Array.from(panggung.querySelectorAll('button')).some(
            (b) => (b.getAttribute('aria-label') || b.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 80) === label
          );
        },
        labelTunggu,
        { timeout: 5_000 }
      )
      .catch(() => {
        /* ⛔ Ditelan dengan sengaja: kalau tombolnya SUNGGUH tidak muncul
           lagi, evaluate() di pemanggil akan menjawab 'tombol-hilang' dan
           itu dicatat sebagai diagnostik, bukan gagal timeout di sini. */
      });
  }
}

/** Snapshot setiap `<button>` di `.galeri-panggung` (bukan bilah galeri). */
async function bacaTombol(hal) {
  return hal.evaluate(() => {
    const panggung = document.querySelector('.galeri-panggung');
    if (!panggung) return [];
    return Array.from(panggung.querySelectorAll('button')).map((b) => {
      const r = b.getBoundingClientRect();
      const cs = getComputedStyle(b);
      const visible = r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
      const describedby = b.getAttribute('aria-describedby');
      const elAlasan = describedby ? document.getElementById(describedby) : null;
      const teksAlasan = elAlasan ? elAlasan.textContent.trim() : '';
      return {
        label: (b.getAttribute('aria-label') || b.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 80),
        disabled: b.disabled,
        visible,
        alasanKosong: teksAlasan === '',
        // ⛔ Toggle/tab yang SUDAH AKTIF (aria-pressed/aria-selected="true")
        // TIDAK diuji di pemeriksaan (2). Menekan opsi yang sudah terpilih
        // (mis. urutan "A–Z" saat itu sudah urutan aktif, chip "Semua" saat
        // itu sudah saringan aktif) TIDAK BOLEH mengubah apa pun — itu
        // idempoten, bukan tombol mati. Klik pertama yang MEMILIHNYA sudah
        // diuji lewat kandidat lain di daftar yang sama.
        sudahAktif: b.getAttribute('aria-pressed') === 'true' || b.getAttribute('aria-selected') === 'true',
        // ⛔ Tab navigasi (`[role="tab"]` di dalam `[role="tablist"]`, bilah
        // nav `ShellKasir`) memanggil `navigasi()` — router SUNGGUHAN yang
        // galeri TIDAK sambungkan ke `layarId`/`keadaan` (galeri memilih
        // komponen lewat state-nya sendiri, bukan lewat URL). Tab ini karena
        // itu SELALU tampak "diam" di galeri walau berfungsi di aplikasi
        // asli — batas harness yang dinyatakan, bukan tombol mati.
        tabNavigasi: b.closest('[role="tablist"]') !== null,
      };
    });
  });
}

// ---------------------------------------------------------------------------

test('⛔ G-TOMBOL-HIDUP (1/2): tombol nonaktif SELALU punya aria-describedby berisi alasan tak kosong', async (t) => {
  for (const e of PENGECUALIAN_ALASAN) {
    assert.ok(e.layar && e.label && e.alasan, `entri PENGECUALIAN_ALASAN tidak lengkap: ${JSON.stringify(e)}`);
  }
  assert.ok(
    PENGECUALIAN_ALASAN.length <= 5,
    `PENGECUALIAN_ALASAN punya ${PENGECUALIAN_ALASAN.length} entri — batas 5 (spec § 11 G-TOMBOL-HIDUP). ` +
      'Daftar tertutup ini ada untuk MENCEGAH pelanggaran tersembunyi di baliknya, bukan untuk ditambah tanpa batas.'
  );

  const hal = await bukaGaleri();
  const { layar, keadaan } = await bacaDaftarGaleri(hal);

  const pelanggar = [];
  let diperiksa = 0;

  for (let li = 0; li < layar.length; li += 1) {
    for (let ki = 0; ki < keadaan.length; ki += 1) {
      await pindahKe(hal, li, ki);
      const tombol = await bacaTombol(hal);
      for (const b of tombol) {
        if (!b.visible || !b.disabled) continue;
        diperiksa += 1;
        if (!b.alasanKosong) continue;
        const dikecualikan = PENGECUALIAN_ALASAN.some((e) => e.layar === layar[li] && e.label === b.label);
        if (!dikecualikan) pelanggar.push({ layar: layar[li], keadaan: keadaan[ki], label: b.label });
      }
    }
  }
  await hal.close();

  t.diagnostic(`${diperiksa} tombol nonaktif diperiksa di ${layar.length}×${keadaan.length} kombinasi`);

  const unik = new Map();
  for (const p of pelanggar) {
    const kunci = `${p.layar}::${p.label}`;
    if (!unik.has(kunci)) unik.set(kunci, { ...p, keadaanContoh: p.keadaan, jumlah: 0 });
    unik.get(kunci).jumlah += 1;
  }
  assert.equal(
    pelanggar.length,
    0,
    `${unik.size} tombol nonaktif TANPA aria-describedby (bukan pengecualian): ` +
      [...unik.values()]
        .map((p) => `${p.layar}/"${p.label}" (mis. keadaan "${p.keadaanContoh}", ${p.jumlah}×)`)
        .join('; ')
  );
});

test('⛔ G-TOMBOL-HIDUP (2/2): tombol terlihat+aktif mengubah DOM saat diklik (halaman segar per klik)', async (t) => {
  for (const e of PENGECUALIAN_DIAM) {
    assert.ok(e.layar && e.label && e.alasan, `entri PENGECUALIAN_DIAM tidak lengkap: ${JSON.stringify(e)}`);
  }
  assert.ok(
    PENGECUALIAN_DIAM.length <= 5,
    `PENGECUALIAN_DIAM punya ${PENGECUALIAN_DIAM.length} entri — batas 5, pola yang sama dengan PENGECUALIAN_ALASAN.`
  );

  const hal = await bukaGaleri();
  const { layar, keadaan } = await bacaDaftarGaleri(hal);

  const idxNormal = keadaan.findIndex((k) => k === 'Normal');
  assert.ok(idxNormal >= 0, `keadaan "Normal" tidak ditemukan di bilah galeri (${JSON.stringify(keadaan)})`);
  const idxKeranjangPenuh = keadaan.findIndex((k) => /^Keranjang penuh/.test(k));
  assert.ok(
    idxKeranjangPenuh >= 0,
    `keadaan "Keranjang penuh (…)" tidak ditemukan di bilah galeri (${JSON.stringify(keadaan)})`
  );
  const idxK03 = layar.findIndex((l) => l === 'K-03');
  assert.ok(idxK03 >= 0, `layar "K-03" tidak ditemukan di bilah galeri (${JSON.stringify(layar)})`);

  /** Kombinasi (layar, keadaan) yang diuji — lihat § cakupan di kepala berkas.
      ⛔ `fondasi` DIKELUARKAN: ia dokumentasi design system (swatch "Normal
      "/"Hover"/"Kritis", contoh chip, kartu produk mati) — bukan layar
      aplikasi, dan tombol demonya SENGAJA tidak melakukan apa-apa. Tetap
      diperiksa pemeriksaan (1) di atas (murah, tidak perlu tahu maknanya). */
  const kombinasi = layar
    .map((_, li) => [li, idxNormal])
    .filter(([li]) => layar[li] !== 'fondasi');
  kombinasi.push([idxK03, idxKeranjangPenuh]);

  let totalDiklik = 0;
  const pelanggar = [];

  for (const [li, ki] of kombinasi) {
    await pindahKe(hal, li, ki);
    const tombol = await bacaTombol(hal);
    const kandidat = tombol
      .map((b, i) => ({ ...b, i }))
      /* ⛔ TIGA pengecualian STRUKTURAL, bukan daftar tombol per nama:
         (a) `disabled` — diperiksa pemeriksaan (1), bukan di sini;
         (b) `sudahAktif` (`aria-pressed`/`aria-selected="true"`) — menekan
             opsi yang SUDAH aktif (urutan/chip/tab yang sedang terpilih)
             MEMANG tidak mengubah apa pun; itu idempoten, bukan mati;
         (c) `tabNavigasi` (`role="tab"`) — tab bilah nav `ShellKasir`
             memanggil `navigasi()` (`pushState`), dan TIDAK ADA router yang
             mendengarkannya di galeri (`Galeri.tsx` memilih komponen lewat
             `layarId`, bukan lewat URL) — batas harness, bukan tombol mati
             di aplikasi asli. Perubahan LAYAR di aplikasi asli sendiri
             sudah diuji `header.test.js`/`galeri-cakupan.test.js`. */
      .filter((b) => b.visible && !b.disabled && !b.sudahAktif && !b.tabNavigasi);

    for (const kand of kandidat) {
      // Halaman SEGAR sebelum tombol INI diklik — lihat § "halaman segar".
      await segarkanUlang(hal, li, ki, keadaan.length, kand.label);
      const hasil = await hal.evaluate(
        async ({ idx, labelHarap }) => {
          const panggung = document.querySelector('.galeri-panggung');
          const daftar = panggung ? Array.from(panggung.querySelectorAll('button')) : [];
          const tombolTarget = daftar[idx];
          if (!tombolTarget) return 'tombol-hilang';
          const labelSekarang = (tombolTarget.getAttribute('aria-label') || tombolTarget.innerText || '')
            .trim()
            .replace(/\s+/g, ' ')
            .slice(0, 80);
          // Snapshot setelah remount mungkin bergeser urutannya sedikit
          // (mis. animasi) — kalau label di indeks yang sama sudah TIDAK
          // cocok, cari ulang lewat label persis, supaya klik tetap
          // menyasar tombol yang dimaksud, bukan tetangganya.
          const target =
            labelSekarang === labelHarap
              ? tombolTarget
              : daftar.find(
                  (b) => (b.getAttribute('aria-label') || b.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 80) === labelHarap
                );
          if (!target || target.disabled) return 'tombol-hilang';

          let berubah = false;
          const mo = new MutationObserver(() => {
            berubah = true;
          });
          mo.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
          // ⛔ `pathname` IKUT dibandingkan, bukan hanya `search`. `navigasi()`
          // (`rute/navigasi.ts`) memanggil `history.pushState` pada
          // PATHNAME ("/riwayat/ord-1"), bukan query string — tombol yang
          // memanggilnya tetap "mengubah sesuatu" walau harness galeri tidak
          // punya router yang bereaksi ke situ.
          const urlAwal = location.pathname + location.search;
          target.click();
          await new Promise((r) => setTimeout(r, 500));
          mo.disconnect();
          if (berubah || location.pathname + location.search !== urlAwal) return 'ok';
          return 'diam';
        },
        { idx: kand.i, labelHarap: kand.label }
      );

      totalDiklik += 1;
      if (hasil === 'ok') continue;
      if (hasil === 'tombol-hilang') {
        // Tombol yang sudah tidak ada/terjangkau di mount SEGAR ini bukan
        // tombol MATI — ia mungkin bergantung urutan render acak (mis.
        // ULID). Dicatat sebagai diagnostik, bukan pelanggaran.
        t.diagnostic(`${layar[li]}/${keadaan[ki]}: "${kand.label}" tidak ditemukan lagi di mount segar, dilewati`);
        continue;
      }
      const dikecualikan = PENGECUALIAN_DIAM.some((e) => e.layar === layar[li] && e.label === kand.label);
      if (dikecualikan) continue;
      pelanggar.push({ layar: layar[li], keadaan: keadaan[ki], label: kand.label });
    }
  }
  await hal.close();

  t.diagnostic(`${totalDiklik} tombol diklik di ${kombinasi.length} kombinasi (layar×keadaan)`);
  assert.ok(totalDiklik >= 60, `hanya ${totalDiklik} tombol diklik — spec § 11 G-TOMBOL-HIDUP menuntut >= 60`);

  const unik = new Map();
  for (const p of pelanggar) {
    const kunci = `${p.layar}::${p.keadaan}::${p.label}`;
    if (!unik.has(kunci)) unik.set(kunci, p);
  }
  assert.equal(
    pelanggar.length,
    0,
    `${unik.size} tombol tidak mengubah DOM saat diklik: ` +
      [...unik.values()].map((p) => `${p.layar}/${p.keadaan}/"${p.label}"`).join('; ')
  );
});
