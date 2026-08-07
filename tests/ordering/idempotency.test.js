'use strict';

// T10-T12 (docs/superpowers/plans/PLAN-ordering-fondasi.md §3.5, FR-B10,
// spec-b:318-361). Header `Idempotency-Key`, tiga aturan spec-b:333-348:
//
//   key sama + request_hash SAMA    -> respons TERSIMPAN, tidak diproses ulang
//   key sama + request_hash BERBEDA -> 422, bukan cache hit
//   dua request bersamaan, key sama -> tepat satu berhasil, satu 409
//
// Baris idempotency_key WAJIB ditulis dalam TRANSAKSI YANG SAMA dengan
// penjualan (spec-b:350) -- dibuktikan lewat query LANGSUNG ke tabel
// idempotency_key (appSetup, tunduk RLS), bukan hanya lewat perilaku HTTP.
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
  base = await seedTenantBase(appSetup, { suffix: 'OrderIdem' });
  tenant = base.tenant;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();
});

const BUSINESS_DATE = '2026-08-02';

function orderUrl(orderId) {
  return `/orders/${orderId}`;
}

function req(payload, headers = {}) {
  return app.inject({
    method: 'POST',
    url: '/orders',
    payload,
    headers: { 'x-tenant-id': tenant.id, 'x-actor-id': base.user.id, ...headers },
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
  const device = await createDevice(base.outlet.id, `KI${deviceCounter}`);
  const shift = await openShift(base.outlet.id, device.id);
  return { device, shift };
}

function orderPayload({ deviceId, shiftId, sequence = 1, id, quantityMilli = 1000 }) {
  return {
    id: id ?? crypto.randomUUID(),
    outletId: base.outlet.id,
    deviceId,
    shiftId,
    receiptNumber: `K1-20260802-${String(sequence).padStart(4, '0')}`,
    businessDate: BUSINESS_DATE,
    sequence,
    channel: 'takeaway',
    checkId: crypto.randomUUID(),
    lines: [{ id: crypto.randomUUID(), variationId: base.item_variation.id, quantityMilli, discountAmount: 0 }],
  };
}

async function idempotencyKeyRow(callerTenantId, key) {
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [callerTenantId]);
  const { rows } = await appSetup.query(
    'SELECT key, request_hash, response_status, response_body, expires_at, created_at FROM idempotency_key WHERE key = $1',
    [key]
  );
  await appSetup.query('COMMIT');
  return rows;
}

async function orderRowCount(callerTenantId, orderId) {
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [callerTenantId]);
  const { rows } = await appSetup.query('SELECT id FROM "order" WHERE id = $1', [orderId]);
  await appSetup.query('COMMIT');
  return rows.length;
}

// ============================================================
// T10 -- tiga aturan spec-b:333-348
// ============================================================

test('idempotency: header hilang -> 400 MISSING_IDEMPOTENCY_KEY, tidak tersimpan', async () => {
  const { device, shift } = await setupDeviceAndShift();
  const payload = orderPayload({ deviceId: device.id, shiftId: shift.id });
  const res = await req(payload); // tanpa header idempotency-key
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'MISSING_IDEMPOTENCY_KEY');
  assert.equal(await orderRowCount(tenant.id, payload.id), 0);
});

