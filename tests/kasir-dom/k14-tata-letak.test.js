'use strict';

// K-14 — tata letak: bilah nav, blok aksi, dan siapa yang menggulir.
//
// ## ⛔ Kenapa terpisah dari `k14-keadaan.test.js`
//
// Berkas itu menjaga KEBENARAN — kalimat mana yang layar ini nyatakan. Berkas
// ini menjaga TATA LETAK, dan keduanya gagal dengan cara yang berbeda: yang
// pertama menghasilkan kalimat yang salah, yang kedua menghasilkan kalimat yang
// benar di tempat yang tidak seorang pun lihat.
//
// ## ⛔ Tiga penjaga, dan masing-masing menutup lubang yang berbeda
//
// 1. TINGGI BILAH NAV. Slot aksi milik layar yang aktif, jadi setiap layar
//    mengisinya sendiri. Slot yang isinya terlalu lebar MEMBUNGKUS, dan bilah
//    yang membungkus tumbuh — memakan ruang dari isi layar itu.
//
//    ⛔ `k03-chrome.test.js` TIDAK menutup ini. Ia mengukur K-03, dan tuntutan
//    ">= 12 kartu" hanya ada di K-03. Bilah K-14 yang membungkus karena itu
//    memakan isi K-14 tanpa satu pun penjaga menyala. Diukur di KELIMA layar,
//    karena slotnya milik layar dan setiap layar dapat merusaknya sendiri.
//
// 2. KEDUA KARTU ANGKA TIDAK BERGESER. Bentuk yang sama dengan P8 di K-06,
//    dengan satu perbedaan yang menentukan: di K-06 isi panjangnya dibuat lewat
//    interaksi, di sini lewat FIXTURE. `antrean-panjang` memuat tepat 50 item
//    gagal — `PER_HALAMAN` — yaitu isi maksimum yang K-14 dapat tampilkan
//    sekaligus.
//
//    ⛔ Diukur SESUDAH digulirkan sampai mentok, bukan pada posisi awal. Pada
//    `scrollTop = 0` kartu angka berada di posisi yang sama apa pun panjang
//    tabelnya — keduanya berdiri DI ATAS tabel. Gejalanya baru muncul saat
//    kasir menggulir untuk membaca tabelnya, dan penjaga yang berhenti di
//    posisi awal hijau pada satu-satunya keadaan yang tidak pernah bermasalah.
//
//    ⛔ Tuntutannya menyempit 21 September 2026: semula blok aksi DAN kartu
//    penyimpanan. Itu berlebihan — aksi utamanya kini dilindungi slot bilah
//    nav, dan kartu penyimpanan justru DIPINDAH ke dalam wilayah gulir karena
//    ia diagnostik. Alasan lengkapnya ada di komentar testnya.
//
// 2b. WILAYAH TABEL MEMUAT MINIMAL TIGA BARIS UTUH. Angka yang dikunci, sejajar
//    dengan ">= 12 kartu" di K-03: tanpa angka, daftar ini menyusut diam-diam
//    setiap kali seseorang menambahkan satu blok di atasnya, dan tangkapan
//    layarnya tetap terlihat wajar.
//
// 3. SATU WILAYAH YANG MENGGULIR, DAN IA TABELNYA.
//
//    ⛔ Bentuknya SENGAJA lebih kuat daripada "jangan sampai keduanya
//    menggulir". Versi itu HIJAU terhadap kode sebelum perbaikan — di sana
//    memang hanya ada satu penggulir, yaitu `.kasir-konten`, dan itulah
//    cacatnya. Penjaga yang hanya melarang penggulir bersarang tidak dapat
//    membedakan "sudah benar" dari "belum dikerjakan sama sekali". Yang
//    dituntut karena itu: penggulirnya TEPAT SATU, dan ia tabel item gagal.
//    Bentuk ini menangkap keduanya — yang belum dikerjakan, dan yang dikerjakan
//    tanpa mematikan penggulir luarnya.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const AKAR = path.resolve(__dirname, '..', '..');
const DIST = path.join(AKAR, 'dist-galeri');

/** Kelima layar yang galeri render. Bilah navnya milik bersama. */
const LAYAR = ['K-03', 'K-08', 'K-12', 'K-14', 'K-15'];

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
     Empat berkas di direktori ini memakai `dist-galeri` dan `node --test`
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

