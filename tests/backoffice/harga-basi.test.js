'use strict';

// FR-A7 AC keempat — aturan tampilan panel "perangkat berharga basi".
//
// ⛔ Yang paling penting diuji: kalimat batasnya. `last_seen_at` adalah proksi,
// dan panel yang membiarkan daftar kosong terbaca sebagai jaminan membuat
// merchant menyimpulkan lebih dari yang datanya dukung.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../apps/backoffice/src/dasbor/harga-basi.ts';

test('⛔ keempat keadaan bukan-siap punya kalimatnya SENDIRI', async () => {
  // "Belum dimuat", "semua mutakhir", "tidak berhak", dan "gagal memuat"
  // tampak sama di layar dan berarti hal yang sangat berbeda. Yang paling
  // berbahaya adalah keempat terbaca seperti kedua.
  const { pesanPanel } = await import(MOD);
  const pesan = ['memuat', 'kosong', 'tidak-berhak', 'gagal'].map((k) => pesanPanel(k, 5));
  assert.equal(new Set(pesan).size, 4, `ada kalimat yang sama: ${pesan.join(' | ')}`);
  for (const p of pesan) assert.ok(typeof p === 'string' && p.trim() !== '');
});

test('⛔ "gagal" TIDAK boleh terbaca seperti "semua mutakhir"', async () => {
  const { pesanPanel } = await import(MOD);
  const gagal = pesanPanel('gagal', 5);
  // Ia harus menyangkal kesimpulan itu secara eksplisit.
  assert.match(gagal, /BUKAN berarti/i);
});

test('siap tidak punya pesan — tabelnya yang dirender', async () => {
  const { pesanPanel } = await import(MOD);
  assert.equal(pesanPanel('siap', 5), null);
});

test('⛔ "kosong" MENYEBUT berapa perangkat yang diperiksa', async () => {
  // "Tidak ada perangkat yang tertinggal" dari NOL perangkat berarti hal yang
  // sangat berbeda dari yang sama dari sepuluh perangkat, dan keduanya
  // terlihat sama.
  const { pesanPanel } = await import(MOD);
  const nol = pesanPanel('kosong', 0);
  const sepuluh = pesanPanel('kosong', 10);
  assert.notEqual(nol, sepuluh);
  assert.match(sepuluh, /10/);
  assert.match(nol, /belum ada perangkat/i);
});

test('⛔ kalimat BATAS menyatakan asimetrinya', async () => {
  // "Belum menerima" dapat dibuktikan; "sudah menerima" tidak. Tanpa kalimat
  // ini, daftar kosong terbaca sebagai jaminan.
  const { CATATAN_BATAS } = await import(MOD);
  assert.match(CATATAN_BATAS, /belum tentu/i);
  assert.match(CATATAN_BATAS, /bukan dari apa yang benar-benar/i);
});

test('⛔ perangkat yang BELUM PERNAH terhubung dibedakan tegas', async () => {
  // Ia bukan "0 jam lalu" dan bukan "tidak diketahui" — ia perangkat yang
  // tidak pernah memakai harga apa pun yang benar, dan itu keadaan yang paling
  // perlu ditindaklanjuti.
  const { terlihatTampil } = await import(MOD);
  const sekarang = new Date('2026-08-24T12:00:00Z');
  const belum = terlihatTampil(null, sekarang);
  assert.match(belum, /belum pernah/i);
  assert.notEqual(belum, terlihatTampil('2026-08-24T11:59:00Z', sekarang));
});

test('umur dinyatakan dalam satuan yang terbaca', async () => {
  const { terlihatTampil } = await import(MOD);
  const sekarang = new Date('2026-08-24T12:00:00Z');
  assert.match(terlihatTampil('2026-08-24T11:59:00Z', sekarang), /kurang dari 1 jam/i);
  assert.match(terlihatTampil('2026-08-24T09:00:00Z', sekarang), /3 jam/);
  assert.match(terlihatTampil('2026-08-21T12:00:00Z', sekarang), /3 hari/);
});

test('⛔ angka tertinggal SELALU disertai katanya', async () => {
  // "3" di kolom bernama "Tertinggal" dapat terbaca sebagai jam, hari, atau
  // rupiah oleh orang yang membaca sekilas — dan layar ini dibaca sekilas
  // setiap pagi.
  const { tertinggalTampil } = await import(MOD);
  for (const n of [1, 2, 17]) {
    const teks = tertinggalTampil(n);
    assert.match(teks, /perubahan harga/i, String(n));
    assert.match(teks, new RegExp(String(n)));
  }
});
