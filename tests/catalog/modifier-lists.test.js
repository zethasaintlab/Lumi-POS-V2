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
  return app.inject({ method, url, payload, headers: { 'x-tenant-id': tenant.id , authorization: base.authHeader} });
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
    headers: { 'x-tenant-id': attackerTenantId, authorization: otherBase.authHeader},
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

// --- Review finding (post-Task-4): ModifierList tidak bisa dibaca balik
// modifier-nya -- tidak ada listModifiers/getModifier, dan toModifierList
// tidak menyarangkan apa pun. K-04 "Pilih Modifier (modal)" (P0, offline-
// replicated) dan B-09 "Modifier List" di IA-lumi-pos-v1.md sama-sama butuh
// enumerasi modifier milik satu list. Perbaikannya BUKAN operasi ke-11,
// tapi menyarangkan array `modifiers` ke response ModifierList -- pola yang
// SAMA PERSIS dengan toItem/fetchVariations di items.ts (Item ↔
// ItemVariation adalah relasi 1:N yang identik bentuknya, satu task lebih
// awal, modul yang sama). ---

test('createModifierList: list baru punya modifiers array kosong', async () => {
  const listId = crypto.randomUUID();
  const res = await req('POST', '/modifier-lists', { id: listId, name: 'Baru', selectionType: 'single' });
  assert.equal(res.statusCode, 201);
  assert.deepEqual(JSON.parse(res.body).modifiers, []);
});

test('getModifierList: menyertakan modifiers bertingkat', async () => {
  const listId = crypto.randomUUID();
  await req('POST', '/modifier-lists', { id: listId, name: 'Gula', selectionType: 'single' });
  const mod1 = crypto.randomUUID();
  const mod2 = crypto.randomUUID();
  await req('POST', `/modifier-lists/${listId}/modifiers`, { id: mod1, name: 'Normal', price: 0 });
  await req('POST', `/modifier-lists/${listId}/modifiers`, { id: mod2, name: 'Kurang Manis', price: 0 });

  const res = await req('GET', `/modifier-lists/${listId}`);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.modifiers.length, 2);
  assert.deepEqual(body.modifiers.map((m) => m.id).sort(), [mod1, mod2].sort());
});

test('listModifierLists: setiap item menyertakan modifiers bertingkat', async () => {
  const listId = crypto.randomUUID();
  await req('POST', '/modifier-lists', { id: listId, name: 'Gula', selectionType: 'single' });
  const modId = crypto.randomUUID();
  await req('POST', `/modifier-lists/${listId}/modifiers`, { id: modId, name: 'Normal', price: 0 });

  const res = await req('GET', '/modifier-lists');
  const body = JSON.parse(res.body);
  const found = body.items.find((l) => l.id === listId);
  assert.ok(found, 'list yang baru dibuat harus muncul di listModifierLists');
  assert.equal(found.modifiers.length, 1);
  assert.equal(found.modifiers[0].id, modId);
});

// Konsisten dengan items.ts: archiveItemVariation TIDAK menyembunyikan
// variation dari GET item -- fetchVariations tidak pernah memfilter
// archived_at, jadi variation yang diarsipkan tetap muncul di body.variations
// dengan archivedAt-nya sendiri terisi. Modifier mengikuti pola yang sama
// persis: modifier yang diarsipkan tetap muncul di array modifiers milik
// ModifierList, statusnya terlihat lewat archivedAt, bukan disembunyikan
// dari daftar.
test('getModifierList: modifier yang diarsipkan tetap muncul di array modifiers (archivedAt terisi)', async () => {
  const listId = crypto.randomUUID();
  await req('POST', '/modifier-lists', { id: listId, name: 'Gula', selectionType: 'single' });
  const modId = crypto.randomUUID();
  await req('POST', `/modifier-lists/${listId}/modifiers`, { id: modId, name: 'Normal', price: 0 });
  await req('POST', `/modifier-lists/${listId}/modifiers/${modId}/archive`);

  const res = await req('GET', `/modifier-lists/${listId}`);
  const body = JSON.parse(res.body);
  assert.equal(body.modifiers.length, 1);
  assert.notEqual(body.modifiers[0].archivedAt, null);
});

