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

/* Keputusan kampanye Hidupkan desain 26 Sep 2026: pemilih metode adalah
   segmented empat tab (`role="tab"` di dalam tablist "Metode pembayaran"),
   bukan deretan `.btn` 2×2. */
const TAB = '[role="tablist"][aria-label="Metode pembayaran"] [role="tab"]';

/** Label tab metode yang benar-benar ada di DOM. */
const metodeTerlihat = (hal) => hal.$$eval(TAB, (b) => b.map((e) => e.textContent.trim()));

/** Tab metode menurut namanya. */
const tab = (hal, nama) => hal.getByRole('tab', { name: nama, exact: true });

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

/** Nilai baris ringkasan yang labelnya cocok — `.kasir-subtotal`/`.kasir-total`. */
async function nilaiBaris(hal, label) {
  const baris = await hal.$$eval('.kasir-bayar-aksi .kasir-subtotal, .kasir-bayar-aksi .kasir-total', (n) =>
    n.map((e) => ({
      label: e.firstElementChild?.textContent.trim() ?? '',
      nilai: e.querySelector('.num')?.textContent.trim() ?? '',
    }))
  );
  const cocok = baris.find((b) => b.label === label);
  return cocok === undefined ? null : bacaRupiah(cocok.nilai);
}

/** Membuka bagian pembayaran campuran bila belum terbuka (tautan kecil di kartu). */
async function bukaCampuran(hal) {
  const tautan = hal.getByRole('button', { name: 'Bayar dengan lebih dari satu metode' });
  if ((await tautan.count()) > 0) await tautan.click();
}

/** Nilai blok Total di ATAS kartu (keputusan kampanye: bukan lagi di blok aksi). */
async function nilaiTotalAtas(hal) {
  const nilai = await hal.$eval('.kasir-bayar-total .num', (e) => e.textContent.trim());
  return bacaRupiah(nilai);
}

/** Menambah satu bagian QRIS statis bernilai `nominal` rupiah. */
async function tambahBagianQris(hal, nominal, referensi) {
  await bukaCampuran(hal);
  await tab(hal, 'QRIS').click();
  await hal.getByRole('button', { name: 'QRIS statis', exact: true }).click();
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

     ⛔ Keputusan kampanye Hidupkan desain (26 September 2026): "Selama QRIS
     menunggu, toggle metode dan keranjang terkunci" MENGGANTIKAN "pemilih
     metode tidak ada di DOM". Kontrol yang terkunci dapat dibuka oleh cacat
     keadaan React yang tidak akan pernah terjadi pada kontrol yang tidak
     dirender (spec § 14 R3), karena itu yang diperiksa bukan hanya `disabled`
     melainkan bahwa KLIK yang dikirim lewat `dispatchEvent` — melewati
     atribut disabled — tidak mengubah metode, nominal, maupun alamat. */
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

    await tab(hal, 'QRIS').click();
    await hal.getByRole('button', { name: 'Tampilkan kode QR' }).click();
    await hal.waitForSelector('text=Pindai untuk membayar', { timeout: 10_000 });

    const isi = await teks(hal);
    assert.match(isi, /Pindai untuk membayar/, 'panel QRIS tidak muncul');

    // Pemilih metode MASIH ada, dan SETIAP tab terkunci dengan alasan.
    const sesudah = await metodeTerlihat(hal);
    assert.deepEqual(sesudah, ['Tunai', 'QRIS', 'Kartu', 'Transfer'], `pemilih metode hilang selagi QRIS menunggu: ${JSON.stringify(sesudah)}`);
    const tabInfo = await hal.$$eval(TAB, (n) =>
      n.map((e) => ({
        nama: e.textContent.trim(),
        terkunci: e.disabled === true || e.getAttribute('aria-disabled') === 'true',
        alasan: (() => {
          const id = e.getAttribute('aria-describedby');
          return id ? (document.getElementById(id)?.textContent.trim() ?? '') : '';
        })(),
      }))
    );
    for (const t of tabInfo) {
      assert.ok(t.terkunci, `tab "${t.nama}" TIDAK terkunci selagi QRIS menunggu — kasir dapat mengganti metode atas nominal yang sudah dikirim ke gateway`);
      assert.ok(t.alasan.length > 0, `tab "${t.nama}" terkunci TANPA alasan tertulis (aria-describedby kosong)`);
    }

    // Yang HARUS hilang: jalan keluar dari pembayaran yang sedang berjalan.
    for (const dilarang of ['Kembali ke kasir', 'Bayar dengan lebih dari satu metode']) {
      assert.ok(
        !isi.includes(dilarang),
        `"${dilarang}" masih ada di DOM selagi panel QRIS aktif — kasir dapat meninggalkan/mengubah pembayaran yang nominalnya sudah dikirim ke gateway`
      );
    }

    // Tombol utama tampil di tempat yang sama, nonaktif, dan berlabel menunggu.
    const utama = await hal.$eval('.kasir-bayar-aksi .btn-primary', (e) => ({
      teks: e.textContent.trim(),
      mati: e.disabled === true || e.getAttribute('aria-disabled') === 'true',
      alasan: document.getElementById(e.getAttribute('aria-describedby') ?? '')?.textContent.trim() ?? '',
    }));
    assert.ok(utama.alasan.length > 0, 'tombol "Menunggu pembayaran…" nonaktif TANPA alasan tertulis (aria-describedby kosong) — G-TOMBOL-HIDUP');
    assert.equal(utama.teks, 'Menunggu pembayaran…', `tombol utama selagi menunggu: "${utama.teks}"`);
    assert.ok(utama.mati, 'tombol utama AKTIF selagi QRIS menunggu — ada jalur ketukan yang dapat menandai lunas');

    // ⛔ R3: klik buatan — melewati atribut `disabled` — pada SETIAP tab metode
    // dan pada SETIAP tab nav tidak mengubah apa pun.
    const potret = () =>
      hal.evaluate((sel) => ({
        terpilih: [...document.querySelectorAll(sel)].filter((e) => e.getAttribute('aria-selected') === 'true').map((e) => e.textContent.trim()),
        total: document.querySelector('.kasir-bayar-total .num')?.textContent.trim() ?? null,
        lokasi: window.location.pathname + window.location.search,
      }), TAB);
    const awal = await potret();
    assert.deepEqual(awal.terpilih, ['QRIS'], `tab terpilih sebelum klik buatan: ${JSON.stringify(awal.terpilih)}`);
    await hal.$$eval(TAB, (n) => n.forEach((e) => e.dispatchEvent(new MouseEvent('click', { bubbles: true }))));
    await hal.$$eval('[aria-label="Navigasi kasir"] [role="tab"]', (n) =>
      n.forEach((e) => e.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    );
    await hal.waitForTimeout(200);
    const akhir = await potret();
    assert.deepEqual(akhir.terpilih, awal.terpilih, `klik buatan MENGGANTI metode aktif: ${JSON.stringify(awal.terpilih)} → ${JSON.stringify(akhir.terpilih)}`);
    assert.equal(akhir.total, awal.total, 'klik buatan mengubah nominal');
    assert.equal(akhir.lokasi, awal.lokasi, `klik buatan pada tab nav MENAVIGASI: ${awal.lokasi} → ${akhir.lokasi}`);

    // Tab nav terkunci dengan alasan.
    const nav = await hal.$$eval('[aria-label="Navigasi kasir"] [role="tab"]', (n) =>
      n.map((e) => ({
        nama: e.textContent.trim(),
        terkunci: e.getAttribute('aria-disabled') === 'true',
        alasan: (() => {
          const id = e.getAttribute('aria-describedby');
          return id ? (document.getElementById(id)?.textContent.trim() ?? '') : '';
        })(),
      }))
    );
    assert.ok(nav.length >= 4, `tab nav tidak dirender: ${JSON.stringify(nav)}`);
    for (const t of nav) {
      assert.ok(t.terkunci, `tab nav "${t.nama}" TIDAK terkunci selagi QRIS menunggu — meninggalkan layar menghapus nominal yang sudah diketik`);
      assert.ok(t.alasan.length > 0, `tab nav "${t.nama}" terkunci TANPA alasan tertulis`);
    }
  } finally {
    await hal.close();
  }
});

// ---------------------------------------------------------------------------
// PENJAGA 2 — pembulatan SATU SUMBER: K-06 hanya memakai `rencanaBayarKeranjang`
// ---------------------------------------------------------------------------
//
// ⛔ Diubah DENGAN SENGAJA atas keputusan user 28 September 2026 (issue #76,
// komentar 5862870577), dalam commit tersendiri. Bentuk lama ("K-06 tidak
// boleh memuat pembulatan") dihapus; yang tetap dijaga adalah INTI-nya —
// pembulatan FR-C9 punya SATU jalan hitung. Kembalian di K-06 boleh tampil,
// tetapi hanya dari rencana yang sama dengan `simpanPenjualan`.
//
// ⛔ Bentuk lama itu hampa (sabotase independen S14): ia memindai
// `Pembayaran.tsx` hanya sampai `if (selesai) {` (≈ baris 349), sedangkan
// badan K-06 ada SESUDAHNYA — aritmetika pembulatan kedua di sana lolos.
// Versi ini memindai SELURUH berkas, TANPA komentar (komentar boleh menyebut
// nama yang dilarang; kode tidak).

/** Isi berkas tanpa komentar blok dan baris — yang dipindai KODE, bukan penjelasannya. */
function tanpaKomentar(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

/** Semua berkas .ts/.tsx di bawah `dir`, rekursif. */
function berkasKode(dir) {
  const hasil = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) hasil.push(...berkasKode(p));
    else if (/\.(ts|tsx)$/.test(e.name)) hasil.push(p);
  }
  return hasil;
}

