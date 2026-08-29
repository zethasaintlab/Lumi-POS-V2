'use strict';

// Diskon tingkat order dan otorisasi step-up. FR-B8 & FR-B9, `spec-b:267`.
//
// ⛔ Sebelum ini `order_discount` SELALU NOL: kolomnya ada sejak F0 dan
// `computeOrderTotals` sudah menghitungnya sejak Modul C, tapi `POST /orders`
// menulis nol ke sana. Tidak ada satu pun jalan bagi merchant untuk memberi
// diskon — dan tidak ada satu pun test yang merah karenanya.
//
// Yang paling menentukan di berkas ini adalah satu aturan: ambang diputuskan
// dari NILAI RUPIAH, bukan dari bentuk yang diketik kasir. Memeriksa hanya
// bentuk yang diketik membuat setengah ambang tidak pernah menyala — dan yang
// tidak menyala adalah yang dipakai untuk melewatinya.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../packages/domain/src/diskon.ts';

// ---------------------------------------------------------------------------
// Nilai diskon
// ---------------------------------------------------------------------------

test('diskon nominal dipakai apa adanya', async () => {
  const { nilaiDiskon } = await import(MOD);
  assert.equal(nilaiDiskon(100_000n, { tipe: 'nominal', nilai: 15_000n }), 15_000n);
});

test('diskon persen memakai skala 10.000', async () => {
  const { nilaiDiskon } = await import(MOD);
  // Konvensi yang sama dengan `tax_rate.rate`: 15% = 1500n.
  assert.equal(nilaiDiskon(100_000n, { tipe: 'persen', nilai: 1500n }), 15_000n);
  assert.equal(nilaiDiskon(100_000n, { tipe: 'persen', nilai: 10_000n }), 100_000n, '100%');
});

test('⛔ pembagian MEMOTONG — diskon tidak pernah mengambil rupiah tambahan', async () => {
  const { nilaiDiskon } = await import(MOD);
  // 33% dari 10.001 = 3300,33. Yang benar 3300, bukan 3301: diskon yang
  // dibulatkan ke ATAS mengambil satu rupiah lebih banyak daripada yang
  // merchant setujui, dan selisih satu rupiah per transaksi adalah kelas
  // cacat yang tidak pernah dilaporkan siapa pun tapi muncul di rekonsiliasi.
  assert.equal(nilaiDiskon(10_001n, { tipe: 'persen', nilai: 3300n }), 3300n);
});

test('⛔ diskon nominal DIJEPIT ke subtotal, tidak pernah melebihi', async () => {
  const { nilaiDiskon } = await import(MOD);
  // `computeOrderTotals` juga menolaknya; dua lapis disengaja. Yang di sini
  // menjaga hitungan klien, yang di sana menjaga baris yang ditulis.
  assert.equal(nilaiDiskon(10_000n, { tipe: 'nominal', nilai: 999_999n }), 10_000n);
});

test('persen di atas 100% dan nilai negatif ditolak', async () => {
  const { nilaiDiskon } = await import(MOD);
  assert.throws(() => nilaiDiskon(100n, { tipe: 'persen', nilai: 10_001n }), /100%/);
  assert.throws(() => nilaiDiskon(100n, { tipe: 'nominal', nilai: -1n }), /negatif/);
  assert.throws(() => nilaiDiskon(-1n, { tipe: 'nominal', nilai: 1n }), /negatif/);
});

test('⛔ uang tidak pernah float — number ditolak, tidak dikonversi', async () => {
  const { nilaiDiskon } = await import(MOD);
  // Mengonversi diam-diam membuat diskon dihitung dengan aritmetika yang
  // berbeda dari seluruh jalur uang lainnya.
  assert.throws(() => nilaiDiskon(100_000, { tipe: 'nominal', nilai: 1n }), TypeError);
  assert.throws(() => nilaiDiskon(100_000n, { tipe: 'nominal', nilai: 5000 }), TypeError);
});

test('tipe diskon asing ditolak, tidak jatuh ke salah satu', async () => {
  const { nilaiDiskon } = await import(MOD);
  assert.throws(() => nilaiDiskon(100n, { tipe: 'gratis', nilai: 1n }), /tidak dikenal/);
});

// ---------------------------------------------------------------------------
// Ambang otorisasi — inti FR-B8
// ---------------------------------------------------------------------------

test('⛔ ambang NOMINAL menyala meski persennya kecil', async () => {
  const { butuhOtorisasiDiskon } = await import(MOD);
  // Rp 60.000 atas Rp 1.000.000 hanya 6% — jauh di bawah 20% — tapi ia
  // melewati ambang nominal. Memeriksa persen saja meloloskannya.
  assert.equal(butuhOtorisasiDiskon(1_000_000n, 60_000n), true);
  assert.equal(butuhOtorisasiDiskon(1_000_000n, 50_000n), false, 'tepat di ambang belum memicu');
  assert.equal(butuhOtorisasiDiskon(1_000_000n, 50_001n), true);
});

