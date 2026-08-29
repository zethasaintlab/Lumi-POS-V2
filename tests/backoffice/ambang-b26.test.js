'use strict';

// B-26 — aturan tampilan Ambang Otorisasi.
//
// Murni: form masuk → muatan keluar. Yang di sini dapat diuji tanpa DOM dan
// tanpa server.
//
// ⛔ Yang dijaga paling keras: KOSONG, NOL, dan SALAH KETIK adalah tiga hal
// yang berbeda, dan ketiganya masuk lewat isian teks yang sama. Kosong berarti
// "pakai bawaan"; nol berarti "setiap kejadian menuntut otorisasi"; salah ketik
// harus ditolak alih-alih diam-diam menjadi salah satunya. `bacaRupiah`
// mengembalikan `null` untuk KEDUA kasus pertama dan ketiga — menyamakannya
// membuat salah ketik tersimpan sebagai "kembali ke bawaan", dan ambang yang
// merchant kira ia naikkan justru turun.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../apps/backoffice/src/pengaturan/b26.ts';

const KOSONG = { diskonPersen: '', diskonNominal: '', selisihKas: '', noSale: '' };

// ---------------------------------------------------------------------------
// Kosong / nol / cacat
// ---------------------------------------------------------------------------

test('⛔ form kosong menghasilkan muatan yang seluruhnya null', async () => {
  const { buatMuatanAmbang } = await import(MOD);
  const hasil = buatMuatanAmbang(KOSONG);
  assert.ok(hasil.ok);
  assert.deepEqual(hasil.muatan, {
    diskonPersenSkala: null,
    diskonNominal: null,
    selisihKas: null,
    noSale: null,
  });
});

test('⛔ NOL bukan kosong', async () => {
  const { buatMuatanAmbang } = await import(MOD);
  const hasil = buatMuatanAmbang({ ...KOSONG, selisihKas: '0', noSale: '0' });
  assert.ok(hasil.ok);
  assert.equal(hasil.muatan.selisihKas, '0');
  assert.equal(hasil.muatan.noSale, 0);
});

test('⛔ salah ketik DITOLAK, tidak diam-diam menjadi "kembali ke bawaan"', async () => {
  // `bacaRupiah('abc')` adalah `null`, sama dengan `bacaRupiah('')`.
  // Menyamakannya membuat ambang yang merchant kira ia naikkan justru turun.
  const { buatMuatanAmbang } = await import(MOD);
  for (const buruk of ['abc', '20.5', '-']) {
    const hasil = buatMuatanAmbang({ ...KOSONG, selisihKas: buruk });
    assert.equal(hasil.ok, false, `diterima: ${buruk}`);
    assert.equal(hasil.bidang, 'selisihKas');
  }
});

test('jumlah pembukaan laci harus bilangan bulat', async () => {
  const { buatMuatanAmbang } = await import(MOD);
  for (const buruk of ['3,5', 'tiga', '-1']) {
    assert.equal(buatMuatanAmbang({ ...KOSONG, noSale: buruk }).ok, false, `diterima: ${buruk}`);
  }
});

// ---------------------------------------------------------------------------
// Persen
// ---------------------------------------------------------------------------

test('⛔ persen memakai KOMA maupun titik, dua digit desimal', async () => {
  // Digit desimalnya diturunkan dari skalanya (10.000 → tepat dua), aturan
  // yang sama dengan `parseNilaiDiskon`. Merchant Indonesia mengetik koma, dan
  // menolaknya membuat layar terasa rusak.
  const { persenKeSkala } = await import(MOD);
  assert.equal(persenKeSkala('20'), 2000n);
  assert.equal(persenKeSkala('20,5'), 2050n);
  assert.equal(persenKeSkala('20.5'), 2050n);
  assert.equal(persenKeSkala('0'), 0n);
  assert.equal(persenKeSkala('100'), 10000n);
  assert.equal(persenKeSkala(''), null);
  assert.equal(persenKeSkala('20,555'), null, 'tiga desimal tidak muat di skala 10.000');
});

test('persen bolak-balik tanpa kehilangan nilai', async () => {
  const { persenKeSkala, skalaKePersen } = await import(MOD);
  for (const teks of ['20', '20,5', '0', '100', '7,25']) {
    assert.equal(skalaKePersen(persenKeSkala(teks)), teks.replace('.', ','), teks);
  }
});

test('persen di atas 100% ditolak lewat aturan DOMAIN', async () => {
  const { buatMuatanAmbang } = await import(MOD);
  const hasil = buatMuatanAmbang({ ...KOSONG, diskonPersen: '150' });
  assert.equal(hasil.ok, false);
  assert.equal(hasil.bidang, 'diskonPersen');
});

// ---------------------------------------------------------------------------
// ⛔ Bawaan tidak disalin
// ---------------------------------------------------------------------------

