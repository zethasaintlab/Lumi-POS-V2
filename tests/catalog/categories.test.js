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

test('updateCategory: dua PATCH bersamaan yang saling menukar induk (A<->B) tidak membentuk siklus', async () => {
  const idA = crypto.randomUUID();
  await post('/categories', { id: idA, name: 'A' });
  const idB = crypto.randomUUID();
  await post('/categories', { id: idB, name: 'B' });

  const [resAtoB, resBtoA] = await Promise.all([
    patch(`/categories/${idA}`, { parentId: idB }),
    patch(`/categories/${idB}`, { parentId: idA }),
  ]);

  const statuses = [resAtoB.statusCode, resBtoA.statusCode].sort();
  assert.deepEqual(statuses, [200, 409], 'tepat satu PATCH berhasil, satu lagi ditolak -- bukan dua-duanya sukses');

  const loser = resAtoB.statusCode === 409 ? resAtoB : resBtoA;
  assert.equal(JSON.parse(loser.body).error.code, 'CATEGORY_DEPTH_EXCEEDED');

  const catA = JSON.parse((await get(`/categories/${idA}`)).body);
  const catB = JSON.parse((await get(`/categories/${idB}`)).body);
  const isCycle = catA.parentId === idB && catB.parentId === idA;
  assert.equal(isCycle, false, 'A dan B tidak boleh berakhir saling menjadi induk satu sama lain');
});

// Catatan jujur soal determinisme test ini (diverifikasi lewat sabotase manual,
// bukan diasumsikan): melawan kode yang benar, test ini lulus deterministik.
// Tapi sabotase naif (kembalikan createCategory ke assertParentAllowsChild versi
// lama tanpa lock) TIDAK reliable membuat test ini merah di harness lokal ini --
// createCategory selesai (SELECT+INSERT+COMMIT) jauh lebih cepat daripada
// updateCategory sempat mencapai children-check-nya sendiri, jadi children-check
// updateCategory (yang memang sudah ada, terpisah) kebetulan menangkap child yang
// baru dibuat lewat READ COMMITTED biasa -- bukan karena lock createCategory.
// Race sungguhan HANYA terbukti lewat sabotase yang sengaja diperlebar (delay
// buatan antara pengecekan createCategory dan INSERT-nya, meniru DB/koneksi
// yang lebih lambat) -- pada kondisi itu Y->X->C nyata terbentuk tanpa lock
// createCategory, dan test ini benar-benar gagal seperti seharusnya. Jadi:
// test ini adalah regression guard yang sungguhan untuk lock createCategory
// (bukan cuma dokumentasi niat), tapi mutasi paling naif yang menghapus lock
// itu tidak selalu tertangkap pada timing lokal biasa -- lihat report Task 2
// Addendum 6 untuk transkrip lengkap kedua sabotase.
test('createCategory dan updateCategory bersamaan (C jadi anak X, X direparent ke Y) tidak membentuk tingkat ketiga tersembunyi', async () => {
  const idX = crypto.randomUUID();
  await post('/categories', { id: idX, name: 'X' });
  const idY = crypto.randomUUID();
  await post('/categories', { id: idY, name: 'Y' });
  const idC = crypto.randomUUID();

  const [resCreateC, resReparentX] = await Promise.all([
    post('/categories', { id: idC, name: 'C', parentId: idX }),
    patch(`/categories/${idX}`, { parentId: idY }),
  ]);

  const createSucceeded = resCreateC.statusCode === 201;
  const reparentSucceeded = resReparentX.statusCode === 200;
  assert.notEqual(
    createSucceeded,
    reparentSucceeded,
    'tepat satu dari createCategory(C, parentId:X) / updateCategory(X, parentId:Y) boleh berhasil, tidak dua-duanya dan tidak nol-duanya'
  );

  const loserRes = createSucceeded ? resReparentX : resCreateC;
  assert.equal(loserRes.statusCode, 409);
  assert.equal(JSON.parse(loserRes.body).error.code, 'CATEGORY_DEPTH_EXCEEDED');

  const catX = JSON.parse((await get(`/categories/${idX}`)).body);
  if (createSucceeded) {
    // C berhasil jadi anak X -> X sendiri harus TETAP top-level (reparent ke Y ditolak).
    assert.equal(catX.parentId, null, 'X tidak boleh punya induk sendiri kalau C berhasil jadi anaknya');
  } else {
    // X berhasil direparent ke Y -> C TIDAK BOLEH pernah tercipta di bawah X.
    assert.equal(catX.parentId, idY);
    const getC = await get(`/categories/${idC}`);
    assert.equal(getC.statusCode, 404, 'C tidak boleh tercipta kalau X sudah direparent ke Y (akan jadi Y->X->C)');
  }
});

test('updateCategory: parentId string kosong ditolak dengan error klien, bukan 500', async () => {
  const topId = crypto.randomUUID();
  await post('/categories', { id: topId, name: 'Top' });

  const res = await patch(`/categories/${topId}`, { parentId: '' });
  assert.ok(res.statusCode >= 400 && res.statusCode < 500, `expected 4xx, got ${res.statusCode}`);
});

// Whole-branch review FIX 2: id is client-generated (ULID/UUIDv7) and offline
// retry is a core premise of this system (CLAUDE.md konvensi data), yet
// before this fix a retried createCategory with the same id fell through
// translateConstraintError-less code straight to a raw 500 -- a 23505 on the
// PK never got a client-facing error at all. Retrying the EXACT same create
// (same id, same body) must be recognized as "this already happened", not an
// internal server error.
// Whole-branch review FIX 6: ORDER BY sort_order with no tie-breaker means a
// fresh catalog (sort_order DEFAULT 0 for everyone who doesn't set it) comes
// back in arbitrary, run-to-run-unstable order -- a real defect on a POS
// grid where cashier speed is muscle memory. `, id` makes ties deterministic
// instead of leaving them to whatever order Postgres's scan happens to
// produce (typically physical/insertion order, which for random UUIDv7 ids
// has no relationship to id-ascending order at all).
test('listCategories: kategori dengan sortOrder sama (default 0) urut deterministic berdasarkan id (tie-breaker)', async () => {
  const ids = [];
  for (let i = 0; i < 4; i += 1) {
    const id = crypto.randomUUID();
    ids.push(id);
    await post('/categories', { id, name: `Tie ${i}` });
  }
  const expectedOrder = [...ids].sort();

  const res = await get('/categories');
  assert.equal(res.statusCode, 200);
  // seedTenantBase juga menyisipkan satu category ('Minuman', sort_order 0)
  // di beforeEach -- filter ke ids yang dibuat test ini saja, supaya
  // assersi urutan tidak terganggu baris lain yang kebetulan sama-sama 0.
  const returnedOrder = JSON.parse(res.body).items.map((c) => c.id).filter((id) => ids.includes(id));
  assert.deepEqual(returnedOrder, expectedOrder, 'urutan kategori dengan sortOrder sama harus deterministic (id ascending)');
});

test('createCategory: id yang sama dikirim ulang (retry offline) ditolak 409 ID_ALREADY_EXISTS, bukan 500', async () => {
  const id = crypto.randomUUID();
  const first = await post('/categories', { id, name: 'Minuman' });
  assert.equal(first.statusCode, 201);

  const retry = await post('/categories', { id, name: 'Minuman' });
  assert.equal(retry.statusCode, 409);
  assert.equal(JSON.parse(retry.body).error.code, 'ID_ALREADY_EXISTS');
});