// Whole-branch review FIX 6: ORDER BY name with no tie-breaker means two
// ModifierLists sharing a name come back in arbitrary, run-to-run-unstable
// order -- a real defect on a POS grid where cashier speed is muscle memory.
// `, id` makes ties deterministic instead of leaving them to whatever order
// Postgres's scan happens to produce.
test('listModifierLists: dua list dengan name sama urut deterministic berdasarkan id (tie-breaker)', async () => {
  const idA = crypto.randomUUID();
  const idB = crypto.randomUUID();
  await req('POST', '/modifier-lists', { id: idA, name: 'Sama Persis', selectionType: 'single' });
  await req('POST', '/modifier-lists', { id: idB, name: 'Sama Persis', selectionType: 'single' });
  const expectedOrder = [idA, idB].sort();

  const res = await req('GET', '/modifier-lists');
  assert.equal(res.statusCode, 200);
  const returnedOrder = JSON.parse(res.body).items
    .map((l) => l.id)
    .filter((id) => [idA, idB].includes(id));
  assert.deepEqual(returnedOrder, expectedOrder, 'urutan list dengan name sama harus deterministic (id ascending)');
});

// createModifier always computes MAX(sort_order)+1, so a genuine tie can't
// be produced through the public API today -- insert a second modifier
// directly with the SAME sort_order as the first, to prove fetchModifiers's
// ORDER BY is deterministic once a tie DOES occur.
test('getModifierList: modifier dengan sortOrder sama urut deterministic berdasarkan id (tie-breaker, dipaksa lewat SQL langsung)', async () => {
  const listId = crypto.randomUUID();
  await req('POST', '/modifier-lists', { id: listId, name: 'TieMod', selectionType: 'multi' });
  const modA = crypto.randomUUID();
  await req('POST', `/modifier-lists/${listId}/modifiers`, { id: modA, name: 'A', price: 0 });

  const modB = crypto.randomUUID();
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await appSetup.query(
    `INSERT INTO modifier (id, tenant_id, modifier_list_id, name, price, sort_order) VALUES ($1, $2, $3, 'Tied', 0, 0)`,
    [modB, tenant.id, listId]
  );
  await appSetup.query('COMMIT');

  const expectedOrder = [modA, modB].sort();
  const res = await req('GET', `/modifier-lists/${listId}`);
  assert.equal(res.statusCode, 200);
  const returnedOrder = JSON.parse(res.body).modifiers.map((m) => m.id);
  assert.deepEqual(returnedOrder, expectedOrder, 'urutan modifier dengan sortOrder sama harus deterministic (id ascending)');
});

// Whole-branch review FIX 2: id is client-generated and offline retry is a
// core premise of this system (CLAUDE.md konvensi data). Before this fix, a
// retried createModifierList / createModifier with the same id fell through
// translateConstraintError's `if (pgErr.code === '23514')` check (only the
// CHECK constraint was handled) straight to a raw 500 on the PK's 23505.
test('createModifierList: id yang sama dikirim ulang (retry offline) ditolak 409 ID_ALREADY_EXISTS, bukan 500', async () => {
  const listId = crypto.randomUUID();
  const first = await req('POST', '/modifier-lists', { id: listId, name: 'Extra', selectionType: 'single' });
  assert.equal(first.statusCode, 201);

  const retry = await req('POST', '/modifier-lists', { id: listId, name: 'Extra', selectionType: 'single' });
  assert.equal(retry.statusCode, 409);
  assert.equal(JSON.parse(retry.body).error.code, 'ID_ALREADY_EXISTS');
});

test('createModifier: id yang sama dikirim ulang (retry offline) ditolak 409 ID_ALREADY_EXISTS, bukan 500', async () => {
  const listId = crypto.randomUUID();
  await req('POST', '/modifier-lists', { id: listId, name: 'Extra', selectionType: 'single' });
  const modId = crypto.randomUUID();
  const first = await req('POST', `/modifier-lists/${listId}/modifiers`, { id: modId, name: 'Extra Shot', price: 5000 });
  assert.equal(first.statusCode, 201);

  const retry = await req('POST', `/modifier-lists/${listId}/modifiers`, { id: modId, name: 'Extra Shot', price: 5000 });
  assert.equal(retry.statusCode, 409);
  assert.equal(JSON.parse(retry.body).error.code, 'ID_ALREADY_EXISTS');
});

test('archiveModifierList: ModifierList yang diarsipkan tetap menyertakan modifiers-nya', async () => {
  const listId = crypto.randomUUID();
  await req('POST', '/modifier-lists', { id: listId, name: 'Gula', selectionType: 'single' });
  const modId = crypto.randomUUID();
  await req('POST', `/modifier-lists/${listId}/modifiers`, { id: modId, name: 'Normal', price: 0 });

  const res = await req('POST', `/modifier-lists/${listId}/archive`);
  const body = JSON.parse(res.body);
  assert.equal(body.modifiers.length, 1);
  assert.equal(body.modifiers[0].id, modId);
});

