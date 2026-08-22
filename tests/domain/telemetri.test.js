'use strict';

// Telemetri klien — aturan murninya. `ARCH:294` § 10.
//
// ⛔ Dua sifat di sini bukan soal kebenaran melainkan soal BATAS, dan
// keduanya diuji sebagai property:
//
//   1. tidak satu pun jalur dapat mengirim apa pun selain angka
//      (`ARCH:309` — batas ETIS, bukan preferensi);
//   2. tidak satu pun masukan dapat membuat modul ini melempar
//      (`ARCH:307` — telemetri tidak pernah menghambat aplikasi).
//
// Yang kedua terdengar berlebihan sampai diingat siapa pemanggilnya: jalur
// penjualan dan jalur cetak. Telemetri yang menggagalkan keduanya lebih
// berbahaya daripada telemetri yang tidak ada.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MOD = '../../packages/domain/src/telemetri.ts';

const WAKTU = '2026-08-21T10:00:00.000Z';
const P = (over = {}) => ({ event: 'latensi_keranjang_ms', nilai: 10, tipe: null, padaWaktu: WAKTU, ...over });

// ---------------------------------------------------------------------------
// Batas etis
// ---------------------------------------------------------------------------

test('⛔ nilai yang BUKAN angka dibuang, bukan dikirim', async () => {
  const { bersihkanPeristiwa } = await import(MOD);
  // Satu string yang lolos ke sini adalah nama produk atau pesan error yang
  // memuatnya — dan telemetri adalah satu-satunya jalur yang mengirim data
  // merchant tanpa merchant memintanya.
  for (const nilai of ['Kopi Susu', { harga: 25000 }, [1, 2], null, undefined, true]) {
    assert.equal(bersihkanPeristiwa(P({ nilai })), null, `nilai ${JSON.stringify(nilai)} lolos`);
  }
});

test('⛔ NaN dan Infinity dibuang — keduanya `number` yang merusak agregasi', async () => {
  const { bersihkanPeristiwa } = await import(MOD);
  // Rata-rata menjadi NaN dan p95 menjadi tidak berurut, tanpa satu pun error.
  for (const nilai of [NaN, Infinity, -Infinity]) {
    assert.equal(bersihkanPeristiwa(P({ nilai })), null, `${String(nilai)} lolos`);
  }
});

test('⛔ event di luar daftar tertutup dibuang', async () => {
  const { bersihkanPeristiwa, EVENT_TELEMETRI } = await import(MOD);
  for (const event of ['produk_terjual', 'nilai_transaksi', 'nama_merchant', '', null, 7]) {
    assert.equal(bersihkanPeristiwa(P({ event })), null, `${String(event)} lolos`);
  }
  for (const event of EVENT_TELEMETRI) {
    assert.ok(bersihkanPeristiwa(P({ event })), `${event} seharusnya diterima`);
  }
});

test('⛔ daftar event TIDAK memuat satu pun nama yang berbau isi transaksi', async () => {
  const { EVENT_TELEMETRI } = await import(MOD);
  // Penjaga terhadap penambahan berikutnya: nama yang menjelaskan ISI, bukan
  // PERISTIWA, adalah pintu masuk kebocoran.
  const terlarang = ['produk', 'item', 'harga', 'price', 'total', 'nilai_transaksi', 'pelanggan', 'merchant', 'nama'];
  const langgar = EVENT_TELEMETRI.filter((e) => terlarang.some((t) => e.includes(t)));
  assert.deepEqual(langgar, []);
});

test('⛔ `tipe` dipotong — ia label kategori, bukan pesan', async () => {
  const { bersihkanPeristiwa, MAKS_TIPE } = await import(MOD);
  // Pesan error dapat memuat nama produk ("Kopi Susu tidak ditemukan") dan
  // nilai transaksi. Pemotongan ini lapisan terakhir bila pemanggil keliru.
  const panjang = 'x'.repeat(MAKS_TIPE + 50);
  const p = bersihkanPeristiwa(P({ tipe: panjang }));
  assert.equal(p.tipe.length, MAKS_TIPE);
});

