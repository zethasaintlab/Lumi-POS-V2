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
  base = await seedTenantBase(appSetup, { suffix: 'AttachTest' });
  tenant = base.tenant;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();
});

function req(method, url, payload) {
  return app.inject({ method, url, payload, headers: { 'x-tenant-id': tenant.id , authorization: base.authHeader} });
}

// ⛔ Bertindak sebagai TENANT LAIN, dengan sesi tenant lain itu sendiri.
//
// Sejak penjaga sesi ada, mengirim `x-tenant-id` tenant lain sambil membawa
// token tenant ini dijawab 401 — sesinya tidak akan ditemukan di sana. Yang
// dimodelkan test-test di bawah BUKAN itu, melainkan serangan yang justru
// temuan F1 sebut: penyerang yang SAH DI TENANTNYA SENDIRI menunjuk baris
// milik tenant korban lewat FK. FK PostgreSQL tidak tunduk RLS, jadi hanya
// guard SELECT di aplikasi yang berdiri di sana.
//
// Token penyerang karena itu WAJIB ikut berpindah bersama tenantnya —
// kalau tidak, seluruh test ini berhenti di 401 dan guard FK-nya tidak
// pernah dijalankan sama sekali.
function reqAs(tenantId, method, url, payload, auth) {
  return app.inject({
    method,
    url,
    payload,
    headers: { 'x-tenant-id': tenantId, authorization: auth ?? base.authHeader },
  });
}

async function createItem() {
  const id = crypto.randomUUID();
  await req('POST', '/items', { id, name: 'Kopi', variations: [{ id: crypto.randomUUID(), price: 20000 }] });
  return id;
}

async function createModifierList() {
  const id = crypto.randomUUID();
  await req('POST', '/modifier-lists', { id, name: 'Extra', selectionType: 'multi' });
  return id;
}

// Runs a SELECT scoped to a specific tenant's RLS context via the RLS-bound
// (lumi_app) connection -- NOT the migration-owner connection -- so this
// proves the row is invisible/absent the same way the real application would
// see it, not just absent from an unfiltered superuser query.
async function queryAsTenant(tenantId, sql, params) {
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
  const result = await appSetup.query(sql, params);
  await appSetup.query('COMMIT');
  return result;
}

// --- plan lama Task 5 Step 4 ---

test('attachModifierList lalu detachModifierList', async () => {
  const itemId = await createItem();
  const listId = await createModifierList();

  const attached = await req('POST', `/items/${itemId}/modifier-lists/${listId}`, {});
  assert.equal(attached.statusCode, 200);
  const body = JSON.parse(attached.body);
  assert.equal(body.itemId, itemId);
  assert.equal(body.modifierListId, listId);
  assert.equal(body.sortOrder, 0);

  const detached = await req('DELETE', `/items/${itemId}/modifier-lists/${listId}`);
  assert.equal(detached.statusCode, 204);
  assert.equal(detached.body, '');
});

test('attachModifierList: idempoten -- attach dua kali tidak error (ON CONFLICT), sortOrder terbaru menang', async () => {
  const itemId = await createItem();
  const listId = await createModifierList();

  const first = await req('POST', `/items/${itemId}/modifier-lists/${listId}`, { sortOrder: 1 });
  assert.equal(first.statusCode, 200);

  const second = await req('POST', `/items/${itemId}/modifier-lists/${listId}`, { sortOrder: 2 });
  assert.equal(second.statusCode, 200);
  assert.equal(JSON.parse(second.body).sortOrder, 2);

  const { rows } = await queryAsTenant(
    tenant.id,
    'SELECT sort_order FROM item_modifier_list WHERE item_id = $1 AND modifier_list_id = $2',
    [itemId, listId]
  );
  assert.equal(rows.length, 1, 'attach dua kali tidak boleh menghasilkan dua baris');
  assert.equal(rows[0].sort_order, 2);
});

// --- kolom `id` (migrasi 0018, prasyarat raw table PowerSync) ---

