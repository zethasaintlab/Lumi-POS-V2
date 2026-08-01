'use strict';

// Whole-branch review FIX 1: app.ts's setErrorHandler ignored err.statusCode
// and err.validation for anything that wasn't an HttpError, so every AJV
// schema-validation failure (missing required field, wrong type, out-of-
// range integer) fell through to the generic 500 branch instead of a clean
// 400 with the standard {"error":{"code","message"}} envelope. These tests
// exercise that path directly through real catalog routes (no schema
// mocking) so they also prove the openapi.yaml constraints restored in this
// same fix (minItems, enum, minimum/maximum) actually reach AJV.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');

let owner, appSetup, app, tenant;

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
  const base = await seedTenantBase(appSetup, { suffix: 'ErrHandlerTest' });
  tenant = base.tenant;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();
});

function post(url, payload) {
  return app.inject({ method: 'POST', url, payload, headers: { 'x-tenant-id': tenant.id } });
}

function assertErrorEnvelope(res, expectedStatus) {
  assert.equal(res.statusCode, expectedStatus, `expected ${expectedStatus}, got ${res.statusCode}: ${res.body}`);
  const body = JSON.parse(res.body);
  assert.ok(body.error, 'response harus punya envelope {"error": {...}}');
  assert.equal(typeof body.error.code, 'string');
  assert.equal(typeof body.error.message, 'string');
}

test('AJV: field wajib hilang (name) mengembalikan 400 dengan envelope, bukan 500', async () => {
  const res = await post('/categories', { id: crypto.randomUUID() });
  assertErrorEnvelope(res, 400);
});

test('AJV: field bertipe salah (sortOrder string) mengembalikan 400 dengan envelope, bukan 500', async () => {
  const res = await post('/categories', { id: crypto.randomUUID(), name: 'Top', sortOrder: 'bukan-angka' });
  assertErrorEnvelope(res, 400);
});

test('AJV: sortOrder di luar batas int4 mengembalikan 400 dengan envelope, bukan 500 (22003)', async () => {
  const res = await post('/categories', { id: crypto.randomUUID(), name: 'Top', sortOrder: 99999999999 });
  assertErrorEnvelope(res, 400);
});

test('AJV: createItem dengan variations kosong ditolak 400 lewat minItems, dengan envelope', async () => {
  const res = await post('/items', { id: crypto.randomUUID(), name: 'Kosong', variations: [] });
  assertErrorEnvelope(res, 400);
});

test('AJV: createModifierList dengan selectionType di luar enum ditolak 400 dengan envelope', async () => {
  const res = await post('/modifier-lists', { id: crypto.randomUUID(), name: 'X', selectionType: 'triple' });
  assertErrorEnvelope(res, 400);
});

test('malformed JSON body mengembalikan 400 dengan envelope, bukan 500', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/categories',
    headers: { 'x-tenant-id': tenant.id, 'content-type': 'application/json' },
    payload: '{ "id": "x", "name": ',
  });
  assertErrorEnvelope(res, 400);
});