/* ⛔ 1280×800 — `PRD:428`, viewport yang sama dengan `k03-chrome.test.js` dan
   `tools/tangkap-galeri.mjs`. Penjaga yang mengukur hal sama pada viewport
   berbeda memberi dua jawaban, dan yang lebih longgar yang akan dipercaya. */
async function buka(layarId, keadaan) {
  const hal = await peramban.newPage({ viewport: { width: 1280, height: 800 } });
  const galat = [];
  hal.on('pageerror', (e) => galat.push(e.message));
  hal.on('console', (m) => {
    // Probe keterjangkauan yang gagal adalah hasil pengukuran, bukan galat —
    // alasan yang sama dengan `k14-keadaan.test.js`.
    if (m.type() === 'error' && /Failed to load resource/.test(m.text())) return;
    if (m.type() === 'error') galat.push(m.text());
  });
  await hal.goto(`${alamat}/harness-galeri.html?layar=${layarId}&keadaan=${keadaan}`, {
    waitUntil: 'load',
  });
  await hal.waitForSelector('.kasir-bilah', { timeout: 10_000 });
  await hal.waitForTimeout(1200);
  return { hal, galat };
}

// ---------------------------------------------------------------------------

test('⛔ tinggi bilah nav SAMA di kelima layar — slot aksi tidak boleh membungkus', async () => {
  const tinggi = {};
  for (const layarId of LAYAR) {
    const { hal, galat } = await buka(layarId, layarId === 'K-14' ? 'offline' : 'normal');
    tinggi[layarId] = await hal.evaluate(() => {
      const b = document.querySelector('.kasir-bilah');
      const slot = document.querySelector('.kasir-slot-aksi');
      return {
        bilah: Math.round(b.getBoundingClientRect().height),
        slotLebar: slot ? Math.round(slot.getBoundingClientRect().width) : 0,
        tombolSlot: slot ? slot.querySelectorAll('button').length : 0,
        label: slot
          ? [...slot.querySelectorAll('button')].map((x) => x.innerText.trim().replace(/\s+/g, ' '))
          : [],
      };
    });
    await hal.close();
    assert.equal(galat.length, 0, `galat konsol di ${layarId}: ${galat.join(' | ')}`);
  }

  const nilai = [...new Set(LAYAR.map((l) => tinggi[l].bilah))];
  assert.equal(
    nilai.length,
    1,
    'tinggi bilah nav berbeda antar layar: ' +
      LAYAR.map((l) => `${l}=${tinggi[l].bilah}px (slot ${tinggi[l].slotLebar}px, ` +
        `${tinggi[l].tombolSlot} tombol)`).join(' · ') +
      '\n  Slot aksi yang isinya terlalu lebar MEMBUNGKUS, dan bilah yang membungkus ' +
      'tumbuh — memakan ruang dari isi layar itu. `k03-chrome.test.js` tidak melihat ' +
      'ini: ia mengukur K-03, dan tuntutan >= 12 kartu hanya ada di sana.'
  );

  /* ⛔ SENTINEL. Kelima tinggi yang sama tidak membuktikan apa pun bila tidak
     satu pun slot berisi tombol — nol lawan nol juga sama. */
  const berisi = LAYAR.filter((l) => tinggi[l].tombolSlot > 0);
  assert.ok(
    berisi.length >= 2,
    `hanya ${berisi.length} layar yang slot aksinya berisi tombol (${berisi.join(', ')}). ` +
      'Penjaga ini membandingkan tinggi bilah yang MEMBAWA beban; tanpa dua layar ' +
      'berisi, ia hijau karena hampa.'
  );

  /* ⛔ Slot milik LAYAR YANG AKTIF, dan isinya disebutkan apa adanya per layar.
     Perbandingan "ada isinya" akan tetap hijau saat aksi K-03 bocor ke K-14 —
     dan tombol yang tertukar di layar kasir berarti laci terbuka saat kasir
     bermaksud mengirim ulang antrean. */
  assert.deepEqual(
    tinggi['K-03'].label,
    ['Diskon', 'Buka laci', 'Kas masuk / keluar'],
    'isi slot aksi K-03 berubah.'
  );
  assert.deepEqual(
    tinggi['K-14'].label,
    ['Coba kirim sekarang', 'Ekspor darurat'],
    'isi slot aksi K-14 tidak sesuai. Dua aksi ini yang ikut ke bilah nav; ' +
      '"Ekspor pemulihan (JSON)" dan "Muat ulang angka" tinggal di badan layar ' +
      'karena keempatnya (~747 px) melampaui 734 px yang tersisa setelah lima tab.'
  );
  for (const layarId of ['K-08', 'K-12', 'K-15']) {
    assert.deepEqual(
      tinggi[layarId].label,
      [],
      `slot aksi ${layarId} tidak kosong — aksi milik layar lain bocor ke sini.`
    );
  }
});

