'use strict';

// Nama pemesan, nomor meja, catatan (sub-proyek 2 Kasir, PR 2C Task 11;
// P5(b) + P6(a)). Tiga field OPSIONAL pada POST /orders, tiga kolom `order`.
// Kompatibilitas N-1 (R8): klien lama tidak mengirimnya dan tidak boleh patah.
// Pola setup SAMA dengan tests/ordering/idempotency.test.js.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase, seedBareTenant } = require('../isolation/helpers/seed');

let owner, appSetup, app, tenant, base, seq;

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
  seq = 0;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();
});

const BUSINESS_DATE = '2026-08-02';
const H = () => ({ 'x-tenant-id': tenant.id, authorization: base.authHeader, 'x-actor-id': base.user.id });

async function siapkan() {
  const dev = await app.inject({
    method: 'POST', url: '/devices', headers: H(),
    payload: { id: crypto.randomUUID(), outletId: base.outlet.id, code: 'KDP' },
  });
  assert.equal(dev.statusCode, 201, dev.body);
  const device = JSON.parse(dev.body);
  const sh = await app.inject({
    method: 'POST', url: '/shifts', headers: H(),
    payload: { id: crypto.randomUUID(), outletId: base.outlet.id, deviceId: device.id, businessDate: BUSINESS_DATE, openingFloat: 100000 },
  });
  assert.equal(sh.statusCode, 201, sh.body);
  return { device, shift: JSON.parse(sh.body) };
}

function muatan({ device, shift }, tambahan = {}) {
  seq += 1;
  return {
    id: crypto.randomUUID(),
    outletId: base.outlet.id,
    deviceId: device.id,
    shiftId: shift.id,
    receiptNumber: `K1-20260802-${String(seq).padStart(4, '0')}`,
    businessDate: BUSINESS_DATE,
    sequence: seq,
    channel: 'takeaway',
    checkId: crypto.randomUUID(),
    lines: [{ id: crypto.randomUUID(), variationId: base.item_variation.id, quantityMilli: 1000, discountAmount: 0 }],
    ...tambahan,
  };
}

function kirim(payload, key = crypto.randomUUID()) {
  return app.inject({ method: 'POST', url: '/orders', payload, headers: { ...H(), 'idempotency-key': key } });
}

async function bacaSebagai(tenantId, sql, params) {
  await appSetup.query('BEGIN');
  try {
    await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    const { rows } = await appSetup.query(sql, params);
    await appSetup.query('COMMIT');
    return rows;
  } catch (e) {
    await appSetup.query('ROLLBACK');
    throw e;
  }
}

const BACA_ORDER = 'SELECT customer_name, table_number, note FROM "order" WHERE id = $1';

test('customerName, tableNumber, note masuk kolom order masing-masing', async () => {
  const ctx = await siapkan();
  const p = muatan(ctx, { customerName: 'Budi', tableNumber: 'A3', note: 'Tanpa gula' });
  const res = await kirim(p);
  assert.equal(res.statusCode, 201, res.body);
  const body = JSON.parse(res.body);
  assert.equal(body.customerName, 'Budi');
  assert.equal(body.tableNumber, 'A3');
  assert.equal(body.note, 'Tanpa gula');
  const [r] = await bacaSebagai(tenant.id, BACA_ORDER, [p.id]);
  assert.deepEqual({ ...r }, { customer_name: 'Budi', table_number: 'A3', note: 'Tanpa gula' });
});

test('teks dipangkas; kosong dan spasi saja disimpan NULL', async () => {
  const ctx = await siapkan();
  const p = muatan(ctx, { customerName: '  Sari  ', tableNumber: '   ', note: '' });
  const res = await kirim(p);
  assert.equal(res.statusCode, 201, res.body);
  const [r] = await bacaSebagai(tenant.id, BACA_ORDER, [p.id]);
  assert.deepEqual({ ...r }, { customer_name: 'Sari', table_number: null, note: null });
});

test('⛔ check.label tetap NULL', async () => {
  const ctx = await siapkan();
  const p = muatan(ctx, { customerName: 'Budi', tableNumber: '4', note: 'Cepat' });
  const res = await kirim(p);
  assert.equal(res.statusCode, 201, res.body);
  const rows = await bacaSebagai(tenant.id, 'SELECT label FROM "check" WHERE id = $1', [p.checkId]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, null, 'nama pemesan tidak boleh bocor ke check.label (P5)');
});

