'use strict';

// B-02 — Riwayat Penjualan, aturan layarnya.
//
// ⛔ Yang diuji di sini bukan tabelnya melainkan tiga hal yang mustahil
// diperiksa dengan membaca JSX: kueri yang benar-benar dikirim, tumpukan
// kursor yang membuat "Sebelumnya" tidak berbohong, dan debounce yang
// menentukan berapa banyak permintaan yang berangkat saat kasir mengetik.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const B02 = '../../apps/backoffice/src/penjualan/b02.ts';

const RENTANG = { dari: '2026-08-01', sampai: '2026-08-31' };
const DASAR = {
  rentang: RENTANG,
  outletId: '',
  status: [],
  cari: '',
  cursor: null,
};

// ---------------------------------------------------------------------------
// Kueri
// ---------------------------------------------------------------------------

test('kueri minimum hanya membawa rentang', async () => {
  const { susunKueri } = await import(B02);
  assert.equal(susunKueri(DASAR), 'from=2026-08-01&to=2026-08-31&limit=25');
});

test('⛔ status berganda dikirim dipisah koma', async () => {
  const { susunKueri } = await import(B02);
  const q = susunKueri({ ...DASAR, status: ['dibatalkan', 'direfund'] });
  assert.match(q, /status=dibatalkan%2Cdirefund|status=dibatalkan,direfund/);
});

test('⛔ SEMUA status terpilih = tanpa penyaring, bukan daftar penuh', async () => {
  // Mengirim ketiganya memberi hasil yang sama dengan tidak mengirim apa pun,
  // tapi ia membuat URL lebih panjang dan membuat "tanpa penyaring" terlihat
  // seperti keadaan yang berbeda di log server. Keduanya harus satu keadaan.
  const { susunKueri, SEMUA_STATUS } = await import(B02);
  assert.equal(susunKueri({ ...DASAR, status: [...SEMUA_STATUS] }), susunKueri(DASAR));
});

test('pencarian dikirim setelah dirapikan', async () => {
  const { susunKueri } = await import(B02);
  assert.match(susunKueri({ ...DASAR, cari: '  0007  ' }), /receipt_number=0007/);
});

test('pencarian kosong tidak mengirim parameter sama sekali', async () => {
  const { susunKueri } = await import(B02);
  assert.doesNotMatch(susunKueri({ ...DASAR, cari: '   ' }), /receipt_number/);
});

test('kursor dikirim apa adanya', async () => {
  const { susunKueri } = await import(B02);
  assert.match(susunKueri({ ...DASAR, cursor: 'eyJhIjoxfQ' }), /cursor=eyJhIjoxfQ/);
});

test('outlet kosong tidak mengirim parameter', async () => {
  const { susunKueri } = await import(B02);
  assert.doesNotMatch(susunKueri(DASAR), /outlet_id/);
  assert.match(susunKueri({ ...DASAR, outletId: 'o1' }), /outlet_id=o1/);
});

// ---------------------------------------------------------------------------
// Pilihan status
// ---------------------------------------------------------------------------

test('memilih dan melepas status', async () => {
  const { alihkanStatus } = await import(B02);
  assert.deepEqual(alihkanStatus([], 'terjual'), ['terjual']);
  assert.deepEqual(alihkanStatus(['terjual'], 'direfund'), ['terjual', 'direfund']);
  assert.deepEqual(alihkanStatus(['terjual', 'direfund'], 'terjual'), ['direfund']);
});

test('⛔ urutan pilihan tidak mengubah kuerinya', async () => {
  // Kalau ia berubah, dua pengguna yang memilih penyaring sama lewat urutan
  // berbeda menghasilkan dua URL berbeda — dan cache mana pun di antaranya
  // memperlakukannya sebagai dua pertanyaan.
  const { susunKueri } = await import(B02);
  assert.equal(
    susunKueri({ ...DASAR, status: ['direfund', 'dibatalkan'] }),
    susunKueri({ ...DASAR, status: ['dibatalkan', 'direfund'] })
  );
});

// ---------------------------------------------------------------------------
// ⛔ Tumpukan kursor
// ---------------------------------------------------------------------------

test('⛔ maju menyimpan kursor halaman SEKARANG, bukan yang berikutnya', async () => {
  // Kesalahan yang mudah: menyimpan `cursorBerikut`. Ia menunjuk halaman yang
  // akan dibuka, bukan yang ditinggalkan — dan "Sebelumnya" jadi mengulang
  // halaman yang sedang dilihat, selamanya.
  const { maju, mundur, kursorSekarang } = await import(B02);

  let t = { tumpukan: [], indeks: 0 };
  assert.equal(kursorSekarang(t), null, 'halaman pertama harus tanpa kursor');

  t = maju(t, 'K1');
  assert.equal(kursorSekarang(t), 'K1');

  t = maju(t, 'K2');
  assert.equal(kursorSekarang(t), 'K2');

  t = mundur(t);
  assert.equal(kursorSekarang(t), 'K1');

  t = mundur(t);
  assert.equal(kursorSekarang(t), null, 'mundur dari halaman 2 harus kembali ke halaman 1');
});

