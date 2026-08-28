'use strict';

// FR-F5 — HPP (`cost`) di-SNAPSHOT server, dan tidak pernah menyentuh
// perangkat kasir.
//
// Keputusan user 25 Agustus 2026, dua bagian yang harus dijaga bersama:
//
//   1. **`cost` TIDAK diturunkan ke SQLite lokal.** Ia margin modal milik
//      owner; perangkat kasir yang memegangnya adalah kebocoran data yang
//      tidak dapat ditarik kembali begitu satu tablet hilang. Dijaga
//      `tests/kasir/skema-lokal.test.js` lewat `KOLOM_SENGAJA_TIDAK_TURUN`.
//
//   2. **Server yang men-snapshot-nya saat order masuk.** Klien menulis
//      `cost_at_sale = 0` di barisnya sendiri dan TIDAK mengirimkannya;
//      `POST /orders` mengambil nilai terkini dari katalog lewat
//      `getVariationSnapshot`.
//
// ⛔ Berkas ini menjaga sisi KEDUA, dan tiga propertinya masing-masing punya
// testnya sendiri — ketiganya rusak diam-diam:
//
//   - Snapshot BUKAN nol. Kolom yang selalu nol menghasilkan laporan margin
//     yang melaporkan margin 100% untuk setiap produk, dan angka itu terlihat
//     meyakinkan.
//   - Nilai dari KLIEN diabaikan. Perangkat yang tidak seharusnya punya `cost`
//     tidak boleh dapat menyuntikkannya.
//   - Snapshot BEKU. `cost` katalog yang naik besok tidak boleh mengubah
//     margin penjualan kemarin (`spec-a:227`).

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');

let owner, appSetup, app, tenant, base;

before(async () => {
  owner = await connectAsOwner();
  appSetup = await connectAsApp();
});

after(async () => {
  await resetAll(owner);
  await owner.end();
  await appSetup.end();
  if (app) await app.close();
});

beforeEach(async () => {
  await resetAll(owner);
  base = await seedTenantBase(appSetup, { suffix: 'CostSnapshot' });
  tenant = base.tenant;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();
});

const TANGGAL = '2026-08-02';

async function kueri(sql, params) {
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  try {
    const { rows } = await appSetup.query(sql, params);
    await appSetup.query('COMMIT');
    return rows;
  } catch (e) {
    await appSetup.query('ROLLBACK');
    throw e;
  }
}

const hdr = () => ({
  'x-tenant-id': tenant.id,
  authorization: base.authHeader,
  'x-actor-id': base.user.id,
});

let urutan = 0;

async function perangkatDanShift() {
  const deviceId = crypto.randomUUID();
  urutan += 1;
  let res = await app.inject({
    method: 'POST',
    url: '/devices',
    payload: { id: deviceId, outletId: base.outlet.id, code: `K${urutan}` },
    headers: hdr(),
  });
  assert.equal(res.statusCode, 201, res.body);

  const shiftId = crypto.randomUUID();
  res = await app.inject({
    method: 'POST',
    url: '/shifts',
    payload: {
      id: shiftId,
      outletId: base.outlet.id,
      deviceId,
      businessDate: TANGGAL,
      openingFloat: 100000,
    },
    headers: hdr(),
  });
  assert.equal(res.statusCode, 201, res.body);
  return { deviceId, shiftId };
}

let nomor = 0;

async function buatOrder({ deviceId, shiftId, lines }) {
  nomor += 1;
  const res = await app.inject({
    method: 'POST',
    url: '/orders',
    headers: { ...hdr(), 'idempotency-key': crypto.randomUUID() },
    payload: {
      id: crypto.randomUUID(),
      outletId: base.outlet.id,
      deviceId,
      shiftId,
      receiptNumber: `K1-20260802-${String(nomor).padStart(4, '0')}`,
      businessDate: TANGGAL,
      sequence: nomor,
      channel: 'takeaway',
      checkId: crypto.randomUUID(),
      lines: lines ?? [
        {
          id: crypto.randomUUID(),
          variationId: base.item_variation.id,
          quantityMilli: 1000,
          discountAmount: 0,
        },
      ],
    },
  });
  assert.equal(res.statusCode, 201, res.body);
  return res.json();
}

/** `cost` katalog diubah LANGSUNG — tidak ada endpoint yang mengubahnya. */
async function setCost(nilai) {
  await kueri('UPDATE item_variation SET cost = $2 WHERE id = $1', [
    base.item_variation.id,
    nilai,
  ]);
}

// ---------------------------------------------------------------------------

