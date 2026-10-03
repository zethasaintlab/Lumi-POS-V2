'use strict';

// Task 11 (sub-proyek 2 Kasir; keputusan user P5(b) + P6(a), 28 September 2026):
// `POST /orders` menerima `customerName?`, `tableNumber?`, `note?` — tiga kolom
// `order` dari SATU migrasi (0037). `check.label` TETAP NULL.
//
// ⛔ Klien versi N-1 tidak mengirim ketiganya dan tidak boleh patah.

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
  base = await seedTenantBase(appSetup, { suffix: 'DataPesanan' });
  tenant = base.tenant;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();
});

const BUSINESS_DATE = '2026-08-02';

function hdr(extra = {}) {
  return { 'x-tenant-id': tenant.id, authorization: base.authHeader, 'x-actor-id': base.user.id, ...extra };
}

async function setup() {
  const deviceId = crypto.randomUUID();
  let res = await app.inject({
    method: 'POST', url: '/devices',
    payload: { id: deviceId, outletId: base.outlet.id, code: 'DP1' }, headers: hdr(),
  });
  assert.equal(res.statusCode, 201, res.body);
  const shiftId = crypto.randomUUID();
  res = await app.inject({
    method: 'POST', url: '/shifts',
    payload: { id: shiftId, outletId: base.outlet.id, deviceId, businessDate: BUSINESS_DATE, openingFloat: 100000 },
    headers: hdr(),
  });
  assert.equal(res.statusCode, 201, res.body);
  return { deviceId, shiftId };
}

function payload({ deviceId, shiftId }, extra = {}) {
  return {
    id: crypto.randomUUID(),
    outletId: base.outlet.id,
    deviceId,
    shiftId,
    receiptNumber: 'DP1-20260802-0001',
    businessDate: BUSINESS_DATE,
    sequence: 1,
    channel: 'takeaway',
    checkId: crypto.randomUUID(),
    lines: [{ id: crypto.randomUUID(), variationId: base.item_variation.id, quantityMilli: 1000, discountAmount: 0 }],
    ...extra,
  };
}

const post = (body, headers = {}) =>
  app.inject({
    method: 'POST', url: '/orders', payload: body,
    headers: hdr({ 'idempotency-key': crypto.randomUUID(), ...headers }),
  });

async function bacaOrder(tenantId, orderId) {
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
  const { rows } = await appSetup.query(
    `SELECT customer_name, table_number, note FROM "order" WHERE id = $1`, [orderId]
  );
  await appSetup.query('COMMIT');
  return rows;
}

async function bacaLabel(orderId) {
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  const { rows } = await appSetup.query(`SELECT label FROM "check" WHERE order_id = $1`, [orderId]);
  await appSetup.query('COMMIT');
  return rows;
}

test('customerName, tableNumber, note masuk kolom order masing-masing', async () => {
  const s = await setup();
  const body = payload(s, { customerName: '  Budi  ', tableNumber: 'A3', note: 'tanpa es' });
  const res = await post(body);
  assert.equal(res.statusCode, 201, res.body);
  const [row] = await bacaOrder(tenant.id, body.id);
  assert.deepEqual(row, { customer_name: 'Budi', table_number: 'A3', note: 'tanpa es' });
});

test('⛔ check.label tetap NULL', async () => {
  const s = await setup();
  const body = payload(s, { customerName: 'Budi', tableNumber: '4', note: 'x' });
  assert.equal((await post(body)).statusCode, 201);
  const rows = await bacaLabel(body.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, null, 'nama pemesan bocor ke check.label');
});

test('⛔ N-1: order tanpa ketiga field diterima persis seperti hari ini', async () => {
  const s = await setup();
  const body = payload(s);
  const res = await post(body);
  assert.equal(res.statusCode, 201, res.body);
  const [row] = await bacaOrder(tenant.id, body.id);
  assert.deepEqual(row, { customer_name: null, table_number: null, note: null });
  // null dan string kosong sama dengan tidak ada
  const b2 = payload(s, { sequence: 2, receiptNumber: 'DP1-20260802-0002', customerName: null, tableNumber: '  ', note: '' });
  assert.equal((await post(b2)).statusCode, 201);
  const [r2] = await bacaOrder(tenant.id, b2.id);
  assert.deepEqual(r2, { customer_name: null, table_number: null, note: null });
});

