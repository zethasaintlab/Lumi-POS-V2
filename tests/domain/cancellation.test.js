'use strict';

// T4-T5 (docs/superpowers/plans/PLAN-void-refund-gateway.md) -- aturan
// pembatalan transaksi di lapisan domain.
//
// spec-b:235 -- "Kasir tidak memilih 'void' atau 'refund' -- kasir menekan
// 'Batalkan transaksi', dan SISTEM menentukan operasi mana yang berlaku
// berdasarkan state."
//
// Kenapa di packages/domain dan bukan di handler: AC FR-B7 kelima berbunyi
// "Void dan refund berfungsi offline". Klien Tauri/SQLite karena itu harus
// memutuskan operasi yang SAMA PERSIS tanpa server. Aturan yang hanya hidup
// di handler REST tidak berlaku pada keadaan yang produk ini janjikan
// berfungsi penuh.
//
// Murni: tanpa I/O, tanpa waktu, tanpa database.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const CANCELLATION = '../../packages/domain/src/cancellation.ts';
const ORDER_STATE = '../../packages/domain/src/order-state.ts';

const SEMUA_STATUS = ['draft', 'open', 'paid', 'closed', 'voided', 'refunded', 'abandoned'];

// Diketik ulang dari spec-b:228 ("Syarat state: OPEN atau PAID yang belum
// di-settle" untuk void, "CLOSED" untuk refund) DAN dari tabel transisi
// spec-b:57-69 yang memuat `refunded -> refunded` untuk refund parsial
// berulang. Sengaja dibaca dari dokumen, bukan diimpor dari kode -- kalau
// test dan implementasi lahir dari sumber yang sama, keduanya bisa salah
// bersamaan.
const OPERASI_MENURUT_SPEC = {
  draft: null,
  open: 'void',
  paid: 'void',
  closed: 'refund',
  voided: null,
  refunded: 'refund', // refund parsial berulang, spec-b:66
  abandoned: null,
};

// --- T4: pemilihan operasi ---

test('decideCancellation: memilih operasi menurut state, untuk SELURUH status', async () => {
  const { decideCancellation } = await import(CANCELLATION);
  let diperiksa = 0;
  for (const status of SEMUA_STATUS) {
    const harapan = OPERASI_MENURUT_SPEC[status];
    if (harapan === null) {
      assert.throws(
        () => decideCancellation(status),
        (err) => err instanceof Error && err.message.includes(status),
        `status ${status} tidak dapat dibatalkan, harus melempar dan menyebut statusnya`
      );
    } else {
      assert.equal(decideCancellation(status), harapan, `status ${status}`);
    }
    diperiksa += 1;
  }
  assert.equal(diperiksa, SEMUA_STATUS.length);
});

// Status yang tidak dikenal (klien versi lebih baru, baris lama) tidak boleh
// diam-diam jatuh ke salah satu operasi. Default tertutup, seperti
// isTransitionAllowed.
test('decideCancellation: status tak dikenal ditolak, bukan ditebak', async () => {
  const { decideCancellation } = await import(CANCELLATION);
  for (const status of ['', 'OPEN', 'settled', 'partially_refunded', 'null']) {
    assert.throws(() => decideCancellation(status), /tidak dapat dibatalkan|tidak dikenal/i, `status ${status}`);
  }
});

// INI yang mengikat kedua aturan jadi satu. Kalau decideCancellation dan
// state machine bergeser sendiri-sendiri, akan ada status yang boleh
// dibatalkan tapi transisinya ditolak beberapa lapis kemudian -- kasir
// menerima 500, bukan penolakan yang bisa dijelaskan.
test('decideCancellation konsisten dengan state machine, dua arah', async () => {
  const { decideCancellation } = await import(CANCELLATION);
  const { isTransitionAllowed } = await import(ORDER_STATE);

  for (const status of SEMUA_STATUS) {
    const keVoided = isTransitionAllowed(status, 'voided');
    const keRefunded = isTransitionAllowed(status, 'refunded');

    // Tidak boleh ada status yang boleh ke KEDUANYA -- operasinya jadi ambigu
    // dan sistem tidak lagi bisa "menentukan" seperti dituntut spec-b:235.
    assert.equal(keVoided && keRefunded, false, `status ${status} ambigu: boleh void DAN refund`);

    if (keVoided) {
      assert.equal(decideCancellation(status), 'void', `${status} boleh -> voided`);
    } else if (keRefunded) {
      assert.equal(decideCancellation(status), 'refund', `${status} boleh -> refunded`);
    } else {
      assert.throws(() => decideCancellation(status), `${status} tidak boleh ke voided maupun refunded`);
    }
  }
});

