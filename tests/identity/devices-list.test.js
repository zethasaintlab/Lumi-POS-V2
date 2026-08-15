'use strict';

// `GET /devices` — daftar perangkat untuk layar B-28.
//
// ⛔ Endpoint ini TIDAK ADA sebelum ini. `POST /devices`,
// `/devices/{id}/credentials`, `/devices/{id}/sync-token`, dan
// `/devices/{id}/revoke` semuanya sudah lengkap sejak F2/F3 — tapi tidak ada
// satu pun cara MEMBACA daftarnya. Layar manajemen perangkat yang tidak dapat
// menampilkan perangkat yang sudah ada bukan layar manajemen.

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
  base = await seedTenantBase(appSetup, { suffix: 'DeviceList' });
  tenant = base.tenant;
  // ⛔ Pengguna seed berperan KASIR (`helpers/seed.js`), dan `spec-f:52`
  // menaruh pengelolaan perangkat di luar jangkauannya. Peran owner
  // ditambahkan di sini supaya suite ini menguji DAFTARNYA, bukan menguji
  // penolakan RBAC berulang kali — penolakan itu punya testnya sendiri di
  // bawah.
  await appSetup.query('BEGIN');
  await appSetup.query("SELECT set_config('app.tenant_id', $1, true)", [tenant.id]);
  await appSetup.query(
    "INSERT INTO user_role (id, tenant_id, user_id, role, scope_type, scope_id) " +
      "VALUES ($1, $2, $3, 'owner', 'tenant', $2)",
    [crypto.randomUUID(), tenant.id, base.user.id]
  );
  await appSetup.query('COMMIT');

  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();
});

function H(extra = {}) {
  return {
    'content-type': 'application/json',
    'x-tenant-id': tenant.id,
    authorization: base.authHeader,
    ...extra,
  };
}

async function buatPerangkat(kode, extra = {}) {
  const id = crypto.randomUUID();
  const res = await app.inject({
    method: 'POST',
    url: '/devices',
    payload: { id, outletId: base.outlet.id, code: kode, ...extra },
    headers: H(),
  });
  assert.equal(res.statusCode, 201, res.body);
  return id;
}

async function daftar(headers = {}) {
  const res = await app.inject({ method: 'GET', url: '/devices', headers: H(headers) });
  assert.equal(res.statusCode, 200, res.body);
  return JSON.parse(res.body);
}

// ---------------------------------------------------------------------------

test('daftar kosong adalah array kosong, bukan 404', async () => {
  // Merchant baru punya nol perangkat, dan itu keadaan yang SAH. 404 di sini
  // membuat layar menampilkan error untuk keadaan normal.
  assert.deepEqual(await daftar(), []);
});

test('perangkat yang dibuat muncul dengan kolom yang dibutuhkan layar', async () => {
  const id = await buatPerangkat('K1', { name: 'Kasir Depan', platform: 'tauri' });
  const hasil = await daftar();

  assert.equal(hasil.length, 1);
  assert.equal(hasil[0].id, id);
  assert.equal(hasil[0].code, 'K1');
  assert.equal(hasil[0].name, 'Kasir Depan');
  assert.equal(hasil[0].platform, 'tauri');
  assert.equal(hasil[0].outletId, base.outlet.id);
  assert.equal(hasil[0].revokedAt, null);
});

test('⛔ TIDAK ADA token_hash di respons', async () => {
  // `device.token_hash` adalah SHA-256 dari secret perangkat. Mengirimkannya
  // ke layar mana pun berarti menaruh bahan kredensial di tempat yang tidak
  // membutuhkannya — dan layar hanya perlu tahu APAKAH kredensial sudah
  // diterbitkan, bukan nilainya.
  await buatPerangkat('K1');
  const mentah = JSON.stringify(await daftar());
  assert.ok(!/token_hash|tokenHash/.test(mentah), mentah);
});

