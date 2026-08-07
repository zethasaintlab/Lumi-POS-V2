'use strict';

// T4 (docs/superpowers/plans/PLAN-ordering-fondasi.md) -- atomisitas FR-B2
// (spec-b:104-106). Kegagalan dipicu lewat DATA yang melanggar constraint
// pada tahap BERBEDA -- BUKAN seam/hook test-only (dilarang eksplisit di
// brief T4). Untuk SETIAP kasus dibuktikan NOL baris tersisa di KEEMPAT
// tabel: order, check, order_line, order_line_modifier -- bukan hanya
// status code, dan bukan hanya tabel order (temuan berulang di repo ini,
// lihat CLAUDE.md § "Temuan F1").
//
// Pola test SAMA dengan tests/ordering/orders.test.js: seedTenantBase,
// appSetup untuk pembuktian langsung ke DB (BEGIN/set_config/COMMIT).

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
  base = await seedTenantBase(appSetup, { suffix: 'OrderAtomicity' });
  tenant = base.tenant;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();
});

const BUSINESS_DATE = '2026-08-02';

// Idempotency-Key BEDA per panggilan secara default (crypto.randomUUID())
// supaya test atomisitas tidak diam-diam terpengaruh mekanisme idempotency
// (T10-T12, orders.ts) -- test ini murni soal rollback DB, bukan idempotency.
function req(payload, headers = {}) {
  return app.inject({
    method: 'POST',
    url: '/orders',
    payload,
    headers: {
      'x-tenant-id': tenant.id,
      'x-actor-id': base.user.id,
      'idempotency-key': crypto.randomUUID(),
      ...headers,
    },
  });
}

async function createDevice(outletId, code) {
  const deviceId = crypto.randomUUID();
  const res = await app.inject({
    method: 'POST',
    url: '/devices',
    payload: { id: deviceId, outletId, code },
    headers: { 'x-tenant-id': tenant.id },
  });
  assert.equal(res.statusCode, 201, `gagal membuat device persiapan test: ${res.body}`);
  return JSON.parse(res.body);
}

async function openShift(outletId, deviceId) {
  const shiftId = crypto.randomUUID();
  const res = await app.inject({
    method: 'POST',
    url: '/shifts',
    payload: { id: shiftId, outletId, deviceId, businessDate: BUSINESS_DATE, openingFloat: 100000 },
    headers: { 'x-tenant-id': tenant.id, 'x-actor-id': base.user.id },
  });
  assert.equal(res.statusCode, 201, `gagal membuka shift persiapan test: ${res.body}`);
  return JSON.parse(res.body);
}

let deviceCounter = 0;
async function setupDeviceAndShift() {
  deviceCounter += 1;
  const device = await createDevice(base.outlet.id, `KA${deviceCounter}`);
  const shift = await openShift(base.outlet.id, device.id);
  return { device, shift };
}

function orderPayload({ deviceId, shiftId, sequence = 1, checkId, lines }) {
  return {
    id: crypto.randomUUID(),
    outletId: base.outlet.id,
    deviceId,
    shiftId,
    receiptNumber: `K1-20260802-${String(sequence).padStart(4, '0')}`,
    businessDate: BUSINESS_DATE,
    sequence,
    channel: 'takeaway',
    checkId: checkId ?? crypto.randomUUID(),
    lines: lines ?? [
      { id: crypto.randomUUID(), variationId: base.item_variation.id, quantityMilli: 1000, discountAmount: 0 },
    ],
  };
}

