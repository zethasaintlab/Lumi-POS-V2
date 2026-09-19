'use strict';

// Paginasi K-08 dan potongan katalog K-03 — aturan MURNI (TEMUAN C1/D3).
//
// ⛔ `/ds-bundle` tidak mengirim paginasi sama sekali; `<Table>`-nya diperiksa
// di sumbernya. Ini salah satu dari tiga butir peninjauan yang harus dibangun.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const modul = () => import('../../apps/kasir/src/komponen/halaman.ts');
const angka = (n) => Array.from({ length: n }, (_, i) => i + 1);

test('halaman pertama, tengah, dan terakhir', async () => {
  const { potongHalaman } = await modul();
  const d = angka(137);

  assert.deepEqual(potongHalaman(d, 1, 25).baris.slice(0, 2), [1, 2]);
  assert.equal(potongHalaman(d, 1, 25).rentang, '1–25 dari 137');
  assert.equal(potongHalaman(d, 3, 25).rentang, '51–75 dari 137');

  // Halaman terakhir TIDAK penuh — 137 = 5×25 + 12.
  const akhir = potongHalaman(d, 6, 25);
  assert.equal(akhir.baris.length, 12);
  assert.equal(akhir.rentang, '126–137 dari 137', 'rentang halaman tidak penuh salah');
  assert.equal(akhir.jumlahHalaman, 6);
});

test('⛔ nomor di luar jangkauan DI-CLAMP, tidak melempar dan tidak kosong', async () => {
  const { potongHalaman } = await modul();
  // Keadaan nyata: kasir di halaman 6, lalu mengetik pencarian yang menyisakan
  // 8 baris. Daftar kosong di sana tidak dapat dibedakan dari "tidak ada hasil".
  const h = potongHalaman(angka(8), 6, 25);
  assert.equal(h.nomor, 1);
  assert.equal(h.baris.length, 8);
});

test('⛔ daftar kosong → "halaman 1 dari 1", bukan "dari 0"', async () => {
  const { potongHalaman } = await modul();
  const h = potongHalaman([], 1, 25);
  assert.equal(h.jumlahHalaman, 1, '"Halaman 1 dari 0" tidak dapat dibaca siapa pun');
  assert.equal(h.nomor, 1);
  assert.equal(h.total, 0);
  assert.equal(h.rentang, 'Tidak ada baris');
});

test('nomor yang tidak masuk akal tidak meruntuhkan apa pun', async () => {
  const { potongHalaman } = await modul();
  for (const buruk of [0, -3, NaN, 1.7]) {
    const h = potongHalaman(angka(60), buruk, 25);
    assert.ok(h.nomor >= 1 && h.nomor <= h.jumlahHalaman, `nomor ${buruk} → ${h.nomor}`);
    assert.ok(h.baris.length > 0);
  }
});

test('⛔ potongHalaman tidak mengubah daftar aslinya', async () => {
  const { potongHalaman } = await modul();
  const asli = angka(30);
  potongHalaman(asli, 2, 25);
  assert.equal(asli.length, 30);
  assert.equal(asli[0], 1);
});

test('nomor halaman: ≤7 ditampilkan utuh, lebih dari itu memakai elipsis', async () => {
  const { nomorHalaman } = await modul();

  assert.deepEqual(nomorHalaman(3, 7), [1, 2, 3, 4, 5, 6, 7], 'tujuh halaman muat utuh');

  const tengah = nomorHalaman(10, 20);
  assert.deepEqual(tengah, [1, null, 9, 10, 11, null, 20]);

  // Awal dan akhir tidak boleh punya elipsis di sisi yang rapat.
  assert.deepEqual(nomorHalaman(1, 20), [1, 2, null, 20]);
  assert.deepEqual(nomorHalaman(20, 20), [1, null, 19, 20]);
});

test('⛔ celah SATU halaman dirender apa adanya, bukan sebagai elipsis', async () => {
  const { nomorHalaman } = await modul();
  // Elipsis yang menyembunyikan tepat satu nomor memakan ruang yang sama dan
  // menghilangkan satu tujuan.
  const hasil = nomorHalaman(3, 20);
  assert.deepEqual(hasil, [1, 2, 3, 4, null, 20]);
  assert.ok(!hasil.includes(null) || hasil.indexOf(null) > 3);
});

test('setiap nomor yang ditampilkan ada di dalam jangkauan', async () => {
  const { nomorHalaman } = await modul();
  for (const jumlah of [1, 2, 7, 8, 15, 137]) {
    for (const n of [1, Math.ceil(jumlah / 2), jumlah]) {
      for (const x of nomorHalaman(n, jumlah)) {
        if (x === null) continue;
        assert.ok(x >= 1 && x <= jumlah, `${x} di luar 1..${jumlah}`);
      }
      // Halaman yang sedang dibuka SELALU ada di bilahnya — kalau tidak, kasir
      // tidak dapat melihat di mana ia berada.
      assert.ok(nomorHalaman(n, jumlah).includes(n), `halaman aktif ${n} tidak ditampilkan`);
    }
  }
});

test('batas katalog jauh di atas 12 kartu yang IA:53 tuntut', async () => {
  const { PER_MUAT_KATALOG } = await modul();
  assert.ok(
    PER_MUAT_KATALOG >= 12 * 3,
    'batas ini menahan ongkos render, BUKAN memecah menu — merchant kecil ' +
      'tidak boleh pernah melihat tombol "muat lebih banyak"'
  );
});
