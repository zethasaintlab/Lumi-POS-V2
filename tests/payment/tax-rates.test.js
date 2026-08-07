'use strict';

// T8 (docs/superpowers/plans/PLAN-pembayaran-pajak.md) -- REST tax_rate,
// modul `payment` BARU.
//
// FR-C6: tarif pajak adalah ENTITAS BERDATA, bukan konstanta. Ketika perda
// mengubah tarif, tarif lama TIDAK dihapus -- `effective_to` diisi dan record
// baru dibuat (invariant #2). Transaksi historis tetap benar lewat snapshot
// di order_line.
//
// Pola test sama dengan tests/catalog/prices.test.js dan
// tests/ordering/orders.test.js: seedTenantBase dua kali untuk skenario
// lintas tenant, appSetup dipakai untuk pembuktian langsung ke DB.

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
  base = await seedTenantBase(appSetup, { suffix: 'TaxTest' });
  tenant = base.tenant;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();
});

function req(method, url, payload, headers = {}) {
  return app.inject({
    method,
    url,
    payload,
    headers: { 'x-tenant-id': tenant.id, 'x-actor-id': base.user.id, ...headers },
  });
}

function taxRatePayload(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    name: 'PBJT 10%',
    type: 'pbjt',
    rate: '0.1000',
    isInclusive: false,
    effectiveFrom: new Date().toISOString(),
    ...overrides,
  };
}

async function countTaxRate(id) {
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  const { rows } = await appSetup.query('SELECT id FROM tax_rate WHERE id = $1', [id]);
  await appSetup.query('COMMIT');
  return rows.length;
}

// --- jalur bahagia ---

test('createTaxRate: 201, tarif tersimpan dengan presisi penuh', async () => {
  const payload = taxRatePayload({ rate: '0.1100' });
  const res = await req('POST', '/tax-rates', payload);
  assert.equal(res.statusCode, 201, res.body);
  const body = JSON.parse(res.body);
  assert.equal(body.id, payload.id);
  assert.equal(body.name, 'PBJT 10%');
  assert.equal(body.rate, '0.1100', 'tarif dikembalikan sebagai string, bukan number');
  assert.equal(body.isInclusive, false);
  assert.equal(body.channel, 'all', 'AC FR-C7 pertama: channel default all');
  assert.equal(body.appliesTo, 'all_items');
  assert.deepEqual(body.appliesToIds, []);
  assert.equal(body.outletId, null, 'null = berlaku seluruh tenant');
  assert.equal(body.effectiveTo, null);
});

test('createTaxRate: outletId diisi menghasilkan tarif khusus outlet', async () => {
  const res = await req('POST', '/tax-rates', taxRatePayload({ outletId: base.outlet.id }));
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(JSON.parse(res.body).outletId, base.outlet.id);
});

// --- validasi rate ---

test('createTaxRate: rate sebagai number (bukan string) ditolak 400', async () => {
  // JSON.parse menghasilkan number untuk 0.1. Menerimanya diam-diam akan
  // membatalkan alasan seluruh jalur konversi ini ada.
  const res = await req('POST', '/tax-rates', taxRatePayload({ rate: 0.1 }));
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'VALIDATION_ERROR');
});

test('createTaxRate: rate dengan lebih dari 4 desimal ditolak, tidak dibulatkan diam-diam', async () => {
  const res = await req('POST', '/tax-rates', taxRatePayload({ rate: '0.12345' }));
  assert.equal(res.statusCode, 400, res.body);
});

test('createTaxRate: rate negatif ditolak', async () => {
  const res = await req('POST', '/tax-rates', taxRatePayload({ rate: '-0.1' }));
  assert.equal(res.statusCode, 400, res.body);
});

test('createTaxRate: rate 0 diterima -- 0% berbeda dari tidak ada pajak (FR-C6)', async () => {
  const res = await req('POST', '/tax-rates', taxRatePayload({ rate: '0.0000', name: 'PPN 0%' }));
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(JSON.parse(res.body).rate, '0.0000');
});

// --- validasi appliesTo / appliesToIds ---

test('createTaxRate: appliesTo all_items dengan appliesToIds tidak kosong ditolak', async () => {
  const res = await req('POST', '/tax-rates', taxRatePayload({
    appliesTo: 'all_items',
    appliesToIds: [base.item.id],
  }));
  assert.equal(res.statusCode, 400, res.body);
});

test('createTaxRate: appliesTo item dengan appliesToIds kosong ditolak', async () => {
  const res = await req('POST', '/tax-rates', taxRatePayload({ appliesTo: 'item', appliesToIds: [] }));
  assert.equal(res.statusCode, 400, res.body);
});

test('createTaxRate: appliesTo item dengan item milik tenant sendiri diterima', async () => {
  const res = await req('POST', '/tax-rates', taxRatePayload({
    appliesTo: 'item',
    appliesToIds: [base.item.id],
  }));
  assert.equal(res.statusCode, 201, res.body);
  assert.deepEqual(JSON.parse(res.body).appliesToIds, [base.item.id]);
});

test('createTaxRate: appliesTo category dengan category milik tenant sendiri diterima', async () => {
  const res = await req('POST', '/tax-rates', taxRatePayload({
    appliesTo: 'category',
    appliesToIds: [base.category.id],
  }));
  assert.equal(res.statusCode, 201, res.body);
});

