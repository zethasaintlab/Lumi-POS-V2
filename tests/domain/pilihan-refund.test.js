'use strict';

// FR-B7 refund parsial — aturan pemilihan baris, murni.
//
// ⛔ Dua sifat di sini diuji sebagai PROPERTY, bukan sebagai contoh, karena
// keduanya adalah invariant finansial (`Definition of Done`):
//
//   1. memilih seluruh baris menghasilkan TEPAT `order.total`;
//   2. nilai refund tidak pernah melebihi `order.total`.
//
// Yang pertama yang paling mudah rusak: menjumlahkan `line_total` terasa
// benar dan menghasilkan angka yang masuk akal — hanya saja lebih kecil
// daripada yang pelanggan bayar, sebesar pajak eksklusifnya.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../packages/domain/src/pilihan-refund.ts';

function baris(over = {}) {
  return {
    lineId: 'l1',
    variationId: 'v1',
    quantityMilli: 1000n,
    lineTotal: 10000n,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Nilai refund
// ---------------------------------------------------------------------------

test('⛔ seluruh baris → TEPAT order.total, termasuk pajak dan pembulatan', async () => {
  const { nilaiRefundBaris, seluruhBaris } = await import(MOD);
  // `line_total` berjumlah 30.000; `order.total` 33.300 (pajak 11% eksklusif).
  // Menjumlahkan `line_total` akan mengembalikan 30.000 — kurang Rp 3.300.
  const b = [
    baris({ lineId: 'a', lineTotal: 10000n }),
    baris({ lineId: 'b', lineTotal: 12000n, variationId: 'v2' }),
    baris({ lineId: 'c', lineTotal: 8000n, variationId: 'v3' }),
  ];
  const total = 33300n;
  assert.equal(nilaiRefundBaris(b, total, seluruhBaris(b)), total);
});

test('property: seluruh baris selalu tepat total, untuk banyak bentuk', async () => {
  const { nilaiRefundBaris, seluruhBaris } = await import(MOD);
  for (let n = 1; n <= 7; n += 1) {
    for (const total of [1n, 7n, 999n, 33_333n, 1_000_001n, 987_654_321n]) {
      const b = Array.from({ length: n }, (_, i) =>
        baris({
          lineId: `l${i}`,
          variationId: `v${i}`,
          // Bobot yang sengaja tidak habis dibagi.
          lineTotal: BigInt(1 + i * 7 + (i % 3) * 13),
          quantityMilli: BigInt(1000 * (1 + (i % 4))),
        })
      );
      assert.equal(
        nilaiRefundBaris(b, total, seluruhBaris(b)),
        total,
        `n=${n} total=${total}`
      );
    }
  }
});

test('property: nilai refund tidak pernah melebihi order.total', async () => {
  const { nilaiRefundBaris } = await import(MOD);
  const b = [
    baris({ lineId: 'a', lineTotal: 10000n, quantityMilli: 3000n }),
    baris({ lineId: 'b', lineTotal: 5000n, quantityMilli: 2000n, variationId: 'v2' }),
  ];
  const total = 16_650n;
  for (let qa = 0n; qa <= 3000n; qa += 250n) {
    for (let qb = 0n; qb <= 2000n; qb += 250n) {
      const pilihan = [];
      if (qa > 0n) pilihan.push({ lineId: 'a', quantityMilli: qa });
      if (qb > 0n) pilihan.push({ lineId: 'b', quantityMilli: qb });
      const nilai = nilaiRefundBaris(b, total, pilihan);
      assert.ok(nilai >= 0n && nilai <= total, `qa=${qa} qb=${qb} → ${nilai}`);
    }
  }
});

test('separuh kuantitas mengembalikan sekitar separuh bagian baris', async () => {
  const { nilaiRefundBaris } = await import(MOD);
  const b = [baris({ lineId: 'a', quantityMilli: 2000n, lineTotal: 20000n })];
  assert.equal(nilaiRefundBaris(b, 22_200n, [{ lineId: 'a', quantityMilli: 1000n }]), 11_100n);
});

test('kuantitas sebagian dibulatkan KE BAWAH', async () => {
  const { nilaiRefundBaris } = await import(MOD);
  // 10.000 / 3 = 3333,33 → 3333. Sisa tetap dapat dikembalikan kemudian.
  const b = [baris({ lineId: 'a', quantityMilli: 3000n, lineTotal: 10000n })];
  assert.equal(nilaiRefundBaris(b, 10_000n, [{ lineId: 'a', quantityMilli: 1000n }]), 3_333n);
});

test('baris asing di pilihan diabaikan pada perhitungan nilai', async () => {
  // Penolakannya tugas `periksaPilihan`; `nilaiRefundBaris` tidak boleh
  // melempar dari dalam render.
  const { nilaiRefundBaris } = await import(MOD);
  const b = [baris({ lineId: 'a' })];
  assert.equal(nilaiRefundBaris(b, 11_100n, [{ lineId: 'asing', quantityMilli: 1000n }]), 0n);
});

// ---------------------------------------------------------------------------
// Sisa per baris
// ---------------------------------------------------------------------------

test('tanpa pengembalian sebelumnya, sisa = terjual', async () => {
  const { sisaPerBaris } = await import(MOD);
  const b = [baris({ lineId: 'a', quantityMilli: 2000n })];
  assert.deepEqual(sisaPerBaris(b, []), [
    { lineId: 'a', terjualMilli: 2000n, sisaMilli: 2000n },
  ]);
});

test('⛔ pengembalian sebelumnya dibagi per VARIASI, bukan per baris', async () => {
  const { sisaPerBaris } = await import(MOD);
  // Dua baris, SATU variasi — modifier memisahkan baris, stoknya satu.
  // `stock_movement` tidak menyimpan `line_id`, jadi 1500 yang sudah kembali
  // hanya dapat dinisbatkan per variasi.
  const b = [
    baris({ lineId: 'a', variationId: 'v1', quantityMilli: 1000n }),
    baris({ lineId: 'b', variationId: 'v1', quantityMilli: 2000n }),
  ];
  const sisa = sisaPerBaris(b, [{ variationId: 'v1', quantityMilli: 1500n }]);
  // Baris pertama menyerap 1000, baris kedua sisa 500 → 1500 tersisa.
  assert.deepEqual(sisa, [
    { lineId: 'a', terjualMilli: 1000n, sisaMilli: 0n },
    { lineId: 'b', terjualMilli: 2000n, sisaMilli: 1500n },
  ]);
  // ⛔ Yang dijamin: JUMLAH sisa per variasi sama dengan yang server izinkan.
  const totalSisa = sisa.reduce((s, x) => s + x.sisaMilli, 0n);
  assert.equal(totalSisa, 3000n - 1500n);
});

test('pengembalian melebihi terjual tidak menghasilkan sisa negatif', async () => {
  const { sisaPerBaris } = await import(MOD);
  const b = [baris({ lineId: 'a', quantityMilli: 1000n })];
  assert.deepEqual(sisaPerBaris(b, [{ variationId: 'v1', quantityMilli: 5000n }]), [
    { lineId: 'a', terjualMilli: 1000n, sisaMilli: 0n },
  ]);
});

// ---------------------------------------------------------------------------
// Validasi pilihan
// ---------------------------------------------------------------------------

test('pilihan dalam batas diterima', async () => {
  const { periksaPilihan } = await import(MOD);
  const b = [baris({ lineId: 'a', quantityMilli: 2000n })];
  assert.equal(periksaPilihan(b, [], [{ lineId: 'a', quantityMilli: 2000n }]), null);
});

test('⛔ kuantitas nol DITOLAK, bukan diabaikan', async () => {
  const { periksaPilihan } = await import(MOD);
  const b = [baris({ lineId: 'a' })];
  const g = periksaPilihan(b, [], [{ lineId: 'a', quantityMilli: 0n }]);
  assert.equal(g?.kode, 'KUANTITAS_TIDAK_SAH');
});

test('baris yang bukan milik order ditolak', async () => {
  const { periksaPilihan } = await import(MOD);
  const b = [baris({ lineId: 'a' })];
  const g = periksaPilihan(b, [], [{ lineId: 'asing', quantityMilli: 1000n }]);
  assert.deepEqual(g, { kode: 'BARIS_TIDAK_DIKENAL', lineId: 'asing' });
});

test('⛔ melebihi sisa ditolak, dan galatnya MEMBAWA angkanya', async () => {
  const { periksaPilihan } = await import(MOD);
  // Pesan tanpa angka memaksa kasir menebak berapa yang masih boleh.
  const b = [baris({ lineId: 'a', quantityMilli: 2000n })];
  const g = periksaPilihan(b, [{ variationId: 'v1', quantityMilli: 1000n }], [
    { lineId: 'a', quantityMilli: 2000n },
  ]);
  assert.deepEqual(g, {
    kode: 'MELEBIHI_SISA',
    lineId: 'a',
    sisaMilli: 1000n,
    dimintaMilli: 2000n,
  });
});

test('baris yang sama disebut dua kali DIJUMLAHKAN sebelum diperiksa', async () => {
  const { periksaPilihan } = await import(MOD);
  const b = [baris({ lineId: 'a', quantityMilli: 1500n })];
  assert.equal(
    periksaPilihan(b, [], [
      { lineId: 'a', quantityMilli: 1000n },
      { lineId: 'a', quantityMilli: 500n },
    ]),
    null
  );
  const g = periksaPilihan(b, [], [
    { lineId: 'a', quantityMilli: 1000n },
    { lineId: 'a', quantityMilli: 1000n },
  ]);
  assert.equal(g?.kode, 'MELEBIHI_SISA');
  assert.equal(g.dimintaMilli, 2000n);
});
