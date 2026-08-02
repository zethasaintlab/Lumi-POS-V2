'use strict';

// T0c -- POST /shifts (modul cash BARU), buka shift saja
// (docs/superpowers/plans/PLAN-ordering-fondasi.md §T0c, keputusan Q1 di
// PLAN-ordering-fondasi.md §8.0). Pola test SAMA PERSIS dengan
// tests/catalog/prices.test.js dan tests/ordering/devices.test.js.
//
// Device fixture dibuat lewat endpoint POST /devices sungguhan (T0b), bukan
// insert langsung -- supaya jalur yang dites persis jalur yang dipakai
// klien nyata, dan supaya test "deviceId lintas tenant" membuktikan
// assertDeviceVisible, bukan sekadar RLS pada tabel device sendiri.

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
  base = await seedTenantBase(appSetup, { suffix: 'ShiftTest' });
  tenant = base.tenant;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();
});

const BUSINESS_DATE = '2026-08-02';

function shiftsUrl() {
  return '/shifts';
}

function req(method, url, payload, headers = {}) {
  return app.inject({
    method,
    url,
    payload,
    headers: { 'x-tenant-id': tenant.id, 'x-actor-id': base.user.id, ...headers },
  });
}

// Dibuat lewat endpoint device T0b yang sudah ada, bukan insert langsung.
async function createDevice(outletId, code, headers = {}) {
  const deviceId = crypto.randomUUID();
  const res = await app.inject({
    method: 'POST',
    url: '/devices',
    payload: { id: deviceId, outletId, code },
    headers: { 'x-tenant-id': tenant.id, ...headers },
  });
  assert.equal(res.statusCode, 201, `gagal membuat device persiapan test: ${res.body}`);
  return JSON.parse(res.body);
}

// Membuktikan langsung ke DB bahwa TIDAK ADA baris cash_drawer_shift dengan
// id tertentu tersimpan untuk tenant pemanggil. Status code saja tidak
// cukup (temuan F1, dibuktikan berulang di repo ini).
async function assertNoShiftRowSaved(callerTenantId, shiftId) {
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [callerTenantId]);
  const { rows } = await appSetup.query('SELECT id FROM cash_drawer_shift WHERE id = $1', [shiftId]);
  await appSetup.query('COMMIT');
  assert.equal(rows.length, 0, 'tidak boleh ada baris cash_drawer_shift tersimpan untuk request yang ditolak');
}

// --- jalur bahagia ---

test('openShift: jalur bahagia, 201, status open, openingFloat tersimpan', async () => {
  const device = await createDevice(base.outlet.id, 'K1');
  const shiftId = crypto.randomUUID();
  const res = await req('POST', shiftsUrl(), {
    id: shiftId,
    outletId: base.outlet.id,
    deviceId: device.id,
    businessDate: BUSINESS_DATE,
    openingFloat: 100000,
  });
  assert.equal(res.statusCode, 201, res.body);
  const body = JSON.parse(res.body);
  assert.equal(body.id, shiftId);
  assert.equal(body.outletId, base.outlet.id);
  assert.equal(body.deviceId, device.id);
  assert.equal(body.businessDate, BUSINESS_DATE);
  assert.equal(body.status, 'open');
  assert.equal(body.openingFloat, 100000);
  assert.equal(body.openedBy, base.user.id, 'openedBy harus terisi dari X-Actor-Id yang tervalidasi');
  assert.ok(body.openedAt);
});

// --- validasi businessDate ---
//
// Konvensi repo ini (dipegang sejak Modul A): input klien yang buruk
// menghasilkan 4xx dengan envelope {error:{code,message}}, TIDAK PERNAH 500
// mentah dari cast error PostgreSQL. Tanggal bisnis penting khusus karena ia
// menentukan penomoran struk dan batas hari kas -- salah ketik di sini bukan
// kesalahan yang boleh muncul sebagai "Terjadi kesalahan internal".
//
// Kedua kasus di bawah SUDAH tertutup tanpa kode tambahan: `format: date` di
// openapi.yaml ditegakkan AJV dalam mode penuh, jadi `2026-02-30` dan
// `2026-13-01` ikut ditolak, bukan hanya string yang bentuknya kacau.
// Diverifikasi empiris 2 Agu 2026, bukan diasumsikan.
//
// Test ini karena itu adalah PENJAGA REGRESI, bukan perbaikan bug: ia
// mengunci perilaku yang saat ini hanya dijamin oleh mode format AJV.
// Mengganti ajv ke mode "fast" (regex saja) akan meloloskan 2026-02-30 ke
// PostgreSQL dan menghasilkan 500 -- test ini yang akan menangkapnya.

