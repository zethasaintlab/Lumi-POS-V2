'use strict';

// Nama pemesan, nomor meja, catatan pesanan (PR 2C Task 11; keputusan user
// P5(b) + P6(a), 28 September 2026): tiga kolom opsional di `order`, satu
// migrasi. `check.label` TIDAK disentuh. Klien N-1 tidak mengirimnya.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');

let owner, appSetup, app, tenant, base;
const BUSINESS_DATE = '2026-08-02';

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
  base = await seedTenantBase(appSetup, { suffix: 'DataPesanan' });
  tenant = base.tenant;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();
});

function req(payload, headers = {}) {
  return app.inject({
    method: 'POST',
    url: '/orders',
    payload,
    headers: {
      'x-tenant-id': tenant.id,
      authorization: base.authHeader,
      'x-actor-id': base.user.id,
      'idempotency-key': crypto.randomUUID(),
      ...headers,
    },
  });
}

let n = 0;
async function siapkan() {
  n += 1;
  const deviceId = crypto.randomUUID();
  const d = await app.inject({
    method: 'POST', url: '/devices',
    payload: { id: deviceId, outletId: base.outlet.id, code: `DP${n}` },
    headers: { 'x-tenant-id': tenant.id, authorization: base.authHeader },
  });
  assert.equal(d.statusCode, 201, d.body);
  const shiftId = crypto.randomUUID();
  const s = await app.inject({
    method: 'POST', url: '/shifts',
    payload: { id: shiftId, outletId: base.outlet.id, deviceId, businessDate: BUSINESS_DATE, openingFloat: 100000 },
    headers: { 'x-tenant-id': tenant.id, authorization: base.authHeader, 'x-actor-id': base.user.id },
  });
  assert.equal(s.statusCode, 201, s.body);
  return { deviceId, shiftId };
}

function muatan({ deviceId, shiftId }, extra = {}) {
  return {
    id: crypto.randomUUID(),
    outletId: base.outlet.id,
    deviceId,
    shiftId,
    receiptNumber: 'K1-20260802-0001',
    businessDate: BUSINESS_DATE,
    sequence: 1,
    channel: 'takeaway',
    checkId: crypto.randomUUID(),
    lines: [{ id: crypto.randomUUID(), variationId: base.item_variation.id, quantityMilli: 1000, discountAmount: 0 }],
    ...extra,
  };
}

async function bacaOrder(tenantId, id) {
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
  const { rows } = await appSetup.query(
    `SELECT o.customer_name, o.table_number, o.note, c.label AS check_label
       FROM "order" o LEFT JOIN "check" c ON c.order_id = o.id WHERE o.id = $1`,
    [id]
  );
  await appSetup.query('COMMIT');
  return rows[0];
}

test('customerName, tableNumber, note masuk kolom order masing-masing', async () => {
  const p = muatan(await siapkan(), { customerName: 'Budi', tableNumber: 'A-07', note: 'tanpa gula' });
  const res = await req(p);
  assert.equal(res.statusCode, 201, res.body);
  // Respons NYATA: serializer membuang properti yang tidak dideklarasikan di skema `Order`.
  const badan = JSON.parse(res.body);
  assert.equal(badan.customerName, 'Budi', 'respons POST /orders tanpa customerName (skema Order openapi?)');
  assert.equal(badan.tableNumber, 'A-07', 'respons POST /orders tanpa tableNumber');
  assert.equal(badan.note, 'tanpa gula', 'respons POST /orders tanpa note');
  const row = await bacaOrder(tenant.id, p.id);
  assert.equal(row.customer_name, 'Budi');
  assert.equal(row.table_number, 'A-07');
  assert.equal(row.note, 'tanpa gula');
});

test('⛔ check.label tetap NULL', async () => {
  const p = muatan(await siapkan(), { customerName: 'Budi', tableNumber: '3', note: 'x' });
  assert.equal((await req(p)).statusCode, 201);
  const row = await bacaOrder(tenant.id, p.id);
  assert.equal(row.check_label, null, 'nama pemesan bocor ke check.label — P5 menetapkan label tetap NULL');
});

test('⛔ N-1: order tanpa ketiga field diterima persis seperti hari ini', async () => {
  const p = muatan(await siapkan());
  const res = await req(p);
  assert.equal(res.statusCode, 201, res.body);
  const row = await bacaOrder(tenant.id, p.id);
  assert.equal(row.customer_name, null);
  assert.equal(row.table_number, null);
  assert.equal(row.note, null);
});

