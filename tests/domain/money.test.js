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
  });
  assert.equal(t.subtotal, 64167n);
  assert.equal(t.total, 64167n);
});

// --- FR-C8: `total` TIDAK dibulatkan ---
//
// Ini koreksi, bukan fitur baru. Versi pertama modul ini membulatkan `total`
// ke kelipatan rounding_increment, dan test-testnya mengunci perilaku itu.
// Keduanya salah terhadap spec:
//
//   spec-c-pembayaran-pajak.md:113-116
//     12. total              = tax_base + tax_amount
//     13. rounding_adjustment = pembulatan (HANYA bila ada pembayaran tunai)
//     14. amount_due         = total + rounding_adjustment
//
// Yang dibulatkan adalah `amount_due`, bukan `total` -- dan hanya bila ada
// pembayaran tunai. `total` adalah nilai transaksi yang dipakai laporan
// penjualan dan dasar pelaporan pajak; membulatkannya menggeser angka itu.
//
// FR-C9 mempertegas: order yang dibayar 100% non-tunai punya
// rounding_adjustment = 0 dan amount_due = total.
//
// Karena pembulatan bergantung pada METODE PEMBAYARAN, ia tidak bisa
// dihitung saat order dibuat -- order baru belum punya pembayaran apa pun.
// Karena itu `roundingIncrement` dikeluarkan sepenuhnya dari fungsi ini dan
// pindah ke jalur pembayaran (Modul C sub-project 1), bukan disimpan
// menganggur di sini.

test('FR-C8: total tidak dibulatkan, berapa pun nilainya', async () => {
  const { computeOrderTotals } = await import(MOD);
  const t = computeOrderTotals({
    lineTotals: [90000n],
    orderDiscount: 9000n,
    serviceChargeAmount: 4050n,
    taxAmount: 8505n,
  });
  assert.equal(t.total, 93555n, 'total = tax_base + tax_amount, apa adanya');
});

// Contoh terhitung spec-c:133-147, angka per angka (AC FR-C8 pertama).
// Pesanan: 2x Kopi Susu @25.000 (+ Extra Shot 5.000), 1x Croissant @30.000.
// Diskon order 10%. Service charge 5%. PBJT 10% eksklusif.
test('FR-C8: contoh terhitung spec, angka per angka', async () => {
  const { computeLineTotal, computeOrderTotals } = await import(MOD);

  const baris1 = computeLineTotal({
    unitPrice: 25000n,
    quantityMilli: 2000n,
    modifiers: [{ price: 5000n, quantityMilli: 1000n }],
    discountAmount: 0n,
  });
  assert.equal(baris1, 60000n, 'baris 1: 50.000 + 10.000');

  const baris2 = computeLineTotal({
    unitPrice: 30000n,
    quantityMilli: 1000n,
    modifiers: [],
    discountAmount: 0n,
  });
  assert.equal(baris2, 30000n, 'baris 2');

  const t = computeOrderTotals({
    lineTotals: [baris1, baris2],
    orderDiscount: 9000n,
    serviceChargeAmount: 4050n,
    taxAmount: 8505n,
  });

  assert.equal(t.subtotal, 90000n, 'subtotal');
  assert.equal(t.base, 81000n, 'base = subtotal - diskon order');
  assert.equal(t.taxBase, 85050n, 'dasar pajak = base + service charge');
  assert.equal(t.total, 93555n, 'total = dasar pajak + pajak, TANPA pembulatan');
});

// Invariant yang harus selalu benar. Kalau ini pernah gagal, angka di struk
// tidak bisa dijelaskan ke pelanggan maupun auditor.
//
// Perhatikan `rounding_adjustment` TIDAK muncul di sini lagi: ia bukan bagian
// dari `total` (FR-C8 langkah 12), melainkan bagian dari `amount_due`
// (langkah 14) yang dihitung di jalur pembayaran.
test('property: subtotal - discount + service + tax == total, selalu', async () => {
  const { computeOrderTotals } = await import(MOD);
  const kasus = [];
  for (const sub of [0n, 1n, 99n, 100n, 64167n, 64120n, 1_000_000n]) {
    for (const disc of [0n, 1n, 50n, 99n]) {
      for (const svc of [0n, 1n, 3208n]) {
        for (const tax of [0n, 1n, 8505n, 11000n]) {
          if (disc > sub) continue;
          kasus.push({ sub, disc, svc, tax });
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
      taxAmount: k.tax,
    });
    const nama = JSON.stringify(k, (_, v) => (typeof v === 'bigint' ? String(v) : v));
    assert.equal(t.subtotal, k.sub, `subtotal untuk ${nama}`);
    assert.equal(t.base, k.sub - k.disc, `base = subtotal - diskon untuk ${nama}`);
    assert.equal(t.taxBase, t.base + k.svc, `dasar pajak = base + service untuk ${nama}`);
    assert.equal(t.total, t.taxBase + k.tax, `total = dasar pajak + pajak untuk ${nama}`);
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
  });
  assert.equal(t.subtotal, 0n);
  assert.equal(t.total, 0n);
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
  });
  assert.equal(t.total, 111000n);
});

// --- FR-C8: pembulatan PER LANGKAH ---
//
// spec-c:126 -- "Semua nilai uang dibulatkan ke rupiah utuh (bigint) pada
// SETIAP langkah, memakai half-up. Alasan: menyimpan pecahan lalu membulatkan
// di akhir menghasilkan total yang tidak sama dengan jumlah baris yang
// tercetak di struk -- dan merchant akan menemukannya."
//
// Versi pertama modul ini membulatkan sekali di akhir, dengan komentar yang
// justru membenarkan kebalikannya. Selisihnya nyata pada kuantitas pecahan.
//
// Langkah 1 dan 2 FR-C8 adalah dua nilai TERPISAH yang masing-masing
// dibulatkan sebelum dijumlahkan di langkah 3:
//   1. line_subtotal  = unit_price x quantity
//   2. line_modifiers = SUM(modifier.price x modifier.qty)
//   3. line_before_disc = 1 + 2
test('FR-C8: langkah 1 dan 2 dibulatkan terpisah sebelum dijumlahkan', async () => {
  const { computeLineTotal } = await import(MOD);
  // unit_price 3.333 x 0,5 = 1.666,5 -> 1.667
  // modifier   3.333 x 0,5 = 1.666,5 -> 1.667   (qty modifier 1 x qty baris 0,5)
  // line_total = 1.667 + 1.667 = 3.334
  //
  // Membulatkan sekali di akhir menghasilkan 3.333 -- satu rupiah lebih
  // rendah, dan tidak cocok dengan angka yang tercetak per baris di struk.
  assert.equal(
    computeLineTotal({
      unitPrice: 3333n,
      quantityMilli: 500n,
      modifiers: [{ price: 3333n, quantityMilli: 1000n }],
      discountAmount: 0n,
    }),
    3334n
  );
});

test('FR-C8: pembulatan per langkah tidak mengubah hasil untuk kuantitas bulat', async () => {
  const { computeLineTotal } = await import(MOD);
  // Jaring pengaman: koreksi pembulatan tidak boleh menggeser kasus F&B
  // sehari-hari, yang seluruhnya berkuantitas bulat.
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
