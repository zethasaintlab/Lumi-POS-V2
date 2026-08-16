'use strict';

// B-01 — aturan layar Dasbor.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const B01 = '../../apps/backoffice/src/dasbor/b01.ts';

// ---------------------------------------------------------------------------
// Rentang cepat
// ---------------------------------------------------------------------------

test('hari ini adalah satu tanggal', async () => {
  const { rentangDari } = await import(B01);
  const r = rentangDari('hari-ini', new Date(2026, 7, 16));
  assert.deepEqual(r, { dari: '2026-08-16', sampai: '2026-08-16' });
});

test('⛔ "7 hari terakhir" INKLUSIF hari ini', async () => {
  // Tujuh hari berarti tujuh, termasuk hari ini — bukan tujuh hari SEBELUM
  // hari ini, yang akan menghasilkan delapan.
  const { rentangDari } = await import(B01);
  const r = rentangDari('minggu-ini', new Date(2026, 7, 16));
  assert.deepEqual(r, { dari: '2026-08-10', sampai: '2026-08-16' });
});

test('30 hari terakhir juga inklusif', async () => {
  const { rentangDari } = await import(B01);
  const r = rentangDari('bulan-ini', new Date(2026, 7, 16));
  assert.deepEqual(r, { dari: '2026-07-18', sampai: '2026-08-16' });
});

test('⛔ rentang menyeberangi batas bulan dan tahun', async () => {
  // `setDate` dengan nilai negatif menangani ini; menghitung manual dengan
  // pengurangan hari tidak.
  const { rentangDari } = await import(B01);
  assert.equal(rentangDari('minggu-ini', new Date(2026, 0, 3)).dari, '2025-12-28');
  assert.equal(rentangDari('bulan-ini', new Date(2026, 2, 5)).dari, '2026-02-04');
});

test('tanggal lokal berpadding dua digit', async () => {
  const { tanggalLokal } = await import(B01);
  assert.equal(tanggalLokal(new Date(2026, 0, 5)), '2026-01-05');
});

test('⛔ label rentang tidak memakai "minggu ini" yang ambigu', async () => {
  // Minggu kalender menuntut keputusan tentang hari mana yang memulainya, dan
  // merchant yang membandingkan dua angka yang keduanya disebut "minggu ini"
  // tidak punya cara tahu mana yang mana.
  const { LABEL_RENTANG } = await import(B01);
  assert.match(LABEL_RENTANG['minggu-ini'], /7 hari/);
  assert.match(LABEL_RENTANG['bulan-ini'], /30 hari/);
});

// ---------------------------------------------------------------------------
// Ringkasan stok
// ---------------------------------------------------------------------------

test('⛔ kalimat stok MEMISAHKAN minus dari habis', async () => {
  // Keduanya ditindaklanjuti dengan cara berbeda: habis berarti pesan lagi,
  // minus berarti ada yang salah dengan catatannya.
  const { ringkasKalimatStok } = await import(B01);
  const t = ringkasKalimatStok({ minus: 2, habis: 3, contoh: [] });
  assert.match(t, /2 bersaldo minus/);
  assert.match(t, /3 habis/);
});

test('hanya menyebut yang bernilai', async () => {
  const { ringkasKalimatStok } = await import(B01);
  assert.doesNotMatch(ringkasKalimatStok({ minus: 0, habis: 3, contoh: [] }), /minus/);
  assert.doesNotMatch(ringkasKalimatStok({ minus: 2, habis: 0, contoh: [] }), /habis/);
});

test('⛔ nol adalah KABAR BAIK, dan kalimatnya mengatakannya', async () => {
  const { ringkasKalimatStok } = await import(B01);
  assert.match(ringkasKalimatStok({ minus: 0, habis: 0, contoh: [] }), /Tidak ada/);
});

test('⛔ tanpa outlet, kalimatnya menjelaskan SEBABNYA', async () => {
  // Kartu kosong tanpa penjelasan terbaca seperti fitur yang rusak.
  const { ringkasKalimatStok, jumlahPerluPerhatian } = await import(B01);
  assert.match(ringkasKalimatStok(null), /Pilih satu outlet/);
  assert.equal(jumlahPerluPerhatian(null), 0);
});

test('jumlah perlu perhatian menjumlahkan keduanya', async () => {
  const { jumlahPerluPerhatian } = await import(B01);
  assert.equal(jumlahPerluPerhatian({ minus: 2, habis: 3, contoh: [] }), 5);
});