test('kosong/spasi saja disimpan NULL, bukan string kosong', async () => {
  const p = muatan(await siapkan(), { customerName: '   ', tableNumber: '', note: null });
  assert.equal((await req(p)).statusCode, 201);
  const row = await bacaOrder(tenant.id, p.id);
  assert.equal(row.customer_name, null);
  assert.equal(row.table_number, null);
  assert.equal(row.note, null);
});

test('⛔ nama 41 karakter ditolak 400 dengan pesan domain, tidak ada order tersimpan', async () => {
  const p = muatan(await siapkan(), { customerName: 'a'.repeat(41) });
  const res = await req(p);
  assert.equal(res.statusCode, 400, res.body);
  const e = JSON.parse(res.body).error;
  assert.equal(e.code, 'VALIDATION_ERROR');
  assert.match(e.message, /Nama pemesan paling banyak 40 karakter/);
  assert.equal(await bacaOrder(tenant.id, p.id), undefined);
});

test('meja 17 dan catatan 141 ditolak 400; nomor kartu → POSSIBLE_CARD_NUMBER', async () => {
  const s = await siapkan();
  const meja = await req(muatan(s, { tableNumber: 'm'.repeat(17) }));
  assert.equal(meja.statusCode, 400, meja.body);
  const cat = await req(muatan(s, { note: 'c'.repeat(141) }));
  assert.equal(cat.statusCode, 400, cat.body);
  const kartu = await req(muatan(s, { note: 'kartu 4111 1111 1111 1111' }));
  assert.equal(kartu.statusCode, 400, kartu.body);
  assert.equal(JSON.parse(kartu.body).error.code, 'POSSIBLE_CARD_NUMBER');
});

test('isolasi tenant: customer_name tenant A tidak terbaca B', async () => {
  const p = muatan(await siapkan(), { customerName: 'RahasiaA' });
  assert.equal((await req(p)).statusCode, 201);
  const lain = await seedTenantBase(appSetup, { suffix: 'DataPesananB' });
  const dariB = await bacaOrder(lain.tenant.id, p.id);
  assert.equal(dariB, undefined, 'order tenant A terbaca dari tenant B');
});

test('⛔ retry dengan idempotency key sama (dan respons hilang) tidak menduplikasi dan tidak mengubah kolom', async () => {
  const p = muatan(await siapkan(), { customerName: 'Budi', tableNumber: '5', note: 'pedas' });
  const key = crypto.randomUUID();
  const r1 = await req(p, { 'idempotency-key': key });
  assert.equal(r1.statusCode, 201, r1.body);
  // Respons hilang: klien mengirim ulang body PERSIS sama, beberapa kali.
  for (let i = 0; i < 3; i += 1) {
    const r = await req(p, { 'idempotency-key': key });
    assert.equal(JSON.parse(r.body).id, JSON.parse(r1.body).id);
  }
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  const { rows } = await appSetup.query(`SELECT count(*)::int AS n FROM "order" WHERE id = $1`, [p.id]);
  await appSetup.query('COMMIT');
  assert.equal(rows[0].n, 1);
  const row = await bacaOrder(tenant.id, p.id);
  assert.deepEqual([row.customer_name, row.table_number, row.note], ['Budi', '5', 'pedas']);

  // Key sama, nama BERBEDA = body berbeda → 422, kolom tidak berubah.
  const lain = await req({ ...p, customerName: 'Andi' }, { 'idempotency-key': key });
  assert.equal(lain.statusCode, 422, lain.body);
  assert.equal((await bacaOrder(tenant.id, p.id)).customer_name, 'Budi');
});

test('kolom database menolak > batas walau jalur tulis lupa memvalidasi', async () => {
  const s = await siapkan();
  const p = muatan(s);
  assert.equal((await req(p)).statusCode, 201);
  await owner.query('BEGIN');
  await owner.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await assert.rejects(
    owner.query(`UPDATE "order" SET customer_name = $1 WHERE id = $2`, ['a'.repeat(41), p.id]),
    /order_customer_name_check|check constraint/i,
    'CHECK length(customer_name) <= 40 tidak ada di database'
  );
  await owner.query('ROLLBACK');
});
