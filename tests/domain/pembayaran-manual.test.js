'use strict';

// Transfer (`other` + `bank_transfer`) — metode konfirmasi-manual yang berfungsi
// offline. Spec kasir § 5, keputusan user P1/P2 (28 September 2026).
//
// ⛔ Aturan validasinya hidup di domain supaya perangkat dan server memakai
// kalimat yang SAMA: aturan yang hanya di server membuat kasir mengetik
// referensi kosong dan barisnya mati di outbox berjam-jam kemudian.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MAN = '../../packages/domain/src/pembayaran-manual.ts';
const TAMPIL = '../../packages/domain/src/metode-tampilan.ts';

test('⛔ G-TRF: transfer tanpa referensi ditolak VALIDATION_ERROR', async () => {
  const { periksaTransfer } = await import(MAN);
  for (const kosong of [undefined, null, '', '   ']) {
    const g = periksaTransfer(kosong, null);
    assert.ok(g, `referensi ${JSON.stringify(kosong)} harus ditolak`);
    assert.equal(g.kode, 'VALIDATION_ERROR');
    assert.equal(g.pesan, 'Nomor referensi transfer wajib (minimal 3 karakter).');
  }
});

test('referensi < 3 karakter ditolak', async () => {
  const { periksaTransfer } = await import(MAN);
  assert.equal(periksaTransfer('ab', null)?.kode, 'VALIDATION_ERROR');
  assert.equal(periksaTransfer('abc', null), null);
});

test('⛔ G-TRF: 13–19 digit di referensi → POSSIBLE_CARD_NUMBER, termasuk berpemisah "4111 1111 1111 1111" dan "4111-1111-1111-1111"', async () => {
  const { periksaTransfer } = await import(MAN);
  for (const v of ['4111111111111111', '4111 1111 1111 1111', '4111-1111-1111-1111', '1234567890123']) {
    const g = periksaTransfer(v, null);
    assert.equal(g?.kode, 'POSSIBLE_CARD_NUMBER', `referensi ${v} harus ditolak sebagai nomor kartu`);
  }
});

test('⛔ nomor kartu di field BANK juga ditolak', async () => {
  const { periksaTransfer } = await import(MAN);
  for (const v of ['4111111111111111', '4111 1111 1111 1111', '4111-1111-1111-1111']) {
    const g = periksaTransfer('REF-0001', v);
    assert.equal(g?.kode, 'POSSIBLE_CARD_NUMBER', `bank ${v} harus ditolak sebagai nomor kartu`);
    assert.match(g.pesan, /acquirer/);
  }
});

test('nomor rekening 10 digit dan referensi 12 digit LOLOS', async () => {
  const { periksaTransfer } = await import(MAN);
  assert.equal(periksaTransfer('123456789012', '1234567890'), null);
  assert.equal(periksaTransfer('TRF-77', 'BCA'), null);
  assert.equal(periksaTransfer('TRF-77', ''), null);
  assert.equal(periksaTransfer('TRF-77', undefined), null);
});

test('dikonfirmasiManual: qris_static dan other true; cash, card_edc, qris_dynamic false [P2]', async () => {
  const { dikonfirmasiManual } = await import(MAN);
  assert.equal(dikonfirmasiManual('qris_static'), true);
  assert.equal(dikonfirmasiManual('other'), true);
  for (const m of ['cash', 'card_edc', 'qris_dynamic']) {
    assert.equal(dikonfirmasiManual(m), false, m);
  }
});

test('PROVIDER_TRANSFER bernilai bank_transfer', async () => {
  const { PROVIDER_TRANSFER } = await import(MAN);
  assert.equal(PROVIDER_TRANSFER, 'bank_transfer');
});

test('labelMetode: other+bank_transfer = Transfer; kode laporan transfer = Transfer; other tanpa provider = Lainnya; card_edc tidak berubah', async () => {
  const { labelMetode } = await import(TAMPIL);
  assert.equal(labelMetode('other', 'bank_transfer'), 'Transfer');
  assert.equal(labelMetode('transfer'), 'Transfer');
  assert.equal(labelMetode('other'), 'Lainnya');
  assert.equal(labelMetode('other', null), 'Lainnya');
  assert.equal(labelMetode('card_edc'), 'Kartu / EDC');
  assert.equal(labelMetode('cash', 'bank_transfer'), 'Tunai');
});

test('⛔ kodeLaporanMetode: other+bank_transfer → transfer; other+null → other; cash+bank_transfer → cash', async () => {
  const { kodeLaporanMetode } = await import(TAMPIL);
  assert.equal(kodeLaporanMetode('other', 'bank_transfer'), 'transfer');
  assert.equal(kodeLaporanMetode('other', null), 'other');
  assert.equal(kodeLaporanMetode('other'), 'other');
  assert.equal(kodeLaporanMetode('cash', 'bank_transfer'), 'cash');
  assert.equal(kodeLaporanMetode('transfer'), 'transfer');
});
