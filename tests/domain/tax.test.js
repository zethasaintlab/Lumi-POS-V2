'use strict';

// T5-T6 -- TaxCalculator (FR-C11, FR-C8, FR-C6, FR-C7).
//
// Fungsi MURNI di packages/domain. Alasannya sama dengan state machine dan
// aritmetika uang: `ARCH:106` menyebut klien menghitung total lewat
// "TaxCalculator versi klien" saat offline. Kalau logika pajak hanya hidup di
// server, angka di layar kasir dan angka yang tersimpan bisa berbeda -- dan
// yang tercetak di struk adalah yang dilihat pelanggan.
//
// Resolusi TaxRate (item > category > all_items, channel spesifik > all,
// outlet > tenant) ikut di sini, BUKAN di SQL. Bukan karena SQL tidak mampu,
// tapi karena klien offline harus menerapkan aturan yang sama persis. Yang
// tetap di database hanyalah penyaringan waktu (`effective_from`/
// `effective_to`) -- itu yang punya index dan tidak perlu diulang klien.
//
// TARIF TIDAK PERNAH FLOAT. `tax_rate.rate` adalah `numeric(6,4)`, jadi di
// sini ia bigint berskala 10.000: 10% -> 1000n. Memakai 0.1 sebagai number
// akan menyeret float ke jalur uang lewat pintu belakang.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../packages/domain/src/tax.ts';

const PBJT_10 = {
  id: 'rate-pbjt-10',
  name: 'PBJT 10%',
  rateScaled: 1000n,
  isInclusive: false,
  outletId: null,
  channel: 'all',
  appliesTo: 'all_items',
  appliesToIds: [],
};

function baris(id, amount, extra = {}) {
  return { lineId: id, itemId: `item-${id}`, categoryId: null, amount, ...extra };
}

// --- FR-C8 langkah 11-12: eksklusif ---

test('eksklusif: pajak dihitung dari dasar dan MENAMBAH total', async () => {
  const { calculateTax } = await import(MOD);
  const b = calculateTax({
    lines: [baris('a', 85050n)],
    serviceChargeAmount: 0n,
    orderDiscount: 0n,
    taxRates: [PBJT_10],
    channel: 'takeaway',
    outletId: 'outlet-1',
  });
  assert.equal(b.totalTax, 8505n, '85.050 x 10% = 8.505');
  assert.equal(b.lines.length, 1);
  assert.equal(b.lines[0].base, 85050n);
  assert.equal(b.lines[0].amount, 8505n);
  assert.equal(b.lines[0].isInclusive, false);
  assert.equal(b.lines[0].name, 'PBJT 10%', 'nama dari TaxRate.name, bukan string hardcode (AC FR-C6)');
});

// Contoh terhitung spec-c:133-147, sisi pajaknya. Service charge MASUK dasar
// pajak (FR-C8 langkah 10) -- ini yang paling mudah salah.
test('FR-C8: service charge termasuk dasar pajak', async () => {
  const { calculateTax } = await import(MOD);
  const b = calculateTax({
    lines: [baris('a', 60000n), baris('b', 30000n)],
    serviceChargeAmount: 4050n,
    orderDiscount: 9000n,
    taxRates: [PBJT_10],
    channel: 'takeaway',
    outletId: 'outlet-1',
  });
  // base = 90.000 - 9.000 = 81.000; dasar pajak = 81.000 + 4.050 = 85.050
  assert.equal(b.lines[0].base, 85050n, 'dasar pajak = base + service charge');
  assert.equal(b.totalTax, 8505n);
});

// --- FR-C8 langkah 11'-12': inklusif ---

test('inklusif: pajak diekstrak dari dalam harga, total TIDAK bertambah', async () => {
  const { calculateTax } = await import(MOD);
  const inklusif = { ...PBJT_10, id: 'rate-inc', name: 'PPN 10% (termasuk)', isInclusive: true };
  const b = calculateTax({
    lines: [baris('a', 110000n)],
    serviceChargeAmount: 0n,
    orderDiscount: 0n,
    taxRates: [inklusif],
    channel: 'takeaway',
    outletId: 'outlet-1',
  });
  // 110.000 - (110.000 / 1,1) = 110.000 - 100.000 = 10.000
  assert.equal(b.totalTax, 10000n);
  assert.equal(b.lines[0].isInclusive, true);
  // Yang membuktikan "total tidak bertambah": pemanggil menambahkan
  // totalTaxExclusive ke total, bukan totalTax.
  assert.equal(b.totalTaxExclusive, 0n, 'pajak inklusif tidak menambah total');
});

