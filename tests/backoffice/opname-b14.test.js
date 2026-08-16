'use strict';

// B-14 — aturan layar Opname.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const B14 = '../../apps/backoffice/src/inventori/b14.ts';

// ---------------------------------------------------------------------------
// ⛔ Baris kosong vs baris nol
// ---------------------------------------------------------------------------

test('⛔ baris KOSONG dilewati, tidak dikirim sebagai nol', async () => {
  // Kosong berarti "belum dihitung"; nol berarti "dihitung, hasilnya tidak
  // ada". Mengirim yang pertama sebagai yang kedua menghapus seluruh stok
  // barang yang petugas belum sempat hitung.
  const { susunBarisHitung } = await import(B14);
  const { lines, galat } = susunBarisHitung([
    { variationId: 'v1', teks: '' },
    { variationId: 'v2', teks: '   ' },
    { variationId: 'v3', teks: '5' },
  ]);
  assert.deepEqual(galat, []);
  assert.deepEqual(lines, [{ variationId: 'v3', countedQty: '5000' }]);
});

test('⛔ NOL yang diketik sengaja TETAP dikirim', async () => {
  // "Dihitung, hasilnya nol" adalah temuan yang sah dan sering — barang habis.
  // `bacaKuantitas` menolak nol karena untuk penyesuaian ia tidak berarti
  // apa-apa; di opname ia justru salah satu jawaban terpenting.
  const { susunBarisHitung } = await import(B14);
  const { lines } = susunBarisHitung([
    { variationId: 'v1', teks: '0' },
    { variationId: 'v2', teks: '0,0' },
  ]);
  assert.deepEqual(lines, [
    { variationId: 'v1', countedQty: '0' },
    { variationId: 'v2', countedQty: '0' },
  ]);
});

test('desimal dan negatif ditangani seperti di B-13', async () => {
  const { susunBarisHitung } = await import(B14);
  const { lines, galat } = susunBarisHitung([
    { variationId: 'v1', teks: '2,5' },
    { variationId: 'v2', teks: '-3' },
    { variationId: 'v3', teks: 'sepuluh' },
  ]);
  assert.deepEqual(lines, [{ variationId: 'v1', countedQty: '2500' }]);
  assert.equal(galat.length, 2);
  assert.equal(galat[0].variationId, 'v2');
});

// ---------------------------------------------------------------------------
// Selisih
// ---------------------------------------------------------------------------

test('⛔ arah selisih: negatif KURANG, positif LEBIH, nol COCOK', async () => {
  const { arahSelisihStok } = await import(B14);
  assert.equal(arahSelisihStok('-2000'), 'kurang');
  assert.equal(arahSelisihStok('2000'), 'lebih');
  assert.equal(arahSelisihStok('0'), 'cocok');
});

test('⛔ baris yang belum dihitung BUKAN "cocok"', async () => {
  const { arahSelisihStok, LABEL_SELISIH_STOK } = await import(B14);
  assert.equal(arahSelisihStok(null), 'belum');
  assert.notEqual(LABEL_SELISIH_STOK.belum, LABEL_SELISIH_STOK.cocok);
});

test('selisih tampil membawa tanda dan satuan utuh', async () => {
  const { selisihTampil } = await import(B14);
  assert.equal(selisihTampil('-2000'), '− 2');
  assert.equal(selisihTampil('2500'), '+ 2,5');
  assert.equal(selisihTampil('0'), '0');
  assert.equal(selisihTampil(null), '—');
});

test('⛔ presisi selisih utuh di atas 2^53', async () => {
  const { selisihTampil } = await import(B14);
  assert.equal(selisihTampil('-9007199254740993'), '− 9007199254740,993');
});

test('setiap arah punya label, dan nadanya membedakan', async () => {
  const { LABEL_SELISIH_STOK, nadaSelisihStok } = await import(B14);
  for (const a of ['cocok', 'kurang', 'lebih', 'belum']) {
    assert.ok(LABEL_SELISIH_STOK[a].length > 0, `${a} tanpa label`);
  }
  assert.equal(nadaSelisihStok('kurang'), nadaSelisihStok('lebih'));
  assert.notEqual(nadaSelisihStok('cocok'), nadaSelisihStok('kurang'));
});

// ---------------------------------------------------------------------------
// Status dan ringkasan
// ---------------------------------------------------------------------------

test('status opname terbaca merchant, kode asing apa adanya', async () => {
  const { labelStatusOpname, nadaStatusOpname } = await import(B14);
  assert.equal(labelStatusOpname('counting'), 'Sedang dihitung');
  assert.equal(labelStatusOpname('approved'), 'Selesai');
  assert.equal(labelStatusOpname('status_baru'), 'status_baru');
  assert.notEqual(nadaStatusOpname('approved'), nadaStatusOpname('counting'));
});

test('ringkasan menghitung yang dihitung dan yang berselisih', async () => {
  const { ringkasHitungan } = await import(B14);
  const L = (countedQty, selisih) => ({ countedQty, selisih });
  const r = ringkasHitungan([
    L('8000', '-2000'),
    L('10000', '0'),
    L(null, null),
    L('5000', '1000'),
  ]);
  assert.equal(r.total, 4);
  assert.equal(r.dihitung, 3);
  assert.equal(r.berselisih, 2);
});

test('⛔ kuantitas SEPAKAT dengan B-12', async () => {
  // Dua layar yang memformat kuantitas dengan cara berbeda membuat angka yang
  // sama terbaca berbeda di halaman sebelah.
  const { selisihTampil } = await import(B14);
  const { kuantitasTampil } = await import('../../apps/backoffice/src/inventori/b12.ts');
  assert.equal(selisihTampil('2500'), `+ ${kuantitasTampil(2500n)}`);
});
