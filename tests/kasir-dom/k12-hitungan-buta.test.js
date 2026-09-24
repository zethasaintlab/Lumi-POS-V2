'use strict';

// K-12 tahap `hitung` — TIDAK membocorkan satu pun angka saldo (FR-D2).
//
// ## ⛔ Kontrol yang dijaga
//
// `spec-d` FR-D2: *"Kasir memasukkan hitungan fisik sebelum sistem menampilkan
// angka terhitung. Ini kontrol, bukan preferensi UX — kasir yang melihat angka
// target akan menghitung mundur ke angka itu."*
//
// Aturan itu pernah dicabut 1 September 2026 dan dikembalikan 22 September
// 2026. Pencabutannya tidak pernah sampai ke kode, dan yang menahannya selama
// tiga minggu adalah satu assertion unit:
//
//     assert.equal(tunai.total, null, 'total tunai tidak boleh terbaca …')
//
// ⛔ Assertion itu menjaga DATA yang `ringkasanSebelumHitung` kembalikan. Ia
// tidak dapat melihat layar: kebocoran yang lahir di JSX — satu baris rincian
// yang dipindah ke tahap salah, satu `saldoSeharusnya` yang ikut dirender —
// lolos tanpa satu pun test merah. Penjaga ini menutup separuh itu.
//
// ## ⛔ Kenapa angka terlarangnya TIDAK diketik di sini
//
// Daftar angka yang ditulis tangan menyimpang dari fixture pada hari fixture
// berubah, dan yang menyimpang berhenti menjaga apa pun sambil tetap hijau.
//
// Yang dipakai: layar yang SAMA ditempuh sampai tahap `review`, dan setiap
// angka rupiah yang tahap itu tampilkan dipanen dari DOM. Angka-angka itulah
// yang tahap `hitung` tidak boleh memuat. Dua pembacaan, nol konstanta, dan ia
// mengikuti fixture sendiri.
//
// ## ⛔ Yang SENGAJA tidak dilarang, dan kenapa
//
// Total metode NON-TUNAI boleh tampil di tahap `hitung`, dan itu keputusan
// yang sudah tertulis di `RingkasanAwal.perMetode`: QRIS dan kartu tidak masuk
// laci, jadi menampilkannya tidak membantu menebak isinya — sementara kasir
// membutuhkannya untuk rekonsiliasinya sendiri. Penjaga ini karena itu
// melarang angka yang tahap `review` tunjukkan, bukan "setiap teks berbentuk
// rupiah"; ada test kedua yang membuktikan pelonggaran itu memang berlaku,
// supaya ia tidak diam-diam menjadi lubang.
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

/** Hitungan yang dipakai menempuh tahap review. Angka bulat yang jelas BUKAN saldo. */
const HITUNGAN_UJI = '300000';

async function buka(keadaan) {
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
  return { hal, galat };
}

/** Setiap angka rupiah di dalam sebuah teks, sebagai string apa adanya. */
function angkaRupiah(teks) {
  return [...teks.matchAll(/Rp\s*([\d.]+)/g)].map((m) => m[1]);
}

// ---------------------------------------------------------------------------

