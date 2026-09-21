'use strict';

// ⛔ PENJAGA: setiap `Bidang` yang dirender wajib punya label yang TERHUBUNG
// ke inputnya.
//
// ## Kenapa berkas ini ada
//
// `apps/kasir/src/Bidang.tsx` merender `<label className="label">` TANPA
// `htmlFor` sampai 16 September 2026, dengan `<input>` sebagai SAUDARA. Tidak
// ada satu pun yang menghubungkan keduanya, jadi pembaca layar mengumumkan
// inputnya tanpa nama — kasir mendengar "edit teks", bukan "Referensi
// pembayaran". Empat belas pemakaian di enam layar terpapar, termasuk K-06.
//
// ## ⛔ Kenapa ia tidak tertangkap apa pun selama ini
//
// Tidak ada yang merah. Layarnya terlihat benar, `test:kasir` hijau, dan lint
// tidak membaca hubungan antar-elemen. Yang menemukannya adalah penjaga DOM
// K-06 yang mencoba `getByLabel` lalu gagal — dan penjaga itu MENGAKOMODASI
// cacatnya dengan mencari lewat elemen induk, alih-alih melaporkannya. Jalan
// memutar yang bekerja adalah bentuk paling halus dari "nol baris, bukan
// error": ia membuat cacatnya tidak terasa sampai seseorang memakai pembaca
// layar.
//
// ## ⛔ Yang dijaga BENTUK yang dapat diperiksa, bukan piksel
//
// Aturannya satu kalimat: setiap label yang dirender `Bidang` dapat ditemukan
// lewat `getByLabel`, dan yang ditemukannya adalah input miliknya sendiri.
// Tidak ada ukuran, warna, atau tata letak yang dikunci di sini.
//
// ## ⛔ Layar SUNGGUHAN, bukan halaman sintetis
//
// Penjaga ini memakai harness K-06 yang sudah ada — `Pembayaran.tsx` yang
// SAMA PERSIS dengan yang dipakai aplikasi. Halaman uji yang merender
// `<Bidang>` sendirian akan membuktikan komponennya benar dan tidak
// membuktikan apa pun tentang layar yang memakainya; yang dicari di sini
// justru beberapa Bidang hidup berdampingan, karena di sanalah id yang
// bertabrakan akan terlihat.
//
// ## Prasyarat
//
//   npm run build:harness-k06

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const AKAR = path.resolve(__dirname, '..', '..');
const DIST = path.join(AKAR, 'dist-harness-k06');

/** Sama persis dengan `k06-penjaga.test.js`; jalurnya tidak pernah dipaku. */
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
  return undefined; // Playwright memakai unduhannya sendiri.
}

const JENIS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
};

let server;
let alamat;
let peramban;

