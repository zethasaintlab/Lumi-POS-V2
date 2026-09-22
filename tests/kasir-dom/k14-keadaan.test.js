'use strict';

// K-14 — keadaan yang layar ini nyatakan, diuji terhadap DOM sungguhan.
//
// ## ⛔ Kenapa penjaga ini DOM, dan kenapa ia lahir belakangan
//
// Sampai 21 September 2026 K-14 tidak dapat dirender di mana pun: galeri tidak
// memuatnya, `harness-h2` merender shell tanpa layar, dan `/sync` di aplikasi
// dev digerbangi login. Ketiga cacat yang penjaga ini kunci karena itu
// ditemukan dengan MEMBACA kode, dan tidak satu pun dari 33 test
// `tests/sync-client/status.test.js` dapat melihatnya — semuanya menguji
// `status.ts`, sementara ketiganya hidup di `StatusSinkronisasi.tsx`.
//
// ## ⛔ Apa yang ketiganya punya bersama
//
// Tidak satu pun menghasilkan error. Ketiganya menghasilkan KALIMAT YANG
// SALAH di layar yang merupakan satu-satunya tempat kasir memeriksa apakah
// penjualannya sudah sampai ke server. Kelas yang sama dengan yang
// `packages/sync-client/src/status.ts` catat panjang lebar pada baris 81 —
// dan komentar itu menyebut K-14 dengan namanya sebagai "pemanggil lama".
//
// ## ⛔ Penjaga membandingkan DUA SUMBER yang tidak ada apa pun menyatukannya
//
// Teks badge K-14 dibaca dari `.kasir-konten`, teks indikator topbar dari
// `.kasir-indikator`. Keduanya dirender komponen berbeda, dari pemanggilan
// `keadaanIndikator` yang berbeda, di berkas yang berbeda. Tidak ada satu pun
// konstanta bersama yang membuat keduanya sepakat secara otomatis — dan itulah
// yang membuat perbandingannya berarti.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const AKAR = path.resolve(__dirname, '..', '..');
const DIST = path.join(AKAR, 'dist-galeri');

/* Jalur Chromium — bentuk yang sama dengan `k03-chrome.test.js`. Jalur yang
   dipaku hijau di satu container dan gagal di semua yang lain, dengan pesan
   yang tidak menyebut penjaga mana pun. */
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
  /* ⛔ MENEGASKAN, bukan membangun — pola yang sama dengan `k06-penjaga.test.js`.
     Tiga berkas di direktori ini memakai `dist-galeri` dan `node --test`
     menjalankannya PARALEL; berkas yang membangun sendiri saling menghapus
     `outDir` (`emptyOutDir: true`), dan yang muncul adalah halaman kosong tanpa
     satu pun error. Alasan lengkapnya di kepala `k03-chrome.test.js`. */
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
 * Membuka satu sel K-14 dan membaca keadaan yang layarnya nyatakan.
 *
 * ⛔ 1280×800 — `PRD:428` mengunci layar kasir ke sana, viewport yang sama
 * dengan `k03-chrome.test.js` dan `tools/tangkap-galeri.mjs`. Tiga penjaga yang
 * mengukur pada viewport berbeda akan memberi tiga jawaban.
 */
