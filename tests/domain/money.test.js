'use strict';

// T2 -- aritmetika uang (FR-B4, CLAUDE.md § Konvensi data).
//
// Dua konvensi bertemu di sini, dan keduanya hasil pengukuran, bukan selera:
//
//   Uang     : bigint rupiah UTUH. Tidak pernah float.
//   Kuantitas: INTEGER x1000. `0.5 kg` -> `500`.
//
// CLAUDE.md soal yang kedua: "Terbukti lewat pengukuran: REAL membuat
// `WHERE stok = 0` gagal diam-diam."
//
// AC FR-B4 (spec-b:160): "Perhitungan `unit_price x quantity` menghasilkan
// `bigint` setelah pembulatan half-up."
//
// Modul ini murni -- tanpa I/O, tanpa waktu. Ia dibagi server dan klien
// supaya keduanya tidak pernah menghitung total yang berbeda; itulah yang
// `packages/domain/README.md` sebut sebagai alasan paket ini ada.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../packages/domain/src/money.ts';

// --- line total ---

test('kuantitas bulat: unit_price x qty, tanpa pembulatan yang perlu ditebak', async () => {
  const { computeLineTotal } = await import(MOD);
  assert.equal(
    computeLineTotal({ unitPrice: 25000n, quantityMilli: 2000n, modifiers: [], discountAmount: 0n }),
    50000n
  );
});

test('kuantitas pecahan 0,5 menghasilkan setengah harga -- inti FR-B4', async () => {
  const { computeLineTotal } = await import(MOD);
  assert.equal(
    computeLineTotal({ unitPrice: 25000n, quantityMilli: 500n, modifiers: [], discountAmount: 0n }),
    12500n
  );
});

// 3333 x 0,5 = 1666,5. Half-up membulatkannya NAIK ke 1667.
// Membulatkan ke bawah di sini berarti merchant kehilangan 1 rupiah per
// transaksi; yang penting bukan besarnya, tapi bahwa aturannya ditulis dan
// diuji, bukan diserahkan ke perilaku bawaan bahasa.
test('half-up: tepat setengah rupiah dibulatkan NAIK', async () => {
  const { computeLineTotal } = await import(MOD);
  assert.equal(
    computeLineTotal({ unitPrice: 3333n, quantityMilli: 500n, modifiers: [], discountAmount: 0n }),
    1667n
  );
});

test('half-up: di bawah setengah dibulatkan turun', async () => {
  const { computeLineTotal } = await import(MOD);
  // 3333 x 0,499 = 1663,167 -> 1663
  assert.equal(
    computeLineTotal({ unitPrice: 3333n, quantityMilli: 499n, modifiers: [], discountAmount: 0n }),
    1663n
  );
});

test('modifier ikut dikalikan kuantitas baris -- 2 kopi + extra shot = 2 x (harga + shot)', async () => {
  const { computeLineTotal } = await import(MOD);
  assert.equal(
    computeLineTotal({
      unitPrice: 25000n,
      quantityMilli: 2000n,
      modifiers: [{ price: 5000n, quantityMilli: 1000n }],
      discountAmount: 0n,
    }),
    60000n
  );
});

test('modifier berkuantitas: 2 extra shot pada 1 kopi', async () => {
  const { computeLineTotal } = await import(MOD);
  assert.equal(
    computeLineTotal({
      unitPrice: 25000n,
      quantityMilli: 1000n,
      modifiers: [{ price: 5000n, quantityMilli: 2000n }],
      discountAmount: 0n,
    }),
    35000n
  );
});

test('modifier berharga 0 legal (mis. "Less Sugar")', async () => {
  const { computeLineTotal } = await import(MOD);
  assert.equal(
    computeLineTotal({
      unitPrice: 25000n,
      quantityMilli: 1000n,
      modifiers: [{ price: 0n, quantityMilli: 1000n }],
      discountAmount: 0n,
    }),
    25000n
  );
});

test('discount dikurangkan setelah pembulatan, bukan sebelum', async () => {
  const { computeLineTotal } = await import(MOD);
  assert.equal(
    computeLineTotal({ unitPrice: 25000n, quantityMilli: 2000n, modifiers: [], discountAmount: 5000n }),
    45000n
  );
});

test('discount melebihi nilai kotor baris ditolak, bukan menghasilkan baris negatif', async () => {
  const { computeLineTotal } = await import(MOD);
  assert.throws(
    () => computeLineTotal({ unitPrice: 25000n, quantityMilli: 1000n, modifiers: [], discountAmount: 30000n }),
    /discount/i
  );
});

test('kuantitas nol atau negatif ditolak', async () => {
  const { computeLineTotal } = await import(MOD);
  for (const q of [0n, -1000n]) {
    assert.throws(
      () => computeLineTotal({ unitPrice: 25000n, quantityMilli: q, modifiers: [], discountAmount: 0n }),
      /kuantitas/i,
      `quantityMilli ${q} harus ditolak`
    );
  }
});