/**
 * Mengukur K-14 SESUDAH digulirkan sampai mentok.
 *
 * ⛔ Yang digulirkan adalah penggulir yang benar-benar aktif, siapa pun ia —
 * `.kasir-konten` sebelum perbaikan, wilayah tabel sesudahnya. Penjaga yang
 * memaku nama elemennya akan berhenti menggulir apa pun pada hari perbaikannya
 * mendarat, lalu hijau karena tidak ada yang bergerak.
 */
async function posisiSesudahGulir(keadaan) {
  const { hal, galat } = await buka('K-14', keadaan);
  const hasil = await hal.evaluate(() => {
    const semua = [document.scrollingElement, ...document.querySelectorAll('.kasir-shell *')];
    const penggulir = semua.filter((e) => {
      if (!e) return false;
      const o = getComputedStyle(e).overflowY;
      return (o === 'auto' || o === 'scroll') && e.scrollHeight > e.clientHeight + 1;
    });
    for (const p of penggulir) p.scrollTop = p.scrollHeight;

    const teks = (e) => (e?.innerText ?? '').replace(/\s+/g, ' ');
    const kartuAngka = [...document.querySelectorAll('.kasir-sync-angka .card')].map((c) => ({
      nama: teks(c).slice(0, 24),
      el: c,
    }));
    /* ⛔ Diukur RELATIF terhadap `.kasir-konten`, bukan terhadap viewport, dan
       itu bukan kerapian: bar galeri di atas panggung memuat kalimat `tanya`
       milik skenario, dan kalimat `antrean-panjang` lebih panjang sehingga ia
       membungkus jadi dua baris. Terukur: `.kasir-konten` turun 18 px. Penjaga
       yang memakai koordinat viewport membaca 18 px itu sebagai blok aksi yang
       bergeser — padahal yang bergeser panggung galerinya, yang tidak ada di
       aplikasi sungguhan. */
    const asal = document.querySelector('.kasir-konten').getBoundingClientRect().top;
    const kotak = (e) => {
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return {
        top: +(r.top - asal).toFixed(1),
        bottom: +(r.bottom - asal).toFixed(1),
        height: +r.height.toFixed(1),
        topLayar: +r.top.toFixed(1),
        bottomLayar: +r.bottom.toFixed(1),
      };
    };
    const daftar = document.querySelector('.kasir-sync-daftar');
    const kepala = document.querySelector('.kasir-sync-daftar thead');
    const rd = daftar?.getBoundingClientRect();
    return {
      kartuAngka: kartuAngka.map((k) => ({ nama: k.nama, ...kotak(k.el) })),
      barisTabel: document.querySelectorAll('.kasir-konten table tbody tr').length,
      tinggiLayar: window.innerHeight,
      jumlahPenggulir: penggulir.length,
      daftarTinggi: rd ? Math.round(rd.height) : 0,
      kepalaTinggi: kepala ? Math.round(kepala.getBoundingClientRect().height) : 0,
      barisTinggi: (() => {
        const tr = document.querySelector('.kasir-sync-daftar tbody tr');
        return tr ? Math.round(tr.getBoundingClientRect().height) : 0;
      })(),
    };
  });
  await hal.close();
  assert.equal(galat.length, 0, `galat konsol di K-14/${keadaan}: ${galat.join(' | ')}`);
  return hasil;
}

/** `IA:62` sejajar: angka yang dikunci, bukan perasaan bahwa "cukup". */
const MINIMAL_BARIS_TERLIHAT = 3;