async function bukaK14(keadaan) {
  const hal = await peramban.newPage({ viewport: { width: 1280, height: 800 } });
  const galat = [];
  hal.on('pageerror', (e) => galat.push(e.message));
  hal.on('console', (m) => {
    /* ⛔ Kegagalan probe keterjangkauan BUKAN galat — ia hasil pengukurannya.
       K-14 menembak `<baseUrl>/health`, dan `baseUrl` galeri sengaja menunjuk
       port yang menolak koneksi (lihat `db-palsu.ts`). Peramban mencatat
       kegagalan fetch di konsol apa pun sebabnya, jadi penjaga yang menolak
       SETIAP galat konsol akan menolak satu-satunya fixture yang dapat
       menampilkan keadaan "server tidak terjangkau".

       Saringannya SEMPIT: hanya kegagalan MEMUAT SUMBER. `TypeError`,
       lemparan React, dan `console.error` dari kode kita tetap menggagalkan
       test seperti sebelumnya. */
    if (m.type() === 'error' && /Failed to load resource/.test(m.text())) return;
    if (m.type() === 'error') galat.push(m.text());
  });
  await hal.goto(`${alamat}/harness-galeri.html?layar=K-14&keadaan=${keadaan}`, {
    waitUntil: 'load',
  });
  await hal.waitForSelector('.kasir-konten .badge', { timeout: 10_000 });

  /* ⛔ Jeda, dan ia BUKAN kemalasan. Identitas perangkat dan keterjangkauan
     keduanya dibaca asinkron — `bacaKonfigPerangkat` lalu probe. Penjaga yang
     membaca DOM sebelum keduanya mendarat memeriksa keadaan sementara, dan
     keadaan sementara adalah tepat yang tidak ingin dikunci di sini. */
  await hal.waitForTimeout(1200);

  const hasil = await hal.evaluate(() => {
    const bersih = (e) => (e ? e.innerText.trim().replace(/\s+/g, ' ') : null);
    const konten = document.querySelector('.kasir-konten');
    const utama = [...(konten?.querySelectorAll('button') ?? [])].find(
      (b) => b.innerText.trim().startsWith('Coba kirim')
    );
    return {
      topbar: bersih(document.querySelector('.kasir-indikator')),
      badge: bersih(konten?.querySelector('.badge')),
      /* `{outlet} · {device}` milik shell — SATU-SATUNYA sumber di DOM yang
         menyatakan apakah shell menganggap perangkat ini terdaftar. Ia dibaca
         terpisah dari badge supaya prasyarat tiap fixture dapat dinyatakan. */
      merek: bersih(document.querySelector('.kasir-wordmark-sub')),
      teks: (konten?.innerText ?? '').replace(/\s+/g, ' '),
      kartuGagal: Number(
        /Gagal terkirim (\d+)/.exec((konten?.innerText ?? '').replace(/\s+/g, ' '))?.[1] ?? -1
      ),
      kartuMenunggu: Number(
        /Menunggu terkirim (\d+)/.exec((konten?.innerText ?? '').replace(/\s+/g, ' '))?.[1] ?? -1
      ),
      barisTabel: konten?.querySelectorAll('table tbody tr').length ?? -1,
      utamaAktif: utama ? !utama.disabled : null,
    };
  });
  await hal.close();
  assert.equal(galat.length, 0, `galat konsol saat memuat K-14/${keadaan}: ${galat.join(' | ')}`);
  return hasil;
}

/**
 * Membaca indikator topbar pada layar APA PUN.
 *
 * ⛔ Terpisah dari `bukaK14`, dan pemisahannya yang jadi intinya: topbar
 * dirender `ShellKasir`, yang membungkus SETIAP layar kasir. Kebutaannya
 * karena itu terlihat di setiap layar setiap saat, sementara kesalahan K-14
 * hanya terlihat saat layar itu dibuka. Penjaga yang hanya mengukurnya lewat
 * K-14 akan terbaca seolah cacatnya milik K-14.
 */
async function bukaTopbar(layarId, keadaan) {
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
  await hal.waitForSelector('.kasir-indikator', { timeout: 10_000 });
  await hal.waitForTimeout(1200);
  const teks = await hal.evaluate(() => {
    const e = document.querySelector('.kasir-indikator');
    return e ? e.innerText.trim().replace(/\s+/g, ' ') : null;
  });
  await hal.close();
  assert.equal(galat.length, 0, `galat konsol saat memuat ${layarId}/${keadaan}: ${galat.join(' | ')}`);
  return teks;
}

// ---------------------------------------------------------------------------

test('⛔ jangkar: K-14 benar-benar dirender, dan angkanya cocok dengan tabelnya', async () => {
  /* Penjaga yang memeriksa nol berkas hijau selamanya. Test ini membuktikan
     ketiga penjaga di bawah benar-benar menatap layar yang berisi sesuatu —
     dan sekaligus mengunci perbaikan fixture 21 September 2026: kartu "Gagal
     terkirim" dan jumlah baris tabel dulu berbeda (3 lawan 15) karena fake
     mengabaikan `WHERE status = 'failed'`. */
  const offline = await bukaK14('offline');
  assert.equal(offline.kartuMenunggu, 12, 'fixture `offline` seharusnya 12 menunggu.');
  assert.equal(offline.kartuGagal, 3, 'fixture `offline` seharusnya 3 gagal.');
  assert.equal(
    offline.barisTabel,
    offline.kartuGagal,
    `kartu berkata ${offline.kartuGagal} gagal, tabel menampilkan ${offline.barisTabel} baris. ` +
      'Dua angka untuk satu pertanyaan, di layar yang seluruh tugasnya memisahkan ' +
      'yang mengantre dari yang gagal.'
  );

  /* Kolom "Alasan" harus membawa alasannya, bukan kalimat fallback untuk
     setiap baris. */
  assert.match(
    offline.teks,
    /IDEMPOTENCY_MISMATCH|DEVICE_REVOKED|Failed to fetch/,
    'tabel item gagal tidak memuat satu pun alasan teknis — `last_error` kosong di fixture.'
  );
});

