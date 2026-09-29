'use strict';

// G-KURANG-AUDIT, sisi layar (Task 5C, kampanye "Hidupkan desain"). Edit Item
// yang MENURUNKAN qty atau menghapus baris meninggalkan `audit_event`
// `cart_line_reduced` + outbox, dalam SATU transaksi lokal — keputusan user
// 28 September 2026 (issue #76, Q2). Kenaikan qty dan perubahan modifier
// tanpa penurunan tidak dicatat.
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


/** `?editItem=1` — fixture Edit Item (lihat `edit-item.test.js`). */
async function bukaK03(opsi = {}) {
  const hal = await peramban.newPage({ viewport: { width: 1280, height: 800 } });
  const galat = [];
  hal.on('pageerror', (e) => galat.push(e.message));
  hal.on('console', (m) => {
    if (m.type() === 'error') galat.push(m.text());
  });
  const q = new URLSearchParams({ layar: 'K-03', keadaan: 'keranjang-penuh', editItem: '1' });
  if (opsi.negatif) q.set('negatif', '1');
  await hal.goto(`${alamat}/harness-galeri.html?${q.toString()}`, { waitUntil: 'load' });
  await hal.waitForSelector('.kasir-baris', { timeout: 10_000 });
  return { hal, galat };
}

const DIALOG = '[role="dialog"][aria-label="Edit item"]';

async function bukaEdit(hal, nama) {
  await hal.locator('.kasir-baris-tekan', { hasText: nama }).first().click();
  await hal.waitForSelector(DIALOG, { timeout: 5000 });
}

const barisTeks = (hal) => hal.locator('.kasir-baris-tekan').allInnerTexts();
const qtyDraf = (hal) => hal.locator(`${DIALOG} [data-uji="edit-qty"]`).innerText();
const bacaTulis = (hal) =>
  hal.evaluate(() => (window.__galeriTulis ?? []).map((t) => ({ sql: t.sql, params: t.params.map(String), dalam: t.dalam })));
const audit = (tulis) => tulis.filter((t) => /INSERT INTO audit_event/.test(t.sql));
const outbox = (tulis) => tulis.filter((t) => /INSERT INTO outbox_local/.test(t.sql));
const jumlahSet = (hal) => hal.evaluate(() => window.__galeriKeranjangSet);
const angka = (t) => BigInt(t.replace(/[^0-9]/g, ''));

/** Tunggu penulisan pemulihan keranjang (KEP-21) berhenti — kondisi, bukan jeda. */
async function tenang(hal) {
  let n = (await bacaTulis(hal)).length;
  let sama = 0;
  while (sama < 3) {
    await hal.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const m = (await bacaTulis(hal)).length;
    sama = m === n ? sama + 1 : 0;
    n = m;
  }
}

async function tutupSetelahSimpan(hal) {
  await hal.waitForFunction(() => !document.querySelector('[role="dialog"][aria-label="Edit item"]'), null, { timeout: 5000 });
}

// ---------------------------------------------------------------------------

