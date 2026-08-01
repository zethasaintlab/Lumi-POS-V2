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
  const base = await seedTenantBase(appSetup, { suffix: 'CatTest' });
  tenant = base.tenant;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();
});

function post(url, payload) {
  return app.inject({ method: 'POST', url, payload, headers: { 'x-tenant-id': tenant.id } });
}
function get(url) {
  return app.inject({ method: 'GET', url, headers: { 'x-tenant-id': tenant.id } });
}
function patch(url, payload) {
  return app.inject({ method: 'PATCH', url, payload, headers: { 'x-tenant-id': tenant.id } });
}

test('createCategory: kategori top-level berhasil dibuat', async () => {
  const id = crypto.randomUUID();
  const res = await post('/categories', { id, name: 'Minuman' });
  assert.equal(res.statusCode, 201);
  const body = JSON.parse(res.body);
  assert.equal(body.name, 'Minuman');
  assert.equal(body.parentId, null);
});

test('createCategory: kategori tingkat kedua (child dari top-level) berhasil', async () => {
  const topId = crypto.randomUUID();
  await post('/categories', { id: topId, name: 'Minuman' });
  const childId = crypto.randomUUID();
  const res = await post('/categories', { id: childId, name: 'Kopi', parentId: topId });
  assert.equal(res.statusCode, 201);
});

test('createCategory: kategori tingkat ketiga ditolak dengan CATEGORY_DEPTH_EXCEEDED', async () => {
  const topId = crypto.randomUUID();
  await post('/categories', { id: topId, name: 'Minuman' });
  const childId = crypto.randomUUID();
  await post('/categories', { id: childId, name: 'Kopi', parentId: topId });
  const grandchildId = crypto.randomUUID();
  const res = await post('/categories', { id: grandchildId, name: 'Espresso', parentId: childId });
  assert.equal(res.statusCode, 409);
  const body = JSON.parse(res.body);
  assert.equal(body.error.code, 'CATEGORY_DEPTH_EXCEEDED');
});

test('createCategory: parentId string kosong ditolak dengan error klien, bukan 500', async () => {
  const id = crypto.randomUUID();
  const res = await post('/categories', { id, name: 'Top', parentId: '' });
  assert.ok(res.statusCode >= 400 && res.statusCode < 500, `expected 4xx, got ${res.statusCode}`);
  const body = JSON.parse(res.body);
  assert.equal(body.error.code, 'INVALID_PARENT_ID');
});

test('archiveCategory lalu restoreCategory: archivedAt terisi lalu null lagi', async () => {
  const id = crypto.randomUUID();
  await post('/categories', { id, name: 'Snack' });
  const archived = await app.inject({ method: 'POST', url: `/categories/${id}/archive`, headers: { 'x-tenant-id': tenant.id } });
  assert.equal(archived.statusCode, 200);
  assert.notEqual(JSON.parse(archived.body).archivedAt, null);

  const restored = await app.inject({ method: 'POST', url: `/categories/${id}/restore`, headers: { 'x-tenant-id': tenant.id } });
  assert.equal(restored.statusCode, 200);
  assert.equal(JSON.parse(restored.body).archivedAt, null);
});

test('listCategories: default menyembunyikan yang diarsipkan, includeArchived=true menampilkannya', async () => {
  const id = crypto.randomUUID();
  await post('/categories', { id, name: 'Dessert' });
  await app.inject({ method: 'POST', url: `/categories/${id}/archive`, headers: { 'x-tenant-id': tenant.id } });

  const hidden = await get('/categories');
  assert.equal(JSON.parse(hidden.body).items.some((c) => c.id === id), false);

  const shown = await get('/categories?includeArchived=true');
  assert.equal(JSON.parse(shown.body).items.some((c) => c.id === id), true);
});

test('updateCategory: mengubah parentId ke kategori yang sudah punya induk ditolak', async () => {
  const topA = crypto.randomUUID();
  await post('/categories', { id: topA, name: 'A' });
  const childA = crypto.randomUUID();
  await post('/categories', { id: childA, name: 'A-child', parentId: topA });
  const topB = crypto.randomUUID();
  await post('/categories', { id: topB, name: 'B' });

  const res = await patch(`/categories/${topB}`, { parentId: childA });
  assert.equal(res.statusCode, 409);
});

test('getCategory: 404 untuk id yang tidak ada', async () => {
  const res = await get(`/categories/${crypto.randomUUID()}`);
  assert.equal(res.statusCode, 404);
});

test('updateCategory: parentId eksplisit null menghapus induk yang sudah ada', async () => {
  const topId = crypto.randomUUID();
  await post('/categories', { id: topId, name: 'Top' });
  const childId = crypto.randomUUID();
  await post('/categories', { id: childId, name: 'Child', parentId: topId });

  const res = await patch(`/categories/${childId}`, { parentId: null });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).parentId, null);
});

test('updateCategory: field yang tidak dikirim (parentId, colorHint) tidak berubah', async () => {
  const topId = crypto.randomUUID();
  await post('/categories', { id: topId, name: 'Top' });
  const childId = crypto.randomUUID();
  await post('/categories', { id: childId, name: 'Child', parentId: topId, colorHint: '#ff0000' });

  const res = await patch(`/categories/${childId}`, { sortOrder: 5 });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.parentId, topId);
  assert.equal(body.colorHint, '#ff0000');
  assert.equal(body.sortOrder, 5);
});

test('updateCategory: menjadikan diri sendiri sebagai induk ditolak', async () => {
  const topId = crypto.randomUUID();
  await post('/categories', { id: topId, name: 'Top' });

  const res = await patch(`/categories/${topId}`, { parentId: topId });
  assert.equal(res.statusCode, 409);
  const body = JSON.parse(res.body);
  assert.equal(body.error.code, 'CATEGORY_SELF_PARENT');
});

test('updateCategory: memindahkan kategori yang sudah punya anak menjadi anak kategori lain ditolak', async () => {
  const topX = crypto.randomUUID();
  await post('/categories', { id: topX, name: 'X' });
  const childC = crypto.randomUUID();
  await post('/categories', { id: childC, name: 'C', parentId: topX });
  const topY = crypto.randomUUID();
  await post('/categories', { id: topY, name: 'Y' });

  const res = await patch(`/categories/${topX}`, { parentId: topY });
  assert.equal(res.statusCode, 409);
  const body = JSON.parse(res.body);
  assert.equal(body.error.code, 'CATEGORY_DEPTH_EXCEEDED');
});

test('updateCategory: parentId string kosong ditolak dengan error klien, bukan 500', async () => {
  const topId = crypto.randomUUID();
  await post('/categories', { id: topId, name: 'Top' });

  const res = await patch(`/categories/${topId}`, { parentId: '' });
  assert.ok(res.statusCode >= 400 && res.statusCode < 500, `expected 4xx, got ${res.statusCode}`);
});