test('`tipe` kosong atau bukan string menjadi null, bukan string "null"', async () => {
  const { bersihkanPeristiwa } = await import(MOD);
  for (const tipe of ['', '   ', null, undefined, 7, {}]) {
    assert.equal(bersihkanPeristiwa(P({ tipe })).tipe, null, `${String(tipe)}`);
  }
  assert.equal(bersihkanPeristiwa(P({ tipe: '  TypeError  ' })).tipe, 'TypeError');
});

test('⛔ property: bersihkanPeristiwa TIDAK PERNAH melempar', async () => {
  const { bersihkanPeristiwa } = await import(MOD);
  // Pemanggilnya jalur penjualan dan jalur cetak.
  const gila = [
    {}, { event: 1 }, { nilai: 1 }, { event: 'crash' },
    { event: 'crash', nilai: 1 }, { event: 'crash', nilai: 1, padaWaktu: 5 },
    { event: 'crash', nilai: 1, padaWaktu: WAKTU, tipe: Symbol('x') },
    { event: 'crash', nilai: -0, padaWaktu: WAKTU },
  ];
  for (const m of gila) {
    assert.doesNotThrow(() => bersihkanPeristiwa(m), JSON.stringify(String(m)));
  }
});

// ---------------------------------------------------------------------------
// Ringkasan
// ---------------------------------------------------------------------------

test('ringkasan mengelompokkan per event DAN tipe', async () => {
  const { ringkas } = await import(MOD);
  const r = ringkas([
    P({ nilai: 10 }),
    P({ nilai: 30 }),
    P({ event: 'crash', nilai: 1, tipe: 'TypeError' }),
    P({ event: 'crash', nilai: 1, tipe: 'RangeError' }),
  ]);
  assert.equal(r.length, 3);
  const latensi = r.find((x) => x.event === 'latensi_keranjang_ms');
  assert.deepEqual(
    { jumlah: latensi.jumlah, total: latensi.total, min: latensi.min, maks: latensi.maks },
    { jumlah: 2, total: 40, min: 10, maks: 30 }
  );
});

test('⛔ p95 memakai nearest-rank — nilainya BENAR-BENAR terjadi', async () => {
  const { ringkas, persentil } = await import(MOD);
  // Interpolasi menghasilkan angka yang tidak pernah diukur siapa pun, dan
  // menaruhnya di samping ambang alarm membuat alarm menyala untuk kejadian
  // yang tidak ada.
  const nilai = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.equal(persentil(nilai, 95), 95);
  assert.ok(nilai.includes(persentil(nilai, 95)));

  const r = ringkas(nilai.map((n) => P({ nilai: n })));
  assert.equal(r[0].p95, 95);
});

test('persentil pada larik pendek dan kosong tidak keluar batas', async () => {
  const { persentil } = await import(MOD);
  assert.equal(persentil([], 95), 0);
  assert.equal(persentil([7], 95), 7);
  assert.equal(persentil([1, 2], 95), 2);
  assert.equal(persentil([1, 2, 3], 0), 1, 'p0 tidak boleh indeks negatif');
  assert.equal(persentil([1, 2, 3], 100), 3);
});

test('⛔ urutan ringkasan STABIL — dua ringkasan data sama harus identik', async () => {
  const { ringkas } = await import(MOD);
  // Itu yang membuat perbandingan antar rilis mungkin.
  const data = [
    P({ event: 'crash', nilai: 1, tipe: 'Z' }),
    P({ event: 'antrean_gagal', nilai: 2 }),
    P({ event: 'crash', nilai: 1, tipe: 'A' }),
  ];
  const satu = JSON.stringify(ringkas(data));
  const dua = JSON.stringify(ringkas([...data].reverse()));
  assert.equal(satu, dua);
});

test('ringkasan larik kosong adalah larik kosong, bukan lemparan', async () => {
  const { ringkas } = await import(MOD);
  assert.deepEqual(ringkas([]), []);
});

// ---------------------------------------------------------------------------
// Batas buffer
// ---------------------------------------------------------------------------

test('⛔ buffer BERBATAS — telemetri tidak boleh memenuhi disk milik outbox', async () => {
  const { jumlahDibuang, BATAS_BUFFER } = await import(MOD);
  // Perangkat yang offline sebulan menghasilkan puluhan ribu peristiwa, dan
  // disk penuh membuat `outbox_local` GAGAL MENULIS PENJUALAN. Telemetri
  // dapat dibuang; penjualan tidak.
  assert.equal(jumlahDibuang(BATAS_BUFFER), 0);
  assert.equal(jumlahDibuang(BATAS_BUFFER + 1), 1);
  assert.equal(jumlahDibuang(BATAS_BUFFER + 1000), 1000);
  assert.equal(jumlahDibuang(0), 0);
  assert.equal(jumlahDibuang(10, 100), 0, 'batas dapat dikonfigurasi');
});

