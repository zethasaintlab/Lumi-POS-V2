'use strict';

// B-26 Ambang Otorisasi — resolusi dan batas. `IA:205`.
//
// ⛔ Satu hal yang diuji lebih keras daripada yang lain: `null` BERBEDA dari
// nol. Nol berarti "setiap kejadian menuntut otorisasi" — pilihan yang sah
// untuk merchant yang lacinya kecil, dan yang paling mudah hilang lewat satu
// `||` di jalur resolusi. Kegagalannya tidak menghasilkan error; ia hanya
// membuat merchant yang menyetel nol melihat layarnya menampilkan 20.000.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../packages/domain/src/ambang.ts';

test('tanpa setelan, seluruhnya memakai bawaan', async () => {
  const { ambangBerlaku, AMBANG_BAWAAN } = await import(MOD);
  assert.deepEqual(ambangBerlaku(null), AMBANG_BAWAAN);
  assert.deepEqual(ambangBerlaku({}), AMBANG_BAWAAN);
});

test('⛔ NOL adalah setelan, bukan ketiadaan setelan', async () => {
  const { ambangBerlaku } = await import(MOD);
  const hasil = ambangBerlaku({ selisihKas: 0n, noSale: 0, diskonNominal: 0n });
  assert.equal(hasil.selisihKas, 0n);
  assert.equal(hasil.noSale, 0);
  assert.equal(hasil.diskonNominal, 0n);
});

test('⛔ bawaannya DIIMPOR dari tempat aturannya hidup, bukan disalin', async () => {
  // Tiga angka yang sama di dua berkas akan menyimpang, dan yang menyimpang
  // menghasilkan perangkat yang menuntut otorisasi untuk selisih yang server
  // terima diam-diam — kasir yang sama, shift yang sama, jawaban berbeda.
  const { AMBANG_BAWAAN } = await import(MOD);
  const { AMBANG_DISKON_PERSEN, AMBANG_DISKON_NOMINAL } = await import(
    '../../packages/domain/src/diskon.ts'
  );
  const { AMBANG_SELISIH } = await import('../../packages/domain/src/buku-kas.ts');
  const { AMBANG_NO_SALE } = await import('../../packages/domain/src/no-sale.ts');

  assert.equal(AMBANG_BAWAAN.diskonPersenSkala, AMBANG_DISKON_PERSEN);
  assert.equal(AMBANG_BAWAAN.diskonNominal, AMBANG_DISKON_NOMINAL);
  assert.equal(AMBANG_BAWAAN.selisihKas, BigInt(AMBANG_SELISIH));
  assert.equal(AMBANG_BAWAAN.noSale, AMBANG_NO_SALE);
});

test('setelan sebagian: yang disetel dipakai, sisanya bawaan', async () => {
  const { ambangBerlaku, AMBANG_BAWAAN } = await import(MOD);
  const hasil = ambangBerlaku({ selisihKas: 50000n });
  assert.equal(hasil.selisihKas, 50000n);
  assert.equal(hasil.noSale, AMBANG_BAWAAN.noSale);
});

// ---------------------------------------------------------------------------
// Batas
// ---------------------------------------------------------------------------

const KOSONG = {
  diskonPersenSkala: null,
  diskonNominal: null,
  selisihKas: null,
  noSale: null,
};

test('⛔ `null` di setiap bidang DITERIMA — "kembali ke bawaan" adalah perintah', async () => {
  // Menolaknya memaksa merchant mengetik ulang angka bawaan yang tidak pernah
  // ia lihat.
  const { periksaAmbang } = await import(MOD);
  assert.deepEqual(periksaAmbang(KOSONG), { ok: true });
});

test('nol diterima di setiap bidang', async () => {
  const { periksaAmbang } = await import(MOD);
  assert.deepEqual(
    periksaAmbang({
      diskonPersenSkala: 0n,
      diskonNominal: 0n,
      selisihKas: 0n,
      noSale: 0,
    }),
    { ok: true }
  );
});

test('negatif ditolak, dan pesannya menyebut bidangnya', async () => {
  const { periksaAmbang } = await import(MOD);
  const hasil = periksaAmbang({ ...KOSONG, selisihKas: -1n });
  assert.equal(hasil.ok, false);
  assert.equal(hasil.bidang, 'selisihKas');
  assert.match(hasil.pesan, /selisih kas/i);
  assert.match(hasil.pesan, /negatif/i);
});

test('⛔ salah ketik satu digit ditolak, bukan disimpan sebagai kontrol yang mati', async () => {
  // Merchant yang mengetik satu nol berlebih pada ambang selisih kas
  // menaikkannya dari Rp 20.000 menjadi Rp 200.000, dan tidak ada apa pun di
  // layar yang akan memberitahunya — selisih kas yang seharusnya
  // dipertanyakan hanya berhenti muncul.
  const { periksaAmbang, BATAS_SELISIH_KAS } = await import(MOD);
  const hasil = periksaAmbang({ ...KOSONG, selisihKas: BATAS_SELISIH_KAS + 1n });
  assert.equal(hasil.ok, false);
  assert.equal(hasil.bidang, 'selisihKas');
});

test('persen di atas 100% ditolak', async () => {
  const { periksaAmbang } = await import(MOD);
  const { SKALA_TARIF } = await import('../../packages/domain/src/numeric.ts');
  assert.equal(periksaAmbang({ ...KOSONG, diskonPersenSkala: SKALA_TARIF }).ok, true);
  assert.equal(periksaAmbang({ ...KOSONG, diskonPersenSkala: SKALA_TARIF + 1n }).ok, false);
});

test('⛔ TIDAK ADA nilai yang berarti "tidak pernah menuntut otorisasi"', async () => {
  // Ambang yang dapat dimatikan adalah kontrol yang hilang pada hari seseorang
  // membutuhkannya — dan yang mematikannya adalah orang yang paling ingin ia
  // mati. Merchant yang menginginkan praktis tanpa PIN menyetel angkanya
  // tinggi; itu terlihat sebagai angka, dan tercatat di audit.
  //
  // Penjaganya BENTUK datanya: tidak ada bidang boolean, dan `null` sudah
  // berarti "pakai bawaan" — bukan "tidak ada ambang".
  const { ambangBerlaku, AMBANG_BAWAAN } = await import(MOD);
  for (const nilai of [null, undefined]) {
    const hasil = ambangBerlaku({ selisihKas: nilai, noSale: nilai });
    assert.equal(hasil.selisihKas, AMBANG_BAWAAN.selisihKas);
    assert.equal(hasil.noSale, AMBANG_BAWAAN.noSale);
  }
  assert.deepEqual(
    Object.keys(ambangBerlaku(null)).sort(),
    ['diskonNominal', 'diskonPersenSkala', 'noSale', 'selisihKas']
  );
});
