'use strict';

// B-16 — Laporan Penjualan.
//
// ⛔ Uang datang dari `GET /reports/sales` sebagai STRING, dan itu disengaja:
// `PosisiPenjualan` memakai `bigint`, dan `Number` membuang presisi di atas
// 2^53. Layar yang mengubahnya kembali jadi `number` untuk ditampilkan
// membatalkan seluruh alasan endpoint itu mengirim string.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const B16 = '../../apps/backoffice/src/laporan/b16.ts';
const PRODUK = '../../apps/backoffice/src/katalog/produk.ts';

// ---------------------------------------------------------------------------
// ⛔ Presisi di titik tampilan
// ---------------------------------------------------------------------------

test('⛔ rupiah() tidak melewatkan STRING lewat Number', async () => {
  // `Number('9007199254740993')` menghasilkan 9007199254740992 — satu rupiah
  // hilang, tanpa error. Angka sebesar ini bukan hipotetis untuk omzet
  // TAHUNAN merchant 20 outlet, dan endpoint mengirim string justru supaya ia
  // sampai utuh.
  const { rupiah } = await import('../../packages/domain/src/uang-tampilan.ts');
  assert.equal(rupiah('9007199254740993'), 'Rp 9.007.199.254.740.993');
  assert.equal(rupiah('12345678901234567890'), 'Rp 12.345.678.901.234.567.890');
});

test('rupiah() tetap benar untuk bigint, number, dan nilai kecil', async () => {
  const { rupiah } = await import('../../packages/domain/src/uang-tampilan.ts');
  assert.equal(rupiah(25000n), 'Rp 25.000');
  assert.equal(rupiah(25000), 'Rp 25.000');
  assert.equal(rupiah('0'), 'Rp 0');
});

test('⛔ omzet NEGATIF ditampilkan dengan tanda minus tipografis', async () => {
  // `CLAUDE.md`: `− Rp 8.000` (U+2212), bukan hyphen. Dan `spec-g:283` menuntut
  // omzet bersih negatif "ditampilkan apa adanya" — refund yang melebihi
  // penjualan adalah hari yang justru paling perlu dilihat.
  const { rupiah } = await import('../../packages/domain/src/uang-tampilan.ts');
  assert.equal(rupiah('-20000'), '− Rp 20.000');
  assert.equal(rupiah(-20000n), '− Rp 20.000');
});

test('⛔ string yang BUKAN angka tidak menghasilkan NaN diam-diam', async () => {
  // `BigInt('abc')` MELEMPAR, tidak seperti `Number('abc')` yang menghasilkan
  // NaN. Layar yang jatuh karena satu field tak terduga lebih buruk daripada
  // layar yang menampilkan tanda tanya.
  const { rupiah } = await import('../../packages/domain/src/uang-tampilan.ts');
  assert.equal(rupiah('abc'), 'Rp —');
  assert.equal(rupiah(''), 'Rp —');
});

// ---------------------------------------------------------------------------
// Rentang tanggal
// ---------------------------------------------------------------------------

test('⛔ mengubah "dari" melewati "sampai" MENDORONG "sampai", bukan menolak', async () => {
  // Server menolak `from > to` dengan 400 — benar untuk API, buruk untuk
  // layar: merchant yang memilih tanggal mundur mendapat pesan error alih-alih
  // rentang yang ia maksud. Pemilih yang menjaga invariannya sendiri tidak
  // pernah mengirim rentang terbalik.
  const { setelRentang } = await import(B16);
  assert.deepEqual(setelRentang({ dari: '2026-08-01', sampai: '2026-08-10' }, 'dari', '2026-08-20'), {
    dari: '2026-08-20',
    sampai: '2026-08-20',
  });
});

test('⛔ mengubah "sampai" ke belakang "dari" MENARIK "dari"', async () => {
  const { setelRentang } = await import(B16);
  assert.deepEqual(setelRentang({ dari: '2026-08-10', sampai: '2026-08-20' }, 'sampai', '2026-08-05'), {
    dari: '2026-08-05',
    sampai: '2026-08-05',
  });
});

test('perubahan yang tetap sah tidak menggeser sisi lain', async () => {
  const { setelRentang } = await import(B16);
  assert.deepEqual(setelRentang({ dari: '2026-08-01', sampai: '2026-08-20' }, 'dari', '2026-08-05'), {
    dari: '2026-08-05',
    sampai: '2026-08-20',
  });
});

