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
  base = await seedTenantBase(appSetup, { suffix: 'ItemTest' });
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

// Whole-branch review FIX 1: openapi.yaml's createItem.variations now
// declares `minItems: 1` (restored -- it was deliberately omitted before
// app.ts's error handler honoured AJV's err.validation, since an unhandled
// AJV rejection used to fall through to a raw 500). AJV now rejects an empty
// `variations: []` array before the request ever reaches createItem's own
// body.variations.length === 0 check, so the code that comes back is AJV's
// VALIDATION_ERROR, not the handler's ITEM_NO_VARIATION. The handler's own
// check is deliberately left in place as a second layer (same belt-and-
// braces shape as translateConstraintError's DB CHECK backstops elsewhere in
// this module) -- it would still catch this case if the schema constraint
// were ever removed or bypassed, just not via this particular HTTP call.
// Whole-branch review FIX 5: attachModifierList/detachModifierList existed
// and the bridge stored sort_order, but no endpoint ever returned an item's
// attached modifier lists back -- getItem/listItems returned `variations`
// only. A client could write the relation and never read it back. Item.
// modifierLists is nested the same way ModifierList.modifiers already is
// (toItem/toModifierList pattern) -- a freshly created item has no
// attachments yet (createItem doesn't accept them in its body), so this must
// be an empty array without any extra query.
test('createItem: item baru punya modifierLists array kosong', async () => {
  const res = await req('POST', '/items', {
    id: crypto.randomUUID(),
    name: 'Baru',
    variations: [{ id: crypto.randomUUID(), price: 5000 }],
  });
  assert.equal(res.statusCode, 201);
  assert.deepEqual(JSON.parse(res.body).modifierLists, []);
});

test('createItem: variations kosong ditolak 400 VALIDATION_ERROR lewat minItems (AJV)', async () => {
  const res = await req('POST', '/items', { id: crypto.randomUUID(), name: 'Kosong', variations: [] });
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error.code, 'VALIDATION_ERROR');
});