/** Badan fungsi `nama` (dari `{` sesudah `): ... {` pertama sampai kurung penutupnya). */
function badanFungsi(kode, nama) {
  const awal = kode.search(new RegExp(`function\\s+${nama}\\b`));
  if (awal < 0) return null;
  // `{` pembuka BADAN: yang pertama sesudah tanda kurung penutup daftar parameter,
  // dan tipe kembaliannya tidak memuat `{` (Promise<...> / HasilRencanaBayar).
  const kurung = kode.indexOf('(', awal);
  let d = 0;
  let i = kurung;
  for (; i < kode.length; i++) {
    if (kode[i] === '(') d++;
    else if (kode[i] === ')' && --d === 0) break;
  }
  const buka = kode.indexOf('{', i);
  let k = 0;
  for (let j = buka; j < kode.length; j++) {
    if (kode[j] === '{') k++;
    else if (kode[j] === '}' && --k === 0) return kode.slice(buka, j + 1);
  }
  return null;
}

test('⛔ P2: pembulatan satu sumber — K-06 hanya memakai rencanaBayarKeranjang', () => {
  const src = path.join(AKAR, 'apps/kasir/src');
  const k06 = tanpaKomentar(fs.readFileSync(path.join(src, 'layar/Pembayaran.tsx'), 'utf8'));

  // (1) SELURUH Pembayaran.tsx — K-06 dan K-07 — tanpa fungsi/masukan pembulatan.
  for (const dilarang of ['computeCashRounding', 'rencanakanPembayaran', 'roundingIncrement', 'rounding_increment']) {
    assert.ok(
      !k06.includes(dilarang),
      `Pembayaran.tsx memakai \`${dilarang}\` — pembulatan FR-C9 punya SATU jalan hitung, \`rencanaBayarKeranjang\` (keputusan user 28 Sep 2026)`
    );
  }
  assert.ok(
    /\brencanaBayarKeranjang\b/.test(k06),
    'Pembayaran.tsx tidak memanggil `rencanaBayarKeranjang` — dari mana kembalian K-06 datang?'
  );

  /* ⛔ Aritmetika pembulatan kedua yang TIDAK menyebut satu pun nama di atas
     (bentuk sabotase S14: `((total + 50n) / 100n) * 100n - total`). Layar tidak
     boleh MENGALIKAN/MEMBAGI/MODULO dengan literal bigint, dan tidak boleh
     MENDEKLARASIKAN ulang besaran rencana — ia hanya membacanya dari hasil. */
  const aritmetika = k06.match(/\b\d+n\s*[*/%]|[*/%]\s*\d+n\b/);
  assert.equal(
    aritmetika,
    null,
    `Pembayaran.tsx mengalikan/membagi dengan literal bigint (\`${aritmetika?.[0]}\`) — aritmetika pembulatan kedua`
  );
  /* Pengurangan antar-besaran (`diterima - total` — bentuk sabotase S1): kembalian
     adalah `rencana.kembalian`, tidak pernah selisih yang dihitung layar. Satu-
     satunya `-` berspasi yang sah di berkas ini adalah indeks (`daftar.length - 1`). */
  const selisih = k06.match(/\b(?!length\b)[A-Za-z_]\w*(?:\([^()]*\))?\s-\s*[\w(]/);
  assert.equal(
    selisih,
    null,
    `Pembayaran.tsx mengurangkan besaran (\`${selisih?.[0]}\`) — kembalian/tagihan datang dari rencanaBayarKeranjang, bukan selisih yang dihitung layar`
  );
  const salinan = k06.match(/\b(?:const|let|var)\s+(?:kembalian|tunaiDitagih|roundingAdjustment|amountDue|roundedOutstanding)\b/);
  assert.equal(
    salinan,
    null,
    `Pembayaran.tsx mendeklarasikan \`${salinan?.[0]}\` — besaran rencana harus DIBACA dari hasil rencanaBayarKeranjang, tidak dihitung ulang`
  );

  // (2) `rencanakanPembayaran` dipanggil TEPAT SEKALI di apps/kasir/src — di
  // dalam badan `rencanaBayarKeranjang`, di kasir/penjualan.ts.
  const pemanggil = [];
  for (const f of berkasKode(src)) {
    const kode = tanpaKomentar(fs.readFileSync(f, 'utf8'));
    const n = (kode.match(/\brencanakanPembayaran\s*\(/g) ?? []).length;
    for (let i = 0; i < n; i++) pemanggil.push(path.relative(src, f));
    if (path.relative(src, f) !== path.join('kasir', 'penjualan.ts')) {
      assert.ok(!/\brencanakanPembayaran\b/.test(kode), `${path.relative(src, f)} menyebut \`rencanakanPembayaran\` (impor/alias) — hanya kasir/penjualan.ts yang boleh`);
    }
  }
  assert.deepEqual(
    pemanggil,
    [path.join('kasir', 'penjualan.ts')],
    `rencanakanPembayaran( harus dipanggil TEPAT SEKALI di apps/kasir/src (di kasir/penjualan.ts); ditemukan: ${JSON.stringify(pemanggil)}`
  );
  const penjualan = tanpaKomentar(fs.readFileSync(path.join(src, 'kasir/penjualan.ts'), 'utf8'));
  const badanRencana = badanFungsi(penjualan, 'rencanaBayarKeranjang');
  assert.ok(badanRencana !== null, 'kasir/penjualan.ts tidak punya fungsi `rencanaBayarKeranjang`');
  assert.ok(
    /\brencanakanPembayaran\s*\(/.test(badanRencana),
    'pemanggil rencanakanPembayaran( ada, tetapi BUKAN di dalam badan `rencanaBayarKeranjang`'
  );

  // (3) `simpanPenjualan` memanggil fungsi yang sama dengan K-06.
  const badanSimpan = badanFungsi(penjualan, 'simpanPenjualan');
  assert.ok(badanSimpan !== null, 'kasir/penjualan.ts tidak punya fungsi `simpanPenjualan`');
  assert.ok(
    /\brencanaBayarKeranjang\s*\(/.test(badanSimpan),
    '`simpanPenjualan` tidak memanggil `rencanaBayarKeranjang` — jalur tulis dan K-06 tidak berbagi satu rencana'
  );
});

// ---------------------------------------------------------------------------
// PENJAGA 3 — kembalian di K-06 SAMA PERSIS dengan yang tersimpan
// ---------------------------------------------------------------------------
//
// ⛔ Diubah DENGAN SENGAJA (keputusan user 28 September 2026, #76): dari
// "kata Kembalian tidak pernah di K-06" menjadi "kembalian di K-06 sama
// persis dengan kembalian yang tersimpan sesudah simpan".
//
// ⛔ Bentuk lama hampa (S13b): ia hanya mencari KATA /Kembalian/i, jadi angka
// kembalian berlabel lain ("Uang kembali") lolos. Yang dibandingkan di sini
// ANGKA — K-06, K-07, dan `payment.change_amount` yang ditulis ke database —
// dan SETIAP nominal di layar K-06 harus dapat dijelaskan oleh nilai yang
// tersimpan, apa pun labelnya.

/** Semua nominal `Rp N` di sebuah teks, sebagai bigint. */
const semuaNominal = (s) => [...s.matchAll(/Rp\s?(\d[\d.]*)/g)].map((m) => BigInt(m[1].replace(/\./g, '')));

/** Penulisan yang dicatat db palsu: baris `payment` dan `order` yang disimpan `simpanPenjualan`. */
async function tersimpan(hal) {
  const tulis = await hal.evaluate(() => (window.__galeriTulis ?? []).map((t) => ({ sql: t.sql, params: t.params.map(String) })));
  const order = tulis.find((t) => /^INSERT INTO "order"/.test(t.sql));
  const payment = tulis.filter((t) => /^INSERT INTO payment/.test(t.sql));
  assert.ok(order, 'tidak ada INSERT INTO "order" — penjualan tidak tersimpan');
  // Urutan kolom = `simpanPenjualan`: order (…, tax_amount [11], rounding_adjustment [12], total [13], amount_due [14]),
  // payment (id, order_id, check_id, method [3], amount [4], tendered_amount [5], change_amount [6]).
  const tunai = payment.find((t) => t.params[3] === 'cash');
  assert.ok(tunai, 'tidak ada baris payment tunai yang tersimpan');
  return {
    subtotal: BigInt(order.params[9]),
    pajak: BigInt(order.params[11]),
    pembulatan: BigInt(order.params[12]),
    total: BigInt(order.params[13]),
    amountDue: BigInt(order.params[14]),
    nominalPayment: payment.map((t) => BigInt(t.params[4])),
    nonTunai: payment.filter((t) => t.params[3] !== 'cash').map((t) => BigInt(t.params[4])),
    tunaiDitagih: BigInt(tunai.params[4]),
    diterima: BigInt(tunai.params[5]),
    changeAmount: BigInt(tunai.params[6]),
  };
}

/** Angka kotak Kembalian di K-06 (teks), gagal dengan pesan yang menyebut kotaknya bila tidak ada. */
async function kembalianK06(hal) {
  const kotak = hal.locator('.kasir-kembalian .kasir-kembalian-nilai');
  assert.equal(await kotak.count(), 1, 'K-06 tidak merender kotak Kembalian (.kasir-kembalian) — kembalian hidup belum ada');
  return (await kotak.innerText()).trim();
}

async function tambahBagianTransfer(hal, nominal, referensi) {
  await bukaCampuran(hal);
  await tab(hal, 'Transfer').click();
  await bidang(hal, /Nomor referensi/).fill(referensi);
  await bidang(hal, /Nominal bagian ini/).fill(String(nominal));
  await hal.getByRole('button', { name: 'Tambah pembayaran lain' }).click();
}

/* Total fixture dipilih supaya SISA TUNAI bukan kelipatan increment:
   `harga=20050` × 1 baris + PPN 11% → ≈ 22.256; `harga=84285` → ≈ 93.556.
   Nominal non-tunai d/e (50.300, 30.300) dipilih supaya membulatkan TOTAL lebih dulu
   memberi tagihan tunai yang BERBEDA dari membulatkan SISA (increment 500: 43.500 vs
   43.000, 63.500 vs 63.000) — `uang-pembayaran-kas.md` § Pembayaran campuran. */
const KASUS_KEMBALIAN = [
  { nama: 'a: increment 100, tunai 100.000', kueri: 'render=k06&baris=1&harga=20050&pembulatan=100', diterima: '100.000' },
  { nama: 'b: increment 500, tunai 100.000', kueri: 'render=k06&baris=1&harga=20050&pembulatan=500', diterima: '100.000' },
  { nama: 'c: increment 1.000, pintasan 50.000', kueri: 'render=k06&baris=1&harga=20050&pembulatan=1000', pintasan: 'Rp 50.000' },
  { nama: 'd: increment 500, QRIS statis 50.300 + tunai 50.000', kueri: 'render=k06&baris=1&harga=84285&pembulatan=500', diterima: '50.000', siap: (hal) => tambahBagianQris(hal, 50300, 'REF-QRIS-8841') },
  { nama: 'e: increment 500, Transfer 30.300 + tunai 100.000', kueri: 'render=k06&baris=1&harga=84285&pembulatan=500', diterima: '100.000', siap: (hal) => tambahBagianTransfer(hal, 30300, 'TRF-77120') },
];

test('⛔ P3: kembalian di K-06 SAMA PERSIS dengan kembalian K-07 dan payment.change_amount tersimpan', async () => {
  assert.equal(KASUS_KEMBALIAN.length, 5, 'jumlah kasus P3 harus 5 (a–e)');
  for (const k of KASUS_KEMBALIAN) {
    const hal = await buka(k.kueri);
    try {
      if (k.siap) {
        await k.siap(hal);
        await tab(hal, 'Tunai').click();
      }
      if (k.pintasan) await hal.getByRole('button', { name: k.pintasan, exact: true }).click();
      else await hal.getByLabel('Nominal diterima').fill(k.diterima);

      // 1. K-06 — SEBELUM simpan.
      const teksK06 = await kembalianK06(hal);
      const isiK06 = await teks(hal);
      const nilaiK06 = bacaRupiah(teksK06);
      assert.ok(nilaiK06 !== null, `${k.nama}: kembalian K-06 tidak terbaca: "${teksK06}"`);

      // 2. Simpan, lalu K-07.
      await hal.getByRole('button', { name: 'Konfirmasi bayar' }).click();
      await hal.waitForSelector('.kasir-k07-kembalian', { timeout: 10_000 });
      const nilaiK07 = bacaRupiah(await hal.locator('.kasir-k07-kembalian .num').innerText());

      // 3. Yang tertulis ke database.
      const simpan = await tersimpan(hal);

      assert.notEqual(
        simpan.pembulatan,
        0n,
        `${k.nama}: pembulatan tersimpan 0 — pembulatan tidak terjadi: fixture tidak memakai increment (${k.kueri}) atau rencana membulatkan di tempat yang salah; penjaga ini tidak membuktikan apa pun`
      );
      /* ⛔ Oracle INDEPENDEN untuk aturan FR-C9 — satu-satunya tempat di berkas ini
         yang memakai fungsi domain: K-06 dan K-07 sama-sama dari rencana yang sama,
         jadi kesalahan DI DALAM rencana (membulatkan total, bukan sisa tunai) tidak
         terlihat oleh perbandingan K-06 vs tersimpan. Yang dibandingkan: tagihan tunai
         tersimpan = pembulatan atas `total − Σ non-tunai`. */
      const incr = BigInt(new URLSearchParams(k.kueri).get('pembulatan'));
      const sisaTunai = simpan.total - simpan.nonTunai.reduce((a, b) => a + b, 0n);
      const { computeCashRounding } = await import('../../packages/domain/src/money.ts');
      const seharusnya = computeCashRounding({ outstanding: sisaTunai, roundingIncrement: incr, roundingMode: 'half_up' }).roundedOutstanding;
      assert.equal(
        simpan.tunaiDitagih,
        seharusnya,
        `${k.nama}: tagihan tunai tersimpan ${simpan.tunaiDitagih}, seharusnya ${seharusnya} (pembulatan atas SISA tunai ${sisaTunai}, bukan atas total)`
      );
      assert.equal(
        nilaiK06,
        nilaiK07,
        `${k.nama}: kembalian K-06 ${nilaiK06} ≠ K-07 ${nilaiK07} — dua aritmetika`
      );
      assert.equal(
        nilaiK06,
        simpan.changeAmount,
        `${k.nama}: kembalian K-06 ${nilaiK06} ≠ payment.change_amount tersimpan ${simpan.changeAmount}`
      );

      /* ⛔ Bukan hanya kotak berlabel "Kembalian": SETIAP nominal di layar K-06
         harus dapat dijelaskan oleh nilai yang tersimpan. Angka kembalian atau
         tagihan tunai berlabel LAIN ("Uang kembali", "Tagihan tunai") yang
         datang dari aritmetika layar sendiri tidak ada di himpunan ini. */
      const sisa = simpan.total - simpan.nonTunai.reduce((a, b) => a + b, 0n);
      const dijelaskan = new Set([
        simpan.total, simpan.subtotal, simpan.pajak, simpan.amountDue, simpan.tunaiDitagih, simpan.diterima, simpan.changeAmount, sisa,
        20_000n, 50_000n, 100_000n, // pintasan tunai
        ...simpan.nominalPayment,
      ]);
      for (const n of semuaNominal(isiK06)) {
        assert.ok(
          dijelaskan.has(n),
          `${k.nama}: nominal Rp ${n} di K-06 TIDAK dijelaskan oleh nilai yang tersimpan (total ${simpan.total}, ditagih ${simpan.tunaiDitagih}, kembalian ${simpan.changeAmount}) — aritmetika kedua di layar`
        );
      }
    } finally {
      await hal.close();
    }
  }
});

// ---------------------------------------------------------------------------
// G-NOMINAL — "Nominal diterima": kosong/cacat → Rp —, aksi nonaktif DENGAN alasan, tidak pernah Rp 0
// ---------------------------------------------------------------------------

test('⛔ G-NOMINAL: kolom kosong / "25.5" / "abc" → Kembalian Rp —, Konfirmasi bayar nonaktif dengan alasan; tidak pernah Rp 0', async () => {
  const hal = await buka('render=k06&baris=2');
  const galatHalaman = [];
  hal.on('pageerror', (e) => galatHalaman.push(String(e)));
  try {
    for (const isi of ['', '25.5', 'abc']) {
      await hal.getByLabel('Nominal diterima').fill(isi);
      const label = `nominal diterima ${JSON.stringify(isi)}`;
      assert.deepEqual(galatHalaman, [], `${label}: halaman melempar (masukan cacat tidak ditutup bacaRupiah → null): ${galatHalaman.join(' | ')}`);
      const kembalian = await kembalianK06(hal);
      assert.equal(kembalian, 'Rp —', `${label}: kembalian "${kembalian}", bukan "Rp —" (nilai hilang, bukan nol)`);
      assert.ok(!/Rp\s0(?!\d)/.test(await teks(hal)), `${label}: "Rp 0" muncul di K-06 — kolom kosong/cacat terbaca sebagai nol`);

      const konfirmasi = hal.getByRole('button', { name: 'Konfirmasi bayar' });
      assert.equal(await konfirmasi.isDisabled(), true, `${label}: "Konfirmasi bayar" AKTIF`);
      const alasan = await alasanTombol(konfirmasi);
      assert.ok(alasan.length > 0, `${label}: "Konfirmasi bayar" nonaktif TANPA alasan tertulis (G-TOMBOL-HIDUP)`);
      /* Kolom kosong/cacat BUKAN "uang kurang": 0 yang lahir dari kolom kosong
         akan jatuh ke KURANG_BAYAR dan membawa kalimat itu. */
      assert.ok(!/kurang/i.test(alasan), `${label}: alasan "${alasan}" memperlakukan masukan hilang sebagai uang kurang`);
      /* Kosong → "Isi nominal"; cacat → "rupiah utuh". Alasan "harus lebih dari nol" berarti
         masukan hilang dibaca 0 (`?? 0`) — nol yang lahir dari kolom kosong/cacat. */
      assert.match(
        alasan,
        isi === '' ? /Isi nominal yang diterima/ : /rupiah utuh/,
        `${label}: alasan "${alasan}" — masukan hilang/cacat terbaca sebagai angka (mis. 0), bukan sebagai hilang`
      );
    }
    assert.deepEqual(galatHalaman, [], `masukan cacat membuat halaman melempar: ${galatHalaman.join(' | ')}`);
  } finally {
    await hal.close();
  }
});

test('⛔ G-NOMINAL: uang kurang → Kembalian Rp — dan alasan TANPA angka hitungan layar', async () => {
  const hal = await buka('render=k06&baris=2');
  try {
    await hal.getByLabel('Nominal diterima').fill('1.000');
    assert.equal(await kembalianK06(hal), 'Rp —', 'uang kurang: kembalian bukan "Rp —"');
    const konfirmasi = hal.getByRole('button', { name: 'Konfirmasi bayar' });
    assert.equal(await konfirmasi.isDisabled(), true, 'uang kurang: "Konfirmasi bayar" AKTIF');
    const alasan = await alasanTombol(konfirmasi);
    assert.match(alasan, /Uang diterima kurang dari tagihan tunai\./, `alasan uang kurang: "${alasan}"`);
    assert.ok(!/\d/.test(alasan), `alasan memuat angka hitungan layar: "${alasan}"`);

    // Tak satu pun nominal di layar adalah hasil hitungan layar (mis. kurangnya).
    const total = await nilaiTotalAtas(hal);
    const subtotal = 40_000n; // fixture harness: 2 baris × Rp 20.000
    const dijelaskan = new Set([total, subtotal, total - subtotal, 1_000n, 20_000n, 50_000n, 100_000n]);
    for (const n of semuaNominal(await teks(hal))) {
      assert.ok(dijelaskan.has(n), `nominal Rp ${n} di K-06 tidak dijelaskan (total ${total}) — kurang yang dihitung layar?`);
    }
  } finally {
    await hal.close();
  }
});

test('baris "Tagihan tunai dibulatkan menjadi" tampil HANYA bila pembulatan ≠ 0, nilainya = tunaiDitagih yang tersimpan', async () => {
  // (a) pembulatan ≠ 0: baris ada, nilainya = baris payment tunai yang tertulis.
  const a = await buka('render=k06&baris=1&harga=20050&pembulatan=500');
  try {
    await a.getByLabel('Nominal diterima').fill('100.000');
    const baris = a.locator('.kasir-kembalian .kasir-kembalian-tagihan');
    assert.equal(await baris.count(), 1, 'pembulatan ≠ 0 tetapi baris "Tagihan tunai dibulatkan menjadi" tidak ada');
    const isi = (await baris.innerText()).trim();
    assert.match(isi, /^Tagihan tunai dibulatkan menjadi Rp\s?[\d.]+$/, `bentuk kalimat: "${isi}"`);
    const tampil = bacaRupiah(isi.replace('Tagihan tunai dibulatkan menjadi', ''));
    await a.getByRole('button', { name: 'Konfirmasi bayar' }).click();
    await a.waitForSelector('.kasir-k07-kembalian', { timeout: 10_000 });
    const simpan = await tersimpan(a);
    assert.notEqual(simpan.pembulatan, 0n, 'fixture a: pembulatan tersimpan 0 — kasus tidak membuktikan apa pun');
    assert.equal(tampil, simpan.tunaiDitagih, `baris menyebut Rp ${tampil}, tersimpan ${simpan.tunaiDitagih}`);
  } finally {
    await a.close();
  }

  // (b) pembulatan = 0 (total 44.400, increment 100): baris TIDAK ada.
  const b = await buka('render=k06&baris=2');
  try {
    await b.getByLabel('Nominal diterima').fill('100.000');
    await kembalianK06(b); // kotak ada
    assert.equal(await b.locator('.kasir-kembalian-tagihan').count(), 0, 'pembulatan 0 tetapi baris tagihan dibulatkan tampil');
    assert.ok(!/dibulatkan menjadi/.test(await teks(b)), 'kalimat "dibulatkan menjadi" tampil padahal pembulatan 0');
    await b.getByRole('button', { name: 'Konfirmasi bayar' }).click();
    await b.waitForSelector('.kasir-k07-kembalian', { timeout: 10_000 });
    assert.equal((await tersimpan(b)).pembulatan, 0n, 'fixture b: pembulatan tersimpan ≠ 0 — kasus tidak membuktikan "tanpa baris"');
  } finally {
    await b.close();
  }
});

test('angka Kembalian terlihat PENUH di atas blok aksi pada 1024×768 (tidak tertutup, tidak perlu gulir)', async () => {
  const hal = await buka('render=k06&baris=2', { tinggi: 768 });
  try {
    await hal.getByLabel('Nominal diterima').fill('100.000');
    await kembalianK06(hal);
    const u = await hal.evaluate(() => {
      const nilai = document.querySelector('.kasir-kembalian .kasir-kembalian-nilai');
      const r = nilai.getBoundingClientRect();
      const aksi = document.querySelector('.kasir-bayar-aksi').getBoundingClientRect();
      const titik = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
      return { bawah: r.bottom, aksiAtas: aksi.top, terlihat: titik === nilai || nilai.contains(titik) };
    });
    assert.ok(u.bawah <= u.aksiAtas, `angka Kembalian berakhir di ${u.bawah}, blok aksi mulai ${u.aksiAtas} — tertutup`);
    assert.equal(u.terlihat, true, 'titik tengah angka Kembalian dijawab elemen lain (tertutup blok aksi?)');
  } finally {
    await hal.close();
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
  /* ⛔ Keputusan kampanye Hidupkan desain: QRIS dinamis kini sub-pilihan DI
     DALAM tab QRIS. Tab QRIS sendiri tidak boleh hilang saat offline — yang
     tetap terlihat, nonaktif, dan membawa alasannya adalah sub-pilihan
     dinamisnya. */
  const hal = await buka('render=k06&baris=2', { terjangkau: false });
  try {
    const nama = await metodeTerlihat(hal);
    assert.ok(nama.includes('QRIS'), `tab QRIS HILANG dari pemilih: ${JSON.stringify(nama)}`);
    await tab(hal, 'QRIS').click();

    const dinamis = hal.getByRole('button', { name: 'QRIS dinamis', exact: true });
    assert.equal(await dinamis.count(), 1, 'sub-pilihan QRIS dinamis HILANG dari tab QRIS saat tak terjangkau');
    assert.equal(await dinamis.isDisabled(), true, 'QRIS dinamis aktif padahal server tak terjangkau');
    assert.match(await alasanTombol(dinamis), /Perlu internet/, 'sub-pilihan QRIS dinamis mati TANPA aria-describedby ke kalimat alasannya — G-TOMBOL-HIDUP');

    const isi = await teks(hal);
    assert.match(isi, /Perlu internet/, 'sub-pilihan mati TANPA kalimat alasan');

    /* ⛔ Pembanding: saat terjangkau, kalimat itu HILANG dan sub-pilihannya
       hidup. Tanpa pembanding ini penjaga hijau juga pada layar yang SELALU
       menampilkan "Perlu internet" — bentuk kekosongan yang paling mudah
       lolos. */
    const hal2 = await buka('render=k06&baris=2', { terjangkau: true });
    try {
      await tab(hal2, 'QRIS').click();
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
    // Bagian 1 — QRIS statis, dengan referensi wajibnya. Pembayaran campuran
    // dibuka lewat tautan kecil di kartu (keputusan bawaan #4).
    await bukaCampuran(hal);
    await tab(hal, 'QRIS').click();
    await hal.getByRole('button', { name: 'QRIS statis', exact: true }).click();
    await bidang(hal, /Nominal bagian ini/).fill('10000');
    await bidang(hal, /Referensi pembayaran/).fill('10000-4321');
    await hal.getByRole('button', { name: 'Tambah pembayaran lain' }).click();

    // Bagian 2 — kartu EDC, dengan kode approval wajibnya.
    await tab(hal, 'Kartu').click();
    await bidang(hal, /Nominal bagian ini/).fill('5000');
    await bidang(hal, /Kode approval/).fill('APP123');
    await hal.getByRole('button', { name: 'Tambah pembayaran lain' }).click();

    /* ⛔ Daftar bagian ada DI DALAM kartu yang sama — bukan layar atau
       overlay lain (keputusan kampanye: kartu pembayaran bertoggle). */
    const baris = await hal.$$eval('.kasir-bayar .kasir-baris-daftar .kasir-subtotal', (n) =>
      n.map((e) => e.textContent.trim())
    );
    assert.equal(baris.length, 2, `daftar bagian tidak memuat dua baris di dalam kartu: ${JSON.stringify(baris)}`);

    /* Nama bagian dari `labelMetode` domain (G-LABEL), bukan peta lokal. */
    const isi = await teks(hal);
    assert.match(isi, /QRIS \(statis\)/, 'nama metode bagian pertama tidak dirender');
    assert.match(isi, /Kartu \/ EDC/, 'nama metode bagian kedua tidak dirender');
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
    await tab(hal, 'Tunai').click();

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

    /* ⛔ Galat tetap DI ATAS bilah aksi, di dalam blok aksi yang menempel
       (keputusan kampanye: kalimat yang muncul tidak boleh menggeser tombol
       ke arah yang berbeda dari tempat mata kasir sudah menunggu).

       ⛔ Galatnya dipancing dengan GAGAL SIMPAN (`__gagalTransaksi`), bukan
       lagi dengan uang kurang: sejak keputusan user 28 September 2026 (#76)
       K-06 menonaktifkan "Konfirmasi bayar" untuk uang kurang SEBELUM ditekan,
       jadi galat `Kurang Rp …` tidak lagi dapat terjadi dari ketukan. */
    await hal.getByLabel('Nominal diterima').fill('100.000');
    await hal.evaluate(() => {
      window.__gagalTransaksi = { masuk: 0 };
    });
    await hal.getByRole('button', { name: 'Konfirmasi bayar' }).click();
    await hal.waitForSelector('.kasir-bayar-aksi [role="alert"]', { timeout: 10_000 });
    const galat = await kotak(hal, '.kasir-bayar-aksi [role="alert"]');
    const bilah = await kotak(hal, '.kasir-bayar-baris');
    const aksiGalat = await kotak(hal, '.kasir-bayar-aksi');
    assert.ok(galat.bottom <= bilah.top, `galat (bawah ${galat.bottom}) tidak di atas bilah aksi (atas ${bilah.top})`);
    assert.equal(aksiGalat.bottom, pendek.bottom, `tepi bawah blok aksi bergeser saat galat tampil: ${pendek.bottom} → ${aksiGalat.bottom}`);
  } finally {
    await hal.close();
  }
});

// ---------------------------------------------------------------------------
// PENJAGA 9 — TOTAL tampil, dan ia angka yang jalur pembayaran pakai
// ---------------------------------------------------------------------------

test('⛔ P9: Total tampil di blok ATAS kartu 32/700, dan nilainya total yang jalur pembayaran hitung', async () => {
  /* K-06 menampilkan "Subtotal" dan "Sisa tagihan" dan TIDAK PERNAH
     menampilkan Total — kasir menagih angka ketiga yang tidak ada di manapun
     di hadapannya. Keputusan kampanye Hidupkan desain: Total pindah ke blok
     atas kartu ("TOTAL BELANJA", nilai 32/700), seperti mockup.

     ⛔ Yang dijaga bukan keberadaan kata "Total", melainkan bahwa angkanya
     angka yang SAMA yang jalur pembayaran pakai. Baris Total yang dihitung
     ulang di layar akan lolos pemeriksaan keberadaan dan salah tepat pada
     pajak inklusif. */
  const hal = await buka('render=k06&baris=2');
  try {
    const total = await nilaiTotalAtas(hal);
    assert.notEqual(total, null, 'blok Total tidak dirender di atas kartu K-06');

    const gaya = await hal.$eval('.kasir-bayar-total .num', (e) => `${getComputedStyle(e).fontSize}/${getComputedStyle(e).fontWeight}`);
    assert.equal(gaya, '32px/700', `nilai Total ${gaya} — skala 32/20/15/13, mockup 32/700`);
    const label = await hal.$eval('.kasir-bayar-total', (e) => e.innerText);
    assert.match(label, /TOTAL BELANJA/, `label blok Total: ${label}`);

    // Letaknya di ATAS: di atas deretan tab dan di atas blok aksi.
    const atas = await hal.evaluate((sel) => ({
      total: document.querySelector('.kasir-bayar-total').getBoundingClientRect().bottom,
      tab: document.querySelector(sel).getBoundingClientRect().top,
      aksi: document.querySelector('.kasir-bayar-aksi').getBoundingClientRect().top,
    }), TAB);
    assert.ok(atas.total <= atas.tab, `blok Total (bawah ${atas.total}) tidak di atas tab metode (atas ${atas.tab})`);
    assert.ok(atas.total <= atas.aksi, `blok Total tidak di atas blok aksi`);
    // Dan TIDAK lagi di blok aksi.
    assert.equal(await hal.locator('.kasir-bayar-aksi .kasir-total').count(), 0, 'baris Total masih ada di blok aksi — dua tempat yang memutuskan angka yang ditagih');

    /* ⛔ Ikatan ke jalur pembayaran, dan ia yang membuat penjaga ini bukan
       sekadar pemeriksaan teks. `sisaTagihan(total, [])` adalah `total` itu
       sendiri, dan `sisa` dihitung dari state `total` yang `bayar()` pakai —
       state yang BERBEDA dari `hitungan` yang merender blok Total. Keduanya
       sama hanya bila keduanya benar-benar berasal dari `hitungKeranjang`. */
    const sisaAwal = await nilaiBaris(hal, 'Sisa tagihan');
    assert.equal(
      sisaAwal,
      total,
      `tanpa satu pun bagian, Sisa tagihan (${sisaAwal}) harus sama dengan Total (${total})`
    );

    /* ⛔ Subtotal BERBEDA dari Total, dan ini yang menolak "Total" yang
       diam-diam merender subtotal. Fixture galeri memakai PPN 11% eksklusif
       (`tax-ppn`), jadi keduanya tidak mungkin sama. */
    const subtotal = await hal.$eval('.kasir-bayar-isi', (e) => {
      const p = [...e.querySelectorAll('p')].find((x) => x.textContent.startsWith('Subtotal'));
      return p?.querySelector('.num')?.textContent.trim() ?? '';
    });
    const nilaiSubtotal = bacaRupiah(subtotal);
    assert.notEqual(nilaiSubtotal, null, 'baris Subtotal hilang dari isi K-06');
    assert.notEqual(
      total,
      nilaiSubtotal,
      `Total (${total}) sama persis dengan Subtotal (${nilaiSubtotal}) — pajak tidak masuk hitungan`
    );

    /* ⛔ Baris pajak memakai NAMA TARIF, bukan kata "Pajak" (`spec-c:404`).
       Layar yang menyebutnya berbeda dari struk membuat kasir yang mencocokkan
       keduanya menyimpulkan salah satunya salah. */
    const labelPajak = await hal.$$eval('.kasir-bayar-aksi .kasir-subtotal', (n) =>
      n.map((e) => e.firstElementChild?.textContent.trim() ?? '')
    );
    assert.ok(
      labelPajak.includes('PPN 11%'),
      `baris pajak tidak memakai nama tarif: ${JSON.stringify(labelPajak)}`
    );
    assert.ok(
      !labelPajak.includes('Pajak'),
      `baris pajak memakai kata generik "Pajak", yang \`spec-c:404\` larang: ${JSON.stringify(labelPajak)}`
    );

    /* ⛔ Dan Total tetap Total saat bagian masuk: yang berkurang SISA, bukan
       Total. Total yang ikut menyusut adalah total yang dihitung dari sisa —
       arah kebergantungan yang terbalik, dan struk yang menyebut angka lebih
       kecil daripada yang pelanggan bayar. */
    await tambahBagianQris(hal, 10000, '10000-4321');
    const totalSesudah = await nilaiTotalAtas(hal);
    const sisaSesudah = await nilaiBaris(hal, 'Sisa tagihan');
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
// PENJAGA BARU — Task 8, kartu pembayaran bertoggle (kampanye Hidupkan desain)
// ---------------------------------------------------------------------------

/** Catatan penulisan db palsu harness (`__galeriTulis`), disaring per SQL. */
const tulisan = (hal, pola) =>
  hal.evaluate(
    (src) => (window.__galeriTulis ?? []).filter((t) => new RegExp(src, 'i').test(t.sql)).map((t) => ({ sql: t.sql, params: t.params.map(String) })),
    pola.source
  );

/** Teks alasan yang dirujuk `aria-describedby` tombol. */
const alasanTombol = (tombol) =>
  tombol.evaluate((e) => {
    const id = e.getAttribute('aria-describedby');
    return id ? (document.getElementById(id)?.textContent.trim() ?? '') : '';
  });

test('⛔ Transfer: tanpa referensi "Konfirmasi bayar" menolak dengan pesan periksaTransfer; tab HILANG saat pembayaran_transfer mati', async () => {
  const hal = await buka('render=k06&baris=2');
  try {
    await tab(hal, 'Transfer').click();
    assert.equal(await hal.getByLabel('Bank tujuan').count(), 1, 'field "Bank tujuan" tidak dirender di tab Transfer');
    assert.equal(await hal.getByLabel('Nomor referensi').count(), 1, 'field "Nomor referensi" tidak dirender di tab Transfer');

    const konfirmasi = hal.getByRole('button', { name: 'Konfirmasi bayar' });
    // Referensi kosong: menolak, dengan kalimat `periksaTransfer` (satu sumber).
    assert.equal(await konfirmasi.isDisabled(), true, 'Konfirmasi bayar AKTIF tanpa referensi transfer');
    assert.match(await alasanTombol(konfirmasi), /Nomor referensi transfer wajib/, 'alasan bukan kalimat periksaTransfer');

    // ⛔ Nomor kartu di referensi — juga berpemisah spasi — ditolak.
    await hal.getByLabel('Nomor referensi').fill('4111 1111 1111 1111');
    assert.equal(await konfirmasi.isDisabled(), true, 'nomor kartu di referensi diterima');
    assert.match(await alasanTombol(konfirmasi), /nomor kartu/i);

    // ⛔ Review Focus 2: nomor kartu di field BANK, bukan hanya di referensi.
    await hal.getByLabel('Nomor referensi').fill('TRF-0001');
    await hal.getByLabel('Bank tujuan').fill('4111-1111-1111-1111');
    assert.equal(await konfirmasi.isDisabled(), true, 'nomor kartu di field Bank tujuan diterima');
    assert.match(await alasanTombol(konfirmasi), /nomor kartu/i);

    // Sah: referensi + bank biasa → tersimpan sebagai other/bank_transfer, tanpa cash_movement.
    await hal.getByLabel('Bank tujuan').fill('BCA');
    assert.equal(await konfirmasi.isDisabled(), false, 'Konfirmasi bayar tetap mati padahal transfer sah');
    await konfirmasi.click();
    await hal.waitForSelector('text=Transaksi selesai', { timeout: 10_000 });
    const bayar = await tulisan(hal, /INSERT INTO payment/);
    assert.equal(bayar.length, 1, `baris payment: ${bayar.length}`);
    assert.ok(bayar[0].params.includes('other') && bayar[0].params.includes('bank_transfer'), `payment bukan other/bank_transfer: ${JSON.stringify(bayar[0].params)}`);
    assert.equal((await tulisan(hal, /INSERT INTO cash_movement/)).length, 0, 'Transfer menulis cash_movement — uang bank tidak pernah masuk laci');
  } finally {
    await hal.close();
  }

  // Kill switch: pembayaran_transfer mati → tab HILANG (bukan nonaktif).
  const mati = await buka('render=k06&baris=2&matikan=pembayaran_transfer');
  try {
    assert.deepEqual(await metodeTerlihat(mati), ['Tunai', 'QRIS', 'Kartu'], 'tab Transfer masih ada padahal pembayaran_transfer mati');
  } finally {
    await mati.close();
  }
});

test('⛔ pintasan MENETAPKAN, tidak menambah: Rp 50.000 lalu Rp 20.000 → kolom berisi 20.000', async () => {
  const hal = await buka('render=k06&baris=2');
  try {
    const kolom = hal.getByLabel('Nominal diterima');
    await hal.getByRole('button', { name: 'Rp 50.000', exact: true }).click();
    assert.equal(await kolom.inputValue(), '50.000', 'pintasan Rp 50.000 tidak menulis 50.000');
    await hal.getByRole('button', { name: 'Rp 20.000', exact: true }).click();
    assert.equal(await kolom.inputValue(), '20.000', `pintasan MENAMBAH, bukan menetapkan: kolom berisi ${await kolom.inputValue()}`);
    await hal.getByRole('button', { name: 'Rp 100.000', exact: true }).click();
    assert.equal(await kolom.inputValue(), '100.000');
  } finally {
    await hal.close();
  }
});

test('⛔ tiga pintasan persis mockup: Rp 20.000 · Rp 50.000 · Rp 100.000, tampil 44 px dengan area >= 56 (.sentuh-uang)', async () => {
  const hal = await buka('render=k06&baris=2');
  try {
    const pintasan = await hal.$$eval('.kasir-bayar-metode .sentuh-uang', (n) =>
      n.map((e) => {
        const r = e.getBoundingClientRect();
        return { nama: e.textContent.trim(), tinggi: Math.round(r.height), x: r.left + r.width / 2, y: r.top + r.height / 2 };
      })
    );
    assert.deepEqual(pintasan.map((p) => p.nama), ['Rp 20.000', 'Rp 50.000', 'Rp 100.000'], `pintasan tunai: ${JSON.stringify(pintasan.map((p) => p.nama))}`);
    for (const p of pintasan) assert.equal(p.tinggi, 44, `pintasan "${p.nama}" tampil ${p.tinggi} px — mockup 44`);
    // Area TEKAN >= 56: titik 27 px di atas/bawah pusat masih dijawab tombolnya sendiri.
    for (const p of pintasan) {
      for (const dy of [-27, 27]) {
        const jawab = await hal.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('button')?.textContent.trim() ?? null, [p.x, p.y + dy]);
        assert.equal(jawab, p.nama, `titik ${dy} px dari pusat "${p.nama}" dijawab "${jawab}" — area tekan < 56`);
      }
    }
  } finally {
    await hal.close();
  }
});

test('⛔ kolom Nominal diterima kosong → Konfirmasi bayar nonaktif dengan alasan, tidak pernah menyimpan tendered 0', async () => {
  const hal = await buka('render=k06&baris=2');
  try {
    const kolom = hal.getByLabel('Nominal diterima');
    const konfirmasi = hal.getByRole('button', { name: 'Konfirmasi bayar' });
    // Keadaan awal (kosong) DAN sesudah diisi lalu dikosongkan (Review Focus 4).
    assert.equal(await konfirmasi.isDisabled(), true, 'Konfirmasi bayar aktif dengan kolom kosong');
    assert.match(await alasanTombol(konfirmasi), /Isi nominal yang diterima/, 'tombol mati TANPA alasan tertulis');
    await kolom.fill('50.000');
    assert.equal(await konfirmasi.isDisabled(), false, 'Konfirmasi bayar mati padahal nominal sah');
    await kolom.fill('');
    assert.equal(await konfirmasi.isDisabled(), true, 'Konfirmasi bayar aktif sesudah kolom dikosongkan');
    assert.match(await alasanTombol(konfirmasi), /Isi nominal yang diterima/);
    // Klik buatan melewati `disabled`: tidak ada penjualan yang ditulis.
    await konfirmasi.evaluate((e) => e.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await hal.waitForTimeout(300);
    assert.equal((await tulisan(hal, /INSERT INTO payment/)).length, 0, 'kolom kosong menulis baris payment (tendered 0?)');
    assert.ok(!(await teks(hal)).includes('Transaksi selesai'), 'penjualan selesai dengan kolom nominal kosong');
  } finally {
    await hal.close();
  }
});

test('⛔ header tetap terlihat selama K-06 (halaman di dalam shell, bukan overlay)', async () => {
  const hal = await buka('render=k06&baris=2');
  try {
    const u = await hal.evaluate(() => {
      const kartu = document.querySelector('.kasir-bayar');
      const header = document.querySelector('.kasir-header');
      return {
        header: header ? Math.round(header.getBoundingClientRect().height) : null,
        diKonten: kartu?.closest('.kasir-konten') !== null,
        diOverlay: kartu?.closest('.overlay') !== null,
      };
    });
    assert.equal(u.header, 68, `header tidak terlihat/68 px selama K-06: ${u.header}`);
    /* Ketiadaan grid K-03 TIDAK diperiksa di sini: harness ini tidak pernah me-mount `Kasir`,
       jadi hitungannya selalu 0 (benar sendiri). Ia diukur `k06-tata-letak` di galeri,
       setelah `.kasir-grid > *` terbukti ada di K-03. */
    assert.equal(u.diKonten, true, 'kartu K-06 tidak berada di dalam .kasir-konten');
    assert.equal(u.diOverlay, false, 'kartu K-06 masih dirender di dalam overlay');
  } finally {
    await hal.close();
  }
});

test('⛔ tab nav terkunci selama penjualan disimpan, terbuka lagi sesudahnya', async () => {
  const hal = await buka('render=k06&baris=2');
  try {
    const nav = () =>
      hal.$$eval('[aria-label="Navigasi kasir"] [role="tab"]', (n) =>
        n.map((e) => ({ terkunci: e.getAttribute('aria-disabled') === 'true', alasan: document.getElementById(e.getAttribute('aria-describedby') ?? '')?.textContent.trim() ?? '' }))
      );
    assert.ok((await nav()).every((t) => !t.terkunci), 'tab nav terkunci SEBELUM menyimpan');
    // Tahan transaksi: jendela "sedang menyimpan" menjadi terlihat tanpa berpacu timer.
    await hal.evaluate(() => {
      const g = {};
      g.promise = new Promise((r) => (g.lepas = r));
      window.__tahanTransaksi = g;
    });
    await hal.getByLabel('Nominal diterima').fill('600.000');
    await hal.getByRole('button', { name: 'Konfirmasi bayar' }).click();
    await hal.waitForFunction(() => document.querySelector('[aria-label="Navigasi kasir"] [role="tab"]')?.getAttribute('aria-disabled') === 'true', null, { timeout: 5000 }).catch(() => undefined);
    const selamaSimpan = await nav();
    assert.ok(selamaSimpan.length >= 4 && selamaSimpan.every((t) => t.terkunci), `tab nav TIDAK terkunci selama penjualan disimpan: ${JSON.stringify(selamaSimpan)}`);
    assert.ok(selamaSimpan.every((t) => t.alasan.length > 0), 'tab nav terkunci tanpa alasan tertulis');
    // Kolom dan tautan campuran ikut terkunci selama menyimpan (fix round 1).
    assert.equal(await hal.getByLabel('Nominal diterima').isDisabled(), true, 'Nominal diterima masih dapat diubah selama menyimpan');
    assert.equal(await hal.getByRole('button', { name: 'Bayar dengan lebih dari satu metode' }).isDisabled(), true, 'tautan campuran aktif selama menyimpan');
    await hal.evaluate(() => window.__tahanTransaksi.lepas());
    await hal.waitForSelector('text=Transaksi selesai', { timeout: 10_000 });
    const sesudah = await nav();
    assert.ok(sesudah.every((t) => !t.terkunci), `tab nav tetap terkunci sesudah penjualan selesai: ${JSON.stringify(sesudah)}`);
  } finally {
    await hal.close();
  }
});

test('⛔ ketukan ganda "Konfirmasi bayar" menyimpan SATU penjualan (Review Focus 1)', async () => {
  const hal = await buka('render=k06&baris=2');
  try {
    await hal.getByLabel('Nominal diterima').fill('600.000');
    // Tahan transaksi supaya ketukan kedua jatuh SELAGI yang pertama berjalan.
    await hal.evaluate(() => {
      const g = {};
      g.promise = new Promise((r) => (g.lepas = r));
      window.__tahanTransaksi = g;
    });
    await hal.evaluate(() => {
      const b = [...document.querySelectorAll('.kasir-bayar-aksi .btn-primary')][0];
      b.click();
      b.click();
      // Bahkan klik buatan yang melewati `disabled`.
      b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await hal.evaluate(() => window.__tahanTransaksi.lepas());
    await hal.waitForSelector('text=Transaksi selesai', { timeout: 10_000 });
    await hal.waitForTimeout(300);
    const order = await tulisan(hal, /INSERT INTO "order"/);
    const bayar = await tulisan(hal, /INSERT INTO payment/);
    assert.equal(order.length, 1, `ketukan ganda menyimpan ${order.length} baris order`);
    assert.equal(bayar.length, 1, `ketukan ganda menyimpan ${bayar.length} baris payment`);
  } finally {
    await hal.close();
  }
});

test('⛔ qris_static dan card_edc di jalur TAMPILAN: label bagian di K-06 (campuran), payment.method tersimpan (campuran DAN metode tunggal), dan K-07 tercapai', async () => {
  // Fixture #3 `uang-pembayaran-kas.md`: teruji di jalur DATA, belum di TAMPILAN.
  // K-07 sendiri tidak memuat nama metode (hanya kembalian dan nomor struk), jadi
  // yang diukur di K-07 adalah tercapainya layar itu, bukan sebuah label.
  const kasus = [
    {
      nama: 'QRIS (statis)',
      isi: async (hal) => {
        await tab(hal, 'QRIS').click();
        await hal.getByRole('button', { name: 'QRIS statis', exact: true }).click();
        await bidang(hal, /Referensi pembayaran/).fill('44400-4321');
      },
      metode: 'qris_static',
    },
    {
      nama: 'Kartu / EDC',
      isi: async (hal) => {
        await tab(hal, 'Kartu').click();
        await bidang(hal, /Kode approval/).fill('APP123');
      },
      metode: 'card_edc',
    },
  ];
  for (const k of kasus) {
    for (const campuran of [true, false]) {
      const hal = await buka('render=k06&baris=2');
      try {
        if (campuran) await bukaCampuran(hal);
        await k.isi(hal);
        if (campuran) {
          // Label bagian dari `labelMetode` domain, di daftar bagian kartu.
          await hal.getByRole('button', { name: 'Tambah pembayaran lain' }).click();
          const daftar = await hal.$$eval('.kasir-bayar .kasir-baris-daftar .kasir-subtotal', (n) => n.map((e) => e.textContent.trim()));
          assert.ok(daftar.some((t) => t.includes(k.nama)), `bagian ${k.metode} tidak berlabel "${k.nama}": ${JSON.stringify(daftar)}`);
        }
        await hal.getByRole('button', { name: 'Konfirmasi bayar' }).click();
        await hal.waitForSelector('text=Transaksi selesai', { timeout: 10_000 });
        const bayar = await tulisan(hal, /INSERT INTO payment/);
        const jalur = campuran ? 'campuran' : 'metode tunggal';
        assert.equal(bayar.length, 1, `${k.metode} (${jalur}) menulis ${bayar.length} baris payment`);
        assert.ok(bayar[0].params.includes(k.metode), `${k.metode} (${jalur}) tidak sampai ke baris payment: ${JSON.stringify(bayar[0]?.params)}`);
      } finally {
        await hal.close();
      }
    }
  }
});

test('⛔ P1b: selama penjualan disimpan setiap jalan keluar header (tab, indikator sinkron, menu pengguna: Status, Perangkat, Keluar) TIDAK menavigasi; terbuka kembali sesudahnya', async () => {
  /* Fix round 1 Task 8: kunci yang hanya menutup tab nav meninggalkan jalan
     keluar lain — yang meninggalkan K-06 menghapus nominal yang sudah diketik,
     dan Keluar mengakhiri sesi di tengah pembayaran. Klik buatan melewati
     atribut aria-disabled. */
  const hal = await buka('render=k06&baris=2');
  try {
    const lokasi = () => hal.evaluate(() => window.location.pathname);
    const awal = await lokasi();
    await hal.evaluate(() => {
      const g = {};
      g.promise = new Promise((r) => (g.lepas = r));
      window.__tahanTransaksi = g;
    });
    await hal.getByLabel('Nominal diterima').fill('600.000');
    await hal.getByRole('button', { name: 'Konfirmasi bayar' }).click();
    await hal.waitForFunction(() => document.querySelector('[aria-label="Navigasi kasir"] [role="tab"]')?.getAttribute('aria-disabled') === 'true', null, { timeout: 5000 });

    const klik = (sel, nama) =>
      hal.evaluate(([s, n]) => {
        const el = [...document.querySelectorAll(s)].find((e) => !n || e.textContent.trim().includes(n));
        if (!el) return false;
        el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return true;
      }, [sel, nama]);

    assert.equal(await klik('[aria-label="Navigasi kasir"] [role="tab"]', 'Riwayat'), true, 'tab nav Riwayat tidak ada');
    assert.equal(await klik('.kasir-indikator'), true, 'indikator sinkron tidak ada');
    await hal.evaluate(() => document.querySelector('.kasir-menu-pengguna button')?.click());
    assert.equal(await klik('[role="menuitem"]', 'Status sinkronisasi'), true, 'menu: Status sinkronisasi tidak ada');
    await hal.evaluate(() => document.querySelector('.kasir-menu-pengguna button')?.click());
    assert.equal(await klik('[role="menuitem"]', 'Perangkat'), true, 'menu: Perangkat tidak ada');
    await hal.evaluate(() => document.querySelector('.kasir-menu-pengguna button')?.click());
    assert.equal(await klik('[role="menuitem"]', 'Keluar'), true, 'menu: Keluar tidak ada');
    await hal.waitForTimeout(400);
    assert.equal(await lokasi(), awal, `jalan keluar header MENAVIGASI selagi menyimpan: ${awal} → ${await lokasi()}`);
    assert.equal(await hal.locator('[data-keluar="selesai"]').count(), 0, 'Keluar berjalan selagi penjualan disimpan — sesi berakhir di tengah pembayaran');

    // Terbuka kembali: jalan keluar yang sama berfungsi (kunci tidak membekukan navigasi).
    await hal.evaluate(() => window.__tahanTransaksi.lepas());
    await hal.waitForSelector('text=Transaksi selesai', { timeout: 10_000 });
    assert.equal(await klik('.kasir-indikator'), true);
    await hal.waitForFunction(() => window.location.pathname === '/sync', null, { timeout: 5000 }).catch(() => undefined);
    assert.equal(await lokasi(), '/sync', 'indikator sinkron tidak menavigasi sesudah kunci dilepas');
  } finally {
    await hal.close();
  }
});

// ---------------------------------------------------------------------------
// PENJAGA TAMBAHAN — fix round 2 Task 8 (sabotase independen Opus: S1b, S12b, S3, S4, S6c)
// ---------------------------------------------------------------------------

/** Menahan SETIAP transaksi db palsu sampai `lepas()` dipanggil (lihat harness k06). */
const pasangTahan = (hal) =>
  hal.evaluate(() => {
    const g = { masuk: 0 };
    g.promise = new Promise((r) => (g.lepas = r));
    window.__tahanTransaksi = g;
  });

/** Menunggu hingga satu render + efek pasifnya selesai (tanpa menebak waktu). */
const tungguRender = (hal) =>
  hal.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 0)))));

test('⛔ selama penjualan DISIMPAN, klik buatan pada tab METODE tidak mengganti metode, dan setiap tab metode ber-aria-disabled="true"', async () => {
  /* Sabotase independen S1b/S12b: guard handler yang hanya memeriksa panel QRIS, dan
     `terkunci={false}` pada jalur biasa, sama-sama lolos — penjaga lama hanya menguji
     tab METODE saat QRIS menunggu dan tab NAV saat menyimpan. Mengganti metode saat
     menyimpan mengubah bagian yang sedang ditulis. */
  const hal = await buka('render=k06&baris=2');
  try {
    await pasangTahan(hal);
    await hal.getByLabel('Nominal diterima').fill('600.000');
    await hal.getByRole('button', { name: 'Konfirmasi bayar' }).click();
    await hal.waitForSelector('.kasir-bayar-aksi .btn-primary:has-text("Menyimpan…")', { timeout: 5000 });

    const status = await hal.$$eval(TAB, (n) => n.map((e) => ({ nama: e.textContent.trim(), diKunci: e.getAttribute('aria-disabled') })));
    assert.equal(status.length, 4, `tab metode tidak dirender selama menyimpan: ${JSON.stringify(status)}`);
    for (const t of status) {
      assert.equal(t.diKunci, 'true', `tab metode "${t.nama}" TIDAK aria-disabled="true" selama penjualan disimpan: ${t.diKunci}`);
    }

    const terpilih = () =>
      hal.$$eval(TAB, (n) => n.filter((e) => e.getAttribute('aria-selected') === 'true').map((e) => e.textContent.trim()));
    assert.deepEqual(await terpilih(), ['Tunai'], 'metode awal bukan Tunai');
    await hal.evaluate(
      (sel) =>
        new Promise((r) => {
          document.querySelectorAll(sel).forEach((e) => e.dispatchEvent(new MouseEvent('click', { bubbles: true })));
          requestAnimationFrame(() => requestAnimationFrame(r));
        }),
      TAB
    );
    assert.deepEqual(await terpilih(), ['Tunai'], 'klik buatan pada tab METODE selama penjualan disimpan MENGGANTI metode aktif');

    await hal.evaluate(() => window.__tahanTransaksi.lepas());
    await hal.waitForSelector('text=Transaksi selesai', { timeout: 10_000 });
  } finally {
    await hal.close();
  }
});

/** Rute server palsu untuk jalur QRIS dinamis: order dan payment dijawab, QR terbit. */
const RUTE_QRIS = {
  '**/orders': { id: 'ord-uji' },
  '**/orders/*/payments': { qrString: '00020101021226590014ID.CO.QRIS.UJI' },
};

test('⛔ ketukan ganda "Tampilkan kode QR" mencadangkan SATU nomor struk dan memesan SATU order di gateway', async () => {
  /* Sabotase independen S3: `mulaiQris` tanpa penjaga sinkron lolos — dua nomor struk
     terbakar dan dua QR terbit di gateway untuk satu pelanggan. */
  const hal = await buka('render=k06&baris=2', { rute: RUTE_QRIS });
  try {
    let postOrder = 0;
    hal.on('request', (r) => {
      if (r.method() === 'POST' && /\/orders$/.test(new URL(r.url()).pathname)) postOrder += 1;
    });
    await tab(hal, 'QRIS').click();
    await hal.evaluate(() => {
      const b = [...document.querySelectorAll('.kasir-bayar-aksi .btn-primary')].find((e) => e.textContent.trim() === 'Tampilkan kode QR');
      b.click();
      b.click();
      b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await hal.waitForSelector('text=Pindai untuk membayar', { timeout: 10_000 });
    await hal.waitForLoadState('networkidle');
    const nomor = await tulisan(hal, /UPDATE device_config SET receipt_sequence/);
    assert.equal(nomor.length, 1, `ketukan ganda mencadangkan ${nomor.length} nomor struk (satu pelanggan, satu nomor)`);
    assert.equal(postOrder, 1, `ketukan ganda memesan ${postOrder} order di gateway — dua QR untuk satu pelanggan`);
  } finally {
    await hal.close();
  }
});

test('⛔ onSelesai("lunas") yang terpanggil dua kali menulis SATU penjualan (INSERT INTO "order" tepat sekali)', async () => {
  /* Sabotase independen S4: `PanelQris` memanggil `onSelesai` dari efek yang bergantung pada
     identitas `onSelesai` — prop inline yang berganti SETIAP render. Begitu `selesaikanQris`
     menyetel `menyimpan`, render ulang memicu efeknya lagi; hanya penjaga sinkron di
     `selesaikanQris` yang mencegah penjualan QRIS ditulis dua kali. Jalur ini organik:
     tidak ada panggilan buatan, hanya gateway yang menjawab `confirmed`. */
  const hal = await buka('render=k06&baris=2', { rute: RUTE_QRIS });
  try {
    // Galat halaman dikumpulkan: layar yang melempar saat gateway menjawab `confirmed` tampak
    // seperti "tidak terjadi apa-apa" (halaman kosong), bukan seperti penjualan yang hilang.
    const galatHalaman = [];
    hal.on('pageerror', (e) => galatHalaman.push(e.message));
    let lepasStatus;
    const gerbang = new Promise((r) => (lepasStatus = r));
    await hal.route('**/payments/*/check-status', async (r) => {
      await gerbang;
      await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'confirmed' }) });
    });
    await tab(hal, 'QRIS').click();
    await hal.getByRole('button', { name: 'Tampilkan kode QR' }).click();
    await hal.waitForSelector('text=Pindai untuk membayar', { timeout: 10_000 });

    await pasangTahan(hal);
    lepasStatus();
    // Penjualan pertama sudah tiba di gerbang transaksi; beri render + efek pasif satu putaran
    // penuh supaya efek PanelQris sempat memanggil `onSelesai` kedua kalinya.
    await hal.waitForFunction(() => (window.__tahanTransaksi?.masuk ?? 0) >= 1, null, { timeout: 5000 }).catch(() => undefined);
    assert.deepEqual(galatHalaman, [], `halaman melempar saat gateway mengonfirmasi lunas — penjualan QRIS yang sudah dibayar pelanggan TIDAK ditulis: ${galatHalaman.join(' | ')}`);
    assert.ok((await hal.evaluate(() => window.__tahanTransaksi.masuk ?? 0)) >= 1, 'konfirmasi lunas dari gateway tidak pernah memulai penulisan penjualan');
    await tungguRender(hal);
    await hal.evaluate(() => window.__tahanTransaksi.lepas());
    await hal.waitForSelector('text=Transaksi selesai', { timeout: 10_000 });
    await hal.waitForLoadState('networkidle');
    const order = await tulisan(hal, /INSERT INTO "order"/);
    assert.equal(order.length, 1, `onSelesai('lunas') ganda menulis ${order.length} baris order — penjualan QRIS tercatat dua kali`);
  } finally {
    await hal.close();
  }
});

test('⛔ K-06 dilepas selagi terkunci (menyimpan) MELEPAS kunci nav — kunci modul-global tidak boleh tertinggal', async () => {
  /* Sabotase independen S6c: tanpa pelepasan saat unmount (sesi berakhir, rute berganti di
     tengah simpan) kunci tertinggal dan seluruh jalan keluar header mati selamanya. */
  const hal = await buka('render=k06&baris=2');
  try {
    await pasangTahan(hal);
    await hal.getByLabel('Nominal diterima').fill('600.000');
    await hal.getByRole('button', { name: 'Konfirmasi bayar' }).click();
    await hal.waitForFunction(() => window.__kunciNav() !== null, null, { timeout: 5000 });
    assert.notEqual(await hal.evaluate(() => window.__kunciNav()), null, 'prasyarat: kunci terpasang selama menyimpan');
    await hal.evaluate(() => window.__bongkarK06());
    const sisa = await hal.evaluate(() => window.__kunciNav());
    assert.equal(sisa, null, `kunci nav TERTINGGAL sesudah K-06 dilepas: "${sisa}" — seluruh jalan keluar header terkunci tanpa pemilik`);
  } finally {
    await hal.close();
  }
});

// ---------------------------------------------------------------------------
// PENJAGA — fix round 2 Task 8 (tinjauan ulang: siklus simpan ulang di jalur lunas QRIS, "Cek status")
// ---------------------------------------------------------------------------

/** Membuka K-06, memunculkan panel QRIS dinamis, dan menyerahkan kendali jawaban `check-status`. */
async function bukaPanelQris() {
  const hal = await buka('render=k06&baris=2', { rute: RUTE_QRIS });
  const galatHalaman = [];
  hal.on('pageerror', (e) => galatHalaman.push(e.message));
  const gateway = { jawab: 'pending_confirmation', permintaan: 0 };
  await hal.route('**/payments/*/check-status', async (r) => {
    gateway.permintaan += 1;
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: gateway.jawab }) });
  });
  await tab(hal, 'QRIS').click();
  await hal.getByRole('button', { name: 'Tampilkan kode QR' }).click();
  await hal.waitForSelector('text=Pindai untuk membayar', { timeout: 10_000 });
  return { hal, gateway, galatHalaman };
}

