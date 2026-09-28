'use strict';

// G-EDIT (Task 6, kampanye "Hidupkan desain"): keranjang tanpa stepper dan
// layar Edit Item. Spec kasir § 6, § 11 G-EDIT, § 14 R6 — `+` melewati
// pemeriksaan stok FR-E4/E5, yang stepper lama tidak lakukan.
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
  /* ⛔ MENEGASKAN, bukan membangun. Lihat `k03-chrome.test.js`. */
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


/**
 * `?editItem=1` — fixture Edit Item (`OpsiDbPalsu.editItem`, `db-palsu.ts`),
 * tanpa menambah keadaan galeri baru. Empat baris keranjang bervariation NYATA
 * di katalog: Americano Hot (stok 3, dua baris masing-masing qty 1: polos dan Extra shot), Cappuccino (ditandai HABIS, qty
 * 2), Kopi Susu Gula Aren (Extra shot, qty 1) dan kembarannya tanpa
 * modifier (qty 1); stok TIDAK boleh negatif.
 */
async function bukaK03(opsi = {}) {
  const { editItem = false } = opsi;
  const hal = await peramban.newPage({ viewport: { width: 1280, height: 800 } });
  const galat = [];
  hal.on('pageerror', (e) => galat.push(e.message));
  hal.on('console', (m) => {
    if (m.type() === 'error') galat.push(m.text());
  });
  const q = new URLSearchParams({ layar: 'K-03', keadaan: 'keranjang-penuh' });
  if (editItem) q.set('editItem', '1');
  await hal.goto(`${alamat}/harness-galeri.html?${q.toString()}`, { waitUntil: 'load' });
  await hal.waitForSelector('.kasir-baris', { timeout: 10_000 });
  return { hal, galat };
}

const DIALOG = '[role="dialog"][aria-label="Edit item"]';

/** Sentuh baris yang memuat `nama`, tunggu dialog (kondisi, bukan jeda). */
async function bukaEdit(hal, nama) {
  await hal.locator('.kasir-baris-tekan', { hasText: nama }).first().click();
  await hal.waitForSelector(DIALOG, { timeout: 5000 });
}

/** Teks `role=alert` di dialog, atau `null` bila tidak muncul dalam 2 dtk —
    penolakan yang tidak terjadi harus GAGAL dengan pesan tentang penolakan,
    bukan dengan timeout `innerText` yang tidak menyebut apa pun. */
const alertDialog = (hal) =>
  hal
    .waitForSelector(`${DIALOG} [role="alert"]`, { timeout: 2000 })
    .then((e) => e.innerText())
    .catch(() => null);
const qtyDraf = (hal) => hal.locator(`${DIALOG} [data-uji="edit-qty"]`).innerText();
const tulisKeranjang = (hal) =>
  hal.evaluate(() =>
    (window.__galeriTulis ?? [])
      .filter((t) => /INSERT INTO keranjang_lokal/.test(t.sql))
      .map((t) => JSON.parse(String(t.params[2])))
  );
/** Berapa kali `setelKeranjang` dipanggil (pencatat di `Galeri.tsx`). */
const jumlahSet = (hal) => hal.evaluate(() => window.__galeriKeranjangSet);
const jumlahTulis = async (hal) => (await tulisKeranjang(hal)).length;
/** Tunggu sampai penulisan pemulihan keranjang (KEP-21) berhenti — kondisi
    (tiga cuplikan berturut-turut sama), bukan jeda tetap. Baseline penghitung
    tulis yang diambil sebelum itu dapat kemasukan tulis pemulihan. */
async function baselineTulis(hal) {
  let n = await jumlahTulis(hal);
  let sama = 0;
  while (sama < 3) {
    await hal.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const m = await jumlahTulis(hal);
    sama = m === n ? sama + 1 : 0;
    n = m;
  }
  return n;
}
const barisTeks = (hal) => hal.locator('.kasir-baris-tekan').allInnerTexts();

// ---------------------------------------------------------------------------