before(async () => {
  assert.ok(
    fs.existsSync(path.join(DIST, 'harness-k06.html')),
    'dist-harness-k06/ belum dibangun. Jalankan `npm run build:harness-k06` lebih dulu.'
  );

  server = http.createServer((req, res) => {
    const nama = decodeURIComponent((req.url ?? '/').split('?')[0]);
    const berkas = path.join(DIST, nama === '/' ? 'harness-k06.html' : nama);
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

async function buka(kueri) {
  const hal = await peramban.newPage({ viewport: { width: 1024, height: 1000 } });
  await hal.route('**/health', (r) => r.fulfill({ status: 200, body: 'ok' }));
  await hal.goto(`${alamat}/harness-k06.html?${kueri}`, { waitUntil: 'networkidle' });
  await hal.waitForSelector('#k06 > *', { timeout: 10_000 });
  return hal;
}

/**
 * Setiap `.stack` yang benar-benar berisi pasangan label + input — yaitu
 * setiap `Bidang` yang dirender. `.stack` dipakai juga untuk hal lain, jadi
 * yang tanpa pasangan itu dibuang alih-alih dianggap gagal.
 */
const bidangTerender = (hal) =>
  hal.$$eval('.stack', (stack) =>
    stack
      .map((s) => {
        const label = s.querySelector('label.label');
        const input = s.querySelector('input.field');
        if (!label || !input) return null;
        return {
          teks: label.textContent.trim(),
          // `htmlFor` mengembalikan '' bila atributnya tidak ada sama sekali.
          htmlFor: label.getAttribute('for') ?? '',
          idInput: input.getAttribute('id') ?? '',
        };
      })
      .filter(Boolean)
  );

/** Nama yang `getByLabel` cari — teks label sampai sebelum kurung penjelas. */
const namaPendek = (teks) => teks.split('(')[0].trim();

// ---------------------------------------------------------------------------

test('⛔ setiap Bidang yang dirender terhubung ke inputnya dan dapat ditemukan getByLabel', async () => {
  /* K-06 dengan metode QRIS statis dipilih: ia merender DUA Bidang sekaligus
     ("Nominal bagian ini" dan "Referensi pembayaran"). Dua sekaligus yang
     penting — satu Bidang membuktikan hubungannya ada, dua membuktikan id-nya
     tidak bertabrakan, dan tabrakan id adalah kegagalan yang paling sunyi:
     label kedua menunjuk input PERTAMA, dan layarnya terlihat baik-baik
     saja. */
  const hal = await buka('render=k06&baris=2');
  try {
    await hal.getByRole('button', { name: 'QRIS statis' }).click();

    const bidang = await bidangTerender(hal);

    /* ⛔ SENTINEL. Penjaga yang memindai nol elemen hijau selamanya, dan
       hijaunya adalah bentuk kekosongan yang `KELAS-GAGAL.md` catat. Dua,
       bukan satu: seluruh gunanya adalah memeriksa lebih dari satu. */
    assert.ok(
      bidang.length >= 2,
      `hanya ${bidang.length} Bidang dirender; penjaga ini tidak memeriksa apa pun. ` +
        'Harness atau layarnya berubah — perbaiki sebelum mempercayai hijau berikutnya.'
    );

    for (const b of bidang) {
      assert.notEqual(
        b.htmlFor,
        '',
        `label "${b.teks}" tanpa atribut \`for\` — pembaca layar mengumumkan inputnya tanpa nama`
      );
      assert.notEqual(
        b.idInput,
        '',
        `input milik label "${b.teks}" tanpa \`id\` — tidak ada yang dapat ditunjuk \`for\``
      );
      assert.equal(
        b.htmlFor,
        b.idInput,
        `label "${b.teks}" menunjuk "${b.htmlFor}" sementara inputnya ber-id "${b.idInput}"`
      );
    }

    /* ⛔ Id UNIK. Dua Bidang ber-id sama tetap lolos ketiga assertion di atas
       — masing-masing cocok dengan dirinya sendiri — dan `getByLabel` untuk
       yang kedua akan mengembalikan input PERTAMA. */
    const id = bidang.map((b) => b.idInput);
    assert.equal(
      new Set(id).size,
      id.length,
      `id Bidang bertabrakan di satu layar: ${JSON.stringify(id)}`
    );

    /* ⛔ Dan yang terakhir diperiksa lewat `getByLabel` SUNGGUHAN, bukan lewat
       atributnya. Playwright menurunkan nama yang dapat diakses dengan aturan
       yang sama dengan pembaca layar; atribut yang cocok tetapi tidak
       menghasilkan nama akan lolos pemeriksaan di atas dan gagal di sini. */
    for (const b of bidang) {
      const nama = namaPendek(b.teks);
      const cocok = hal.getByLabel(nama);
      assert.equal(
        await cocok.count(),
        1,
        `getByLabel(${JSON.stringify(nama)}) menemukan ${await cocok.count()} elemen, bukan tepat satu`
      );
      assert.equal(
        await cocok.getAttribute('id'),
        b.idInput,
        `getByLabel(${JSON.stringify(nama)}) menemukan input yang SALAH`
      );
    }
  } finally {
    await hal.close();
  }
});

test('⛔ Bidang yang muncul belakangan ikut terhubung, bukan hanya yang ada saat muat', async () => {
  /* Metode pembayaran mengganti bidang yang dirender. Bidang yang lahir dari
     interaksi adalah tempat hubungan label hilang lebih dulu: ia tidak ada
     saat halaman dimuat, jadi pemeriksaan sekali-di-awal tidak melihatnya.

     Kartu EDC dipilih di sini karena bidangnya BERBEDA dari QRIS statis —
     "Kode approval" dan "4 digit terakhir" — jadi yang diperiksa benar-benar
     instance baru, bukan yang sama dengan label yang berganti. */
  const hal = await buka('render=k06&baris=2');
  try {
    await hal.getByRole('button', { name: 'Kartu (EDC)' }).click();

    const bidang = await bidangTerender(hal);
    assert.ok(
      bidang.length >= 2,
      `hanya ${bidang.length} Bidang dirender untuk kartu EDC; penjaga tidak memeriksa apa pun`
    );

    const teks = bidang.map((b) => namaPendek(b.teks));
    assert.ok(
      teks.some((t) => /Kode approval/i.test(t)),
      `bidang khas kartu EDC tidak dirender: ${JSON.stringify(teks)}`
    );

    for (const b of bidang) {
      assert.equal(
        b.htmlFor,
        b.idInput,
        `label "${b.teks}" tidak terhubung ke inputnya sesudah metode berganti`
      );
      const cocok = hal.getByLabel(namaPendek(b.teks));
      assert.equal(await cocok.count(), 1, `getByLabel(${JSON.stringify(namaPendek(b.teks))}) tidak tepat satu`);
    }

    const id = bidang.map((b) => b.idInput);
    assert.equal(new Set(id).size, id.length, `id bertabrakan sesudah metode berganti: ${JSON.stringify(id)}`);
  } finally {
    await hal.close();
  }
});
