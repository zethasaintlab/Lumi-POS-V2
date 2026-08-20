'use strict';

// Perpindahan paket — lubang yang `periksaKuota` TIDAK jaga.
//
// ⛔ `periksaKuota` hanya berjalan saat MEMBUAT sesuatu. Tidak ada apa pun
// yang memeriksa kuota saat batasnya SENDIRI yang berubah. Tanpa penjaga ini,
// tenant dengan 8 outlet dapat turun ke `free` (1 outlet) dan sistem masuk
// keadaan yang tidak dapat dicapai lewat jalur mana pun — 8 outlet hidup di
// bawah kuota 1, tanpa satu pun error, dan setiap layar "pemakaian vs kuota"
// menampilkan 8/1.
//
// Komentar di `periksaKuota` sudah menyebut keadaan itu ("Merchant yang TURUN
// paket dapat berada di atas kuota barunya") — ia mengantisipasinya tanpa
// pernah menjaga transisinya.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const PAKET = '../../packages/domain/src/paket.ts';

const KOSONG = { outlet: 0, device: 0, pengguna: 0, produk: 0 };

// ---------------------------------------------------------------------------
// Yang boleh
// ---------------------------------------------------------------------------

test('naik paket selalu boleh', async () => {
  const { periksaPerpindahanPaket } = await import(PAKET);
  const pemakaian = { outlet: 1, device: 2, pengguna: 3, produk: 200 };
  assert.deepEqual(periksaPerpindahanPaket(pemakaian, 'standard'), { ok: true });
});

test('pindah ke paket yang SAMA boleh — ia idempoten', async () => {
  const { periksaPerpindahanPaket } = await import(PAKET);
  const pemakaian = { outlet: 1, device: 2, pengguna: 3, produk: 200 };
  assert.deepEqual(periksaPerpindahanPaket(pemakaian, 'free'), { ok: true });
});

test('⛔ pemakaian TEPAT SAMA dengan batas boleh — batas adalah maksimum', async () => {
  // `free` memuat 1 outlet. Tenant dengan tepat 1 outlet sudah muat, dan
  // menolaknya berarti kuota diperlakukan eksklusif di satu tempat dan
  // inklusif di tempat lain (`periksaKuota` memakai `<=`).
  const { periksaPerpindahanPaket } = await import(PAKET);
  const r = periksaPerpindahanPaket({ outlet: 1, device: 2, pengguna: 3, produk: 200 }, 'free');
  assert.deepEqual(r, { ok: true });
});

test('enterprise menerima pemakaian apa pun — batasnya null', async () => {
  const { periksaPerpindahanPaket } = await import(PAKET);
  const r = periksaPerpindahanPaket(
    { outlet: 999, device: 999, pengguna: 999, produk: 999999 },
    'enterprise'
  );
  assert.deepEqual(r, { ok: true });
});

test('tenant kosong dapat pindah ke paket mana pun', async () => {
  const { periksaPerpindahanPaket, KUOTA_PAKET } = await import(PAKET);
  for (const nama of Object.keys(KUOTA_PAKET)) {
    assert.deepEqual(periksaPerpindahanPaket(KOSONG, nama), { ok: true }, nama);
  }
});

// ---------------------------------------------------------------------------
// Yang ditolak
// ---------------------------------------------------------------------------

test('⛔ turun paket dengan pemakaian melebihi kuota tujuan DITOLAK', async () => {
  const { periksaPerpindahanPaket } = await import(PAKET);
  const r = periksaPerpindahanPaket({ outlet: 8, device: 2, pengguna: 3, produk: 10 }, 'free');
  assert.equal(r.ok, false);
  assert.equal(r.kode, 'PLAN_DOWNGRADE_BLOCKED');
});

test('⛔ SELURUH dimensi yang melanggar dilaporkan, bukan hanya yang pertama', async () => {
  // Merchant yang memperbaiki satu dimensi lalu ditolak lagi karena dimensi
  // kedua — dan lagi karena ketiga — akan menyerah. Penolakan yang menyebut
  // satu sebab pada satu waktu adalah penolakan yang menyembunyikan pekerjaan.
  const { periksaPerpindahanPaket } = await import(PAKET);
  const r = periksaPerpindahanPaket(
    { outlet: 8, device: 40, pengguna: 20, produk: 9000 },
    'free'
  );
  assert.equal(r.ok, false);
  assert.deepEqual(
    r.pelanggaran.map((p) => p.dimensi).sort(),
    ['device', 'outlet', 'pengguna', 'produk']
  );
});

test('⛔ pesan penolakan membawa ANGKANYA', async () => {
  // Pola `spec-e:152`. "Kuota terlampaui" memaksa merchant menebak berapa yang
  // harus dihapus, di layar yang tidak menampilkan angka itu.
  const { periksaPerpindahanPaket } = await import(PAKET);
  const r = periksaPerpindahanPaket({ outlet: 8, device: 2, pengguna: 3, produk: 10 }, 'free');
  assert.match(r.pesan, /8/);
  assert.match(r.pesan, /1/);
  assert.match(r.pesan, /outlet/i);
});

test('hanya dimensi yang benar-benar melebihi yang dilaporkan', async () => {
  const { periksaPerpindahanPaket } = await import(PAKET);
  const r = periksaPerpindahanPaket({ outlet: 8, device: 1, pengguna: 1, produk: 5 }, 'free');
  assert.equal(r.ok, false);
  assert.deepEqual(r.pelanggaran.map((p) => p.dimensi), ['outlet']);
  assert.deepEqual(r.pelanggaran[0], { dimensi: 'outlet', terpakai: 8, batas: 1 });
});

// ---------------------------------------------------------------------------
// Fail-closed
// ---------------------------------------------------------------------------

test('⛔ paket tujuan tak dikenal MELEMPAR, tidak diam-diam lolos', async () => {
  // Konsisten dengan `periksaKuota`, yang melempar untuk dimensi tak dikenal.
  // Meloloskan diam-diam membuat satu titik penegakan mati tanpa error —
  // dan titik ini adalah satu-satunya yang menjaga kuota saat batas berubah.
  const { periksaPerpindahanPaket } = await import(PAKET);
  assert.throws(() => periksaPerpindahanPaket(KOSONG, 'gratisan'), /tidak dikenal/i);
});

test('⛔ dimensi yang HILANG dari pemakaian melempar, tidak dianggap nol', async () => {
  // Pemanggil yang lupa satu dimensi akan lolos memakai `?? 0` — dan dimensi
  // yang lupa dihitung adalah persis dimensi yang tidak dijaga.
  const { periksaPerpindahanPaket } = await import(PAKET);
  assert.throws(() => periksaPerpindahanPaket({ outlet: 1, device: 1, pengguna: 1 }, 'free'),
    /produk/i);
});

test('⛔ SETIAP dimensi di DIMENSI_KUOTA benar-benar diperiksa', async () => {
  // Property, bukan contoh. Penjaga yang memeriksa tiga dari empat dimensi
  // adalah penjaga yang terlihat bekerja sampai dimensi keempat yang jebol.
  const { periksaPerpindahanPaket } = await import(PAKET);
  const { DIMENSI_KUOTA } = await import('../../packages/domain/src/kuota.ts');
  for (const d of DIMENSI_KUOTA) {
    const pemakaian = { ...KOSONG, [d]: 999999 };
    const r = periksaPerpindahanPaket(pemakaian, 'free');
    assert.equal(r.ok, false, `dimensi ${d} tidak diperiksa sama sekali`);
    assert.deepEqual(r.pelanggaran.map((p) => p.dimensi), [d]);
  }
});
