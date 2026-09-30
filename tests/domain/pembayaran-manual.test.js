'use strict';

// Aturan pembayaran yang dikonfirmasi ORANG — sekarang termasuk Transfer
// (sub-proyek 2 Kasir, PR 2B Task 7; keputusan user P1 dan P2, 28 September 2026).
//
// Transfer memakai `method = 'other'` + `provider = 'bank_transfer'`, tanpa
// migrasi (`spec-c:244`). Berkas ini menjaga aturan yang dibagi perangkat dan
// server: referensi wajib, bukan nomor kartu, dan lipat `(method, provider)`
// menjadi SATU kode laporan.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../packages/domain/src/pembayaran-manual.ts';
const TAMPIL = '../../packages/domain/src/metode-tampilan.ts';

test('⛔ G-TRF: transfer tanpa referensi ditolak VALIDATION_ERROR', async () => {
  const { periksaTransfer } = await import(MOD);
  for (const kosong of [undefined, null, '', '   ', 42]) {
    const g = periksaTransfer(kosong, null);
    assert.notEqual(g, null, `referensi ${JSON.stringify(kosong)} lolos — transfer tanpa jejak`);
    assert.equal(g.kode, 'VALIDATION_ERROR');
    assert.equal(g.pesan, 'Nomor referensi transfer wajib (minimal 3 karakter).');
  }
});

test('referensi < 3 karakter ditolak; tepat 3 lolos', async () => {
  const { periksaTransfer } = await import(MOD);
  assert.equal(periksaTransfer('ab', null)?.kode, 'VALIDATION_ERROR', '2 karakter lolos');
  assert.equal(periksaTransfer(' ab ', null)?.kode, 'VALIDATION_ERROR', 'spasi ikut dihitung');
  assert.equal(periksaTransfer('abc', null), null, '3 karakter seharusnya lolos');
});

test('⛔ G-TRF: 13–19 digit di referensi → POSSIBLE_CARD_NUMBER, termasuk berpemisah', async () => {
  const { periksaTransfer } = await import(MOD);
  const bentuk = [
    '4111111111111111',
    '4111 1111 1111 1111',
    '4111-1111-1111-1111',
    '1234567890123', // 13 digit
    '1234567890123456789', // 19 digit
    'ref 4111 1111 1111 1111 bca',
  ];
  for (const b of bentuk) {
    const g = periksaTransfer(b, null);
    assert.equal(g?.kode, 'POSSIBLE_CARD_NUMBER', `"${b}" lolos sebagai referensi`);
  }
});

test('⛔ nomor kartu di field BANK juga ditolak (label acquirer)', async () => {
  const { periksaTransfer } = await import(MOD);
  const g = periksaTransfer('TRF-0001', '4111 1111 1111 1111');
  assert.equal(g?.kode, 'POSSIBLE_CARD_NUMBER', 'nomor kartu menyelinap lewat field bank');
  assert.match(g.pesan, /^acquirer /, 'pesan tidak menyebut field acquirer');
  // Bank kosong / bukan string tidak diperiksa.
  assert.equal(periksaTransfer('TRF-0001', ''), null);
  assert.equal(periksaTransfer('TRF-0001', null), null);
  assert.equal(periksaTransfer('TRF-0001', undefined), null);
  assert.equal(periksaTransfer('TRF-0001', 'BCA'), null);
});

test('nomor rekening 10 digit dan referensi 12 digit LOLOS', async () => {
  const { periksaTransfer } = await import(MOD);
  assert.equal(periksaTransfer('1234567890', null), null, 'rekening 10 digit ditolak');
  assert.equal(periksaTransfer('123456789012', null), null, 'referensi 12 digit ditolak');
});

test('⛔ [P2] dikonfirmasiManual: qris_static dan other true; cash, card_edc, qris_dynamic false', async () => {
  const { dikonfirmasiManual } = await import(MOD);
  assert.equal(dikonfirmasiManual('qris_static'), true);
  assert.equal(dikonfirmasiManual('other'), true, 'transfer harus ditandai dikonfirmasi-manual (P2)');
  for (const m of ['cash', 'card_edc', 'qris_dynamic']) {
    assert.equal(dikonfirmasiManual(m), false, `${m} tidak boleh ditandai dikonfirmasi-manual`);
  }
});

test('PROVIDER_TRANSFER dieja di satu tempat', async () => {
  const { PROVIDER_TRANSFER } = await import(MOD);
  assert.equal(PROVIDER_TRANSFER, 'bank_transfer');
});

test('labelMetode: other+bank_transfer = Transfer; kode laporan transfer = Transfer; other tanpa provider = Lainnya; card_edc tidak berubah', async () => {
  const { labelMetode, LABEL_METODE } = await import(TAMPIL);
  assert.equal(LABEL_METODE.transfer, 'Transfer');
  assert.equal(labelMetode('other', 'bank_transfer'), 'Transfer', 'transfer tampil sebagai Lainnya');
  assert.equal(labelMetode('transfer'), 'Transfer', 'kode laporan yang sudah terlipat harus terbaca Transfer');
  assert.equal(labelMetode('other'), 'Lainnya');
  assert.equal(labelMetode('other', null), 'Lainnya');
  assert.equal(labelMetode('other', 'provider_lain'), 'Lainnya');
  assert.equal(labelMetode('card_edc'), 'Kartu / EDC');
  assert.equal(labelMetode('card_edc', 'bank_transfer'), 'Kartu / EDC', 'provider tidak boleh melipat metode lain');
  assert.equal(labelMetode('metode_baru'), 'metode_baru', 'kode tak dikenal harus tampil apa adanya');
});

test('⛔ kodeLaporanMetode: other+bank_transfer → transfer; other+null → other; cash+bank_transfer → cash', async () => {
  const { kodeLaporanMetode } = await import(TAMPIL);
  assert.equal(kodeLaporanMetode('other', 'bank_transfer'), 'transfer');
  assert.equal(kodeLaporanMetode('other', null), 'other');
  assert.equal(kodeLaporanMetode('other'), 'other');
  assert.equal(kodeLaporanMetode('other', 'lain'), 'other');
  assert.equal(kodeLaporanMetode('cash', 'bank_transfer'), 'cash');
  assert.equal(kodeLaporanMetode('qris_static', 'bank_transfer'), 'qris_static');
  // Idempoten: kode yang sudah terlipat tidak berubah lagi.
  assert.equal(kodeLaporanMetode('transfer', null), 'transfer');
});
