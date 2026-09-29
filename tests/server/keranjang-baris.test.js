'use strict';

// Task 5C — `POST /shifts/{shiftId}/cart-line-reduced` (jejak audit Edit Item
// yang menurunkan qty atau menghapus baris; issue #76, Q2). Saudara
// `cart-cleared`. Yang ditulis endpoint ini hanya JEJAK — satu `audit_event`,
// tanpa `order`, `payment`, `cash_movement`. Angka dicatat SEBAGAIMANA
// DILAPORKAN perangkat.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');
const { buatSesi } = require('../isolation/helpers/sesi');

let owner, db, app, base, tenant, outletId, device, manajer;

before(async () => {
  owner = await connectAsOwner();
  db = await connectAsApp();
});

after(async () => {
  await resetAll(owner);
  await owner.end();
  await db.end();
  if (app) await app.close();
});

const hdr = (ubah = {}) => ({
  'x-tenant-id': tenant.id,
  authorization: base.authHeader,
  'x-actor-id': base.user.id,
  'content-type': 'application/json',
  ...ubah,
});

beforeEach(async () => {
  await db.query('ROLLBACK').catch(() => {});
  await resetAll(owner);
  base = await seedTenantBase(db, { suffix: 'KurangBaris' });
  tenant = base.tenant;
  outletId = base.outlet.id;

  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();

  device = crypto.randomUUID();
  manajer = crypto.randomUUID();
  await db.query('BEGIN');
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await db.query(
    `INSERT INTO device (id, tenant_id, outlet_id, code, name, platform, app_version, schema_version)
     VALUES ($1,$2,$3,'K1','K1','tauri','0','1')`,
    [device, tenant.id, outletId]
  );
  // Penyetuju harus user LAIN: `audit_event` punya CHECK yang menolak aktor
  // menyetujui dirinya sendiri.
  await db.query(
    `INSERT INTO "user" (id, tenant_id, name, is_active) VALUES ($1,$2,'Manajer',true)`,
    [manajer, tenant.id]
  );
  await db.query(
    `INSERT INTO user_role (id, tenant_id, user_id, role, scope_type, scope_id)
     VALUES ($1,$2,$3,'outlet_manager','outlet',$4)`,
    [crypto.randomUUID(), tenant.id, manajer, outletId]
  );
  await db.query('COMMIT');
});

async function shift({ status = 'open' } = {}) {
  const id = crypto.randomUUID();
  await db.query('BEGIN');
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await db.query(
    `INSERT INTO cash_drawer_shift (id, tenant_id, outlet_id, device_id, business_date, status, opening_float, opened_by)
     VALUES ($1,$2,$3,$4,'2026-08-21',$5,100000,$6)`,
    [id, tenant.id, outletId, device, status, base.user.id]
  );
  await db.query('COMMIT');
  return id;
}


const kirim = (shiftId, payload = {}, ubah = {}, key = crypto.randomUUID()) =>
  app.inject({
    method: 'POST',
    url: `/shifts/${shiftId}/cart-line-reduced`,
    headers: { 'idempotency-key': key, ...hdr(ubah) },
    payload: {
      id: crypto.randomUUID(),
      variationId: 'var-kopi',
      itemName: 'Kopi Susu',
      variationName: 'Regular',
      quantityBeforeMilli: 3000,
      quantityAfterMilli: 1000,
      unitPrice: '30000',
      reducedValue: '60000',
      occurredAt: '2026-09-28T03:00:00.000Z',
      hlc: '123',
      ...payload,
    },
  });

async function query(sql, params) {
  await db.query('BEGIN');
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  try {
    const { rows } = await db.query(sql, params);
    await db.query('COMMIT');
    return rows;
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  }
}

const jumlahAudit = async (shiftId) =>
  (await query(`SELECT id FROM audit_event WHERE event_type = 'cart_line_reduced' AND entity_id = $1`, [shiftId])).length;

// ---------------------------------------------------------------------------

