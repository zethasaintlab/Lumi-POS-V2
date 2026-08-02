'use strict';

// FR-A7 sub-project 2 -- harga per outlet dan riwayatnya
// (docs/superpowers/plans/PLAN-katalog-harga-riwayat.md, T2-T6).
//
// Pola test SAMA PERSIS dengan tests/catalog/items.test.js: seedTenantBase
// dua kali untuk skenario lintas tenant, appSetup dipakai untuk pembuktian
// langsung ke DB (BEGIN/set_config/COMMIT) supaya SELECT itu sendiri tunduk
// RLS -- bukan lumi_owner, yang MENURUT tests/isolation/helpers/reset.js
// juga tidak bisa bypass RLS untuk SELECT/INSERT/UPDATE/DELETE (hanya
// TRUNCATE yang bebas RLS). Membuktikan "tidak ada baris tersimpan" karena
// itu SELALU lewat client yang app.tenant_id-nya sudah di-SET LOCAL ke
// tenant PEMANGGIL (base.tenant.id) -- itulah tenant_id yang akan tersimpan
// di baris price_history kalau bug F1 (FK bukan RLS) muncul lagi di sini.

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
  base = await seedTenantBase(appSetup, { suffix: 'PriceTest' });
  tenant = base.tenant;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();
});

function pricesUrl(itemId, variationId) {
  return `/items/${itemId}/variations/${variationId}/prices`;
}

function req(method, url, payload, headers = {}) {
  return app.inject({
    method,
    url,
    payload,
    headers: { 'x-tenant-id': tenant.id, 'x-actor-id': base.user.id, ...headers },
  });
}

// Membuktikan langsung ke DB bahwa TIDAK ADA baris price_history dengan id
// tertentu tersimpan untuk tenant pemanggil (`callerTenantId`). Dijalankan
// lewat appSetup (lumi_app, RLS-bound) dengan app.tenant_id di-SET LOCAL ke
// tenant pemanggil -- karena INSERT price_history SELALU menulis
// tenant_id = tenant pemanggil, terlepas dari variation/outlet/actor mana
// yang dirujuk di body. Status code 404 saja tidak cukup (bug F1: createItem
// pernah mengembalikan 201 SAMBIL menyimpan baris yang salah).
async function assertNoPriceRowSaved(callerTenantId, priceId) {
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [callerTenantId]);
  const { rows } = await appSetup.query('SELECT id FROM price_history WHERE id = $1', [priceId]);
  await appSetup.query('COMMIT');
  assert.equal(rows.length, 0, 'tidak boleh ada baris price_history tersimpan untuk request yang ditolak');
}

// --- T2: jalur bahagia ---

test('createPrice: jalur bahagia, 201, baris tersimpan, changed_by terisi aktor', async () => {
  const priceId = crypto.randomUUID();
  const res = await req('POST', pricesUrl(base.item.id, base.item_variation.id), {
    id: priceId,
    price: 28000,
    outletId: base.outlet.id,
    reason: 'Kenaikan harga biji kopi',
  });
  assert.equal(res.statusCode, 201);
  const body = JSON.parse(res.body);
  assert.equal(body.id, priceId);
  assert.equal(body.variationId, base.item_variation.id);
  assert.equal(body.outletId, base.outlet.id);
  assert.equal(body.price, 28000);
  assert.equal(body.reason, 'Kenaikan harga biji kopi');
  assert.equal(body.changedBy, base.user.id, 'changed_by harus terisi dari X-Actor-Id yang tervalidasi');
});

// --- T2b: tanpa outletId -> outlet_id NULL (harga default tenant) ---

test('createPrice: tanpa outletId tersimpan dengan outletId null (harga default tenant)', async () => {
  const res = await req('POST', pricesUrl(base.item.id, base.item_variation.id), {
    id: crypto.randomUUID(),
    price: 30000,
  });
  assert.equal(res.statusCode, 201);
  assert.equal(JSON.parse(res.body).outletId, null);
});

// --- T2c: effectiveFrom masa depan diizinkan (keputusan Q4) ---

