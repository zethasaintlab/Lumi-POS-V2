'use strict';

// K-12 tahap REVIEW — "Tutup Kas" terlihat tanpa menggulir.
//
// ## ⛔ Cacat yang penjaga ini tutup
//
// Terukur 21 September 2026 pada 1280×800, tahap review dengan selisih di atas
// ambang (enam radio alasan tampil):
//
//     isi                714 px   di ruang 658 px  → `.kasir-grid-panel` menggulir
//     tombol "Tutup Kas" berakhir di  823 px
//     batas `.kasir-konten`           783 px
//     slot aksi bilah nav             KOSONG
//
// Aksi uang — 56 px, benar menurut aturan design system #3 — berada **40 px di
// luar layar** sampai kasir menggulir. `IA:430` menamai K-12 sebagai salah satu
// layar ber-"satu aksi utama"; K-03 dan K-14 sudah memindahkan aksinya ke slot
// bilah nav, K-12 belum.
//
// ⛔ Kasir menutup kas sambil memegang uang, sering berdiri, sering terburu.
// Tombol yang harus dicari dengan menggulir adalah tombol yang ditekan dua kali
// atau tidak ditekan sama sekali — dan yang tidak ditekan meninggalkan shift
// terbuka semalaman.
//
// ## ⛔ Kenapa skenario `offline` ikut diuji
//
// Pita FR-H8 memakan 61 px dari `.kasir-konten`. Layar yang muat pas di
// skenario `normal` dapat tidak muat di `offline`, dan `offline` adalah
// keadaan yang seluruh arsitektur ini ada untuk mendukungnya. Satu skenario
// yang diperiksa tidak dapat membedakan "muat" dari "kebetulan muat".
//
// ## Prasyarat
//
//   npm run build:galeri
//
// Lihat kepala `k03-chrome.test.js`.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const AKAR = path.resolve(__dirname, '..', '..');
const DIST = path.join(AKAR, 'dist-galeri');