test('⛔ menyentuh baris membuka Edit Item; tidak ada .stepper dan tidak ada tombol hapus di baris', async () => {
  const { hal, galat } = await bukaK03();
  const baris = await hal.evaluate(() => ({
    stepper: document.querySelectorAll('.kasir-keranjang .stepper').length,
    baris: document.querySelectorAll('.kasir-baris').length,
    tombolPerBaris: [...document.querySelectorAll('.kasir-baris')].map((li) => li.querySelectorAll('button').length),
    hapusDiBaris: [...document.querySelectorAll('.kasir-baris button')].filter((b) =>
      /hapus|remove|delete/i.test(`${b.innerText} ${b.getAttribute('aria-label') ?? ''}`)
    ).length,
  }));
  assert.ok(baris.baris >= 3, 'fixture keranjang-penuh tanpa baris — penjaga hampa');
  assert.equal(baris.stepper, 0, `${baris.stepper} .stepper di keranjang — keranjang tanpa stepper (spec § 6)`);
  assert.deepEqual(baris.tombolPerBaris.filter((n) => n !== 1), [], 'setiap baris harus punya TEPAT satu tombol (yang membuka Edit Item)');
  assert.equal(baris.hapusDiBaris, 0, 'ada tombol hapus di baris keranjang — penghapusan hanya lewat Edit Item');

  await bukaEdit(hal, 'Item Keranjang 1');
  const dlg = await hal.evaluate((sel) => {
    const d = document.querySelector(sel);
    return { judul: d.querySelector('h2')?.textContent, teks: d.innerText, lebar: Math.round(d.querySelector('.kasir-dialog').getBoundingClientRect().width) };
  }, DIALOG);
  await hal.close();
  assert.equal(galat.length, 0, `galat konsol: ${galat.join(' | ')}`);
  assert.equal(dlg.judul, 'Edit item');
  assert.match(dlg.teks, /Item Keranjang 1/, 'Edit Item tidak menyebut item yang disentuh');
  assert.equal(dlg.lebar, 512, `Edit Item ${dlg.lebar} px — spec § 6: dialog 512 px`);
});

test('⛔ + melewati stok ditolak dengan kalimat FR-E4, qty draf tidak naik', async () => {
  const { hal } = await bukaK03({ editItem: true });
  const tulis0 = await baselineTulis(hal);
  await bukaEdit(hal, 'Americano');
  await hal.getByRole('button', { name: /^Tambah Americano/ }).click();
  assert.equal(await qtyDraf(hal), '2', '+ pertama (stok 3; baris ini 1 → 2, baris lain 1: kumulatif 3) harus diizinkan');
  await hal.getByRole('button', { name: /^Tambah Americano/ }).click();
  const alert = await alertDialog(hal);
  assert.equal(
    alert,
    'Americano tersisa 3. Tidak dapat menambah lagi.',
    '+ melewati stok KUMULATIF (draf 3 + baris lain 1 = 4 > stok 3) tetapi kalimat FR-E4 berangka tidak muncul'
  );
  assert.equal(await qtyDraf(hal), '2', 'qty draf naik melewati stok kumulatif (draf 3 + baris lain 1 > 3) — pemeriksaan FR-E4 dilewati');
  // Ditolak ≠ menulis: keranjang belum disentuh, Simpan belum ditekan.
  assert.equal(await jumlahTulis(hal), tulis0, 'penolakan stok menulis keranjang');
  await hal.close();
});

test('⛔ variation ditandai habis: + ditolak kalimat habis, − tetap bekerja', async () => {
  const { hal } = await bukaK03({ editItem: true });
  await bukaEdit(hal, 'Cappuccino');
  assert.equal(await qtyDraf(hal), '2');
  await hal.getByRole('button', { name: /^Tambah Cappuccino/ }).click();
  assert.equal(
    await alertDialog(hal),
    'Cappuccino ditandai habis. Manajer dapat membuka kembali penandaannya.',
    '+ pada variation ditandai habis tidak menampilkan kalimat habis (FR-E5)'
  );
  assert.equal(await qtyDraf(hal), '2', 'qty draf naik pada variation ditandai habis');
  // Mengurangi tidak pernah diperiksa: kasir harus dapat menyusutkan pesanan habis.
  await hal.getByRole('button', { name: /^Kurangi Cappuccino/ }).click();
  assert.equal(await qtyDraf(hal), '1', '− diblokir pada variation habis — kasir tidak dapat menyusutkan pesanan');
  await hal.close();
});