test('⛔ ambang PERSEN menyala meski nominalnya kecil', async () => {
  const { butuhOtorisasiDiskon } = await import(MOD);
  // 30% atas Rp 10.000 hanya Rp 3.000 — jauh di bawah Rp 50.000 — tapi ia
  // melewati ambang persen. Memeriksa nominal saja meloloskannya.
  assert.equal(butuhOtorisasiDiskon(10_000n, 3_000n), true);
  assert.equal(butuhOtorisasiDiskon(10_000n, 2_000n), false, '20% tepat di ambang');
  assert.equal(butuhOtorisasiDiskon(10_000n, 2_001n), true);
});

test('⛔ perbandingan persen memakai perkalian silang, bukan pembagian', async () => {
  const { butuhOtorisasiDiskon } = await import(MOD);
  // Pembagian bigint memotong: 20,004% akan terbaca persis 20% lalu lolos.
  // Subtotal 50.000, diskon 10.002 = 20,004%.
  assert.equal(butuhOtorisasiDiskon(50_000n, 10_002n), true);
  assert.equal(butuhOtorisasiDiskon(50_000n, 10_000n), false, '20,000% tepat di ambang');
});

test('diskon nol atau negatif tidak pernah menuntut otorisasi', async () => {
  const { butuhOtorisasiDiskon } = await import(MOD);
  assert.equal(butuhOtorisasiDiskon(100_000n, 0n), false);
  assert.equal(butuhOtorisasiDiskon(100_000n, -5n), false);
});

test('⛔ subtotal NOL menuntut otorisasi untuk diskon apa pun', async () => {
  const { butuhOtorisasiDiskon } = await import(MOD);
  // Persen atas nol tidak dapat dihitung, dan "tidak dapat dihitung" bukan
  // alasan untuk melewatkan kontrol.
  assert.equal(butuhOtorisasiDiskon(0n, 1n), true);
});

test('ambang dapat dikonfigurasi, dan bawaannya satu tempat', async () => {
  const { butuhOtorisasiDiskon, ambangDari, AMBANG_DISKON_BAWAAN } = await import(MOD);
  assert.deepEqual(AMBANG_DISKON_BAWAAN, { persenSkala: 2000n, nominal: 50_000n });

  // `null` berarti bawaan — bukan `DEFAULT` kolom, yang akan membuat
  // perubahan bawaan hanya berlaku untuk outlet yang dibuat sesudahnya.
  assert.deepEqual(ambangDari(null, null), AMBANG_DISKON_BAWAAN);
  assert.deepEqual(ambangDari(500n, null), { persenSkala: 500n, nominal: 50_000n });

  const longgar = { persenSkala: 5000n, nominal: 1_000_000n };
  assert.equal(butuhOtorisasiDiskon(1_000_000n, 60_000n, longgar), false);
  const ketat = { persenSkala: 100n, nominal: 1_000n };
  assert.equal(butuhOtorisasiDiskon(1_000_000n, 2_000n, ketat), true);
});

// ---------------------------------------------------------------------------
// Rencana
// ---------------------------------------------------------------------------

test('rencanaDiskon menyatukan nilai dan keputusan otorisasi', async () => {
  const { rencanaDiskon } = await import(MOD);
  assert.deepEqual(rencanaDiskon(100_000n, { tipe: 'persen', nilai: 1000n }), {
    nominal: 10_000n,
    butuhPenyetuju: false,
  });
  assert.deepEqual(rencanaDiskon(100_000n, { tipe: 'persen', nilai: 3000n }), {
    nominal: 30_000n,
    butuhPenyetuju: true,
  });
});

// ---------------------------------------------------------------------------
// Alasan
// ---------------------------------------------------------------------------

test('⛔ alasan diskon dari daftar TERTUTUP', async () => {
  const { periksaAlasanDiskon, ALASAN_DISKON } = await import(MOD);
  // Free text tidak dapat diagregasi menjadi laporan fraud (`spec-b:288`),
  // dan laporan exception FR-G5 memakainya.
  assert.deepEqual([...ALASAN_DISKON], [
    'promo_berjalan',
    'karyawan',
    'pelanggan_langganan',
    'kompensasi_keluhan',
    'lainnya',
  ]);
  assert.equal(periksaAlasanDiskon('promo_berjalan'), null);
  for (const kode of ['barang_rusak', 'diskon_khusus', '', null, 7]) {
    assert.ok(periksaAlasanDiskon(kode), `${String(kode)} lolos`);
  }
});

test('⛔ "lainnya" wajib catatan minimal 10 karakter, dihitung setelah trim', async () => {
  const { periksaAlasanDiskon } = await import(MOD);
  assert.ok(periksaAlasanDiskon('lainnya'));
  assert.ok(periksaAlasanDiskon('lainnya', 'pendek'));
  // Sepuluh spasi lolos hitungan mentah tapi tidak menjelaskan apa pun kepada
  // siapa pun yang membaca laporan exception nanti.
  assert.ok(periksaAlasanDiskon('lainnya', '          '));
  assert.equal(periksaAlasanDiskon('lainnya', 'kompensasi antrean panjang'), null);
});

