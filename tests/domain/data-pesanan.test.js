'use strict';

// Nama pemesan, nomor meja, dan catatan pesanan (sub-proyek 2 Kasir, PR 2C
// Task 11; P5(b) + P6(a)). Aturan dibagi perangkat dan server.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../packages/domain/src/data-pesanan.ts';

const KASUS = [
  { fn: 'periksaNamaPemesan', maks: 'MAKS_NAMA_PEMESAN', nilai: 40 },
  { fn: 'periksaNomorMeja', maks: 'MAKS_NOMOR_MEJA', nilai: 16 },
  { fn: 'periksaCatatan', maks: 'MAKS_CATATAN', nilai: 140 },
];

test('batas tepat dan batas+1: 40/41, 16/17, 140/141', async () => {
  const m = await import(MOD);
  for (const k of KASUS) {
    assert.equal(m[k.maks], k.nilai, `${k.maks} harus ${k.nilai}`);
    assert.equal(m[k.fn]('a'.repeat(k.nilai)), null, `${k.fn}: ${k.nilai} karakter sah`);
    const g = m[k.fn]('a'.repeat(k.nilai + 1));
    assert.ok(g, `${k.fn}: ${k.nilai + 1} karakter ditolak`);
    assert.equal(g.kode, 'VALIDATION_ERROR', `kode ${g.kode}, harap VALIDATION_ERROR`);
    assert.ok(g.pesan.includes(String(k.nilai)), `pesan menyebut batas ${k.nilai}: ${g.pesan}`);
  }
});

test('⛔ nomor kartu di nama/meja/catatan → POSSIBLE_CARD_NUMBER, termasuk berpemisah', async () => {
  const m = await import(MOD);
  for (const fn of ['periksaNamaPemesan', 'periksaNomorMeja', 'periksaCatatan']) {
    for (const kartu of ['4111111111111111', '4111 1111 1111 1111', '4111-1111-1111-1111']) {
      const g = m[fn](kartu);
      assert.ok(g, `${fn}(${kartu}) harus ditolak`);
      assert.equal(g.kode, 'POSSIBLE_CARD_NUMBER', `kode ${g.kode}, harap POSSIBLE_CARD_NUMBER`);
    }
  }
  // Nomor telepon 12 digit dan meja "A3" tetap sah (ambang 13).
  assert.equal(m.periksaCatatan('Telp 081234567890'), null, 'nomor telepon di catatan ditolak (hanya nomor kartu yang ditolak)');
  assert.equal(m.periksaNomorMeja('A3'), null, 'nomor meja "A3" sah ditolak');
});

test('kosong dan spasi saja → null, bukan galat', async () => {
  const m = await import(MOD);
  for (const fn of ['periksaNamaPemesan', 'periksaNomorMeja', 'periksaCatatan']) {
    for (const kosong of [undefined, null, '', '   ']) {
      assert.equal(m[fn](kosong), null, `${fn}(${JSON.stringify(kosong)})`);
    }
  }
});

test('bukan string → VALIDATION_ERROR (angka, objek, array)', async () => {
  const m = await import(MOD);
  for (const fn of ['periksaNamaPemesan', 'periksaNomorMeja', 'periksaCatatan']) {
    for (const buruk of [42, {}, ['a'], true]) {
      const g = m[fn](buruk);
      assert.ok(g, `${fn}(${JSON.stringify(buruk)}) harus ditolak`);
      assert.equal(g.kode, 'VALIDATION_ERROR', `kode ${g.kode}, harap VALIDATION_ERROR`);
    }
  }
});

test('batas dihitung SESUDAH trim', async () => {
  const m = await import(MOD);
  assert.equal(m.periksaNamaPemesan('  ' + 'a'.repeat(40) + '  '), null, 'batas 40 dihitung SEBELUM trim');
  assert.equal(m.normalisasiTeksPesanan('  Budi  '), 'Budi', 'spasi tepi tidak dipangkas');
  assert.equal(m.normalisasiTeksPesanan('   '), null, 'teks spasi saja bukan null');
  assert.equal(m.normalisasiTeksPesanan(null), null, 'null bukan null');
  assert.equal(m.normalisasiTeksPesanan(undefined), null, 'undefined bukan null');
});

test('⛔ karakter kontrol dan baris baru ditolak VALIDATION_ERROR berpesan; teks biasa tetap sah', async () => {
  const m = await import(MOD);
  for (const fn of ['periksaNamaPemesan', 'periksaNomorMeja', 'periksaCatatan']) {
    for (const buruk of ['a\nb', 'a\r\nb', 'a\tb', 'a\u0000b', 'a\u001bb', 'a\u007fb', 'a\u0085b', 'a\u2028b', 'a\u2029b', 'a\u009bb']) {
      const g = m[fn](buruk);
      assert.ok(g, `${fn}(${JSON.stringify(buruk)}) harus ditolak`);
      assert.equal(g.kode, 'VALIDATION_ERROR', `kode ${g.kode}, harap VALIDATION_ERROR`);
      assert.match(g.pesan, /karakter kontrol atau baris baru/, `pesan tidak menyebut sebabnya: ${g.pesan}`);
    }
    assert.equal(m[fn]('Budi Santoso'), null, `${fn}: teks biasa sah`);
  }
  // Baris baru di TEPI dipangkas trim seperti spasi; yang di tengah ditolak.
  assert.equal(m.periksaCatatan('  Tanpa gula\n'), null, 'baris baru di tepi harus dipangkas trim');
});
