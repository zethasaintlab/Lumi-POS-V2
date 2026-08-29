'use strict';

// FR-D7 — no-sale. Murni.
//
// ⛔ Yang paling mudah salah di sini adalah ambangnya bergeser satu.
// `spec-d:239` menulis *"bila ini pembukaan ke-4 dalam shift"* — jadi tiga
// pembukaan pertama bebas, dan yang KEEMPAT menuntut PIN. Ambang yang
// bergeser membuat kasir dimintai PIN pada pembukaan yang merchant janjikan
// bebas, dan merchant menyimpulkan aplikasinya rusak.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../packages/domain/src/no-sale.ts';

test('⛔ tiga pembukaan pertama bebas; yang KEEMPAT menuntut PIN', async () => {
  const { butuhPenyetujuNoSale } = await import(MOD);
  assert.equal(butuhPenyetujuNoSale(0), false, 'pembukaan ke-1');
  assert.equal(butuhPenyetujuNoSale(1), false, 'pembukaan ke-2');
  assert.equal(butuhPenyetujuNoSale(2), false, 'pembukaan ke-3');
  assert.equal(butuhPenyetujuNoSale(3), true, 'pembukaan ke-4');
  assert.equal(butuhPenyetujuNoSale(9), true);
});

test('ambang dapat dikonfigurasi (AC FR-D7 kedua)', async () => {
  const { butuhPenyetujuNoSale, AMBANG_NO_SALE } = await import(MOD);
  assert.equal(AMBANG_NO_SALE, 3, 'bawaan spec-d:248');
  // ⛔ Ambang = berapa pembukaan yang BEBAS, jadi ambang 1 berarti pembukaan
  // pertama bebas dan yang KEDUA menuntut PIN. Membacanya sebagai "PIN mulai
  // pembukaan ke-N" menggeser seluruh tangga satu langkah.
  assert.equal(butuhPenyetujuNoSale(0, 1), false, 'ambang 1: pembukaan ke-1 bebas');
  assert.equal(butuhPenyetujuNoSale(1, 1), true, 'ambang 1: pembukaan ke-2 menuntut');
  assert.equal(butuhPenyetujuNoSale(4, 99), false, 'ambang tinggi: tidak menuntut');
});

test('⛔ rencana membawa URUTAN dan AMBANG, supaya layar dapat menyebut keduanya', async () => {
  // Kasir yang tiba-tiba dimintai PIN tanpa penjelasan menyimpulkan
  // aplikasinya rusak; kasir yang membaca "pembukaan ke-4" tahu persis kenapa.
  //
  // ⛔ `ambang` ikut sejak B-26 (24 Agustus 2026): merchant dapat menyetelnya
  // per outlet, dan komponen yang membacanya dari konstanta bawaan akan
  // menyebut "3×" pada outlet berambang 6 — memberi tahu kasir aturan yang
  // tidak berlaku baginya.
  const { rencanaNoSale, AMBANG_NO_SALE } = await import(MOD);
  assert.deepEqual(rencanaNoSale(0), {
    butuhPenyetuju: false,
    urutan: 1,
    ambang: AMBANG_NO_SALE,
  });
  assert.deepEqual(rencanaNoSale(3), {
    butuhPenyetuju: true,
    urutan: 4,
    ambang: AMBANG_NO_SALE,
  });
  // Ambang outlet dipakai apa adanya, termasuk nol.
  assert.deepEqual(rencanaNoSale(3, 6), { butuhPenyetuju: false, urutan: 4, ambang: 6 });
  assert.deepEqual(rencanaNoSale(0, 0), { butuhPenyetuju: true, urutan: 1, ambang: 0 });
});

test('daftar alasan TERTUTUP, dan menolak nilai asing', async () => {
  const { ALASAN_NO_SALE, adalahAlasanNoSale } = await import(MOD);
  // Free text tidak dapat diagregasi jadi laporan fraud — seluruh gunanya.
  assert.ok(ALASAN_NO_SALE.length >= 4);
  for (const a of ALASAN_NO_SALE) assert.equal(adalahAlasanNoSale(a), true);
  for (const buruk of ['', 'barang_rusak', 'TUKAR_UANG', null, undefined, 7, {}]) {
    assert.equal(adalahAlasanNoSale(buruk), false, `${String(buruk)} seharusnya ditolak`);
  }
});

test('⛔ alasan no-sale TIDAK berpotongan dengan alasan void/refund', async () => {
  // Yang dijelaskan bukan pembatalan transaksi melainkan kenapa laci dibuka
  // tanpa penjualan. Daftar yang berpotongan membuat laporan exception
  // mencampur dua peristiwa yang berbeda sepenuhnya.
  const { ALASAN_NO_SALE } = await import(MOD);
  const { VOID_REASON_CODES, REFUND_REASON_CODES } = await import(
    '../../packages/domain/src/cancellation.ts'
  );
  const lain = new Set([...VOID_REASON_CODES, ...REFUND_REASON_CODES]);
  const beririsan = ALASAN_NO_SALE.filter((a) => a !== 'lainnya' && lain.has(a));
  assert.deepEqual(beririsan, []);
});

test('⛔ event type menyatakan PERINTAH sistem, bukan bukti laci terbuka', async () => {
  const { EVENT_NO_SALE } = await import(MOD);
  // `spec-d:231`: sinyal ke laci SATU ARAH. Sistem tidak dapat mengetahui
  // apakah laci benar-benar terbuka, dan tidak dapat mendeteksi laci yang
  // dibuka manual dengan kunci. Nama yang menyiratkan bukti fisik akan
  // membuat merchant menyimpulkan selisih kas dari laporan yang buta pada
  // separuh pembukaan.
  assert.equal(EVENT_NO_SALE, 'cash_drawer_opened');
});