test('⛔ − di qty 1 → draf 0, tombol utama "Hapus dari keranjang" (danger), menekannya menghapus baris', async () => {
  const { hal } = await bukaK03({ editItem: true });
  const sebelum = (await barisTeks(hal)).length;
  const americano0 = (await barisTeks(hal)).filter((t) => t.includes('Americano')).length;
  await bukaEdit(hal, 'Americano');
  assert.equal(await hal.getByRole('button', { name: 'Simpan', exact: true }).count(), 1);
  await hal.getByRole('button', { name: /^Hapus Americano/ }).click();
  assert.equal(await qtyDraf(hal), '0');
  assert.equal(await hal.getByRole('button', { name: 'Simpan', exact: true }).count(), 0, 'draf 0 tetap menawarkan Simpan');
  const utama = hal.locator(`${DIALOG} button`, { hasText: 'Hapus dari keranjang' });
  assert.equal(await utama.count(), 1, 'draf 0: tombol utama "Hapus dari keranjang" tidak ada');
  assert.match(await utama.getAttribute('class'), /btn-danger/, 'tombol "Hapus dari keranjang" bukan varian danger');
  // Draf 0 belum menyentuh keranjang.
  assert.equal((await barisTeks(hal)).length, sebelum, 'draf 0 sudah menghapus baris sebelum tombol utama ditekan');
  await utama.click();
  await hal.waitForFunction(() => !document.querySelector('[role="dialog"][aria-label="Edit item"]'));
  const sesudah = await barisTeks(hal);
  assert.equal(sesudah.length, sebelum - 1, 'menekan "Hapus dari keranjang" tidak menghapus barisnya');
  assert.equal(sesudah.filter((t) => t.includes('Americano')).length, americano0 - 1, 'baris Americano yang dihapus masih ada (atau baris kembarnya ikut terhapus)');
  await hal.close();
});

test('⛔ tidak ada tombol berlabel "Hapus item" di mana pun', async () => {
  const { hal } = await bukaK03({ editItem: true });
  const cari = () =>
    hal.evaluate(
      () =>
        [...document.querySelectorAll('button')].filter((b) =>
          /hapus item/i.test(`${b.innerText} ${b.getAttribute('aria-label') ?? ''}`)
        ).length
    );
  assert.equal(await cari(), 0, 'tombol "Hapus item" di keranjang');
  await bukaEdit(hal, 'Americano');
  assert.equal(await cari(), 0, 'tombol "Hapus item" di Edit Item (qty 1)');
  await hal.getByRole('button', { name: /^Hapus Americano/ }).click();
  assert.equal(await cari(), 0, 'tombol "Hapus item" di Edit Item (draf 0)');
  await hal.close();
});

test('Batal tidak mengubah keranjang; Simpan menerapkan qty + modifier dalam satu tulis', async () => {
  const { hal } = await bukaK03({ editItem: true });
  const awal = await barisTeks(hal);
  const tulisAwal = await baselineTulis(hal);
  const setAwal = await jumlahSet(hal);

  // Batal (dan tombol tutup) sesudah mengubah draf: tidak ada perubahan, tidak ada tulis.
  await bukaEdit(hal, 'Kopi Susu Gula Aren');
  await hal.getByRole('button', { name: /^Tambah Kopi Susu/ }).click();
  await hal.locator(`${DIALOG}`).getByLabel(/Susu oat/).check();
  await hal.getByRole('button', { name: 'Batal', exact: true }).click();
  await hal.waitForFunction(() => !document.querySelector('[role="dialog"][aria-label="Edit item"]'));
  assert.deepEqual(await barisTeks(hal), awal, 'Batal mengubah keranjang');
  await bukaEdit(hal, 'Kopi Susu Gula Aren');
  await hal.getByRole('button', { name: /^Tambah Kopi Susu/ }).click();
  await hal.locator(DIALOG).getByRole('button', { name: 'Tutup', exact: true }).click();
  await hal.waitForFunction(() => !document.querySelector('[role="dialog"][aria-label="Edit item"]'));
  assert.deepEqual(await barisTeks(hal), awal, 'tombol tutup mengubah keranjang');
  assert.equal(await jumlahTulis(hal), tulisAwal, 'Batal/tutup menulis keranjang_lokal');
  assert.equal(await jumlahSet(hal), setAwal, 'Batal/tutup memanggil setelKeranjang');

  // Simpan: qty 1 → 2 DAN Susu oat ditambahkan, dalam SATU tulis.
  await bukaEdit(hal, 'Kopi Susu Gula Aren');
  await hal.getByRole('button', { name: /^Tambah Kopi Susu/ }).click();
  await hal.locator(`${DIALOG}`).getByLabel(/Susu oat/).check();
  const set0 = await jumlahSet(hal);
  await hal.getByRole('button', { name: 'Simpan', exact: true }).click();
  await hal.waitForFunction(() => !document.querySelector('[role="dialog"][aria-label="Edit item"]'));
  await hal.waitForFunction((n) => (window.__galeriTulis ?? []).filter((t) => /INSERT INTO keranjang_lokal/.test(t.sql)).length > n, tulisAwal);
  const tulis = await tulisKeranjang(hal);
  assert.equal(
    (await jumlahSet(hal)) - set0,
    1,
    'Simpan memanggil setelKeranjang lebih dari SEKALI (qty lalu modifier?) — harus satu hasil akhir. ' +
      'Dua kali di satu ketukan tetap menghasilkan satu tulis (React menggabung), jadi hanya penghitung ini yang membuktikannya'
  );
  assert.equal(tulis.length - tulisAwal, 1, `Simpan menulis keranjang_lokal ${tulis.length - tulisAwal} kali — harus SATU (qty + modifier bersama)`);
  const baris = tulis[tulis.length - 1].baris.find((b) => b.id === 'edit-modifier');
  assert.equal(baris.quantityMilli, 2000, 'qty tersimpan bukan 2000');
  assert.deepEqual(baris.modifier.map((m) => m.id).sort(), ['m-oat', 'm-shot'], 'modifier tersimpan salah');
  const teks = (await barisTeks(hal)).find((t) => t.includes('Kopi Susu Gula Aren'));
  assert.match(teks, /2×/, 'lencana qty tidak menjadi 2× (tanda kali, CLAUDE.md § format)');
  assert.match(teks, /Susu oat/, 'modifier baru tidak tampil di baris');
  await hal.close();
});