// Bukti langsung ke database -- KEEMPAT tabel (lihat komentar berkas).
// lineIds/modifierIds harus id CLIENT-GENERATED yang dikirim dalam payload,
// diketahui SEBELUM request dikirim -- jadi bisa dicek terlepas dari tahap
// mana penulisan gagal.
async function assertNoRowsForOrder(callerTenantId, { orderId, checkId, lineIds = [], modifierIds = [] }) {
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [callerTenantId]);
  const { rows: orderRows } = await appSetup.query('SELECT id FROM "order" WHERE id = $1', [orderId]);
  const { rows: checkRows } = await appSetup.query('SELECT id FROM "check" WHERE id = $1', [checkId]);
  const { rows: lineRows } = lineIds.length
    ? await appSetup.query('SELECT id FROM order_line WHERE id = ANY($1)', [lineIds])
    : { rows: [] };
  const { rows: modifierRows } = modifierIds.length
    ? await appSetup.query('SELECT id FROM order_line_modifier WHERE id = ANY($1)', [modifierIds])
    : { rows: [] };
  await appSetup.query('COMMIT');
  assert.equal(orderRows.length, 0, 'tidak boleh ada baris order tersimpan');
  assert.equal(checkRows.length, 0, 'tidak boleh ada baris check tersimpan untuk order ini');
  assert.equal(lineRows.length, 0, 'tidak boleh ada baris order_line tersimpan');
  assert.equal(modifierRows.length, 0, 'tidak boleh ada baris order_line_modifier tersimpan');
}

// ============================================================
// T4 -- injeksi kegagalan di EMPAT tahap berbeda (spec-b:104)
// ============================================================

test('atomisitas: gagal SEBELUM apa pun (sequence bentrok) -- nol baris di keempat tabel', async () => {
  const { device, shift } = await setupDeviceAndShift();
  const first = orderPayload({ deviceId: device.id, shiftId: shift.id, sequence: 1 });
  const firstRes = await req(first);
  assert.equal(firstRes.statusCode, 201, firstRes.body);

  const lineId = crypto.randomUUID();
  const second = orderPayload({
    deviceId: device.id,
    shiftId: shift.id,
    sequence: 1, // bentrok dengan first
    lines: [{ id: lineId, variationId: base.item_variation.id, quantityMilli: 1000, discountAmount: 0 }],
  });
  const secondRes = await req(second);
  assert.equal(secondRes.statusCode, 409, secondRes.body);
  assert.equal(JSON.parse(secondRes.body).error.code, 'RECEIPT_SEQUENCE_TAKEN');

  await assertNoRowsForOrder(tenant.id, { orderId: second.id, checkId: second.checkId, lineIds: [lineId] });
});

test('atomisitas: gagal SETELAH order ditulis (checkId sudah dipakai order lain) -- order kedua tidak tersimpan', async () => {
  const { device, shift } = await setupDeviceAndShift();
  const usedCheckId = crypto.randomUUID();
  const first = orderPayload({ deviceId: device.id, shiftId: shift.id, sequence: 1, checkId: usedCheckId });
  const firstRes = await req(first);
  assert.equal(firstRes.statusCode, 201, firstRes.body);

  const lineId = crypto.randomUUID();
  const second = orderPayload({
    deviceId: device.id,
    shiftId: shift.id,
    sequence: 2,
    checkId: usedCheckId, // sudah dipakai order pertama -> check_pkey bentrok SETELAH order kedua ditulis
    lines: [{ id: lineId, variationId: base.item_variation.id, quantityMilli: 1000, discountAmount: 0 }],
  });
  const secondRes = await req(second);
  assert.ok(
    secondRes.statusCode >= 400 && secondRes.statusCode < 500,
    `harusnya 4xx bersih, dapat ${secondRes.statusCode}: ${secondRes.body}`
  );

  // order KEDUA (id berbeda dari first) tidak boleh tersimpan, walau ORDER-
  // nya sendiri sempat ditulis SEBELUM check gagal di dalam transaksi yang
  // sama.
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  const { rows: orderRows } = await appSetup.query('SELECT id FROM "order" WHERE id = $1', [second.id]);
  const { rows: lineRows } = await appSetup.query('SELECT id FROM order_line WHERE id = $1', [lineId]);
  await appSetup.query('COMMIT');
  assert.equal(orderRows.length, 0, 'order kedua tidak boleh tersimpan walau ditulis sebelum check gagal');
  assert.equal(lineRows.length, 0, 'order_line order kedua tidak boleh tersimpan');
});

