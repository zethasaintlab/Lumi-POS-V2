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
async function buka(kueri, { terjangkau = true, rute = {} } = {}) {
  const hal = await peramban.newPage({ viewport: { width: 1024, height: 1000 } });
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

/** Label tombol metode yang benar-benar ada di DOM. */
const metodeTerlihat = (hal) =>
  hal.$$eval('.kasir-pecahan .btn', (b) => b.map((e) => e.textContent.trim()));

const teks = (hal) => hal.locator('body').innerText();

/**
 * Input yang label-nya cocok.
 *
 * Hubungan label–input dijaga terpisah di `bidang-label.test.js`; di sini ia
 * dipakai apa adanya.
 */
const bidang = (hal, pola) => hal.getByLabel(pola);

// ---------------------------------------------------------------------------
// PENJAGA 1 — panel QRIS mengganti SELURUH layar
// ---------------------------------------------------------------------------

test('⛔ P1: panel QRIS aktif → pemilih metode dan kontrol keranjang TIDAK ADA di DOM', async () => {
  /* Alasannya tertulis di `Pembayaran.tsx:240`: kasir tidak boleh dapat
     mengubah keranjang atau metode selagi pelanggan memindai QR untuk nominal
     yang SUDAH dikirim ke gateway. Nominal yang berubah sesudah QR terbit
     berarti pelanggan membayar angka yang bukan tagihannya.

     ⛔ Ini penjaga terpenting di berkas ini. Pola "QR di dalam kartu yang sama
     bersama pemilih metode" terlihat seperti peningkatan tata letak, dan ia
     membatalkan keputusan ini tanpa satu pun error. */
  const hal = await buka('render=k06&baris=2', {
    rute: {
      '**/orders': { id: 'ord-uji' },
      '**/orders/*/payments': { qrString: '00020101021226590014ID.CO.QRIS.UJI' },
    },
  });
  try {
    // Keadaan AWAL dibuktikan lebih dulu: pemilih metode memang ada di sana.
    // Tanpa ini, penjaga hijau juga pada halaman yang gagal memuat sama sekali.
    const sebelum = await metodeTerlihat(hal);
    assert.ok(sebelum.includes('QRIS'), `pemilih metode tidak dirender: ${JSON.stringify(sebelum)}`);

    await hal.getByRole('button', { name: 'QRIS', exact: true }).click();
    await hal.getByRole('button', { name: 'Simpan Penjualan' }).click();
    await hal.waitForSelector('text=Pindai untuk membayar', { timeout: 10_000 });

    const isi = await teks(hal);
    assert.match(isi, /Pindai untuk membayar/, 'panel QRIS tidak muncul');

    // ⛔ Yang diperiksa KETIADAAN, dan ketiadaannya diperiksa per kontrol —
    // bukan lewat satu assertion atas seluruh teks. Satu kontrol yang bocor
    // kembali ke layar adalah satu jalan bagi kasir mengubah nominal.
    for (const dilarang of ['Tunai', 'QRIS statis', 'Kartu (EDC)', 'Simpan Penjualan', 'Kembali']) {
      assert.ok(
        !isi.includes(dilarang),
        `"${dilarang}" masih ada di DOM selagi panel QRIS aktif — kasir dapat mengubah pembayaran yang nominalnya sudah dikirim ke gateway`
      );
    }
    assert.equal((await metodeTerlihat(hal)).length, 0, 'pemilih metode masih di DOM');
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
      await hal.getByRole('button', { name: '+ Rp 100.000' }).click();
      await hal.getByRole('button', { name: '+ Rp 100.000' }).click();
      const isi = await teks(hal);
      assert.match(isi, /Uang diterima/, `layar tunai tidak dirender untuk ${kueri}`);
      assert.match(isi, /Rp 200\.000/, 'uang diterima tidak bertambah — keadaan berkembalian tidak tercapai');
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

test('⛔ P5: metode online-only saat tak terjangkau → tetap terlihat, DENGAN kalimat alasannya', async () => {
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
    const nama = await metodeTerlihat(hal);
    assert.ok(nama.includes('QRIS'), `QRIS dinamis HILANG dari pemilih: ${JSON.stringify(nama)}`);

    const tombol = hal.getByRole('button', { name: 'QRIS', exact: true });
    assert.equal(await tombol.isDisabled(), true, 'QRIS dinamis aktif padahal server tak terjangkau');

    const isi = await teks(hal);
    assert.match(isi, /Perlu internet/, 'tombol mati TANPA kalimat alasan');

    /* ⛔ Pembanding: saat terjangkau, kalimat itu HILANG dan tombolnya hidup.
       Tanpa pembanding ini penjaga hijau juga pada layar yang SELALU
       menampilkan "Perlu internet" — bentuk kekosongan yang paling mudah
       lolos. */
    const hal2 = await buka('render=k06&baris=2', { terjangkau: true });
    try {
      const isi2 = await teks(hal2);
      assert.ok(!/Perlu internet/.test(isi2), 'kalimat alasan tetap muncul saat server terjangkau');
      assert.equal(
        await hal2.getByRole('button', { name: 'QRIS', exact: true }).isDisabled(),
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
    // Bagian 1 — QRIS statis, dengan referensi wajibnya.
    await hal.getByRole('button', { name: 'QRIS statis' }).click();
    await bidang(hal, /Nominal bagian ini/).fill('10000');
    await bidang(hal, /Referensi pembayaran/).fill('10000-4321');
    await hal.getByRole('button', { name: 'Tambah pembayaran lain' }).click();

    // Bagian 2 — kartu EDC, dengan kode approval wajibnya.
    await hal.getByRole('button', { name: 'Kartu (EDC)' }).click();
    await bidang(hal, /Nominal bagian ini/).fill('5000');
    await bidang(hal, /Kode approval/).fill('APP123');
    await hal.getByRole('button', { name: 'Tambah pembayaran lain' }).click();

    const baris = await hal.$$eval('.kasir-baris-daftar .kasir-subtotal', (n) =>
      n.map((e) => e.textContent.trim())
    );
    assert.equal(baris.length, 2, `daftar bagian tidak memuat dua baris: ${JSON.stringify(baris)}`);

    const isi = await teks(hal);
    assert.match(isi, /QRIS statis/, 'nama metode bagian pertama tidak dirender');
    assert.match(isi, /Kartu \(EDC\)/, 'nama metode bagian kedua tidak dirender');
    assert.match(isi, /Sisa tagihan/, 'sisa tagihan tidak terlihat — FR-C1 AC kedua');

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