test('inklusif dan eksklusif bersamaan dihitung terpisah lalu dijumlahkan (AC FR-C8 keempat)', async () => {
  const { calculateTax } = await import(MOD);
  const inklusif = {
    ...PBJT_10, id: 'rate-inc', name: 'PPN 10% (termasuk)', isInclusive: true,
    appliesTo: 'item', appliesToIds: ['item-a'],
  };
  const eksklusif = {
    ...PBJT_10, id: 'rate-exc', name: 'PBJT 10%', isInclusive: false,
    appliesTo: 'item', appliesToIds: ['item-b'],
  };
  const b = calculateTax({
    lines: [baris('a', 110000n), baris('b', 50000n)],
    serviceChargeAmount: 0n,
    orderDiscount: 0n,
    taxRates: [inklusif, eksklusif],
    channel: 'takeaway',
    outletId: 'outlet-1',
  });
  assert.equal(b.lines.length, 2, 'dua baris breakdown terpisah, bukan satu yang digabung');
  const inc = b.lines.find((l) => l.taxRateId === 'rate-inc');
  const exc = b.lines.find((l) => l.taxRateId === 'rate-exc');
  assert.equal(inc.amount, 10000n);
  assert.equal(exc.amount, 5000n);
  assert.equal(b.totalTax, 15000n, 'total pajak dilaporkan penuh');
  assert.equal(b.totalTaxExclusive, 5000n, 'hanya yang eksklusif menambah total');
});

// --- FR-C6: tarif 0% berbeda dari tidak-ada-tarif ---

test('tidak ada tarif yang cocok: pajak 0 dan TIDAK ada baris breakdown', async () => {
  const { calculateTax } = await import(MOD);
  const b = calculateTax({
    lines: [baris('a', 50000n)],
    serviceChargeAmount: 0n,
    orderDiscount: 0n,
    taxRates: [],
    channel: 'takeaway',
    outletId: 'outlet-1',
  });
  assert.equal(b.totalTax, 0n);
  assert.equal(b.lines.length, 0, 'tidak-ada-pajak tidak mencetak baris di struk');
});

test('tarif 0% menghasilkan baris breakdown bernilai 0 (AC FR-C6 kelima)', async () => {
  const { calculateTax } = await import(MOD);
  const nol = { ...PBJT_10, id: 'rate-0', name: 'PPN 0%', rateScaled: 0n };
  const b = calculateTax({
    lines: [baris('a', 50000n)],
    serviceChargeAmount: 0n,
    orderDiscount: 0n,
    taxRates: [nol],
    channel: 'takeaway',
    outletId: 'outlet-1',
  });
  assert.equal(b.totalTax, 0n);
  assert.equal(b.lines.length, 1, '0% TETAP mencetak baris "PPN 0%  Rp 0" -- beda dari tidak ada pajak');
  assert.equal(b.lines[0].amount, 0n);
  assert.equal(b.lines[0].name, 'PPN 0%');
});

// --- FR-C6: resolusi item > category > all_items ---

test('resolusi: item menang atas category, category menang atas all_items', async () => {
  const { calculateTax } = await import(MOD);
  const semua = { ...PBJT_10, id: 'r-all', rateScaled: 1000n, appliesTo: 'all_items', appliesToIds: [] };
  const kategori = { ...PBJT_10, id: 'r-cat', rateScaled: 2000n, appliesTo: 'category', appliesToIds: ['cat-1'] };
  const item = { ...PBJT_10, id: 'r-item', rateScaled: 3000n, appliesTo: 'item', appliesToIds: ['item-a'] };

  const lineA = baris('a', 100000n, { categoryId: 'cat-1' });

  const hanyaSemua = calculateTax({ lines: [lineA], serviceChargeAmount: 0n, orderDiscount: 0n, taxRates: [semua], channel: 'all', outletId: 'o' });
  assert.equal(hanyaSemua.lines[0].taxRateId, 'r-all');

  const semuaDanKategori = calculateTax({ lines: [lineA], serviceChargeAmount: 0n, orderDiscount: 0n, taxRates: [semua, kategori], channel: 'all', outletId: 'o' });
  assert.equal(semuaDanKategori.lines[0].taxRateId, 'r-cat', 'category menang atas all_items');

  const ketiganya = calculateTax({ lines: [lineA], serviceChargeAmount: 0n, orderDiscount: 0n, taxRates: [semua, kategori, item], channel: 'all', outletId: 'o' });
  assert.equal(ketiganya.lines[0].taxRateId, 'r-item', 'item menang atas keduanya');
});

