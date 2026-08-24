'use strict';

// B-24 Profil Vertikal — `GET`/`POST /vertical-profiles`,
// `PATCH /vertical-profiles/{id}`, `PUT /outlets/{id}/vertical-profile`.
// `IA:203`, OQ-09.
//
// ⛔ Dua hal yang diuji lebih keras daripada endpointnya sendiri:
//
// 1. Bawaan tenant tidak dapat DIKOSONGKAN. `resolusiProfil` punya bawaan
//    KERAS untuk perangkat yang katalognya belum turun, dan membiarkan
//    merchant mencabut bawaan tenantnya berarti setiap outlet ber-override
//    NULL diam-diam jatuh ke aturan yang tidak seorang pun pilih.
// 2. Menetapkan bawaan baru MENCABUT yang lama di transaksi yang sama.
//    `ux_vertical_profile_tenant_default` adalah index unik parsial —
//    tanpanya jawabannya 500 dengan nama index di pesannya.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');

let owner, db, app, tenant, base;

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

beforeEach(async () => {
  await db.query('ROLLBACK').catch(() => {});
  await resetAll(owner);
  base = await seedTenantBase(db, { suffix: 'Vertikal' });
  tenant = base.tenant;

  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();
});

async function kueri(sql, params) {
  await db.query('BEGIN');
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  const hasil = await db.query(sql, params);
  await db.query('COMMIT');
  return hasil;
}

const hdr = () => ({ 'x-tenant-id': tenant.id, authorization: base.authHeader });

const daftar = () => app.inject({ method: 'GET', url: '/vertical-profiles', headers: hdr() });

const buat = (body = {}) =>
  app.inject({
    method: 'POST',
    url: '/vertical-profiles',
    payload: { id: crypto.randomUUID(), ...body },
    headers: hdr(),
  });

const ubah = (id, body) =>
  app.inject({ method: 'PATCH', url: `/vertical-profiles/${id}`, payload: body, headers: hdr() });

const setelOutlet = (outletId, body) =>
  app.inject({
    method: 'PUT',
    url: `/outlets/${outletId}/vertical-profile`,
    payload: body,
    headers: hdr(),
  });

/** Profil fixture — dijadikan bawaan tenant supaya resolusinya bermakna. */
async function jadikanBawaan(id) {
  await kueri('UPDATE vertical_profile SET is_tenant_default = true WHERE id = $1', [id]);
}

// ---------------------------------------------------------------------------
// Baca & resolusi
// ---------------------------------------------------------------------------

test('daftar membawa profil DAN resolusi per outlet', async () => {
  await jadikanBawaan(base.vertical_profile.id);
  const res = await daftar();
  assert.equal(res.statusCode, 200, res.body);
  const b = res.json();
  assert.ok(b.profiles.length >= 1);
  assert.ok(b.outlets.length >= 1);
  const o = b.outlets.find((x) => x.id === base.outlet.id);
  assert.equal(o.berlaku.id, base.vertical_profile.id);
  assert.equal(o.berlaku.dariBawaan, false);
});

test('⛔ tenant TANPA bawaan menandai outletnya `dariBawaan`', async () => {
  // Tiga keadaan yang tampak sama: outlet memilih sendiri, outlet mengikuti
  // pusat, dan outlet memakai aturan yang TIDAK DIPILIH SIAPA PUN. Hanya yang
  // ketiga menuntut tindakan, dan ia harus dapat dibedakan.
  await kueri('UPDATE outlet SET vertical_profile_id = NULL WHERE id = $1', [base.outlet.id]);
  await kueri('UPDATE vertical_profile SET is_tenant_default = false', []);

  const o = (await daftar()).json().outlets.find((x) => x.id === base.outlet.id);
  assert.equal(o.verticalProfileId, null);
  assert.equal(o.berlaku.dariBawaan, true);
});