// --- T4: alasan daftar tertutup (spec-b:288-296) ---

// Diketik ulang dari tabel spec-b:290-291. Free text tidak dapat diagregasi
// menjadi laporan fraud -- itu alasan daftarnya tertutup, dan itu pula alasan
// laporan exception FR-G5 naik jadi wajib setelah void kehilangan PIN.
const ALASAN_VOID = ['salah_input', 'pelanggan_batal', 'item_habis', 'uji_coba', 'lainnya'];
const ALASAN_REFUND = ['barang_rusak', 'pesanan_salah', 'pelanggan_tidak_puas', 'kelebihan_bayar', 'lainnya'];

test('assertCancellationReason: seluruh alasan yang sah diterima', async () => {
  const { assertCancellationReason } = await import(CANCELLATION);
  for (const kode of ALASAN_VOID) {
    const catatan = kode === 'lainnya' ? 'pelanggan pindah outlet' : null;
    assertCancellationReason('void', kode, catatan);
  }
  for (const kode of ALASAN_REFUND) {
    const catatan = kode === 'lainnya' ? 'promo salah diterapkan' : null;
    assertCancellationReason('refund', kode, catatan);
  }
});

// Daftar void dan refund BERBEDA (spec-b:290-291). Memakai alasan void untuk
// refund harus ditolak, bukan diterima karena "toh ada di salah satu daftar".
test('assertCancellationReason: alasan void ditolak untuk refund dan sebaliknya', async () => {
  const { assertCancellationReason } = await import(CANCELLATION);
  for (const kode of ALASAN_VOID.filter((k) => k !== 'lainnya')) {
    assert.throws(() => assertCancellationReason('refund', kode, null), `${kode} bukan alasan refund`);
  }
  for (const kode of ALASAN_REFUND.filter((k) => k !== 'lainnya')) {
    assert.throws(() => assertCancellationReason('void', kode, null), `${kode} bukan alasan void`);
  }
});

test('assertCancellationReason: alasan di luar daftar ditolak', async () => {
  const { assertCancellationReason } = await import(CANCELLATION);
  for (const kode of ['', 'Salah Input', 'salah input', 'other', 'lain-lain', 'SALAH_INPUT']) {
    assert.throws(() => assertCancellationReason('void', kode, 'catatan yang cukup panjang'), `${kode}`);
  }
});

// spec-b:296 -- "Lainnya wajib catatan bebas minimal 10 karakter."
test('assertCancellationReason: `lainnya` menuntut catatan minimal 10 karakter', async () => {
  const { assertCancellationReason } = await import(CANCELLATION);
  for (const operasi of ['void', 'refund']) {
    assert.throws(() => assertCancellationReason(operasi, 'lainnya', null), /catatan/i);
    assert.throws(() => assertCancellationReason(operasi, 'lainnya', ''), /catatan/i);
    assert.throws(() => assertCancellationReason(operasi, 'lainnya', '123456789'), /catatan/i); // 9
    assertCancellationReason(operasi, 'lainnya', '1234567890'); // tepat 10
  }
});

// Spasi bukan penjelasan. Kolom audit yang isinya sepuluh spasi lolos
// pemeriksaan panjang tapi tidak menjelaskan apa pun ke siapa pun yang
// membaca laporan exception nanti.
test('assertCancellationReason: catatan berisi spasi saja ditolak', async () => {
  const { assertCancellationReason } = await import(CANCELLATION);
  assert.throws(() => assertCancellationReason('void', 'lainnya', '          '), /catatan/i);
  assert.throws(() => assertCancellationReason('void', 'lainnya', '  \t\n  abc  '), /catatan/i);
});

// Alasan selain `lainnya` tidak menuntut catatan, tapi juga tidak menolaknya.
test('assertCancellationReason: catatan opsional untuk alasan selain `lainnya`', async () => {
  const { assertCancellationReason } = await import(CANCELLATION);
  assertCancellationReason('void', 'salah_input', null);
  assertCancellationReason('void', 'salah_input', 'x');
  assertCancellationReason('refund', 'barang_rusak', undefined);
});

