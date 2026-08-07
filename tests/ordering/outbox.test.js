'use strict';

// T13 (docs/superpowers/plans/PLAN-ordering-fondasi.md) -- baris outbox
// ditulis DALAM transaksi yang sama dengan penjualan (FR-B2, invariant #1
// CLAUDE.md): aggregate_type='order', aggregate_id=order.id,
// event_type='order.created', payload jsonb, published_at NULL. Worker
// pengirim TIDAK dibangun di sub-project ini (§4 non-scope PLAN) -- yang
// diuji di sini murni penulisan baris + rollback-nya.
//
// Pola test SAMA dengan tests/ordering/orders.test.js.

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
  base = await seedTenantBase(appSetup, { suffix: 'OrderOutbox' });
  tenant = base.tenant;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();
});

const BUSINESS_DATE = '2026-08-02';

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
  const device = await createDevice(base.outlet.id, `KO${deviceCounter}`);
  const shift = await openShift(base.outlet.id, device.id);
  return { device, shift };
}

function orderPayload({ deviceId, shiftId, sequence = 1 }) {
  return {
    id: crypto.randomUUID(),
    outletId: base.outlet.id,
    deviceId,
    shiftId,
    receiptNumber: `K1-20260802-${String(sequence).padStart(4, '0')}`,
    businessDate: BUSINESS_DATE,
    sequence,
    channel: 'takeaway',
    checkId: crypto.randomUUID(),
    lines: [{ id: crypto.randomUUID(), variationId: base.item_variation.id, quantityMilli: 1000, discountAmount: 0 }],
  };
}

async function outboxRowsFor(callerTenantId, aggregateId) {
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [callerTenantId]);
  const { rows } = await appSetup.query(
    'SELECT aggregate_type, aggregate_id, event_type, payload, published_at FROM outbox WHERE aggregate_id = $1',
    [aggregateId]
  );
  await appSetup.query('COMMIT');
  return rows;
}

test('outbox: order sukses -> tepat satu baris outbox, order.created, published_at NULL', async () => {
  const { device, shift } = await setupDeviceAndShift();
  const payload = orderPayload({ deviceId: device.id, shiftId: shift.id, sequence: 1 });
  const res = await req(payload);
  assert.equal(res.statusCode, 201, res.body);

  const rows = await outboxRowsFor(tenant.id, payload.id);
  assert.equal(rows.length, 1, 'harus tepat satu baris outbox untuk order ini');
  assert.equal(rows[0].aggregate_type, 'order');
  assert.equal(rows[0].aggregate_id, payload.id);
  assert.equal(rows[0].event_type, 'order.created');
  assert.equal(rows[0].published_at, null, 'published_at harus NULL -- worker pengirim belum dibangun (F2)');
  assert.equal(rows[0].payload.id, payload.id, 'payload outbox harus berisi order yang baru dibuat');
});

test('outbox: order gagal (sequence bentrok, salah satu pemicu T4) -> nol baris outbox', async () => {
  const { device, shift } = await setupDeviceAndShift();
  const first = orderPayload({ deviceId: device.id, shiftId: shift.id, sequence: 1 });
  const firstRes = await req(first);
  assert.equal(firstRes.statusCode, 201, firstRes.body);

  const second = orderPayload({ deviceId: device.id, shiftId: shift.id, sequence: 1 }); // bentrok
  const secondRes = await req(second);
  assert.equal(secondRes.statusCode, 409, secondRes.body);

  const rows = await outboxRowsFor(tenant.id, second.id);
  assert.equal(rows.length, 0, 'order yang gagal tidak boleh meninggalkan baris outbox (rollback)');

  // Order pertama TETAP punya baris outbox-nya sendiri -- rollback yang
  // kedua tidak menyentuh yang pertama.
  const firstRows = await outboxRowsFor(tenant.id, first.id);
  assert.equal(firstRows.length, 1);
});

test('outbox: request idempotency yang KALAH konkurensi (409) tidak meninggalkan baris outbox', async () => {
  const { device, shift } = await setupDeviceAndShift();
  const payload = orderPayload({ deviceId: device.id, shiftId: shift.id, sequence: 1 });
  const key = crypto.randomUUID();

  // Prewarm dua koneksi pool bersamaan -- lihat komentar identik di
  // tests/ordering/idempotency.test.js ("dua request BERSAMAAN"): tanpa ini
  // pool (fresh per test) hanya punya satu koneksi idle, dan race di bawah
  // selalu punya satu sisi yang menang lewat koneksi TCP+auth baru yang
  // jauh lebih lambat (~20ms) -- bukan race sungguhan.
  await Promise.all([
    app.inject({ method: 'GET', url: `/orders/${crypto.randomUUID()}`, headers: { 'x-tenant-id': tenant.id } }),
    app.inject({ method: 'GET', url: `/orders/${crypto.randomUUID()}`, headers: { 'x-tenant-id': tenant.id } }),
  ]);

  const [resA, resB] = await Promise.all([
    req(payload, { 'idempotency-key': key }),
    req(payload, { 'idempotency-key': key }),
  ]);
  const statuses = [resA.statusCode, resB.statusCode].sort();
  assert.deepEqual(statuses, [201, 409], `harusnya satu 201 dan satu 409, dapat ${JSON.stringify(statuses)}`);

  const rows = await outboxRowsFor(tenant.id, payload.id);
  assert.equal(rows.length, 1, 'transaksi yang kalah (409 idempotency conflict) tidak boleh meninggalkan baris outbox kedua');
});