test('createPrice: effectiveFrom masa depan diterima dan tersimpan apa adanya', async () => {
  const future = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  const res = await req('POST', pricesUrl(base.item.id, base.item_variation.id), {
    id: crypto.randomUUID(),
    price: 32000,
    effectiveFrom: future,
  });
  assert.equal(res.statusCode, 201);
  const body = JSON.parse(res.body);
  assert.equal(new Date(body.effectiveFrom).toISOString(), future);
});

// Plan §3.3 mensyaratkan "effectiveFrom wajib timestamp valid bila dikirim".
// Yang diuji di sini BUKAN sekadar "ditolak", tapi ditolak sebagai 4xx dengan
// envelope error yang konsisten -- bukan 500 dari cast error PostgreSQL yang
// bocor lewat. Bentuk kegagalan itu yang membedakan validasi sungguhan dari
// kebetulan.
test('createPrice: effectiveFrom bukan timestamp ditolak 4xx bersih, bukan 500', async () => {
  const res = await req('POST', pricesUrl(base.item.id, base.item_variation.id), {
    id: crypto.randomUUID(),
    price: 25000,
    effectiveFrom: 'bukan-tanggal',
  });
  assert.ok(
    res.statusCode >= 400 && res.statusCode < 500,
    `harusnya 4xx, dapat ${res.statusCode}: ${res.body}`
  );
  const body = JSON.parse(res.body);
  assert.ok(body.error && body.error.code, `envelope error tidak konsisten: ${res.body}`);
});

// --- T3: validasi price ---

test('createPrice: price negatif ditolak 400 VALIDATION_ERROR', async () => {
  const res = await req('POST', pricesUrl(base.item.id, base.item_variation.id), {
    id: crypto.randomUUID(),
    price: -1,
  });
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error.code, 'VALIDATION_ERROR');
});

test('createPrice: price non-integer (1000.5) ditolak 400 VALIDATION_ERROR', async () => {
  const res = await req('POST', pricesUrl(base.item.id, base.item_variation.id), {
    id: crypto.randomUUID(),
    price: 1000.5,
  });
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error.code, 'VALIDATION_ERROR');
});

test('createPrice: price bukan angka (string) ditolak 400 VALIDATION_ERROR', async () => {
  const res = await req('POST', pricesUrl(base.item.id, base.item_variation.id), {
    id: crypto.randomUUID(),
    price: 'banyak',
  });
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error.code, 'VALIDATION_ERROR');
});

// JSON tidak punya literal NaN -- JSON.stringify(NaN) sendiri menghasilkan
// `null` (dibuktikan empiris, lihat catatan implementasi). `price: null`
// adalah bentuk yang SUNGGUH bisa dikirim klien nyata (mis. hasil komputasi
// klien yang jadi NaN lalu diserialisasi) dan menempuh cabang guard yang
// sama (typeof !== 'number') seperti nilai bukan-angka lainnya.
test('createPrice: price null (representasi nilai numerik rusak) ditolak 400 VALIDATION_ERROR', async () => {
  const res = await req('POST', pricesUrl(base.item.id, base.item_variation.id), {
    id: crypto.randomUUID(),
    price: null,
  });
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error.code, 'VALIDATION_ERROR');
});

test('createPrice: price di atas Number.MAX_SAFE_INTEGER ditolak 400 VALIDATION_ERROR', async () => {
  const res = await req('POST', pricesUrl(base.item.id, base.item_variation.id), {
    id: crypto.randomUUID(),
    price: Number.MAX_SAFE_INTEGER + 1,
  });
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error.code, 'VALIDATION_ERROR');
});

// --- T3b: price = 0 diterima (barang gratis/promo, bukan error) ---

test('createPrice: price 0 diterima (barang gratis/promo bukan error)', async () => {
  const res = await req('POST', pricesUrl(base.item.id, base.item_variation.id), {
    id: crypto.randomUUID(),
    price: 0,
  });
  assert.equal(res.statusCode, 201);
  assert.equal(JSON.parse(res.body).price, 0);
});

// --- T4: variation lintas tenant -> 404, tidak ada baris tersimpan ---

test('createPrice: variation milik tenant lain ditolak 404, tidak ada baris tersimpan', async () => {
  const otherBase = await seedTenantBase(appSetup, { suffix: 'PriceTestOtherVar' });
  const priceId = crypto.randomUUID();

  const res = await req('POST', pricesUrl(otherBase.item.id, otherBase.item_variation.id), {
    id: priceId,
    price: 99000,
  });
  assert.equal(res.statusCode, 404);
  assert.equal(JSON.parse(res.body).error.code, 'NOT_FOUND');

  await assertNoPriceRowSaved(tenant.id, priceId);
});