test('⛔ nama 41 karakter ditolak 400 dengan pesan domain', async () => {
  const s = await setup();
  const res = await post(payload(s, { customerName: 'a'.repeat(41) }));
  assert.equal(res.statusCode, 400);
  const j = JSON.parse(res.body);
  assert.equal(j.error?.code ?? j.code, 'VALIDATION_ERROR');
  assert.match(res.body, /Nama pemesan maksimal 40 karakter/);
  const res2 = await post(payload(s, { tableNumber: 'a'.repeat(17) }));
  assert.equal(res2.statusCode, 400);
  assert.match(res2.body, /Nomor meja maksimal 16 karakter/);
  const res3 = await post(payload(s, { note: 'a'.repeat(141) }));
  assert.equal(res3.statusCode, 400);
  assert.match(res3.body, /Catatan maksimal 140 karakter/);
});

test('⛔ nomor kartu di catatan ditolak POSSIBLE_CARD_NUMBER, dan tidak ada order tersimpan', async () => {
  const s = await setup();
  const body = payload(s, { note: '4111 1111 1111 1111' });
  const res = await post(body);
  assert.equal(res.statusCode, 400);
  assert.match(res.body, /POSSIBLE_CARD_NUMBER/);
  assert.deepEqual(await bacaOrder(tenant.id, body.id), []);
});

test('isolasi tenant: customer_name tenant A tidak terbaca B', async () => {
  const s = await setup();
  const body = payload(s, { customerName: 'Rahasia A' });
  assert.equal((await post(body)).statusCode, 201);
  const { seedBareTenant } = require('../isolation/helpers/seed');
  const b = await seedBareTenant(appSetup, { suffix: 'DataPesananB' });
  assert.deepEqual(await bacaOrder(b.id, body.id), [], 'tenant B membaca order tenant A');
  assert.equal((await bacaOrder(tenant.id, body.id)).length, 1);
});

test('⛔ retry dengan idempotency key sama (dan respons hilang) tidak menduplikasi dan tidak mengubah kolom', async () => {
  const s = await setup();
  const body = payload(s, { customerName: 'Budi', tableNumber: '4', note: 'pedas' });
  const key = crypto.randomUUID();
  const r1 = await post(body, { 'idempotency-key': key });
  assert.equal(r1.statusCode, 201, r1.body);
  // respons hilang: klien mengulang persis sama, berkali-kali
  for (let i = 0; i < 3; i++) {
    const r = await post(body, { 'idempotency-key': key });
    assert.equal(r.statusCode, 201, r.body);
    assert.equal(JSON.parse(r.body).id, JSON.parse(r1.body).id);
  }
  // key sama, isi berbeda: ditolak, kolom tidak berubah
  const ubah = { ...body, customerName: 'Orang Lain' };
  const r422 = await post(ubah, { 'idempotency-key': key });
  assert.equal(r422.statusCode, 422);
  const rows = await bacaOrder(tenant.id, body.id);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], { customer_name: 'Budi', table_number: '4', note: 'pedas' });
});

test('⛔ batas kolom di DATABASE sama dengan konstanta domain (40/16/140), bukan hanya di aplikasi', async () => {
  const { MAKS_NAMA_PEMESAN, MAKS_NOMOR_MEJA, MAKS_CATATAN } = await import('../../packages/domain/src/data-pesanan.ts');
  const { rows } = await owner.query(
    `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = '"order"'::regclass AND conname LIKE 'ck_order_%_len'`
  );
  const def = Object.fromEntries(rows.map((r) => [r.conname, r.def]));
  assert.match(def.ck_order_customer_name_len ?? '', new RegExp(`<= ${MAKS_NAMA_PEMESAN}\\)`));
  assert.match(def.ck_order_table_number_len ?? '', new RegExp(`<= ${MAKS_NOMOR_MEJA}\\)`));
  assert.match(def.ck_order_note_len ?? '', new RegExp(`<= ${MAKS_CATATAN}\\)`));
});
