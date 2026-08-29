'use strict';

// Aturan pemilihan modifier. FR-A3, `spec-a:113`.
//
// ⛔ Sebelum ini yang ditegakkan hanya `is_required` + `min_selections`.
// `max_selections` dan `allow_duplicate` ada di skema, turun ke perangkat, dan
// dibaca `bacaModifier` — lalu diabaikan. Kasir dapat memilih enam topping
// pada list bermaksimal tiga, dan pesanannya tersimpan: barista tidak dapat
// membuatnya, dan tidak ada satu pun error di jalan.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../packages/domain/src/modifier-pilihan.ts';

const MULTI = { tipe: 'multi', wajib: false, minPilih: 0, maxPilih: 3, bolehGanda: false };
const SINGLE = { tipe: 'single', wajib: true, minPilih: 0, maxPilih: null, bolehGanda: false };

test('kuantitas berskala 1000, sama dengan setiap kuantitas di repo ini', async () => {
  const { QTY_MODIFIER, tambahPilihan } = await import(MOD);
  assert.equal(QTY_MODIFIER, 1000);
  assert.deepEqual(tambahPilihan(MULTI, {}, 'm1'), { m1: 1000 });
});

test('⛔ batas menghitung UNIT, bukan baris', async () => {
  const { bolehTambah, tambahPilihan } = await import(MOD);
  const ganda = { ...MULTI, bolehGanda: true };

  // `Extra Shot ×2` dihitung DUA. Menghitung baris saja membuat
  // `max_selections = 3` meloloskan enam shot lewat tiga baris ber-qty 2 —
  // pelanggan membayarnya dan barista membuatnya, jadi ia sebuah pilihan.
  let p = {};
  p = tambahPilihan(ganda, p, 'm1');
  p = tambahPilihan(ganda, p, 'm1');
  p = tambahPilihan(ganda, p, 'm2');
  assert.deepEqual(p, { m1: 2000, m2: 1000 });
  assert.equal(bolehTambah(ganda, p, 'm3'), false, 'unit keempat lolos');
});

test('⛔ pilihan melewati batas DITOLAK, tidak diterima lalu dibuang', async () => {
  const { tambahPilihan } = await import(MOD);
  // `spec-a:126`: "menonaktifkan pilihan berikutnya dengan pesan, bukan
  // menerima lalu menolak". Penolakan di domain adalah jaring; layar yang
  // memakai `bolehTambah` adalah antarmukanya.
  let p = {};
  for (const id of ['m1', 'm2', 'm3']) p = tambahPilihan(MULTI, p, id);
  const sesudah = tambahPilihan(MULTI, p, 'm4');
  assert.deepEqual(sesudah, p, 'pilihan keempat masuk padahal maksimal 3');
});

test('tanpa `allow_duplicate`, modifier yang sama tidak dapat ditambah dua kali', async () => {
  const { bolehTambah, tambahPilihan, togglePilihan } = await import(MOD);
  const p = tambahPilihan(MULTI, {}, 'm1');
  assert.equal(bolehTambah(MULTI, p, 'm1'), false);
  // Toggle tetap bekerja: menekan ulang MELEPAS, bukan menambah.
  assert.deepEqual(togglePilihan(MULTI, p, 'm1'), {});
});

test('`maxPilih` null berarti tanpa batas', async () => {
  const { bolehTambah, tambahPilihan } = await import(MOD);
  const bebas = { ...MULTI, maxPilih: null };
  let p = {};
  for (const id of ['a', 'b', 'c', 'd', 'e']) p = tambahPilihan(bebas, p, id);
  assert.equal(bolehTambah(bebas, p, 'f'), true);
});

test('`single` MENGGANTI, tidak menambah', async () => {
  const { tambahPilihan, togglePilihan } = await import(MOD);
  let p = tambahPilihan(SINGLE, {}, 'm1');
  p = togglePilihan(SINGLE, p, 'm2');
  assert.deepEqual(p, { m2: 1000 }, 'radio menyimpan dua pilihan sekaligus');
});

test('⛔ kuantitas nol MENGHAPUS kuncinya', async () => {
  const { kurangPilihan } = await import(MOD);
  // Kunci ber-nilai nol terkirim sebagai `order_line_modifier` ber-qty 0 —
  // baris yang mengaku ada tapi tidak menambah apa pun ke pesanan, dan yang
  // tetap tercetak di struk.
  assert.deepEqual(kurangPilihan({ m1: 1000 }, 'm1'), {});
  assert.deepEqual(kurangPilihan({ m1: 2000 }, 'm1'), { m1: 1000 });
  assert.deepEqual(kurangPilihan({}, 'm1'), {}, 'kurang dari nol menghasilkan negatif');
});

test('pilihan tidak pernah BERMUTASI', async () => {
  const { tambahPilihan, kurangPilihan } = await import(MOD);
  const awal = Object.freeze({ m1: 1000 });
  assert.doesNotThrow(() => tambahPilihan({ ...MULTI, bolehGanda: true }, awal, 'm1'));
  assert.doesNotThrow(() => kurangPilihan(awal, 'm1'));
  assert.deepEqual(awal, { m1: 1000 });
});

// ---------------------------------------------------------------------------
// Minimum
// ---------------------------------------------------------------------------

test('⛔ `is_required` dan `min_selections` adalah SATU pertanyaan', async () => {
  const { kurangnya } = await import(MOD);
  // Dua sumber untuk satu pertanyaan menghasilkan dialog yang menolak karena
  // alasan yang tidak ditampilkannya. Yang berlaku adalah yang lebih besar.
  assert.equal(kurangnya({ ...SINGLE, wajib: true, minPilih: 0 }, {}), 1);
  assert.equal(kurangnya({ ...MULTI, wajib: false, minPilih: 2 }, {}), 2);
  assert.equal(kurangnya({ ...MULTI, wajib: true, minPilih: 2 }, {}), 2);
  assert.equal(kurangnya({ ...MULTI, wajib: false, minPilih: 0 }, {}), 0);
});

test('⛔ pesan menyebut ANGKANYA (`spec-a:122`: hitungan terlihat)', async () => {
  const { pesanKurang } = await import(MOD);
  // Kasir yang membaca "pilih dulu Topping" tidak tahu apakah ia kurang satu
  // atau kurang tiga, dan menekan tombol nonaktif sampai menyerah.
  const pesan = pesanKurang('Topping', { ...MULTI, minPilih: 2 }, { m1: 1000 });
  assert.match(pesan, /Topping/);
  assert.match(pesan, /1/, 'jumlah yang kurang tidak disebut');
  assert.match(pesan, /2/, 'minimumnya tidak disebut');
  assert.equal(pesanKurang('Topping', MULTI, {}), null, 'list opsional menuntut pilihan');
});

test('duplikat ikut memenuhi minimum', async () => {
  const { kurangnya } = await import(MOD);
  // Dua shot memenuhi "minimal dua" dengan cara yang sama seperti dua topping
  // berbeda: yang dihitung adalah unit, konsisten dengan batas maksimum.
  assert.equal(kurangnya({ ...MULTI, minPilih: 2, bolehGanda: true }, { m1: 2000 }), 0);
});