test('⛔ cost_at_sale disnapshot SERVER dari katalog, dan bukan nol', async () => {
  // Kolom yang selalu nol menghasilkan laporan margin yang melaporkan margin
  // 100% untuk setiap produk. Angkanya terlihat meyakinkan, dan owner
  // memutuskan harga berdasarkan itu.
  const { deviceId, shiftId } = await perangkatDanShift();
  const order = await buatOrder({ deviceId, shiftId });

  assert.equal(order.lines[0].costAtSale, 8000, 'nilai `cost` dari seedTenantBase');

  const rows = await kueri('SELECT cost_at_sale FROM order_line WHERE order_id = $1', [order.id]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cost_at_sale, '8000', 'yang tersimpan di database, bukan hanya responsnya');
});

test('⛔ cost yang DIKIRIM KLIEN diabaikan sepenuhnya', async () => {
  // Perangkat kasir tidak punya `cost` sama sekali (keputusan FR-F5), jadi
  // nilai apa pun yang datang dari sana adalah karangan — entah dari bug,
  // entah dari perangkat yang dimodifikasi. Server memakai katalognya sendiri.
  //
  // Ini bukan hipotetis: `order_line` lokal PUNYA kolom `cost_at_sale`, dan
  // klien menulis nol ke sana. Jalur naik yang kelak menyertakannya akan
  // mengirim nol — dan nol yang dipercaya menghasilkan margin 100%.
  const { deviceId, shiftId } = await perangkatDanShift();
  const order = await buatOrder({
    deviceId,
    shiftId,
    lines: [
      {
        id: crypto.randomUUID(),
        variationId: base.item_variation.id,
        quantityMilli: 1000,
        discountAmount: 0,
        // Nilai karangan, dan sengaja NOL — bentuk yang paling mungkin
        // benar-benar terkirim.
        costAtSale: 0,
        cost: 999999,
      },
    ],
  });

  assert.equal(order.lines[0].costAtSale, 8000, 'server memakai nilai KLIEN alih-alih katalognya');
});

test('⛔ snapshot BEKU — cost katalog yang berubah tidak mengubah penjualan lama', async () => {
  // `spec-a:227`: *"Laporan margin historis memakai `cost_at_sale` dari
  // `order_line`, bukan `cost` katalog saat ini."*
  //
  // Merchant yang harga belinya naik pekan depan tidak boleh mendapati margin
  // bulan lalu ikut berubah — laporan yang jawabannya berubah tanpa satu pun
  // transaksi berubah tidak dapat dipakai memutuskan apa pun.
  const { deviceId, shiftId } = await perangkatDanShift();
  const lama = await buatOrder({ deviceId, shiftId });
  assert.equal(lama.lines[0].costAtSale, 8000);

  await setCost(12000);

  const baru = await buatOrder({ deviceId, shiftId });
  assert.equal(baru.lines[0].costAtSale, 12000, 'penjualan BARU memakai cost yang baru');

  const rows = await kueri('SELECT cost_at_sale FROM order_line WHERE order_id = $1', [lama.id]);
  assert.equal(rows[0].cost_at_sale, '8000', 'penjualan LAMA ikut berubah — snapshot tidak beku');
});

test('cost NOL di katalog tersimpan sebagai nol, bukan ditolak', async () => {
  // Merchant yang belum mengisi HPP adalah keadaan sah dan umum. Menolak
  // penjualannya karena itu akan menghentikan kasir demi angka laporan.
  const { deviceId, shiftId } = await perangkatDanShift();
  await setCost(0);
  const order = await buatOrder({ deviceId, shiftId });
  assert.equal(order.lines[0].costAtSale, 0);
});

test('⛔ cost tenant lain tidak pernah bocor lewat snapshot', async () => {
  // `getVariationSnapshot` tunduk RLS lewat transaksi pemanggil. Kalau tidak,
  // variation id milik tenant lain akan mengembalikan HPP-nya — kebocoran
  // margin modal lintas merchant, tanpa satu pun error.
  const lain = await seedTenantBase(appSetup, { suffix: 'CostLain' });
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [lain.tenant.id]);
  await appSetup.query('UPDATE item_variation SET cost = 777777 WHERE id = $1', [
    lain.item_variation.id,
  ]);
  await appSetup.query('COMMIT');

  const { deviceId, shiftId } = await perangkatDanShift();
  nomor += 1;
  const res = await app.inject({
    method: 'POST',
    url: '/orders',
    headers: { ...hdr(), 'idempotency-key': crypto.randomUUID() },
    payload: {
      id: crypto.randomUUID(),
      outletId: base.outlet.id,
      deviceId,
      shiftId,
      receiptNumber: `K1-20260802-${String(nomor).padStart(4, '0')}`,
      businessDate: TANGGAL,
      sequence: nomor,
      channel: 'takeaway',
      checkId: crypto.randomUUID(),
      lines: [
        {
          id: crypto.randomUUID(),
          variationId: lain.item_variation.id,
          quantityMilli: 1000,
          discountAmount: 0,
        },
      ],
    },
  });

  assert.equal(res.statusCode, 404, res.body);
  assert.equal(res.json().error.code, 'VARIATION_NOT_FOUND');
});
