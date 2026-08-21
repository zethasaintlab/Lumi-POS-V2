'use strict';

// FR-D7 — no-sale di server (`POST /shifts/{shiftId}/no-sale`).
//
// ⛔ Yang paling penting diuji: ambangnya dihitung dari `audit_event`, bukan
// dari kolom hitungan. Kolom hitungan adalah angka kedua yang harus dijaga
// sepakat dengan jejaknya, dan yang menyimpang di antaranya tidak dapat
// diputuskan mana yang benar — jejak audit yang dipercaya laporan exception,
// jadi jejak itu juga yang harus menentukan ambang.

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
  base = await seedTenantBase(db, { suffix: 'NoSale' });
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

const noSale = (shiftId, payload = {}, ubah = {}) =>
  app.inject({
    method: 'POST',
    url: `/shifts/${shiftId}/no-sale`,
    headers: { 'idempotency-key': crypto.randomUUID(), ...hdr(ubah) },
    payload: { id: crypto.randomUUID(), reasonCode: 'tukar_uang', ...payload },
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

// ---------------------------------------------------------------------------

test('no-sale menulis audit event dengan aktor, alasan, dan shift', async () => {
  const id = await shift();
  const res = await noSale(id, { reasonCode: 'setor_ke_brankas', reasonNote: 'ke brankas' });
  assert.equal(res.statusCode, 201, res.body);
  const body = JSON.parse(res.body);
  assert.equal(body.urutan, 1);
  assert.equal(body.butuhPenyetuju, false);

  const [row] = await query(
    `SELECT actor_user_id, approver_user_id, event_type, entity_type, entity_id,
            reason_code, reason_note, outlet_id, device_id
       FROM audit_event WHERE id = $1`,
    [body.id]
  );
  assert.equal(row.actor_user_id, base.user.id);
  assert.equal(row.approver_user_id, null);
  assert.equal(row.event_type, 'cash_drawer_opened');
  assert.equal(row.entity_type, 'cash_drawer_shift');
  assert.equal(row.entity_id, id);
  assert.equal(row.reason_code, 'setor_ke_brankas');
  assert.equal(row.reason_note, 'ke brankas');
  assert.equal(row.outlet_id, outletId);
  assert.equal(row.device_id, device);
});

test('⛔ TIDAK menulis cash_movement — no-sale tidak memindahkan uang', async () => {
  const id = await shift();
  assert.equal((await noSale(id)).statusCode, 201);
  const rows = await query('SELECT id FROM cash_movement WHERE shift_id = $1', [id]);
  assert.deepEqual(rows, []);
});

test('⛔ pembukaan ke-4 menuntut X-Approver-Id; tiga pertama tidak', async () => {
  const id = await shift();
  for (let n = 1; n <= 3; n += 1) {
    const res = await noSale(id);
    assert.equal(res.statusCode, 201, `pembukaan ke-${n}: ${res.body}`);
    assert.equal(JSON.parse(res.body).urutan, n);
  }

  const keempat = await noSale(id);
  assert.equal(keempat.statusCode, 403, keempat.body);
  const err = JSON.parse(keempat.body).error;
  assert.equal(err.code, 'APPROVAL_REQUIRED');
  // ⛔ Pesan MEMBAWA urutannya. Kasir yang dimintai PIN tanpa penjelasan akan
  // menyimpulkan aplikasinya rusak.
  assert.match(err.message, /ke-4/);

  const disetujui = await noSale(id, {}, { 'x-approver-id': manajer });
  assert.equal(disetujui.statusCode, 201, disetujui.body);
  const [row] = await query('SELECT approver_user_id FROM audit_event WHERE id = $1', [
    JSON.parse(disetujui.body).id,
  ]);
  assert.equal(row.approver_user_id, manajer);
});

test('⛔ ambang dihitung dari audit_event — bukan dari kolom hitungan', async () => {
  // Jejaknya sendiri yang menentukan. Baris audit yang disisipkan langsung
  // (mis. dari perangkat lain yang antreannya terkuras) ikut terhitung.
  const id = await shift();
  for (let n = 0; n < 3; n += 1) {
    await query(
      `INSERT INTO audit_event
         (id, tenant_id, outlet_id, device_id, actor_user_id, event_type, entity_type,
          entity_id, reason_code, occurred_at, hlc)
       VALUES ($1,$2,$3,$4,$5,'cash_drawer_opened','cash_drawer_shift',$6,'tukar_uang',now(),1)`,
      [crypto.randomUUID(), tenant.id, outletId, device, base.user.id, id]
    );
  }
  const res = await noSale(id);
  assert.equal(res.statusCode, 403, 'ambang harus melihat baris yang sudah ada');
});

test('penyetuju TIDAK BOLEH sama dengan aktor — ditolak DATABASE', async () => {
  const id = await shift();
  for (let n = 0; n < 3; n += 1) assert.equal((await noSale(id)).statusCode, 201);
  const res = await noSale(id, {}, { 'x-approver-id': base.user.id });
  // `audit_event` punya `CHECK (approver_user_id IS NULL OR actor <> approver)`.
  assert.ok(res.statusCode >= 400, `seharusnya ditolak: ${res.body}`);
});

test('shift yang sudah DITUTUP menolak dengan 409', async () => {
  const id = await shift({ status: 'closed' });
  const res = await noSale(id);
  assert.equal(res.statusCode, 409, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'SHIFT_NOT_OPEN');
});

test('shift tenant lain tidak ditemukan (RLS), bukan ditolak', async () => {
  const res = await noSale(crypto.randomUUID());
  assert.equal(res.statusCode, 404, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'SHIFT_NOT_FOUND');
});

test('⛔ alasan di luar daftar ditolak, dan pesannya MENYEBUT pilihannya', async () => {
  const { ALASAN_NO_SALE } = await import('../../packages/domain/src/no-sale.ts');
  const id = await shift();
  for (const buruk of ['barang_rusak', 'TUKAR_UANG', '', null]) {
    const res = await noSale(id, { reasonCode: buruk });
    assert.equal(res.statusCode, 400, `${String(buruk)}: ${res.body}`);
    const pesan = JSON.parse(res.body).error.message;
    for (const a of ALASAN_NO_SALE) {
      assert.ok(pesan.includes(a), `pesan tidak menyebut ${a}`);
    }
  }
});

test('⛔ retry dengan Idempotency-Key yang SAMA tidak menghasilkan pembukaan kedua', async () => {
  const id = await shift();
  const key = crypto.randomUUID();
  const payload = { id: crypto.randomUUID(), reasonCode: 'periksa_laci' };

  const kirim = () =>
    app.inject({
      method: 'POST',
      url: `/shifts/${id}/no-sale`,
      headers: { 'idempotency-key': key, ...hdr() },
      payload,
    });

  const satu = await kirim();
  assert.equal(satu.statusCode, 201, satu.body);
  const dua = await kirim();
  // Retry mengembalikan respons ASLI, bukan pembukaan kedua — kalau tidak,
  // ambang PIN bergeser karena retry, bukan karena kasir.
  assert.equal(JSON.parse(dua.body).urutan, 1);

  const rows = await query(
    `SELECT id FROM audit_event WHERE event_type = 'cash_drawer_opened' AND entity_id = $1`,
    [id]
  );
  assert.equal(rows.length, 1, 'retry menghasilkan pembukaan kedua');
});

test('Idempotency-Key yang hilang ditolak 400', async () => {
  const id = await shift();
  const res = await app.inject({
    method: 'POST',
    url: `/shifts/${id}/no-sale`,
    headers: hdr(),
    payload: { id: crypto.randomUUID(), reasonCode: 'tukar_uang' },
  });
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'MISSING_IDEMPOTENCY_KEY');
});

test('outbox event dipancarkan untuk setiap pembukaan', async () => {
  const id = await shift();
  assert.equal((await noSale(id)).statusCode, 201);
  const rows = await query(
    `SELECT event_type FROM outbox WHERE aggregate_id = $1 AND event_type = 'cash_drawer.no_sale'`,
    [id]
  );
  assert.equal(rows.length, 1);
});

test('⛔ AKUNTAN ditolak — `spec-f:82` melarangnya melakukan mutasi apa pun', async () => {
  // Rute ini sengaja TIDAK di `PETA_PERAN` (lihat `DIKECUALIKAN`): kasir
  // BOLEH membukanya, dan setiap entri peta itu diuji MENOLAK kasir. Yang
  // menutup akuntan karena itu adalah `assertBoleh` di handler — dan tanpa
  // test ini, klaim itu hanya komentar.
  const akuntan = crypto.randomUUID();
  await query(
    `INSERT INTO "user" (id, tenant_id, name, is_active) VALUES ($1,$2,'Akuntan',true)`,
    [akuntan, tenant.id]
  );
  await query(
    `INSERT INTO user_role (id, tenant_id, user_id, role, scope_type, scope_id)
     VALUES ($1,$2,$3,'accountant','tenant',$4)`,
    [crypto.randomUUID(), tenant.id, akuntan, tenant.id]
  );
  // ⛔ SESI, bukan header. `getActorId` mengabaikan `X-Actor-Id` sepenuhnya di
  // rute terlindungi — itu yang mengubahnya dari klaim menjadi bukti. Test
  // yang hanya mengganti headernya menguji owner, bukan akuntan.
  const token = await buatSesi(db, { tenantId: tenant.id, userId: akuntan });

  const id = await shift();
  const res = await noSale(id, {}, { authorization: `Bearer ${token}` });
  assert.equal(res.statusCode, 403, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'FORBIDDEN');

  // Dan tidak ada yang tertulis.
  const rows = await query(
    `SELECT id FROM audit_event WHERE event_type = 'cash_drawer_opened' AND entity_id = $1`,
    [id]
  );
  assert.deepEqual(rows, []);
});

test('kasir BOLEH membuka laci — itu jalur normalnya', async () => {
  const kasir = crypto.randomUUID();
  await query(
    `INSERT INTO "user" (id, tenant_id, name, is_active) VALUES ($1,$2,'Kasir',true)`,
    [kasir, tenant.id]
  );
  await query(
    `INSERT INTO user_role (id, tenant_id, user_id, role, scope_type, scope_id)
     VALUES ($1,$2,$3,'cashier','outlet',$4)`,
    [crypto.randomUUID(), tenant.id, kasir, outletId]
  );
  const token = await buatSesi(db, { tenantId: tenant.id, userId: kasir });

  const id = await shift();
  const res = await noSale(id, {}, { authorization: `Bearer ${token}` });
  assert.equal(res.statusCode, 201, res.body);
});