test('outlet yang mengikuti bawaan tenant TIDAK dianggap memakai bawaan sistem', async () => {
  await jadikanBawaan(base.vertical_profile.id);
  await kueri('UPDATE outlet SET vertical_profile_id = NULL WHERE id = $1', [base.outlet.id]);

  const o = (await daftar()).json().outlets.find((x) => x.id === base.outlet.id);
  assert.equal(o.verticalProfileId, null, 'tidak memilih sendiri');
  assert.equal(o.berlaku.dariBawaan, false, 'tapi pusat sudah menetapkan sesuatu');
  assert.equal(o.berlaku.id, base.vertical_profile.id);
});

// ---------------------------------------------------------------------------
// ⛔ Retail
// ---------------------------------------------------------------------------

test('⛔ retail DITOLAK, dan pesannya menjelaskan kenapa', async () => {
  // Merchant yang mencoba retail sedang menanyakan sesuatu yang nyata, dan
  // jawaban "nilai tidak sah" membuatnya mengira ia salah mengetik.
  const res = await buat({ name: 'retail' });
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(res.json().error.code, 'VERTICAL_NOT_AVAILABLE');
  assert.match(res.json().error.message, /belum dibangun|belum tersedia/i);
});

test('profil baru selalu fnb, dan kolom matinya sama dengan yang registerTenant tulis', async () => {
  // Profil yang dibuat lewat layar tidak boleh berperilaku berbeda dari profil
  // yang lahir bersama tenant — perbedaan yang tidak terlihat sampai seseorang
  // membandingkan dua baris.
  const res = await buat();
  assert.equal(res.statusCode, 201, res.body);
  const { rows } = await kueri(
    `SELECT name, default_channel, requires_barcode_flow, default_tax_type, modules_enabled
       FROM vertical_profile WHERE id = $1`,
    [res.json().id]
  );
  assert.equal(rows[0].name, 'fnb');
  assert.equal(rows[0].default_channel, 'takeaway');
  assert.equal(rows[0].requires_barcode_flow, false);
  assert.equal(rows[0].default_tax_type, 'pbjt');
  assert.deepEqual(rows[0].modules_enabled, []);
});

// ---------------------------------------------------------------------------
// ⛔ Bawaan tenant
// ---------------------------------------------------------------------------

test('⛔ bawaan tenant tidak dapat DICABUT', async () => {
  await jadikanBawaan(base.vertical_profile.id);
  const res = await ubah(base.vertical_profile.id, { isTenantDefault: false });
  assert.equal(res.statusCode, 409, res.body);
  assert.equal(res.json().error.code, 'DEFAULT_PROFILE_REQUIRED');
  // Dan tidak ada yang berubah.
  const { rows } = await kueri('SELECT is_tenant_default FROM vertical_profile WHERE id = $1', [
    base.vertical_profile.id,
  ]);
  assert.equal(rows[0].is_tenant_default, true);
});

test('⛔ menetapkan bawaan BARU mencabut yang lama, di transaksi yang sama', async () => {
  // `ux_vertical_profile_tenant_default` adalah index unik PARSIAL: dua baris
  // default menghasilkan 23505 — benar, tapi jawabannya 500 dan pesannya
  // menyebut nama index.
  await jadikanBawaan(base.vertical_profile.id);
  const baru = (await buat()).json().id;

  const res = await ubah(baru, { isTenantDefault: true });
  assert.equal(res.statusCode, 200, res.body);

  const { rows } = await kueri(
    'SELECT id, is_tenant_default FROM vertical_profile ORDER BY is_tenant_default DESC'
  );
  const bawaan = rows.filter((r) => r.is_tenant_default);
  assert.equal(bawaan.length, 1, JSON.stringify(rows));
  assert.equal(bawaan[0].id, baru);
});

test('stok negatif dapat dimatikan dan dinyalakan lagi', async () => {
  const id = base.vertical_profile.id;
  assert.equal((await ubah(id, { allowNegativeStock: false })).json().allowNegativeStock, false);
  assert.equal((await ubah(id, { allowNegativeStock: true })).json().allowNegativeStock, true);
});

test('⛔ `false` tersimpan sebagai false, bukan diabaikan sebagai "tidak dikirim"', async () => {
  // `COALESCE($2, ...)` dengan `body.allowNegativeStock ?? null`: `false ??
  // null` adalah `false`, bukan null. `||` di tempat itu akan membuang
  // pilihan "larang jual saat habis" sepenuhnya.
  const id = base.vertical_profile.id;
  await ubah(id, { allowNegativeStock: false });
  const { rows } = await kueri('SELECT allow_negative_stock FROM vertical_profile WHERE id = $1', [
    id,
  ]);
  assert.equal(rows[0].allow_negative_stock, false);
});