test('⛔ cart-line-reduced menulis SATU audit_event dengan aktor dan after lengkap', async () => {
  const id = await shift();
  const idAudit = crypto.randomUUID();
  const res = await kirim(id, { id: idAudit });
  assert.equal(res.statusCode, 201, res.body);

  const rows = await query(
    `SELECT id, actor_user_id, approver_user_id, event_type, entity_type, entity_id, after,
            outlet_id, device_id, occurred_at, recorded_at, hlc::text AS hlc
       FROM audit_event WHERE event_type = 'cart_line_reduced' AND entity_id = $1`,
    [id]
  );
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.id, idAudit, 'audit_event.id harus = body.id');
  assert.equal(r.actor_user_id, base.user.id);
  assert.equal(r.approver_user_id, null);
  assert.equal(r.entity_type, 'cash_drawer_shift');
  assert.equal(r.outlet_id, outletId);
  assert.equal(r.device_id, device);
  assert.deepEqual(r.after, {
    variation_id: 'var-kopi', item_name: 'Kopi Susu', variation_name: 'Regular',
    quantity_before_milli: 3000, quantity_after_milli: 1000,
    unit_price: '30000', reduced_value: '60000',
  });
  assert.equal(new Date(r.occurred_at).toISOString(), '2026-09-28T03:00:00.000Z');
  assert.notEqual(r.recorded_at, null, 'recorded_at (server) harus terisi');
  assert.notEqual(r.hlc, null);
});

test('⛔ baris dihapus (quantityAfterMilli = 0) diterima dan tersimpan sebagai 0', async () => {
  const id = await shift();
  const res = await kirim(id, { quantityAfterMilli: 0, reducedValue: '90000' });
  assert.equal(res.statusCode, 201, res.body);
  const [r] = await query(`SELECT after FROM audit_event WHERE event_type = 'cart_line_reduced' AND entity_id = $1`, [id]);
  assert.equal(r.after.quantity_after_milli, 0);
});

test('⛔ uang di atas 2^53 tetap tepat di after (string, bukan number)', async () => {
  const id = await shift();
  const res = await kirim(id, { unitPrice: '9007199254740993', reducedValue: '9007199254740994' });
  assert.equal(res.statusCode, 201, res.body);
  const [r] = await query(`SELECT after FROM audit_event WHERE event_type = 'cart_line_reduced' AND entity_id = $1`, [id]);
  assert.equal(r.after.unit_price, '9007199254740993');
  assert.equal(r.after.reduced_value, '9007199254740994');
});

test('⛔ retry berulang DAN respons hilang: satu baris', async () => {
  const id = await shift();
  const key = crypto.randomUUID();
  const payload = { id: crypto.randomUUID() };
  const satu = await kirim(id, payload, {}, key);
  assert.equal(satu.statusCode, 201, satu.body);
  const dua = await kirim(id, payload, {}, key);
  const tiga = await kirim(id, payload, {}, key);
  assert.equal(dua.statusCode, 201, dua.body);
  assert.equal(tiga.statusCode, 201, tiga.body);
  assert.deepEqual(JSON.parse(dua.body), JSON.parse(satu.body));
  assert.equal(await jumlahAudit(id), 1, 'retry menghasilkan lebih dari satu audit_event');
});

test('⛔ shift yang sudah DITUTUP tetap diterima', async () => {
  const id = await shift({ status: 'closed' });
  const res = await kirim(id);
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(await jumlahAudit(id), 1);
});

test('isolasi tenant: shift tenant B → 404, nol baris', async () => {
  const lain = await seedTenantBase(db, { suffix: 'KurangLain' });
  const id = await shift();
  const res = await app.inject({
    method: 'POST',
    url: `/shifts/${id}/cart-line-reduced`,
    headers: {
      'idempotency-key': crypto.randomUUID(),
      'x-tenant-id': lain.tenant.id,
      authorization: lain.authHeader,
      'x-actor-id': lain.user.id,
      'content-type': 'application/json',
    },
    payload: {
      id: crypto.randomUUID(), variationId: 'v', itemName: 'K', variationName: 'R',
      quantityBeforeMilli: 2000, quantityAfterMilli: 1000, unitPrice: '1000', reducedValue: '1000',
    },
  });
  assert.equal(res.statusCode, 404, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'SHIFT_NOT_FOUND');
  assert.equal(await jumlahAudit(id), 0);
});

