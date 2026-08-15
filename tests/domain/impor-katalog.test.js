'use strict';

// FR-A8 — impor katalog (`spec-a:252`).
//
// "Ini FITUR AKUISISI, bukan utilitas admin — migrasi katalog adalah biaya
// switching terbesar bagi merchant yang pindah dari kompetitor."
//
// Yang diuji di sini adalah PARSER dan VALIDATOR: murni, tanpa I/O. Unggah
// berkas dan unduh baris gagal adalah permukaan back-office yang belum ada.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../packages/domain/src/impor-katalog.ts';

const HEADER = 'nama,kategori,harga';

function csv(...baris) {
  return [HEADER, ...baris].join('\n');
}

// --- parsing harga: jalur uang, diuji lebih dulu ---------------------------

test('⛔ harga bergaya Indonesia: titik sebagai pemisah ribuan', async () => {
  const { parseHarga } = await import(MOD);
  assert.equal(parseHarga('25000'), 25000);
  assert.equal(parseHarga('25.000'), 25000);
  assert.equal(parseHarga('1.234.567'), 1234567);
  assert.equal(parseHarga(' 25.000 '), 25000, 'spasi di tepi harus diabaikan');
  assert.equal(parseHarga('Rp 25.000'), 25000, 'awalan Rp lazim di ekspor kompetitor');
});

test('⛔ titik yang BUKAN pemisah ribuan DITOLAK, tidak ditebak', async () => {
  // "25.5" yang dibaca sebagai 255 adalah kesalahan 10×, dan ia tidak
  // menghasilkan error apa pun — merchant baru menemukannya saat pelanggan
  // membayar. Pengelompokan harus TEPAT tiga digit.
  const { parseHarga } = await import(MOD);
  for (const buruk of ['25.5', '25.50', '1.23', '25.0000', '1.2345']) {
    assert.equal(parseHarga(buruk), null, `${buruk} seharusnya ditolak`);
  }
});

test('⛔ desimal ditolak — rupiah selalu bilangan bulat', async () => {
  const { parseHarga } = await import(MOD);
  for (const buruk of ['25000,50', '25,5', '25000.50']) {
    assert.equal(parseHarga(buruk), null, `${buruk} seharusnya ditolak`);
  }
});

test('harga tak masuk akal ditolak', async () => {
  const { parseHarga } = await import(MOD);
  assert.equal(parseHarga(''), null);
  assert.equal(parseHarga('gratis'), null);
  assert.equal(parseHarga('-5000'), null, 'harga negatif bukan harga');
  assert.equal(parseHarga('0'), 0, 'nol SAH — produk gratis ada');
});

// --- CSV -------------------------------------------------------------------

test('membaca baris, mengabaikan baris kosong', async () => {
  const { pratinjauImpor } = await import(MOD);
  const hasil = pratinjauImpor(csv('Kopi Susu,Minuman,25000', '', 'Roti,Makanan,15000'));
  assert.equal(hasil.valid.length, 2);
  assert.deepEqual(hasil.masalah, []);
});

test('⛔ field berkutip dengan koma di dalamnya', async () => {
  // Nama produk bisa memuat koma, dan parser naif memecahnya jadi dua kolom —
  // harga bergeser ke kolom yang salah dan seluruh baris ditolak dengan
  // alasan yang membingungkan.
  const { pratinjauImpor } = await import(MOD);
  const hasil = pratinjauImpor(csv('"Kopi Susu, Gula Aren",Minuman,25000'));
  assert.deepEqual(hasil.masalah, []);
  assert.equal(hasil.valid[0].nama, 'Kopi Susu, Gula Aren');
});

test('kutip ganda di dalam field', async () => {
  const { pratinjauImpor } = await import(MOD);
  const hasil = pratinjauImpor(csv('"Kopi ""Spesial""",Minuman,25000'));
  assert.equal(hasil.valid[0].nama, 'Kopi "Spesial"');
});

test('CRLF dan BOM tidak menjatuhkan parser', async () => {
  // Ekspor dari Excel di Windows membawa keduanya.
  const { pratinjauImpor } = await import(MOD);
  const teks = '﻿' + [HEADER, 'Kopi,Minuman,25000'].join('\r\n');
  const hasil = pratinjauImpor(teks);
  assert.deepEqual(hasil.masalah, []);
  assert.equal(hasil.valid[0].nama, 'Kopi');
});

// --- aturan penanganan error (spec-a:274) ----------------------------------

test('⛔ nomor baris yang dilaporkan adalah nomor baris BERKAS', async () => {
  // Merchant memperbaikinya di spreadsheet, dan di sana header adalah baris 1.
  // Indeks larik data akan menunjuk baris yang salah — dan merchant yang
  // memperbaiki baris yang salah membuat impor kedua gagal juga.
  const { pratinjauImpor } = await import(MOD);
  const hasil = pratinjauImpor(csv('Kopi,Minuman,25000', ',Minuman,15000'));
  assert.equal(hasil.masalah.length, 1);
  assert.equal(hasil.masalah[0].baris, 3, 'baris ke-3 di berkas: header + 2 data');
});

test('nama kosong ditolak dan dilaporkan', async () => {
  const { pratinjauImpor } = await import(MOD);
  const hasil = pratinjauImpor(csv('   ,Minuman,25000'));
  assert.equal(hasil.valid.length, 0);
  assert.match(hasil.masalah[0].alasan, /nama/i);
});

test('harga bukan angka ditolak dan dilaporkan dengan alasannya', async () => {
  const { pratinjauImpor } = await import(MOD);
  const hasil = pratinjauImpor(csv('Kopi,Minuman,gratis'));
  assert.equal(hasil.valid.length, 0);
  assert.match(hasil.masalah[0].alasan, /harga/i);
  assert.match(hasil.masalah[0].alasan, /gratis/, 'alasan harus menyebut nilai yang ditolak');
});