test('openShift: businessDate bukan tanggal ditolak 4xx bersih, bukan 500', async () => {
  const device = await createDevice(base.outlet.id, 'K1');
  const res = await req('POST', shiftsUrl(), {
    id: crypto.randomUUID(),
    outletId: base.outlet.id,
    deviceId: device.id,
    businessDate: 'bukan-tanggal',
    openingFloat: 100000,
  });
  assert.ok(res.statusCode >= 400 && res.statusCode < 500, `harusnya 4xx, dapat ${res.statusCode}: ${res.body}`);
  const body = JSON.parse(res.body);
  assert.ok(body.error && body.error.code, `envelope error tidak konsisten: ${res.body}`);
});

test('openShift: businessDate 2026-02-30 (bentuk benar, tanggal tidak ada) ditolak 4xx bersih, bukan 500', async () => {
  const device = await createDevice(base.outlet.id, 'K1');
  const res = await req('POST', shiftsUrl(), {
    id: crypto.randomUUID(),
    outletId: base.outlet.id,
    deviceId: device.id,
    businessDate: '2026-02-30',
    openingFloat: 100000,
  });
  assert.ok(res.statusCode >= 400 && res.statusCode < 500, `harusnya 4xx, dapat ${res.statusCode}: ${res.body}`);
  const body = JSON.parse(res.body);
  assert.ok(body.error && body.error.code, `envelope error tidak konsisten: ${res.body}`);
});

// --- validasi openingFloat: uang = bigint rupiah utuh, tidak pernah float ---

test('openShift: openingFloat negatif ditolak 400 VALIDATION_ERROR', async () => {
  const device = await createDevice(base.outlet.id, 'K1');
  const res = await req('POST', shiftsUrl(), {
    id: crypto.randomUUID(),
    outletId: base.outlet.id,
    deviceId: device.id,
    businessDate: BUSINESS_DATE,
    openingFloat: -1,
  });
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'VALIDATION_ERROR');
});

test('openShift: openingFloat non-integer (1000.5) ditolak 400 VALIDATION_ERROR', async () => {
  const device = await createDevice(base.outlet.id, 'K1');
  const res = await req('POST', shiftsUrl(), {
    id: crypto.randomUUID(),
    outletId: base.outlet.id,
    deviceId: device.id,
    businessDate: BUSINESS_DATE,
    openingFloat: 1000.5,
  });
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'VALIDATION_ERROR');
});

test('openShift: openingFloat bukan angka (string) ditolak 400 VALIDATION_ERROR', async () => {
  const device = await createDevice(base.outlet.id, 'K1');
  const res = await req('POST', shiftsUrl(), {
    id: crypto.randomUUID(),
    outletId: base.outlet.id,
    deviceId: device.id,
    businessDate: BUSINESS_DATE,
    openingFloat: 'banyak',
  });
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'VALIDATION_ERROR');
});

test('openShift: openingFloat 0 diterima (kas kosong di awal shift bukan error)', async () => {
  const device = await createDevice(base.outlet.id, 'K1');
  const res = await req('POST', shiftsUrl(), {
    id: crypto.randomUUID(),
    outletId: base.outlet.id,
    deviceId: device.id,
    businessDate: BUSINESS_DATE,
    openingFloat: 0,
  });
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(JSON.parse(res.body).openingFloat, 0);
});

// --- dua shift open untuk satu device ---

test('openShift: dua shift open untuk satu device ditolak 409 SHIFT_ALREADY_OPEN, tidak ada baris kedua tersimpan', async () => {
  const device = await createDevice(base.outlet.id, 'K1');
  const first = await req('POST', shiftsUrl(), {
    id: crypto.randomUUID(),
    outletId: base.outlet.id,
    deviceId: device.id,
    businessDate: BUSINESS_DATE,
    openingFloat: 50000,
  });
  assert.equal(first.statusCode, 201, first.body);

  const secondId = crypto.randomUUID();
  const second = await req('POST', shiftsUrl(), {
    id: secondId,
    outletId: base.outlet.id,
    deviceId: device.id,
    businessDate: BUSINESS_DATE,
    openingFloat: 50000,
  });
  assert.equal(second.statusCode, 409, second.body);
  assert.equal(JSON.parse(second.body).error.code, 'SHIFT_ALREADY_OPEN');

  await assertNoShiftRowSaved(tenant.id, secondId);
});

// --- guard lintas tenant: outletId ---