test('nilai setengah diketik dibiarkan apa adanya, tanpa menggeser sisi lain', async () => {
  // `<input>` tanggal yang diketik manual melewati keadaan seperti "2026-08"
  // di setiap ketikan. Membandingkannya sebagai rentang akan menarik sisi lain
  // ke nilai yang belum dimaksud siapa pun.
  const { setelRentang } = await import(B16);
  assert.deepEqual(setelRentang({ dari: '2026-08-01', sampai: '2026-08-20' }, 'dari', '2026-08'), {
    dari: '2026-08',
    sampai: '2026-08-20',
  });
});

test('rentang siap dikirim hanya bila KEDUANYA tanggal penuh', async () => {
  const { rentangSiap } = await import(B16);
  assert.equal(rentangSiap({ dari: '2026-08-01', sampai: '2026-08-10' }), true);
  assert.equal(rentangSiap({ dari: '2026-08', sampai: '2026-08-10' }), false);
  assert.equal(rentangSiap({ dari: '', sampai: '' }), false);
  // Tanggal yang tidak ada ditolak juga — server menolaknya (`2026-02-31`
  // lolos regex tapi `Date` menormalkannya jadi 3 Maret diam-diam).
  assert.equal(rentangSiap({ dari: '2026-02-31', sampai: '2026-03-01' }), false);
});

// ---------------------------------------------------------------------------
// Penyusunan angka
// ---------------------------------------------------------------------------

const POSISI = {
  omzetKotor: '100000',
  voidAmount: '20000',
  refundAmount: '30000',
  omzetBersih: '70000',
  pajakTerkumpul: '7000',
  jumlahTransaksi: 4,
  rataRataPerTransaksi: '17500',
};

test('ringkasan menyusun baris berlabel manusia, bukan nama field', async () => {
  const { susunRingkasan } = await import(B16);
  const baris = susunRingkasan(POSISI);
  const kunci = baris.map((b) => b.kunci);

  assert.deepEqual(kunci, [
    'omzetKotor',
    'voidAmount',
    'refundAmount',
    'omzetBersih',
    'pajakTerkumpul',
    'jumlahTransaksi',
    'rataRataPerTransaksi',
  ]);
  assert.ok(baris.every((b) => b.judul.length > 0 && b.judul !== b.kunci));
});

test('⛔ nilai uang diteruskan sebagai STRING, tidak diubah jadi number', async () => {
  // Penjaga bentuk. Versi yang memanggil `Number()` di sini akan lolos setiap
  // test angka kecil dan salah di angka besar — dan tidak ada yang gagal saat
  // itu terjadi.
  const { susunRingkasan } = await import(B16);
  for (const b of susunRingkasan(POSISI)) {
    if (b.kunci === 'jumlahTransaksi') {
      assert.equal(typeof b.nilai, 'number');
      continue;
    }
    assert.equal(typeof b.nilai, 'string', `${b.kunci} bukan string`);
  }
});

test('⛔ periode BENAR-BENAR kosong dibedakan dari nol yang bermakna', async () => {
  // Nol transaksi berarti "tidak ada penjualan pada periode ini" — keadaan
  // kosong. Nol omzet DENGAN transaksi (semuanya direfund penuh) adalah data
  // nyata yang justru harus dilihat, dan menyembunyikannya di balik keadaan
  // kosong menghapus hari yang paling perlu diperiksa.
  const { periodeKosong } = await import(B16);
  assert.equal(periodeKosong({ ...POSISI, jumlahTransaksi: 0, omzetKotor: '0' }), true);
  assert.equal(periodeKosong({ ...POSISI, jumlahTransaksi: 2, omzetKotor: '0' }), false);
  assert.equal(periodeKosong(POSISI), false);
});

test('⛔ void dan refund ditandai sebagai PENGURANG, bukan pemasukan', async () => {
  // Keduanya angka positif di respons, dan menampilkannya berdampingan dengan
  // omzet tanpa penanda membuat merchant membacanya sebagai tambahan.
  const { susunRingkasan } = await import(B16);
  const peta = Object.fromEntries(susunRingkasan(POSISI).map((b) => [b.kunci, b]));
  assert.equal(peta.voidAmount.pengurang, true);
  assert.equal(peta.refundAmount.pengurang, true);
  assert.equal(peta.omzetKotor.pengurang, false);
  assert.equal(peta.omzetBersih.pengurang, false);
});