test('mundur dari halaman pertama tidak melakukan apa-apa', async () => {
  const { mundur, kursorSekarang } = await import(B02);
  const t = mundur({ tumpukan: [], indeks: 0 });
  assert.equal(kursorSekarang(t), null);
  assert.equal(t.indeks, 0);
});

test('⛔ mengubah penyaring MENGATUR ULANG paginasi', async () => {
  // Kursor milik satu penyaring tidak berlaku untuk penyaring lain: ia
  // menunjuk posisi di urutan yang sudah berubah. Halaman yang dihasilkan
  // bukan salah secara acak — ia melewatkan transaksi secara diam-diam.
  const { maju, aturUlang, kursorSekarang } = await import(B02);
  const t = maju(maju({ tumpukan: [], indeks: 0 }, 'K1'), 'K2');
  const baru = aturUlang(t);
  assert.equal(kursorSekarang(baru), null);
  assert.deepEqual(baru.tumpukan, []);
});

test('nomor halaman untuk pengguna dimulai dari 1', async () => {
  const { maju, nomorHalaman } = await import(B02);
  let t = { tumpukan: [], indeks: 0 };
  assert.equal(nomorHalaman(t), 1);
  t = maju(t, 'K1');
  assert.equal(nomorHalaman(t), 2);
});

// ---------------------------------------------------------------------------
// ⛔ Debounce
// ---------------------------------------------------------------------------

test('⛔ mengetik cepat hanya mengirim SATU permintaan', async () => {
  const { buatDebounce } = await import(B02);
  let jalan = 0;
  const timers = new Map();
  let next = 1;
  const d = buatDebounce(() => { jalan += 1; }, 300, {
    setTimer: (fn, ms) => { const h = next++; timers.set(h, { fn, ms }); return h; },
    clearTimer: (h) => timers.delete(h),
  });

  for (const _ of 'K1-0007') d();
  assert.equal(jalan, 0, 'permintaan berangkat sebelum jeda habis');
  assert.equal(timers.size, 1, 'timer menumpuk — setiap huruf menyisakan satu');

  for (const [, t] of timers) t.fn();
  assert.equal(jalan, 1);
});

test('debounce dapat dibatalkan saat komponen dilepas', async () => {
  const { buatDebounce } = await import(B02);
  let jalan = 0;
  const timers = new Map();
  let next = 1;
  const d = buatDebounce(() => { jalan += 1; }, 300, {
    setTimer: (fn) => { const h = next++; timers.set(h, fn); return h; },
    clearTimer: (h) => timers.delete(h),
  });
  d();
  d.batal();
  assert.equal(timers.size, 0);
  assert.equal(jalan, 0);
});

// ---------------------------------------------------------------------------
// Keadaan layar
// ---------------------------------------------------------------------------

test('⛔ KOSONG dibedakan dari GAGAL dan dari BELUM DIMUAT', async () => {
  const { pesanKeadaan } = await import(B02);
  const kosong = pesanKeadaan({ jenis: 'siap', items: [] });
  const galat = pesanKeadaan({ jenis: 'galat', pesan: 'Koneksi putus.' });
  const muat = pesanKeadaan({ jenis: 'memuat' });

  assert.notEqual(kosong.judul, galat.judul);
  assert.notEqual(kosong.judul, muat.judul);
  assert.match(kosong.badan, /filter/i);
  assert.match(galat.badan, /Koneksi putus\./);
});

test('ada isi → tidak ada pesan, tabel yang dirender', async () => {
  const { pesanKeadaan } = await import(B02);
  assert.equal(pesanKeadaan({ jenis: 'siap', items: [{ id: 'a' }] }), null);
});

test('label status terbaca merchant, bukan slug', async () => {
  const { LABEL_STATUS, SEMUA_STATUS } = await import(B02);
  for (const s of SEMUA_STATUS) {
    assert.equal(typeof LABEL_STATUS[s], 'string');
    assert.notEqual(LABEL_STATUS[s], s);
  }
  assert.equal(LABEL_STATUS.terjual, 'Selesai');
});

test('⛔ label status cocok dengan daftar yang server terima', async () => {
  // Salinan kedua yang menyimpang membuat layar mengirim status yang server
  // tolak — dan penolakannya 400, bukan daftar kosong, jadi layarnya rusak
  // total alih-alih kosong.
  const { SEMUA_STATUS } = await import(B02);
  const { STATUS_TERLIHAT } = await import(
    '../../apps/server/src/modules/ordering/handlers/riwayat-data.ts'
  );
  assert.deepEqual([...SEMUA_STATUS].sort(), [...STATUS_TERLIHAT].sort());
});
