'use strict';

// Sub-proyek 2 Kasir, PR 2C Task 11 -- nama pemesan, nomor meja, catatan
// (keputusan user P5(b), P6(a); migrasi 0037). Tiga field OPSIONAL pada
// POST /orders, tiga kolom `order`. `check.label` TETAP NULL.
//
// Urutan rilis R8: server lebih dulu. Klien N-1 tidak mengirim ketiganya dan
// tidak boleh patah karenanya.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');

let owner, appc, app, tenant, base, fx;

before(async () => {
  owner = await connectAsOwner();
  appc = await connectAsApp();
});

after(async () => {
  await resetAll(owner);
  await owner.end();
  await appc.end();
  if (app) await app.close();
});

beforeEach(async () => {
  await resetAll(owner);
  base = await seedTenantBase(appc, { suffix: 'DataPesanan' });
  tenant = base.tenant;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();
  fx = await setupDeviceAndShift();
});

const BUSINESS_DATE = '2026-08-06';
let seq = 0;

function req(method, url, payload, headers = {}) {
  return app.inject({
    method, url, payload,
    headers: { 'x-tenant-id': tenant.id, authorization: base.authHeader, 'x-actor-id': base.user.id, ...headers },
  });
}

async function setupDeviceAndShift() {
  const deviceId = crypto.randomUUID();
  const d = await req('POST', '/devices', { id: deviceId, outletId: base.outlet.id, code: 'K1' });
  assert.equal(d.statusCode, 201, d.body);
  const shiftId = crypto.randomUUID();
  const s = await req('POST', '/shifts', {
    id: shiftId, outletId: base.outlet.id, deviceId, businessDate: BUSINESS_DATE, openingFloat: 100000,
  });
  assert.equal(s.statusCode, 201, s.body);
  return { deviceId, shiftId };
}

function payloadOrder(extra = {}) {
  seq += 1;
  return {
    id: crypto.randomUUID(),
    outletId: base.outlet.id,
    deviceId: fx.deviceId,
    shiftId: fx.shiftId,
    receiptNumber: `K1-20260806-${String(seq).padStart(4, '0')}`,
    businessDate: BUSINESS_DATE,
    sequence: seq,
    channel: 'takeaway',
    checkId: crypto.randomUUID(),
    lines: [{ id: crypto.randomUUID(), variationId: base.item_variation.id, quantityMilli: 1000, discountAmount: 0 }],
    ...extra,
  };
}

function kirim(payload, key = crypto.randomUUID()) {
  return req('POST', '/orders', payload, { 'idempotency-key': key });
}

// FORCE RLS berlaku untuk owner juga: setiap baca butuh app.tenant_id.
async function bacaTenant(sql, params) {
  await owner.query('BEGIN');
  try {
    await owner.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
    return (await owner.query(sql, params)).rows;
  } finally {
    await owner.query('ROLLBACK');
  }
}

async function barisOrder(id) {
  return (await bacaTenant('SELECT customer_name, table_number, note FROM "order" WHERE id = $1', [id]))[0];
}

test('customerName, tableNumber, note masuk kolom order masing-masing (terpangkas, tidak tertukar)', async () => {
  const p = payloadOrder({ customerName: '  Budi  ', tableNumber: 'A3', note: 'Tanpa gula' });
  const res = await kirim(p);
  assert.equal(res.statusCode, 201, res.body);
  assert.deepEqual(await barisOrder(p.id), { customer_name: 'Budi', table_number: 'A3', note: 'Tanpa gula' });
  const body = JSON.parse(res.body);
  assert.equal(body.customerName, 'Budi');
  assert.equal(body.tableNumber, 'A3');
  assert.equal(body.note, 'Tanpa gula');
});

test('kosong/spasi saja/null disimpan NULL, bukan string kosong', async () => {
  const p = payloadOrder({ customerName: '   ', tableNumber: null, note: '' });
  const res = await kirim(p);
  assert.equal(res.statusCode, 201, res.body);
  assert.deepEqual(await barisOrder(p.id), { customer_name: null, table_number: null, note: null });
});

test('⛔ check.label tetap NULL, nama pemesan tidak bocor ke sana', async () => {
  const p = payloadOrder({ customerName: 'Budi', tableNumber: '4', note: 'x' });
  const res = await kirim(p);
  assert.equal(res.statusCode, 201, res.body);
  const rows = await bacaTenant('SELECT label FROM "check" WHERE order_id = $1', [p.id]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, null, 'check.label terisi — P5(b) memutuskan kolom terstruktur, label tetap NULL');
});

test('⛔ N-1: order tanpa ketiga field diterima persis seperti hari ini', async () => {
  const p = payloadOrder();
  const res = await kirim(p);
  assert.equal(res.statusCode, 201, res.body);
  assert.deepEqual(await barisOrder(p.id), { customer_name: null, table_number: null, note: null });
});