test('⛔ harga per item memakai satuanKeranjang (modifier ikut) dan subtotal baris = satuan × qty / 1000', async () => {
  const { hal } = await bukaK03({ editItem: true });
  // Fixture: Kopi Susu Gula Aren 24.000 + Extra shot 5.000 = 29.000 per item.
  const angka = (t) => BigInt(t.replace(/[^0-9]/g, ''));
  const SATUAN = 24000n + 5000n;
  const baris = (await barisTeks(hal)).find((t) => t.includes('Kopi Susu Gula Aren'));
  assert.match(baris, /Rp\s?29\.000 per item/, `baris keranjang tidak memakai satuan + modifier (Rp 29.000): ${baris}`);
  assert.ok(!/Rp\s?24\.000 per item/.test(baris), 'baris keranjang memakai unitPrice tanpa modifier');

  await bukaEdit(hal, 'Kopi Susu Gula Aren');
  const baca = async () => ({
    satuan: angka(await hal.locator(`${DIALOG} [data-uji="edit-satuan"]`).innerText()),
    subtotal: angka(await hal.locator(`${DIALOG} [data-uji="edit-subtotal"]`).innerText()),
  });
  let a = await baca();
  assert.equal(a.satuan, SATUAN, 'harga per item di Edit Item tidak memuat modifier');
  assert.equal(a.subtotal, SATUAN * 1n);
  await hal.getByRole('button', { name: /^Tambah Kopi Susu/ }).click();
  await hal.getByRole('button', { name: /^Tambah Kopi Susu/ }).click();
  a = await baca();
  assert.equal(await qtyDraf(hal), '3');
  assert.equal(a.subtotal, (SATUAN * 3000n) / 1000n, `subtotal ${a.subtotal} != satuan × qty / 1000`);
  // Modifier draf ikut: Susu oat +6.000 → satuan 35.000, subtotal 105.000.
  await hal.locator(DIALOG).getByLabel(/Susu oat/).check();
  a = await baca();
  assert.equal(a.satuan, SATUAN + 6000n, 'satuan tidak mengikuti modifier draf');
  assert.equal(a.subtotal, ((SATUAN + 6000n) * 3000n) / 1000n);
  await hal.close();
});

test('⛔ Edit Item tidak punya field harga, diskon, atau catatan', async () => {
  const { hal } = await bukaK03({ editItem: true });
  await bukaEdit(hal, 'Kopi Susu Gula Aren');
  const isi = await hal.evaluate((sel) => {
    const d = document.querySelector(sel);
    return {
      teks: d.querySelectorAll('input[type="text"], input[type="number"], input:not([type]), textarea').length,
      label: d.innerText,
    };
  }, DIALOG);
  await hal.close();
  assert.equal(isi.teks, 0, 'Edit Item punya kolom teks/angka bebas (harga sementara? catatan?) — spec § 6 menolaknya');
  assert.ok(!/diskon|catatan/i.test(isi.label), `Edit Item menyebut diskon/catatan: ${isi.label}`);
});

