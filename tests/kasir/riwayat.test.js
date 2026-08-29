'use strict';

// K-08 Riwayat Transaksi + K-09 Detail Transaksi.
//
// `IA:68` menandai K-09 dengan satu kalimat yang menentukan bentuknya:
// "Menampilkan RANTAI KOREKSI". Order asli tidak pernah di-UPDATE
// (invariant #2), jadi void dan refund adalah baris-baris LAIN — dan tanpa
// merangkainya, kasir melihat order yang terlihat normal padahal sudah
// dibatalkan.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../apps/kasir/src/riwayat/baca.ts';

function dbPalsu(data = {}) {
  return {
    async getAll(sql, params = []) {
      if (/FROM "order"/.test(sql)) {
        if (/WHERE o\.id = \?/.test(sql)) return (data.order ?? []).filter((o) => o.id === params[0]);
        return data.order ?? [];
      }
      if (/FROM order_line/.test(sql)) return (data.order_line ?? []).filter((l) => l.order_id === params[0]);
      if (/FROM payment/.test(sql)) return (data.payment ?? []).filter((p) => p.order_id === params[0]);
      if (/FROM refund/.test(sql)) return (data.refund ?? []).filter((r) => r.order_id === params[0]);
      if (/FROM outbox_local/.test(sql)) return data.outbox ?? [];
      return [];
    },
    async execute() { return { rowsAffected: 0 }; },
    async transaction(fn) { return fn(this); },
  };
}

const ORDER = {
  id: 'o1', receipt_number: 'K1-20260813-0001', business_date: '2026-08-13',
  status: 'closed', total: 16500, amount_due: 16500, tax_amount: 1500,
  rounding_adjustment: 0, occurred_at: '2026-08-13T07:00:00Z',
  created_by: 'u-sari', voided_by_order_id: null, sequence: 1,
};

// ---------------------------------------------------------------------------

test('daftar: terbaru lebih dulu, dengan status sinkronisasi per order', async () => {
  const { bacaRiwayat } = await import(MOD);

  const db = dbPalsu({
    order: [
      { ...ORDER, id: 'o1', sequence: 1, occurred_at: '2026-08-13T07:00:00Z' },
      { ...ORDER, id: 'o2', sequence: 2, occurred_at: '2026-08-13T08:00:00Z', receipt_number: 'K1-20260813-0002' },
    ],
    outbox: [
      { entity_id: 'o1', status: 'sent' },
      { entity_id: 'o2', status: 'pending' },
    ],
  });

  const hasil = await bacaRiwayat(db, { batas: 50 });
  assert.deepEqual(hasil.map((o) => o.id), ['o2', 'o1'], 'terbaru lebih dulu');
  assert.equal(hasil[0].statusSync, 'queued');
  assert.equal(hasil[1].statusSync, 'ok');
});

test('⛔ status sinkronisasi memakai aturan TERBURUK-MENANG', async () => {
  const { bacaRiwayat } = await import(MOD);

  // Satu order punya beberapa baris outbox — `order` dan `payment` memakai
  // `entity_id` yang sama. Order yang pembayarannya gagal terkirim TIDAK
  // boleh terlihat `ok`, karena itu justru penjualan yang uangnya berisiko.
  const db = dbPalsu({
    order: [ORDER],
    outbox: [
      { entity_id: 'o1', status: 'sent' },
      { entity_id: 'o1', status: 'failed' },
    ],
  });

  const hasil = await bacaRiwayat(db, { batas: 50 });
  assert.equal(hasil[0].statusSync, 'failed');
});

test('order yang sudah DI-VOID ditandai, meski statusnya masih `open`', async () => {
  const { bacaRiwayat } = await import(MOD);

  // ⛔ `CLAUDE.md`: "Order yang sudah di-void tetap berstatus `open`. Jangan
  // pernah menyimpulkan 'order ini sah' dari `status = 'open'` saja."
  // Yang menandainya adalah order PEMBATAL yang menunjuk ke sini.
  const db = dbPalsu({
    order: [
      { ...ORDER, id: 'o1', status: 'open', voided_by_order_id: null },
      { ...ORDER, id: 'o-batal', status: 'voided', voided_by_order_id: 'o1', receipt_number: 'K1-20260813-0002' },
    ],
  });

  const hasil = await bacaRiwayat(db, { batas: 50 });
  const asli = hasil.find((o) => o.id === 'o1');
  assert.equal(asli.dibatalkan, true, 'order asli harus tertandai dibatalkan');
  assert.equal(asli.dibatalkanOleh, 'o-batal');

  // Order pembatal sendiri TIDAK ditandai "dibatalkan" — ia yang membatalkan.
  const pembatal = hasil.find((o) => o.id === 'o-batal');
  assert.equal(pembatal.dibatalkan, false);
  assert.equal(pembatal.membatalkan, 'o1');
});