test('attachModifierList mengembalikan id, dan id itu benar-benar tersimpan', async () => {
  const itemId = await createItem();
  const listId = await createModifierList();

  const res = await req('POST', `/items/${itemId}/modifier-lists/${listId}`, {});
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.match(
    body.id ?? '',
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    'respons harus memuat id berbentuk UUID'
  );

  // Respons saja tidak cukup: `fastify-openapi-glue` membuang field yang tidak
  // dideklarasikan di skema, dan sebaliknya sebuah handler bisa mengembalikan
  // id yang tidak pernah ditulis. Barisnya dibaca ulang lewat koneksi yang
  // tunduk RLS.
  const { rows } = await queryAsTenant(
    tenant.id,
    'SELECT id FROM item_modifier_list WHERE item_id = $1 AND modifier_list_id = $2',
    [itemId, listId]
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, body.id, 'id di respons harus id yang tersimpan');
});

// Yang paling mudah salah dan paling mahal akibatnya.
//
// `ON CONFLICT ... DO UPDATE` menerbitkan id BARU kalau id ikut di-SET di
// klausa DO UPDATE, atau kalau handler melakukan DELETE-lalu-INSERT. Baris
// yang sudah tersinkron ke perangkat akan terlihat sebagai baris BERBEDA:
// PowerSync menghapus yang lama dan menyisipkan yang baru, dan setiap
// perangkat mengunduh ulang relasi yang sebenarnya tidak berubah.
test('attach ulang mempertahankan id yang SAMA -- hanya sortOrder yang berubah', async () => {
  const itemId = await createItem();
  const listId = await createModifierList();

  const first = JSON.parse((await req('POST', `/items/${itemId}/modifier-lists/${listId}`, { sortOrder: 1 })).body);
  const second = JSON.parse((await req('POST', `/items/${itemId}/modifier-lists/${listId}`, { sortOrder: 2 })).body);

  assert.equal(second.id, first.id, 'attach ulang tidak boleh menerbitkan id baru');
  assert.equal(second.sortOrder, 2);

  const { rows } = await queryAsTenant(
    tenant.id,
    'SELECT id, sort_order FROM item_modifier_list WHERE item_id = $1 AND modifier_list_id = $2',
    [itemId, listId]
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, first.id);
  assert.equal(rows[0].sort_order, 2);
});

test('id unik antar pasangan -- dua attach berbeda tidak berbagi id', async () => {
  const listId = await createModifierList();
  const itemA = await createItem();
  const itemB = await createItem();

  const a = JSON.parse((await req('POST', `/items/${itemA}/modifier-lists/${listId}`, {})).body);
  const b = JSON.parse((await req('POST', `/items/${itemB}/modifier-lists/${listId}`, {})).body);
  assert.notEqual(a.id, b.id);
});

test('satu ModifierList bisa dipakai banyak Item (FR-A1 acceptance criteria)', async () => {
  const listId = await createModifierList();

  const item1 = crypto.randomUUID();
  await req('POST', '/items', { id: item1, name: 'A', variations: [{ id: crypto.randomUUID(), price: 1000 }] });
  const item2 = crypto.randomUUID();
  await req('POST', '/items', { id: item2, name: 'B', variations: [{ id: crypto.randomUUID(), price: 2000 }] });

  const res1 = await req('POST', `/items/${item1}/modifier-lists/${listId}`, {});
  const res2 = await req('POST', `/items/${item2}/modifier-lists/${listId}`, {});
  assert.equal(res1.statusCode, 200);
  assert.equal(res2.statusCode, 200);
});

test('attachModifierList: 404 kalau Item tidak ada, dan tidak ada baris tersimpan', async () => {
  const listId = await createModifierList();
  const fakeItemId = crypto.randomUUID();
  const res = await req('POST', `/items/${fakeItemId}/modifier-lists/${listId}`, {});
  assert.equal(res.statusCode, 404);
  assert.equal(JSON.parse(res.body).error.code, 'NOT_FOUND');

  const { rows } = await queryAsTenant(
    tenant.id,
    'SELECT 1 FROM item_modifier_list WHERE item_id = $1 AND modifier_list_id = $2',
    [fakeItemId, listId]
  );
  assert.equal(rows.length, 0, 'tidak boleh ada baris tersimpan untuk itemId yang tidak ada');
});