/** Skenario yang tahap reviewnya diperiksa, dan kenapa masing-masing ada. */
const SKENARIO = [
  ['normal', 'ruang penuh'],
  ['offline', 'pita FR-H8 memakan 61 px dari tinggi konten'],
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

/**
 * Membuka K-12 dan menempuhnya sampai tahap REVIEW.
 *
 * ⛔ Hitungannya JAUH dari saldo seharusnya, supaya selisihnya melewati ambang
 * dan keenam radio alasan ikut tampil. Itu bentuk review yang PALING TINGGI,
 * dan satu-satunya yang membuktikan tombolnya tetap terlihat saat layarnya
 * paling penuh. Review dengan selisih nol muat tanpa perbaikan apa pun.
 */
async function bukaReview(keadaan) {
  const hal = await peramban.newPage({ viewport: { width: 1280, height: 800 } });
  const galat = [];
  hal.on('pageerror', (e) => galat.push(e.message));
  hal.on('console', (m) => {
    if (m.type() === 'error' && /Failed to load resource/.test(m.text())) return;
    if (m.type() === 'error') galat.push(m.text());
  });
  await hal.goto(`${alamat}/harness-galeri.html?layar=K-12&keadaan=${keadaan}`, {
    waitUntil: 'load',
  });
  await hal.waitForSelector('.kasir-konten', { timeout: 10_000 });
  await hal.waitForTimeout(1200);

  const bidang = hal.getByLabel(/hitungan fisik/i);
  await bidang.waitFor({ state: 'visible', timeout: 5_000 });
  await bidang.fill('300000');
  await hal.getByRole('button', { name: 'Lanjut' }).click();
  await hal.waitForTimeout(1000);
  return { hal, galat };
}

// ---------------------------------------------------------------------------

test('⛔ "Tutup Kas" terlihat tanpa menggulir di tahap review, di kedua skenario', async (t) => {
  const pelanggar = [];
  const catatan = [];

  for (const [keadaan, kenapa] of SKENARIO) {
    const { hal, galat } = await bukaReview(keadaan);

    const ukur = await hal.evaluate(() => {
      const konten = document.querySelector('.kasir-konten');
      /* ⛔ Tab navigasi DIKECUALIKAN, dan itu bukan kerapian. Bilah nav punya
         item bernama "Tutup Kas" juga — ia yang membawa kasir ke layar ini —
         dan `querySelectorAll('button')` menemukannya LEBIH DULU karena ia
         lebih tinggi di pohon. Versi pertama penjaga ini mengukur tab itu:
         tingginya 46px dan posisinya 124px, jadi ia melaporkan pelanggaran
         target sentuh atas tab navigasi sambil tidak pernah melihat tombol
         aksinya sama sekali. Ditemukan dengan mencetak apa yang ia ukur.

         `[role="tablist"]` adalah pembeda yang benar: slot aksi berada di
         bilah nav yang SAMA, jadi menyaring per `.kasir-bilah` akan membuang
         tombol yang justru dicari. */
      const semua = [...document.querySelectorAll('button')].filter(
        (b) => !b.closest('[role="tablist"]')
      );
      const tombol = semua.find((b) => /^Tutup Kas$/i.test(b.innerText.trim()));
      if (!konten || !tombol) return { err: !konten ? '.kasir-konten hilang' : 'tombol "Tutup Kas" tidak ada' };
      const k = konten.getBoundingClientRect();
      const b = tombol.getBoundingClientRect();
      const slot = document.querySelector('.kasir-slot-aksi');
      return {
        batasKonten: Math.round(k.bottom),
        bawahTombol: Math.round(b.bottom),
        tinggiTombol: Math.round(b.height),
        diSlot: slot ? slot.contains(tombol) : false,
        labelSlot: slot
          ? [...slot.querySelectorAll('button')].map((x) => x.innerText.trim().replace(/\s+/g, ' '))
          : null,
        /* ⛔ Ambang sentuh diperiksa DI SINI juga. Tombol yang dipindahkan ke
           bilah nav mudah mengecil mengikuti tinggi bilahnya, dan 56px adalah
           tuntutan aturan design system #3 untuk aksi menyangkut uang. */
        tinggiBilah: Math.round(
          document.querySelector('.kasir-bilah')?.getBoundingClientRect().height ?? 0
        ),
      };
    });
    await hal.close();
    assert.equal(galat.length, 0, `galat konsol di ${keadaan}: ${galat.join(' | ')}`);
    assert.equal(ukur.err, undefined, `${keadaan}: ${ukur.err}`);

    catatan.push(
      `${keadaan} (${kenapa}): bawah tombol ${ukur.bawahTombol}px, batas konten ` +
        `${ukur.batasKonten}px, tinggi tombol ${ukur.tinggiTombol}px, di slot: ${ukur.diSlot}` +
        (ukur.labelSlot ? `, isi slot: [${ukur.labelSlot.join(' · ')}]` : '')
    );

    if (ukur.bawahTombol > ukur.batasKonten) {
      pelanggar.push(
        `  ${keadaan}: "Tutup Kas" berakhir di ${ukur.bawahTombol}px sementara area ` +
          `konten berhenti di ${ukur.batasKonten}px — ${ukur.bawahTombol - ukur.batasKonten}px ` +
          'di luar layar.'
      );
    }
    if (ukur.tinggiTombol < 56) {
      pelanggar.push(
        `  ${keadaan}: tinggi "Tutup Kas" ${ukur.tinggiTombol}px, di bawah 56px yang ` +
          'aturan design system #3 tuntut untuk aksi menyangkut uang.'
      );
    }
  }

  assert.deepEqual(
    pelanggar,
    [],
    'tahap review K-12 menyembunyikan aksi uangnya:\n' +
      pelanggar.join('\n') +
      '\n\n  ⛔ Kasir menutup kas sambil memegang uang, sering berdiri, sering ' +
      'terburu. Tombol yang harus dicari dengan menggulir adalah tombol yang ' +
      'ditekan dua kali atau tidak ditekan sama sekali — dan yang tidak ditekan ' +
      'meninggalkan shift terbuka semalaman.\n' +
      '  K-03 dan K-14 sudah memindahkan aksinya ke slot bilah nav lewat ' +
      '`PortalAksi`.\n\n  Yang terukur:\n' +
      catatan.map((b) => `    ${b}`).join('\n')
  );

  for (const b of catatan) t.diagnostic(b);
});

test('⛔ tahap `hitung` tidak menggulir, di kedua skenario', async (t) => {
  /* ⛔ Ia pas 658/658 px pada `normal` dan 597/597 pada `offline` sebelum
     kartu berlangkah ditambahkan — nol piksel sisa. Satu baris lagi dan tahap
     yang menampung field uang mulai menggulir; kasir yang menggulir untuk
     menemukan fieldnya adalah kasir yang mengetik angka di layar yang bergerak.

     ⛔ Sampai 22 September 2026 tahap ini memakai `.kasir-shift`, yang TIDAK
     punya `overflow`. Isi yang tumbuh di sana tidak menggulir melainkan
     MELUAP — tanpa satu pun cara mencapainya. Kelasnya kini `.kasir-grid-panel`
     seperti kedua tahap lain, jadi kegagalannya berbentuk gulir, bukan
     kehilangan. Penjaga ini menahan keduanya. */
  const pelanggar = [];
  const catatan = [];

  for (const [keadaan, kenapa] of SKENARIO) {
    const hal = await peramban.newPage({ viewport: { width: 1280, height: 800 } });
    const galat = [];
    hal.on('pageerror', (e) => galat.push(e.message));
    hal.on('console', (m) => {
      if (m.type() === 'error' && /Failed to load resource/.test(m.text())) return;
      if (m.type() === 'error') galat.push(m.text());
    });
    await hal.goto(`${alamat}/harness-galeri.html?layar=K-12&keadaan=${keadaan}`, {
      waitUntil: 'load',
    });
    await hal.waitForSelector('.kasir-konten', { timeout: 10_000 });
    await hal.waitForTimeout(1200);

    const ukur = await hal.evaluate(() => {
      const konten = document.querySelector('.kasir-konten');
      const layar = konten?.firstElementChild;
      if (!layar) return { err: 'layar tidak dirender' };
      /* Field hitungan dipakai sebagai JANGKAR: ia elemen yang paling mahal
         hilang dari layar, dan tahap yang salah dirender tidak memilikinya. */
      const field = document.querySelector('.kasir-bidang-awalan .field');
      return {
        kelas: layar.className,
        isi: Math.round(layar.scrollHeight),
        ruang: Math.round(layar.clientHeight),
        adaField: field !== null,
        fieldDiDalam: field
          ? Math.round(field.getBoundingClientRect().bottom) <=
            Math.round(konten.getBoundingClientRect().bottom)
          : false,
      };
    });
    await hal.close();
    assert.equal(galat.length, 0, `galat konsol di ${keadaan}: ${galat.join(' | ')}`);
    assert.equal(ukur.err, undefined, `${keadaan}: ${ukur.err}`);

    catatan.push(
      `${keadaan} (${kenapa}): isi ${ukur.isi}px / ruang ${ukur.ruang}px, kelas ` +
        `\`${ukur.kelas}\`, field terlihat: ${ukur.fieldDiDalam}`
    );

    /* SENTINEL: tahap yang gagal dirender punya isi 0 dan tidak menggulir —
       jawaban yang dituntut, karena alasan yang salah. */
    if (!ukur.adaField) {
      pelanggar.push(`  ${keadaan}: field hitungan tidak ada; yang diukur bukan tahap \`hitung\`.`);
      continue;
    }
    if (ukur.isi > ukur.ruang + 1) {
      pelanggar.push(
        `  ${keadaan}: isi ${ukur.isi}px melebihi ruang ${ukur.ruang}px — ` +
          `${ukur.isi - ukur.ruang}px meluap.`
      );
    }
    if (!ukur.fieldDiDalam) {
      pelanggar.push(`  ${keadaan}: field hitungan fisik berada di luar area konten.`);
    }
  }

  assert.deepEqual(
    pelanggar,
    [],
    'tahap `hitung` K-12 tidak lagi muat dalam satu layar:\n' +
      pelanggar.join('\n') +
      '\n\n  Yang terukur:\n' +
      catatan.map((b) => `    ${b}`).join('\n')
  );

  for (const b of catatan) t.diagnostic(b);
});
