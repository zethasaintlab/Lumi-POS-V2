'use strict';

// Whole-branch review FIX 3: tenant_id is taken verbatim from X-Tenant-Id and
// inserted into every row. An unknown tenant id raises 23503 (FK violation on
// tenant(id)) on any create* whose INSERT isn't already gated by a preceding
// tenant-scoped SELECT -- untranslated, that falls through to a raw 500,
// while a *read* with the same unknown header returns a clean empty 200
// (RLS just matches 0 rows, no distinction from "tenant exists but has no
// data"). This file proves the three create* operations with no preceding
// existence guard (createCategory without parentId, createItem without
// categoryId, createModifierList) now return a clean 4xx instead of 500 for
// an unknown tenant.
//
// No seedTenantBase here on purpose: the entire point is that this tenant id
// was never inserted into `tenant` at all.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');

let owner, appSetup, app;

before(async () => {
  owner = await connectAsOwner();
  appSetup = await connectAsApp();
  await resetAll(owner);
  const { buildApp } = await import('../../apps/server/src/app.ts');
  app = await buildApp();
});

after(async () => {
  await resetAll(owner);
  await owner.end();
  await appSetup.end();
  if (app) await app.close();
});

function post(unknownTenantId, url, payload) {
  return app.inject({ method: 'POST', url, payload, headers: { 'x-tenant-id': unknownTenantId } });
}

function assertCleanClientError(res) {
  assert.ok(res.statusCode >= 400 && res.statusCode < 500, `expected 4xx, got ${res.statusCode}: ${res.body}`);
  const body = JSON.parse(res.body);
  assert.ok(body.error, 'response harus punya envelope {"error": {...}}');
  assert.equal(typeof body.error.code, 'string');
  assert.equal(typeof body.error.message, 'string');
}

test('createCategory: X-Tenant-Id tidak dikenal (tanpa parentId) ditolak 4xx bersih, bukan 500', async () => {
  const res = await post(crypto.randomUUID(), '/categories', { id: crypto.randomUUID(), name: 'Nyasar' });
  assertCleanClientError(res);
});

test('createItem: X-Tenant-Id tidak dikenal (tanpa categoryId) ditolak 4xx bersih, bukan 500', async () => {
  const res = await post(crypto.randomUUID(), '/items', {
    id: crypto.randomUUID(),
    name: 'Nyasar',
    variations: [{ id: crypto.randomUUID(), price: 1000 }],
  });
  assertCleanClientError(res);
});

test('createModifierList: X-Tenant-Id tidak dikenal ditolak 4xx bersih, bukan 500', async () => {
  const res = await post(crypto.randomUUID(), '/modifier-lists', {
    id: crypto.randomUUID(),
    name: 'Nyasar',
    selectionType: 'single',
  });
  assertCleanClientError(res);
});