test('attachModifierList: 404 kalau ModifierList tidak ada, dan tidak ada baris tersimpan', async () => {
  const itemId = await createItem();
  const fakeListId = crypto.randomUUID();
  const res = await req('POST', `/items/${itemId}/modifier-lists/${fakeListId}`, {});
  assert.equal(res.statusCode, 404);
  assert.equal(JSON.parse(res.body).error.code, 'NOT_FOUND');

  const { rows } = await queryAsTenant(
    tenant.id,
    'SELECT 1 FROM item_modifier_list WHERE item_id = $1 AND modifier_list_id = $2',
    [itemId, fakeListId]
  );
  assert.equal(rows.length, 0, 'tidak boleh ada baris tersimpan untuk modifierListId yang tidak ada');
});

test('detachModifierList: 204 meskipun pasangan tidak pernah di-attach (idempotent no-op)', async () => {
  const itemId = await createItem();
  const listId = await createModifierList();
  const res = await req('DELETE', `/items/${itemId}/modifier-lists/${listId}`);
  assert.equal(res.statusCode, 204);
});

// --- L7: item_modifier_list.item_id dan .modifier_list_id REFERENCES
// item(id)/modifier_list(id) TIDAK tunduk RLS -- pengecekan FK Postgres
// berjalan dengan hak pemilik tabel, bukan peran yang dibatasi RLS
// (dikonfirmasi empiris di Task 3 untuk item.category_id, dan lagi di Task 4
// untuk modifier.modifier_list_id; bentuknya identik di sini untuk KEDUA FK
// bridge table ini). Guard yang benar (assertItemVisible/
// assertModifierListVisible, SELECT lewat client yang terikat
// withTenantTransaction) harus menolak SEBELUM baris bridge sempat
// ter-INSERT. Assersi tingkat DB di bawah TIDAK bersyarat -- harus selalu
// jalan, supaya "response 404 tapi datanya diam-diam tersimpan" tertangkap
// juga (skenario dead-assertion yang pernah lolos di items.test.js, di mana
// assertion status yang mendahului sudah throw duluan sehingga blok `if`
// tidak akan pernah jalan). ---

test('attachModifierList: modifierListId lintas tenant ditolak 404, dan tidak ada baris tersimpan', async () => {
  const otherBase = await seedTenantBase(appSetup, { suffix: 'AttachTestOtherA' });
  const attackerTenantId = otherBase.tenant.id;
  // Penyerang (tenant lain) punya item sendiri (item2 -- spare, belum pernah
  // di-attach ke apa pun di seeding), tapi mencoba menempelkan ModifierList
  // milik tenant korban (`base`, tenant di beforeEach ini) ke item miliknya.
  const attackerItemId = otherBase.item2.id;
  const victimModifierListId = base.modifier_list.id;

  const res = await reqAs(
    attackerTenantId,
    'POST',
    `/items/${attackerItemId}/modifier-lists/${victimModifierListId}`,
    {},
    otherBase.authHeader
  );
  assert.equal(res.statusCode, 404);
  assert.equal(JSON.parse(res.body).error.code, 'NOT_FOUND');

  // Bukti tingkat DB, TANPA syarat `if` -- kalau (bug) request di atas balik
  // 200, baris bridge TETAP tidak boleh ada. Dicek dalam konteks RLS milik
  // tenant penyerang, karena kalau app bug menyimpan baris, tenant_id baris
  // itu akan ikut tenantId pemanggil (si penyerang), bukan tenant pemilik
  // list -- jadi baris "bocor" itu hanya kelihatan di sini.
  const { rows } = await queryAsTenant(
    attackerTenantId,
    'SELECT 1 FROM item_modifier_list WHERE item_id = $1 AND modifier_list_id = $2',
    [attackerItemId, victimModifierListId]
  );
  assert.equal(rows.length, 0, 'tidak boleh ada baris bridge lintas tenant untuk modifierListId, apa pun status responsnya');
});

