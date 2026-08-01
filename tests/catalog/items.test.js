'use strict';

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
  const base = await seedTenantBase(appSetup, { suffix: 'ItemTest' });
  tenant = base.tenant;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();
});

function req(method, url, payload) {
  return app.inject({ method, url, payload, headers: { 'x-tenant-id': tenant.id } });
}

test('createItem: item dengan 1 variation berhasil, image_url tidak muncul di response', async () => {
  const itemId = crypto.randomUUID();
  const varId = crypto.randomUUID();
  const res = await req('POST', '/items', {
    id: itemId,
    name: 'Kopi Susu',
    variations: [{ id: varId, price: 25000 }],
  });
  assert.equal(res.statusCode, 201);
  const body = JSON.parse(res.body);
  assert.equal(body.variations.length, 1);
  assert.equal(body.variations[0].name, 'Regular');
  assert.equal(body.variations[0].price, 25000);
  assert.equal(body.variations[0].sortOrder, 0);
  assert.equal('imageUrl' in body, false);
  assert.equal('image_url' in body, false);
});

test('createItem: tanpa variation ditolak dengan ITEM_NO_VARIATION', async () => {
  const res = await req('POST', '/items', { id: crypto.randomUUID(), name: 'Kosong', variations: [] });
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error.code, 'ITEM_NO_VARIATION');
});

test('createItemVariation: variation kedua mendapat sortOrder 1', async () => {
  const itemId = crypto.randomUUID();
  await req('POST', '/items', { id: itemId, name: 'Teh', variations: [{ id: crypto.randomUUID(), price: 10000 }] });
  const res = await req('POST', `/items/${itemId}/variations`, { id: crypto.randomUUID(), name: 'Large', price: 15000 });
  assert.equal(res.statusCode, 201);
  assert.equal(JSON.parse(res.body).sortOrder, 1);
});

test('createItemVariation: barcode duplikat ditolak dengan BARCODE_DUPLICATE', async () => {
  const itemId = crypto.randomUUID();
  await req('POST', '/items', {
    id: itemId,
    name: 'Roti',
    variations: [{ id: crypto.randomUUID(), price: 8000, barcode: 'BC-001' }],
  });
  const res = await req('POST', `/items/${itemId}/variations`, { id: crypto.randomUUID(), price: 9000, barcode: 'BC-001' });
  assert.equal(res.statusCode, 409);
  assert.equal(JSON.parse(res.body).error.code, 'BARCODE_DUPLICATE');
});

test('updateItemVariation: tidak menerima field price sama sekali (skema tidak mendeklarasikannya)', async () => {
  const itemId = crypto.randomUUID();
  const varId = crypto.randomUUID();
  await req('POST', '/items', { id: itemId, name: 'Kue', variations: [{ id: varId, price: 12000 }] });
  const res = await req('PATCH', `/items/${itemId}/variations/${varId}`, { name: 'Kue Renamed', price: 99999 });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.name, 'Kue Renamed');
  assert.equal(body.price, 12000, 'price tidak boleh berubah lewat PATCH ini, extra field price di body diabaikan');
});

test('archiveItem tidak ikut meng-archive variation-nya', async () => {
  const itemId = crypto.randomUUID();
  const varId = crypto.randomUUID();
  await req('POST', '/items', { id: itemId, name: 'Jus', variations: [{ id: varId, price: 15000 }] });
  await req('POST', `/items/${itemId}/archive`);
  const res = await req('GET', `/items/${itemId}`);
  const body = JSON.parse(res.body);
  assert.notEqual(body.archivedAt, null);
  assert.equal(body.variations[0].archivedAt, null);
});

test('archiveItemVariation: satu variation diarsipkan, item tetap aktif', async () => {
  const itemId = crypto.randomUUID();
  const var1 = crypto.randomUUID();
  await req('POST', '/items', { id: itemId, name: 'Es Krim', variations: [{ id: var1, price: 20000 }] });
  const var2Res = await req('POST', `/items/${itemId}/variations`, { id: crypto.randomUUID(), price: 25000 });
  const var2 = JSON.parse(var2Res.body).id;

  await req('POST', `/items/${itemId}/variations/${var2}/archive`);
  const itemRes = await req('GET', `/items/${itemId}`);
  const body = JSON.parse(itemRes.body);
  assert.equal(body.archivedAt, null);
  const archivedVar = body.variations.find((v) => v.id === var2);
  assert.notEqual(archivedVar.archivedAt, null);
});

// --- K1/K2: koreksi audit terhadap plan lama (lihat task-3-brief.md) ---

test('createItem: harga negatif ditolak 400 VALIDATION_ERROR', async () => {
  const res = await req('POST', '/items', {
    id: crypto.randomUUID(),
    name: 'Rusak',
    variations: [{ id: crypto.randomUUID(), price: -1 }],
  });
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error.code, 'VALIDATION_ERROR');
});

test('createItemVariation: harga negatif ditolak 400 VALIDATION_ERROR', async () => {
  const itemId = crypto.randomUUID();
  await req('POST', '/items', { id: itemId, name: 'Kopi', variations: [{ id: crypto.randomUUID(), price: 1000 }] });
  const res = await req('POST', `/items/${itemId}/variations`, { id: crypto.randomUUID(), price: -5 });
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error.code, 'VALIDATION_ERROR');
});

// spec-a-katalog.md § A.7: "Variation ke-251 | Ditolak dengan pesan; batas 250"
test('createItemVariation: variation ke-251 ditolak VARIATION_LIMIT_EXCEEDED', async () => {
  const itemId = crypto.randomUUID();
  const first = crypto.randomUUID();
  await req('POST', '/items', { id: itemId, name: 'Banyak', variations: [{ id: first, price: 1000 }] });
  for (let i = 2; i <= 250; i += 1) {
    const res = await req('POST', `/items/${itemId}/variations`, { id: crypto.randomUUID(), price: 1000 });
    assert.equal(res.statusCode, 201, `variation ke-${i} seharusnya diterima`);
  }
  const res251 = await req('POST', `/items/${itemId}/variations`, { id: crypto.randomUUID(), price: 1000 });
  assert.equal(res251.statusCode, 409);
  assert.equal(JSON.parse(res251.body).error.code, 'VARIATION_LIMIT_EXCEEDED');
});