// createItemVariation always computes MAX(sort_order)+1, so a genuine tie
// can't be produced through the public API today -- insert a second
// variation directly with the SAME sort_order as the first, to prove
// fetchVariations's ORDER BY is deterministic once a tie DOES occur (a
// future data correction, import, or any path other than this handler).
test('getItem: variation dengan sortOrder sama urut deterministic berdasarkan id (tie-breaker, dipaksa lewat SQL langsung)', async () => {
  const itemId = crypto.randomUUID();
  const varA = crypto.randomUUID();
  await req('POST', '/items', { id: itemId, name: 'TieVar', variations: [{ id: varA, price: 1000 }] });

  const varB = crypto.randomUUID();
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await appSetup.query(
    `INSERT INTO item_variation (id, tenant_id, item_id, name, price, sort_order) VALUES ($1, $2, $3, 'Tied', 1000, 0)`,
    [varB, tenant.id, itemId]
  );
  await appSetup.query('COMMIT');

  const expectedOrder = [varA, varB].sort();
  const res = await req('GET', `/items/${itemId}`);
  assert.equal(res.statusCode, 200);
  const returnedOrder = JSON.parse(res.body).variations.map((v) => v.id);
  assert.deepEqual(returnedOrder, expectedOrder, 'urutan variation dengan sortOrder sama harus deterministic (id ascending)');
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

// Whole-branch review FIX 2: id is client-generated and offline retry is a
// core premise of this system (CLAUDE.md konvensi data). Before this fix,
// insertVariation wrapped its INSERT in translateConstraintError, which
// mapped ANY 23505 to 409 BARCODE_DUPLICATE -- but item_variation has TWO
// unique constraints (the PK on id, and ux_variation_barcode). A client
// retrying a variation create with the same id (no barcode collision at all)
// got sent hunting a barcode conflict that did not exist. This must be
// distinguished by err.constraint, not treated as one bucket.
// Whole-branch review FIX 6: ORDER BY sort_order with no tie-breaker means a
// fresh catalog (sort_order DEFAULT 0 for everyone who doesn't set it) comes
// back in arbitrary, run-to-run-unstable order -- a real defect on a POS
// grid where cashier speed is muscle memory. `, id` makes ties deterministic.
test('listItems: item dengan sortOrder sama (default 0) urut deterministic berdasarkan id (tie-breaker)', async () => {
  const ids = [];
  for (let i = 0; i < 4; i += 1) {
    const id = crypto.randomUUID();
    ids.push(id);
    await req('POST', '/items', { id, name: `Tie ${i}`, variations: [{ id: crypto.randomUUID(), price: 1000 }] });
  }
  const expectedOrder = [...ids].sort();

  const res = await req('GET', '/items');
  assert.equal(res.statusCode, 200);
  // seedTenantBase juga menyisipkan item ('Kopi Susu', 'Kopi Hitam') di
  // beforeEach -- filter ke ids yang dibuat test ini saja.
  const returnedOrder = JSON.parse(res.body).items.map((it) => it.id).filter((id) => ids.includes(id));
  assert.deepEqual(returnedOrder, expectedOrder, 'urutan item dengan sortOrder sama harus deterministic (id ascending)');
});

test('createItem: item id yang sama dikirim ulang (retry offline) ditolak 409 ID_ALREADY_EXISTS, bukan 500', async () => {
  const itemId = crypto.randomUUID();
  const body = { id: itemId, name: 'Kopi', variations: [{ id: crypto.randomUUID(), price: 10000 }] };
  const first = await req('POST', '/items', body);
  assert.equal(first.statusCode, 201);

  const retryBody = { id: itemId, name: 'Kopi', variations: [{ id: crypto.randomUUID(), price: 10000 }] };
  const retry = await req('POST', '/items', retryBody);
  assert.equal(retry.statusCode, 409);
  assert.equal(JSON.parse(retry.body).error.code, 'ID_ALREADY_EXISTS');
});

test('createItemVariation: variation id yang sama dikirim ulang ditolak 409 ID_ALREADY_EXISTS, BUKAN BARCODE_DUPLICATE', async () => {
  const itemId = crypto.randomUUID();
  const varId = crypto.randomUUID();
  await req('POST', '/items', { id: itemId, name: 'Teh', variations: [{ id: varId, price: 10000 }] });

  // Retry createItemVariation dengan id yang SAMA seperti variation pertama
  // (yang sudah tersimpan lewat createItem), tanpa barcode sama sekali --
  // satu-satunya konflik nyata di sini adalah PK id, bukan barcode apa pun.
  const retry = await req('POST', `/items/${itemId}/variations`, { id: varId, price: 10000 });
  assert.equal(retry.statusCode, 409);
  assert.equal(
    JSON.parse(retry.body).error.code,
    'ID_ALREADY_EXISTS',
    'konflik PK id harus dibedakan dari konflik unique index barcode'
  );
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

// --- categoryId: harus RLS-visible bagi tenant pemanggil, bukan hanya "ada
// di suatu tempat" (temuan review Task 3: FK ke category(id) TIDAK tunduk
// RLS -- PostgreSQL menjalankan pengecekan referential integrity dengan hak
// pemilik tabel, bukan peran yang dibatasi RLS). ---

test('createItem: categoryId lintas tenant ditolak 404 (FK tidak boleh jadi jalan pintas RLS)', async () => {
  const otherBase = await seedTenantBase(appSetup, { suffix: 'ItemTestOther' });
  const foreignCategoryId = otherBase.category.id;
  // itemId dipilih klien SEBELUM memanggil createItem (konsisten dengan
  // aturan id client-generated di seluruh sistem ini) -- supaya baris
  // pembuktian DB di bawah bisa jalan TANPA SYARAT, tidak bergantung pada
  // mem-parsing id dari body respons createItem itu sendiri.
  const itemId = crypto.randomUUID();

  const res = await req('POST', '/items', {
    id: itemId,
    name: 'Nyelundup',
    categoryId: foreignCategoryId,
    variations: [{ id: crypto.randomUUID(), price: 5000 }],
  });
  assert.equal(res.statusCode, 404);
  assert.equal(JSON.parse(res.body).error.code, 'NOT_FOUND');

  // Whole-branch review FIX 7: this proof used to be wrapped in
  // `if (res.statusCode === 201) { ... }`, which could NEVER be true here --
  // the `assert.equal(res.statusCode, 404)` immediately above already threw
  // (aborting the test) for any response that wasn't 404, so by the time
  // execution reached that line res.statusCode was provably 404, never 201.
  // That made this the ONLY cross-tenant test in this branch with no actual
  // database-level proof -- its three sibling tests (updateItem's version
  // right below, and both attachModifierList lintas-tenant tests in
  // item-modifier-lists.test.js) all run their DB-level check unconditionally,
  // against an id known ahead of time rather than parsed from the attempted
  // write's own response. Bukti tambahan langsung ke DB: item TIDAK BOLEH
  // benar-benar tersimpan dengan category_id milik tenant lain -- ini
  // menutup celah "response salah tapi datanya juga rusak".
  const getRes = await req('GET', `/items/${itemId}`);
  assert.notEqual(
    JSON.parse(getRes.body).categoryId,
    foreignCategoryId,
    'item tidak boleh tersimpan dengan categoryId milik tenant lain'
  );
});

test('updateItem: categoryId lintas tenant ditolak 404 (FK tidak boleh jadi jalan pintas RLS)', async () => {
  const otherBase = await seedTenantBase(appSetup, { suffix: 'ItemTestOther2' });
  const foreignCategoryId = otherBase.category.id;

  const itemId = crypto.randomUUID();
  await req('POST', '/items', { id: itemId, name: 'Aman', variations: [{ id: crypto.randomUUID(), price: 5000 }] });

  const res = await req('PATCH', `/items/${itemId}`, { categoryId: foreignCategoryId });
  assert.equal(res.statusCode, 404);
  assert.equal(JSON.parse(res.body).error.code, 'NOT_FOUND');

  const getRes = await req('GET', `/items/${itemId}`);
  assert.notEqual(
    JSON.parse(getRes.body).categoryId,
    foreignCategoryId,
    'item tidak boleh berpindah categoryId ke milik tenant lain'
  );
});

test('createItem: categoryId milik tenant sendiri berhasil, nilai round-trip', async () => {
  const itemId = crypto.randomUUID();
  const res = await req('POST', '/items', {
    id: itemId,
    name: 'Latte',
    categoryId: base.category.id,
    variations: [{ id: crypto.randomUUID(), price: 22000 }],
  });
  assert.equal(res.statusCode, 201);
  assert.equal(JSON.parse(res.body).categoryId, base.category.id);
});

test('createItem: categoryId tidak ditemukan ditolak 404', async () => {
  const res = await req('POST', '/items', {
    id: crypto.randomUUID(),
    name: 'Ngawang',
    categoryId: crypto.randomUUID(),
    variations: [{ id: crypto.randomUUID(), price: 5000 }],
  });
  assert.equal(res.statusCode, 404);
  assert.equal(JSON.parse(res.body).error.code, 'NOT_FOUND');
});

test('updateItem: categoryId milik tenant sendiri berhasil, nilai round-trip', async () => {
  const itemId = crypto.randomUUID();
  await req('POST', '/items', { id: itemId, name: 'Mocha', variations: [{ id: crypto.randomUUID(), price: 24000 }] });

  const res = await req('PATCH', `/items/${itemId}`, { categoryId: base.category.id });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).categoryId, base.category.id);
});

test('updateItem: categoryId tidak ditemukan ditolak 404', async () => {
  const itemId = crypto.randomUUID();
  await req('POST', '/items', { id: itemId, name: 'Cappuccino', variations: [{ id: crypto.randomUUID(), price: 26000 }] });

  const res = await req('PATCH', `/items/${itemId}`, { categoryId: crypto.randomUUID() });
  assert.equal(res.statusCode, 404);
  assert.equal(JSON.parse(res.body).error.code, 'NOT_FOUND');
});
