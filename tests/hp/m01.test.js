'use strict';

// M-01 — aturan tampilan Ringkasan Hari Ini.
//
// ⛔ Yang paling penting diuji: setiap angka bertanda membawa KATANYA, dan
// "belum dapat dibandingkan" tidak pernah terbaca sebagai "0%". Layar ini
// dibaca sekilas pukul 23:00, dan yang salah dibaca sekilas akan
// ditindaklanjuti dengan menelepon kasir.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const M01 = '../../apps/hp/src/ringkasan/m01.ts';

const tren = (over = {}) => ({
  deltaPersen: 10,
  arah: 'naik',
  rataRata: '1000000',
  basisMinggu: 4,
  ...over,
});

// --------------------------------------------------------------- keadaan --

test('⛔ keempat keadaan bukan-siap punya kalimatnya SENDIRI', async () => {
  const { pesanLayar } = await import(M01);
  const pesan = ['memuat', 'gagal', 'tidak-berhak', 'ambigu'].map(pesanLayar);
  assert.equal(new Set(pesan).size, 4, `ada kalimat yang sama: ${pesan.join(' | ')}`);
  for (const p of pesan) assert.ok(typeof p === 'string' && p.trim() !== '');
});

test('⛔ "gagal" MENYANGKAL kesimpulan "tidak ada penjualan"', async () => {
  // Kesimpulan itu yang paling mudah diambil pukul 23:00, dan ia salah.
  const { pesanLayar } = await import(M01);
  assert.match(pesanLayar('gagal'), /BUKAN berarti/i);
});

test('⛔ "ambigu" MENYEBUT jalan keluarnya', async () => {
  // Pesan yang menjelaskan masalah tanpa menyebut tindakannya membuat layar
  // terlihat rusak.
  const { pesanLayar } = await import(M01);
  assert.match(pesanLayar('ambigu'), /pilih satu outlet/i);
});

test('siap tidak punya pesan — isinya yang dirender', async () => {
  const { pesanLayar } = await import(M01);
  assert.equal(pesanLayar('siap'), null);
});

// ---------------------------------------------------------------- tanggal --

test('⛔ tanggal diurai sebagai TEKS, bukan lewat new Date()', async () => {
  // `new Date('2026-08-24')` adalah tengah malam UTC; `getDate()` atasnya
  // mengembalikan 23 untuk setiap zona di sebelah barat Greenwich — layar
  // yang menyebut hari kemarin untuk angka hari ini.
  const { tanggalTampil } = await import(M01);
  assert.equal(tanggalTampil('2026-08-24'), '24 Agu 2026');
  assert.equal(tanggalTampil('2026-01-01'), '1 Jan 2026');
  assert.equal(tanggalTampil('2026-12-31'), '31 Des 2026');
});

test('tanggal yang cacat dikembalikan apa adanya, tidak jadi NaN', async () => {
  const { tanggalTampil } = await import(M01);
  assert.equal(tanggalTampil('bukan-tanggal'), 'bukan-tanggal');
  assert.equal(tanggalTampil('2026-13-01'), '2026-13-01', 'bulan 13 tidak dikarang');
});

// ------------------------------------------------------------------- tren --

test('⛔ delta null TIDAK PERNAH terbaca sebagai 0%', async () => {
  const { trenTampil } = await import(M01);
  const t = trenTampil(tren({ deltaPersen: null, rataRata: null, basisMinggu: 0 }));
  assert.equal(t.dapatDibandingkan, false);
  assert.doesNotMatch(t.teks, /0[,.]0%|\b0%/, `menyebut nol persen: ${t.teks}`);
  assert.match(t.teks, /belum dapat dibandingkan/i);
  assert.equal(t.panah, '', 'panah untuk sesuatu yang tidak dapat dibandingkan menyesatkan');
});

test('⛔ "belum dapat dibandingkan" MENYEBUT alasannya', async () => {
  // Tanpa sebab ia terbaca seperti kerusakan; dengan sebab ia terbaca seperti
  // fakta tentang usia merchant itu sendiri.
  const { trenTampil } = await import(M01);
  assert.match(trenTampil(tren({ deltaPersen: null, basisMinggu: 0 })).teks, /belum ada hari/i);
  assert.match(trenTampil(tren({ deltaPersen: null, basisMinggu: 1 })).teks, /1 hari/);
});

test('⛔ arah SELALU punya katanya, bukan hanya panah', async () => {
  // Aturan design system #5. Panah hijau ke atas pada omzet yang TURUN dibaca
  // sekilas sebagai kabar baik.
  const { trenTampil } = await import(M01);
  const naik = trenTampil(tren({ deltaPersen: 12.34, arah: 'naik' }));
  const turun = trenTampil(tren({ deltaPersen: -12.34, arah: 'turun' }));
  assert.match(naik.teks, /lebih tinggi/i);
  assert.match(turun.teks, /lebih rendah/i);
  assert.notEqual(naik.teks, turun.teks);
});

