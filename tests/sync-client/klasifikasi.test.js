'use strict';

// T5 -- yang membedakan relay yang benar dari yang berbahaya bukan
// pengirimannya, melainkan bagaimana ia MEMBACA jawaban.
//
// Tabel di §3 PLAN-fr-h1-outbox-relay.md, satu test per baris.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const KLASIFIKASI = '../../packages/sync-client/src/klasifikasi.ts';

test('2xx -> terkirim', async () => {
  const { klasifikasi } = await import(KLASIFIKASI);
  for (const status of [200, 201, 204]) {
    assert.equal(klasifikasi({ status }), 'terkirim', `status ${status}`);
  }
});

// Yang paling mudah salah, dan paling mahal kalau salah.
//
// `openShift` TIDAK menuntut Idempotency-Key (§2.4 rencana) -- yang
// melindunginya hanya primary key yang di-generate klien. Retry karena itu
// menerima 409 ID_ALREADY_EXISTS, dan itu berarti item SUDAH SAMPAI.
// Menganggapnya gagal berarti mengirim ulang selamanya sampai batas 20
// percobaan, lalu menandai shift yang sehat sebagai `failed`.
test('409 ID_ALREADY_EXISTS -> terkirim, bukan gagal', async () => {
  const { klasifikasi } = await import(KLASIFIKASI);
  assert.equal(klasifikasi({ status: 409, code: 'ID_ALREADY_EXISTS' }), 'terkirim');
});

test('409 IDEMPOTENCY_KEY_CONFLICT -> coba lagi (request kembar sedang diproses)', async () => {
  const { klasifikasi } = await import(KLASIFIKASI);
  assert.equal(klasifikasi({ status: 409, code: 'IDEMPOTENCY_KEY_CONFLICT' }), 'coba-lagi');
});

// Body berbeda dengan key yang sama adalah bug klien. Dua puluh percobaan
// tidak akan memperbaikinya -- ia hanya menunda laporannya 20 kali backoff.
test('422 IDEMPOTENCY_KEY_REUSED -> gagal permanen seketika', async () => {
  const { klasifikasi } = await import(KLASIFIKASI);
  assert.equal(klasifikasi({ status: 422, code: 'IDEMPOTENCY_KEY_REUSED' }), 'gagal-permanen');
});

test('4xx lain -> gagal permanen seketika', async () => {
  const { klasifikasi } = await import(KLASIFIKASI);
  for (const status of [400, 401, 403, 404, 422]) {
    assert.equal(klasifikasi({ status }), 'gagal-permanen', `status ${status}`);
  }
});

test('5xx -> coba lagi', async () => {
  const { klasifikasi } = await import(KLASIFIKASI);
  for (const status of [500, 502, 503, 504]) {
    assert.equal(klasifikasi({ status }), 'coba-lagi', `status ${status}`);
  }
});

// Kasus yang membuat idempotency ada sama sekali. `CLAUDE.md` menuntut
// idempotensi diuji "dengan retry berulang DAN respons yang hilang".
//
// Respons yang hilang TIDAK BOLEH dibaca sebagai gagal-permanen: permintaan
// mungkin sudah sampai dan diproses, dan menandainya `failed` berarti
// penjualan yang sudah tercatat di server hilang dari antrean tanpa pernah
// dikonfirmasi.
test('respons HILANG (jaringan putus/timeout) -> coba lagi', async () => {
  const { klasifikasi } = await import(KLASIFIKASI);
  assert.equal(klasifikasi({ status: null }), 'coba-lagi');
  assert.equal(klasifikasi({ status: null, pesan: 'ECONNRESET' }), 'coba-lagi');
});

// 429 bukan payload yang cacat. Menandainya gagal-permanen membuang
// penjualan yang sah hanya karena server sedang sibuk.
test('429 -> coba lagi, bukan gagal permanen', async () => {
  const { klasifikasi } = await import(KLASIFIKASI);
  assert.equal(klasifikasi({ status: 429 }), 'coba-lagi');
});

test('kode 409 yang tidak dikenal -> coba lagi, tidak pernah dianggap terkirim', async () => {
  const { klasifikasi } = await import(KLASIFIKASI);
  // Menebak ke arah "terkirim" berarti menghapus item dari antrean
  // berdasarkan kata yang tidak dimengerti -- pola yang sama dengan aturan
  // gateway di CLAUDE.md ("status tak dikenal -> pending, tidak pernah
  // confirmed").
  assert.equal(klasifikasi({ status: 409, code: 'SESUATU_YANG_BARU' }), 'coba-lagi');
  assert.equal(klasifikasi({ status: 409 }), 'coba-lagi');
});