test('atomisitas: gagal SETELAH check + baris pertama (dua baris, line.id sama) -- nol baris di keempat tabel', async () => {
  const { device, shift } = await setupDeviceAndShift();
  const dupLineId = crypto.randomUUID();
  const payload = orderPayload({
    deviceId: device.id,
    shiftId: shift.id,
    sequence: 1,
    lines: [
      { id: dupLineId, variationId: base.item_variation.id, quantityMilli: 1000, discountAmount: 0 },
      { id: dupLineId, variationId: base.item_variation.id, quantityMilli: 2000, discountAmount: 0 }, // id sama -> order_line PK bentrok
    ],
  });
  const res = await req(payload);
  assert.ok(res.statusCode >= 400 && res.statusCode < 500, `harusnya 4xx bersih, dapat ${res.statusCode}: ${res.body}`);

  await assertNoRowsForOrder(tenant.id, { orderId: payload.id, checkId: payload.checkId, lineIds: [dupLineId] });
});

test('atomisitas: gagal SETELAH seluruh baris (dua modifier, id sama) -- nol baris di keempat tabel', async () => {
  const { device, shift } = await setupDeviceAndShift();
  const lineId = crypto.randomUUID();
  const dupModifierId = crypto.randomUUID();
  const payload = orderPayload({
    deviceId: device.id,
    shiftId: shift.id,
    sequence: 1,
    lines: [
      {
        id: lineId,
        variationId: base.item_variation.id,
        quantityMilli: 1000,
        discountAmount: 0,
        modifiers: [
          { id: dupModifierId, modifierId: base.modifier.id, name: 'Extra shot', price: 5000, quantityMilli: 1000 },
          {
            id: dupModifierId, // id sama -> order_line_modifier PK bentrok
            modifierId: base.modifier.id,
            name: 'Extra shot lagi',
            price: 5000,
            quantityMilli: 1000,
          },
        ],
      },
    ],
  });
  const res = await req(payload);
  assert.ok(res.statusCode >= 400 && res.statusCode < 500, `harusnya 4xx bersih, dapat ${res.statusCode}: ${res.body}`);

  await assertNoRowsForOrder(tenant.id, {
    orderId: payload.id,
    checkId: payload.checkId,
    lineIds: [lineId],
    modifierIds: [dupModifierId],
  });
});

// ============================================================
// spec-b:106 -- kegagalan menyimpan TIDAK menghapus keranjang yang sudah ada
// ============================================================

test('atomisitas: order sukses lalu order gagal -- order pertama tetap utuh', async () => {
  const { device, shift } = await setupDeviceAndShift();
  const first = orderPayload({ deviceId: device.id, shiftId: shift.id, sequence: 1 });
  const firstRes = await req(first);
  assert.equal(firstRes.statusCode, 201, firstRes.body);
  const firstBody = JSON.parse(firstRes.body);

  // Sengaja gagal: sequence bentrok dengan order pertama.
  const second = orderPayload({ deviceId: device.id, shiftId: shift.id, sequence: 1 });
  const secondRes = await req(second);
  assert.equal(secondRes.statusCode, 409, secondRes.body);

  const rereadRes = await app.inject({
    method: 'GET',
    url: `/orders/${first.id}`,
    headers: { 'x-tenant-id': tenant.id },
  });
  assert.equal(rereadRes.statusCode, 200, rereadRes.body);
  const reread = JSON.parse(rereadRes.body);
  assert.equal(reread.id, firstBody.id);
  assert.equal(reread.status, 'open');
  assert.equal(reread.total, firstBody.total);
  assert.equal(reread.checkId, firstBody.checkId);
  assert.equal(reread.lines.length, firstBody.lines.length);
  assert.equal(reread.lines[0].lineTotal, firstBody.lines[0].lineTotal);
});