test('⛔ nama 41 karakter ditolak 400 dengan pesan domain; tidak ada order tersimpan', async () => {
  const p = payloadOrder({ customerName: 'a'.repeat(41) });
  const res = await kirim(p);
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'VALIDATION_ERROR');
  assert.match(JSON.parse(res.body).error.message, /Nama pemesan maksimal 40 karakter/);
  assert.equal(await barisOrder(p.id), undefined, 'order tersimpan padahal ditolak');
});

test('⛔ meja 17 karakter, catatan 141 karakter, nomor kartu di catatan: ditolak 400', async () => {
  for (const [extra, kode, pola] of [
    [{ tableNumber: 'a'.repeat(17) }, 'VALIDATION_ERROR', /Nomor meja maksimal 16/],
    [{ note: 'a'.repeat(141) }, 'VALIDATION_ERROR', /Catatan maksimal 140/],
    [{ note: 'bayar 4111 1111 1111 1111' }, 'POSSIBLE_CARD_NUMBER', /nomor kartu/],
    [{ customerName: 42 }, 'VALIDATION_ERROR', /harus teks/],
  ]) {
    const res = await kirim(payloadOrder(extra));
    assert.equal(res.statusCode, 400, res.body);
    const b = JSON.parse(res.body);
    assert.equal(b.error.code, kode, res.body);
    assert.match(b.error.message, pola);
  }
});

test('isolasi tenant: customer_name tenant A tidak terbaca B', async () => {
  const p = payloadOrder({ customerName: 'Rahasia A', tableNumber: '7', note: 'catatan A' });
  assert.equal((await kirim(p)).statusCode, 201);
  const lain = await seedTenantBase(appc, { suffix: 'DataPesananB' });
  await appc.query('BEGIN');
  try {
    await appc.query(`SELECT set_config('app.tenant_id', $1, true)`, [lain.tenant.id]);
    const { rows } = await appc.query('SELECT customer_name, table_number, note FROM "order" WHERE id = $1', [p.id]);
    assert.equal(rows.length, 0, 'tenant B membaca order tenant A');
    const semua = await appc.query('SELECT count(*)::int AS n FROM "order" WHERE customer_name IS NOT NULL');
    assert.equal(semua.rows[0].n, 0);
  } finally {
    await appc.query('ROLLBACK');
  }
});

test('⛔ retry dengan idempotency key sama (respons hilang) tidak menduplikasi dan tidak mengubah kolom', async () => {
  const p = payloadOrder({ customerName: 'Budi', tableNumber: '4', note: 'pedas' });
  const key = crypto.randomUUID();
  const pertama = await kirim(p, key);
  assert.equal(pertama.statusCode, 201, pertama.body);
  // Respons pertama "hilang": klien mengirim ulang body yang sama persis.
  for (let i = 0; i < 3; i += 1) {
    const ulang = await kirim(p, key);
    assert.equal(ulang.statusCode, 201, ulang.body);
    assert.equal(JSON.parse(ulang.body).id, p.id);
    assert.equal(JSON.parse(ulang.body).customerName, 'Budi');
  }
  const rows = await bacaTenant('SELECT count(*)::int AS n FROM "order" WHERE id = $1', [p.id]);
  assert.equal(rows[0].n, 1, 'retry menduplikasi order');
  assert.deepEqual(await barisOrder(p.id), { customer_name: 'Budi', table_number: '4', note: 'pedas' });
  // Key sama dengan nama BERBEDA = body berbeda -> 422, kolom tidak berubah.
  const beda = await kirim({ ...p, customerName: 'Siti' }, key);
  assert.equal(beda.statusCode, 422, beda.body);
  assert.equal((await barisOrder(p.id)).customer_name, 'Budi');
});

test('constraint kolom: CHECK panjang ada di database (40/16/140), bukan hanya di handler', async () => {
  for (const [kolom, maks] of [['customer_name', 40], ['table_number', 16], ['note', 140]]) {
    const { rows } = await owner.query(
      `SELECT pg_get_constraintdef(c.oid) AS def FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname = 'order' AND c.contype = 'c' AND pg_get_constraintdef(c.oid) LIKE $1`,
      [`%length(${kolom})%`]
    );
    assert.equal(rows.length, 1, `CHECK length(${kolom}) tidak ada`);
    assert.match(rows[0].def, new RegExp(`<= ${maks}\\b`), `batas ${kolom} bukan ${maks}: ${rows[0].def}`);
  }
});

test('⛔ field tak dikenal diterima dan DIABAIKAN (perilaku server lama terhadap klien baru; RUNBOOK §7.4)', async () => {
  // Server sebelum 0037 tidak mengenal customerName/tableNumber/note. Bila POST /orders menolak
  // field asing, klien baru di atas server lama berhenti `gagal-permanen`; kenyataannya server
  // MENERIMA dan MEMBUANG-nya, sehingga data hilang diam-diam. Runbook menyatakan yang kedua.
  const p = payloadOrder({ fieldDariMasaDepan: 'x', customerName: 'Budi' });
  const res = await kirim(p);
  assert.equal(res.statusCode, 201, `field asing ditolak: ${res.body}`);
  assert.equal('fieldDariMasaDepan' in JSON.parse(res.body), false);
  assert.equal((await barisOrder(p.id)).customer_name, 'Budi');
});