test('⛔ status kredensial dilaporkan sebagai BOOLEAN, bukan nilainya', async () => {
  // Layar harus dapat membedakan "perangkat dibuat, belum diberi kredensial"
  // dari "siap dipasang". Tanpa itu, merchant menerbitkan kredensial dua kali
  // dan yang pertama diam-diam mati.
  const id = await buatPerangkat('K1');
  assert.equal((await daftar())[0].adaKredensial, false);

  const res = await app.inject({
    method: 'POST',
    url: `/devices/${id}/credentials`,
    payload: {},
    headers: H(),
  });
  assert.equal(res.statusCode, 201, res.body);

  const sesudah = (await daftar())[0];
  assert.equal(sesudah.adaKredensial, true);
  assert.ok(sesudah.credentialsExpireAt, 'kedaluwarsa kredensial tidak dilaporkan');
});

test('⛔ perangkat yang DICABUT tetap terlihat, dengan penanda', async () => {
  // Perangkat tidak pernah di-DELETE — `order.device_id` menunjuknya, dan
  // riwayat penjualan harus tetap dapat menyebut perangkat mana yang
  // membuatnya. Menyembunyikannya dari daftar membuat merchant mengira ia
  // hilang, lalu membuat ulang dengan kode yang sama.
  const id = await buatPerangkat('K1');
  assert.equal(
    (await app.inject({ method: 'POST', url: `/devices/${id}/revoke`, payload: {}, headers: H() }))
      .statusCode,
    200
  );

  const hasil = await daftar();
  assert.equal(hasil.length, 1, 'perangkat tercabut hilang dari daftar');
  assert.ok(hasil[0].revokedAt, 'tidak ada penanda pencabutan');
});

test('urutan deterministik: aktif dulu, lalu kode', async () => {
  // Daftar yang urutannya berubah tiap muat ulang tidak dapat dibaca. Dan
  // yang aktif lebih penting daripada yang tercabut.
  const k2 = await buatPerangkat('K2');
  await buatPerangkat('K1');
  await buatPerangkat('K3');
  assert.equal(
    (await app.inject({ method: 'POST', url: `/devices/${k2}/revoke`, payload: {}, headers: H() }))
      .statusCode,
    200
  );

  assert.deepEqual((await daftar()).map((d) => d.code), ['K1', 'K3', 'K2']);
});

// --- akses & isolasi -------------------------------------------------------

test('⛔ perangkat tenant lain tidak terlihat', async () => {
  const lain = await seedTenantBase(appSetup, { suffix: 'DeviceListLain' });
  const res = await app.inject({
    method: 'POST',
    url: '/devices',
    payload: { id: crypto.randomUUID(), outletId: lain.outlet.id, code: 'K9' },
    headers: {
      'content-type': 'application/json',
      'x-tenant-id': lain.tenant.id,
      authorization: lain.authHeader,
    },
  });
  assert.equal(res.statusCode, 201, res.body);

  assert.deepEqual(await daftar(), [], 'perangkat tenant lain bocor ke daftar ini');
});

test('⛔ TANPA sesi ditolak 401', async () => {
  const res = await app.inject({
    method: 'GET',
    url: '/devices',
    headers: { 'x-tenant-id': tenant.id, 'x-actor-id': base.user.id },
  });
  assert.equal(res.statusCode, 401, res.body);
});

test('⛔ Kasir tidak boleh melihat daftar perangkat (spec-f:52)', async () => {
  const { buatSesi } = require('../isolation/helpers/sesi');
  const kasirId = crypto.randomUUID();
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/users',
        payload: {
          id: kasirId,
          name: 'Kasir',
          roles: [{ role: 'cashier', scopeType: 'outlet', scopeId: base.outlet.id }],
          outletIds: [base.outlet.id],
        },
        headers: H(),
      })
    ).statusCode,
    201
  );
  const tokenKasir = await buatSesi(appSetup, { tenantId: tenant.id, userId: kasirId });

  const res = await app.inject({
    method: 'GET',
    url: '/devices',
    headers: { 'x-tenant-id': tenant.id, authorization: `Bearer ${tokenKasir}` },
  });
  assert.equal(res.statusCode, 403, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'FORBIDDEN');
});