test('uang bukan digit (negatif, desimal, kosong, teks, null) → 400 VALIDATION_ERROR', async () => {
  const id = await shift();
  for (const kolom of ['unitPrice', 'reducedValue']) {
    for (const buruk of ['12.5', '-100', '', 'seratus', null]) {
      const res = await kirim(id, { [kolom]: buruk });
      assert.equal(res.statusCode, 400, `${kolom}=${String(buruk)}: ${res.body}`);
      assert.equal(JSON.parse(res.body).error.code, 'VALIDATION_ERROR');
    }
  }
  assert.equal(await jumlahAudit(id), 0);
});

test('qty tak sah: nol/negatif/desimal sebelum, negatif/desimal sesudah, sesudah >= sebelum → 400', async () => {
  const id = await shift();
  for (const p of [
    { quantityBeforeMilli: 0, quantityAfterMilli: 0 },
    { quantityBeforeMilli: -1000 }, { quantityBeforeMilli: 3000.5 }, { quantityBeforeMilli: 'tiga' },
    { quantityAfterMilli: -1 }, { quantityAfterMilli: 0.5 },
    { quantityAfterMilli: 3000 }, { quantityAfterMilli: 4000 },
  ]) {
    const res = await kirim(id, p);
    assert.equal(res.statusCode, 400, `${JSON.stringify(p)}: ${res.body}`);
  }
  assert.equal(await jumlahAudit(id), 0);
});

test('id / variationId / itemName / variationName / hlc tak sah → 400; tanpa Idempotency-Key → 400', async () => {
  const id = await shift();
  for (const p of [
    { id: '' }, { variationId: '' }, { itemName: '' }, { variationName: '' }, { hlc: 'abc' },
  ]) {
    const res = await kirim(id, p);
    assert.equal(res.statusCode, 400, `${JSON.stringify(p)}: ${res.body}`);
  }
  const tanpaKey = await app.inject({
    method: 'POST',
    url: `/shifts/${id}/cart-line-reduced`,
    headers: hdr(),
    payload: {
      id: crypto.randomUUID(), variationId: 'v', itemName: 'K', variationName: 'R',
      quantityBeforeMilli: 2000, quantityAfterMilli: 0, unitPrice: '1', reducedValue: '2',
    },
  });
  assert.equal(tanpaKey.statusCode, 400);
  assert.equal(JSON.parse(tanpaKey.body).error.code, 'MISSING_IDEMPOTENCY_KEY');
  assert.equal(await jumlahAudit(id), 0);
});

test('⛔ jalur perangkat tanpa sesi diterima (relay offline tidak mengirim Bearer)', async () => {
  const id = await shift();
  const res = await app.inject({
    method: 'POST',
    url: `/shifts/${id}/cart-line-reduced`,
    headers: {
      'idempotency-key': crypto.randomUUID(),
      'x-tenant-id': tenant.id,
      'x-actor-id': base.user.id,
      'content-type': 'application/json',
    },
    payload: {
      id: crypto.randomUUID(), variationId: 'v', itemName: 'K', variationName: 'R',
      quantityBeforeMilli: 2000, quantityAfterMilli: 0, unitPrice: '5000', reducedValue: '10000',
    },
  });
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(await jumlahAudit(id), 1);
});

test('⛔ AKUNTAN ditolak — `spec-f:82`, dan tidak ada yang tertulis', async () => {
  const akuntan = crypto.randomUUID();
  await query(`INSERT INTO "user" (id, tenant_id, name, is_active) VALUES ($1,$2,'Akuntan',true)`, [akuntan, tenant.id]);
  await query(
    `INSERT INTO user_role (id, tenant_id, user_id, role, scope_type, scope_id)
     VALUES ($1,$2,$3,'accountant','tenant',$4)`,
    [crypto.randomUUID(), tenant.id, akuntan, tenant.id]
  );
  const token = await buatSesi(db, { tenantId: tenant.id, userId: akuntan });
  const id = await shift();
  const res = await kirim(id, {}, { authorization: `Bearer ${token}` });
  assert.equal(res.statusCode, 403, res.body);
  assert.equal(await jumlahAudit(id), 0);
});