// --- Keputusan produk user (1 Agu 2026): minSelections/maxSelections yang
// tidak masuk akal harus DITOLAK, bukan diterima diam-diam.
//
// Konsekuensinya nyata, bukan kerapian: product/IA-lumi-pos-v1.md § K-04
// menyatakan tombol konfirmasi dialog modifier nonaktif sampai min_selections
// terpenuhi. Jadi min > max (mis. min 5, max 2) menghasilkan dialog yang
// tombolnya TIDAK AKAN PERNAH bisa aktif -- item itu tidak bisa dijual sama
// sekali, dan kasir tidak punya jalan keluar dari layar itu. Nilai negatif
// punya bentuk kegagalan yang sama.
//
// spec-a-katalog.md FR-A3 tidak punya acceptance criteria untuk ini; aturannya
// ditetapkan user secara eksplisit, bukan ditebak. Skema juga tidak punya CHECK
// untuk keduanya, jadi ini murni tanggung jawab application layer. ---

test('createModifierList: minSelections > maxSelections ditolak 400 VALIDATION_ERROR', async () => {
  const res = await req('POST', '/modifier-lists', {
    id: crypto.randomUUID(), name: 'Mustahil', selectionType: 'multi', minSelections: 5, maxSelections: 2,
  });
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error.code, 'VALIDATION_ERROR');
});

test('createModifierList: minSelections negatif ditolak 400 VALIDATION_ERROR', async () => {
  const res = await req('POST', '/modifier-lists', {
    id: crypto.randomUUID(), name: 'Negatif', selectionType: 'multi', minSelections: -1,
  });
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error.code, 'VALIDATION_ERROR');
});

test('createModifierList: maxSelections negatif ditolak 400 VALIDATION_ERROR', async () => {
  const res = await req('POST', '/modifier-lists', {
    id: crypto.randomUUID(), name: 'Negatif', selectionType: 'multi', maxSelections: -3,
  });
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error.code, 'VALIDATION_ERROR');
});

test('createModifierList: minSelections == maxSelections diterima (batas inklusif)', async () => {
  const res = await req('POST', '/modifier-lists', {
    id: crypto.randomUUID(), name: 'Tepat Dua', selectionType: 'multi', minSelections: 2, maxSelections: 2,
  });
  assert.equal(res.statusCode, 201);
  const body = JSON.parse(res.body);
  assert.equal(body.minSelections, 2);
  assert.equal(body.maxSelections, 2);
});

test('createModifierList: maxSelections null (tanpa batas atas) tetap diterima dengan minSelections > 0', async () => {
  const res = await req('POST', '/modifier-lists', {
    id: crypto.randomUUID(), name: 'Tanpa Batas Atas', selectionType: 'multi', minSelections: 3,
  });
  assert.equal(res.statusCode, 201);
  assert.equal(JSON.parse(res.body).maxSelections, null);
});

// Update harus divalidasi terhadap nilai EFEKTIF setelah patch, bukan hanya
// terhadap field yang dikirim -- PATCH yang hanya mengirim salah satu sisi
// tetap bisa menghasilkan kombinasi mustahil bersama nilai yang sudah ada.
test('updateModifierList: menaikkan minSelections melewati maxSelections yang sudah ada ditolak', async () => {
  const listId = crypto.randomUUID();
  await req('POST', '/modifier-lists', {
    id: listId, name: 'Extra', selectionType: 'multi', minSelections: 1, maxSelections: 3,
  });
  const res = await req('PATCH', `/modifier-lists/${listId}`, { minSelections: 4 });
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error.code, 'VALIDATION_ERROR');
});

test('updateModifierList: menurunkan maxSelections di bawah minSelections yang sudah ada ditolak', async () => {
  const listId = crypto.randomUUID();
  await req('POST', '/modifier-lists', {
    id: listId, name: 'Extra', selectionType: 'multi', minSelections: 3, maxSelections: 5,
  });
  const res = await req('PATCH', `/modifier-lists/${listId}`, { maxSelections: 2 });
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error.code, 'VALIDATION_ERROR');
});

test('updateModifierList: minSelections negatif ditolak 400 VALIDATION_ERROR', async () => {
  const listId = crypto.randomUUID();
  await req('POST', '/modifier-lists', { id: listId, name: 'Extra', selectionType: 'multi' });
  const res = await req('PATCH', `/modifier-lists/${listId}`, { minSelections: -1 });
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error.code, 'VALIDATION_ERROR');
});

test('updateModifierList: mengosongkan maxSelections ke null melepas batas atas, bukan ditolak', async () => {
  const listId = crypto.randomUUID();
  await req('POST', '/modifier-lists', {
    id: listId, name: 'Extra', selectionType: 'multi', minSelections: 3, maxSelections: 5,
  });
  const res = await req('PATCH', `/modifier-lists/${listId}`, { maxSelections: null });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.maxSelections, null);
  assert.equal(body.minSelections, 3);
});