test('openShift: outletId milik tenant lain ditolak 404, tidak ada baris tersimpan', async () => {
  const otherBase = await seedTenantBase(appSetup, { suffix: 'ShiftTestOtherOutlet' });
  const device = await createDevice(base.outlet.id, 'K1');
  const shiftId = crypto.randomUUID();
  const res = await req('POST', shiftsUrl(), {
    id: shiftId,
    outletId: otherBase.outlet.id,
    deviceId: device.id,
    businessDate: BUSINESS_DATE,
    openingFloat: 50000,
  });
  assert.equal(res.statusCode, 404, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'OUTLET_NOT_FOUND');

  await assertNoShiftRowSaved(tenant.id, shiftId);
});

// --- guard lintas tenant: deviceId (assertDeviceVisible, guard BARU) ---

test('openShift: deviceId milik tenant lain ditolak 404 DEVICE_NOT_FOUND, tidak ada baris tersimpan', async () => {
  const otherBase = await seedTenantBase(appSetup, { suffix: 'ShiftTestOtherDevice' });
  const otherDeviceId = crypto.randomUUID();
  const otherDeviceRes = await app.inject({
    method: 'POST',
    url: '/devices',
    payload: { id: otherDeviceId, outletId: otherBase.outlet.id, code: 'K1' },
    headers: { 'x-tenant-id': otherBase.tenant.id },
  });
  assert.equal(otherDeviceRes.statusCode, 201, otherDeviceRes.body);

  const shiftId = crypto.randomUUID();
  const res = await req('POST', shiftsUrl(), {
    id: shiftId,
    outletId: base.outlet.id,
    deviceId: otherDeviceId,
    businessDate: BUSINESS_DATE,
    openingFloat: 50000,
  });
  assert.equal(res.statusCode, 404, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'DEVICE_NOT_FOUND');

  await assertNoShiftRowSaved(tenant.id, shiftId);
});

// --- guard lintas tenant: aktor (X-Actor-Id) ---

test('openShift: aktor (X-Actor-Id) milik tenant lain ditolak 404 ACTOR_NOT_FOUND, tidak ada baris tersimpan', async () => {
  const otherBase = await seedTenantBase(appSetup, { suffix: 'ShiftTestOtherActor' });
  const device = await createDevice(base.outlet.id, 'K1');
  const shiftId = crypto.randomUUID();
  const res = await req(
    'POST',
    shiftsUrl(),
    {
      id: shiftId,
      outletId: base.outlet.id,
      deviceId: device.id,
      businessDate: BUSINESS_DATE,
      openingFloat: 50000,
    },
    { 'x-actor-id': otherBase.user.id }
  );
  assert.equal(res.statusCode, 404, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'ACTOR_NOT_FOUND');

  await assertNoShiftRowSaved(tenant.id, shiftId);
});

// --- retry offline: id sama dikirim ulang ---

test('openShift: id yang sama dikirim ulang (retry offline) ditolak 409 ID_ALREADY_EXISTS', async () => {
  const device = await createDevice(base.outlet.id, 'K1');
  const shiftId = crypto.randomUUID();
  const payload = {
    id: shiftId,
    outletId: base.outlet.id,
    deviceId: device.id,
    businessDate: BUSINESS_DATE,
    openingFloat: 50000,
  };

  const first = await req('POST', shiftsUrl(), payload);
  assert.equal(first.statusCode, 201, first.body);

  const retry = await req('POST', shiftsUrl(), payload);
  assert.equal(retry.statusCode, 409, retry.body);
  assert.equal(
    JSON.parse(retry.body).error.code,
    'ID_ALREADY_EXISTS',
    'retry id sama HARUS dibedakan dari SHIFT_ALREADY_OPEN (device ini memang sudah punya shift open dari request pertama, tapi itu bukan alasan penolakan retry ini)'
  );

  // Bukti yang sebenarnya penting: tepat SATU baris, bukan dua.
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  const { rows } = await appSetup.query('SELECT id FROM cash_drawer_shift WHERE id = $1', [shiftId]);
  await appSetup.query('COMMIT');
  assert.equal(rows.length, 1, 'retry tidak boleh menghasilkan baris shift kedua');
});

// --- header X-Actor-Id hilang ---

test('openShift: header X-Actor-Id hilang ditolak 400 MISSING_ACTOR_ID', async () => {
  const device = await createDevice(base.outlet.id, 'K1');
  const res = await app.inject({
    method: 'POST',
    url: shiftsUrl(),
    payload: {
      id: crypto.randomUUID(),
      outletId: base.outlet.id,
      deviceId: device.id,
      businessDate: BUSINESS_DATE,
      openingFloat: 50000,
    },
    headers: { 'x-tenant-id': tenant.id },
  });
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'MISSING_ACTOR_ID');
});