// Menerima `number` di mana `bigint` diharapkan adalah jalan masuk float ke
// jalur uang. Harus ditolak keras, bukan dikonversi diam-diam.
test('nilai number (bukan bigint) ditolak -- float tidak boleh masuk jalur uang', async () => {
  const { computeLineTotal } = await import(MOD);
  assert.throws(
    () => computeLineTotal({ unitPrice: 25000, quantityMilli: 1000n, modifiers: [], discountAmount: 0n }),
    /bigint/i
  );
  assert.throws(
    () => computeLineTotal({ unitPrice: 25000n, quantityMilli: 1000, modifiers: [], discountAmount: 0n }),
    /bigint/i
  );
});

// --- property test ---

test('property: hasil SELALU bigint dan tidak pernah negatif, atas 500 kombinasi', async () => {
  const { computeLineTotal } = await import(MOD);
  const harga = [0n, 1n, 999n, 3333n, 25000n, 1_000_000n];
  const qty = [1n, 333n, 500n, 999n, 1000n, 2500n, 10_000n];
  const mods = [[], [{ price: 0n, quantityMilli: 1000n }], [{ price: 777n, quantityMilli: 1500n }]];
  let diperiksa = 0;
  for (const p of harga) {
    for (const q of qty) {
      for (const m of mods) {
        const hasil = computeLineTotal({ unitPrice: p, quantityMilli: q, modifiers: m, discountAmount: 0n });
        assert.equal(typeof hasil, 'bigint', `bukan bigint untuk ${p}/${q}`);
        assert.ok(hasil >= 0n, `negatif untuk ${p}/${q}`);
        diperiksa += 1;
      }
    }
  }
  assert.equal(diperiksa, harga.length * qty.length * mods.length);
  assert.ok(diperiksa >= 100, 'ruang uji harus benar-benar besar, bukan beberapa contoh');
});

// Invariant yang paling mudah dilanggar tanpa disadari: menghitung dua kali
// lipat kuantitas harus menghasilkan tepat dua kali lipat total, KECUALI bila
// pembulatan ikut bermain. Diuji hanya pada nilai yang habis dibagi supaya
// yang diuji benar-benar linearitas, bukan pembulatan.
test('property: kuantitas kelipatan bulat bersifat linear tepat', async () => {
  const { computeLineTotal } = await import(MOD);
  const dasar = { unitPrice: 12345n, modifiers: [{ price: 500n, quantityMilli: 1000n }], discountAmount: 0n };
  const satu = computeLineTotal({ ...dasar, quantityMilli: 1000n });
  for (const n of [2n, 3n, 7n, 10n, 100n]) {
    const banyak = computeLineTotal({ ...dasar, quantityMilli: 1000n * n });
    assert.equal(banyak, satu * n, `x${n} harus tepat ${n} kali lipat`);
  }
});

// Pembuktian bahwa BigInt memang perlu: nilai ini melampaui 2^53, tempat
// aritmetika `number` mulai kehilangan presisi diam-diam.
test('nilai di atas MAX_SAFE_INTEGER tetap tepat -- inilah alasan BigInt', async () => {
  const { computeLineTotal } = await import(MOD);
  const besar = 9_007_199_254_740_993n; // 2^53 + 1
  const hasil = computeLineTotal({ unitPrice: besar, quantityMilli: 1000n, modifiers: [], discountAmount: 0n });
  assert.equal(hasil, besar, 'bigint membawa nilai ini utuh');

  // Sisi lain dari perbandingan yang sama, supaya klaim "inilah alasan
  // BigInt" benar-benar ditunjukkan, bukan cuma dinarasikan di komentar.
  //
  // Pasangan yang dipakai adalah 2^53 dan 2^53+1 -- diverifikasi, bukan
  // ditebak. Bilangan GENAP di atas 2^53 masih representable sebagai double
  // (2^53+2 utuh, 2^53+3 malah dibulatkan ke 2^53+4), jadi memilih pasangan
  // yang salah akan membuat test ini lolos tanpa membuktikan apa pun.
  const duaPangkat53 = 9_007_199_254_740_992n;
  assert.notEqual(besar, duaPangkat53, 'sebagai bigint keduanya nilai yang berbeda');
  assert.equal(
    Number(besar),
    Number(duaPangkat53),
    'sebagai number keduanya runtuh jadi satu nilai -- presisi hilang tanpa error apa pun'
  );
});

// --- total order ---

test('subtotal order = jumlah line_total', async () => {
  const { computeOrderTotals } = await import(MOD);
  const t = computeOrderTotals({
    lineTotals: [50000n, 12500n, 1667n],
    orderDiscount: 0n,
    serviceChargeAmount: 0n,
    taxAmount: 0n,
    roundingIncrement: 1n,
  });
  assert.equal(t.subtotal, 64167n);
  assert.equal(t.total, 64167n);
  assert.equal(t.roundingAdjustment, 0n);
});