test('idempotency: key sama + request_hash sama -> respons TERSIMPAN dikembalikan, TIDAK diproses ulang', async () => {
  const { device, shift } = await setupDeviceAndShift();
  const payload = orderPayload({ deviceId: device.id, shiftId: shift.id });
  const key = crypto.randomUUID();

  const firstRes = await req(payload, { 'idempotency-key': key });
  assert.equal(firstRes.statusCode, 201, firstRes.body);
  const firstBody = JSON.parse(firstRes.body);

  // Baris idempotency_key HARUS ada setelah request pertama sukses --
  // ditulis dalam transaksi yang sama (spec-b:350), bukan langkah terpisah.
  const rowsAfterFirst = await idempotencyKeyRow(tenant.id, key);
  assert.equal(rowsAfterFirst.length, 1, 'baris idempotency_key harus ada setelah request pertama sukses');
  assert.match(rowsAfterFirst[0].request_hash, /^[0-9a-f]{64}$/, 'request_hash harus SHA-256 hex (64 karakter)');
  const expiresAt = new Date(rowsAfterFirst[0].expires_at);
  const createdAt = new Date(rowsAfterFirst[0].created_at);
  const diffDays = (expiresAt.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
  assert.ok(diffDays > 29 && diffDays < 31, `retensi harus ~30 hari, dapat ${diffDays} hari`);

  // Retry: key SAMA, body SAMA PERSIS.
  const secondRes = await req(payload, { 'idempotency-key': key });
  const secondBody = JSON.parse(secondRes.body);
  assert.equal(secondBody.id, firstBody.id, 'respons retry harus order YANG SAMA, bukan diproses ulang');
  assert.equal(secondBody.total, firstBody.total);
  assert.equal(secondBody.checkId, firstBody.checkId);

  // TIDAK ADA order kedua -- tepat SATU baris order untuk id ini.
  assert.equal(await orderRowCount(tenant.id, payload.id), 1, 'retry tidak boleh membuat order kedua');
});

test('idempotency: key sama + request_hash BERBEDA -> 422, bukan cache hit', async () => {
  const { device, shift } = await setupDeviceAndShift();
  const key = crypto.randomUUID();
  const first = orderPayload({ deviceId: device.id, shiftId: shift.id, sequence: 1 });
  const firstRes = await req(first, { 'idempotency-key': key });
  assert.equal(firstRes.statusCode, 201, firstRes.body);

  // Body BERBEDA (order lain, quantityMilli beda) dengan key yang SAMA.
  const second = orderPayload({ deviceId: device.id, shiftId: shift.id, sequence: 2, quantityMilli: 2000 });
  const secondRes = await req(second, { 'idempotency-key': key });
  assert.equal(secondRes.statusCode, 422, secondRes.body);
  const secondBody = JSON.parse(secondRes.body);
  assert.ok(secondBody.error && secondBody.error.code, `envelope error tidak konsisten: ${secondRes.body}`);
  assert.notEqual(secondBody.id, first.id, 'respons 422 TIDAK boleh berisi order dari request lain');

  // Order KEDUA tidak pernah tersimpan.
  assert.equal(await orderRowCount(tenant.id, second.id), 0);
  // Order PERTAMA tidak terpengaruh.
  assert.equal(await orderRowCount(tenant.id, first.id), 1);
});

// ============================================================
// T11 -- konkurensi: dua request BERSAMAAN, key sama
// ============================================================

test('idempotency: dua request BERSAMAAN dengan key sama -> tepat satu berhasil, satu 409, tepat satu order tersimpan', async () => {
  const { device, shift } = await setupDeviceAndShift();
  const payload = orderPayload({ deviceId: device.id, shiftId: shift.id });
  const key = crypto.randomUUID();

  // Prewarm DUA koneksi pool BERSAMAAN sebelum race sungguhan. Tanpa ini,
  // pool (fresh per test, lihat beforeEach) hanya punya SATU koneksi idle
  // (sisa setupDeviceAndShift di atas) -- Promise.all di bawah lalu selalu
  // punya satu request yang "menang" cepat (koneksi hangat) dan satu yang
  // harus membuka koneksi TCP+auth baru (~20ms, diverifikasi lewat
  // instrumentasi manual), sehingga yang lambat SELALU baru mulai transaksi
  // SETELAH yang cepat sudah commit -- bukan race, tapi bias struktural
  // dari test, bukan dari mekanisme yang diuji. Dua GET paralel di sini
  // memaksa pool tumbuh ke DUA koneksi idle, supaya race POST di bawah
  // sungguhan bersamaan.
  await Promise.all([
    app.inject({ method: 'GET', url: orderUrl(crypto.randomUUID()), headers: { 'x-tenant-id': tenant.id } }),
    app.inject({ method: 'GET', url: orderUrl(crypto.randomUUID()), headers: { 'x-tenant-id': tenant.id } }),
  ]);

  const [resA, resB] = await Promise.all([
    req(payload, { 'idempotency-key': key }),
    req(payload, { 'idempotency-key': key }),
  ]);

  const statuses = [resA.statusCode, resB.statusCode].sort();
  assert.deepEqual(statuses, [201, 409], `harusnya satu 201 dan satu 409, dapat ${JSON.stringify(statuses)}`);

  const conflictRes = resA.statusCode === 409 ? resA : resB;
  const conflictBody = JSON.parse(conflictRes.body);
  assert.ok(conflictBody.error && conflictBody.error.code, `envelope error tidak konsisten: ${conflictRes.body}`);
  assert.equal(conflictBody.error.code, 'IDEMPOTENCY_KEY_CONFLICT');

  assert.equal(await orderRowCount(tenant.id, payload.id), 1, 'tepat satu order tersimpan, bukan nol atau dua');
});

// ============================================================
// T12 -- stress: 100x request identik -> tepat satu penjualan
// ============================================================

test('idempotency: 100x request identik (key sama) -> tepat satu penjualan (spec-b:360)', async () => {
  const { device, shift } = await setupDeviceAndShift();
  const payload = orderPayload({ deviceId: device.id, shiftId: shift.id });
  const key = crypto.randomUUID();

  const N = 100;
  const results = await Promise.all(Array.from({ length: N }, () => req(payload, { 'idempotency-key': key })));

  for (const res of results) {
    assert.ok(
      res.statusCode === 201 || res.statusCode === 409,
      `status harus 201 atau 409, dapat ${res.statusCode}: ${res.body}`
    );
  }

  const successBodies = results.filter((r) => r.statusCode === 201).map((r) => JSON.parse(r.body));
  assert.ok(successBodies.length >= 1, 'harus ada minimal satu 201 di antara 100 request');
  for (const body of successBodies) {
    assert.equal(body.id, payload.id, 'semua respons sukses harus order YANG SAMA (cache hit), bukan diproses ulang');
  }

  assert.equal(await orderRowCount(tenant.id, payload.id), 1, 'tepat SATU baris order setelah 100x request identik');

  // Penting -- TIDAK vacuous: order.id sendiri sudah PRIMARY KEY (client-
  // generated), jadi "tepat satu baris order" di atas SENDIRIAN bisa lolos
  // walau mekanisme idempotency_key sama sekali dimatikan (order kedua akan
  // tetap ditolak lewat order_pkey, bukan lewat idempotency). Baris
  // idempotency_key HARUS ada dan HARUS tepat satu -- ini yang benar-benar
  // membuktikan mekanisme T10-T12 (bukan PK order) yang bekerja di sini.
  const idemRows = await idempotencyKeyRow(tenant.id, key);
  assert.equal(idemRows.length, 1, 'tepat satu baris idempotency_key harus ada setelah 100x request identik');
  assert.equal(idemRows[0].response_status, 201);
});
