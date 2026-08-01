'use strict';

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
  base = await seedTenantBase(appSetup, { suffix: 'ModTest' });
  tenant = base.tenant;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();
});

function req(method, url, payload) {
  return app.inject({ method, url, payload, headers: { 'x-tenant-id': tenant.id } });
}

// --- plan lama Task 4 Step 5 ---

test('createModifierList + createModifier: modifier bertaut ke list yang benar', async () => {
  const listId = crypto.randomUUID();
  await req('POST', '/modifier-lists', { id: listId, name: 'Extra', selectionType: 'multi', maxSelections: 3 });
  const modId = crypto.randomUUID();
  const res = await req('POST', `/modifier-lists/${listId}/modifiers`, { id: modId, name: 'Extra Shot', price: 5000 });
  assert.equal(res.statusCode, 201);
  const body = JSON.parse(res.body);
  assert.equal(body.modifierListId, listId);
  assert.equal(body.sortOrder, 0);
});

test('updateModifier: price bisa diubah langsung (beda dari item_variation)', async () => {
  const listId = crypto.randomUUID();
  await req('POST', '/modifier-lists', { id: listId, name: 'Extra', selectionType: 'single' });
  const modId = crypto.randomUUID();
  await req('POST', `/modifier-lists/${listId}/modifiers`, { id: modId, name: 'Oat Milk', price: 8000 });
  const res = await req('PATCH', `/modifier-lists/${listId}/modifiers/${modId}`, { price: 10000 });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).price, 10000);
});

test('archiveModifierList lalu restoreModifierList', async () => {
  const listId = crypto.randomUUID();
  await req('POST', '/modifier-lists', { id: listId, name: 'Temp', selectionType: 'single' });
  const archived = await req('POST', `/modifier-lists/${listId}/archive`);
  assert.equal(archived.statusCode, 200);
  assert.notEqual(JSON.parse(archived.body).archivedAt, null);
  const restored = await req('POST', `/modifier-lists/${listId}/restore`);
  assert.equal(restored.statusCode, 200);
  assert.equal(JSON.parse(restored.body).archivedAt, null);
});

test('createModifier: 404 kalau modifierListId tidak ada', async () => {
  const res = await req('POST', `/modifier-lists/${crypto.randomUUID()}/modifiers`, { id: crypto.randomUUID(), name: 'X' });
  assert.equal(res.statusCode, 404);
  assert.equal(JSON.parse(res.body).error.code, 'NOT_FOUND');
});

// --- brief task-4-brief.md: dua path archive/restore Modifier yang terlewat
// di Step 1 plan lama (ditambahkan lewat Step 3) -- wajib ada rute DAN teste,
// bukan cuma handler yang tidak pernah diakses lewat HTTP. ---

test('archiveModifier lalu restoreModifier', async () => {
  const listId = crypto.randomUUID();
  await req('POST', '/modifier-lists', { id: listId, name: 'Gula', selectionType: 'single' });
  const modId = crypto.randomUUID();
  await req('POST', `/modifier-lists/${listId}/modifiers`, { id: modId, name: 'Normal', price: 0 });

  const archived = await req('POST', `/modifier-lists/${listId}/modifiers/${modId}/archive`);
  assert.equal(archived.statusCode, 200);
  const archivedBody = JSON.parse(archived.body);
  assert.notEqual(archivedBody.archivedAt, null);
  assert.equal(archivedBody.id, modId);

  const restored = await req('POST', `/modifier-lists/${listId}/modifiers/${modId}/restore`);
  assert.equal(restored.statusCode, 200);
  assert.equal(JSON.parse(restored.body).archivedAt, null);
});

test('archiveModifier: 404 kalau modifierId tidak ada di list tersebut', async () => {
  const listId = crypto.randomUUID();
  await req('POST', '/modifier-lists', { id: listId, name: 'Gula', selectionType: 'single' });
  const res = await req('POST', `/modifier-lists/${listId}/modifiers/${crypto.randomUUID()}/archive`);
  assert.equal(res.statusCode, 404);
});

// --- brief: AC spec-a-katalog.md § FR-A1 -- "Modifier tidak memiliki kolom
// sku maupun track_stock" (nilai persis dari task-4-brief.md § 4.1) ---

test('response Modifier tidak pernah membawa sku atau trackStock', async () => {
  const listId = crypto.randomUUID();
  await req('POST', '/modifier-lists', { id: listId, name: 'Extra', selectionType: 'multi' });
  const res = await req('POST', `/modifier-lists/${listId}/modifiers`, {
    id: crypto.randomUUID(), name: 'Extra Shot', price: 5000,
  });
  const body = JSON.parse(res.body);
  assert.equal('sku' in body, false);
  assert.equal('trackStock' in body, false);
});

// --- L7: modifier.modifier_list_id REFERENCES modifier_list(id) TIDAK
// tunduk RLS -- pengecekan FK Postgres berjalan dengan hak pemilik tabel,
// bukan peran yang dibatasi RLS (dikonfirmasi empiris di Task 3 untuk
// item.category_id, bentuknya identik di sini untuk modifier_list_id). Guard
// yang benar (fetchModifierListOrThrow, SELECT lewat client yang terikat
// withTenantTransaction) harus menolak SEBELUM baris modifier sempat
// ter-INSERT. Assersi tingkat DB di bawah TIDAK bersyarat -- harus selalu
// jalan, supaya "response 404 tapi datanya diam-diam tersimpan" tertangkap
// juga (skenario dead-assertion yang pernah lolos di items.test.js). ---

