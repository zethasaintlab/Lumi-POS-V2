'use strict';

// Tangga resolusi harga — SALINAN KETIGA, dan itu diakui.
//
// ⛔ `apps/server/src/modules/catalog/handlers/prices.ts` sudah memperingatkan:
// "Dua salinan tangga resolusi ini sudah pernah menyimpang diam-diam sekali --
// urutan COALESCE-nya terbalik dan SELURUH SUITE TETAP HIJAU."
//
// Klien menambah salinan ketiga, dan ia tidak dapat dihindari: server
// menjalankannya sebagai SQL LATERAL (pilihan performa yang benar untuk satu
// query atas seluruh katalog), sementara perangkat harus memutuskan hal yang
// sama tanpa PostgreSQL dan tanpa jaringan.
//
// Yang membuatnya tidak mengulang sejarah itu: berkas ini menguji URUTAN
// TANGGANYA secara eksplisit — bukan hanya "harga yang benar keluar" untuk
// satu kasus, melainkan setiap pasangan tingkat yang bisa saling menutupi.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../packages/domain/src/harga.ts';

const T = (s) => new Date(s).toISOString();

test('tangga: outlet MENANG atas tenant, tenant menang atas harga dasar', async () => {
  const { resolusiHarga } = await import(MOD);

  const dasar = 20000;
  const riwayat = [
    { outlet_id: null, price: 18000, effective_from: T('2026-08-01T00:00:00Z') },
    { outlet_id: 'o1', price: 15000, effective_from: T('2026-08-01T00:00:00Z') },
  ];

  const hasil = resolusiHarga({ hargaDasar: dasar, riwayat, outletId: 'o1', pada: new Date('2026-08-11T00:00:00Z') });
  assert.equal(hasil.harga, 15000);
  assert.equal(hasil.sumber, 'outlet');

  // Tanpa baris outlet, tenant yang berlaku.
  const tanpaOutlet = resolusiHarga({
    hargaDasar: dasar,
    riwayat: riwayat.filter((r) => r.outlet_id === null),
    outletId: 'o1',
    pada: new Date('2026-08-11T00:00:00Z'),
  });
  assert.equal(tanpaOutlet.harga, 18000);
  assert.equal(tanpaOutlet.sumber, 'tenant');

  // Tanpa riwayat sama sekali, harga dasar variation.
  const kosong = resolusiHarga({ hargaDasar: dasar, riwayat: [], outletId: 'o1', pada: new Date() });
  assert.equal(kosong.harga, 20000);
  assert.equal(kosong.sumber, 'variation');
});

test('⛔ baris outlet LAIN tidak pernah berlaku', async () => {
  const { resolusiHarga } = await import(MOD);

  // Kalau penyaringan outlet hilang, cabang A menjual dengan harga cabang B —
  // dan tidak ada satu pun error. Ini bentuk kegagalan yang paling mahal di
  // seluruh berkas ini.
  const hasil = resolusiHarga({
    hargaDasar: 20000,
    riwayat: [{ outlet_id: 'o2', price: 9000, effective_from: T('2026-08-01T00:00:00Z') }],
    outletId: 'o1',
    pada: new Date('2026-08-11T00:00:00Z'),
  });
  assert.equal(hasil.harga, 20000, 'harga outlet lain harus diabaikan');
  assert.equal(hasil.sumber, 'variation');
});

test('harga terjadwal masa depan BELUM berlaku', async () => {
  const { resolusiHarga } = await import(MOD);

  // `CLAUDE.md`: "Harga terjadwal masa depan diizinkan. `effective_from` boleh
  // di masa depan; resolusi `effective_from <= at` yang menentukan kapan ia
  // berlaku."
  const riwayat = [
    { outlet_id: 'o1', price: 15000, effective_from: T('2026-08-01T00:00:00Z') },
    { outlet_id: 'o1', price: 25000, effective_from: T('2026-09-01T00:00:00Z') },
  ];

  assert.equal(
    resolusiHarga({ hargaDasar: 20000, riwayat, outletId: 'o1', pada: new Date('2026-08-11T00:00:00Z') }).harga,
    15000
  );
  assert.equal(
    resolusiHarga({ hargaDasar: 20000, riwayat, outletId: 'o1', pada: new Date('2026-09-02T00:00:00Z') }).harga,
    25000,
    'setelah tanggalnya, harga baru berlaku'
  );
});

test('effective_from PERSIS sama dengan `pada` sudah berlaku', async () => {
  const { resolusiHarga } = await import(MOD);

  // Batas inklusif, sama dengan `effective_from <= at` di server. Eksklusif
  // akan membuat harga yang baru ditulis "belum berlaku" pada milidetik
  // penulisannya sendiri — bug yang pernah nyata di repo ini lewat skew jam.
  const pada = new Date('2026-08-11T10:00:00.000Z');
  const hasil = resolusiHarga({
    hargaDasar: 20000,
    riwayat: [{ outlet_id: 'o1', price: 15000, effective_from: pada.toISOString() }],
    outletId: 'o1',
    pada,
  });
  assert.equal(hasil.harga, 15000);
});

test('beberapa baris di tingkat yang sama: yang TERBARU menang', async () => {
  const { resolusiHarga } = await import(MOD);

  const riwayat = [
    { outlet_id: 'o1', price: 15000, effective_from: T('2026-08-01T00:00:00Z') },
    { outlet_id: 'o1', price: 17000, effective_from: T('2026-08-05T00:00:00Z') },
    { outlet_id: 'o1', price: 12000, effective_from: T('2026-07-01T00:00:00Z') },
  ];
  assert.equal(
    resolusiHarga({ hargaDasar: 20000, riwayat, outletId: 'o1', pada: new Date('2026-08-11T00:00:00Z') }).harga,
    17000
  );
});

test('⛔ tingkat outlet yang KOSONG tidak jatuh ke tenant yang lebih baru', async () => {
  const { resolusiHarga } = await import(MOD);

  // Kasus yang membedakan "tangga" dari "ambil yang terbaru": baris tenant
  // lebih BARU daripada baris outlet, tapi tingkat outlet tetap menang.
  // Implementasi yang mengurutkan seluruh riwayat berdasarkan waktu lalu
  // mengambil yang pertama akan lolos setiap test lain di berkas ini.
  const hasil = resolusiHarga({
    hargaDasar: 20000,
    riwayat: [
      { outlet_id: 'o1', price: 15000, effective_from: T('2026-08-01T00:00:00Z') },
      { outlet_id: null, price: 11000, effective_from: T('2026-08-09T00:00:00Z') },
    ],
    outletId: 'o1',
    pada: new Date('2026-08-11T00:00:00Z'),
  });
  assert.equal(hasil.harga, 15000, 'outlet menang meski tenant lebih baru');
  assert.equal(hasil.sumber, 'outlet');
});

test('outletId null: hanya tingkat tenant dan harga dasar', async () => {
  const { resolusiHarga } = await import(MOD);

  const hasil = resolusiHarga({
    hargaDasar: 20000,
    riwayat: [
      { outlet_id: 'o1', price: 15000, effective_from: T('2026-08-01T00:00:00Z') },
      { outlet_id: null, price: 18000, effective_from: T('2026-08-01T00:00:00Z') },
    ],
    outletId: null,
    pada: new Date('2026-08-11T00:00:00Z'),
  });
  assert.equal(hasil.harga, 18000);
  assert.equal(hasil.sumber, 'tenant');
});