test('⛔ kedua kartu angka tidak bergeser antara 3 dan 50 baris gagal', async () => {
  /* ⛔ TUNTUTANNYA BERUBAH, dan ini bukan pelemahan supaya lolos.
  
     Versi 21 September menuntut blok aksi DAN kartu penyimpanan tidak
     bergeser. Tuntutan itu berlebihan: tujuan sebenarnya adalah aksi tidak
     tergulir keluar, dan aksi utamanya sekarang hidup di slot bilah nav —
     dilindungi penjaga pertama di berkas ini, bukan oleh posisinya di badan
     layar.
  
     Kartu penyimpanan justru DIPINDAH ke dalam wilayah gulir 21 September
     2026, bersama baris skema lokal, "Muat ulang angka", dan "Ekspor pemulihan
     (JSON)". Keempatnya diagnostik atau untuk petugas dukungan; tidak satu pun
     dibaca kasir saat melayani pelanggan. Memakunya di atas tabel menyisakan
     102 px untuk daftar — dengan kepala tabel 43 px di antaranya, NOL baris
     utuh yang terlihat. Kasir membuka layar ini untuk membaca item yang gagal.
  
     Yang tetap dipaku hanya dua kartu angka: "Menunggu terkirim" dan "Gagal
     terkirim" adalah jawaban langsung atas pertanyaan yang kasir bawa ke sini. */
  const pendek = await posisiSesudahGulir('offline');
  const panjang = await posisiSesudahGulir('antrean-panjang');

  /* ⛔ SENTINEL DI DEPAN, berbeda dari P8 di K-06. Di sana sentinel di belakang
     karena isi ujinya dibangun lewat interaksi yang dapat gagal separuh jalan;
     di sini isinya datang dari FIXTURE, jadi fixture yang salah adalah
     satu-satunya cara test ini dapat hijau karena hampa. */
  assert.equal(pendek.barisTabel, 3, 'fixture `offline` seharusnya 3 baris gagal.');
  assert.equal(
    panjang.barisTabel,
    50,
    'fixture `antrean-panjang` seharusnya 50 baris gagal — satu halaman penuh ' +
      '(`PER_HALAMAN`). Tanpa itu tidak ada yang mendorong apa pun, dan penjaga ' +
      'ini tidak menguji apa pun.'
  );

  assert.equal(
    pendek.kartuAngka.length,
    2,
    `kedua kartu angka tidak ditemukan di \`.kasir-sync-angka\`; ditemukan ` +
      `${pendek.kartuAngka.length}.`
  );

  for (let i = 0; i < pendek.kartuAngka.length; i += 1) {
    const a = pendek.kartuAngka[i];
    const b = panjang.kartuAngka[i];
    assert.equal(
      b.top,
      a.top,
      `kartu angka "${a.nama}" bergeser ${(b.top - a.top).toFixed(1)} px ` +
        `(${a.top} → ${b.top}) setelah tabel digulirkan sampai mentok.\n` +
        '  Tabel 50 baris menggulirkan SELURUH layar, bukan dirinya sendiri, jadi ' +
        'kartu di atasnya ikut terbawa keluar viewport.'
    );

    /* ⛔ Dan ia benar-benar TERLIHAT, bukan sekadar tidak bergeser. Kartu yang
       sama-sama berada di luar layar pada kedua fixture juga tidak bergeser. */
    assert.ok(
      b.topLayar >= 0 && b.bottomLayar <= panjang.tinggiLayar,
      `kartu angka "${a.nama}" berada di luar viewport pada 50 baris: ` +
        `top ${b.topLayar}, bottom ${b.bottomLayar}, layar ${panjang.tinggiLayar}.`
    );
  }
});

