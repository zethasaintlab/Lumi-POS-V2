'use strict';

// ⛔ PENJAGA DOM K-06 PEMBAYARAN — layar yang memindahkan uang.
//
// ## Kenapa berkas ini ada
//
// Audit 16 September 2026: NOL test merender `Pembayaran.tsx` maupun
// `PanelQris.tsx`. Ke-103 test kasir dan domain yang menyentuh pembayaran
// menguji FUNGSI — `rencanakanPembayaran`, `sisaTagihan`, `cekStatus`,
// `simpanPenjualan`. Konsekuensinya bukan celah kecil: tata letak K-06 dapat
// dirusak sepenuhnya tanpa satu pun test merah.
//
// ## ⛔ Yang dijaga adalah KEPUTUSAN, bukan piksel
//
// Setiap penjaga di bawah menunjuk alasan yang sudah tertulis di repo. Penjaga
// yang mengunci detail visual akan merah pada perubahan tata letak yang sah,
// dan yang mematikannya benar. Yang dikunci di sini adalah hal-hal yang
// pelanggarannya memindahkan uang ke tempat yang salah.
//
// ## ⛔ Layar ASLI, bukan salinan
//
// `apps/kasir/src/harness/k06.tsx` memuat `Pembayaran` dan `PanelQris` yang
// SAMA PERSIS dengan yang dipakai aplikasi. Yang dipalsukan hanya database
// (`db-palsu.ts` milik galeri) dan — untuk panel — pengirim API-nya. Penjaga
// yang menjaga salinan tidak menjaga apa pun.
//
// ## ⛔ Kenapa "merah dulu" di sini berbentuk SABOTASE
//
// Perilaku yang dijaga SUDAH ADA; tidak ada implementasi yang menyusul. Test
// yang merah lebih dulu karena fiturnya belum dibangun tidak mungkin ditulis.
// Yang membuktikan penjaga ini bukan hampa adalah sabotase: kode produksi
// dilanggar, penjaga harus merah, lalu dikembalikan. Hasil setiap sabotase
// dicatat di laporan sesi, bukan disimpulkan.
//
// ## Prasyarat
//
//   npm run build:harness-k06
//
// Berkas ini MENOLAK berjalan tanpa build — penjaga yang melewat karena tidak
// menemukan halamannya adalah bentuk kekosongan yang `KELAS-GAGAL.md` catat.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const AKAR = path.resolve(__dirname, '..', '..');
const DIST = path.join(AKAR, 'dist-harness-k06');
/**
 * Chromium yang dipakai.
 *
 * ⛔ Jalur TIDAK dipaku. Versi pertama berkas ini memaku
 * `/opt/pw-browsers/chromium-1194/...` — jalur milik satu container, dengan
 * nomor build di dalamnya. Ia hijau di sini dan gagal di setiap tempat lain,
 * termasuk CI, dan kegagalannya berbunyi "Executable doesn't exist" alih-alih
 * menyebut penjaga mana pun.
 *
 * Urutannya: variabel lingkungan → yang benar-benar ada di
 * `PLAYWRIGHT_BROWSERS_PATH` → biarkan Playwright memilih sendiri.
 */
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

  // Server statis milik test sendiri — tanpa dependency dan tanpa port tetap.
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

/**
 * Membuka harness dengan jaringan yang DIKENDALIKAN test.
 *
 * ⛔ `/health` di-`fulfill`, bukan dibiarkan menembak server sungguhan.
 * FR-C3 menentukan metode online-only dari keterjangkauan server, dan penjaga
 * yang bergantung pada apakah `localhost:3000` kebetulan hidup akan hijau di
 * mesin pengembang dan merah di CI — atau sebaliknya, yang lebih buruk.
 */
async function buka(kueri, { terjangkau = true, rute = {}, tinggi = 1000 } = {}) {
  const hal = await peramban.newPage({ viewport: { width: 1024, height: tinggi } });
  if (terjangkau) {
    await hal.route('**/health', (r) => r.fulfill({ status: 200, body: 'ok' }));
  } else {
    await hal.route('**/health', (r) => r.abort());
  }
  for (const [pola, jawab] of Object.entries(rute)) {
    await hal.route(pola, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(jawab) }));
  }
  await hal.goto(`${alamat}/harness-k06.html?${kueri}`, { waitUntil: 'networkidle' });
  await hal.waitForSelector('#k06 > *', { timeout: 10_000 });
  return hal;
}

/** Label tab metode yang benar-benar ada di DOM (segmented K-06, spec § 7). */
const metodeTerlihat = (hal) =>
  hal.$$eval('.kasir-bayar-tab button', (b) => b.map((e) => e.textContent.trim()));

const teks = (hal) => hal.locator('body').innerText();

/**
 * Input yang label-nya cocok.
 *
 * Hubungan label–input dijaga terpisah di `bidang-label.test.js`; di sini ia
 * dipakai apa adanya.
 */
const bidang = (hal, pola) => hal.getByLabel(pola);

/** `Rp 44.400` → `44400n`. `−` (U+2212) diperlakukan sebagai tanda negatif. */
function bacaRupiah(teksAngka) {
  const bersih = teksAngka.replace(/\s/g, '');
  const negatif = bersih.startsWith('−') || bersih.startsWith('-');
  const digit = bersih.replace(/[^\d]/g, '');
  if (digit === '') return null;
  return negatif ? -BigInt(digit) : BigInt(digit);
}

/** Nilai "Total" di blok ATAS kartu (spec § 7) — `.kasir-bayar-total`. */
async function nilaiTotal(hal) {
  const t = await hal.$eval('.kasir-bayar-atas .kasir-bayar-total .num', (e) => e.textContent.trim()).catch(() => null);
  return t === null ? null : bacaRupiah(t);
}

/** Nilai baris "Sisa tagihan" di blok atas — `.kasir-subtotal`. */
async function nilaiSisa(hal) {
  const baris = await hal.$$eval('.kasir-bayar-atas .kasir-subtotal', (n) =>
    n.map((e) => ({
      label: e.firstElementChild?.textContent.trim() ?? '',
      nilai: e.querySelector('.num')?.textContent.trim() ?? '',
    }))
  );
  const cocok = baris.find((b) => b.label === 'Sisa tagihan');
  return cocok === undefined ? null : bacaRupiah(cocok.nilai);
}

/** Membuka tautan "Bayar dengan lebih dari satu metode" bila belum terbuka. */
async function bukaCampuran(hal) {
  const tautan = hal.getByRole('button', { name: 'Bayar dengan lebih dari satu metode' });
  if ((await tautan.count()) > 0) await tautan.click();
}

/** Memilih QRIS statis: tab QRIS, lalu sub-pilihan "QRIS statis". */
async function pilihQrisStatis(hal) {
  await hal.getByRole('button', { name: 'QRIS', exact: true }).click();
  await hal.getByRole('button', { name: 'QRIS statis', exact: true }).click();
}

/** Menambah satu bagian QRIS statis bernilai `nominal` rupiah. */
async function tambahBagianQris(hal, nominal, referensi) {
  await bukaCampuran(hal);
  await pilihQrisStatis(hal);
  await bidang(hal, /Nominal bagian ini/).fill(String(nominal));
  await bidang(hal, /Referensi pembayaran/).fill(referensi);
  await hal.getByRole('button', { name: 'Tambah pembayaran lain' }).click();
}

const kotak = (hal, sel) =>
  hal.$eval(sel, (e) => {
    const r = e.getBoundingClientRect();
    return { top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), height: +r.height.toFixed(1) };
  });

// ---------------------------------------------------------------------------
// PENJAGA 1 — panel QRIS mengganti SELURUH layar
// ---------------------------------------------------------------------------