const tungguBeberapaRender = async (hal, n = 8) => {
  for (let i = 0; i < n; i += 1) await tungguRender(hal);
};

test('⛔ gagal simpan di jalur lunas QRIS: SATU percobaan (bukan siklus), pesan jujur, dan "Cek status" dapat mengulang secara sadar', async () => {
  /* Tinjauan ulang Opus: sesudah perbaikan TDZ jalur ini hidup. Bila simpan gagal panel tetap
     `confirmed`; `finally` melepas kunci, induk render ulang, `onSelesai` inline berganti
     identitas dan efek PanelQris menembak lagi — simpan diulang tanpa batas. */
  const { hal, gateway, galatHalaman } = await bukaPanelQris();
  try {
    await hal.evaluate(() => {
      window.__gagalTransaksi = { masuk: 0 };
    });
    gateway.jawab = 'confirmed';
    // Poll berikutnya (jeda 2 dtk) atau Cek status membawa `confirmed`; tekan Cek status agar cepat.
    await hal.getByRole('button', { name: 'Cek status' }).click();
    await hal.waitForFunction(() => (window.__gagalTransaksi?.masuk ?? 0) >= 1, null, { timeout: 5000 });
    await tungguBeberapaRender(hal);
    assert.deepEqual(galatHalaman, [], `halaman melempar: ${galatHalaman.join(' | ')}`);
    const percobaan = await hal.evaluate(() => window.__gagalTransaksi.masuk);
    assert.equal(percobaan, 1, `gagal simpan diulang ${percobaan}× tanpa campur tangan kasir — siklus simpan ulang`);
    const isi = await teks(hal);
    assert.match(isi, /Penjualan TIDAK tersimpan/, 'layar tidak mengatakan penjualan belum tersimpan');
    assert.match(isi, /lunas di server/, 'layar tidak mengatakan pembayaran SUDAH lunas di server');
    assert.ok(!isi.includes('Transaksi selesai'), 'layar mengaku selesai padahal simpan gagal');

    // Ulang SADAR: simpan pulih, kasir menekan Cek status → tepat satu penjualan.
    await hal.evaluate(() => {
      window.__gagalTransaksi = undefined;
    });
    await hal.getByRole('button', { name: 'Cek status' }).click();
    await hal.waitForSelector('text=Transaksi selesai', { timeout: 10_000 });
    assert.equal((await tulisan(hal, /INSERT INTO "order"/)).length, 1, 'ulang manual tidak menulis tepat SATU baris order');
  } finally {
    await hal.close();
  }
});

