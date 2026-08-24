'use strict';

// B-04 / B-05 — aturan tampilan shift.
//
// ⛔ Selisih kas adalah angka yang muncul di layar dengan NAMA KASIR di
// sebelahnya. Tandanya, kata-katanya, dan presisinya karena itu bukan urusan
// kosmetik.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const B04 = '../../apps/backoffice/src/penjualan/b04.ts';

test('⛔ arah selisih: negatif KURANG, positif LEBIH, nol COCOK', async () => {
  // "Kurang" berarti uang hilang dari laci; "lebih" berarti ada uang yang
  // tidak dapat dijelaskan. Menukarnya menuduh orang atas hal yang salah.
  const { arahSelisih } = await import(B04);
  assert.equal(arahSelisih('-50000'), 'kurang');
  assert.equal(arahSelisih('50000'), 'lebih');
  assert.equal(arahSelisih('0'), 'cocok');
});

test('⛔ shift yang belum dihitung BUKAN "cocok"', async () => {
  // `null` berarti belum ada hitungan fisik. Menampilkannya sebagai "cocok"
  // adalah pernyataan bahwa kasnya sudah diperiksa dan sesuai — pernyataan
  // yang tidak seorang pun buat.
  const { arahSelisih, LABEL_SELISIH } = await import(B04);
  assert.equal(arahSelisih(null), 'belum');
  assert.notEqual(LABEL_SELISIH.belum, LABEL_SELISIH.cocok);
});

test('nilai cacat tidak merender sebagai cocok', async () => {
  const { arahSelisih } = await import(B04);
  assert.equal(arahSelisih('bukan angka'), 'belum');
});

test('⛔ setiap arah punya LABEL — warna tidak pernah sendirian', async () => {
  const { LABEL_SELISIH, nadaSelisih } = await import(B04);
  for (const arah of ['cocok', 'kurang', 'lebih', 'belum']) {
    assert.equal(typeof LABEL_SELISIH[arah], 'string');
    assert.ok(LABEL_SELISIH[arah].length > 0, `${arah} tanpa label`);
  }
  // Kurang dan lebih sama-sama perlu perhatian, cocok tidak.
  assert.equal(nadaSelisih('kurang'), nadaSelisih('lebih'));
  assert.notEqual(nadaSelisih('cocok'), nadaSelisih('kurang'));
});

test('⛔ besaran selisih menjaga presisi rupiah utuh', async () => {
  // `Math.abs(Number(...))` akan merusak nilai yang endpoint jaga sebagai
  // string.
  const { besaranSelisih } = await import(B04);
  assert.equal(besaranSelisih('-9007199254740993'), '9007199254740993');
  assert.equal(besaranSelisih('50000'), '50000');
  assert.equal(besaranSelisih(null), '0');
});

test('ringkasan menghitung berapa shift yang selisihnya bermasalah', async () => {
  const { ringkasShift } = await import(B04);
  const S = (difference) => ({ difference });
  const r = ringkasShift([S('0'), S('-50000'), S('30000'), S(null)]);
  assert.equal(r.jumlah, 4);
  assert.equal(r.bermasalah, 2, 'nol atau belum-dihitung ikut terhitung bermasalah');
});

test('metode dan tipe gerakan terbaca merchant', async () => {
  const { labelMetode, labelGerak } = await import(B04);
  assert.equal(labelMetode('cash'), 'Tunai');
  assert.equal(labelGerak('bank_deposit'), 'Setoran bank');
  // Kode tak dikenal tampil apa adanya, bukan kosong.
  assert.equal(labelMetode('metode_baru'), 'metode_baru');
  assert.equal(labelGerak('tipe_baru'), 'tipe_baru');
});

test('⛔ label metode SEPAKAT dengan B-03', async () => {
  // Dua layar yang menamai metode yang sama dengan kata berbeda membuat
  // merchant mengira keduanya hal yang berbeda.
  const { LABEL_METODE } = await import(B04);
  const { LABEL_METODE: b03 } = await import('../../packages/domain/src/metode-tampilan.ts');
  assert.deepEqual(LABEL_METODE, b03);
});

test('⛔ kosong menyebut SEBABNYA — shift berjalan disembunyikan', async () => {
  // Daftar kosong paling sering berarti "belum ada yang ditutup", bukan
  // "tidak ada shift". Menyamakannya membuat manajer mengira kasirnya tidak
  // bekerja.
  const { pesanKeadaan } = await import(B04);
  const bawaan = pesanKeadaan({ jenis: 'siap', items: [] }, false);
  const semua = pesanKeadaan({ jenis: 'siap', items: [] }, true);
  assert.match(bawaan.badan, /masih berjalan/i);
  assert.notEqual(bawaan.badan, semua.badan);
});

test('⛔ KOSONG dibedakan dari GAGAL dan dari BELUM DIMUAT', async () => {
  const { pesanKeadaan } = await import(B04);
  const kosong = pesanKeadaan({ jenis: 'siap', items: [] }, false);
  const galat = pesanKeadaan({ jenis: 'galat', pesan: 'Koneksi putus.' }, false);
  const muat = pesanKeadaan({ jenis: 'memuat' }, false);
  assert.notEqual(kosong.judul, galat.judul);
  assert.notEqual(kosong.judul, muat.judul);
  assert.match(galat.badan, /Koneksi putus\./);
});

test('ada isi → tidak ada pesan', async () => {
  const { pesanKeadaan } = await import(B04);
  assert.equal(pesanKeadaan({ jenis: 'siap', items: [{ id: 'a' }] }, false), null);
});

test('⛔ SETIAP kode alasan selisih di kasir punya label — daftarnya diturunkan', async () => {
  // Ditemukan di browser: layar sempat memakai `labelAlasan` dari B-21, yang
  // memetakan alasan PEMBATALAN. `kesalahan_hitung` tidak ada di sana, jadi ia
  // tampil sebagai slug mentah — di kolom yang manajer baca untuk memutuskan
  // apakah selisihnya wajar.
  const { LABEL_ALASAN_SELISIH } = await import(B04);
  const { ALASAN_SELISIH } = await import('../../apps/kasir/src/kas/tutup.ts');

  const hilang = ALASAN_SELISIH.map((a) => a.kode).filter(
    (kode) => LABEL_ALASAN_SELISIH[kode] === undefined
  );
  assert.deepEqual(hilang, [], `kode alasan selisih tanpa label: ${hilang.join(', ')}`);
});

test('label alasan selisih dipakai, kode asing tampil apa adanya', async () => {
  const { labelAlasanSelisih } = await import(B04);
  assert.equal(labelAlasanSelisih('kesalahan_hitung'), 'Kesalahan hitung');
  assert.equal(labelAlasanSelisih('kode_baru'), 'kode_baru');
  assert.equal(labelAlasanSelisih(null), '—');
});