test('⛔ (a) perangkat TERDAFTAR yang servernya tak terjangkau tidak boleh disuruh mendaftar', async () => {
  const r = await bukaK14('offline');

  /* Prasyarat fixture, dinyatakan: shell menganggap perangkat ini terdaftar.
     Tanpa baris ini, assertion di bawah dapat hijau karena fixture-nya berubah
     menjadi perangkat yang memang belum terdaftar. */
  assert.ok(
    !/Perangkat belum terdaftar/.test(r.merek ?? ''),
    'fixture `offline` seharusnya perangkat TERDAFTAR; topbar berkata sebaliknya.'
  );

  assert.ok(
    !/belum dihubungkan ke server/.test(r.teks),
    'K-14 menyuruh kasir menghubungkan perangkat yang SUDAH terdaftar. ' +
      '`terhubung` di layar ini adalah `sinkronisasiSekarang() !== null` — penjadwal ' +
      'relay hidup atau tidak — bukan keterjangkauan server. Perangkat terdaftar ' +
      'dengan uplink mati karena itu dikirim ke menu Perangkat, tempat tidak ada ' +
      'apa pun yang dapat ia perbaiki.'
  );

  assert.match(
    r.teks,
    /dijangkau/,
    'K-14 tidak menyebut keterjangkauan sama sekali. `apps/kasir/src/lokal/' +
      'keterjangkauan.ts` sudah ada dan menjawab pertanyaan itu; layar ini ' +
      'tidak memakainya.'
  );

  /* ⛔ Anchor, dan ia HIJAU terhadap kode sekarang — disebutkan supaya tidak
     dibaca sebagai bukti. Ia hijau karena tombolnya mati, bukan karena layarnya
     benar. Yang ia jaga adalah arah baliknya: perbaikan yang menyalakan tombol
     tanpa keterjangkauan akan membuat kalimat sukses muncul untuk pengiriman
     yang tidak pernah sampai. */
  assert.ok(
    !/Pengiriman dijalankan/.test(r.teks),
    'K-14 menyatakan pengiriman berhasil dijalankan pada perangkat yang servernya ' +
      'tidak terjangkau — kalimat yang sama persis dengan pengiriman yang benar-benar sampai.'
  );
});

test('⛔ (b) badge K-14 dan indikator topbar tidak boleh saling membantah', async () => {
  /* ⛔ DUA fixture, dan yang kedua ditambahkan 21 September 2026.

     Semula `kosong` saja, dengan alasan yang ditulis di sini: kesetaraan hanya
     sah di tempat kedua sisi punya informasi yang sama, dan pada `error` K-14
     tahu lebih banyak daripada shell — ia melihat `daftarGagal` menolak,
     sementara `useAntrean` menelan kegagalannya. Menuntut kesetaraan di sana
     akan memaksa K-14 MELUPAKAN yang ia ketahui.

     Alasan itu gugur begitu shell berhenti buta: kini `useAntrean` meneruskan
     kegagalan bacanya, jadi kedua sisi tahu hal yang sama dan tidak ada yang
     perlu dilupakan. Kesetaraan dituntut di keduanya.

     ⛔ Kedua kalimat datang dari DUA pembacaan yang berbeda — `ringkasanAntrean`
     di shell, `daftarGagal` di K-14 — di dua berkas yang tidak berbagi satu
     konstanta pun. Yang membuat keduanya sepakat adalah keadaan sebenarnya,
     bukan satu sumber yang kebetulan dibaca dua kali. */
  for (const keadaan of ['kosong', 'error']) {
    const r = await bukaK14(keadaan);

    if (keadaan === 'kosong') {
      assert.ok(
        /Perangkat belum terdaftar/.test(r.merek ?? ''),
        'fixture `kosong` seharusnya perangkat BELUM terdaftar; topbar berkata sebaliknya.'
      );
    }

    assert.equal(
      r.badge,
      r.topbar,
      `pada skenario \`${keadaan}\`: badge K-14 berbunyi "${r.badge}" sementara ` +
        `indikator topbar berbunyi "${r.topbar}", untuk perangkat dan antrean yang sama persis.\n` +
        '  Dua sebab yang pernah menghasilkan ini: shell memanggil ' +
        '`keadaanIndikator(ringkasan, { perangkatTerdaftar })` sementara K-14 tidak, ' +
        'dan `useAntrean` menelan kegagalan bacanya lalu menyerahkan 0/0.\n' +
        '  `packages/sync-client/src/status.ts:81` menulis kelas cacat ini panjang lebar.'
    );
  }
});

