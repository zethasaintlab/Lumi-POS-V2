'use strict';

// FR-C12 — perkiraan MDR. Murni aritmetika, tanpa database.
//
// Yang paling penting diuji di sini bukan angkanya melainkan BATAS-batasnya:
// `≤` bukan `<` pada ambang UMI, dan `null` yang berbeda dari `0`. Keduanya
// gagal secara DIAM — angka yang sedikit salah pada laporan yang gunanya
// justru menjelaskan selisih.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MDR = '../../packages/domain/src/mdr.ts';

test('UMI: transaksi TEPAT di ambang masih bebas potongan', async () => {
  const { perkiraanMdr, AMBANG_UMI } = await import(MDR);
  // ⛔ `spec-c:427` menulis "≤ Rp 500.000". `<` akan memotong transaksi tepat
  // 500.000, dan itu selisih yang muncul tepat pada nilai bulat yang paling
  // sering terjadi.
  assert.equal(perkiraanMdr({ kategori: 'umi', method: 'qris_dynamic', amount: AMBANG_UMI }), 0n);
  assert.equal(
    perkiraanMdr({ kategori: 'umi', method: 'qris_dynamic', amount: AMBANG_UMI + 1n }),
    // 0,3% dari 500.001 = 1500,003 → 1500 (dibulatkan ke bawah)
    1500n
  );
});

test('UMI di atas ambang dipotong 0,3%; selain UMI 0,7%', async () => {
  const { perkiraanMdr } = await import(MDR);
  const amount = 1_000_000n;
  assert.equal(perkiraanMdr({ kategori: 'umi', method: 'qris_static', amount }), 3_000n);
  for (const kategori of ['uke', 'ume', 'ube']) {
    assert.equal(perkiraanMdr({ kategori, method: 'qris_static', amount }), 7_000n);
  }
});

test('⛔ `null` untuk metode tanpa perkiraan — BUKAN nol', async () => {
  const { perkiraanMdr } = await import(MDR);
  // Nol berarti "diperkirakan tidak dipotong". Untuk kartu EDC itu tidak
  // benar: tarifnya per-acquirer dan spec tidak memberikan satu pun angkanya.
  for (const method of ['cash', 'card_edc', 'other']) {
    assert.equal(
      perkiraanMdr({ kategori: 'uke', method, amount: 1_000_000n }),
      null,
      `${method} tidak boleh punya perkiraan`
    );
  }
  // Dan yang punya perkiraan memang mengembalikan bigint, termasuk `0n`.
  assert.equal(perkiraanMdr({ kategori: 'umi', method: 'qris_dynamic', amount: 1_000n }), 0n);
});

test('settlement = nilai transaksi − potongan; metode tanpa perkiraan utuh', async () => {
  const { perkiraanSettlement } = await import(MDR);
  assert.equal(
    perkiraanSettlement({ kategori: 'uke', method: 'qris_dynamic', amount: 100_000n }),
    99_300n
  );
  // ⛔ Yang tidak diketahui adalah POTONGANNYA, bukan uangnya. Mengembalikan
  // null di sini akan membuat baris kartu hilang dari total settlement.
  assert.equal(
    perkiraanSettlement({ kategori: 'uke', method: 'card_edc', amount: 100_000n }),
    100_000n
  );
});

test('nilai nol atau negatif tidak menghasilkan potongan negatif', async () => {
  const { perkiraanMdr } = await import(MDR);
  assert.equal(perkiraanMdr({ kategori: 'uke', method: 'qris_dynamic', amount: 0n }), 0n);
  assert.equal(perkiraanMdr({ kategori: 'uke', method: 'qris_dynamic', amount: -5_000n }), 0n);
});

test('potongan tidak pernah melebihi nilai transaksi', async () => {
  const { perkiraanMdr } = await import(MDR);
  // Property, bukan contoh: tarif maksimum 0,7% jauh di bawah 100%, jadi ini
  // harus berlaku untuk setiap nilai. Yang dicari adalah tarif yang kelak
  // salah skala — 70n dibaca sebagai 70% alih-alih 0,7%.
  for (let n = 1n; n <= 100_000_000n; n *= 7n) {
    for (const kategori of ['umi', 'uke', 'ume', 'ube']) {
      const mdr = perkiraanMdr({ kategori, method: 'qris_dynamic', amount: n });
      assert.ok(mdr !== null && mdr >= 0n && mdr < n / 100n + 1n, `${kategori} ${n} → ${mdr}`);
    }
  }
});

test('adalahKategoriMerchant menolak nilai asing', async () => {
  const { adalahKategoriMerchant } = await import(MDR);
  for (const v of ['umi', 'uke', 'ume', 'ube']) assert.equal(adalahKategoriMerchant(v), true);
  for (const v of ['UMI', 'mikro', '', null, undefined, 0, {}]) {
    assert.equal(adalahKategoriMerchant(v), false, `${String(v)} seharusnya ditolak`);
  }
});

test('⛔ tarif tidak pernah float — jalur uang tidak menyentuhnya', async () => {
  const { tarifMdrBerskala } = await import(MDR);
  for (const kategori of ['umi', 'uke', 'ume', 'ube']) {
    const t = tarifMdrBerskala(kategori, 'qris_dynamic', 1_000_000n);
    assert.equal(typeof t, 'bigint', `tarif ${kategori} bukan bigint`);
  }
});