test('⛔ bersihkanDraf gagal SESUDAH penjualan tertulis: layar tidak berkata "TIDAK tersimpan"; baris order tepat satu', async () => {
  const { hal, gateway, galatHalaman } = await bukaPanelQris();
  try {
    await hal.evaluate(() => {
      window.__gagalSql = 'DELETE FROM draf_qris_lokal';
    });
    gateway.jawab = 'confirmed';
    await hal.getByRole('button', { name: 'Cek status' }).click();
    await hal.waitForFunction(() => document.body.innerText.includes('Transaksi selesai') || document.body.innerText.includes('TIDAK tersimpan'), null, { timeout: 10_000 });
    await tungguBeberapaRender(hal);
    const isi = await teks(hal);
    assert.deepEqual(galatHalaman, [], `halaman melempar: ${galatHalaman.join(' | ')}`);
    assert.ok(!isi.includes('TIDAK tersimpan'), 'layar berkata penjualan TIDAK tersimpan padahal baris order sudah tertulis (hanya pembersihan draf yang gagal)');
    assert.ok(isi.includes('Transaksi selesai'), 'K-07 tidak tercapai sesudah penjualan tertulis');
    assert.equal((await tulisan(hal, /INSERT INTO "order"/)).length, 1, 'baris order tidak tepat satu');
  } finally {
    await hal.close();
  }
});