test('⛔ kategori yang belum ada DIBUAT, dan dicatat di ringkasan', async () => {
  const { pratinjauImpor } = await import(MOD);
  const hasil = pratinjauImpor(csv('Kopi,Minuman,25000', 'Roti,Makanan,15000'), {
    kategoriAda: ['Minuman'],
  });
  assert.deepEqual(hasil.kategoriBaru, ['Makanan']);
  assert.equal(hasil.valid.length, 2, 'kategori baru tidak boleh menolak barisnya');
});

test('⛔ nama DUPLIKAT dalam berkas: baris KEDUA ditolak', async () => {
  const { pratinjauImpor } = await import(MOD);
  const hasil = pratinjauImpor(csv('Kopi,Minuman,25000', 'Kopi,Minuman,30000'));
  assert.equal(hasil.valid.length, 1);
  assert.equal(hasil.valid[0].harga, 25000, 'yang PERTAMA yang dipertahankan');
  assert.equal(hasil.masalah[0].baris, 3);
  assert.match(hasil.masalah[0].alasan, /duplikat/i);
});

test('duplikat tidak peka huruf besar-kecil dan spasi tepi', async () => {
  const { pratinjauImpor } = await import(MOD);
  const hasil = pratinjauImpor(csv('Kopi Susu,Minuman,25000', '  kopi susu ,Minuman,30000'));
  assert.equal(hasil.valid.length, 1);
  assert.match(hasil.masalah[0].alasan, /duplikat/i);
});

test('⛔ nama yang SUDAH ADA di katalog: lewati semua', async () => {
  const { pratinjauImpor } = await import(MOD);
  const hasil = pratinjauImpor(csv('Kopi,Minuman,25000', 'Roti,Makanan,15000'), {
    namaAda: ['Kopi'],
    bilaSudahAda: 'lewati',
  });
  assert.equal(hasil.valid.length, 1);
  assert.equal(hasil.valid[0].nama, 'Roti');
  assert.equal(hasil.dilewati.length, 1);
  // ⛔ Dilewati BUKAN masalah — merchant sudah memutuskannya di awal.
  assert.deepEqual(hasil.masalah, []);
});

test('⛔ nama yang SUDAH ADA: perbarui semua', async () => {
  const { pratinjauImpor } = await import(MOD);
  const hasil = pratinjauImpor(csv('Kopi,Minuman,25000'), {
    namaAda: ['Kopi'],
    bilaSudahAda: 'perbarui',
  });
  assert.equal(hasil.valid.length, 1);
  assert.equal(hasil.valid[0].perbarui, true, 'baris harus ditandai sebagai pembaruan');
});

test('⛔ TIDAK ADA impor parsial diam-diam (AC ketiga)', async () => {
  // Setiap baris masuk tepat satu kelompok: valid, dilewati, atau bermasalah.
  // Baris yang hilang dari ketiganya adalah baris yang tidak diimpor dan
  // tidak dilaporkan — persis yang AC ini larang.
  const { pratinjauImpor } = await import(MOD);
  const hasil = pratinjauImpor(
    csv('Kopi,Minuman,25000', ',Minuman,1', 'Roti,Makanan,abc', 'Kopi,Minuman,9', 'Teh,Minuman,5000'),
    { namaAda: ['Teh'], bilaSudahAda: 'lewati' }
  );
  const total = hasil.valid.length + hasil.dilewati.length + hasil.masalah.length;
  assert.equal(total, 5, `5 baris data, terhitung ${total}`);
  assert.equal(hasil.jumlahBaris, 5);
});

test('header yang tidak dikenal dilaporkan, bukan diam-diam menghasilkan nol baris', async () => {
  const { pratinjauImpor } = await import(MOD);
  const hasil = pratinjauImpor('produk;kategori;harga\nKopi;Minuman;25000');
  assert.equal(hasil.valid.length, 0);
  assert.ok(hasil.galatBerkas, 'berkas tanpa kolom yang dikenal harus dilaporkan sebagai galat BERKAS');
  assert.match(hasil.galatBerkas, /kolom/i);
});

test('kolom boleh berurutan bebas, dan namanya tidak peka huruf', async () => {
  const { pratinjauImpor } = await import(MOD);
  const hasil = pratinjauImpor('HARGA,Nama,Kategori\n25000,Kopi,Minuman');
  assert.deepEqual(hasil.masalah, []);
  assert.equal(hasil.valid[0].nama, 'Kopi');
  assert.equal(hasil.valid[0].harga, 25000);
});

test('kategori kosong SAH — produk tanpa kategori', async () => {
  const { pratinjauImpor } = await import(MOD);
  const hasil = pratinjauImpor(csv('Kopi,,25000'));
  assert.deepEqual(hasil.masalah, []);
  assert.equal(hasil.valid[0].kategori, null);
  assert.deepEqual(hasil.kategoriBaru, [], 'kategori kosong tidak boleh dibuat');
});

test('⛔ 5.000 baris diproses jauh di bawah 60 detik (AC kelima)', async () => {
  const { pratinjauImpor } = await import(MOD);
  const baris = [];
  for (let i = 0; i < 5000; i += 1) baris.push(`Produk ${i},Kategori ${i % 20},${(i + 1) * 100}`);

  const mulai = process.hrtime.bigint();
  const hasil = pratinjauImpor(csv(...baris));
  const ms = Number(process.hrtime.bigint() - mulai) / 1e6;

  assert.equal(hasil.valid.length, 5000);
  assert.ok(ms < 2000, `${ms.toFixed(0)} ms — jauh dari ambang 60 detik, tapi ini bukan angka wajar`);
});