test('resolusi: outlet_id terisi menang atas null saat spesifisitas seri', async () => {
  const { calculateTax } = await import(MOD);
  const tenantWide = { ...PBJT_10, id: 'r-tenant', outletId: null, rateScaled: 1000n };
  const outletSpesifik = { ...PBJT_10, id: 'r-outlet', outletId: 'outlet-1', rateScaled: 2000n };
  const b = calculateTax({
    lines: [baris('a', 100000n)],
    serviceChargeAmount: 0n,
    orderDiscount: 0n,
    taxRates: [tenantWide, outletSpesifik],
    channel: 'all',
    outletId: 'outlet-1',
  });
  assert.equal(b.lines[0].taxRateId, 'r-outlet');
});

test('resolusi: tarif milik outlet LAIN diabaikan sepenuhnya', async () => {
  const { calculateTax } = await import(MOD);
  const outletLain = { ...PBJT_10, id: 'r-lain', outletId: 'outlet-2', rateScaled: 5000n };
  const tenantWide = { ...PBJT_10, id: 'r-tenant', outletId: null, rateScaled: 1000n };
  const b = calculateTax({
    lines: [baris('a', 100000n)],
    serviceChargeAmount: 0n,
    orderDiscount: 0n,
    taxRates: [outletLain, tenantWide],
    channel: 'all',
    outletId: 'outlet-1',
  });
  assert.equal(b.lines[0].taxRateId, 'r-tenant');
});

// --- FR-C7: channel ---

test('FR-C7: channel spesifik menang atas all', async () => {
  const { calculateTax } = await import(MOD);
  const semua = { ...PBJT_10, id: 'r-all-ch', channel: 'all', rateScaled: 1000n };
  const takeaway = { ...PBJT_10, id: 'r-takeaway', channel: 'takeaway', rateScaled: 1100n };
  const b = calculateTax({
    lines: [baris('a', 100000n)],
    serviceChargeAmount: 0n,
    orderDiscount: 0n,
    taxRates: [semua, takeaway],
    channel: 'takeaway',
    outletId: 'outlet-1',
  });
  assert.equal(b.lines[0].taxRateId, 'r-takeaway');
  assert.equal(b.totalTax, 11000n, '100.000 x 11% = 11.000');
});

test('FR-C7: tarif channel lain tidak dipakai', async () => {
  const { calculateTax } = await import(MOD);
  const dineIn = { ...PBJT_10, id: 'r-dinein', channel: 'dine_in', rateScaled: 1100n };
  const semua = { ...PBJT_10, id: 'r-all-ch', channel: 'all', rateScaled: 1000n };
  const b = calculateTax({
    lines: [baris('a', 100000n)],
    serviceChargeAmount: 0n,
    orderDiscount: 0n,
    taxRates: [dineIn, semua],
    channel: 'takeaway',
    outletId: 'outlet-1',
  });
  assert.equal(b.lines[0].taxRateId, 'r-all-ch');
});

// --- AC FR-C8 kelima: diskon order proporsional ---

test('diskon order didistribusikan proporsional ke baris', async () => {
  const { calculateTax } = await import(MOD);
  const rateA = { ...PBJT_10, id: 'r-a', appliesTo: 'item', appliesToIds: ['item-a'] };
  const rateB = { ...PBJT_10, id: 'r-b', appliesTo: 'item', appliesToIds: ['item-b'], rateScaled: 2000n };
  // Baris a 75.000, baris b 25.000, total 100.000. Diskon 10.000 -> a:7.500 b:2.500
  const b = calculateTax({
    lines: [baris('a', 75000n), baris('b', 25000n)],
    serviceChargeAmount: 0n,
    orderDiscount: 10000n,
    taxRates: [rateA, rateB],
    channel: 'all',
    outletId: 'o',
  });
  const a = b.lines.find((l) => l.taxRateId === 'r-a');
  const bb = b.lines.find((l) => l.taxRateId === 'r-b');
  assert.equal(a.base, 67500n, '75.000 - 7.500');
  assert.equal(bb.base, 22500n, '25.000 - 2.500');
  assert.equal(a.base + bb.base, 90000n, 'seluruh diskon terdistribusi, tidak ada rupiah hilang');
});

