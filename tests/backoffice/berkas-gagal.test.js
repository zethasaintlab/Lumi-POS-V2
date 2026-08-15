'use strict';

// FR-A8, AC keempat: *"File berisi baris gagal dapat diunduh, diperbaiki, dan
// diunggah ulang"* (`spec-a:288`).
//
// Ini satu-satunya acceptance criterion FR-A8 yang tidak pernah dibangun —
// parser dan endpointnya selesai lebih dulu, tapi berkas perbaikan menuntut
// klien, karena SERVER TIDAK PERNAH MELIHAT baris aslinya. Yang dikembalikan
// server hanyalah `{ baris, alasan }`; isi barisnya ada di berkas yang
// dipegang merchant.
//
// ⛔ "Diunggah ulang" diuji sebagai PERJALANAN PULANG-PERGI, bukan sebagai
// bentuk string. Berkas yang terlihat benar tapi ditolak parser saat diunggah
// ulang memenuhi setengah AC ini dan gagal pada setengah yang menentukan.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../apps/backoffice/src/impor/berkas-gagal.ts';
const IMPOR = '../../packages/domain/src/impor-katalog.ts';

const CSV = [
  'nama,kategori,harga',
  'Kopi Susu,Minuman,25000', // baris 2 — sah
  ',Minuman,15000', // baris 3 — nama kosong
  'Roti Bakar,Makanan,abc', // baris 4 — harga bukan angka
  'Teh Manis,Minuman,10000', // baris 5 — sah
].join('\n');

const MASALAH = [
  { baris: 3, alasan: 'Nama produk kosong.' },
  { baris: 4, alasan: 'Harga tidak valid: "abc".' },
];

// ---------------------------------------------------------------------------

test('berkas gagal memuat header + HANYA baris yang bermasalah', async () => {
  const { bangunBerkasGagal } = await import(MOD);
  const hasil = bangunBerkasGagal(CSV, MASALAH);
  const baris = hasil.split('\n');

  assert.equal(baris.length, 3, 'harus header + dua baris gagal');
  assert.match(baris[0], /^nama,kategori,harga/);
  assert.match(baris[1], /^,Minuman,15000/);
  assert.match(baris[2], /^Roti Bakar,Makanan,abc/);

  assert.ok(!hasil.includes('Kopi Susu'), 'baris yang SAH ikut terbawa');
  assert.ok(!hasil.includes('Teh Manis'), 'baris yang SAH ikut terbawa');
});

test('⛔ isi baris asli dibawa APA ADANYA, tidak disusun ulang', async () => {
  // Server hanya mengembalikan nomor baris dan alasannya — ia tidak pernah
  // melihat isi barisnya. Menyusun ulang dari data yang diparse mustahil di
  // sini, dan kalaupun mungkin, ia akan menghapus tepat kolom yang tidak
  // dikenali parser — kolom yang mungkin justru sedang diperbaiki merchant.
  const { bangunBerkasGagal } = await import(MOD);
  const csv = [
    'nama,kategori,harga,catatan internal',
    '"Kopi, Susu",Minuman,abc,"jangan dihapus"',
  ].join('\n');

  const hasil = bangunBerkasGagal(csv, [{ baris: 2, alasan: 'Harga tidak valid.' }]);
  assert.ok(hasil.includes('"Kopi, Susu",Minuman,abc,"jangan dihapus"'), hasil);
});

test('⛔ kolom `alasan` DITAMBAHKAN — merchant harus tahu apa yang diperbaiki', async () => {
  const { bangunBerkasGagal } = await import(MOD);
  const hasil = bangunBerkasGagal(CSV, MASALAH);

  assert.match(hasil.split('\n')[0], /alasan$/, 'header tidak punya kolom alasan');
  assert.ok(hasil.includes('Nama produk kosong.'), 'alasan baris 3 hilang');
  assert.ok(hasil.includes('Harga tidak valid'), 'alasan baris 4 hilang');
});

test('⛔ alasan yang memuat koma atau kutip TIDAK merusak CSV-nya', async () => {
  const { bangunBerkasGagal } = await import(MOD);
  const hasil = bangunBerkasGagal(CSV, [
    { baris: 3, alasan: 'Harga tidak valid: "abc", pakai angka saja.' },
  ]);
  const { pratinjauImpor } = await import(IMPOR);

  // Yang membuktikan lolosnya bukan bentuk stringnya, melainkan parser yang
  // sama masih dapat membacanya.
  const ulang = pratinjauImpor(hasil);
  assert.equal(ulang.galatBerkas, null, hasil);
  assert.equal(ulang.jumlahBaris, 1);
});

