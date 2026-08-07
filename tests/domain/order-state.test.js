'use strict';

// T1 -- state machine order (FR-B1, spec-b-kasir-order.md:24-77).
//
// Hidup di packages/domain, BUKAN di handler, karena dua alasan yang sama
// pentingnya:
//
//   1. AC FR-B1 pertama berbunyi "Transisi ilegal ditolak di lapisan domain,
//      bukan hanya UI" (spec-b:73).
//   2. Klien Tauri/SQLite harus menegakkan aturan yang SAMA PERSIS saat
//      offline, tanpa server. Aturan yang hanya hidup di handler REST tidak
//      berlaku saat perangkat tidak punya koneksi -- dan justru itulah
//      keadaan yang produk ini janjikan berfungsi penuh.
//
// DRAFT sengaja TIDAK punya baris di database (AC FR-B1 kedua: "Order DRAFT
// yang ditinggalkan tidak menghasilkan baris"), jadi ia ada di state machine
// sebagai titik awal tapi tidak pernah tersimpan.

const { test } = require('node:test');
const assert = require('node:assert/strict');

// Tabel transisi dari spec-b:57-69, disalin apa adanya. Test ini adalah
// pembacaan kedua yang independen dari spec -- kalau implementasi dan tabel
// ini ditulis dari sumber yang sama, keduanya bisa salah bersamaan, jadi
// tabel ini SENGAJA diketik ulang dari dokumen, bukan diimpor dari kode.
const TRANSISI_LEGAL = [
  ['draft', 'open'],
  ['open', 'open'],
  ['open', 'paid'],
  ['open', 'voided'],
  ['open', 'abandoned'],
  ['paid', 'closed'],
  ['paid', 'voided'],
  ['closed', 'refunded'],
  ['refunded', 'refunded'],
];

// spec-b:69 -- "Yang ditolak secara eksplisit: CLOSED -> OPEN ·
// VOIDED -> apa pun · REFUNDED -> PAID."
const DITOLAK_EKSPLISIT = [
  ['closed', 'open'],
  ['voided', 'open'],
  ['voided', 'paid'],
  ['voided', 'closed'],
  ['voided', 'refunded'],
  ['voided', 'voided'],
  ['voided', 'abandoned'],
  ['voided', 'draft'],
  ['refunded', 'paid'],
];

const SEMUA_STATUS = ['draft', 'open', 'paid', 'closed', 'voided', 'refunded', 'abandoned'];

function legal(from, to) {
  return TRANSISI_LEGAL.some(([f, t]) => f === from && t === to);
}

test('setiap transisi yang tercantum legal di spec diterima', async () => {
  const { isTransitionAllowed } = await import('../../packages/domain/src/order-state.ts');
  let diperiksa = 0;
  for (const [from, to] of TRANSISI_LEGAL) {
    assert.equal(isTransitionAllowed(from, to), true, `${from} -> ${to} seharusnya legal`);
    diperiksa += 1;
  }
  assert.equal(diperiksa, TRANSISI_LEGAL.length, 'loop harus benar-benar memeriksa setiap baris');
});

// INI property test-nya: bukan mencontohkan beberapa kasus, tapi menutup
// SELURUH ruang 7x7 = 49 pasangan. Transisi yang tidak tercantum di tabel
// spec harus ditolak -- termasuk yang tidak pernah terpikirkan siapa pun.
test('property: seluruh 49 pasangan status sesuai tabel spec, tidak ada yang lolos diam-diam', async () => {
  const { isTransitionAllowed } = await import('../../packages/domain/src/order-state.ts');
  let diperiksa = 0;
  for (const from of SEMUA_STATUS) {
    for (const to of SEMUA_STATUS) {
      assert.equal(
        isTransitionAllowed(from, to),
        legal(from, to),
        `${from} -> ${to}: diharapkan ${legal(from, to) ? 'legal' : 'ditolak'}`
      );
      diperiksa += 1;
    }
  }
  // Loop yang tidak pernah berjalan adalah test yang tidak menguji apa pun.
  assert.equal(diperiksa, 49, 'harus memeriksa seluruh 7x7 kombinasi');
});

test('transisi yang ditolak spec secara eksplisit memang ditolak', async () => {
  const { isTransitionAllowed } = await import('../../packages/domain/src/order-state.ts');
  let diperiksa = 0;
  for (const [from, to] of DITOLAK_EKSPLISIT) {
    assert.equal(isTransitionAllowed(from, to), false, `${from} -> ${to} seharusnya ditolak`);
    diperiksa += 1;
  }
  assert.equal(diperiksa, DITOLAK_EKSPLISIT.length);
});

// VOIDED adalah keadaan terminal mutlak. Kalau satu saja jalan keluar
// terbuka, transaksi yang sudah dinyatakan "tidak pernah terjadi secara
// finansial" bisa dihidupkan lagi -- dan itu adalah lubang fraud, bukan bug
// kenyamanan.
test('voided adalah terminal mutlak -- tidak ada jalan keluar sama sekali', async () => {
  const { isTransitionAllowed } = await import('../../packages/domain/src/order-state.ts');
  for (const to of SEMUA_STATUS) {
    assert.equal(isTransitionAllowed('voided', to), false, `voided -> ${to} harus ditolak`);
  }
});

test('draft tidak dapat dicapai dari status mana pun -- ia hanya titik awal', async () => {
  const { isTransitionAllowed } = await import('../../packages/domain/src/order-state.ts');
  for (const from of SEMUA_STATUS) {
    assert.equal(isTransitionAllowed(from, 'draft'), false, `${from} -> draft harus ditolak`);
  }
});

// refunded -> refunded legal (refund parsial berulang), tapi closed -> closed
// TIDAK: order yang sudah selesai tidak "diselesaikan ulang". Membedakan
// keduanya penting supaya self-transition tidak diizinkan borongan.
test('self-transition hanya legal untuk open dan refunded', async () => {
  const { isTransitionAllowed } = await import('../../packages/domain/src/order-state.ts');
  assert.equal(isTransitionAllowed('open', 'open'), true, 'item ditambah/dikurangi');
  assert.equal(isTransitionAllowed('refunded', 'refunded'), true, 'refund parsial berulang');
  for (const s of ['draft', 'paid', 'closed', 'voided', 'abandoned']) {
    assert.equal(isTransitionAllowed(s, s), false, `${s} -> ${s} harus ditolak`);
  }
});

test('assertTransition melempar dengan pesan yang menyebut kedua status', async () => {
  const { assertTransition } = await import('../../packages/domain/src/order-state.ts');
  assert.throws(
    () => assertTransition('closed', 'open'),
    (err) => /closed/.test(err.message) && /open/.test(err.message),
    'pesan harus menyebut dari mana ke mana, supaya bisa didiagnosis tanpa membaca kode'
  );
  // Jalur legal tidak melempar.
  assertTransition('open', 'paid');
});

// Status yang tidak dikenal (typo, versi klien lebih baru, data rusak) harus
// ditolak, BUKAN diperlakukan sebagai legal karena kebetulan tidak ada di
// daftar larangan. Default-nya tertutup, bukan terbuka.
test('status tidak dikenal ditolak, bukan dianggap legal', async () => {
  const { isTransitionAllowed, assertTransition } = await import('../../packages/domain/src/order-state.ts');
  assert.equal(isTransitionAllowed('open', 'settled'), false);
  assert.equal(isTransitionAllowed('OPEN', 'PAID'), false, 'huruf besar bukan status yang sama');
  assert.equal(isTransitionAllowed('', 'open'), false);
  assert.throws(() => assertTransition('open', 'settled'), /settled/);
});
