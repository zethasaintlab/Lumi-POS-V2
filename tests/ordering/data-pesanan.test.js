'use strict';

// Nama pemesan, nomor meja, dan catatan pesanan — tiga kolom `order` baru
// (migrasi 0037; Task 11 PR 2C; P5(b) + P6(a), keputusan user 28 September
// 2026). `check.label` TETAP NULL.
//
// ⛔ N-1: klien versi lama tidak mengirim ketiganya dan tidak boleh patah.

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

const TANGGAL = '2026-08-02';

async function kueri(tenantId, sql, params) {
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
  try {
    const { rows } = await appSetup.query(sql, params);
    await appSetup.query('COMMIT');
    return rows;
  } catch (e) {
    await appSetup.query('ROLLBACK');
    throw e;
  }
}

const hdr = () => ({
  'x-tenant-id': tenant.id,
  authorization: base.authHeader,
  'x-actor-id': base.user.id,
});

let urutan = 0;
async function perangkatDanShift() {
  const deviceId = crypto.randomUUID();
  urutan += 1;
  let res = await app.inject({
    method: 'POST',
    url: '/devices',
    payload: { id: deviceId, outletId: base.outlet.id, code: `K${urutan}` },
    headers: hdr(),
  });
  assert.equal(res.statusCode, 201, res.body);
  const shiftId = crypto.randomUUID();
  res = await app.inject({
    method: 'POST',
    url: '/shifts',
    payload: { id: shiftId, outletId: base.outlet.id, deviceId, businessDate: TANGGAL, openingFloat: 100000 },
    headers: hdr(),
  });
  assert.equal(res.statusCode, 201, res.body);
  return { deviceId, shiftId };
}

let nomor = 0;
function badan({ deviceId, shiftId }, tambahan = {}) {
  nomor += 1;
  return {
    id: crypto.randomUUID(),
    outletId: base.outlet.id,
    deviceId,
    shiftId,
    receiptNumber: `K1-20260802-${String(nomor).padStart(4, '0')}`,
    businessDate: TANGGAL,
    sequence: nomor,
    channel: 'takeaway',
    checkId: crypto.randomUUID(),
    lines: [
      { id: crypto.randomUUID(), variationId: base.item_variation.id, quantityMilli: 1000, discountAmount: 0 },
    ],
    ...tambahan,
  };
}

const kirim = (payload, kunci = crypto.randomUUID()) =>
  app.inject({ method: 'POST', url: '/orders', headers: { ...hdr(), 'idempotency-key': kunci }, payload });

const barisOrder = async (id) =>
  (await kueri(tenant.id, `SELECT customer_name, table_number, note FROM "order" WHERE id = $1`, [id]))[0];

test('customerName, tableNumber, note masuk kolom order masing-masing', async () => {
  const p = badan(await perangkatDanShift(), { customerName: 'Budi', tableNumber: 'A3', note: 'Tanpa gula' });
  const res = await kirim(p);
  assert.equal(res.statusCode, 201, res.body);
  assert.deepEqual(await barisOrder(p.id), { customer_name: 'Budi', table_number: 'A3', note: 'Tanpa gula' });
});

test('spasi tepi dipangkas; string kosong disimpan sebagai NULL', async () => {
  const p = badan(await perangkatDanShift(), { customerName: '  Budi  ', tableNumber: '   ', note: '' });
  const res = await kirim(p);
  assert.equal(res.statusCode, 201, res.body);
  assert.deepEqual(await barisOrder(p.id), { customer_name: 'Budi', table_number: null, note: null });
});

test('⛔ check.label tetap NULL', async () => {
  const p = badan(await perangkatDanShift(), { customerName: 'Budi', tableNumber: '4', note: 'x' });
  assert.equal((await kirim(p)).statusCode, 201);
  const rows = await kueri(tenant.id, `SELECT label FROM "check" WHERE order_id = $1`, [p.id]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, null, `nama pemesan bocor ke check.label: ${rows[0].label}`);
});

test('⛔ N-1: order tanpa ketiga field diterima persis seperti hari ini (ketiganya NULL)', async () => {
  const p = badan(await perangkatDanShift());
  const res = await kirim(p);
  assert.equal(res.statusCode, 201, res.body);
  assert.deepEqual(await barisOrder(p.id), { customer_name: null, table_number: null, note: null });
});

test('⛔ nama 41 karakter ditolak 400 dengan pesan domain; order tidak tersimpan', async () => {
  const p = badan(await perangkatDanShift(), { customerName: 'a'.repeat(41) });
  const res = await kirim(p);
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(res.json().code ?? res.json().error?.code, 'VALIDATION_ERROR', res.body);
  assert.match(res.body, /Nama pemesan maksimal 40 karakter/);
  assert.equal((await kueri(tenant.id, `SELECT 1 FROM "order" WHERE id = $1`, [p.id])).length, 0);
});