test('attachModifierList: itemId lintas tenant ditolak 404, dan tidak ada baris tersimpan', async () => {
  const otherBase = await seedTenantBase(appSetup, { suffix: 'AttachTestOtherB' });
  const attackerTenantId = otherBase.tenant.id;
  // Kebalikan dari test di atas: penyerang punya ModifierList sendiri, tapi
  // mencoba menempelkannya ke itemId milik tenant korban (item2 korban --
  // spare, belum pernah di-attach ke apa pun di seeding).
  const attackerModifierListId = otherBase.modifier_list.id;
  const victimItemId = base.item2.id;

  const res = await reqAs(
    attackerTenantId,
    'POST',
    `/items/${victimItemId}/modifier-lists/${attackerModifierListId}`,
    {},
    otherBase.authHeader
  );
  assert.equal(res.statusCode, 404);
  assert.equal(JSON.parse(res.body).error.code, 'NOT_FOUND');

  const { rows } = await queryAsTenant(
    attackerTenantId,
    'SELECT 1 FROM item_modifier_list WHERE item_id = $1 AND modifier_list_id = $2',
    [victimItemId, attackerModifierListId]
  );
  assert.equal(rows.length, 0, 'tidak boleh ada baris bridge lintas tenant untuk itemId, apa pun status responsnya');
});

// detachModifierList: RLS (tenant_delete policy, FORCE ROW LEVEL SECURITY --
// lihat db/migrations/0001_bootstrap_helpers.sql) sudah menyaring DELETE
// lewat tenant_id = current_setting('app.tenant_id'), jadi tanpa guard
// tambahan apa pun, DELETE lintas tenant otomatis menghapus NOL baris --
// bukan baris milik tenant lain -- karena predikat WHERE tenant_id = ...
// milik si PENYERANG digabung AND dengan WHERE item_id/modifier_list_id yang
// diberikan si penyerang. Makanya detachModifierList di implementasi ini
// SENGAJA tidak menambah assertItemVisible/assertModifierListVisible sebelum
// DELETE-nya sendiri: guard itu tidak menutup celah apa pun di sini (tidak
// ada FK yang di-percaya untuk WRITE, cuma DELETE ... WHERE, dan WHERE itu
// sudah difilter RLS), dan menambahkannya hanya akan mengubah 404 (kalau
// pasangannya tidak ada) menjadi oracle keberadaan lintas tenant yang justru
// TIDAK diinginkan -- 204 tanpa syarat (ada atau tidak ada, milik sendiri
// atau bukan) tidak membocorkan informasi apa pun ke penyerang.
// --- Whole-branch review FIX 5: attachModifierList/detachModifierList
// existed and the bridge stored sort_order, but no endpoint ever returned an
// item's attached modifier lists -- getItem/listItems returned `variations`
// only, so a client could write the relation and never read it back. K-04
// "Pilih Modifier (modal)" (product/IA-lumi-pos-v1.md) needs to know which
// lists apply to the item being rung up, so item.modifierLists nests the
// FULL ModifierList shape (toModifierList's own toModifier() output,
// including modifiers) -- not just ids -- the same way ModifierList already
// nests `modifiers`. Consistent with fetchVariations/fetchModifiers: archived
// attached lists are NOT filtered out here either, they just carry their own
// archivedAt. ---

test('getItem: menyertakan modifierLists yang sudah di-attach, lengkap dengan modifiers bertingkat', async () => {
  const itemId = await createItem();
  const listId = await createModifierList();
  const modId = crypto.randomUUID();
  await req('POST', `/modifier-lists/${listId}/modifiers`, { id: modId, name: 'Oat Milk', price: 8000 });
  await req('POST', `/items/${itemId}/modifier-lists/${listId}`, { sortOrder: 0 });

  const res = await req('GET', `/items/${itemId}`);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.modifierLists.length, 1);
  assert.equal(body.modifierLists[0].id, listId);
  assert.equal(body.modifierLists[0].modifiers.length, 1);
  assert.equal(body.modifierLists[0].modifiers[0].id, modId);
});

test('getItem: item tanpa modifierList yang di-attach punya modifierLists array kosong', async () => {
  const itemId = await createItem();
  const res = await req('GET', `/items/${itemId}`);
  assert.deepEqual(JSON.parse(res.body).modifierLists, []);
});

