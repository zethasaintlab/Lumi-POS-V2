'use strict';

// M-02 — aturan tampilan Perlu Diperiksa.
//
// ⛔ Dua hal yang berkas ini ada untuk menjaga: tidak satu pun kalimatnya
// menyalahkan orang, dan "gagal memuat" tidak pernah terbaca sebagai
// "tidak ada yang perlu diperiksa".

const { test } = require('node:test');
const assert = require('node:assert/strict');

const M02 = '../../apps/hp/src/perlu/m02.ts';

const temuan = (over = {}) => ({
  jenis: 'oversell',
  id: 'x',
  outletId: 'o1',
  outletNama: 'Cabang Dago',
  nilai: '3000',
  terjadiPada: '2026-08-24T10:00:00.000Z',
  keterangan: 'Kopi Susu',
  ...over,
});

// --------------------------------------------------------------- keadaan --

test('⛔ ketiga keadaan bukan-siap punya kalimatnya SENDIRI', async () => {
  const { pesanPerlu } = await import(M02);
  const pesan = ['memuat', 'gagal', 'tidak-berhak'].map(pesanPerlu);
  assert.equal(new Set(pesan).size, 3, pesan.join(' | '));
});

test('⛔ "gagal" MENYANGKAL kesimpulan "tidak ada yang perlu diperiksa"', async () => {
  // Kegagalan jaringan yang terbaca sebagai PEMBEBASAN adalah bentuk cacat
  // yang sama dengan yang `pesanLaporan` B-21 ada untuk mencegahnya.
  const { pesanPerlu } = await import(M02);
  assert.match(pesanPerlu('gagal'), /BUKAN berarti/i);
});

test('siap tidak punya pesan — daftarnya yang dirender', async () => {
  const { pesanPerlu } = await import(M02);
  assert.equal(pesanPerlu('siap'), null);
});

// --------------------------------------------------------------- ringkas --

test('⛔ bagian "perlu diperiksa" TIDAK muncul bila tidak ada temuan', async () => {
  // `spec-g:245`, acceptance criteria harfiah. Bagian yang selalu tampil
  // dengan "0 hal perlu diperiksa" mengubah layar yang menjawab satu
  // pertanyaan menjadi dasbor.
  const { ringkasTemuan } = await import(M02);
  assert.equal(ringkasTemuan(0), null);
  assert.equal(ringkasTemuan(-1), null);
});

test('ringkasan menyebut angkanya, dan tunggal berbeda dari jamak', async () => {
  const { ringkasTemuan } = await import(M02);
  assert.match(ringkasTemuan(1), /^1 hal/);
  assert.match(ringkasTemuan(9), /^9 hal/);
});

test('⛔ M-01 menampilkan maksimal tiga', async () => {
  // `IA:373`. Angkanya konstanta supaya perubahan menabraknya.
  const { MAKS_TEMUAN_M01 } = await import(M02);
  assert.equal(MAKS_TEMUAN_M01, 3);
});

// ----------------------------------------------------------------- rinci --

test('⛔ selisih kas dibaca dengan KATANYA, bukan dengan tandanya saja', async () => {
  // `− Rp 50.000` di layar 390px dibaca sekilas sebagai `Rp 50.000`, dan
  // arahnya adalah separuh artinya.
  const { rinciTemuan } = await import(M02);
  const kurang = rinciTemuan(temuan({ jenis: 'selisih_kas', nilai: '-50000', keterangan: '2026-08-23' }));
  const lebih = rinciTemuan(temuan({ jenis: 'selisih_kas', nilai: '50000', keterangan: '2026-08-23' }));
  assert.match(kurang, /kurang/i);
  assert.match(lebih, /lebih/i);
  assert.notEqual(kurang, lebih);
  // Besarannya sama; hanya katanya berbeda.
  assert.match(kurang, /Rp 50\.000/);
  assert.match(lebih, /Rp 50\.000/);
});

test('selisih kas menyebut TANGGAL BISNIS shift-nya', async () => {
  // Shift yang ditutup pukul 01:00 milik tanggal bisnis sebelumnya; tanpa
  // menyebutnya, owner memeriksa hari yang salah.
  const { rinciTemuan } = await import(M02);
  assert.match(
    rinciTemuan(temuan({ jenis: 'selisih_kas', nilai: '-1000', keterangan: '2026-08-23' })),
    /2026-08-23/
  );
});