// --- T5: outlet lintas tenant -> 404, tidak ada baris tersimpan ---

test('createPrice: outletId milik tenant lain ditolak 404, tidak ada baris tersimpan', async () => {
  const otherBase = await seedTenantBase(appSetup, { suffix: 'PriceTestOtherOutlet' });
  const priceId = crypto.randomUUID();

  const res = await req('POST', pricesUrl(base.item.id, base.item_variation.id), {
    id: priceId,
    price: 27000,
    outletId: otherBase.outlet.id,
  });
  assert.equal(res.statusCode, 404);
  assert.equal(JSON.parse(res.body).error.code, 'OUTLET_NOT_FOUND');

  await assertNoPriceRowSaved(tenant.id, priceId);
});

// --- T5b: actor (X-Actor-Id) lintas tenant -> 404, tidak ada baris tersimpan ---

test('createPrice: actor (X-Actor-Id) milik tenant lain ditolak 404, tidak ada baris tersimpan', async () => {
  const otherBase = await seedTenantBase(appSetup, { suffix: 'PriceTestOtherActor' });
  const priceId = crypto.randomUUID();

  const res = await req(
    'POST',
    pricesUrl(base.item.id, base.item_variation.id),
    { id: priceId, price: 26000 },
    { 'x-actor-id': otherBase.user.id }
  );
  assert.equal(res.statusCode, 404);
  assert.equal(JSON.parse(res.body).error.code, 'ACTOR_NOT_FOUND');

  await assertNoPriceRowSaved(tenant.id, priceId);
});

// --- T5c: header X-Actor-Id hilang -> 400 MISSING_ACTOR_ID ---

test('createPrice: header X-Actor-Id hilang ditolak 400 MISSING_ACTOR_ID', async () => {
  const res = await app.inject({
    method: 'POST',
    url: pricesUrl(base.item.id, base.item_variation.id),
    payload: { id: crypto.randomUUID(), price: 25000 },
    headers: { 'x-tenant-id': tenant.id },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error.code, 'MISSING_ACTOR_ID');
});

// --- T6: GET riwayat -- urutan dan isolasi tenant ---

test('listPrices: riwayat terurut effectiveFrom DESC, lalu id DESC untuk tie', async () => {
  const varId = base.item_variation.id;
  const tEarly = new Date('2026-01-01T00:00:00.000Z').toISOString();
  const tTie = new Date('2026-06-01T00:00:00.000Z').toISOString();

  const candidateA = crypto.randomUUID();
  const candidateB = crypto.randomUUID();
  const [lower, higher] = [candidateA, candidateB].sort();

  await req('POST', pricesUrl(base.item.id, varId), { id: lower, price: 21000, effectiveFrom: tTie });
  await req('POST', pricesUrl(base.item.id, varId), { id: higher, price: 22000, effectiveFrom: tTie });
  const idEarly = crypto.randomUUID();
  await req('POST', pricesUrl(base.item.id, varId), { id: idEarly, price: 19000, effectiveFrom: tEarly });

  const res = await req('GET', pricesUrl(base.item.id, varId));
  assert.equal(res.statusCode, 200);
  const relevant = [higher, lower, idEarly];
  const returnedOrder = JSON.parse(res.body).items.map((p) => p.id).filter((id) => relevant.includes(id));
  assert.deepEqual(
    returnedOrder,
    [higher, lower, idEarly],
    'urutan harus effectiveFrom DESC, dengan id DESC sebagai tie-breaker'
  );
});

test('listPrices: variation tidak ditemukan (mis. lintas tenant) ditolak 404, bukan riwayat kosong', async () => {
  const otherBase = await seedTenantBase(appSetup, { suffix: 'PriceTestOtherList' });
  const res = await req('GET', pricesUrl(otherBase.item.id, otherBase.item_variation.id));
  assert.equal(res.statusCode, 404);
  assert.equal(JSON.parse(res.body).error.code, 'NOT_FOUND');
});
