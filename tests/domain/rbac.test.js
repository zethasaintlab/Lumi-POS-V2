'use strict';

// T3.3 (docs/superpowers/plans/PLAN-modul-f-identitas.md) -- matriks hak akses
// `spec-f:38-53`.
//
// Diuji sebagai TABEL, bukan sebagai contoh: setiap sel di spec punya satu
// assertion. Menguji beberapa kombinasi yang menarik saja akan meloloskan
// matriks yang benar di tempat yang diperiksa dan salah di tempat lain --
// dan sel yang salah di sini berarti kasir yang dapat menyetujui refund-nya
// sendiri.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../packages/domain/src/rbac.ts';

const PERAN = ['owner', 'area_manager', 'outlet_manager', 'cashier', 'accountant'];

// Disalin dari tabel `spec-f:38-53`, kolom berurutan seperti di spec.
// Urutannya sengaja dipertahankan supaya baris di bawah dapat dibaca
// berdampingan dengan dokumennya saat diperiksa ulang.
//                            owner  area   outlet cashier accountant
const MATRIKS_SPEC = {
  sale:                      [true,  true,  true,  true,  false],
  void_refund:               [true,  true,  true,  true,  false],
  approve_authorization:     [true,  true,  true,  false, false],
  shift_open_close:          [true,  true,  true,  true,  false],
  approve_cash_variance:     [true,  true,  true,  false, false],
  catalog_edit:              [true,  true,  false, false, false],
  price_edit:                [true,  true,  false, false, false],
  stock_adjust:              [true,  true,  true,  false, false],
  view_margin:               [true,  true,  true,  false, true],
  report_exception:          [true,  true,  true,  false, true],
  tax_settings:              [true,  false, false, false, false],
  billing:                   [true,  false, false, false, false],
  device_revoke:             [true,  true,  true,  false, false],
};

test('bolehkah: setiap sel matriks spec-f:38-53', async () => {
  const { bolehkah } = await import(MOD);

  for (const [operasi, baris] of Object.entries(MATRIKS_SPEC)) {
    baris.forEach((diharapkan, i) => {
      assert.equal(
        bolehkah([PERAN[i]], operasi),
        diharapkan,
        `${PERAN[i]} × ${operasi} seharusnya ${diharapkan}`
      );
    });
  }
});

test('bolehkah: beberapa peran digabung dengan OR', async () => {
  const { bolehkah } = await import(MOD);

  // Manajer outlet yang juga kasir di outlet lain adalah hal biasa
  // (`spec-f:139` menyebut kasus sebaliknya: manajer yang juga membuka
  // laporan dari laptop). Hak akses adalah gabungan, bukan yang paling
  // sempit -- yang paling sempit akan mencabut hak yang sudah diberikan.
  assert.equal(bolehkah(['cashier', 'outlet_manager'], 'approve_authorization'), true);
  assert.equal(bolehkah(['cashier', 'accountant'], 'billing'), false);
  assert.equal(bolehkah([], 'sale'), false, 'tanpa peran, tidak boleh apa pun');
});

test('bolehkah: operasi yang tidak dikenal DITOLAK, bukan diizinkan', async () => {
  const { bolehkah } = await import(MOD);

  // Fail-closed. Kalau operasi baru ditambahkan di endpoint tapi lupa
  // didaftarkan di matriks, ia harus tertutup untuk semua orang -- bukan
  // terbuka untuk semua orang. Yang kedua adalah kegagalan diam-diam yang
  // hanya terlihat setelah dipakai.
  assert.equal(bolehkah(['owner'], 'operasi_yang_belum_ada'), false);
});

test('bolehKelolaPengguna: manajer outlet HANYA boleh mengelola kasir', async () => {
  const { bolehKelolaPengguna } = await import(MOD);

  // Sel "Kasir saja" di `spec-f:50` adalah satu-satunya sel bersyarat di
  // seluruh matriks, dan karena itu ia tidak muat sebagai boolean.
  assert.equal(bolehKelolaPengguna(['outlet_manager'], 'cashier'), true);
  assert.equal(bolehKelolaPengguna(['outlet_manager'], 'outlet_manager'), false);
  assert.equal(bolehKelolaPengguna(['outlet_manager'], 'owner'), false);

  assert.equal(bolehKelolaPengguna(['owner'], 'owner'), true);
  assert.equal(bolehKelolaPengguna(['area_manager'], 'outlet_manager'), true);
  assert.equal(bolehKelolaPengguna(['cashier'], 'cashier'), false);
  assert.equal(bolehKelolaPengguna(['accountant'], 'cashier'), false);
});

test('property: Akuntan tidak dapat melakukan MUTASI apa pun (spec-f:82)', async () => {
  const { bolehkah, OPERASI_MUTASI } = await import(MOD);

  // AC-nya berbunyi "seluruh endpoint mutasi menolak". Ditulis sebagai
  // property atas daftar operasi, bukan sebagai contoh: operasi mutasi yang
  // ditambahkan kelak ikut terjaga tanpa ada yang perlu ingat menambahkan
  // assertion-nya di sini.
  assert.ok(OPERASI_MUTASI.length > 0, 'daftar mutasi tidak boleh kosong');
  for (const operasi of OPERASI_MUTASI) {
    assert.equal(bolehkah(['accountant'], operasi), false, `accountant × ${operasi}`);
  }
});

test('property: Kasir tidak dapat menyetujui apa pun (spec-f:80)', async () => {
  const { bolehkah, OPERASI_PERSETUJUAN } = await import(MOD);

  assert.ok(OPERASI_PERSETUJUAN.length > 0);
  for (const operasi of OPERASI_PERSETUJUAN) {
    assert.equal(bolehkah(['cashier'], operasi), false, `cashier × ${operasi}`);
  }
});

test('property: Kasir tidak dapat melihat margin/HPP (FR-F5)', async () => {
  const { bolehkah } = await import(MOD);

  // `spec-f:57` menyebut alasannya: HPP adalah informasi kompetitif merchant,
  // dan kasir punya turnover tinggi. Ini satu-satunya larangan di matriks
  // yang berlaku pada peran yang paling banyak jumlahnya.
  assert.equal(bolehkah(['cashier'], 'view_margin'), false);
  assert.equal(bolehkah(['cashier'], 'report_exception'), false);
});

test('setiap peran di skema database punya baris di matriks', async () => {
  const { PERAN_DIKENAL } = await import(MOD);

  // CHECK constraint `db/migrations/0003_identity.sql:7` mendaftar kelimanya.
  // Peran yang ada di database tapi tidak di matriks akan ditolak untuk
  // SEGALANYA tanpa satu pun pesan yang menjelaskan kenapa.
  assert.deepEqual([...PERAN_DIKENAL].sort(), [...PERAN].sort());
});