test('⛔ N-1: order tanpa ketiga field diterima persis seperti hari ini', async () => {
  const ctx = await siapkan();
  const p = muatan(ctx);
  assert.ok(!('customerName' in p) && !('tableNumber' in p) && !('note' in p));
  const res = await kirim(p);
  assert.equal(res.statusCode, 201, res.body);
  const body = JSON.parse(res.body);
  assert.equal(body.customerName ?? null, null);
  assert.equal(body.tableNumber ?? null, null);
  assert.equal(body.note ?? null, null);
  const [r] = await bacaSebagai(tenant.id, BACA_ORDER, [p.id]);
  assert.deepEqual({ ...r }, { customer_name: null, table_number: null, note: null });
  // null eksplisit (klien baru tanpa isi) sama sahnya dengan hilang.
  const p2 = muatan(ctx, { customerName: null, tableNumber: null, note: null });
  const res2 = await kirim(p2);
  assert.equal(res2.statusCode, 201, res2.body);
});

test('⛔ nama 41 karakter ditolak 400 dengan pesan domain; meja 17 dan catatan 141 juga', async () => {
  const ctx = await siapkan();
  for (const [field, panjang, kata] of [
    ['customerName', 41, '40'],
    ['tableNumber', 17, '16'],
    ['note', 141, '140'],
  ]) {
    const p = muatan(ctx, { [field]: 'a'.repeat(panjang) });
    const res = await kirim(p);
    assert.equal(res.statusCode, 400, `${field}: ${res.body}`);
    const e = JSON.parse(res.body).error;
    assert.equal(e.code, 'VALIDATION_ERROR');
    assert.ok(e.message.includes(kata), `pesan menyebut batas ${kata}: ${e.message}`);
    assert.equal((await bacaSebagai(tenant.id, BACA_ORDER, [p.id])).length, 0, 'order tidak tersimpan');
  }
  // Batas tepat sah.
  const ok = muatan(ctx, { customerName: 'a'.repeat(40), tableNumber: 'b'.repeat(16), note: 'c'.repeat(140) });
  assert.equal((await kirim(ok)).statusCode, 201);
});

test('⛔ nomor kartu di nama/meja/catatan → 400 POSSIBLE_CARD_NUMBER', async () => {
  const ctx = await siapkan();
  for (const field of ['customerName', 'tableNumber', 'note']) {
    const p = muatan(ctx, { [field]: '4111 1111 1111 1111' });
    const res = await kirim(p);
    assert.equal(res.statusCode, 400, `${field}: ${res.body}`);
    assert.equal(JSON.parse(res.body).error.code, 'POSSIBLE_CARD_NUMBER');
  }
});

test('field bukan-string ditolak 400, bukan di-cast', async () => {
  const ctx = await siapkan();
  const res = await kirim(muatan(ctx, { customerName: 12345 }));
  assert.equal(res.statusCode, 400, res.body);
});

test('isolasi tenant: customer_name tenant A tidak terbaca B', async () => {
  const ctx = await siapkan();
  const p = muatan(ctx, { customerName: 'RahasiaA', tableNumber: 'Z9', note: 'catatan A' });
  assert.equal((await kirim(p)).statusCode, 201);
  const tenantB = await seedBareTenant(appSetup, { suffix: 'B' });
  const rows = await bacaSebagai(tenantB.id, 'SELECT customer_name, table_number, note FROM "order"', []);
  assert.equal(rows.length, 0, 'tenant B tidak melihat satu pun order tenant A');
  const langsung = await bacaSebagai(tenantB.id, BACA_ORDER, [p.id]);
  assert.equal(langsung.length, 0);
});

test('⛔ retry dengan idempotency key sama (dan respons hilang) tidak menduplikasi dan tidak mengubah kolom', async () => {
  const ctx = await siapkan();
  const p = muatan(ctx, { customerName: 'Budi', tableNumber: '4', note: 'Cepat' });
  const key = crypto.randomUUID();
  const r1 = await kirim(p, key);
  assert.equal(r1.statusCode, 201, r1.body);
  // Respons hilang: klien tidak pernah melihat r1, mengirim ulang beberapa kali.
  for (let i = 0; i < 3; i += 1) {
    const rn = await kirim(p, key);
    assert.equal(JSON.parse(rn.body).id, p.id);
    assert.equal(JSON.parse(rn.body).customerName, 'Budi');
  }
  const rows = await bacaSebagai(tenant.id, 'SELECT customer_name, table_number, note FROM "order" WHERE id = $1', [p.id]);
  assert.equal(rows.length, 1);
  assert.deepEqual({ ...rows[0] }, { customer_name: 'Budi', table_number: '4', note: 'Cepat' });
  // Key sama + isi pesanan BERBEDA → 422, kolom tidak berubah.
  const lain = { ...p, customerName: 'Orang Lain' };
  const r422 = await kirim(lain, key);
  assert.equal(r422.statusCode, 422, r422.body);
  const after = await bacaSebagai(tenant.id, BACA_ORDER, [p.id]);
  assert.equal(after[0].customer_name, 'Budi');
});