test('assertCancellationReason: operasi tak dikenal ditolak', async () => {
  const { assertCancellationReason } = await import(CANCELLATION);
  assert.throws(() => assertCancellationReason('cancel', 'salah_input', null));
  assert.throws(() => assertCancellationReason('VOID', 'salah_input', null));
});

// Daftar diekspor supaya kontrak OpenAPI dan klien offline membaca sumber
// yang SAMA. Dua salinan daftar alasan berarti klien bisa menawarkan pilihan
// yang server tolak -- kasir buntu di tengah pembatalan.
test('daftar alasan diekspor dan persis sama dengan spec', async () => {
  const { VOID_REASON_CODES, REFUND_REASON_CODES } = await import(CANCELLATION);
  assert.deepEqual([...VOID_REASON_CODES], ALASAN_VOID);
  assert.deepEqual([...REFUND_REASON_CODES], ALASAN_REFUND);
});

// --- T5: batas refund kumulatif (AC FR-B7 ketiga) ---
//
// spec-b:271 -- "GIVEN order sudah direfund Rp 60.000 dari total Rp 93.600
// WHEN manajer mencoba refund Rp 50.000 THEN ditolak; maksimum yang tersisa
// Rp 33.600." Angkanya dipakai apa adanya di bawah.

test('remainingRefundable: contoh dari spec, Rp 93.600 - Rp 60.000 = Rp 33.600', async () => {
  const { remainingRefundable } = await import(CANCELLATION);
  assert.equal(remainingRefundable({ orderTotal: 93600n, alreadyRefunded: 60000n }), 33600n);
});

test('assertRefundWithinLimit: contoh dari spec ditolak dan menyebut sisanya', async () => {
  const { assertRefundWithinLimit } = await import(CANCELLATION);
  assert.throws(
    () => assertRefundWithinLimit({ orderTotal: 93600n, alreadyRefunded: 60000n, requested: 50000n }),
    (err) => err instanceof Error && err.message.includes('33600'),
    'pesan harus menyebut sisa yang tersedia -- kasir perlu tahu angkanya'
  );
});

test('assertRefundWithinLimit: tepat sebesar sisa diterima', async () => {
  const { assertRefundWithinLimit } = await import(CANCELLATION);
  assertRefundWithinLimit({ orderTotal: 93600n, alreadyRefunded: 60000n, requested: 33600n });
  assertRefundWithinLimit({ orderTotal: 93600n, alreadyRefunded: 0n, requested: 93600n });
});

test('assertRefundWithinLimit: satu rupiah di atas sisa ditolak', async () => {
  const { assertRefundWithinLimit } = await import(CANCELLATION);
  assert.throws(() =>
    assertRefundWithinLimit({ orderTotal: 93600n, alreadyRefunded: 60000n, requested: 33601n })
  );
});

test('assertRefundWithinLimit: nol dan negatif ditolak', async () => {
  const { assertRefundWithinLimit } = await import(CANCELLATION);
  assert.throws(() => assertRefundWithinLimit({ orderTotal: 100n, alreadyRefunded: 0n, requested: 0n }));
  assert.throws(() => assertRefundWithinLimit({ orderTotal: 100n, alreadyRefunded: 0n, requested: -1n }));
});

// Uang tidak pernah float (CLAUDE.md konvensi data). `number` yang menyelinap
// ke sini akan menghitung batas refund dengan aritmetika yang berbeda dari
// seluruh jalur uang lainnya.
test('batas refund menolak `number`, bukan mengonversinya diam-diam', async () => {
  const { assertRefundWithinLimit, remainingRefundable } = await import(CANCELLATION);
  assert.throws(
    () => assertRefundWithinLimit({ orderTotal: 100, alreadyRefunded: 0n, requested: 50n }),
    TypeError
  );
  assert.throws(
    () => assertRefundWithinLimit({ orderTotal: 100n, alreadyRefunded: 0n, requested: 50.5 }),
    TypeError
  );
  assert.throws(() => remainingRefundable({ orderTotal: 100, alreadyRefunded: 0n }), TypeError);
});