test('⛔ tanpa outlet, lencana TIDAK berbunyi "Aman"', async () => {
  // Ini defek yang ditemukan di browser, bukan di test: `jumlahPerluPerhatian`
  // mengembalikan 0 untuk `null`, dan 0 berarti hijau. Hasilnya kartu hijau
  // bertuliskan "Aman" tepat di atas kalimat "Pilih satu outlet untuk melihat
  // stok yang perlu perhatian" — jaminan tentang stok yang tidak seorang pun
  // periksa.
  const { lencanaStok } = await import(B01);
  const l = lencanaStok(null);
  assert.equal(l.nada, 'neutral');
  assert.doesNotMatch(l.teks, /aman/i);
});

test('lencana membawa ANGKA, bukan hanya warna', async () => {
  // Aturan design system #5: status tidak pernah warna saja.
  const { lencanaStok } = await import(B01);
  assert.deepEqual(lencanaStok({ minus: 2, habis: 3, contoh: [] }), {
    nada: 'warning',
    teks: '5 perlu tindakan',
  });
});

test('nol yang BENAR-BENAR diperiksa boleh berbunyi aman', async () => {
  const { lencanaStok } = await import(B01);
  assert.deepEqual(lencanaStok({ minus: 0, habis: 0, contoh: [] }), {
    nada: 'success',
    teks: 'Aman',
  });
});

// ---------------------------------------------------------------------------
// Keadaan
// ---------------------------------------------------------------------------

const DASBOR = {
  from: '2026-08-16',
  to: '2026-08-16',
  outletId: null,
  penjualan: {
    omzetKotor: '0', voidAmount: '0', refundAmount: '0', omzetBersih: '0',
    pajakTerkumpul: '0', jumlahTransaksi: 0, rataRataPerTransaksi: '0',
  },
  terlaris: [],
  stok: null,
};

test('⛔ MEMUAT dibedakan dari GAGAL', async () => {
  const { pesanKeadaan } = await import(B01);
  const muat = pesanKeadaan({ jenis: 'memuat' });
  const galat = pesanKeadaan({ jenis: 'galat', pesan: 'Koneksi putus.' });
  assert.notEqual(muat.judul, galat.judul);
  assert.match(galat.badan, /Koneksi putus\./);
});

test('⛔ dasbor tanpa transaksi BUKAN keadaan error', async () => {
  // Merchant yang baru mendaftar melihatnya setiap pagi sampai penjualan
  // pertamanya. Menampilkannya sebagai galat membuat aplikasi terasa rusak
  // sejak hari pertama.
  const { pesanKeadaan, periodeKosong } = await import(B01);
  assert.equal(pesanKeadaan({ jenis: 'siap', dasbor: DASBOR }), null);
  assert.equal(periodeKosong(DASBOR), true);
});

test('ada transaksi → tidak kosong', async () => {
  const { periodeKosong } = await import(B01);
  assert.equal(
    periodeKosong({ ...DASBOR, penjualan: { ...DASBOR.penjualan, jumlahTransaksi: 3 } }),
    false
  );
});

// ---------------------------------------------------------------------------
// Rincian
// ---------------------------------------------------------------------------

const BESAR = {
  ...DASBOR,
  penjualan: {
    omzetKotor: '9007199254740993',
    voidAmount: '1',
    refundAmount: '2',
    omzetBersih: '9007199254740990',
    pajakTerkumpul: '3',
    jumlahTransaksi: 7,
    rataRataPerTransaksi: '1286742750677284',
  },
};

test('⛔ rincian meneruskan nilai APA ADANYA, tanpa Number()', async () => {
  // `Number('9007199254740993')` menghasilkan …992 — satu rupiah hilang tanpa
  // satu pun error. Nilai ini dipilih justru karena ia yang membedakan
  // "diteruskan" dari "dilewatkan lewat Number".
  const { rincian } = await import(B01);
  const b = rincian(BESAR);
  assert.equal(b.find((x) => x.judul === 'Omzet kotor').nilai, '9007199254740993');
});

test('⛔ rincian TIDAK menurunkan omzet bersih sendiri', async () => {
  // Kalau ia menghitung kotor − batal − refund, klien punya definisi kedua
  // yang akan menyimpang. Angka server dipakai apa adanya, bahkan saat ia
  // tidak konsisten dengan komponennya.
  const { rincian } = await import(B01);
  const aneh = { ...BESAR, penjualan: { ...BESAR.penjualan, omzetBersih: '0' } };
  const b = rincian(aneh);
  assert.equal(
    b.some((x) => x.judul.toLowerCase().includes('bersih')),
    false
  );
  assert.deepEqual(
    b.map((x) => x.nilai),
    ['9007199254740993', '1', '2', '3']
  );
});

test('yang mengurangi omzet ditandai', async () => {
  const { rincian } = await import(B01);
  const b = rincian(BESAR);
  assert.deepEqual(
    b.filter((x) => x.pengurang).map((x) => x.judul),
    ['Dibatalkan', 'Refund']
  );
});