test('⛔ besaran ditampilkan TANPA tandanya — katanya yang membawa arah', async () => {
  // "−12,3% lebih rendah" adalah negasi ganda: dibaca cepat ia berarti naik.
  const { trenTampil } = await import(M01);
  const turun = trenTampil(tren({ deltaPersen: -12.34, arah: 'turun' }));
  // Tanda diperiksa TEPAT di depan angkanya — `rata-rata` juga mengandung
  // tanda hubung, dan memeriksa seluruh kalimat menandai kalimat yang benar.
  assert.doesNotMatch(turun.teks, /[-−]\s*\d/, turun.teks);
  assert.match(turun.teks, /12,3%/);
});

test('desimal memakai KOMA, bukan titik', async () => {
  const { trenTampil } = await import(M01);
  assert.match(trenTampil(tren({ deltaPersen: 7.5 })).teks, /7,5%/);
});

test('⛔ pembandingnya DISEBUT, bukan disingkat jadi "biasanya"', async () => {
  // Owner yang tidak tahu pembandingnya akan mengasumsikan kemarin, lalu
  // menyimpulkan Senin yang normal sebagai bencana.
  const { trenTampil } = await import(M01);
  assert.match(trenTampil(tren()).teks, /hari yang sama/i);
  assert.match(trenTampil(tren({ arah: 'datar', deltaPersen: 0 })).teks, /hari yang sama/i);
});

test('datar berbunyi "sama dengan", tanpa persen palsu', async () => {
  const { trenTampil } = await import(M01);
  const t = trenTampil(tren({ deltaPersen: 0, arah: 'datar' }));
  assert.match(t.teks, /sama dengan/i);
  assert.equal(t.dapatDibandingkan, true);
  assert.equal(t.panah, '—');
});

// --------------------------------------------------------------- rata-rata --

test('⛔ rata-rata null BUKAN "Rp 0"', async () => {
  const { rataRataTampil } = await import(M01);
  const kosong = rataRataTampil(null);
  assert.doesNotMatch(kosong, /Rp/, kosong);
  assert.match(kosong, /belum ada transaksi/i);
});

test('rata-rata ada diformat rupiah dan menyebut satuannya', async () => {
  const { rataRataTampil } = await import(M01);
  const t = rataRataTampil('66577');
  assert.match(t, /Rp 66\.577/);
  assert.match(t, /per transaksi/);
});

// ----------------------------------------------------------------- metode --

test('⛔ label metode SAMA dengan yang back-office pakai', async () => {
  // Dua peta yang menyimpang menghasilkan ringkasan HP yang menyebut saluran
  // berbeda dari laporan back-office untuk hari yang sama.
  const { barisMetode } = await import(M01);
  const { LABEL_METODE } = await import('../../packages/domain/src/metode-tampilan.ts');
  const baris = barisMetode([
    { metode: 'cash', total: '120000', jumlah: 2 },
    { metode: 'qris_dynamic', total: '80000', jumlah: 1 },
  ]);
  assert.equal(baris[0].label, LABEL_METODE.cash);
  assert.equal(baris[1].label, LABEL_METODE.qris_dynamic);
});

test('⛔ jumlah transaksi SELALU disertai katanya', async () => {
  const { barisMetode } = await import(M01);
  const baris = barisMetode([
    { metode: 'cash', total: '120000', jumlah: 1 },
    { metode: 'card_edc', total: '80000', jumlah: 7 },
  ]);
  assert.equal(baris[0].jumlah, '1 transaksi');
  assert.equal(baris[1].jumlah, '7 transaksi');
});

test('metode tak dikenal ditampilkan apa adanya, tidak dihilangkan', async () => {
  // Baris yang hilang membuat jumlah kolom metode tidak sama dengan omzet, dan
  // tidak ada apa pun yang menjelaskan selisihnya.
  const { barisMetode } = await import(M01);
  const baris = barisMetode([{ metode: 'metode_baru', total: '1000', jumlah: 1 }]);
  assert.equal(baris.length, 1);
  assert.equal(baris[0].label, 'metode_baru');
});

test('uang per metode diformat, bukan angka mentah', async () => {
  const { barisMetode } = await import(M01);
  assert.equal(barisMetode([{ metode: 'cash', total: '1847000', jumlah: 3 }])[0].nominal, 'Rp 1.847.000');
});

// ------------------------------------------------------------------ batas --

test('⛔ catatan batas menyatakan bahwa perangkat offline BELUM terhitung', async () => {
  // Tanpa kalimat ini, angka di layar dibaca sebagai "apa yang terjual" alih-
  // alih "apa yang sudah sampai", dan owner menelepon kasirnya tentang omzet
  // yang sebenarnya ada di antrean sebuah tablet.
  const { CATATAN_ANTREAN } = await import(M01);
  assert.match(CATATAN_ANTREAN, /offline/i);
  assert.match(CATATAN_ANTREAN, /belum terhitung/i);
});
