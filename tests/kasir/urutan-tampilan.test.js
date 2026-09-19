'use strict';

// Urutan grid K-03 dan daftar K-08 — aturan MURNI, diuji tanpa DOM.
//
// ⛔ Keduanya ada di berkas domain layarnya (`katalog/baca.ts`,
// `riwayat/baca.ts`), bukan di komponen React, dengan alasan yang sama dengan
// `modifier-pilihan.ts`: yang hanya dapat diuji lewat DOM biasanya tidak diuji
// sama sekali — dan dua di antara aturan di bawah gagal DIAM-DIAM.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const katalog = () => import('../../apps/kasir/src/katalog/baca.ts');
const riwayat = () => import('../../apps/kasir/src/riwayat/baca.ts');

const item = (nama, ...harga) => ({
  id: nama,
  nama,
  categoryId: null,
  variations: harga.map((h, i) => ({ id: `${nama}-${i}`, nama: `v${i}`, harga: h, barcode: null })),
});

test('⛔ `urutkanItem` TIDAK mengurutkan di tempat', async () => {
  const { urutkanItem } = await katalog();
  const asli = [item('Zuppa', 5000), item('Ayam', 9000)];
  const sebelum = asli.map((i) => i.nama);

  urutkanItem(asli, 'nama');

  assert.deepEqual(
    asli.map((i) => i.nama),
    sebelum,
    'daftar aslinya ikut terurut — ia state React, dan React tidak akan ' +
      'melaporkan perubahannya'
  );
});

test('⛔ harga dibandingkan lewat varian TERMURAH, bukan varian pertama', async () => {
  const { urutkanItem } = await katalog();

  // "Kopi" varian pertamanya 30.000 tapi termurahnya 12.000; kartunya
  // menampilkan "dari Rp 12.000". Mengurutkan dengan varian pertama membuat
  // grid yang terlihat acak terhadap angka yang tertulis di kartunya sendiri.
  const daftar = [item('Kopi', 30_000, 12_000), item('Teh', 20_000)];

  assert.deepEqual(
    urutkanItem(daftar, 'termurah').map((i) => i.nama),
    ['Kopi', 'Teh']
  );
  assert.deepEqual(
    urutkanItem(daftar, 'termahal').map((i) => i.nama),
    ['Teh', 'Kopi'],
    'termahal juga memakai harga TERENDAH tiap item — angka yang sama dengan ' +
      'yang kartunya tampilkan'
  );
});

test('urutan nama memakai locale, bukan perbandingan UTF-16', async () => {
  const { urutkanItem } = await katalog();
  const hasil = urutkanItem([item('Zuppa', 1), item('Éclair', 1), item('Ayam', 1)], 'nama');
  assert.deepEqual(hasil.map((i) => i.nama), ['Ayam', 'Éclair', 'Zuppa']);
});

test('⛔ `urutkanRiwayat` TIDAK mengurutkan di tempat', async () => {
  const { urutkanRiwayat } = await riwayat();
  const asli = [
    { occurredAt: '2026-09-01T10:00:00.000Z', total: 5000 },
    { occurredAt: '2026-09-02T10:00:00.000Z', total: 1000 },
  ];
  const sebelum = asli.map((o) => o.occurredAt);
  urutkanRiwayat(asli, 'terbaru');
  assert.deepEqual(asli.map((o) => o.occurredAt), sebelum);
});

test('riwayat: terbaru, terlama, dan nilai tertinggi', async () => {
  const { urutkanRiwayat } = await riwayat();
  const daftar = [
    { occurredAt: '2026-09-01T10:00:00.000Z', total: 5000 },
    { occurredAt: '2026-09-03T10:00:00.000Z', total: 1000 },
    { occurredAt: '2026-09-02T10:00:00.000Z', total: 9000 },
  ];

  assert.deepEqual(urutkanRiwayat(daftar, 'terbaru').map((o) => o.total), [1000, 9000, 5000]);
  assert.deepEqual(urutkanRiwayat(daftar, 'terlama').map((o) => o.total), [5000, 9000, 1000]);
  assert.deepEqual(urutkanRiwayat(daftar, 'terbesar').map((o) => o.total), [9000, 5000, 1000]);
});

test('⛔ perbandingan waktu tidak runtuh saat melewati pergantian tahun', async () => {
  const { urutkanRiwayat } = await riwayat();
  // ISO 8601 UTC aman dibandingkan sebagai string justru karena bidangnya
  // berukuran tetap dan menurun dari yang terbesar. Test ini yang gagal bila
  // seseorang mengganti `occurredAt` dengan waktu TAMPILAN ("14:32"), yang
  // kehilangan tanggalnya sepenuhnya.
  const daftar = [
    { occurredAt: '2027-01-01T00:05:00.000Z', total: 1 },
    { occurredAt: '2026-12-31T23:55:00.000Z', total: 2 },
  ];
  assert.deepEqual(urutkanRiwayat(daftar, 'terbaru').map((o) => o.total), [1, 2]);
  assert.deepEqual(urutkanRiwayat(daftar, 'terlama').map((o) => o.total), [2, 1]);
});

test('⛔ bilah nav diturunkan dari TABEL_RUTE, dan gerbang tidak masuk', async () => {
  const { ruteNav, TABEL_RUTE } = await import('../../apps/kasir/src/rute/tabel.ts');
  const nav = ruteNav();

  // Setiap entri nav benar-benar ada di tabel rute — tab yang menuju jalur
  // yang tidak dikenal router menghasilkan layar "tidak ditemukan".
  for (const r of nav) {
    assert.ok(
      TABEL_RUTE.some((t) => t.jalur === r.jalur),
      `${r.jalur} tidak ada di TABEL_RUTE`
    );
  }

  const jalur = nav.map((r) => r.jalur);
  // ⛔ Gerbang TIDAK boleh punya tab: tab menuju /login atau /shift/buka
  // mengundang kasir keluar dari shift yang sedang berjalan.
  assert.ok(!jalur.includes('/login'), 'login tidak boleh jadi tab');
  assert.ok(!jalur.includes('/shift/buka'), 'buka shift tidak boleh jadi tab');
  // Rute berparameter tidak dapat dinavigasi tanpa idnya.
  assert.ok(!jalur.some((j) => j.includes(':')), 'rute berparameter tidak boleh jadi tab');

  assert.deepEqual(jalur, ['/', '/riwayat', '/shift/tutup', '/sync', '/perangkat']);
});