test('detachModifierList lalu getItem: modifierLists tidak lagi berisi list yang di-detach', async () => {
  const itemId = await createItem();
  const listId = await createModifierList();
  await req('POST', `/items/${itemId}/modifier-lists/${listId}`, {});
  await req('DELETE', `/items/${itemId}/modifier-lists/${listId}`);

  const res = await req('GET', `/items/${itemId}`);
  assert.deepEqual(JSON.parse(res.body).modifierLists, []);
});

test('getItem: modifierList yang diarsipkan tetap muncul di item.modifierLists (archivedAt terisi, konsisten dengan fetchVariations/fetchModifiers)', async () => {
  const itemId = await createItem();
  const listId = await createModifierList();
  await req('POST', `/items/${itemId}/modifier-lists/${listId}`, {});
  await req('POST', `/modifier-lists/${listId}/archive`);

  const res = await req('GET', `/items/${itemId}`);
  const body = JSON.parse(res.body);
  assert.equal(body.modifierLists.length, 1);
  assert.notEqual(body.modifierLists[0].archivedAt, null);
});

test('updateItem: response tetap menyertakan modifierLists yang sudah di-attach', async () => {
  const itemId = await createItem();
  const listId = await createModifierList();
  await req('POST', `/items/${itemId}/modifier-lists/${listId}`, {});

  const res = await req('PATCH', `/items/${itemId}`, { name: 'Kopi Ganti Nama' });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.modifierLists.length, 1);
  assert.equal(body.modifierLists[0].id, listId);
});

// N+1 guard (correctness, not query counting): listItems must fetch bridge
// rows for ALL items in one query and group them in code, not one query per
// item (brief FIX 5 -- "do not make it two per item"). This test can't count
// SQL round-trips from HTTP, but it DOES prove the grouping logic doesn't mix
// up which modifierLists belong to which item -- the failure mode a naive
// "wrong join / wrong grouping key" implementation of that batching would
// actually produce (each item ending up with the wrong list, or every item's
// list, instead of its own).
test('listItems: setiap item menyertakan modifierLists miliknya sendiri, tidak tertukar antar item', async () => {
  const itemA = await createItem();
  const itemB = await createItem();
  const listX = await createModifierList();
  const listY = await createModifierList();

  await req('POST', `/items/${itemA}/modifier-lists/${listX}`, {});
  await req('POST', `/items/${itemB}/modifier-lists/${listY}`, {});

  const res = await req('GET', '/items');
  assert.equal(res.statusCode, 200);
  const items = JSON.parse(res.body).items;
  const foundA = items.find((i) => i.id === itemA);
  const foundB = items.find((i) => i.id === itemB);
  assert.ok(foundA, 'itemA harus muncul di listItems');
  assert.ok(foundB, 'itemB harus muncul di listItems');
  assert.deepEqual(foundA.modifierLists.map((l) => l.id), [listX]);
  assert.deepEqual(foundB.modifierLists.map((l) => l.id), [listY]);
});

test('detachModifierList: tenant lain tidak bisa menghapus pasangan attach milik tenant lain', async () => {
  const otherBase = await seedTenantBase(appSetup, { suffix: 'AttachTestOtherC' });
  const attackerTenantId = otherBase.tenant.id;
  // base.item + base.modifier_list sudah di-attach oleh seedTenantBase itu
  // sendiri (lihat rows.item_modifier_list di helpers/seed.js).
  const victimItemId = base.item.id;
  const victimModifierListId = base.modifier_list.id;

  const res = await reqAs(
    attackerTenantId,
    'DELETE',
    `/items/${victimItemId}/modifier-lists/${victimModifierListId}`,
    undefined,
    otherBase.authHeader
  );
  assert.equal(res.statusCode, 204);

  const { rows } = await queryAsTenant(
    tenant.id,
    'SELECT 1 FROM item_modifier_list WHERE item_id = $1 AND modifier_list_id = $2',
    [victimItemId, victimModifierListId]
  );
  assert.equal(rows.length, 1, 'DELETE dari tenant lain tidak boleh menghapus baris milik tenant korban');
});