test('meja 17 karakter dan catatan 141 karakter ditolak 400', async () => {
  const d = await perangkatDanShift();
  let res = await kirim(badan(d, { tableNumber: 'm'.repeat(17) }));
  assert.equal(res.statusCode, 400, res.body);
  assert.match(res.body, /Nomor meja maksimal 16 karakter/);
  res = await kirim(badan(d, { note: 'c'.repeat(141) }));
  assert.equal(res.statusCode, 400, res.body);
  assert.match(res.body, /Catatan maksimal 140 karakter/);
});

test('⛔ nomor kartu di catatan → 400 POSSIBLE_CARD_NUMBER', async () => {
  const res = await kirim(badan(await perangkatDanShift(), { note: 'kartu 4111 1111 1111 1111' }));
  assert.equal(res.statusCode, 400, res.body);
  assert.match(res.body, /POSSIBLE_CARD_NUMBER/);
});

test('batas tepat 40/16/140 diterima server (CHECK migrasi sepakat dengan domain)', async () => {
  const p = badan(await perangkatDanShift(), {
    customerName: 'n'.repeat(40),
    tableNumber: 'm'.repeat(16),
    note: 'c'.repeat(140),
  });
  const res = await kirim(p);
  assert.equal(res.statusCode, 201, res.body);
});

test('⛔ CHECK database menolak 41/17/141 walau aplikasi lupa memvalidasi', async () => {
  const d = await perangkatDanShift();
  const p = badan(d);
  assert.equal((await kirim(p)).statusCode, 201);
  for (const [kolom, panjang] of [['customer_name', 41], ['table_number', 17], ['note', 141]]) {
    await assert.rejects(
      kueri(tenant.id, `UPDATE "order" SET ${kolom} = $1 WHERE id = $2`, ['x'.repeat(panjang), p.id]),
      new RegExp(`ck_order_${kolom}_len`),
      `${kolom} ${panjang} karakter lolos CHECK`
    );
  }
});

test('isolasi tenant: customer_name tenant A tidak terbaca B', async () => {
  const p = badan(await perangkatDanShift(), { customerName: 'Rahasia A' });
  assert.equal((await kirim(p)).statusCode, 201);
  const b = await seedTenantBase(appSetup, { suffix: 'DataPesananB' });
  const rows = await kueri(b.tenant.id, `SELECT customer_name FROM "order" WHERE customer_name IS NOT NULL`, []);
  assert.equal(rows.length, 0, `tenant B membaca ${JSON.stringify(rows)}`);
  assert.equal(
    (await kueri(b.tenant.id, `SELECT 1 FROM "order" WHERE id = $1`, [p.id])).length,
    0,
    'tenant B membaca order tenant A'
  );
});

test('⛔ retry dengan idempotency key sama (dan respons hilang) tidak menduplikasi dan tidak mengubah kolom', async () => {
  const p = badan(await perangkatDanShift(), { customerName: 'Budi', tableNumber: '4', note: 'Tanpa gula' });
  const kunci = crypto.randomUUID();
  const pertama = await kirim(p, kunci);
  assert.equal(pertama.statusCode, 201, pertama.body);
  // Respons "hilang": klien tidak pernah melihat `pertama`, mengirim ulang
  // key yang sama berkali-kali.
  for (let i = 0; i < 3; i += 1) {
    const ulang = await kirim(p, kunci);
    assert.equal(ulang.statusCode, 201, ulang.body);
    assert.equal(ulang.json().id, p.id);
  }
  const rows = await kueri(tenant.id, `SELECT customer_name, table_number, note FROM "order" WHERE id = $1`, [p.id]);
  assert.equal(rows.length, 1, 'order terduplikasi');
  assert.deepEqual(rows[0], { customer_name: 'Budi', table_number: '4', note: 'Tanpa gula' });
  // Body BERBEDA (nama diubah) dengan key yang sama ditolak, kolom tidak berubah.
  const beda = await kirim({ ...p, customerName: 'Orang Lain' }, kunci);
  assert.notEqual(beda.statusCode, 201, 'key sama + body beda diproses');
  assert.equal((await barisOrder(p.id)).customer_name, 'Budi');
});

test('⛔ NUL / karakter kendali di nama, meja, catatan → 400 VALIDATION_ERROR, bukan 500', async () => {
  const d = await perangkatDanShift();
  for (const [kolom, nilai] of [['customerName', 'Bu\u0000di'], ['tableNumber', 'A\u0001'], ['note', 'x\u0085y']]) {
    const res = await kirim(badan(d, { [kolom]: nilai }));
    assert.equal(res.statusCode, 400, `${kolom}: ${res.statusCode} ${res.body}`);
    assert.match(res.body, /VALIDATION_ERROR/);
  }
});

test('emoji: 40 emoji (80 unit UTF-16) diterima, 41 ditolak — server menghitung per code point seperti CHECK', async () => {
  const d = await perangkatDanShift();
  const ok = badan(d, { customerName: '😀'.repeat(40) });
  assert.equal((await kirim(ok)).statusCode, 201);
  assert.equal((await barisOrder(ok.id)).customer_name, '😀'.repeat(40));
  const res = await kirim(badan(d, { customerName: '😀'.repeat(41) }));
  assert.equal(res.statusCode, 400, res.body);
});