// Sudah direfund lebih dari total berarti batas ini PERNAH bocor. Diam-diam
// mengembalikan sisa 0 akan menyembunyikan kebocoran itu; yang dibutuhkan
// adalah kegagalan yang terlihat.
test('sudah direfund melebihi total adalah invariant yang bocor, harus melempar', async () => {
  const { remainingRefundable } = await import(CANCELLATION);
  assert.throws(() => remainingRefundable({ orderTotal: 100n, alreadyRefunded: 101n }), /melebihi|invariant/i);
});

// --- T5: property test -- SUM(refund) <= total, selalu ---

// LCG deterministik. Tanpa dependency baru, dan gagalnya dapat direproduksi
// persis -- test acak yang tidak bisa diulang lebih buruk daripada tidak ada.
function buatRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

test('property: refund parsial berulang tidak pernah melebihi total', async () => {
  const { assertRefundWithinLimit, remainingRefundable } = await import(CANCELLATION);
  const rng = buatRng(20260807);
  let kasus = 0;
  let adaYangDitolak = 0;
  let adaYangHabis = 0;

  for (let i = 0; i < 500; i += 1) {
    const total = BigInt(1 + Math.floor(rng() * 1_000_000));
    let terkumpul = 0n;

    // Sampai 20 percobaan refund parsial berturut-turut atas order yang sama.
    for (let n = 0; n < 20; n += 1) {
      const sisa = remainingRefundable({ orderTotal: total, alreadyRefunded: terkumpul });

      // Tiga bentuk permintaan, sengaja dicampur:
      //   - kadang PERSIS sebesar sisa   -> menyentuh batas dari dalam
      //   - kadang persis sisa + 1       -> menyentuh batas dari luar
      //   - selebihnya acak, sampai 1,5x total, jadi banyak yang ditolak
      // Nominal acak murni nyaris tidak pernah pas menghabiskan sisa, dan
      // tanpa dua bentuk pertama justru batasnya sendiri yang tidak teruji.
      const undian = rng();
      const diminta =
        undian < 0.15 ? sisa
        : undian < 0.3 ? sisa + 1n
        : BigInt(1 + Math.floor(rng() * Number(total) * 1.5));
      assert.ok(sisa >= 0n, 'sisa tidak pernah negatif');
      assert.equal(sisa, total - terkumpul);

      let diterima = true;
      try {
        assertRefundWithinLimit({ orderTotal: total, alreadyRefunded: terkumpul, requested: diminta });
      } catch {
        diterima = false;
      }

      assert.equal(diterima, diminta <= sisa, `total=${total} terkumpul=${terkumpul} diminta=${diminta}`);
      if (diterima) {
        terkumpul += diminta;
      } else {
        adaYangDitolak += 1;
      }

      // INVARIANT: kumulatif tidak pernah melebihi total, apa pun urutannya.
      assert.ok(terkumpul <= total, `kumulatif ${terkumpul} melebihi total ${total}`);
      if (terkumpul === total) {
        adaYangHabis += 1;
        break;
      }
      kasus += 1;
    }
  }

  // Menjaga test ini tidak lulus karena tidak menguji apa-apa.
  assert.ok(kasus > 1000, `terlalu sedikit kasus: ${kasus}`);
  assert.ok(adaYangDitolak > 100, `terlalu sedikit penolakan: ${adaYangDitolak}`);
  assert.ok(adaYangHabis > 10, `terlalu sedikit order yang refund-nya habis: ${adaYangHabis}`);
});

// Setelah sisa habis, TIDAK ADA nominal apa pun yang bisa lolos -- termasuk
// Rp 1. Ini keadaan yang benar-benar terjadi setelah refund penuh, dan
// jalurnya berbeda dari "diminta > sisa" biasa karena sisanya nol.
test('property: sisa nol menolak nominal berapa pun', async () => {
  const { assertRefundWithinLimit, remainingRefundable } = await import(CANCELLATION);
  const rng = buatRng(7);
  for (let i = 0; i < 200; i += 1) {
    const total = BigInt(1 + Math.floor(rng() * 5_000_000));
    assert.equal(remainingRefundable({ orderTotal: total, alreadyRefunded: total }), 0n);
    const diminta = BigInt(1 + Math.floor(rng() * 1_000_000));
    assert.throws(() =>
      assertRefundWithinLimit({ orderTotal: total, alreadyRefunded: total, requested: diminta })
    );
  }
});