test('createModifier: modifierListId lintas tenant ditolak 404, dan tidak ada baris modifier tersimpan', async () => {
  const otherBase = await seedTenantBase(appSetup, { suffix: 'ModTestOther' });
  const attackerTenantId = otherBase.tenant.id;

  const listId = crypto.randomUUID();
  await req('POST', '/modifier-lists', { id: listId, name: 'Milik Tenant A', selectionType: 'single' });

  const res = await app.inject({
    method: 'POST',
    url: `/modifier-lists/${listId}/modifiers`,
    payload: { id: crypto.randomUUID(), name: 'Nyelundup', price: 1000 },
    headers: { 'x-tenant-id': attackerTenantId },
  });
  assert.equal(res.statusCode, 404);
  assert.equal(JSON.parse(res.body).error.code, 'NOT_FOUND');

  // Bukti tingkat DB, TANPA syarat `if` -- kalau (bug) request di atas balik
  // 201, baris modifier TETAP tidak boleh ada. Dicek dalam konteks RLS milik
  // tenant penyerang (attackerTenantId) karena kalau app bug menyimpan baris,
  // tenant_id modifier itu akan ikut tenantId pemanggil (si penyerang), bukan
  // tenant pemilik list -- jadi baris "bocor" itu hanya kelihatan di sini.
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [attackerTenantId]);
  const { rows } = await appSetup.query('SELECT * FROM modifier WHERE modifier_list_id = $1', [listId]);
  await appSetup.query('COMMIT');
  assert.equal(rows.length, 0, 'tidak boleh ada baris modifier tersimpan lintas tenant, apa pun status responsnya');
});

// --- K1/K2 style: koreksi audit terhadap plan lama (lihat task-4-brief.md
// L7 dan bagian "Binding constraints" -- validasi harus sama di create DAN
// update, harga negatif ditolak, selectionType divalidasi terhadap CHECK). ---

test('createModifierList: selectionType tidak valid ditolak 400 VALIDATION_ERROR', async () => {
  const res = await req('POST', '/modifier-lists', { id: crypto.randomUUID(), name: 'Rusak', selectionType: 'triple' });
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error.code, 'VALIDATION_ERROR');
});

test('updateModifierList: selectionType tidak valid ditolak 400 VALIDATION_ERROR (sama dengan create)', async () => {
  const listId = crypto.randomUUID();
  await req('POST', '/modifier-lists', { id: listId, name: 'Aman', selectionType: 'single' });
  const res = await req('PATCH', `/modifier-lists/${listId}`, { selectionType: 'triple' });
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error.code, 'VALIDATION_ERROR');
});

test('createModifier: harga negatif ditolak 400 VALIDATION_ERROR', async () => {
  const listId = crypto.randomUUID();
  await req('POST', '/modifier-lists', { id: listId, name: 'Extra', selectionType: 'multi' });
  const res = await req('POST', `/modifier-lists/${listId}/modifiers`, { id: crypto.randomUUID(), name: 'Rusak', price: -1 });
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error.code, 'VALIDATION_ERROR');
});

test('updateModifier: harga negatif ditolak 400 VALIDATION_ERROR (sama dengan create)', async () => {
  const listId = crypto.randomUUID();
  await req('POST', '/modifier-lists', { id: listId, name: 'Extra', selectionType: 'multi' });
  const modId = crypto.randomUUID();
  await req('POST', `/modifier-lists/${listId}/modifiers`, { id: modId, name: 'Oat Milk', price: 8000 });
  const res = await req('PATCH', `/modifier-lists/${listId}/modifiers/${modId}`, { price: -5 });
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error.code, 'VALIDATION_ERROR');
});

// spec-a-katalog.md § A.7 / FR-A3 AC: "Modifier dengan harga Rp 0 tetap
// tercetak di struk (mis. 'Less Sugar')" -- Rp 0 harus legal, bukan ditolak
// oleh validasi ">= 0" yang salah tulis jadi "> 0".
test('createModifier: harga Rp 0 legal (mis. "Less Sugar")', async () => {
  const listId = crypto.randomUUID();
  await req('POST', '/modifier-lists', { id: listId, name: 'Gula', selectionType: 'single' });
  const res = await req('POST', `/modifier-lists/${listId}/modifiers`, { id: crypto.randomUUID(), name: 'Less Sugar', price: 0 });
  assert.equal(res.statusCode, 201);
  assert.equal(JSON.parse(res.body).price, 0);
});

test('listModifierLists: default menyembunyikan yang diarsipkan, includeArchived=true menampilkannya', async () => {
  const listId = crypto.randomUUID();
  await req('POST', '/modifier-lists', { id: listId, name: 'Dihapus', selectionType: 'single' });
  await req('POST', `/modifier-lists/${listId}/archive`);

  const hidden = await req('GET', '/modifier-lists');
  assert.equal(JSON.parse(hidden.body).items.some((m) => m.id === listId), false);

  const shown = await req('GET', '/modifier-lists?includeArchived=true');
  assert.equal(JSON.parse(shown.body).items.some((m) => m.id === listId), true);
});

test('getModifierList: 404 untuk id yang tidak ada', async () => {
  const res = await req('GET', `/modifier-lists/${crypto.randomUUID()}`);
  assert.equal(res.statusCode, 404);
});