test('⛔ qty turun (2 → 1) lalu Simpan: SATU audit_event cart_line_reduced, aktor staf sesi, harga = satuan di dialog, nilai = satuan × selisih / 1000', async () => {
  const { hal, galat } = await bukaK03();
  await tenang(hal);
  const tulis0 = (await bacaTulis(hal)).length;
  const set0 = await jumlahSet(hal);
  await bukaEdit(hal, 'Cappuccino');
  const satuan = angka(await hal.locator(`${DIALOG} [data-uji="edit-satuan"]`).innerText());
  assert.equal(await qtyDraf(hal), '2', 'fixture: Cappuccino harus qty 2 — penjaga hampa');
  await hal.getByRole('button', { name: /^Kurangi Cappuccino/ }).click();
  assert.equal(await qtyDraf(hal), '1');
  // Belum Simpan: belum ada jejak.
  assert.equal(audit((await bacaTulis(hal)).slice(tulis0)).length, 0, 'jejak tertulis SEBELUM Simpan');
  await hal.getByRole('button', { name: 'Simpan', exact: true }).click();
  await tutupSetelahSimpan(hal);
  const baru = (await bacaTulis(hal)).slice(tulis0);
  const set1 = await jumlahSet(hal);
  await hal.close();

  assert.equal(galat.length, 0, `galat konsol: ${galat.join(' | ')}`);
  assert.equal(set1 - set0, 1, `jalur jejak memanggil setelKeranjang ${set1 - set0} kali — harus SATU hasil akhir`);
  assert.equal(
    audit(baru).length,
    1,
    `qty turun tetapi ${audit(baru).length} audit_event — penurunan qty tanpa jejak adalah kecurangan yang pindah cara`
  );
  const p = audit(baru)[0].params;
  assert.equal(p[5], 'cart_line_reduced', `event_type ${p[5]}`);
  assert.equal(p[4], 'user-galeri', `actor_user_id ${p[4]} != staf sesi (user-galeri)`);
  assert.equal(p[6], 'shift-galeri', 'entity_id harus shift berjalan');
  const after = JSON.parse(p[7]);
  assert.equal(after.item_name, 'Cappuccino');
  assert.equal(after.quantity_before_milli, 2000);
  assert.equal(after.quantity_after_milli, 1000);
  assert.equal(after.unit_price, satuan.toString(), `harga di jejak ${after.unit_price} != satuan di dialog ${satuan}`);
  assert.equal(after.reduced_value, ((satuan * 1000n) / 1000n).toString());
  assert.equal(typeof after.reduced_value, 'string');

  const antre = outbox(baru);
  assert.equal(antre.length, 1, 'outbox harus tepat satu');
  assert.ok(antre[0].params.includes('cart_line_reduced'), 'entity_type outbox bukan cart_line_reduced');
  assert.ok(antre[0].params.includes('user-galeri'), 'actor_id outbox bukan staf sesi');
  // ⛔ Ketiganya DI DALAM transaksi (tx ≠ db di galeri).
  assert.equal(audit(baru)[0].dalam, true, 'audit_event ditulis di LUAR transaksi');
  assert.equal(antre[0].dalam, true, 'outbox ditulis di LUAR transaksi');
  const keranjangDalam = baru.filter((t) => /INSERT INTO keranjang_lokal/.test(t.sql) && t.dalam);
  assert.ok(
    keranjangDalam.length >= 1,
    'keranjang_lokal hasil edit tidak ditulis DI DALAM transaksi jejaknya (bocor keluar: perangkat mati di antaranya = keranjang berkurang tanpa jejak)'
  );
  assert.ok(
    baru.indexOf(audit(baru)[0]) < baru.indexOf(keranjangDalam[0]),
    'urutan penulisan: jejak harus mendahului keranjang'
  );
});

test('⛔ baris dihapus ("Hapus dari keranjang", qty 0): SATU audit_event dengan quantity_after_milli 0 dan nilai = seluruh baris', async () => {
  const { hal, galat } = await bukaK03();
  await tenang(hal);
  const tulis0 = (await bacaTulis(hal)).length;
  const sebelum = (await barisTeks(hal)).length;
  await bukaEdit(hal, 'Cappuccino');
  const satuan = angka(await hal.locator(`${DIALOG} [data-uji="edit-satuan"]`).innerText());
  await hal.getByRole('button', { name: /^Kurangi Cappuccino/ }).click();
  await hal.getByRole('button', { name: /^Hapus Cappuccino/ }).click();
  assert.equal(await qtyDraf(hal), '0');
  await hal.getByRole('button', { name: 'Hapus dari keranjang', exact: true }).click();
  await tutupSetelahSimpan(hal);
  const baru = (await bacaTulis(hal)).slice(tulis0);
  const sesudah = (await barisTeks(hal)).length;
  await hal.close();

  assert.equal(galat.length, 0, `galat konsol: ${galat.join(' | ')}`);
  assert.equal(sesudah, sebelum - 1, 'baris tidak terhapus');
  assert.equal(audit(baru).length, 1, `baris dihapus tetapi ${audit(baru).length} audit_event — penghapusan baris tanpa jejak`);
  const after = JSON.parse(audit(baru)[0].params[7]);
  assert.equal(audit(baru)[0].params[5], 'cart_line_reduced');
  assert.equal(after.quantity_before_milli, 2000);
  assert.equal(after.quantity_after_milli, 0);
  assert.equal(after.reduced_value, (satuan * 2n).toString(), 'nilai berkurang bukan seluruh baris (satuan × 2)');
  assert.equal(outbox(baru).length, 1);
  assert.equal(audit(baru)[0].dalam, true);
  assert.equal(outbox(baru)[0].dalam, true);
});