test('⛔ wilayah tabel memuat minimal tiga baris utuh pada 1280x800', async () => {
  /* ⛔ ANGKA YANG DIKUNCI, bukan perasaan bahwa ruangnya "cukup".
  
     Tanpa angka, tabel ini dapat menyusut lagi diam-diam: siapa pun yang
     menambahkan satu kartu di atasnya memakan ruang daftar, dan tangkapan
     layarnya tetap terlihat wajar — persis bentuk kegagalan yang membuat
     anggaran chrome K-03 perlu dijaga angka (`IA:62`).
  
     Tiga adalah hasil PENGUKURAN sesudah keempat blok diagnostik pindah ke
     dalam wilayah gulir: daftar 312 px, kepala tabel 43 px, baris 70 px →
     (312 − 43) / 70 = 3,8. Sebelum pemindahan: 102 px, dan kepala tabel
     sendirian sudah 43 px — NOL baris utuh.
  
     ⛔ Kepala tabel dihitung sebagai beban, bukan diabaikan. Ia tidak sticky,
     jadi ia memakan ruang daftar pada posisi awal — dan posisi awal adalah apa
     yang kasir lihat saat membuka layar. */
  const r = await posisiSesudahGulir('antrean-panjang');

  assert.equal(r.barisTabel, 50, 'fixture `antrean-panjang` seharusnya 50 baris gagal.');
  assert.ok(r.barisTinggi > 0, 'tinggi baris tabel terukur nol — tabelnya tidak dirender.');

  const muat = Math.floor((r.daftarTinggi - r.kepalaTinggi) / r.barisTinggi);
  assert.ok(
    muat >= MINIMAL_BARIS_TERLIHAT,
    `hanya ${muat} baris utuh yang muat di wilayah tabel — dituntut minimal ` +
      `${MINIMAL_BARIS_TERLIHAT}.\n` +
      `  daftar ${r.daftarTinggi}px · kepala tabel ${r.kepalaTinggi}px · ` +
      `baris ${r.barisTinggi}px\n` +
      '  Yang paling sering menyebabkannya: satu blok baru dipaku di atas tabel. ' +
      'Kartu angka yang dipaku ada DUA dan itu disengaja; sisanya milik wilayah gulir.'
  );
});

test('⛔ K-14 punya TEPAT SATU wilayah yang menggulir, dan ia tabel item gagal', async () => {
  const { hal, galat } = await buka('K-14', 'antrean-panjang');
  const hasil = await hal.evaluate(() => {
    const kandidat = [document.scrollingElement, ...document.querySelectorAll('.kasir-shell *')];
    const penggulir = kandidat.filter((e) => {
      if (!e) return false;
      const o = getComputedStyle(e).overflowY;
      return (o === 'auto' || o === 'scroll') && e.scrollHeight > e.clientHeight + 1;
    });
    const nama = (e) =>
      e === document.scrollingElement
        ? 'document.scrollingElement'
        : `${e.tagName.toLowerCase()}${e.className ? '.' + String(e.className).trim().replace(/\s+/g, '.') : ''}`;
    const tabel = document.querySelector('.kasir-konten table');
    return {
      daftar: penggulir.map(nama),
      memuatTabel: penggulir.map((e) => !!(tabel && e.contains(tabel) && e !== document.scrollingElement)),
      kontenMenggulir: penggulir.some((e) => e.classList?.contains('kasir-konten')),
      adaTabel: !!tabel,
    };
  });
  await hal.close();
  assert.equal(galat.length, 0, `galat konsol: ${galat.join(' | ')}`);

  assert.ok(hasil.adaTabel, 'tabel item gagal tidak dirender — fixture salah.');

  assert.equal(
    hasil.daftar.length,
    1,
    `K-14 punya ${hasil.daftar.length} wilayah yang menggulir: ${hasil.daftar.join(', ')}.\n` +
      '  Nol berarti isinya tidak melampaui ruangnya dan penjaga ini hampa. Dua atau ' +
      'lebih berarti penggulir bersarang: yang luar tetap menggulirkan blok aksi keluar ' +
      'viewport, jadi gejalanya persis sama dengan yang belum diperbaiki.'
  );

  assert.ok(
    !hasil.kontenMenggulir,
    `yang menggulir di K-14 adalah \`.kasir-konten\` (${hasil.daftar.join(', ')}), bukan ` +
      'wilayah tabelnya.\n  `.kasir-konten` melayani enam layar dan menggulirkan SELURUH ' +
      'isi K-14, termasuk blok aksi dan kartu penyimpanan yang berdiri di atas tabel. ' +
      'K-14 harus mengisi tinggi induknya alih-alih tumbuh mengikuti isinya.'
  );

  assert.ok(
    hasil.memuatTabel[0],
    `wilayah yang menggulir (${hasil.daftar[0]}) tidak memuat tabel item gagal. ` +
      'Yang harus menggulir adalah daftarnya, bukan bagian lain dari layar.'
  );
});