test('detail: baris, pembayaran, dan refund dirangkai', async () => {
  const { bacaDetail } = await import(MOD);

  const db = dbPalsu({
    order: [ORDER],
    order_line: [
      { id: 'l1', order_id: 'o1', item_name: 'Kopi Susu', variation_name: 'Regular',
        unit_price: 15000, quantity: 1000, line_total: 15000, tax_amount: 1500,
        modifier_snapshot: JSON.stringify(['Ekstra']) },
    ],
    payment: [
      { id: 'p1', order_id: 'o1', method: 'cash', amount: 16500,
        tendered_amount: 20000, change_amount: 3500, status: 'confirmed' },
    ],
    refund: [
      { id: 'r1', order_id: 'o1', amount: 5000, reason_code: 'barang_rusak',
        reason_note: null, approved_by: 'u-budi', occurred_at: '2026-08-13T09:00:00Z' },
    ],
  });

  const d = await bacaDetail(db, 'o1');
  assert.equal(d.order.receiptNumber, 'K1-20260813-0001');
  assert.equal(d.baris.length, 1);
  assert.deepEqual(d.baris[0].modifier, ['Ekstra']);
  assert.equal(d.pembayaran[0].kembalian, 3500);
  assert.equal(d.refund[0].jumlah, 5000);
  // Sisa yang masih dapat direfund — dihitung, bukan disimpan. Refund
  // sebagian menuntutnya, dan menampilkannya salah berarti kasir menjanjikan
  // uang yang server akan tolak.
  assert.equal(d.sisaDapatDirefund, 11500);
});

test('⛔ sisa refund tidak pernah negatif', async () => {
  const { bacaDetail } = await import(MOD);

  const db = dbPalsu({
    order: [ORDER],
    refund: [
      { id: 'r1', order_id: 'o1', amount: 16500, reason_code: 'barang_rusak', occurred_at: '2026-08-13T09:00:00Z' },
    ],
  });
  const d = await bacaDetail(db, 'o1');
  assert.equal(d.sisaDapatDirefund, 0);
});

test('detail order yang tidak ada mengembalikan null, bukan melempar', async () => {
  const { bacaDetail } = await import(MOD);
  assert.equal(await bacaDetail(dbPalsu({}), 'tidak-ada'), null);
});

test('riwayat kosong bukan galat', async () => {
  const { bacaRiwayat } = await import(MOD);
  assert.deepEqual(await bacaRiwayat(dbPalsu({}), { batas: 50 }), []);
});

test('pencarian nomor struk', async () => {
  const { cariRiwayat } = await import(MOD);

  const daftar = [
    { id: 'o1', receiptNumber: 'K1-20260813-0001', total: 16500 },
    { id: 'o2', receiptNumber: 'K1-20260813-0042', total: 20000 },
  ];
  assert.equal(cariRiwayat(daftar, '0042').length, 1);
  assert.equal(cariRiwayat(daftar, 'K1-2026').length, 2);
  assert.equal(cariRiwayat(daftar, '').length, 2);
  assert.equal(cariRiwayat(daftar, 'tidak ada').length, 0);
});

test('⛔ snapshot modifier: bentuk LAMA dan bentuk FR-A3 sama-sama terbaca', async () => {
  const { bacaDetail } = await import(MOD);

  const db = dbPalsu({
    order: [ORDER],
    order_line: [
      // Bentuk lama — ada di perangkat merchant dan tidak dapat ditulis ulang:
      // `order_line` tidak pernah di-UPDATE (invariant #2). Menolaknya berarti
      // seluruh riwayat sebelum FR-A3 kehilangan modifiernya.
      { id: 'l1', order_id: 'o1', item_name: 'Kopi', variation_name: 'Regular',
        unit_price: 15000, quantity: 1000, line_total: 15000, tax_amount: 0,
        modifier_snapshot: JSON.stringify(['Ekstra']) },
      { id: 'l2', order_id: 'o1', item_name: 'Kopi', variation_name: 'Large',
        unit_price: 20000, quantity: 1000, line_total: 20000, tax_amount: 0,
        modifier_snapshot: JSON.stringify([
          { nama: 'Extra shot', qtyMilli: 2000 },
          { nama: 'Es sedikit', qtyMilli: 1000 },
        ]) },
      // JSON cacat tidak boleh menjatuhkan seluruh layar detail.
      { id: 'l3', order_id: 'o1', item_name: 'Teh', variation_name: 'Regular',
        unit_price: 10000, quantity: 1000, line_total: 10000, tax_amount: 0,
        modifier_snapshot: '{bukan json' },
    ],
    payment: [],
    refund: [],
  });

  const d = await bacaDetail(db, 'o1');
  assert.deepEqual(d.baris[0].modifier, ['Ekstra']);
  // Kuantitas TERLIHAT — ini layar yang dipakai memutuskan refund.
  assert.deepEqual(d.baris[1].modifier, ['Extra shot ×2', 'Es sedikit']);
  assert.deepEqual(d.baris[2].modifier, []);
});
