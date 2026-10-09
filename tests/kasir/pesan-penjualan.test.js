'use strict';

// Fix round Task 11 (I-1): K-06 memetakan hasil `simpanPenjualan` ke kalimat galat.
// Cabang yang hilang jatuh ke "Keranjang kosong." — kalimat yang salah untuk keranjang berisi
// (DS #7). Pemetaan dikeluarkan ke fungsi murni supaya SETIAP status terbukti punya kalimatnya.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const rupiah = (n) => `Rp ${n}`;
const MOD = '../../apps/kasir/src/kasir/pesan-penjualan.ts';

test('⛔ data_pesanan_tidak_sah: kalimatnya pesan domain, BUKAN "Keranjang kosong."', async () => {
  const { pesanPenjualanGagal } = await import(MOD);
  const pesan = pesanPenjualanGagal({
    status: 'data_pesanan_tidak_sah',
    kode: 'POSSIBLE_CARD_NUMBER',
    pesan: 'Catatan tampak memuat nomor kartu. Data kartu tidak boleh masuk ke POS (FR-C5).',
  }, rupiah);
  assert.ok(pesan.includes('Catatan tampak memuat nomor kartu'), `pesan domain hilang: ${pesan}`);
  assert.doesNotMatch(pesan, /Keranjang kosong/, 'keranjang berisi dilaporkan kosong');
  assert.match(pesan, /belum tersimpan/i);
});

test('setiap status gagal punya kalimat sendiri; "Keranjang kosong." hanya untuk keranjang_kosong', async () => {
  const { pesanPenjualanGagal } = await import(MOD);
  const kasus = [
    { status: 'keranjang_kosong' },
    { status: 'kurang_bayar', amountDue: 1n, kurang: 1n },
    { status: 'pembayaran_tidak_sah', kode: 'VALIDATION_ERROR', pesan: 'referensi wajib' },
    { status: 'butuh_penyetuju_diskon', nominal: 5000n },
    { status: 'data_pesanan_tidak_sah', kode: 'VALIDATION_ERROR', pesan: 'Nama pemesan maksimal 40 karakter.' },
  ];
  const lihat = new Set();
  for (const k of kasus) {
    const p = pesanPenjualanGagal(k, rupiah);
    assert.ok(p.length > 10, `${k.status}: kalimat kosong`);
    assert.equal(/Keranjang kosong/.test(p), k.status === 'keranjang_kosong', `${k.status}: ${p}`);
    lihat.add(p);
  }
  assert.equal(lihat.size, kasus.length, 'dua status berbagi kalimat yang sama');
  // Status tak dikenal tidak boleh dibaca sebagai keranjang kosong.
  assert.doesNotMatch(pesanPenjualanGagal({ status: 'baru_belum_dikenal' }, rupiah), /Keranjang kosong/);
});

test('⛔ Pembayaran.tsx memakai pesanPenjualanGagal dan tidak punya "Keranjang kosong." inline', () => {
  const sumber = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', '..', 'apps', 'kasir', 'src', 'layar', 'Pembayaran.tsx'), 'utf8');
  assert.match(sumber, /pesanPenjualanGagal\(hasil, rupiah\)/, 'K-06 tidak memakai pemetaan status → kalimat');
  assert.doesNotMatch(sumber, /setGalat\('Keranjang kosong\.'\)/, 'fallback "Keranjang kosong." inline kembali');
});

test('pesan ketidakcocokan draf QRIS menyebut data pesanan bila itu penyebabnya (M-b)', () => {
  const sumber = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', '..', 'apps', 'kasir', 'src', 'layar', 'Pembayaran.tsx'), 'utf8');
  assert.match(sumber, /dataPesananDrafCocok\(drafTertunda, keranjang\)/);
  assert.match(sumber, /nama pemesan, nomor meja, atau catatan berbeda dari yang ditagih/);
});