test('⛔ aturan catatan SATU sumber — sama dengan void dan refund', async () => {
  const { periksaAlasanDiskon } = await import(MOD);
  const { assertCancellationReason } = await import('../../packages/domain/src/cancellation.ts');
  const { MIN_PANJANG_CATATAN } = await import('../../packages/domain/src/alasan.ts');

  // Angka yang punya dua salinan akan menyimpang, dan gejalanya adalah satu
  // operasi yang menerima catatan lima karakter sementara yang lain
  // menolaknya.
  const kurang = 'x'.repeat(MIN_PANJANG_CATATAN - 1);
  const cukup = 'x'.repeat(MIN_PANJANG_CATATAN);
  assert.ok(periksaAlasanDiskon('lainnya', kurang));
  assert.equal(periksaAlasanDiskon('lainnya', cukup), null);
  assert.throws(() => assertCancellationReason('void', 'lainnya', kurang));
  assert.doesNotThrow(() => assertCancellationReason('void', 'lainnya', cukup));
});

// ---------------------------------------------------------------------------
// Angka yang DIKETIK kasir
// ---------------------------------------------------------------------------
//
// ⛔ Parsernya di domain, bukan di komponen React: ia memutuskan APA YANG SAH
// sebagai diskon, dan aturan itu tidak boleh punya salinan kedua di layar mana
// pun — dialog K-03 hari ini, layar diskon per-baris kelak.

test('persen yang diketik jadi bigint berskala 10.000', async () => {
  const { parseNilaiDiskon } = await import(MOD);
  assert.equal(parseNilaiDiskon('persen', '15'), 1500n);
  assert.equal(parseNilaiDiskon('persen', '100'), 10_000n);
  assert.equal(parseNilaiDiskon('persen', '0'), 0n);
});

test('⛔ koma DAN titik diterima sebagai pemisah desimal', async () => {
  const { parseNilaiDiskon } = await import(MOD);
  // Kasir Indonesia mengetik "12,5"; papan ketik numerik perangkat mengetik
  // "12.5". Menolak salah satunya berarti separuh perangkat tidak dapat
  // memberi diskon pecahan sama sekali.
  assert.equal(parseNilaiDiskon('persen', '12,5'), 1250n);
  assert.equal(parseNilaiDiskon('persen', '12.5'), 1250n);
});

test('⛔ digit desimal persen diturunkan dari SKALA, bukan dipilih', async () => {
  const { parseNilaiDiskon } = await import(MOD);
  const { SKALA_TARIF } = await import('../../packages/domain/src/numeric.ts');

  // "15%" adalah rate 0,15 — berskala 10.000 ia 1500. Angka persennya sendiri
  // karena itu berskala SKALA_TARIF/100, yaitu tepat dua digit desimal.
  // Digit ketiga adalah angka yang tidak dapat disimpan; menerimanya berarti
  // memotongnya diam-diam.
  assert.equal(parseNilaiDiskon('persen', '12,55'), 1255n);
  assert.equal(parseNilaiDiskon('persen', '12,555'), null);
  assert.equal(String(SKALA_TARIF / 100n).length - 1, 2);
});

test('⛔ nominal TIDAK menerima desimal — uang di sini rupiah utuh', async () => {
  const { parseNilaiDiskon } = await import(MOD);
  assert.equal(parseNilaiDiskon('nominal', '5000'), 5000n);
  // "5000,50" yang diterima lalu dipotong adalah potongan yang berbeda dari
  // yang diketik, tanpa satu pun peringatan.
  assert.equal(parseNilaiDiskon('nominal', '5000,50'), null);
  assert.equal(parseNilaiDiskon('nominal', '5.000'), null);
});

test('masukan setengah jadi mengembalikan null, tidak melempar', async () => {
  const { parseNilaiDiskon } = await import(MOD);
  // Keadaan NORMAL saat orang sedang mengetik. Lemparan di sini akan
  // menjatuhkan render dialog pada ketukan pertama.
  for (const teks of ['', '  ', ',', 'abc', '-5', '1e2', '101']) {
    assert.equal(parseNilaiDiskon('persen', teks), null, `"${teks}" tidak ditolak`);
  }
  // "12," adalah keadaan di TENGAH pengetikan "12,5", dan ia dibaca 12% —
  // bukan ditolak. Layar yang menampilkan error pada koma yang baru diketik
  // membuat kasir menghapus dan mengulang angka yang sebenarnya benar.
  assert.equal(parseNilaiDiskon('persen', '12,'), 1200n);
});

test('format persen adalah kebalikan parse, tanpa nol desimal', async () => {
  const { parseNilaiDiskon, formatPersenDiskon } = await import(MOD);
  assert.equal(formatPersenDiskon(1500n), '15');
  assert.equal(formatPersenDiskon(1250n), '12,5');
  assert.equal(formatPersenDiskon(1255n), '12,55');
  assert.equal(formatPersenDiskon(2000n), '20');
  for (const teks of ['15', '12,5', '12,55', '0', '100']) {
    const nilai = parseNilaiDiskon('persen', teks);
    assert.equal(parseNilaiDiskon('persen', formatPersenDiskon(nilai)), nilai);
  }
});
