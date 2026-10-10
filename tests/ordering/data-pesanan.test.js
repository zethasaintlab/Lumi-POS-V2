'use strict';

// Nama pemesan, nomor meja, catatan (sub-proyek 2 Kasir, PR 2C Task 11;
// keputusan user P5 + P6, 28 September 2026). Tiga kolom opsional `order`
// dari migrasi 0037. Klien N-1 tidak mengirimnya dan tidak boleh patah;
// `check.label` tetap NULL.

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

function headers(extra = {}) {
  return { 'x-tenant-id': tenant.id, authorization: base.authHeader, 'x-actor-id': base.user.id, ...extra };
}
function req(payload, extra = {}) {
  return app.inject({ method: 'POST', url: '/orders', payload, headers: headers({ 'idempotency-key': crypto.randomUUID(), ...extra }) });
}
async function setup() {
  const dev = await app.inject({
    method: 'POST', url: '/devices',
    payload: { id: crypto.randomUUID(), outletId: base.outlet.id, code: 'KP1' },
    headers: { 'x-tenant-id': tenant.id, authorization: base.authHeader },
  });
  assert.equal(dev.statusCode, 201, dev.body);
  const device = JSON.parse(dev.body);
  const sh = await app.inject({
    method: 'POST', url: '/shifts',
    payload: { id: crypto.randomUUID(), outletId: base.outlet.id, deviceId: device.id, businessDate: BUSINESS_DATE, openingFloat: 100000 },
    headers: headers(),
  });
  assert.equal(sh.statusCode, 201, sh.body);
  return { device, shift: JSON.parse(sh.body) };
}
function payload({ device, shift }, extra = {}) {
  return {
    id: crypto.randomUUID(),
    outletId: base.outlet.id,
    deviceId: device.id,
    shiftId: shift.id,
    receiptNumber: 'K1-20260802-0001',
    businessDate: BUSINESS_DATE,
    sequence: 1,
    channel: 'takeaway',
    checkId: crypto.randomUUID(),
    lines: [{ id: crypto.randomUUID(), variationId: base.item_variation.id, quantityMilli: 1000, discountAmount: 0 }],
    ...extra,
  };
}
async function dalamTenant(tenantId, sql, params) {
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
  const { rows } = await appSetup.query(sql, params);
  await appSetup.query('COMMIT');
  return rows;
}
const BACA_ORDER = 'SELECT customer_name, table_number, note FROM "order" WHERE id = $1';

test('customerName, tableNumber, note masuk kolom order masing-masing', async () => {
  const p = payload(await setup(), { customerName: '  Budi  ', tableNumber: 'A-12', note: 'tanpa es' });
  const res = await req(p);
  assert.equal(res.statusCode, 201, res.body);
  const [row] = await dalamTenant(tenant.id, BACA_ORDER, [p.id]);
  assert.deepEqual(row, { customer_name: 'Budi', table_number: 'A-12', note: 'tanpa es' });
});

test('⛔ check.label tetap NULL', async () => {
  const p = payload(await setup(), { customerName: 'Budi', tableNumber: 'A-12', note: 'tanpa es' });
  assert.equal((await req(p)).statusCode, 201);
  const rows = await dalamTenant(tenant.id, 'SELECT label FROM "check" WHERE id = $1', [p.checkId]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, null, 'nama pemesan tidak boleh bocor ke check.label');
});

test('⛔ N-1: order tanpa ketiga field diterima persis seperti hari ini', async () => {
  const p = payload(await setup());
  const res = await req(p);
  assert.equal(res.statusCode, 201, res.body);
  const [row] = await dalamTenant(tenant.id, BACA_ORDER, [p.id]);
  assert.deepEqual(row, { customer_name: null, table_number: null, note: null });
  // null dan spasi saja juga "tidak diisi", bukan galat.
  const q = payload(await setup2(), { customerName: null, tableNumber: '   ', note: '' });
  assert.equal((await req(q)).statusCode, 201);
  const [r2] = await dalamTenant(tenant.id, BACA_ORDER, [q.id]);
  assert.deepEqual(r2, { customer_name: null, table_number: null, note: null });
});
async function setup2() {
  // Perangkat kedua pada tenant yang sama (nomor struk sama boleh di device lain).
  const dev = await app.inject({
    method: 'POST', url: '/devices',
    payload: { id: crypto.randomUUID(), outletId: base.outlet.id, code: 'KP2' },
    headers: { 'x-tenant-id': tenant.id, authorization: base.authHeader },
  });
  const device = JSON.parse(dev.body);
  const sh = await app.inject({
    method: 'POST', url: '/shifts',
    payload: { id: crypto.randomUUID(), outletId: base.outlet.id, deviceId: device.id, businessDate: BUSINESS_DATE, openingFloat: 0 },
    headers: headers(),
  });
  return { device, shift: JSON.parse(sh.body) };
}