test('⛔ pembayaran menggantung TIDAK disebut gagal', async () => {
  // Pelanggan mungkin sudah membayar (FR-C14). Menyebutnya gagal membuat
  // merchant menagih ulang orang yang sudah membayar.
  const { rinciTemuan } = await import(M02);
  const t = rinciTemuan(temuan({ jenis: 'pembayaran_menggantung', nilai: '50000', keterangan: null }));
  assert.match(t, /belum tentu gagal/i);
  assert.match(t, /Rp 50\.000/);
});

test('⛔ kuantitas oversell tidak melewati float', async () => {
  const { rinciTemuan } = await import(M02);
  assert.match(rinciTemuan(temuan({ nilai: '3000' })), /\b3 unit/);
  assert.match(rinciTemuan(temuan({ nilai: '500' })), /0,5 unit/);
  assert.match(rinciTemuan(temuan({ nilai: '2500' })), /2,5 unit/);
});

test('oversell menyebut nama produknya; yang hilang tidak jadi "null"', async () => {
  const { rinciTemuan } = await import(M02);
  assert.match(rinciTemuan(temuan({ keterangan: 'Kopi Susu' })), /Kopi Susu/);
  assert.doesNotMatch(rinciTemuan(temuan({ keterangan: null })), /null/);
});

test('outlet yang hilang tidak dibiarkan kosong', async () => {
  const { outletTampil } = await import(M02);
  assert.equal(outletTampil(temuan({ outletNama: 'Cabang Dago' })), 'Cabang Dago');
  assert.match(outletTampil(temuan({ outletNama: null })), /tidak dikenal/i);
});

// ----------------------------------------------------------------- bahasa --

test('⛔ TIDAK ADA kalimat yang menyalahkan orang', async () => {
  // `spec-g:168`. Oversell secara khusus BUKAN kesalahan — ia konsekuensi CAP
  // dan non-goal permanen; dua perangkat yang menjual barang terakhir saat
  // offline sama-sama benar.
  const { rinciTemuan, judulJenis, JUDUL_JENIS } = await import(M02);
  const semua = [
    ...Object.keys(JUDUL_JENIS).map(judulJenis),
    rinciTemuan(temuan({ jenis: 'oversell' })),
    rinciTemuan(temuan({ jenis: 'selisih_kas', nilai: '-1000', keterangan: '2026-08-23' })),
    rinciTemuan(temuan({ jenis: 'pembayaran_menggantung', nilai: '1000', keterangan: null })),
  ].join(' ').toLowerCase();

  for (const kata of [
    'salah',
    'kesalahan',
    'pelaku',
    'lalai',
    'curang',
    'mencurigakan',
    'kerugian',
    'skor',
  ]) {
    assert.ok(!semua.includes(kata), `memuat kata menuduh: ${kata}`);
  }
});

test('⛔ setiap jenis punya judulnya — tidak ada kode mentah di layar', async () => {
  const { JUDUL_JENIS, judulJenis } = await import(M02);
  for (const jenis of ['oversell', 'selisih_kas', 'pembayaran_menggantung']) {
    assert.ok(JUDUL_JENIS[jenis], jenis);
    assert.notEqual(judulJenis(jenis), jenis);
  }
  // Jenis yang belum dikenal ditampilkan apa adanya, bukan dihilangkan.
  assert.equal(judulJenis('jenis_baru'), 'jenis_baru');
});

test('⛔ catatan batas menyatakan daftarnya TERTUNGGAK, bukan harian', async () => {
  // Temuan berumur seminggu yang muncul di layar "Ringkasan Hari Ini" terbaca
  // sebagai kejadian hari ini, dan owner memeriksa shift yang salah.
  const { CATATAN_TERTUNGGAK } = await import(M02);
  assert.match(CATATAN_TERTUNGGAK, /belum beres/i);
  assert.match(CATATAN_TERTUNGGAK, /bukan hanya yang terjadi hari ini/i);
});