test('⛔ (d) topbar tidak boleh berbunyi "Tersinkron" saat antreannya tidak dapat dibaca', async () => {
  /* ⛔ Lebih serius daripada keempat cacat K-14, dan sebabnya bukan kode
     melainkan JANGKAUAN: topbar dirender `ShellKasir` di setiap layar, jadi
     ia terlihat sepanjang shift. K-14 hanya terlihat saat dibuka, dan kasir
     membukanya justru ketika ia sudah curiga.

     `useAntrean` menelan kegagalan `ringkasanAntrean` — komentarnya sendiri
     berbunyi *"yang TIDAK boleh adalah angka yang dikarang jadi nol -- itu
     berbunyi 'semua sudah terkirim'"* — lalu meninggalkan state awalnya,
     `RINGKASAN_KOSONG`, yang PERSIS angka nol itu. Niatnya benar dan nilai
     awalnya membatalkannya.

     Diukur di DUA layar, bukan satu: cacatnya milik shell, dan penjaga yang
     hanya membuka K-14 akan terbaca seolah ia milik K-14. */
  for (const layarId of ['K-03', 'K-14']) {
    const teks = await bukaTopbar(layarId, 'error');
    assert.ok(
      !/Tersinkron/.test(teks ?? ''),
      `topbar pada ${layarId}/error berbunyi "${teks}" padahal pembacaan antrean MENOLAK. ` +
        'Nol yang dikarang tidak dapat dibedakan dari nol yang sehat, dan yang ini ' +
        'terlihat di setiap layar sepanjang shift.'
    );
  }
});

test('⛔ (c) keadaan `offline-only` punya labelnya sendiri, bukan "Tersinkron" maupun "Mengantre"', async () => {
  const r = await bukaK14('kosong');

  /* Ternary badge K-14 hanya bercabang `ok` / `failed` / sisanya, dan sisanya
     jatuh ke "Mengantre". Jadi `offline-only` tidak punya label sama sekali:
     sebelum (b) diperbaiki ia terbaca "Tersinkron", sesudahnya ia akan jatuh
     ke "Mengantre" kalau cabangnya tidak ditambahkan. Keduanya salah, dan
     keduanya tanpa satu pun error.

     ⛔ Kemandirian penjaga ini dari (b) dibuktikan lewat SABOTASE: mengembalikan
     cabang ternary saja, dengan (b) tetap diperbaiki, harus membuat test ini
     merah sendirian. */
  assert.ok(
    r.badge !== 'Tersinkron' && r.badge !== 'Mengantre',
    `badge K-14 berbunyi "${r.badge}" untuk perangkat yang belum terdaftar. ` +
      '"Tersinkron" adalah klaim yang tidak diketahui siapa pun benar; "Mengantre" ' +
      'menyatakan ada yang menunggu dikirim, dan tidak ada apa pun di antrean.'
  );
});

test('⛔ ARAH TERPENTING: "Tersinkron" tidak pernah muncul saat antrean tidak diketahui sehat', async () => {
  /* Terpisah dari ketiga penjaga di atas, dan sengaja: ia menjaga ARAH, bukan
     satu cacat. Perbaikan yang salah pada (b) atau (c) menghasilkan persis
     keadaan ini, dan ia satu-satunya yang benar-benar mahal — kasir yang
     membaca "Tersinkron" menutup shift dengan penjualan yang belum ada di
     server. Tiga sebab, satu aturan.

     ⛔ Skenario `error` ada di sini karena ia menemukan cacat KEEMPAT saat
     K-14 pertama kali dirender: pembacaan antrean MENOLAK, `ringkasan` jatuh
     ke nol, dan badge berkata "Tersinkron" tepat di atas `EmptyState` yang
     berbunyi "Ini BUKAN berarti semuanya terkirim". Satu layar, dua kalimat
     yang saling membantah. */
  for (const keadaan of ['kosong', 'offline', 'error']) {
    const r = await bukaK14(keadaan);

    const belumTerdaftar = /Perangkat belum terdaftar/.test(r.merek ?? '');
    const antreanTerisi = r.kartuMenunggu > 0 || r.kartuGagal > 0;
    const tidakTerbaca = /tidak dapat dibaca/.test(r.teks);

    if (!belumTerdaftar && !antreanTerisi && !tidakTerbaca) continue;

    assert.ok(
      !/Tersinkron/.test(r.teks),
      `K-14/${keadaan} menampilkan "Tersinkron" padahal antreannya tidak diketahui sehat ` +
        `(belum terdaftar: ${belumTerdaftar} · antrean terisi: ${antreanTerisi} · ` +
        `daftar tidak terbaca: ${tidakTerbaca}).\n` +
        '  Nol yang benar dan nol yang tidak diketahui terlihat sama persis, dan hanya ' +
        'yang kedua menuntut tindakan.'
    );
  }
});