test('tidak menulis cash_movement, order, atau payment', async () => {
  const id = await shift();
  assert.equal((await kirim(id)).statusCode, 201);
  assert.equal((await query('SELECT id FROM cash_movement WHERE shift_id = $1', [id])).length, 0);
  assert.equal((await query('SELECT id FROM "order" WHERE shift_id = $1', [id])).length, 0);
  assert.equal((await query('SELECT id FROM payment')).length, 0);
});

// ---------------------------------------------------------------------------
// Idempotensi: key + body dibandingkan, bukan key saja.
// ---------------------------------------------------------------------------

test('⛔ (a) key sama + body sama → respons sama, tetap SATU audit_event', async () => {
  const id = await shift();
  const key = crypto.randomUUID();
  const payload = { id: crypto.randomUUID() };
  const satu = await kirim(id, payload, {}, key);
  const dua = await kirim(id, payload, {}, key);
  assert.equal(satu.statusCode, 201, satu.body);
  assert.equal(dua.statusCode, 201, dua.body);
  assert.deepEqual(JSON.parse(dua.body), JSON.parse(satu.body));
  assert.equal(await jumlahAudit(id), 1);
});

test('⛔ (b) key sama + body BERBEDA → 422 IDEMPOTENCY_KEY_HASH_MISMATCH, nol baris kedua', async () => {
  const id = await shift();
  const key = crypto.randomUUID();
  const pertama = { id: crypto.randomUUID() };
  const kedua = { id: crypto.randomUUID(), quantityAfterMilli: 0, reducedValue: '90000' };
  assert.equal((await kirim(id, pertama, {}, key)).statusCode, 201);
  const res = await kirim(id, kedua, {}, key);
  assert.equal(res.statusCode, 422, `key sama + body beda tidak ditolak sebagai mismatch idempotensi: ${res.statusCode} ${res.body}`);
  assert.equal(JSON.parse(res.body).error.code, 'IDEMPOTENCY_KEY_HASH_MISMATCH');
  assert.equal(await jumlahAudit(id), 1, 'baris kedua tertulis');
  const [ada] = await query(`SELECT count(*)::int AS n FROM audit_event WHERE id = $1`, [kedua.id]);
  assert.equal(ada.n, 0);
});

test('⛔ (b2) body beda HANYA pada satu field (id sama) tetap mismatch — SETIAP field ada di hash', async () => {
  const kasus = [
    ['variationId', { variationId: 'var-lain' }],
    ['itemName', { itemName: 'Teh' }],
    ['variationName', { variationName: 'Large' }],
    ['quantityBeforeMilli', { quantityBeforeMilli: 4000, reducedValue: '60000' }],
    ['quantityAfterMilli', { quantityAfterMilli: 2000 }],
    ['unitPrice', { unitPrice: '31000' }],
    ['reducedValue', { reducedValue: '61000' }],
    ['occurredAt', { occurredAt: '2026-09-28T04:00:00.000Z' }],
  ];
  const id = await shift();
  for (const [nama, beda] of kasus) {
    const key = crypto.randomUUID();
    const idAudit = crypto.randomUUID();
    assert.equal((await kirim(id, { id: idAudit }, {}, key)).statusCode, 201);
    const res = await kirim(id, { id: idAudit, ...beda }, {}, key);
    assert.equal(res.statusCode, 422, `${nama} beda tidak terdeteksi sebagai mismatch idempotensi: ${res.statusCode} ${res.body}`);
    assert.equal(JSON.parse(res.body).error.code, 'IDEMPOTENCY_KEY_HASH_MISMATCH');
  }
});