// Pembulatan alokasi tidak boleh menghilangkan atau menciptakan rupiah.
// 100 dibagi 3 baris tidak habis; sisanya harus tetap terserap.
test('alokasi proporsional yang tidak habis dibagi tetap berjumlah tepat', async () => {
  const { calculateTax } = await import(MOD);
  const r = (id, item) => ({ ...PBJT_10, id, appliesTo: 'item', appliesToIds: [item] });
  const b = calculateTax({
    lines: [baris('a', 10000n), baris('b', 10000n), baris('c', 10000n)],
    serviceChargeAmount: 0n,
    orderDiscount: 100n,
    taxRates: [r('r-a', 'item-a'), r('r-b', 'item-b'), r('r-c', 'item-c')],
    channel: 'all',
    outletId: 'o',
  });
  const jumlahBase = b.lines.reduce((s, l) => s + l.base, 0n);
  assert.equal(jumlahBase, 29900n, '30.000 - 100, tanpa rupiah hilang atau tercipta');
});

// --- property ---

test('property: totalTax selalu sama dengan jumlah amount di breakdown', async () => {
  const { calculateTax } = await import(MOD);
  const tarif = [0n, 1n, 1000n, 1100n, 2500n];
  const nilai = [0n, 1n, 999n, 33333n, 1_000_000n];
  let diperiksa = 0;
  for (const rateScaled of tarif) {
    for (const amount of nilai) {
      for (const isInclusive of [false, true]) {
        const b = calculateTax({
          lines: [baris('a', amount)],
          serviceChargeAmount: 0n,
          orderDiscount: 0n,
          taxRates: [{ ...PBJT_10, rateScaled, isInclusive }],
          channel: 'all',
          outletId: 'o',
        });
        const jumlah = b.lines.reduce((s, l) => s + l.amount, 0n);
        assert.equal(b.totalTax, jumlah, `tidak konsisten untuk ${rateScaled}/${amount}/${isInclusive}`);
        assert.equal(typeof b.totalTax, 'bigint');
        assert.ok(b.totalTax >= 0n, 'pajak tidak pernah negatif');
        diperiksa += 1;
      }
    }
  }
  assert.equal(diperiksa, tarif.length * nilai.length * 2);
});

test('property: pajak inklusif tidak pernah melebihi dasarnya', async () => {
  const { calculateTax } = await import(MOD);
  let diperiksa = 0;
  for (const rateScaled of [1n, 1000n, 1100n, 5000n, 10000n]) {
    for (const amount of [1n, 999n, 110000n, 1_000_000n]) {
      const b = calculateTax({
        lines: [baris('a', amount)],
        serviceChargeAmount: 0n,
        orderDiscount: 0n,
        taxRates: [{ ...PBJT_10, rateScaled, isInclusive: true }],
        channel: 'all',
        outletId: 'o',
      });
      assert.ok(b.totalTax <= amount, `pajak inklusif ${b.totalTax} melebihi dasar ${amount}`);
      diperiksa += 1;
    }
  }
  assert.equal(diperiksa, 20);
});

// --- perLine: snapshot pajak per order_line (FR-B3) ---
//
// TaxBreakdown.lines dikelompokkan PER TARIF, karena itu yang dicetak di
// struk. Tapi `order_line` menyimpan snapshot pajak PER BARIS
// (tax_rate_id, tax_rate, tax_amount, is_tax_inclusive) supaya struk lama
// kebal perubahan tarif.
//
// Menghitung pajak per baris di handler akan melanggar invariant #7, jadi
// kalkulator ini yang menyediakannya.
//
// Yang menentukan benar-salahnya: SUM(perLine.amount) untuk satu tarif harus
// SAMA PERSIS dengan amount tarif itu. Menghitung tiap baris sendiri-sendiri
// lalu menjumlahkannya bisa meleset satu-dua rupiah dari pajak yang dihitung
// atas dasar agregat -- dan struk yang tidak berjumlah adalah persis yang
// spec-c:126 peringatkan akan ditemukan merchant.