// --- ⛔ perjalanan pulang-pergi --------------------------------------------

test('⛔ berkas gagal dapat DIUNGGAH ULANG dan diparse tanpa galat berkas', async () => {
  // AC `spec-a:288`, bagian yang menentukan. Kolom `alasan` yang ditambahkan
  // tidak boleh membuat parser menolak berkasnya — `petakanKolom` mencari
  // kolom berdasarkan NAMA dan mengabaikan yang tidak dikenal, dan itu
  // dibuktikan di sini alih-alih diasumsikan dari membaca kodenya.
  const { bangunBerkasGagal } = await import(MOD);
  const { pratinjauImpor } = await import(IMPOR);

  const berkas = bangunBerkasGagal(CSV, MASALAH);
  const ulang = pratinjauImpor(berkas);

  assert.equal(ulang.galatBerkas, null, `berkas perbaikan ditolak parser:\n${berkas}`);
  assert.equal(ulang.jumlahBaris, 2, 'jumlah baris data berubah');
  // Keduanya masih bermasalah — belum diperbaiki siapa pun.
  assert.equal(ulang.masalah.length, 2);
});

test('⛔ setelah DIPERBAIKI, berkas yang sama diterima seluruhnya', async () => {
  // Perjalanan penuh: unduh → perbaiki → unggah ulang → semua valid. Inilah
  // kalimat AC-nya, dijalankan.
  const { bangunBerkasGagal } = await import(MOD);
  const { pratinjauImpor } = await import(IMPOR);

  const berkas = bangunBerkasGagal(CSV, MASALAH);
  const diperbaiki = berkas
    .replace(',Minuman,15000', 'Es Jeruk,Minuman,15000')
    .replace('Roti Bakar,Makanan,abc', 'Roti Bakar,Makanan,18000');

  const ulang = pratinjauImpor(diperbaiki);
  assert.equal(ulang.galatBerkas, null);
  assert.deepEqual(ulang.masalah, [], 'masih ada baris bermasalah setelah diperbaiki');
  assert.equal(ulang.valid.length, 2);
  assert.deepEqual(ulang.valid.map((v) => v.nama).sort(), ['Es Jeruk', 'Roti Bakar']);
});

// --- tepi -------------------------------------------------------------------

test('nol masalah → `null`, bukan berkas berisi header saja', async () => {
  // Berkas yang hanya berisi header terunduh sebagai berkas kosong yang
  // membingungkan. Tidak ada yang gagal berarti tidak ada yang perlu diunduh.
  const { bangunBerkasGagal } = await import(MOD);
  assert.equal(bangunBerkasGagal(CSV, []), null);
});

test('⛔ nomor baris di luar jangkauan DILEWATI, tidak melempar', async () => {
  // Nomor baris datang dari server; berkas yang dipegang klien bisa saja
  // sudah berganti (merchant memilih berkas lain sebelum mengunduh). Melempar
  // di sini membuat satu ketidaksesuaian menjatuhkan seluruh layar.
  const { bangunBerkasGagal } = await import(MOD);
  const hasil = bangunBerkasGagal(CSV, [
    { baris: 3, alasan: 'sah' },
    { baris: 999, alasan: 'di luar jangkauan' },
    { baris: 0, alasan: 'header, bukan data' },
  ]);
  assert.equal(hasil.split('\n').length, 2, 'header + satu baris yang benar-benar ada');
});

test('CRLF dan BOM dari Excel tidak terbawa ke berkas hasil', async () => {
  const { bangunBerkasGagal } = await import(MOD);
  const { pratinjauImpor } = await import(IMPOR);
  const csvWindows = '﻿' + CSV.split('\n').join('\r\n');

  const hasil = bangunBerkasGagal(csvWindows, MASALAH);
  assert.ok(!hasil.includes('\r'), 'CR masih ada');
  assert.ok(!hasil.startsWith('﻿'), 'BOM masih ada');
  assert.equal(pratinjauImpor(hasil).galatBerkas, null);
});

test('nama berkas unduhan menyebut berkas asalnya', async () => {
  const { namaBerkasGagal } = await import(MOD);
  assert.equal(namaBerkasGagal('katalog-moka.csv'), 'katalog-moka-gagal.csv');
  assert.equal(namaBerkasGagal('produk'), 'produk-gagal.csv');
  assert.equal(namaBerkasGagal(''), 'baris-gagal.csv');
});