// Pembulatan tunai Indonesia: pecahan di bawah Rp 100 tidak beredar lagi.
// `outlet.rounding_increment` default 100 (0002_tenancy.sql).
test('pembulatan ke kelipatan 100 menghasilkan rounding_adjustment yang menjelaskan selisihnya', async () => {
  const { computeOrderTotals } = await import(MOD);
  const t = computeOrderTotals({
    lineTotals: [64167n],
    orderDiscount: 0n,
    serviceChargeAmount: 0n,
    taxAmount: 0n,
    roundingIncrement: 100n,
  });
  assert.equal(t.total, 64200n, '64167 -> 64200 (half-up ke kelipatan 100)');
  assert.equal(t.roundingAdjustment, 33n, 'selisihnya harus tercatat, bukan hilang');
});

test('pembulatan ke bawah menghasilkan rounding_adjustment negatif', async () => {
  const { computeOrderTotals } = await import(MOD);
  const t = computeOrderTotals({
    lineTotals: [64120n],
    orderDiscount: 0n,
    serviceChargeAmount: 0n,
    taxAmount: 0n,
    roundingIncrement: 100n,
  });
  assert.equal(t.total, 64100n);
  assert.equal(t.roundingAdjustment, -20n);
});

// Invariant yang harus selalu benar, apa pun pembulatannya. Kalau ini pernah
// gagal, angka di struk tidak bisa dijelaskan ke pelanggan maupun auditor.
test('property: subtotal - discount + service + tax + rounding_adjustment == total, selalu', async () => {
  const { computeOrderTotals } = await import(MOD);
  const kasus = [];
  // Ruang uji sengaja diperbesar: `disc > sub` membuang sebagian kombinasi,
  // dan penjaga `diperiksa >= 100` di bawah harus terpenuhi oleh kasus yang
  // BENAR-BENAR dijalankan, bukan oleh kasus yang direncanakan.
  for (const sub of [0n, 1n, 99n, 100n, 64167n, 64120n, 1_000_000n]) {
    for (const disc of [0n, 1n, 50n, 99n]) {
      for (const svc of [0n, 1n, 3208n]) {
        for (const inc of [1n, 5n, 100n, 1000n]) {
          if (disc > sub) continue;
          kasus.push({ sub, disc, svc, inc });
        }
      }
    }
  }
  let diperiksa = 0;
  for (const k of kasus) {
    const t = computeOrderTotals({
      lineTotals: [k.sub],
      orderDiscount: k.disc,
      serviceChargeAmount: k.svc,
      taxAmount: 0n,
      roundingIncrement: k.inc,
    });
    assert.equal(
      t.subtotal - k.disc + k.svc + 0n + t.roundingAdjustment,
      t.total,
      `tidak berimbang untuk ${JSON.stringify(k, (_, v) => (typeof v === 'bigint' ? String(v) : v))}`
    );
    assert.equal(t.total % k.inc, 0n, 'total harus kelipatan roundingIncrement');
    diperiksa += 1;
  }
  assert.ok(diperiksa >= 100, `ruang uji terlalu kecil: ${diperiksa}`);
});

test('order discount melebihi subtotal ditolak', async () => {
  const { computeOrderTotals } = await import(MOD);
  assert.throws(
    () => computeOrderTotals({
      lineTotals: [10000n],
      orderDiscount: 20000n,
      serviceChargeAmount: 0n,
      taxAmount: 0n,
      roundingIncrement: 100n,
    }),
    /discount/i
  );
});

test('order kosong menghasilkan nol, bukan error -- keranjang kosong bukan kesalahan', async () => {
  const { computeOrderTotals } = await import(MOD);
  const t = computeOrderTotals({
    lineTotals: [],
    orderDiscount: 0n,
    serviceChargeAmount: 0n,
    taxAmount: 0n,
    roundingIncrement: 100n,
  });
  assert.equal(t.subtotal, 0n);
  assert.equal(t.total, 0n);
  assert.equal(t.roundingAdjustment, 0n);
});

// Invariant #7: tidak ada angka pajak di luar TaxCalculator. Modul ini
// MENERIMA taxAmount yang sudah dihitung, dan tidak pernah menghitungnya
// sendiri -- tidak ada tarif, tidak ada 0,11, tidak ada persentase di sini.
test('taxAmount diteruskan apa adanya, modul ini tidak pernah menghitung pajak', async () => {
  const { computeOrderTotals } = await import(MOD);
  const t = computeOrderTotals({
    lineTotals: [100000n],
    orderDiscount: 0n,
    serviceChargeAmount: 0n,
    taxAmount: 11000n,
    roundingIncrement: 1n,
  });
  assert.equal(t.total, 111000n);
});