test('⛔ harga di jejak = satuanKeranjang baris SEBELUM diedit, modifier ikut (Kopi Susu Gula Aren + Extra shot)', async () => {
  const { hal } = await bukaK03();
  await tenang(hal);
  const tulis0 = (await bacaTulis(hal)).length;
  await bukaEdit(hal, /Kopi Susu Gula Aren[\s\S]*Extra shot/);
  const satuan = angka(await hal.locator(`${DIALOG} [data-uji="edit-satuan"]`).innerText());
  assert.equal(satuan, 29000n, 'fixture: 24.000 + Extra shot 5.000 — penjaga hampa bila modifier tidak ikut');
  await hal.getByRole('button', { name: /^Hapus Kopi Susu/ }).click(); // 1 → 0
  await hal.getByRole('button', { name: 'Hapus dari keranjang', exact: true }).click();
  await tutupSetelahSimpan(hal);
  const baru = (await bacaTulis(hal)).slice(tulis0);
  await hal.close();
  assert.equal(audit(baru).length, 1);
  const after = JSON.parse(audit(baru)[0].params[7]);
  assert.equal(after.unit_price, '29000', `harga jejak ${after.unit_price} tidak memuat modifier (harap 29000)`);
  assert.equal(after.reduced_value, '29000');
});

test('⛔ qty NAIK, modifier saja berubah, dan penggabungan baris kembar → NOL jejak, NOL outbox', async () => {
  const { hal, galat } = await bukaK03();
  await tenang(hal);
  const tulis0 = (await bacaTulis(hal)).length;

  // (1) Naik: Kopi Susu Gula Aren (Extra shot) 1 → 2.
  await bukaEdit(hal, /Kopi Susu Gula Aren[\s\S]*Extra shot/);
  await hal.getByRole('button', { name: /^Tambah Kopi Susu/ }).click();
  await hal.getByRole('button', { name: 'Simpan', exact: true }).click();
  await tutupSetelahSimpan(hal);

  // (2) Hanya modifier: Susu oat ditambahkan, qty tetap.
  await bukaEdit(hal, /Cokelat Klasik/);
  await hal.locator(DIALOG).getByLabel(/Susu oat/).check();
  await hal.getByRole('button', { name: 'Simpan', exact: true }).click();
  await tutupSetelahSimpan(hal);
  await tenang(hal);
  const sebelumGabung = (await barisTeks(hal)).filter((t) => t.includes('Kopi Susu Gula Aren')).length;

  // (3) Penggabungan: lepas Extra shot hingga menyamai kembarannya; qty total TIDAK turun.
  await bukaEdit(hal, /Kopi Susu Gula Aren[\s\S]*Extra shot/);
  await hal.locator(DIALOG).getByLabel(/Extra shot/).uncheck();
  await hal.getByRole('button', { name: 'Simpan', exact: true }).click();
  await tutupSetelahSimpan(hal);
  await tenang(hal);
  const sesudahGabung = (await barisTeks(hal)).filter((t) => t.includes('Kopi Susu Gula Aren')).length;
  const baru = (await bacaTulis(hal)).slice(tulis0);
  await hal.close();

  assert.equal(galat.length, 0, `galat konsol: ${galat.join(' | ')}`);
  assert.equal(sebelumGabung, 2, 'fixture: penjaga hampa bila kembaran tidak ada');
  assert.equal(sesudahGabung, 1, 'penggabungan tidak terjadi — kasus (3) tidak menguji apa pun');
  assert.equal(audit(baru).length, 0, `qty tidak turun tetapi ada ${audit(baru).length} audit_event — jejak palsu`);
  assert.equal(outbox(baru).length, 0, 'outbox tertulis padahal qty tidak turun');
});

test('⛔ penulisan jejak GAGAL → dialog menahan dengan galat, keranjang UTUH, nol audit/outbox, setelKeranjang tidak dipanggil', async () => {
  const { hal } = await bukaK03();
  await tenang(hal);
  const awal = await barisTeks(hal);
  const set0 = await jumlahSet(hal);
  const tulis0 = (await bacaTulis(hal)).length;
  await bukaEdit(hal, 'Cappuccino');
  await hal.getByRole('button', { name: /^Kurangi Cappuccino/ }).click();
  await hal.evaluate(() => { window.__galeriGagalTulis = true; });
  await hal.getByRole('button', { name: 'Simpan', exact: true }).click();
  const galatDialog = await hal
    .waitForSelector(`${DIALOG} [role="alert"]`, { timeout: 3000 })
    .then((e) => e.innerText())
    .catch(() => null);
  const dialog = await hal.locator(DIALOG).count();
  const sesudah = await barisTeks(hal);
  const baru = (await bacaTulis(hal)).slice(tulis0);
  const set1 = await jumlahSet(hal);
  await hal.close();

  assert.equal(dialog, 1, 'dialog TERTUTUP padahal penulisan jejak gagal — keranjang berubah tanpa jejak');
  assert.notEqual(galatDialog, null, 'dialog tidak menampilkan galat (role=alert) ketika jejak gagal ditulis');
  assert.match(galatDialog, /TIDAK disimpan/, `galat tidak menyatakan perubahan tidak disimpan: ${galatDialog}`);
  assert.deepEqual(sesudah, awal, 'keranjang BERUBAH padahal jejak gagal — kegagalan ditelan');
  assert.equal(set1, set0, 'setelKeranjang dipanggil padahal jejak gagal');
  assert.equal(audit(baru).length, 0);
  assert.equal(outbox(baru).length, 0);
  assert.equal(baru.filter((t) => /keranjang_lokal/.test(t.sql)).length, 0, 'keranjang_lokal ditulis padahal jejak gagal');
});