// --- guard lintas tenant ---
//
// `tax_rate.applies_to_ids` adalah `text[]` TANPA FK sama sekali -- database
// tidak akan menangkap id karangan apa pun, apalagi id milik tenant lain.
// Ini kelas yang sama dengan price_history.changed_by: kolom yang isinya
// tidak dijamin siapa-siapa, dan tidak ada apa pun yang TERLIHAT menjaganya.

test('createTaxRate: item milik tenant lain ditolak 404, tidak ada baris tersimpan', async () => {
  const lain = await seedTenantBase(appSetup, { suffix: 'TaxTestOtherItem' });
  const payload = taxRatePayload({ appliesTo: 'item', appliesToIds: [lain.item.id] });
  const res = await req('POST', '/tax-rates', payload);
  assert.equal(res.statusCode, 404, res.body);
  assert.equal(await countTaxRate(payload.id), 0, 'tidak boleh ada baris tersimpan');
});

test('createTaxRate: category milik tenant lain ditolak 404, tidak ada baris tersimpan', async () => {
  const lain = await seedTenantBase(appSetup, { suffix: 'TaxTestOtherCat' });
  const payload = taxRatePayload({ appliesTo: 'category', appliesToIds: [lain.category.id] });
  const res = await req('POST', '/tax-rates', payload);
  assert.equal(res.statusCode, 404, res.body);
  assert.equal(await countTaxRate(payload.id), 0);
});

test('createTaxRate: satu id sah dan satu id tenant lain tetap ditolak seluruhnya', async () => {
  // Menerima sebagian akan menyimpan tarif yang separuh menunjuk data tenant
  // lain -- lebih buruk daripada menolak, karena terlihat berhasil.
  const lain = await seedTenantBase(appSetup, { suffix: 'TaxTestMixed' });
  const payload = taxRatePayload({
    appliesTo: 'item',
    appliesToIds: [base.item.id, lain.item.id],
  });
  const res = await req('POST', '/tax-rates', payload);
  assert.equal(res.statusCode, 404, res.body);
  assert.equal(await countTaxRate(payload.id), 0);
});

test('createTaxRate: outletId milik tenant lain ditolak 404, tidak ada baris tersimpan', async () => {
  const lain = await seedTenantBase(appSetup, { suffix: 'TaxTestOtherOutlet' });
  const payload = taxRatePayload({ outletId: lain.outlet.id });
  const res = await req('POST', '/tax-rates', payload);
  assert.equal(res.statusCode, 404, res.body);
  assert.equal(await countTaxRate(payload.id), 0);
});

// --- retry offline ---

test('createTaxRate: id yang sama dikirim ulang ditolak 409 ID_ALREADY_EXISTS', async () => {
  const payload = taxRatePayload();
  assert.equal((await req('POST', '/tax-rates', payload)).statusCode, 201);
  const retry = await req('POST', '/tax-rates', payload);
  assert.equal(retry.statusCode, 409, retry.body);
  assert.equal(JSON.parse(retry.body).error.code, 'ID_ALREADY_EXISTS');
});

// --- FR-C6: tarif lama tidak dihapus ---

test('endTaxRate: mengisi effective_to, baris TIDAK dihapus (invariant #2)', async () => {
  const payload = taxRatePayload();
  assert.equal((await req('POST', '/tax-rates', payload)).statusCode, 201);

  const res = await req('POST', `/tax-rates/${payload.id}/end`, {});
  assert.equal(res.statusCode, 200, res.body);
  assert.ok(JSON.parse(res.body).effectiveTo, 'effective_to harus terisi');

  assert.equal(await countTaxRate(payload.id), 1, 'baris tetap ada, hanya diakhiri');
});

test('endTaxRate: 404 untuk id yang tidak ada', async () => {
  const res = await req('POST', `/tax-rates/${crypto.randomUUID()}/end`, {});
  assert.equal(res.statusCode, 404, res.body);
});

test('endTaxRate: tarif milik tenant lain tidak terlihat (RLS)', async () => {
  const lain = await seedTenantBase(appSetup, { suffix: 'TaxTestEndOther' });
  const res = await req('POST', `/tax-rates/${lain.tax_rate.id}/end`, {});
  assert.equal(res.statusCode, 404, res.body);
});

// --- list ---

test('listTaxRates: hanya tarif tenant sendiri, urutan deterministik', async () => {
  await seedTenantBase(appSetup, { suffix: 'TaxTestListOther' });
  const a = taxRatePayload({ name: 'A' });
  const b = taxRatePayload({ name: 'B' });
  assert.equal((await req('POST', '/tax-rates', a)).statusCode, 201);
  assert.equal((await req('POST', '/tax-rates', b)).statusCode, 201);

  const res = await req('GET', '/tax-rates');
  assert.equal(res.statusCode, 200, res.body);
  const ids = JSON.parse(res.body).items.map((t) => t.id);
  // seedTenantBase juga menyemai satu tax_rate, jadi tenant ini punya 3.
  assert.equal(ids.length, 3, 'dua yang dibuat test + satu dari seed');
  assert.ok(ids.includes(a.id) && ids.includes(b.id));
  assert.deepEqual(ids, [...ids].sort(), 'urutan deterministik berdasar id');
});