test('⛔ tahap `hitung` tidak memuat satu pun angka yang tahap `review` tunjukkan', async (t) => {
  const { hal, galat } = await buka('normal');

  const teksHitung = await hal.evaluate(() => document.querySelector('.kasir-konten').innerText);

  await hal.getByLabel(/hitungan fisik/i).fill(HITUNGAN_UJI);
  await hal.getByRole('button', { name: 'Lanjut' }).click();
  await hal.waitForTimeout(1000);

  /* ⛔ Yang dipanen HANYA baris rincian dan panel selisih. Baris "Hitungan
     fisik" dikecualikan: isinya angka yang kasir ketik SENDIRI, dan melarang
     angka itu muncul di tahap `hitung` akan melarang fieldnya menampilkan
     ketikan kasir. */
  const terlarang = await hal.evaluate(() => {
    const baris = [...document.querySelectorAll('.kasir-subtotal')]
      .map((e) => e.innerText.replace(/\s+/g, ' ').trim())
      .filter((b) => !/^Hitungan fisik/i.test(b));
    const panel = document.querySelector('.kasir-selisih');
    return { baris, panel: panel ? panel.innerText.replace(/\s+/g, ' ').trim() : '' };
  });
  await hal.close();
  assert.equal(galat.length, 0, `galat konsol: ${galat.join(' | ')}`);

  const angka = [
    ...new Set([...terlarang.baris, terlarang.panel].flatMap((b) => angkaRupiah(b))),
  ];

  /* ⛔ SENTINEL DI DEPAN, dan ia memeriksa NAMA barisnya, bukan hitungan
     angkanya. Nol angka terlarang menghasilkan nol pelanggar, dan nol
     pelanggar adalah jawaban yang dituntut — tahap review yang gagal dirender
     akan membuat penjaga ini hijau tanpa memeriksa apa pun.

     ⛔ Ambang berupa jumlah angka sempat dipakai dan ia SALAH bentuknya:
     fixture galeri hanya punya movement bertipe `sale`, dan nilainya kebetulan
     sama dengan selisihnya, jadi keempat baris menghasilkan TIGA angka unik.
     Ambang "minimal empat" karena itu merah atas layar yang benar. Nama baris
     tidak punya masalah itu: keduanya ada atau tahap reviewnya rusak. */
  const punya = (pola) => terlarang.baris.some((b) => pola.test(b));
  assert.ok(
    punya(/^Modal awal/i) && punya(/^Kas diharapkan/i),
    'baris "Modal awal" atau "Kas diharapkan" tidak ada di tahap review, jadi ' +
      'penjaga ini tidak memeriksa apa pun.\n  Baris yang terbaca: ' +
      terlarang.baris.join(' · ')
  );
  assert.ok(
    angka.length >= 3,
    `hanya ${angka.length} angka yang terpanen dari tahap review (${angka.join(', ')}).`
  );

  const bocor = angka.filter((a) => teksHitung.includes(a));
  assert.deepEqual(
    bocor,
    [],
    'tahap `hitung` memuat angka yang hanya boleh terlihat SESUDAH kasir ' +
      `menghitung: ${bocor.join(', ')}\n\n` +
      '  ⛔ `spec-d` FR-D2: "Ini kontrol, bukan preferensi UX — kasir yang ' +
      'melihat angka target akan menghitung mundur ke angka itu."\n' +
      '  Kalau perubahan yang membuat baris ini merah memang diinginkan, ia ' +
      'pencabutan FR-D2 — dan pencabutan itu sudah pernah dicoba lalu ' +
      'dibatalkan 22 September 2026. Lihat `spec-d` FR-D2.\n\n' +
      `  Angka tahap review: ${angka.join(', ')}\n` +
      '  Teks tahap hitung:\n' +
      teksHitung.split('\n').filter(Boolean).map((b) => `    ${b}`).join('\n')
  );

  t.diagnostic(`${angka.length} angka review diperiksa terhadap tahap hitung: ${angka.join(', ')}`);
});

test('⛔ total metode NON-TUNAI tetap boleh tampil — pelonggaran yang dinyatakan', async () => {
  const { hal, galat } = await buka('normal');
  const teks = await hal.evaluate(() => document.querySelector('.kasir-konten').innerText);
  await hal.close();
  assert.equal(galat.length, 0, `galat konsol: ${galat.join(' | ')}`);

  /* ⛔ Penjaga di atas melarang angka yang tahap review tunjukkan — bukan
     setiap teks berbentuk rupiah. Test ini membuktikan pembedaan itu memang
     berlaku, bukan kebetulan: kalau seseorang kelak memperketat penjaga
     pertama menjadi "nol rupiah di tahap hitung", baris ini merah dan ia akan
     membaca alasannya sebelum menghapusnya.

     `RingkasanAwal.perMetode`: QRIS dan kartu tidak masuk laci, jadi
     menampilkannya tidak membantu menebak isinya — dan kasir membutuhkannya
     untuk rekonsiliasinya sendiri. Yang DITAHAN hanya total tunai. */
  assert.match(
    teks,
    /QRIS \(statis\) Rp\s*[\d.]+/,
    'total metode non-tunai hilang dari tahap `hitung`. Ia sengaja ditampilkan; ' +
      'lihat `RingkasanAwal.perMetode`.'
  );
  assert.doesNotMatch(
    teks,
    /Tunai Rp\s*[\d.]+/,
    'total TUNAI tampil di tahap `hitung`. Kasir tahu saldo awal — ia yang ' +
      'memasukkannya saat buka shift — jadi satu penjumlahan memberi angka target.'
  );
});
