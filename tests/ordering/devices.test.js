'use strict';

// T0b -- POST /devices (modul identity), menutup FR-B6
// (docs/superpowers/plans/PLAN-ordering-fondasi.md §T0b). Pola test SAMA
// PERSIS dengan tests/catalog/prices.test.js: seedTenantBase dua kali untuk
// skenario lintas tenant, appSetup dipakai untuk pembuktian langsung ke DB
// (BEGIN/set_config/COMMIT) supaya SELECT itu sendiri tunduk RLS -- bukan
// lumi_owner, yang (lihat tests/isolation/helpers/reset.js) juga tidak bisa
// bypass RLS untuk SELECT/INSERT/UPDATE/DELETE (hanya TRUNCATE yang bebas
// RLS). "Tidak ada baris tersimpan" SELALU dibuktikan lewat client yang
// app.tenant_id-nya sudah di-SET LOCAL ke tenant PEMANGGIL (base.tenant.id)
// -- itulah tenant_id yang akan tersimpan di baris device kalau bug F1 (FK
// bukan RLS) muncul lagi di sini.

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
  base = await seedTenantBase(appSetup, { suffix: 'DeviceTest' });
  tenant = base.tenant;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();
});

function devicesUrl() {
  return '/devices';
}

function revokeUrl(deviceId) {
  return `/devices/${deviceId}/revoke`;
}

function req(method, url, payload, headers = {}) {
  return app.inject({
    method,
    url,
    payload,
    headers: { 'x-tenant-id': tenant.id, authorization: base.authHeader, ...headers },
  });
}

// Outlet kedua dalam tenant yang sama -- dibutuhkan untuk kasus "kode sama
// di outlet berbeda diterima". Tidak ada endpoint POST /outlets di modul
// tenancy (di luar scope), insert langsung lewat appSetup, pola sama dengan
// tests/catalog/prices.test.js:insertOutlet.
async function insertOutlet(suffix) {
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  const { rows } = await appSetup.query(
    `INSERT INTO outlet (id, tenant_id, name, timezone, vertical_profile_id)
     VALUES ($1, $2, $3, 'Asia/Jakarta', $4) RETURNING *`,
    [crypto.randomUUID(), tenant.id, `Outlet ${suffix}`, base.vertical_profile.id]
  );
  await appSetup.query('COMMIT');
  return rows[0];
}

// Membuktikan langsung ke DB bahwa TIDAK ADA baris device dengan id
// tertentu tersimpan untuk tenant pemanggil. Status code saja tidak cukup
// (bug F1: createItem pernah mengembalikan 201 SAMBIL menyimpan baris yang
// salah -- dibuktikan ulang untuk price_history.outlet_id 2 Agustus 2026).
async function assertNoDeviceRowSaved(callerTenantId, deviceId) {
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [callerTenantId]);
  const { rows } = await appSetup.query('SELECT id FROM device WHERE id = $1', [deviceId]);
  await appSetup.query('COMMIT');
  assert.equal(rows.length, 0, 'tidak boleh ada baris device tersimpan untuk request yang ditolak');
}

// --- jalur bahagia ---

test('createDevice: jalur bahagia, 201, baris tersimpan', async () => {
  const deviceId = crypto.randomUUID();
  const res = await req('POST', devicesUrl(), {
    id: deviceId,
    outletId: base.outlet.id,
    code: 'K1',
    name: 'Kasir Depan',
    platform: 'tauri',
    appVersion: '1.0.0',
  });
  assert.equal(res.statusCode, 201, res.body);
  const body = JSON.parse(res.body);
  assert.equal(body.id, deviceId);
  assert.equal(body.outletId, base.outlet.id);
  assert.equal(body.code, 'K1');
  assert.equal(body.name, 'Kasir Depan');
  assert.equal(body.platform, 'tauri');
  assert.equal(body.appVersion, '1.0.0');
  assert.equal(body.revokedAt, null);
});

// --- FR-B6 AC: kode duplikat di outlet yang sama ditolak, pesan menyebut
// device pemakai ---