// ---------------------------------------------------------------------------
// Mode
// ---------------------------------------------------------------------------

test('mode `off` tidak mengirim satu event pun', async () => {
  const { eventUntukMode } = await import(MOD);
  assert.equal(eventUntukMode('off').size, 0);
});

test('mode `full` mengirim SELURUH daftar — tanpa yang tertinggal', async () => {
  const { eventUntukMode, EVENT_TELEMETRI } = await import(MOD);
  // Event yang ditambahkan kelak ikut tanpa ada yang perlu ingat
  // menambahkannya di dua tempat.
  assert.deepEqual([...eventUntukMode('full')].sort(), [...EVENT_TELEMETRI].sort());
});

test('⛔ mode `minimal` menyimpan metrik KESEHATAN, membuang pengukuran performa', async () => {
  const { eventUntukMode } = await import(MOD);
  const m = eventUntukMode('minimal');
  // Yang menjawab "apakah merchant ini sedang kehilangan uang" tetap ada.
  for (const e of ['umur_antrean_jam', 'antrean_gagal', 'cetak_percobaan', 'crash']) {
    assert.ok(m.has(e), `${e} hilang dari mode minimal`);
  }
  // Yang berguna bagi KAMI, bukan bagi merchant, dibuang — merchant yang
  // memilih `minimal` sedang berkata persis itu.
  assert.ok(!m.has('latensi_keranjang_ms'));
  assert.ok(!m.has('offline_detik'));
});

test('adalahModeTelemetri menolak nilai asing', async () => {
  const { adalahModeTelemetri } = await import(MOD);
  for (const v of ['full', 'minimal', 'off']) assert.equal(adalahModeTelemetri(v), true);
  for (const v of ['FULL', 'penuh', '', null, undefined, 1, {}]) {
    assert.equal(adalahModeTelemetri(v), false, String(v));
  }
});

test('⛔ variabel yang TIDAK DISET berarti `off`, bukan `full`', async () => {
  const { bacaModeTelemetri } = await import(MOD);
  // Asimetri akibat, dan itu seluruh alasannya: variabel yang lupa diset pada
  // pemasangan on-premise akan MENGUMPULKAN data tanpa ada yang menyetujuinya,
  // dan tidak seorang pun melihatnya. SaaS yang lupa diset hanya menghasilkan
  // metrik kosong — dan kosong itu terlihat.
  for (const v of [undefined, null, '', 'FULL', 'penuh', 1, {}]) {
    assert.equal(bacaModeTelemetri(v), 'off', String(v));
  }
  assert.equal(bacaModeTelemetri('full'), 'full');
  assert.equal(bacaModeTelemetri('minimal'), 'minimal');
});

// ---------------------------------------------------------------------------
// Kosakata: daftar tertutup punya DUA salinan, dan keduanya harus sama
// ---------------------------------------------------------------------------

test('⛔ CHECK `device_telemetry.event` di migrasi SAMA PERSIS dengan daftar di sini', async () => {
  // Pola yang sama dengan `tests/kasir/kosakata-stock-movement.test.js`.
  // Dua daftar tertutup untuk hal yang sama akan menyimpang pada event
  // berikutnya yang ditambahkan salah satunya — dan yang menyimpang di sini
  // menghasilkan 500 saat perangkat mengirim event yang server sendiri
  // daftarkan sebagai sah.
  const { EVENT_TELEMETRI } = await import(MOD);
  const sql = fs.readFileSync(
    path.join(__dirname, '..', '..', 'db', 'migrations', '0029_device_telemetry.sql'),
    'utf8'
  );
  const m = /event\s+text NOT NULL CHECK \(event IN \(([\s\S]*?)\)\)/.exec(sql);
  assert.ok(m, 'CHECK `event` tidak terbaca di migrasi — parsernya usang?');
  const diMigrasi = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);

  assert.deepEqual([...diMigrasi].sort(), [...EVENT_TELEMETRI].sort());
});