test('⛔ shift TIDAK terbuka → penurunan ditolak dan dijelaskan, keranjang UTUH, nol audit', async () => {
  const { hal } = await bukaK03();
  await tenang(hal);
  const awal = await barisTeks(hal);
  const set0 = await jumlahSet(hal);
  const tulis0 = (await bacaTulis(hal)).length;
  await bukaEdit(hal, 'Cappuccino');
  await hal.getByRole('button', { name: /^Kurangi Cappuccino/ }).click();
  await hal.evaluate(() => { window.__galeriShiftTutup = true; });
  await hal.getByRole('button', { name: 'Simpan', exact: true }).click();
  const galatDialog = await hal
    .waitForSelector(`${DIALOG} [role="alert"]`, { timeout: 3000 })
    .then((e) => e.innerText())
    .catch(() => null);
  const dialog = await hal.locator(DIALOG).count();
  const sesudah = await barisTeks(hal);
  const baru = (await bacaTulis(hal)).slice(tulis0);
  const set1 = await jumlahSet(hal);
  await hal.close();

  assert.equal(dialog, 1, 'dialog tertutup padahal shift tidak terbuka — keranjang berubah tanpa jejak');
  assert.notEqual(galatDialog, null, 'dialog tidak menjelaskan penolakan (role=alert)');
  assert.match(galatDialog, /Shift sudah tidak terbuka\. Perubahan TIDAK disimpan/, `penolakan tidak dijelaskan: ${galatDialog}`);
  assert.deepEqual(sesudah, awal, 'keranjang BERUBAH padahal shift tidak terbuka dan tidak ada jejak');
  assert.equal(set1, set0, 'setelKeranjang dipanggil padahal shift tidak terbuka');
  assert.equal(audit(baru).length, 0);
  assert.equal(outbox(baru).length, 0);
});

test('⛔ Batal / tutup sesudah menurunkan draf → nol jejak, keranjang tidak berubah', async () => {
  const { hal } = await bukaK03();
  await tenang(hal);
  const awal = await barisTeks(hal);
  const tulis0 = (await bacaTulis(hal)).length;
  await bukaEdit(hal, 'Cappuccino');
  await hal.getByRole('button', { name: /^Kurangi Cappuccino/ }).click();
  await hal.getByRole('button', { name: 'Batal', exact: true }).click();
  await tutupSetelahSimpan(hal);
  await bukaEdit(hal, 'Cappuccino');
  await hal.getByRole('button', { name: /^Hapus Cappuccino|^Kurangi Cappuccino/ }).click();
  await hal.locator(DIALOG).getByRole('button', { name: 'Tutup', exact: true }).click();
  await tutupSetelahSimpan(hal);
  const baru = (await bacaTulis(hal)).slice(tulis0);
  const sesudah = await barisTeks(hal);
  await hal.close();
  assert.deepEqual(sesudah, awal, 'Batal/tutup mengubah keranjang');
  assert.equal(audit(baru).length, 0, 'Batal/tutup menulis jejak');
  assert.equal(outbox(baru).length, 0, 'Batal/tutup menulis outbox');
});

test('⛔ dialog menyatakan bahwa pengurangan TERCATAT — hanya saat draf lebih kecil dari qty tersimpan', async () => {
  const { hal } = await bukaK03();
  await bukaEdit(hal, 'Cappuccino');
  const catatan = () => hal.locator(`${DIALOG} [data-uji="edit-tercatat"]`).count();
  assert.equal(await catatan(), 0, 'catatan "tercatat" tampil padahal belum ada pengurangan');
  await hal.getByRole('button', { name: /^Kurangi Cappuccino/ }).click();
  assert.equal(await catatan(), 1, 'draf turun tetapi dialog tidak menyatakan pengurangan dicatat di audit');
  assert.match(await hal.locator(`${DIALOG} [data-uji="edit-tercatat"]`).innerText(), /tercatat di audit/i);
  await hal.close();
});