test('createDevice: kode duplikat di outlet yang sama ditolak 409 CODE_TAKEN, pesan menyebut device pemakai', async () => {
  const firstId = crypto.randomUUID();
  const first = await req('POST', devicesUrl(), {
    id: firstId,
    outletId: base.outlet.id,
    code: 'K1',
    name: 'Kasir Lama',
  });
  assert.equal(first.statusCode, 201, first.body);

  const secondId = crypto.randomUUID();
  const res = await req('POST', devicesUrl(), {
    id: secondId,
    outletId: base.outlet.id,
    code: 'K1',
    name: 'Kasir Baru',
  });
  assert.equal(res.statusCode, 409, res.body);
  const body = JSON.parse(res.body);
  assert.equal(body.error.code, 'CODE_TAKEN');
  assert.ok(
    body.error.message.includes(firstId) || body.error.message.includes('Kasir Lama'),
    `pesan penolakan harus menyebut device yang sudah memakai kode (spec-b:214): ${body.error.message}`
  );

  await assertNoDeviceRowSaved(tenant.id, secondId);
});

// --- FR-B6 AC: kode dapat dipakai ulang setelah pencabutan ---

test('createDevice: kode dapat dipakai ulang setelah device lama dicabut', async () => {
  const firstId = crypto.randomUUID();
  const first = await req('POST', devicesUrl(), { id: firstId, outletId: base.outlet.id, code: 'K1' });
  assert.equal(first.statusCode, 201, first.body);

  const revokeRes = await req('POST', revokeUrl(firstId));
  assert.equal(revokeRes.statusCode, 200, revokeRes.body);
  const revokedBody = JSON.parse(revokeRes.body);
  assert.ok(revokedBody.revokedAt, 'revokedAt harus terisi setelah pencabutan');

  const secondId = crypto.randomUUID();
  const res = await req('POST', devicesUrl(), { id: secondId, outletId: base.outlet.id, code: 'K1' });
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(JSON.parse(res.body).code, 'K1');
});

// --- FR-B6 AC: constraint unik per outlet, bukan per tenant ---

test('createDevice: kode sama di outlet berbeda diterima', async () => {
  const outletB = await insertOutlet('DeviceTestB');
  const firstId = crypto.randomUUID();
  const first = await req('POST', devicesUrl(), { id: firstId, outletId: base.outlet.id, code: 'K1' });
  assert.equal(first.statusCode, 201, first.body);

  const secondId = crypto.randomUUID();
  const res = await req('POST', devicesUrl(), { id: secondId, outletId: outletB.id, code: 'K1' });
  assert.equal(res.statusCode, 201, res.body);
});

// --- guard lintas tenant: outletId ---

test('createDevice: outletId milik tenant lain ditolak 404, tidak ada baris tersimpan', async () => {
  const otherBase = await seedTenantBase(appSetup, { suffix: 'DeviceTestOtherOutlet' });
  const deviceId = crypto.randomUUID();
  const res = await req('POST', devicesUrl(), { id: deviceId, outletId: otherBase.outlet.id, code: 'K1' });
  assert.equal(res.statusCode, 404, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'OUTLET_NOT_FOUND');

  await assertNoDeviceRowSaved(tenant.id, deviceId);
});

// --- retry offline: id sama dikirim ulang ---

test('createDevice: id yang sama dikirim ulang (retry offline) ditolak 409 ID_ALREADY_EXISTS', async () => {
  const deviceId = crypto.randomUUID();
  const payload = { id: deviceId, outletId: base.outlet.id, code: 'K1' };

  const first = await req('POST', devicesUrl(), payload);
  assert.equal(first.statusCode, 201, first.body);

  const retry = await req('POST', devicesUrl(), payload);
  assert.equal(retry.statusCode, 409, retry.body);
  assert.equal(JSON.parse(retry.body).error.code, 'ID_ALREADY_EXISTS');

  // Bukti yang sebenarnya penting: tepat SATU baris, bukan dua.
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  const { rows } = await appSetup.query('SELECT id FROM device WHERE id = $1', [deviceId]);
  await appSetup.query('COMMIT');
  assert.equal(rows.length, 1, 'retry tidak boleh menghasilkan baris device kedua');
});

// --- revokeDevice: jalur bahagia dan lintas tenant ---

test('revokeDevice: device tidak ditemukan (lintas tenant) ditolak 404', async () => {
  const otherBase = await seedTenantBase(appSetup, { suffix: 'DeviceTestRevokeOther' });
  const otherDeviceId = crypto.randomUUID();
  const otherDeviceRes = await app.inject({
    method: 'POST',
    url: devicesUrl(),
    payload: { id: otherDeviceId, outletId: otherBase.outlet.id, code: 'K1' },
    headers: { 'x-tenant-id': otherBase.tenant.id , authorization: otherBase.authHeader},
  });
  assert.equal(otherDeviceRes.statusCode, 201, otherDeviceRes.body);

  const res = await req('POST', revokeUrl(otherDeviceId));
  assert.equal(res.statusCode, 404, res.body);
});