test('⛔ form dari respons: yang null tetap KOSONG, bukan diisi bawaan', async () => {
  // Mengisi otomatis dengan angka bawaan menghapus pilihan "ikuti bawaan"
  // diam-diam: sekali disimpan, outlet berhenti mengikuti bawaan selamanya,
  // dan tidak ada apa pun di layar yang berbeda.
  const { formDariTersimpan } = await import(MOD);
  assert.deepEqual(
    formDariTersimpan({
      diskonPersenSkala: null,
      diskonNominal: null,
      selisihKas: null,
      noSale: null,
    }),
    KOSONG
  );
});

test('form dari respons mengembalikan nilai yang disetel', async () => {
  const { formDariTersimpan } = await import(MOD);
  assert.deepEqual(
    formDariTersimpan({
      diskonPersenSkala: '2050',
      diskonNominal: '75000',
      selisihKas: '0',
      noSale: 6,
    }),
    { diskonPersen: '20,5', diskonNominal: '75000', selisihKas: '0', noSale: '6' }
  );
});

test('⛔ teks bawaan di layar DIBACA dari domain, tidak ditulis tangan', async () => {
  // Angka bawaan yang disalin ke teks layar akan menyimpang saat bawaannya
  // berubah — dan yang menyimpang membuat merchant menyetel ambang berdasarkan
  // angka yang sudah tidak berlaku.
  const { BAWAAN_TAMPIL } = await import(MOD);
  const { AMBANG_BAWAAN } = await import('../../packages/domain/src/ambang.ts');
  assert.ok(BAWAAN_TAMPIL.selisihKas.includes('20.000'), BAWAAN_TAMPIL.selisihKas);
  assert.equal(BAWAAN_TAMPIL.noSale, `${AMBANG_BAWAAN.noSale}×`);
});

// ---------------------------------------------------------------------------
// Ringkasan "yang berlaku"
// ---------------------------------------------------------------------------

test('⛔ asal setiap ambang disebut: bawaan atau disetel outlet', async () => {
  // "Rp 20.000 (bawaan)" dan "Rp 20.000 (disetel outlet ini)" berperilaku sama
  // hari ini dan berbeda pada hari bawaannya berubah — dan yang membaca layar
  // ini adalah orang yang memutuskan apakah perlu mengubahnya.
  const { ringkasBerlaku } = await import(MOD);
  const baris = ringkasBerlaku({
    diskonPersenSkala: null,
    diskonNominal: null,
    selisihKas: '20000',
    noSale: null,
  });
  const selisih = baris.find((b) => b.label.includes('Selisih kas'));
  const diskon = baris.find((b) => b.label.includes('Diskon'));
  // Nilainya SAMA, asalnya berbeda — itu yang dijaga.
  assert.equal(selisih.nilai, 'Rp 20.000');
  assert.equal(selisih.asal, 'outlet');
  assert.equal(diskon.asal, 'bawaan');
});

test('nol tampil sebagai nol, dan asalnya tetap outlet', async () => {
  const { ringkasBerlaku } = await import(MOD);
  const baris = ringkasBerlaku({
    diskonPersenSkala: null,
    diskonNominal: null,
    selisihKas: '0',
    noSale: 0,
  });
  const selisih = baris.find((b) => b.label.includes('Selisih kas'));
  assert.equal(selisih.nilai, 'Rp 0');
  assert.equal(selisih.asal, 'outlet');
  assert.equal(baris.find((b) => b.label.includes('Buka laci')).asal, 'outlet');
});

// ---------------------------------------------------------------------------
// ⛔ Klien dan server memakai aturan yang sama
// ---------------------------------------------------------------------------

test('⛔ batas yang klien terapkan adalah `periksaAmbang` DOMAIN', async () => {
  // Salinan di klien akan menyimpang, dan yang menyimpang menghasilkan layar
  // yang menerima angka yang server tolak — penolakan yang datang setelah
  // tombol simpan ditekan terbaca sebagai kerusakan, bukan sebagai aturan.
  //
  // Dibuktikan dengan menjalankan keduanya atas nilai yang sama.
  const { buatMuatanAmbang } = await import(MOD);
  const { periksaAmbang, BATAS_SELISIH_KAS } = await import('../../packages/domain/src/ambang.ts');

  for (const nilai of [0n, 1n, BATAS_SELISIH_KAS, BATAS_SELISIH_KAS + 1n]) {
    const lewatKlien = buatMuatanAmbang({ ...KOSONG, selisihKas: String(nilai) });
    const lewatDomain = periksaAmbang({
      diskonPersenSkala: null,
      diskonNominal: null,
      selisihKas: nilai,
      noSale: null,
    });
    assert.equal(lewatKlien.ok, lewatDomain.ok, `beda putusan untuk ${nilai}`);
    if (!lewatKlien.ok) assert.equal(lewatKlien.pesan, lewatDomain.pesan);
  }
});