// ---------------------------------------------------------------------------
// Override per outlet
// ---------------------------------------------------------------------------

test('override outlet disetel dan dikosongkan', async () => {
  await jadikanBawaan(base.vertical_profile.id);
  const baru = (await buat()).json().id;

  assert.equal(
    (await setelOutlet(base.outlet.id, { verticalProfileId: baru })).json().verticalProfileId,
    baru
  );
  assert.equal(
    (await setelOutlet(base.outlet.id, { verticalProfileId: null })).json().verticalProfileId,
    null
  );
});

test('⛔ profil milik tenant lain ditolak — FK tidak tunduk RLS', async () => {
  // Temuan F1 (`CLAUDE.md`): FK PostgreSQL hanya membuktikan barisnya ada di
  // SUATU tenant. Profil merchant lain akan menentukan perilaku stok negatif
  // outlet ini.
  const lain = await seedTenantBase(db, { suffix: 'VertikalLain' });
  const res = await setelOutlet(base.outlet.id, { verticalProfileId: lain.vertical_profile.id });
  assert.equal(res.statusCode, 404, res.body);
  assert.equal(res.json().error.code, 'VERTICAL_PROFILE_NOT_FOUND');
});

test('outlet milik tenant lain ditolak 404', async () => {
  const lain = await seedTenantBase(db, { suffix: 'VertikalOutletLain' });
  const res = await setelOutlet(lain.outlet.id, { verticalProfileId: null });
  assert.equal(res.statusCode, 404, res.body);
});

// ---------------------------------------------------------------------------
// ⛔ Audit
// ---------------------------------------------------------------------------

test('setiap perubahan menulis vertical_profile_changed', async () => {
  await jadikanBawaan(base.vertical_profile.id);
  const baru = (await buat()).json().id;
  await ubah(baru, { allowNegativeStock: false });
  await setelOutlet(base.outlet.id, { verticalProfileId: baru });

  const { rows } = await kueri(
    `SELECT entity_type, entity_id, before, after FROM audit_event
      WHERE event_type = 'vertical_profile_changed' ORDER BY occurred_at, id`
  );
  assert.equal(rows.length, 3, JSON.stringify(rows.map((r) => r.entity_type)));
  assert.equal(rows[0].entity_type, 'vertical_profile');
  assert.equal(rows[0].before, null, 'pembuatan tidak punya nilai sebelumnya');
  assert.equal(rows[1].before.allowNegativeStock, true);
  assert.equal(rows[1].after.allowNegativeStock, false);
  assert.equal(rows[2].entity_type, 'outlet');
});

test('⛔ override outlet mencatat `null` sebagai null, bukan diresolusi', async () => {
  // "Outlet ini mengikuti pusat" dan "outlet ini memilih profil yang kebetulan
  // sama dengan pusat" berperilaku sama hari ini dan berbeda pada hari
  // bawaannya dipindahkan.
  await jadikanBawaan(base.vertical_profile.id);
  await setelOutlet(base.outlet.id, { verticalProfileId: null });

  const { rows } = await kueri(
    `SELECT before, after FROM audit_event
      WHERE event_type = 'vertical_profile_changed' AND entity_type = 'outlet'`
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].after.verticalProfileId, null);
  assert.notEqual(rows[0].after.verticalProfileId, base.vertical_profile.id);
});

test('⛔ perubahan yang DITOLAK tidak meninggalkan baris audit', async () => {
  await jadikanBawaan(base.vertical_profile.id);
  assert.equal((await ubah(base.vertical_profile.id, { isTenantDefault: false })).statusCode, 409);
  assert.equal((await buat({ name: 'retail' })).statusCode, 400);

  const { rows } = await kueri(
    `SELECT id FROM audit_event WHERE event_type = 'vertical_profile_changed'`
  );
  assert.deepEqual(rows, []);
});