test('⛔ P1: selama QRIS menunggu, pemilih metode ADA tetapi setiap tab disabled dengan alasan; "Kembali ke kasir" dan tautan campuran TIDAK ADA; tombol utama nonaktif "Menunggu pembayaran…"; tab nav terkunci', async () => {
  /* Alasannya tertulis di `Pembayaran.tsx`: kasir tidak boleh dapat mengubah
     keranjang atau metode selagi pelanggan memindai QR untuk nominal yang
     SUDAH dikirim ke gateway. Nominal yang berubah sesudah QR terbit berarti
     pelanggan membayar angka yang bukan tagihannya.

     ⛔ Keputusan kampanye (spec § 7, 28 September 2026): "Selama QRIS
     menunggu, toggle metode dan keranjang terkunci" MENGGANTIKAN "pemilih
     metode tidak ada di DOM". Yang dijaga tetap sama — metode tidak dapat
     diganti — tetapi caranya kini terkunci-dan-terlihat, bukan hilang.

     ⛔ R3: `disabled` saja belum bukti. Klik yang DIPAKSA lewat
     `dispatchEvent` pada setiap tab yang terkunci (dan pada tab nav header)
     tidak boleh mengubah metode, nominal, maupun `location`. */
  const hal = await buka('render=k06&baris=2', {
    rute: {
      '**/orders': { id: 'ord-uji' },
      '**/orders/*/payments': { qrString: '00020101021226590014ID.CO.QRIS.UJI' },
    },
  });
  try {
    // Keadaan AWAL dibuktikan lebih dulu: pemilih metode memang ada di sana.
    const sebelum = await metodeTerlihat(hal);
    assert.deepEqual(sebelum, ['Tunai', 'QRIS', 'Kartu', 'Transfer'], `pemilih metode tidak dirender: ${JSON.stringify(sebelum)}`);
    assert.ok(
      (await hal.getByRole('button', { name: 'Kembali ke kasir' }).count()) > 0,
      '"Kembali ke kasir" tidak ada SEBELUM QRIS menunggu — pembanding penjaga ini hampa'
    );

    await hal.getByRole('button', { name: 'QRIS', exact: true }).click();
    await hal.getByRole('button', { name: 'Tampilkan QR' }).click();
    await hal.waitForSelector('text=Pindai untuk membayar', { timeout: 10_000 });

    const isi = await teks(hal);
    assert.match(isi, /Pindai untuk membayar/, 'panel QRIS tidak muncul');

    // Pemilih metode TETAP ADA, dan setiap tab terkunci DENGAN alasannya.
    const tab = await hal.$$eval('.kasir-bayar-tab button, .kasir-bayar-sub button', (b) =>
      b.map((e) => ({
        nama: e.textContent.trim(),
        mati: e.disabled || e.getAttribute('aria-disabled') === 'true',
        alasan: (e.getAttribute('aria-describedby') ?? '')
          .split(' ')
          .map((id) => document.getElementById(id)?.textContent.trim() ?? '')
          .join(' ')
          .trim(),
      }))
    );
    assert.ok(tab.length >= 5, `pemilih metode tidak dirender selagi QRIS menunggu: ${JSON.stringify(tab)}`);
    for (const t of tab) {
      assert.equal(t.mati, true, `tab "${t.nama}" masih aktif selagi QRIS menunggu — kasir dapat mengubah metode`);
      assert.ok(t.alasan.length > 0, `tab "${t.nama}" terkunci TANPA kalimat alasan (aria-describedby kosong)`);
    }

    // ⛔ Yang diperiksa KETIADAAN, per kontrol — satu kontrol yang bocor
    // kembali ke layar adalah satu jalan bagi kasir mengubah nominal.
    for (const dilarang of ['Kembali ke kasir', 'Bayar dengan lebih dari satu metode', 'Konfirmasi bayar']) {
      assert.ok(
        !isi.includes(dilarang),
        `"${dilarang}" masih ada di DOM selagi panel QRIS aktif — kasir dapat mengubah pembayaran yang nominalnya sudah dikirim ke gateway`
      );
    }
    const utama = hal.locator('.kasir-bayar-aksi .btn-primary');
    assert.equal((await utama.textContent()).trim(), 'Menunggu pembayaran…');
    assert.equal(await utama.isDisabled(), true, 'tombol utama aktif selagi QRIS menunggu');

    // Tab nav header terkunci: aria-disabled + alasan.
    const nav = await hal.$$eval('.kasir-header [role="tab"]', (b) =>
      b.map((e) => ({
        nama: e.textContent.trim(),
        mati: e.getAttribute('aria-disabled') === 'true',
        alasan: (e.getAttribute('aria-describedby') ?? '')
          .split(' ')
          .map((id) => document.getElementById(id)?.textContent.trim() ?? '')
          .join(' ')
          .trim(),
      }))
    );
    assert.ok(nav.length >= 4, `tab nav tidak dirender: ${JSON.stringify(nav)}`);
    for (const n of nav) {
      assert.equal(n.mati, true, `tab nav "${n.nama}" tidak terkunci selagi QRIS menunggu`);
      assert.ok(n.alasan.length > 0, `tab nav "${n.nama}" terkunci tanpa kalimat alasan`);
    }

    // ⛔ R3 — klik paksa. Metode aktif, nominal, dan location tidak berubah.
    const sebelumPaksa = await hal.evaluate(() => ({
      aktif: [...document.querySelectorAll('.kasir-bayar-tab button')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent.trim()),
      nominal: document.querySelector('.kasir-bayar-isi .num')?.textContent.trim() ?? null,
      lokasi: location.pathname + location.search,
    }));
    assert.deepEqual(sebelumPaksa.aktif, ['QRIS'], `tab aktif bukan QRIS: ${JSON.stringify(sebelumPaksa)}`);
    /* ⛔ BATAS pengukuran, dinyatakan: React tidak memasang `onClick` pada
       `<button disabled>`, jadi atribut `disabled` dicopot lebih dulu supaya
       klik paksa sampai ke elemen. Di keadaan ini tab sudah dipaksa QRIS oleh
       state turunan, sehingga pagar handler `pilihTab`/`pilihSub` TIDAK teramati
       di sini (sabotasenya tetap hijau); yang teramati: metode/nominal/location
       tidak berubah dan tab nav tidak menavigasi. Pagar `navigasi()` dijaga test
       jalan-keluar-header di akhir berkas. */
    await hal.evaluate(() => {
      for (const el of document.querySelectorAll('.kasir-bayar-tab button, .kasir-bayar-sub button, .kasir-header [role="tab"]')) {
        el.removeAttribute('disabled');
        el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
    });
    await hal.waitForTimeout(200);
    const sesudahPaksa = await hal.evaluate(() => ({
      aktif: [...document.querySelectorAll('.kasir-bayar-tab button')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent.trim()),
      nominal: document.querySelector('.kasir-bayar-isi .num')?.textContent.trim() ?? null,
      lokasi: location.pathname + location.search,
    }));
    assert.deepEqual(
      sesudahPaksa,
      sebelumPaksa,
      `klik paksa pada tab terkunci mengubah keadaan: metode/nominal/location ${JSON.stringify(sebelumPaksa)} → ${JSON.stringify(sesudahPaksa)}`
    );
    assert.match(await teks(hal), /Pindai untuk membayar/, 'panel QRIS hilang sesudah klik paksa');
  } finally {
    await hal.close();
  }
});

// ---------------------------------------------------------------------------
// PENJAGA 2 — angka yang DIBULATKAN tidak muncul sebelum disimpan
// ---------------------------------------------------------------------------

test('⛔ P2: K-06 tidak pernah merender amount_due bulat maupun pembulatan', async () => {
  /* FR-C9 membulatkan `amount_due`, bukan `total`, dan hanya pada SISA TUNAI
     sesudah bagian non-tunai (`spec-c:181`). Menghitungnya sebelum rencana
     pembayaran lengkap menghasilkan angka yang SALAH: `CLAUDE.md:716` mencatat
     contohnya — total 93.555 dengan QRIS 50.020 menagih tunai 43.500, sementara
     membulatkan total lebih dulu menagih 43.580. Delapan puluh rupiah per
     transaksi, tanpa satu pun error.

     Karena itu satu-satunya tempat pembulatan boleh terlihat adalah K-07,
     SESUDAH `simpanPenjualan` menghasilkan rencananya. */
  const hal = await buka('render=k06&baris=2');
  try {
    const isi = await teks(hal);
    assert.match(isi, /Sisa tagihan/, 'layar tidak merender sisa tagihan — halaman salah?');

    /* ⛔ Yang dicari BARIS pembulatan, bukan KATA "pembulatan".
       Versi pertama penjaga ini memakai `/Pembulatan/i` dan langsung merah —
       yang ditandainya adalah kalimat yang justru menyatakan aturannya:
       *"pajak dan pembulatan dihitung saat disimpan"* (`Pembayaran.tsx:585`).
       Penjaga yang menuduh kode yang benar akan dimatikan, dan yang
       mematikannya benar. Bentuk K-07-nya `Pembulatan +Rp…` / `−Rp…`. */
    assert.ok(
      !/Pembulatan\s*[+−-]/.test(isi),
      `K-06 merender baris pembulatan sebelum penjualan disimpan: ${isi}`
    );

    /* ⛔ Bukti kedua, dan ia yang sulit dilanggar tanpa ketahuan: angka yang
       tampil harus angka MENTAH. Outlet galeri memakai `rounding_increment`
       0, jadi membandingkan angka tidak membuktikan apa pun di sana — yang
       dibandingkan karena itu BENTUK kodenya: K-06 tidak boleh memanggil
       satu pun fungsi pembulatan. */
    const sumber = fs.readFileSync(
      path.join(AKAR, 'apps/kasir/src/layar/Pembayaran.tsx'),
      'utf8'
    );
    for (const dilarang of ['computeCashRounding', 'roundingAdjustment', 'rencanakanPembayaran']) {
      const dipakaiDiK06 = sumber
        .slice(0, sumber.indexOf('if (selesai) {'))
        .includes(dilarang);
      assert.ok(
        !dipakaiDiK06,
        `Pembayaran.tsx memakai \`${dilarang}\` SEBELUM cabang K-07 — pembulatan bocor ke layar yang belum punya rencana pembayaran`
      );
    }
  } finally {
    await hal.close();
  }
});

// ---------------------------------------------------------------------------
// PENJAGA 3 — kembalian HANYA di K-07
// ---------------------------------------------------------------------------

test('⛔ P3: kata "Kembalian" tidak pernah dirender di K-06, dalam keadaan mana pun', async () => {
  /* Kembalian adalah selisih antara uang yang diserahkan dan `amount_due`
     yang SUDAH dibulatkan. Menampilkannya di K-06 menuntut pembulatan yang
     P2 larang, dan angkanya akan berbeda dari yang tercetak di struk.

     Diuji pada BEBERAPA keadaan, bukan satu: keadaan yang tidak diuji adalah
     tempat kata itu akan muncul kembali. */
  for (const kueri of [
    'render=k06&baris=2',
    'render=k06&baris=1',
    'render=k06&baris=20',
  ]) {
    const hal = await buka(kueri);
    try {
      // Uang diterima diisi supaya keadaan "berkembalian" benar-benar tercapai:
      // tanpa ini kembalian memang tidak ada karena tidak ada uang sama sekali.
      // Langkah MASUKAN saja yang berubah (keputusan kampanye, Task 8): pecahan
      // yang menambah sudah tidak ada; nominal diketik di "Nominal diterima".
      await hal.getByLabel('Nominal diterima').fill('200.000');
      const isi = await teks(hal);
      assert.match(isi, /Nominal diterima/, `layar tunai tidak dirender untuk ${kueri}`);
      assert.equal(
        await hal.getByLabel('Nominal diterima').inputValue(),
        '200.000',
        'nominal diterima tidak terisi — keadaan berkembalian tidak tercapai'
      );
      assert.ok(
        !/Kembalian/i.test(isi),
        `K-06 merender "Kembalian" pada ${kueri} — ia hanya sah di K-07, sesudah penjualan tersimpan`
      );
    } finally {
      await hal.close();
    }
  }
});

// ---------------------------------------------------------------------------
// PENJAGA 5 — metode yang dinonaktifkan MEMBAWA alasannya
// ---------------------------------------------------------------------------

test('⛔ P5: QRIS dinamis di dalam tab QRIS saat tak terjangkau → tetap terlihat, nonaktif, DENGAN kalimat alasannya; tab QRIS tidak hilang', async () => {
  /* `spec-c:272`, dikutip di `packages/domain/src/pembayaran-manual.ts:179`:
     metode online-only TIDAK disembunyikan — kasir harus tahu metode itu ada
     dan mengapa tidak bisa dipakai. Daftar yang memendek diam-diam terbaca
     seperti aplikasi rusak, atau seperti merchant yang tidak menerima QRIS
     sama sekali, dan kasir tidak punya cara membedakannya.

     Kalimatnya juga memenuhi aturan design system #5: status tidak pernah
     warna saja. Tombol mati tanpa teks adalah tombol yang kasir simpulkan
     rusak — lalu ia berhenti mempercayai layar ini. */
  const hal = await buka('render=k06&baris=2', { terjangkau: false });
  try {
    /* Tab QRIS sendiri TIDAK hilang (QRIS statis tetap berfungsi offline);
       yang nonaktif adalah sub-pilihan "QRIS dinamis" DI DALAMNYA. */
    const nama = await metodeTerlihat(hal);
    assert.ok(nama.includes('QRIS'), `tab QRIS HILANG dari pemilih: ${JSON.stringify(nama)}`);
    await hal.getByRole('button', { name: 'QRIS', exact: true }).click();

    const tombol = hal.getByRole('button', { name: 'QRIS dinamis', exact: true });
    assert.equal(await tombol.count(), 1, 'sub-pilihan QRIS dinamis HILANG dari tab QRIS');
    assert.equal(await tombol.isDisabled(), true, 'QRIS dinamis aktif padahal server tak terjangkau');

    const isi = await teks(hal);
    assert.match(isi, /Perlu internet/, 'sub-pilihan mati TANPA kalimat alasan');

    /* ⛔ Pembanding: saat terjangkau, kalimat itu HILANG dan sub-pilihannya
       hidup. Tanpa pembanding ini penjaga hijau juga pada layar yang SELALU
       menampilkan "Perlu internet" — bentuk kekosongan yang paling mudah
       lolos. */
    const hal2 = await buka('render=k06&baris=2', { terjangkau: true });
    try {
      await hal2.getByRole('button', { name: 'QRIS', exact: true }).click();
      const isi2 = await teks(hal2);
      assert.ok(!/Perlu internet/.test(isi2), 'kalimat alasan tetap muncul saat server terjangkau');
      assert.equal(
        await hal2.getByRole('button', { name: 'QRIS dinamis', exact: true }).isDisabled(),
        false,
        'QRIS dinamis tetap mati padahal server terjangkau'
      );
    } finally {
      await hal2.close();
    }
  } finally {
    await hal.close();
  }
});

// ---------------------------------------------------------------------------
// PENJAGA 6 — habis waktu BUKAN gagal
// ---------------------------------------------------------------------------

test('⛔ P6: habis waktu dan ditolak penerbit merender kalimat BERBEDA, dan aksinya berbeda', async () => {
  /* `spec-c:291`, dikutip di `PanelQris.tsx:16`: *"Kelas bug yang paling sering
     menghasilkan uang hilang di POS: POS meminta QR, gateway timeout,
     pelanggan SUDAH membayar, POS tidak tahu."*

     Kasir harus dapat membedakan "pelanggan belum bayar" dari "kami belum tahu
     apakah pelanggan sudah bayar". Yang pertama boleh dibatalkan; yang kedua
     tidak — dan itulah kenapa tombol "Batalkan transaksi" hanya ada pada yang
     pertama. */
  const habis = await buka('render=panel&status=pending&habis=1');
  const ditolak = await buka('render=panel&status=gagal');
  try {
    const isiHabis = await teks(habis);
    const isiDitolak = await teks(ditolak);

    assert.match(isiHabis, /Belum ada konfirmasi setelah 5 menit/);
    assert.match(isiHabis, /tidak berarti/, 'kalimat habis-waktu tidak menyangkal "belum membayar"');
    assert.ok(!/ditolak penerbit/i.test(isiHabis), 'habis waktu memakai kalimat penolakan');

    assert.match(isiDitolak, /ditolak penerbit/i);
    assert.match(isiDitolak, /tidak terdebit/, 'kalimat penolakan tidak menyatakan uang tidak berpindah');

    assert.notEqual(isiHabis, isiDitolak, 'kedua keadaan merender teks yang sama persis');

    /* ⛔ Perbedaan yang paling mahal bukan kalimatnya melainkan AKSINYA.
       "Batalkan transaksi" pada keadaan yang uangnya mungkin sudah masuk
       melepas stok untuk penjualan yang detik berikutnya lunas. */
    assert.ok(
      !isiHabis.includes('Batalkan transaksi'),
      'habis waktu menawarkan Batalkan — padahal kita TIDAK tahu apakah uang sudah berpindah'
    );
    assert.ok(
      isiDitolak.includes('Batalkan transaksi'),
      'penolakan penerbit tidak menawarkan Batalkan — padahal di sana kita TAHU uang tidak berpindah'
    );
    assert.ok(isiHabis.includes('Tutup layar'), 'habis waktu tidak menawarkan Tutup layar');
  } finally {
    await habis.close();
    await ditolak.close();
  }
});

// ---------------------------------------------------------------------------
// PENJAGA 7 — pembayaran campuran merender DAFTAR bagian
// ---------------------------------------------------------------------------

test('⛔ P7: dua bagian metode berbeda tampil sebagai daftar ber-Hapus, disertai sisa tagihan', async () => {
  /* FR-C1 AC kedua menuntut sisa tagihan TERLIHAT: kasir yang tidak melihatnya
     harus menghitung sendiri di depan pelanggan.

     ⛔ Penjaga ini sekaligus fixture E3 (`CLAUDE.md` § gerbang K-06/K-07):
     `qris_static` dan `card_edc` DIRENDER di sini, bukan hanya ditulis ke
     database. Sampai sekarang keduanya teruji di jalur DATA saja, dan cacat
     yang lolos karenanya adalah peta nama metode yang memuat `card` — kode
     yang tidak ada di skema mana pun. */
  const hal = await buka('render=k06&baris=2');
  try {
    // Bagian 1 — QRIS statis (tab QRIS → sub-pilihan statis), dengan referensi
    // wajibnya. Pembayaran campuran dibuka lewat tautan di bawah isi metode.
    await bukaCampuran(hal);
    await pilihQrisStatis(hal);
    await bidang(hal, /Nominal bagian ini/).fill('10000');
    await bidang(hal, /Referensi pembayaran/).fill('10000-4321');
    await hal.getByRole('button', { name: 'Tambah pembayaran lain' }).click();

    // Bagian 2 — kartu EDC, dengan kode approval wajibnya.
    await hal.getByRole('button', { name: 'Kartu', exact: true }).click();
    await bidang(hal, /Nominal bagian ini/).fill('5000');
    await bidang(hal, /Kode approval/).fill('APP123');
    await hal.getByRole('button', { name: 'Tambah pembayaran lain' }).click();

    const baris = await hal.$$eval('.kasir-baris-daftar .kasir-subtotal', (n) =>
      n.map((e) => e.textContent.trim())
    );
    assert.equal(baris.length, 2, `daftar bagian tidak memuat dua baris: ${JSON.stringify(baris)}`);

    const isi = await teks(hal);
    /* Nama bagian dari SATU peta (`metode-tampilan.ts`), bukan peta lokal layar
       (G-LABEL) — jadi bentuknya "QRIS (statis)" / "Kartu / EDC". */
    const namaBagian = baris.join(' | ');
    assert.match(namaBagian, /QRIS \(statis\)/, `nama metode bagian pertama tidak dirender: ${namaBagian}`);
    assert.match(namaBagian, /Kartu \/ EDC/, `nama metode bagian kedua tidak dirender: ${namaBagian}`);
    assert.match(isi, /Sisa tagihan/, 'sisa tagihan tidak terlihat — FR-C1 AC kedua');
    assert.equal(
      (await hal.$$('.kasir-bayar-kartu .kasir-baris-daftar')).length,
      1,
      'daftar bagian tidak berada DI DALAM kartu yang sama (spec § 7, P7)'
    );

    // Setiap bagian punya aksinya sendiri; satu tombol Hapus untuk dua bagian
    // menghapus yang salah.
    const hapus = await hal.getByRole('button', { name: 'Hapus' }).count();
    assert.ok(hapus >= 2, `hanya ${hapus} tombol Hapus untuk dua bagian`);

    /* ⛔ Sisanya BERKURANG, dan itu yang membuktikan bagiannya benar-benar
       dihitung alih-alih sekadar didaftar. 40.000 + PPN 11% = 44.400;
       dikurangi 10.000 + 5.000 menyisakan 29.400. */
    assert.match(isi, /Rp 29\.400/, `sisa tagihan tidak berkurang sebesar kedua bagian: ${isi}`);
  } finally {
    await hal.close();
  }
});

// ---------------------------------------------------------------------------
// PENJAGA 8 — blok aksi MENEMPEL, tidak ikut bergulir
// ---------------------------------------------------------------------------

test('⛔ P8: blok aksi tidak bergeser antara isi pendek dan isi panjang', async () => {
  /* Sebelum blok ini ada, K-06 adalah satu kolom yang menggulung utuh —
     `.kasir-shift`, nol `flex: none` dan nol pembatas di jalurnya. Pembayaran
     campuran berisi beberapa bagian membuat layar lebih tinggi daripada
     kartunya, dan tombol Bayar terdorong keluar layar tepat pada transaksi
     yang paling rumit: yang nominalnya sudah disebutkan ke pelanggan.

     ⛔ Diuji dengan isi yang PANJANG, bukan dengan keadaan bawaan. Layar bawaan
     muat di kartunya, jadi penjaga yang berhenti di sana hijau pada satu-satunya
     keadaan yang tidak pernah bermasalah. */
  /* ⛔ Viewport 600, bukan 1000 bawaan. Pada 1000 isi ujinya hanya melampaui
     kartunya beberapa puluh piksel — terukur 652,4 lawan ruang 968 saat
     penggulungnya dilepas, yaitu TIDAK melampaui sama sekali. Penjaga yang
     marginnya setipis itu hijau karena kebetulan, dan yang berikutnya menambah
     satu baris ringkasan akan membalikkannya tanpa ada yang tahu kenapa.

     600 bukan angka karangan: tablet 1024×600 adalah perangkat yang produk ini
     sebut (`PRD:428` memakai 1024×768 sebagai panggung, dan yang lebih pendek
     ada di lapangan). */
  const hal = await buka('render=k06&baris=2', { tinggi: 600 });
  try {
    const pendek = await kotak(hal, '.kasir-bayar-aksi');

    for (const [nominal, ref] of [
      [10000, '10000-1111'],
      [5000, '5000-2222'],
      [5000, '5000-3333'],
    ]) {
      await tambahBagianQris(hal, nominal, ref);
    }
    // Kembali ke tunai supaya bidang non-tunai hilang: yang diuji adalah isi
    // yang panjang karena DAFTAR BAGIANNYA, bukan karena form yang terbuka.
    await hal.getByRole('button', { name: 'Tunai', exact: true }).click();

    const jumlahBagian = await hal.$$eval('.kasir-baris-daftar .kasir-subtotal', (n) => n.length);
    assert.equal(jumlahBagian, 3, `daftar bagian tidak terisi: ${jumlahBagian} baris`);

    const panjang = await kotak(hal, '.kasir-bayar-aksi');

    /* ⛔ Assertion utama BICARA DULU, sentinel menutup di belakang — dan
       urutan itu dipilih setelah sabotase pertama menunjukkan kenapa.

       Sentinel di posisi pertama gugur pada sabotase yang merusak tata letak,
       lalu MENYEMBUNYIKAN assertion pergeseran: penjaga merah, tapi merah
       karena kalimat yang salah, dan pergeseran itu sendiri tidak pernah
       terbukti pernah menyala. Dua bentuk sentinel dicoba di posisi pertama
       dan keduanya punya cacat yang sama; yang ketiga — menjumlah tinggi anak
       `.kasir-bayar-isi` — bahkan TERBALIK, karena flex sudah memampatkan
       daftar bagian sebelum ia diukur, jadi ia hanya lolos ketika tata
       letaknya rusak.

       Di posisi ini keduanya utuh: tata letak yang rusak dijawab pergeseran,
       isi uji yang terlalu pendek dijawab sentinel.

       Nol toleransi, dan itu disengaja: keduanya diukur pada viewport yang
       sama dan di-`toFixed(1)`. Toleransi beberapa piksel akan meloloskan blok
       yang bergeser karena satu baris ringkasan muncul — dan baris yang muncul
       lalu menggeser tombol Bayar adalah tombol yang ditekan salah. */
    assert.equal(
      panjang.top,
      pendek.top,
      `tepi ATAS blok aksi bergeser ${(panjang.top - pendek.top).toFixed(1)} px ` +
        `(${pendek.top} → ${panjang.top}) — ia ikut bergulir bersama isinya`
    );
    assert.equal(
      panjang.bottom,
      pendek.bottom,
      `tepi BAWAH blok aksi bergeser ${(panjang.bottom - pendek.bottom).toFixed(1)} px ` +
        `(${pendek.bottom} → ${panjang.bottom})`
    );

    /* ⛔ Dan tombol Bayar benar-benar TERLIHAT, bukan sekadar tidak bergeser.
       Blok yang tingginya menyusut jadi nol juga tidak bergeser. */
    const bayar = await kotak(hal, '.kasir-bayar-aksi .btn-primary');
    const tinggiLayar = await hal.evaluate(() => window.innerHeight);
    assert.ok(
      bayar.bottom <= tinggiLayar && bayar.height >= 44,
      `tombol Bayar di luar layar atau terlalu pendek: bottom ${bayar.bottom}, ` +
        `tinggi ${bayar.height}, layar ${tinggiLayar}`
    );

    /* ⛔ SENTINEL. Blok aksi yang tidak bergeser pada isi yang MUAT di kartunya
       tidak membuktikan apa pun — tidak ada yang mendorongnya. Yang diperiksa:
       penggulungnya benar-benar menyala pada isi uji ini. */
    const isi = await hal.$eval('.kasir-bayar-isi', (e) => ({
      scrollHeight: e.scrollHeight,
      clientHeight: e.clientHeight,
    }));
    assert.ok(
      isi.scrollHeight > isi.clientHeight,
      `isi ujinya tidak melampaui ruangnya (scrollHeight ${isi.scrollHeight}, ` +
        `clientHeight ${isi.clientHeight}); tidak ada yang mendorong blok aksi, ` +
        'jadi penjaga ini tidak menguji apa pun. Perbesar isi ujinya.'
    );
  } finally {
    await hal.close();
  }
});

// ---------------------------------------------------------------------------
// PENJAGA 9 — TOTAL tampil, dan ia angka yang jalur pembayaran pakai
// ---------------------------------------------------------------------------

test('⛔ P9: Total tampil di blok ATAS kartu, 32/700, dan nilainya total yang jalur pembayaran hitung', async () => {
  /* K-06 menampilkan "Subtotal" dan "Sisa tagihan" dan TIDAK PERNAH
     menampilkan Total — kasir menagih angka ketiga yang tidak ada di manapun
     di hadapannya. Sejak Task 8 (spec § 7, mockup `Payment`) ia duduk di blok
     atas kartu: "TOTAL BELANJA" 13 px kapital, nilai 32/700.

     ⛔ Yang dijaga bukan keberadaan kata "Total", melainkan bahwa angkanya
     angka yang SAMA yang jalur pembayaran pakai. Baris Total yang dihitung
     ulang di layar akan lolos pemeriksaan keberadaan dan salah tepat pada
     pajak inklusif. */
  const hal = await buka('render=k06&baris=2');
  try {
    const total = await nilaiTotal(hal);
    assert.notEqual(total, null, 'Total tidak dirender di blok atas kartu K-06');

    const gaya = await hal.$eval('.kasir-bayar-atas .kasir-bayar-total', (e) => ({
      label: e.firstElementChild?.textContent.trim() ?? '',
      labelUkuran: getComputedStyle(e.firstElementChild).fontSize,
      nilaiUkuran: `${getComputedStyle(e.querySelector('.num')).fontSize}/${getComputedStyle(e.querySelector('.num')).fontWeight}`,
      atasKartu: e.closest('.kasir-bayar-kartu') !== null,
    }));
    assert.equal(gaya.nilaiUkuran, '32px/700', `nilai Total ${gaya.nilaiUkuran} — mockup 32 px, bobot 700`);
    assert.equal(gaya.labelUkuran, '13px', `label Total ${gaya.labelUkuran} — mockup 13 px`);
    assert.match(gaya.label, /^total belanja$/i);
    assert.equal(gaya.atasKartu, true, 'Total tidak berada di dalam kartu pembayaran');

    // Blok atas BENAR-BENAR di atas pemilih metode dan isinya.
    const letak = await hal.evaluate(() => {
      const t = document.querySelector('.kasir-bayar-atas').getBoundingClientRect();
      const tab = document.querySelector('.kasir-bayar-tab').getBoundingClientRect();
      const aksi = document.querySelector('.kasir-bayar-aksi').getBoundingClientRect();
      return { totalBawah: t.bottom, tabAtas: tab.top, aksiAtas: aksi.top };
    });
    assert.ok(letak.totalBawah <= letak.tabAtas + 1, `Total (bawah ${letak.totalBawah}) tidak di atas pemilih metode (${letak.tabAtas})`);
    assert.ok(letak.totalBawah < letak.aksiAtas, 'Total berada di blok aksi bawah, bukan di atas kartu');
    assert.equal(
      await hal.locator('.kasir-bayar-aksi .kasir-bayar-total, .kasir-bayar-aksi .kasir-total').count(),
      0,
      'Total masih diduplikasi di blok aksi bawah'
    );

    /* ⛔ Ikatan ke jalur pembayaran, dan ia yang membuat penjaga ini bukan
       sekadar pemeriksaan teks. `sisaTagihan(total, [])` adalah `total` itu
       sendiri, dan `sisa` dihitung dari state `total` yang `bayar()` pakai —
       state yang BERBEDA dari `hitungan` yang merender Total. Keduanya sama
       hanya bila keduanya benar-benar berasal dari `hitungKeranjang`. */
    const sisaAwal = await nilaiSisa(hal);
    assert.equal(
      sisaAwal,
      total,
      `tanpa satu pun bagian, Sisa tagihan (${sisaAwal}) harus sama dengan Total (${total})`
    );

    /* ⛔ Subtotal BERBEDA dari Total, dan ini yang menolak "Total" yang
       diam-diam merender subtotal. Fixture galeri memakai PPN 11% eksklusif
       (`tax-ppn`), jadi keduanya tidak mungkin sama. */
    const butir = await hal.$$eval('.kasir-bayar-atas .kasir-ringkas-butir', (n) =>
      n.map((e) => ({
        label: e.firstElementChild?.textContent.trim() ?? '',
        nilai: e.querySelector('.num')?.textContent.trim() ?? '',
      }))
    );
    const subtotal = butir.find((b) => b.label === 'Subtotal');
    assert.ok(subtotal, `butir Subtotal hilang dari blok atas K-06: ${JSON.stringify(butir)}`);
    const nilaiSubtotal = bacaRupiah(subtotal.nilai);
    assert.notEqual(
      total,
      nilaiSubtotal,
      `Total (${total}) sama persis dengan Subtotal (${nilaiSubtotal}) — pajak tidak masuk hitungan`
    );

    /* ⛔ Butir pajak memakai NAMA TARIF, bukan kata "Pajak" (`spec-c:404`).
       Layar yang menyebutnya berbeda dari struk membuat kasir yang mencocokkan
       keduanya menyimpulkan salah satunya salah. */
    const labelPajak = butir.map((b) => b.label);
    assert.ok(
      labelPajak.includes('PPN 11%'),
      `butir pajak tidak memakai nama tarif: ${JSON.stringify(labelPajak)}`
    );
    assert.ok(
      !labelPajak.includes('Pajak'),
      `butir pajak memakai kata generik "Pajak", yang \`spec-c:404\` larang: ${JSON.stringify(labelPajak)}`
    );

    /* ⛔ Dan Total tetap Total saat bagian masuk: yang berkurang SISA, bukan
       Total. Total yang ikut menyusut adalah total yang dihitung dari sisa —
       arah kebergantungan yang terbalik, dan struk yang menyebut angka lebih
       kecil daripada yang pelanggan bayar. */
    await tambahBagianQris(hal, 10000, '10000-4321');
    const totalSesudah = await nilaiTotal(hal);
    const sisaSesudah = await nilaiSisa(hal);
    assert.equal(totalSesudah, total, `Total berubah setelah satu bagian masuk: ${total} → ${totalSesudah}`);
    assert.equal(
      sisaSesudah,
      total - 10000n,
      `Sisa tagihan tidak berkurang tepat sebesar bagiannya: ${sisaSesudah}, harusnya ${total - 10000n}`
    );
  } finally {
    await hal.close();
  }
});

// ---------------------------------------------------------------------------
// TASK 8 — kartu pembayaran bertoggle: Transfer, pintasan, nominal, kunci
// ---------------------------------------------------------------------------

/** Penulisan yang dicatat db palsu (`__galeriTulis`), dengan parameter jadi string. */
const tulisan = (hal) =>
  hal.evaluate(() =>
    (globalThis.__galeriTulis ?? []).map((t) => ({ sql: t.sql, params: t.params.map((p) => (typeof p === 'bigint' ? String(p) : p)) }))
  );
const jumlahOrder = async (hal) => (await tulisan(hal)).filter((t) => /^INSERT INTO "order"/i.test(t.sql)).length;

/** Prasyarat dengan PESAN yang menyebut yang dijaga — bukan timeout selektor. */
async function pastikanAda(hal, loc, pesan) {
  assert.ok((await loc.count()) > 0, pesan);
}

/** Teks alasan yang dirujuk `aria-describedby` sebuah elemen. */
const alasanDari = (hal, loc) =>
  loc.evaluate((e) =>
    (e.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent.trim() ?? '')
      .join(' ')
      .trim()
  );

test('⛔ Transfer: tanpa referensi "Konfirmasi bayar" menolak dengan pesan periksaTransfer; tab HILANG saat pembayaran_transfer mati', async () => {
  /* Aturan Transfer hidup di SATU tempat (`periksaTransfer`), dan layar
     menampilkan pesannya kata demi kata — dua kalimat berbeda untuk
     penolakan yang sama tergantung online/offline adalah cacat yang sudah
     pernah terjadi (`Pembayaran.tsx`: "Pesan SERVER, kata demi kata"). */
  const hal = await buka('render=k06&baris=2');
  try {
    assert.ok((await metodeTerlihat(hal)).includes('Transfer'), 'tab Transfer tidak dirender saat fitur menyala');
    await hal.getByRole('button', { name: 'Transfer', exact: true }).click();
    assert.equal(await bidang(hal, 'Bank tujuan').count(), 1, 'field "Bank tujuan" tidak dirender');
    assert.equal(await bidang(hal, 'Nomor referensi').count(), 1, 'field "Nomor referensi" tidak dirender');

    // Referensi kosong: ditolak dengan pesan `periksaTransfer`, tidak menulis apa pun.
    await hal.getByRole('button', { name: 'Konfirmasi bayar' }).click();
    await hal.waitForSelector('[role="alert"]', { timeout: 10_000 });
    const galat = await hal.locator('[role="alert"]').first().innerText();
    assert.match(galat, /Nomor referensi transfer wajib \(minimal 3 karakter\)/, `pesan bukan milik periksaTransfer: ${galat}`);
    assert.equal(await jumlahOrder(hal), 0, 'penjualan tertulis meski referensi Transfer kosong');

    // Nomor kartu di field referensi: kode POSSIBLE_CARD_NUMBER, pesannya juga dari domain.
    await bidang(hal, 'Nomor referensi').fill('4111 1111 1111 1111');
    await hal.getByRole('button', { name: 'Konfirmasi bayar' }).click();
    await hal.waitForFunction(() => /nomor kartu/i.test(document.querySelector('[role="alert"]')?.textContent ?? ''), null, { timeout: 10_000 });
    assert.equal(await jumlahOrder(hal), 0, 'penjualan tertulis meski referensi tampak nomor kartu');

    // Referensi sah: tersimpan sebagai `other` + `bank_transfer`.
    await bidang(hal, 'Nomor referensi').fill('TRF-20260930-001');
    await hal.getByRole('button', { name: 'Konfirmasi bayar' }).click();
    await hal.waitForSelector('text=Transaksi selesai', { timeout: 10_000 });
    const bayar = (await tulisan(hal)).find((t) => /^INSERT INTO payment/i.test(t.sql));
    assert.ok(bayar, 'baris payment Transfer tidak ditulis');
    assert.equal(bayar.params[3], 'other', 'Transfer tidak tersimpan sebagai method other');
    assert.equal(bayar.params[14], 'bank_transfer', 'Transfer tidak membawa provider bank_transfer');
  } finally {
    await hal.close();
  }

  // Kill switch: tab HILANG (bukan nonaktif) — pembanding di atas membuktikan ia ada saat menyala.
  const mati = await buka('render=k06&baris=2&matikan=pembayaran_transfer');
  try {
    const tab = await metodeTerlihat(mati);
    assert.deepEqual(tab, ['Tunai', 'QRIS', 'Kartu'], `tab Transfer tidak hilang saat pembayaran_transfer mati: ${JSON.stringify(tab)}`);
  } finally {
    await mati.close();
  }
});

test('⛔ pintasan MENETAPKAN, tidak menambah: Rp 50.000 lalu Rp 20.000 → kolom berisi 20.000', async () => {
  const hal = await buka('render=k06&baris=2');
  try {
    const kolom = hal.getByLabel('Nominal diterima');
    await pastikanAda(hal, kolom, 'kolom "Nominal diterima" tidak ada di tab Tunai');
    await pastikanAda(hal, hal.getByRole('button', { name: 'Rp 50.000', exact: true }), 'pintasan "Rp 50.000" tidak ada — enam pecahan yang menambah masih menggantikannya');
    await hal.getByRole('button', { name: 'Rp 50.000', exact: true }).click();
    assert.equal(await kolom.inputValue(), '50.000', 'pintasan Rp 50.000 tidak mengisi kolom');
    await hal.getByRole('button', { name: 'Rp 20.000', exact: true }).click();
    assert.equal(
      await kolom.inputValue(),
      '20.000',
      'pintasan MENAMBAH alih-alih menetapkan (50.000 + 20.000 = 70.000) — keputusan user 28 September 2026'
    );
    await hal.getByRole('button', { name: 'Rp 100.000', exact: true }).click();
    assert.equal(await kolom.inputValue(), '100.000');
  } finally {
    await hal.close();
  }
});

test('⛔ tiga pintasan persis mockup: Rp 20.000 · Rp 50.000 · Rp 100.000, tampil 44 px dengan area ≥ 56 (.sentuh-uang)', async () => {
  const hal = await buka('render=k06&baris=2');
  try {
    const pintasan = await hal.$$eval('.kasir-bayar-isi button', (b) =>
      b
        .filter((e) => /^Rp /.test(e.textContent.trim()))
        .map((e) => ({ nama: e.textContent.trim(), sentuh: e.classList.contains('sentuh-uang'), h: Math.round(e.getBoundingClientRect().height) }))
    );
    assert.deepEqual(
      pintasan.map((p) => p.nama),
      ['Rp 20.000', 'Rp 50.000', 'Rp 100.000'],
      `pintasan bukan tiga nominal mockup: ${JSON.stringify(pintasan)}`
    );
    for (const p of pintasan) {
      assert.ok(Math.abs(p.h - 44) <= 1, `pintasan "${p.nama}" tampil ${p.h} px — mockup 44`);
      assert.equal(p.sentuh, true, `pintasan "${p.nama}" tanpa .sentuh-uang — area tekan 56 px (DS #3, aksi uang)`);
    }

    /* ⛔ AREA TEKAN diukur lewat `elementFromPoint`, bukan dibaca dari kelas:
       titik 5 px DI LUAR tepi atas dan bawah (area 56 = 6 px di setiap sisi
       dari tampil 44) harus dijawab tombolnya sendiri. */
    for (const nama of ['Rp 20.000', 'Rp 50.000', 'Rp 100.000']) {
      const hasil = await hal.evaluate((n) => {
        const b = [...document.querySelectorAll('.kasir-bayar-isi button')].find((e) => e.textContent.trim() === n);
        const r = b.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const atas = document.elementFromPoint(cx, r.top - 5);
        const bawah = document.elementFromPoint(cx, r.bottom + 5);
        return { atas: atas === b || b.contains(atas), bawah: bawah === b || b.contains(bawah) };
      }, nama);
      assert.equal(hasil.atas, true, `area tekan "${nama}" tidak meluas 5 px ke atas (target 56)`);
      assert.equal(hasil.bawah, true, `area tekan "${nama}" tidak meluas 5 px ke bawah (target 56)`);
    }
  } finally {
    await hal.close();
  }
});

test('⛔ kolom Nominal diterima kosong atau cacat → Konfirmasi bayar nonaktif dengan alasan, tidak pernah menyimpan tendered 0', async () => {
  const hal = await buka('render=k06&baris=2');
  try {
    const kolom = hal.getByLabel('Nominal diterima');
    const aksi = hal.getByRole('button', { name: 'Konfirmasi bayar' });
    await pastikanAda(hal, kolom, 'kolom "Nominal diterima" tidak ada di tab Tunai');
    await pastikanAda(hal, aksi, 'tombol "Konfirmasi bayar" tidak ada — masih "Simpan Penjualan"');

    for (const [masukan, nama] of [['', 'kosong'], ['25.5', 'desimal 25.5'], ['100.000,00', 'desimal 100.000,00'], ['abc', 'bukan angka']]) {
      await kolom.fill(masukan);
      assert.equal(await aksi.isDisabled(), true, `Konfirmasi bayar aktif untuk nominal ${nama}`);
      assert.match(await alasanDari(hal, aksi), /Isi nominal yang diterima/, `tombol mati TANPA alasan untuk nominal ${nama}`);
    }

    // Pembanding: nominal sah mengaktifkan tombolnya dan alasannya hilang.
    await kolom.fill('100.000');
    assert.equal(await aksi.isDisabled(), false, 'Konfirmasi bayar tetap mati untuk nominal sah — penjaga ini hampa');

    // Dan tidak ada penulisan sama sekali sepanjang itu.
    assert.equal(await jumlahOrder(hal), 0);
  } finally {
    await hal.close();
  }
});

test('⛔ tab nav terkunci selama penjualan disimpan, dan terbuka lagi sesudahnya', async () => {
  const hal = await buka('render=k06&baris=2');
  try {
    const navKunci = () =>
      hal.$$eval('.kasir-header [role="tab"]', (b) => b.map((e) => e.getAttribute('aria-disabled') === 'true'));
    assert.ok((await navKunci()).length >= 4, 'tab nav tidak dirender');
    assert.deepEqual((await navKunci()).filter(Boolean), [], 'tab nav terkunci SEBELUM menyimpan — pembanding hampa');

    // Tahan penulisan order supaya jendela "sedang menyimpan" dapat diukur.
    await hal.evaluate(() => {
      globalThis.__galeriTahanPenjualan = new Promise((r) => { globalThis.__lepasPenjualan = r; });
    });
    await pastikanAda(hal, hal.getByLabel('Nominal diterima'), 'kolom "Nominal diterima" tidak ada di tab Tunai');
    await hal.getByLabel('Nominal diterima').fill('100.000');
    await hal.getByRole('button', { name: 'Konfirmasi bayar' }).click();
    await hal.waitForFunction(() => [...document.querySelectorAll('.kasir-header [role="tab"]')].every((e) => e.getAttribute('aria-disabled') === 'true'), null, { timeout: 5_000 }).catch(() => {});
    const selamaSimpan = await navKunci();
    assert.ok(selamaSimpan.every(Boolean), `tab nav tidak terkunci selama penjualan disimpan: ${JSON.stringify(selamaSimpan)}`);

    /* ⛔ R3 pada keadaan SIMPAN (di QRIS menunggu, tab efektif sudah dipaksa
       QRIS oleh state turunan, jadi pagar handler tidak teramati di sana). Klik
       paksa — `disabled` dicopot, tab nav ber-`aria-disabled` — tidak boleh
       mengganti metode maupun location. */
    const aktifTab = () =>
      hal.$$eval('.kasir-bayar-tab button', (b) => b.filter((e) => e.getAttribute('aria-pressed') === 'true').map((e) => e.textContent.trim()));
    const lokasiAwal = await hal.evaluate(() => location.pathname + location.search);
    assert.deepEqual(await aktifTab(), ['Tunai']);
    await hal.evaluate(() => {
      for (const el of document.querySelectorAll('.kasir-bayar-tab button, .kasir-header [role="tab"]')) {
        el.removeAttribute('disabled');
        el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
    });
    await hal.waitForTimeout(150);
    assert.deepEqual(await aktifTab(), ['Tunai'], 'klik paksa mengganti metode selagi penjualan disimpan');
    assert.equal(await hal.evaluate(() => location.pathname + location.search), lokasiAwal, 'klik paksa pada tab nav mengubah location selagi menyimpan');

    await hal.evaluate(() => globalThis.__lepasPenjualan());
    await hal.waitForSelector('text=Transaksi selesai', { timeout: 10_000 });
    const sesudah = await navKunci();
    assert.deepEqual(sesudah.filter(Boolean), [], `tab nav tetap terkunci sesudah penyimpanan selesai: ${JSON.stringify(sesudah)}`);
  } finally {
    await hal.close();
  }
});

test('⛔ ketukan ganda "Konfirmasi bayar" menyimpan SATU penjualan', async () => {
  /* Review Focus 1: kasir yang terburu-buru menekan dua kali. Dua baris
     `order` untuk satu pembayaran = uang tercatat dua kali. */
  const hal = await buka('render=k06&baris=2');
  try {
    await hal.evaluate(() => {
      globalThis.__galeriTahanPenjualan = new Promise((r) => { globalThis.__lepasPenjualan = r; });
    });
    await pastikanAda(hal, hal.getByLabel('Nominal diterima'), 'kolom "Nominal diterima" tidak ada di tab Tunai');
    await hal.getByLabel('Nominal diterima').fill('100.000');
    // Dua ketukan BERUNTUN dalam satu tugas — render ulang React belum sempat menonaktifkan tombolnya.
    await hal.evaluate(() => {
      const b = [...document.querySelectorAll('.kasir-bayar-aksi button')].find((e) => e.textContent.trim() === 'Konfirmasi bayar');
      b.click();
      b.click();
      b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await hal.waitForTimeout(300);
    await hal.evaluate(() => globalThis.__lepasPenjualan());
    await hal.waitForSelector('text=Transaksi selesai', { timeout: 10_000 });
    await hal.waitForTimeout(300);
    const n = await jumlahOrder(hal);
    assert.equal(n, 1, `${n} baris order tertulis untuk satu pembayaran yang diketuk dua kali`);
  } finally {
    await hal.close();
  }
});

for (const [nama, masuk, harap] of [
  [
    'qris_static',
    async (hal) => {
      await hal.getByRole('button', { name: 'QRIS', exact: true }).click();
      await hal.getByRole('button', { name: 'QRIS statis', exact: true }).click();
      await bidang(hal, /Referensi pembayaran/).fill('44400-4321');
    },
    { method: 'qris_static', referensi: '44400-4321' },
  ],
  [
    'card_edc',
    async (hal) => {
      await hal.getByRole('button', { name: 'Kartu', exact: true }).click();
      await bidang(hal, /Kode approval/).fill('APP123');
    },
    { method: 'card_edc', referensi: null },
  ],
]) {
  test(`qris_static dan card_edc di jalur TAMPILAN: ${nama} sampai K-07 dengan metode tersimpan benar`, async () => {
    /* Fixture #3 (`uang-pembayaran-kas.md:275`): keduanya teruji di jalur DATA
       dan TIDAK di jalur tampilan — persis lubang yang meloloskan peta metode
       yang memuat `card` dan tidak memuat `qris_static`. */
    const hal = await buka('render=k06&baris=2');
    try {
      assert.ok((await metodeTerlihat(hal)).length >= 4, 'segmented metode tidak dirender — jalur tampilan tidak tercapai');
      await masuk(hal);
      await hal.getByRole('button', { name: 'Konfirmasi bayar' }).click();
      await hal.waitForSelector('text=Transaksi selesai', { timeout: 10_000 });
      const bayar = (await tulisan(hal)).find((t) => /^INSERT INTO payment/i.test(t.sql));
      assert.ok(bayar, `baris payment ${nama} tidak ditulis`);
      assert.equal(bayar.params[3], harap.method, `metode tersimpan ${bayar.params[3]}, harapan ${harap.method}`);
      if (harap.referensi !== null) assert.equal(bayar.params[7], harap.referensi);
    } finally {
      await hal.close();
    }
  });
}

// ---------------------------------------------------------------------------
// Kunci nav menutup SEMUA jalan keluar header, bukan hanya empat tab (I-1)
// ---------------------------------------------------------------------------

/** Klik paksa pada setiap jalan keluar header; kembalikan yang ditemukan. */
async function paksaJalanKeluar(hal) {
  const ada = await hal.evaluate(() => ({
    indikator: document.querySelectorAll('.kasir-indikator').length,
    coba: document.querySelectorAll('.kasir-indikator button').length,
    pita: document.querySelectorAll('.kasir-pita-tautan').length,
  }));
  assert.ok(ada.indikator > 0, 'indikator sinkron tidak dirender — pembanding penjaga ini hampa');
  assert.ok(ada.pita > 0, 'tautan pita antrean tidak dirender (skenario gambar-antrean?) — pembanding hampa');
  // Pengamat: kata "Memeriksa…" pada item Keluar berarti `keluar()` sempat dijalankan.
  await hal.evaluate(() => {
    globalThis.__keluarJalan = false;
    new MutationObserver(() => {
      if (/Memeriksa/.test(document.querySelector('.kasir-menu-pengguna-daftar')?.textContent ?? '')) globalThis.__keluarJalan = true;
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  await hal.evaluate(() => {
    for (const el of document.querySelectorAll('.kasir-indikator, .kasir-indikator button, .kasir-pita-tautan')) {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
  });
  const butir = await hal.locator('.kasir-menu-pengguna-tombol').count();
  assert.equal(butir, 1, 'tombol menu pengguna tidak dirender');
  const item = [];
  for (let i = 0; i < 3; i++) {
    if ((await hal.locator('.kasir-menu-pengguna-daftar').count()) === 0) await hal.locator('.kasir-menu-pengguna-tombol').click();
    const m = hal.locator('.kasir-menu-pengguna-daftar [role="menuitem"]').nth(i);
    item.push({
      nama: (await m.textContent()).trim(),
      mati: (await m.getAttribute('aria-disabled')) === 'true' || (await m.isDisabled()),
    });
    await m.evaluate((e) => e.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  }
  await hal.waitForTimeout(250);
  return item;
}

async function pastikanTetap(hal, lokasiAwal, item, konteks) {
  assert.equal(
    await hal.evaluate(() => location.pathname + location.search),
    lokasiAwal,
    `${konteks}: klik paksa pada jalan keluar header mengubah location`
  );
  assert.ok(
    (await hal.locator('.kasir-bayar-kartu').count()) > 0,
    `${konteks}: K-06 ter-unmount oleh klik pada jalan keluar header`
  );
  assert.equal(item.length, 3, `${konteks}: menu pengguna tidak memuat tiga item`);
  for (const i of item) assert.equal(i.mati, true, `${konteks}: item menu "${i.nama}" tidak terkunci (aria-disabled)`);
  assert.equal(await hal.evaluate(() => globalThis.__keluarJalan), false, `${konteks}: Keluar menjalankan keluar() selagi terkunci`);
}

test('⛔ kunci nav menutup indikator sinkron, tautan pita, dan menu pengguna selama penjualan disimpan', async () => {
  const hal = await buka('render=k06&baris=2&skenario=gambar-antrean');
  try {
    await hal.waitForSelector('.kasir-pita-tautan', { timeout: 10_000 });
    await hal.evaluate(() => {
      globalThis.__galeriTahanPenjualan = new Promise((r) => { globalThis.__lepasPenjualan = r; });
    });
    await hal.getByLabel('Nominal diterima').fill('100.000');
    await hal.getByRole('button', { name: 'Konfirmasi bayar' }).click();
    await hal.waitForFunction(() => document.querySelector('.kasir-header [role="tab"]')?.getAttribute('aria-disabled') === 'true', null, { timeout: 5_000 });
    const lokasiAwal = await hal.evaluate(() => location.pathname + location.search);
    const item = await paksaJalanKeluar(hal);
    await pastikanTetap(hal, lokasiAwal, item, 'menyimpan');
    // Penjualan yang sedang disimpan SELESAI di layar yang sama (tidak yatim).
    await hal.evaluate(() => globalThis.__lepasPenjualan());
    await hal.waitForSelector('text=Transaksi selesai', { timeout: 10_000 });
  } finally {
    await hal.close();
  }
});

test('⛔ kunci nav menutup indikator sinkron, tautan pita, dan menu pengguna selama QRIS menunggu', async () => {
  const hal = await buka('render=k06&baris=2&skenario=gambar-antrean', {
    rute: {
      '**/orders': { id: 'ord-uji' },
      '**/orders/*/payments': { qrString: '00020101021226590014ID.CO.QRIS.UJI' },
    },
  });
  try {
    await hal.waitForSelector('.kasir-pita-tautan', { timeout: 10_000 });
    await hal.getByRole('button', { name: 'QRIS', exact: true }).click();
    await hal.getByRole('button', { name: 'Tampilkan QR' }).click();
    await hal.waitForSelector('text=Pindai untuk membayar', { timeout: 10_000 });
    const lokasiAwal = await hal.evaluate(() => location.pathname + location.search);
    const item = await paksaJalanKeluar(hal);
    await pastikanTetap(hal, lokasiAwal, item, 'QRIS menunggu');
    assert.match(await teks(hal), /Pindai untuk membayar/, 'panel QRIS hilang sesudah klik pada jalan keluar header');
  } finally {
    await hal.close();
  }
});

test('⛔ Transfer + campuran terbuka + referensi kosong: "Tambah pembayaran lain" nonaktif DENGAN alasan yang ada di DOM', async () => {
  const hal = await buka('render=k06&baris=2');
  try {
    await hal.getByRole('button', { name: 'Transfer', exact: true }).click();
    await bukaCampuran(hal);
    const tambah = hal.getByRole('button', { name: 'Tambah pembayaran lain' });
    await pastikanAda(hal, tambah, 'tombol "Tambah pembayaran lain" tidak dirender di Transfer + campuran');
    assert.equal(await tambah.isDisabled(), true, 'pembanding hampa: tombol aktif padahal referensi kosong');
    const alasan = await alasanDari(hal, tambah);
    assert.ok(alasan.length > 0, 'tombol nonaktif tanpa alasan: aria-describedby menunjuk elemen yang tidak dirender');
    assert.match(alasan, /referensi/i, `alasan bukan milik periksaTransfer: "${alasan}"`);
  } finally {
    await hal.close();
  }
});