test('⛔ nama 41 karakter ditolak 400 dengan pesan domain; meja 17 dan catatan 141 juga', async () => {
  const s = await setup();
  for (const [field, panjang, batas] of [['customerName', 41, 40], ['tableNumber', 17, 16], ['note', 141, 140]]) {
    const p = payload(s, { [field]: 'a'.repeat(panjang) });
    const res = await req(p);
    assert.equal(res.statusCode, 400, `${field}: ${res.body}`);
    const err = JSON.parse(res.body).error;
    assert.equal(err.code, 'VALIDATION_ERROR');
    assert.match(err.message, new RegExp(String(batas)), `pesan ${field} menyebut ${batas}`);
    assert.deepEqual(await dalamTenant(tenant.id, 'SELECT id FROM "order" WHERE id = $1', [p.id]), []);
  }
});

test('⛔ nomor kartu di nama/meja/catatan → 400 POSSIBLE_CARD_NUMBER', async () => {
  const s = await setup();
  for (const field of ['customerName', 'tableNumber', 'note']) {
    const res = await req(payload(s, { [field]: '4111 1111 1111 1111' }));
    assert.equal(res.statusCode, 400, `${field}: ${res.body}`);
    assert.equal(JSON.parse(res.body).error.code, 'POSSIBLE_CARD_NUMBER');
  }
});

test('isolasi tenant: customer_name tenant A tidak terbaca B', async () => {
  const p = payload(await setup(), { customerName: 'Rahasia A' });
  assert.equal((await req(p)).statusCode, 201);
  const b = await seedTenantBase(appSetup, { suffix: 'DataPesananB' });
  assert.deepEqual(await dalamTenant(b.tenant.id, BACA_ORDER, [p.id]), [], 'tenant B tidak melihat order A');
  assert.equal((await dalamTenant(tenant.id, BACA_ORDER, [p.id]))[0].customer_name, 'Rahasia A');
});

test('⛔ retry dengan idempotency key sama (dan respons hilang) tidak menduplikasi dan tidak mengubah kolom', async () => {
  const p = payload(await setup(), { customerName: 'Budi', tableNumber: '7', note: 'pedas' });
  const key = crypto.randomUUID();
  const first = await req(p, { 'idempotency-key': key });
  assert.equal(first.statusCode, 201, first.body);
  // Respons hilang: perangkat tidak pernah melihat 201 itu dan mengirim ulang, tiga kali.
  for (let i = 0; i < 3; i++) {
    const again = await req(p, { 'idempotency-key': key });
    assert.equal(JSON.parse(again.body).id, p.id);
  }
  assert.equal((await dalamTenant(tenant.id, 'SELECT id FROM "order" WHERE id = $1', [p.id])).length, 1);
  assert.deepEqual((await dalamTenant(tenant.id, BACA_ORDER, [p.id]))[0], { customer_name: 'Budi', table_number: '7', note: 'pedas' });
  // Key sama, isi catatan berbeda = body berbeda: 422, kolom tidak berubah.
  const lain = await req({ ...p, note: 'manis' }, { 'idempotency-key': key });
  assert.equal(lain.statusCode, 422);
  assert.equal((await dalamTenant(tenant.id, BACA_ORDER, [p.id]))[0].note, 'pedas');
});

// Batas ditegakkan DATABASE juga, bukan hanya aplikasi: jalur tulis yang lupa
// memvalidasi tidak boleh menembus. Order contoh disalin dengan INSERT ... SELECT
// (invariant #2: tidak ada UPDATE atas order) lalu satu kolom diisi batas+1.
test('⛔ CHECK database menolak batas+1 langsung di tabel order (23514) untuk ketiga kolom', async () => {
  const p = payload(await setup());
  assert.equal((await req(p)).statusCode, 201);
  const batas = { customer_name: 40, table_number: 16, note: 140 };
  let n = 0;
  for (const [kolom, maks] of Object.entries(batas)) {
    for (const [panjang, harapDitolak] of [[maks, false], [maks + 1, true]]) {
      n += 1;
      await appSetup.query('BEGIN');
      await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
      await appSetup.query('SAVEPOINT s');
      let kode = null;
      try {
        await appSetup.query(
          `INSERT INTO "order" (id, tenant_id, outlet_id, device_id, shift_id, receipt_number, business_date, sequence,
              status, channel, subtotal, order_discount, service_charge_amount, tax_amount, rounding_adjustment,
              total, amount_due, created_by, occurred_at, hlc, ${kolom})
           SELECT $1, tenant_id, outlet_id, device_id, shift_id, 'K1-20260802-' || lpad($2::text, 4, '0'), business_date, $3,
              status, channel, subtotal, order_discount, service_charge_amount, tax_amount, rounding_adjustment,
              total, amount_due, created_by, occurred_at, hlc, repeat('a', $4)
             FROM "order" WHERE id = $5`,
          [crypto.randomUUID(), 100 + n, 100 + n, panjang, p.id]
        );
      } catch (e) {
        kode = e.code;
      }
      await appSetup.query('ROLLBACK');
      assert.equal(kode, harapDitolak ? '23514' : null, `${kolom} ${panjang} karakter: kode ${kode}`);
    }
  }
});