test('⛔ (c) dua request BERSAMAAN, key sama → satu 201 dan satu 409 IDEMPOTENCY_KEY_CONFLICT, bukan 500', async () => {
  const id = await shift();
  const key = crypto.randomUUID();
  const payload = { id: crypto.randomUUID() };
  await Promise.all([
    app.inject({ method: 'GET', url: `/orders/${crypto.randomUUID()}`, headers: hdr() }),
    app.inject({ method: 'GET', url: `/orders/${crypto.randomUUID()}`, headers: hdr() }),
  ]);
  const [a, b] = await Promise.all([kirim(id, payload, {}, key), kirim(id, payload, {}, key)]);
  const status = [a.statusCode, b.statusCode].sort();
  assert.deepEqual(status, [201, 409], `dapat ${JSON.stringify(status)}: ${a.body} | ${b.body}`);
  const kalah = a.statusCode === 409 ? a : b;
  assert.equal(JSON.parse(kalah.body).error.code, 'IDEMPOTENCY_KEY_CONFLICT');
  assert.equal(await jumlahAudit(id), 1);
});

test('occurredAt rusak → 400 VALIDATION_ERROR, bukan 500', async () => {
  const id = await shift();
  for (const buruk of [
    'bukan-tanggal', '2026-13-45', '   ',
    '2026-02-30T00:00:00Z', '2026-04-31T10:00:00Z', '2026-09-28T03:00:00',
  ]) {
    const res = await kirim(id, { occurredAt: buruk });
    assert.equal(res.statusCode, 400, `${buruk}: ${res.statusCode} ${res.body}`);
    assert.equal(JSON.parse(res.body).error.code, 'VALIDATION_ERROR');
  }
  assert.equal(await jumlahAudit(id), 0);
});

test('⛔ aktor tersimpan = staf sesi yang mengirim (bukan user sah lain)', async () => {
  const token = await buatSesi(db, { tenantId: tenant.id, userId: manajer });
  const id = await shift();
  const res = await kirim(id, {}, { authorization: `Bearer ${token}` });
  assert.equal(res.statusCode, 201, res.body);
  const [r] = await query(
    `SELECT actor_user_id FROM audit_event WHERE event_type = 'cart_line_reduced' AND entity_id = $1`,
    [id]
  );
  assert.equal(r.actor_user_id, manajer, `aktor tersimpan ${r.actor_user_id}, harap staf sesi ${manajer}`);
  assert.notEqual(r.actor_user_id, base.user.id);
});

test('⛔ cart-cleared dan cart-line-reduced TIDAK saling menjawab: key yang sama lintas rute → mismatch, bukan respons rute lain', async () => {
  const id = await shift();
  const key = crypto.randomUUID();
  const batal = await app.inject({
    method: 'POST',
    url: `/shifts/${id}/cart-cleared`,
    headers: { 'idempotency-key': key, ...hdr() },
    payload: { id: crypto.randomUUID(), lineCount: 1, quantityMilli: 1000, total: '1000' },
  });
  assert.equal(batal.statusCode, 201, batal.body);
  const res = await kirim(id, {}, {}, key);
  assert.equal(res.statusCode, 422, res.body);
  assert.equal(await jumlahAudit(id), 0);
});

test('⛔ key + isi SAMA tetapi shift BERBEDA → 422 (shiftId ada di hash), bukan respons shift pertama', async () => {
  const a = await shift();
  // Shift kedua di perangkat lain (`ux_shift_one_open_per_device`): tertutup, dan tetap diterima.
  const perangkat2 = crypto.randomUUID();
  await query(
    `INSERT INTO device (id, tenant_id, outlet_id, code, name, platform, app_version, schema_version)
     VALUES ($1,$2,$3,'K2','K2','tauri','0','1')`,
    [perangkat2, tenant.id, outletId]
  );
  const b = crypto.randomUUID();
  await query(
    `INSERT INTO cash_drawer_shift (id, tenant_id, outlet_id, device_id, business_date, status, opening_float, opened_by)
     VALUES ($1,$2,$3,$4,'2026-08-21','closed',100000,$5)`,
    [b, tenant.id, outletId, perangkat2, base.user.id]
  );
  const key = crypto.randomUUID();
  const payload = { id: crypto.randomUUID() };
  assert.equal((await kirim(a, payload, {}, key)).statusCode, 201);
  const res = await kirim(b, payload, {}, key);
  assert.equal(res.statusCode, 422, `key + isi sama di shift lain dijawab ${res.statusCode}: shiftId tidak ada di hash — ${res.body}`);
  assert.equal(await jumlahAudit(b), 0);
});