test('⛔ "Cek status" yang dijawab gateway `confirmed` menyimpan SATU penjualan (jalur spec-c:291 "pelanggan sudah bayar, POS tidak tahu")', async () => {
  /* Tombol ini satu-satunya jalan kasir menolong dirinya sendiri sesudah timeout atau tab
     tertutup. Jawaban `confirmed` HANYA datang sekali (permintaan pertama sesudah dipersenjatai),
     jadi polling berkala tidak dapat menutupi handler yang membuang hasilnya. */
  const { hal, galatHalaman } = await bukaPanelQris();
  try {
    let sisa = 1;
    await hal.unroute('**/payments/*/check-status');
    await hal.route('**/payments/*/check-status', async (r) => {
      const status = sisa > 0 ? 'confirmed' : 'pending_confirmation';
      sisa -= 1;
      await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status }) });
    });
    sisa = 1;
    await hal.getByRole('button', { name: 'Cek status' }).click();
    await hal.waitForSelector('text=Transaksi selesai', { timeout: 1500 }).catch(() => undefined);
    assert.deepEqual(galatHalaman, [], `halaman melempar: ${galatHalaman.join(' | ')}`);
    assert.ok((await teks(hal)).includes('Transaksi selesai'), '"Cek status" dijawab confirmed tetapi penjualan tidak ditulis — hasilnya dibuang');
    assert.equal((await tulisan(hal, /INSERT INTO "order"/)).length, 1, 'Cek status menulis bukan tepat SATU baris order');
  } finally {
    await hal.close();
  }
});
