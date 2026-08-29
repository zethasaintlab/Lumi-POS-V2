'use strict';

// Bilah nav Owner mobile dan aturan rentang M-03.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const NAV = '../../apps/hp/src/navigasi.ts';
const M03 = '../../apps/hp/src/laporan/m03.ts';

// -------------------------------------------------------------- navigasi --

test('⛔ bilah nav tepat DUA item', async () => {
  // `IA:253`: item ketiga berarti IA-nya sudah bergeser dari "satu pertanyaan"
  // menjadi "aplikasi manajemen".
  const { ITEM_NAV, MAKS_ITEM_NAV } = await import(NAV);
  assert.equal(MAKS_ITEM_NAV, 2);
  assert.equal(ITEM_NAV.length, MAKS_ITEM_NAV);
});

test('⛔ tidak ada tab yang menuju M-04 — ia v1.1', async () => {
  // `IA:251`. Wireframe menggambar [Laporan] [Otorisasi]; tab yang menuju
  // layar yang tidak ada terbaca sebagai aplikasi rusak.
  const { ITEM_NAV } = await import(NAV);
  for (const item of ITEM_NAV) {
    assert.notEqual(item.id, 'M-04');
    assert.doesNotMatch(item.label, /otorisasi/i);
  }
});

test('⛔ M-02 BUKAN tab, dan ia menyalakan M-01', async () => {
  // Tab untuk M-02 akan tampil juga saat tidak ada yang perlu diperiksa —
  // persis yang spec-g:245 larang. Bilah tanpa item aktif membuat orang
  // menyimpulkan ia keluar dari aplikasi.
  const { ITEM_NAV, navAktif } = await import(NAV);
  assert.ok(!ITEM_NAV.some((i) => i.id === 'M-02'));
  assert.equal(navAktif('M-02'), 'M-01');
  assert.equal(navAktif('M-01'), 'M-01');
  assert.equal(navAktif('M-03'), 'M-03');
});

test('kode layar dipakai apa adanya dari IA, bukan slug karangan', async () => {
  const { ITEM_NAV } = await import(NAV);
  assert.deepEqual(
    ITEM_NAV.map((i) => i.id),
    ['M-01', 'M-03']
  );
});

// ----------------------------------------------------------------- M-03 --

test('⛔ "7 hari" memuat TUJUH tanggal, bukan delapan', async () => {
  // Rentang yang memuat delapan tanggal menghasilkan rata-rata harian yang
  // selalu sedikit terlalu rendah, dan salahnya tidak pernah cukup besar
  // untuk terlihat.
  const { RENTANG, rentangDari } = await import(M03);
  const tujuh = RENTANG.find((r) => r.id === '7h');
  const { from, to } = rentangDari('2026-08-24', tujuh);
  assert.equal(to, '2026-08-24');
  assert.equal(from, '2026-08-18');

  const hari =
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  assert.equal(hari, 7);
});

test('30 hari menyeberangi batas bulan dengan benar', async () => {
  const { RENTANG, rentangDari } = await import(M03);
  const tigaPuluh = RENTANG.find((r) => r.id === '30h');
  assert.deepEqual(rentangDari('2026-08-24', tigaPuluh), {
    from: '2026-07-26',
    to: '2026-08-24',
  });
});

test('"bulan ini" mulai dari tanggal 1, bukan 30 hari lalu', async () => {
  const { RENTANG, rentangDari } = await import(M03);
  const bulan = RENTANG.find((r) => r.id === 'bulan-ini');
  assert.deepEqual(rentangDari('2026-08-05', bulan), { from: '2026-08-01', to: '2026-08-05' });
  // Tanggal 1 sendiri: rentang satu hari, bukan rentang kosong.
  assert.deepEqual(rentangDari('2026-08-01', bulan), { from: '2026-08-01', to: '2026-08-01' });
});

test('⛔ tanggal dasar yang cacat DILEMPAR, tidak menghasilkan NaN diam-diam', async () => {
  const { RENTANG, rentangDari } = await import(M03);
  assert.throws(() => rentangDari('bukan-tanggal', RENTANG[0]), TypeError);
});

test('⛔ ketiga keadaan bukan-siap punya kalimatnya sendiri', async () => {
  const { pesanLaporan } = await import(M03);
  const pesan = ['memuat', 'gagal', 'tidak-berhak'].map(pesanLaporan);
  assert.equal(new Set(pesan).size, 3, pesan.join(' | '));
  assert.equal(pesanLaporan('siap'), null);
});

test('⛔ "gagal" MENYANGKAL kesimpulan "tidak ada penjualan"', async () => {
  const { pesanLaporan } = await import(M03);
  assert.match(pesanLaporan('gagal'), /BUKAN berarti/i);
});

test('periode selalu dapat dibaca, termasuk rentang satu hari', async () => {
  // Angka tanpa periodenya tidak dapat dipakai memutuskan apa pun.
  const { periodeTampil } = await import(M03);
  assert.equal(periodeTampil('2026-08-24', '2026-08-24'), '2026-08-24');
  assert.match(periodeTampil('2026-08-18', '2026-08-24'), /2026-08-18.*2026-08-24/);
});