test('perLine: setiap baris kena pajak mendapat snapshot tarifnya', async () => {
  const { calculateTax } = await import(MOD);
  const b = calculateTax({
    lines: [baris('a', 60000n), baris('b', 30000n)],
    serviceChargeAmount: 0n,
    orderDiscount: 0n,
    taxRates: [PBJT_10],
    channel: 'takeaway',
    outletId: 'outlet-1',
  });
  assert.equal(b.perLine.length, 2);
  for (const p of b.perLine) {
    assert.equal(p.taxRateId, 'rate-pbjt-10');
    assert.equal(p.rateScaled, 1000n);
    assert.equal(p.isInclusive, false);
  }
  assert.deepEqual(b.perLine.map((p) => p.lineId).sort(), ['a', 'b']);
});

test('perLine: jumlah per tarif sama persis dengan amount tarif itu', async () => {
  const { calculateTax } = await import(MOD);
  // 33.333 + 33.333 + 33.334 = 100.000; pajak 10% = 10.000. Pembagian ke tiga
  // baris tidak habis, jadi ini kasus yang membedakan alokasi yang benar dari
  // penjumlahan tiga pembulatan terpisah.
  const b = calculateTax({
    lines: [baris('a', 33333n), baris('b', 33333n), baris('c', 33334n)],
    serviceChargeAmount: 0n,
    orderDiscount: 0n,
    taxRates: [PBJT_10],
    channel: 'takeaway',
    outletId: 'outlet-1',
  });
  const perTarif = b.lines[0].amount;
  const jumlahBaris = b.perLine.reduce((s, p) => s + p.amount, 0n);
  assert.equal(jumlahBaris, perTarif, 'SUM(perLine) harus sama dengan amount tarif, tanpa rupiah hilang');
  assert.equal(perTarif, 10000n);
});

test('perLine: baris tanpa tarif yang cocok tidak muncul', async () => {
  const { calculateTax } = await import(MOD);
  const hanyaA = { ...PBJT_10, appliesTo: 'item', appliesToIds: ['item-a'] };
  const b = calculateTax({
    lines: [baris('a', 50000n), baris('b', 50000n)],
    serviceChargeAmount: 0n,
    orderDiscount: 0n,
    taxRates: [hanyaA],
    channel: 'takeaway',
    outletId: 'outlet-1',
  });
  assert.equal(b.perLine.length, 1, 'baris b tidak kena pajak, jadi tidak punya snapshot');
  assert.equal(b.perLine[0].lineId, 'a');
});

test('property: SUM(perLine.amount) selalu sama dengan totalTax', async () => {
  const { calculateTax } = await import(MOD);
  let diperiksa = 0;
  for (const rateScaled of [0n, 1n, 1000n, 1100n, 2500n]) {
    for (const isInclusive of [false, true]) {
      for (const nilai of [[1n], [1n, 1n, 1n], [33333n, 33333n, 33334n], [999n, 1n]]) {
        const b = calculateTax({
          lines: nilai.map((v, i) => baris(String(i), v)),
          serviceChargeAmount: 0n,
          orderDiscount: 0n,
          taxRates: [{ ...PBJT_10, rateScaled, isInclusive }],
          channel: 'all',
          outletId: 'o',
        });
        const jumlah = b.perLine.reduce((s, p) => s + p.amount, 0n);
        assert.equal(jumlah, b.totalTax, `tidak berjumlah untuk ${rateScaled}/${isInclusive}/${nilai}`);
        diperiksa += 1;
      }
    }
  }
  assert.equal(diperiksa, 40);
});

test('nilai number (bukan bigint) ditolak -- float tidak boleh masuk jalur pajak', async () => {
  const { calculateTax } = await import(MOD);
  assert.throws(
    () => calculateTax({
      lines: [baris('a', 50000n)],
      serviceChargeAmount: 0n,
      orderDiscount: 0n,
      taxRates: [{ ...PBJT_10, rateScaled: 0.1 }],
      channel: 'all',
      outletId: 'o',
    }),
    /bigint/i
  );
});