test('scanner global mati selama Edit Item terbuka', async () => {
  const { hal } = await bukaK03({ editItem: true });
  const scan = async (kode) => {
    for (const c of kode) await hal.keyboard.type(c, { delay: 1 });
    await hal.keyboard.press('Enter');
  };
  const jumlah = () => hal.locator('.kasir-baris').count();
  const awal = await jumlah();
  await bukaEdit(hal, 'Americano');
  // Barcode fixture Kopi Tubruk ORIGEN — dikenal; bila scanner hidup, baris bertambah di BELAKANG dialog.
  await hal.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await scan('8992761111017');
  await hal.getByRole('button', { name: 'Batal', exact: true }).click();
  await hal.waitForFunction(() => !document.querySelector('[role="dialog"][aria-label="Edit item"]'));
  assert.equal(await jumlah(), awal, 'scan saat Edit Item terbuka menambah baris di belakang dialog');
  // Kontrol: sesudah dialog ditutup, scan yang SAMA bekerja (penjaga tidak hampa).
  await hal.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await scan('8992761111017');
  await hal.waitForFunction((n) => document.querySelectorAll('.kasir-baris').length > n, awal, { timeout: 5000 }).catch(() => {});
  assert.equal(await jumlah(), awal + 1, 'kontrol: scan tidak menambah baris bahkan sesudah dialog ditutup — penjaga hampa');
  await hal.close();
});

test('⛔ melepas modifier hingga menyamai baris lain MENGGABUNG di layar, qty draf ikut dijumlah', async () => {
  const { hal } = await bukaK03({ editItem: true });
  const sebelum = (await barisTeks(hal)).filter((t) => t.includes('Kopi Susu Gula Aren'));
  assert.equal(sebelum.length, 2, 'fixture: harus ada baris bermodifier DAN kembarannya — penjaga hampa');
  await bukaEdit(hal, /Kopi Susu Gula Aren[\s\S]*Extra shot/);
  await hal.getByRole('button', { name: /^Tambah Kopi Susu/ }).click(); // qty draf 2
  await hal.locator(DIALOG).getByLabel(/Extra shot/).uncheck();
  await hal.getByRole('button', { name: 'Simpan', exact: true }).click();
  await hal.waitForFunction(() => !document.querySelector('[role="dialog"][aria-label="Edit item"]'));
  const sesudah = (await barisTeks(hal)).filter((t) => t.includes('Kopi Susu Gula Aren'));
  assert.equal(sesudah.length, 1, 'dua baris identik tidak digabung — struk berbohong, refund per baris ambigu');
  assert.match(sesudah[0], /3×/, `qty gabungan bukan 3 (draf 2 + kembaran 1): ${sesudah[0]}`);
  assert.ok(!/Extra shot/.test(sesudah[0]), 'modifier yang dilepas masih tampil');
  await hal.close();
});

test('⛔ + dihitung KUMULATIF lintas baris: baris lain variation yang sama ikut terhitung (FR-E4)', async () => {
  const { hal } = await bukaK03({ editItem: true });
  // Fixture: Americano Hot stok 3 terbagi dua baris (1 + 1). Baris polos naik 1 → 2 masih
  // muat per baris (2 ≤ 3) DAN kumulatif (3 ≤ 3). Naik lagi: per baris 3 ≤ 3 (muat), kumulatif 4 > 3 (tidak).
  const americano = (await barisTeks(hal)).filter((t) => t.includes('Americano'));
  assert.equal(americano.length, 2, 'fixture: harus ada DUA baris Americano — penjaga hampa');
  await bukaEdit(hal, 'Americano');
  await hal.getByRole('button', { name: /^Tambah Americano/ }).click();
  assert.equal(await qtyDraf(hal), '2');
  await hal.getByRole('button', { name: /^Tambah Americano/ }).click();
  const pesan = await alertDialog(hal);
  assert.equal(
    pesan,
    'Americano tersisa 3. Tidak dapat menambah lagi.',
    'stok kumulatif lintas baris tidak dihitung: + diterima padahal jumlah SEMUA baris Americano (draf 3 + baris lain 1) melewati stok 3 — pemeriksaan per baris meloloskan oversell'
  );
  assert.equal(await qtyDraf(hal), '2', 'qty draf naik melewati stok kumulatif');
  await hal.close();
});
