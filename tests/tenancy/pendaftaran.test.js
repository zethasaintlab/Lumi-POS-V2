'use strict';

// F5 — pendaftaran merchant mandiri (`ARCH:399`).
//
// Gate F5: "Merchant dapat mendaftar → impor → bertransaksi tanpa bantuan."
// Kata kerja pertama tidak punya kode sama sekali sebelum ini; satu-satunya
// cara tenant lahir adalah `tools/dev-seed.mjs`, yang menulis INSERT langsung
// ke database.
//
// ⛔ Endpoint ini adalah yang KEDUA tanpa `X-Tenant-Id`, setelah webhook
// Midtrans — dan alasannya berbeda: tenant-nya belum ada. Tidak ada nilai
// yang benar untuk header itu.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');

let owner, appDb, app;

before(async () => {
  owner = await connectAsOwner();
  appDb = await connectAsApp();
});

after(async () => {
  await resetAll(owner);
  await owner.end();
  await appDb.end();
  if (app) await app.close();
});

beforeEach(async () => {
  await resetAll(owner);
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();
});

function badan(extra = {}) {
  return {
    tenant: { id: crypto.randomUUID(), name: 'Kopi Zeth' },
    outlet: { id: crypto.randomUUID(), name: 'Outlet Pusat', timezone: 'Asia/Jakarta' },
    owner: {
      id: crypto.randomUUID(),
      name: 'Zeth',
      email: `owner+${crypto.randomUUID()}@contoh.id`,
      password: 'kopi susu gula aren',
    },
    ...extra,
  };
}

function daftar(payload) {
  return app.inject({
    method: 'POST',
    url: '/tenants',
    payload,
    // ⛔ SENGAJA tanpa x-tenant-id dan tanpa x-actor-id.
    headers: { 'content-type': 'application/json' },
  });
}

// Query di luar RLS — hanya untuk MEMERIKSA hasil, tidak pernah dipakai
// aplikasi. `owner` adalah role migrasi; ia tunduk FORCE RLS untuk DML biasa,
// jadi pembacaan tetap perlu `app.tenant_id` seperti aplikasi.
async function lihat(tenantId, sql, params = []) {
  await appDb.query('BEGIN');
  await appDb.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
  const { rows } = await appDb.query(sql, params);
  await appDb.query('COMMIT');
  return rows;
}

// ---------------------------------------------------------------------------

test('pendaftaran membuat tenant, outlet, dan owner sekaligus', async () => {
  const b = badan();
  const res = await daftar(b);
  assert.equal(res.statusCode, 201, res.body);

  const hasil = JSON.parse(res.body);
  assert.equal(hasil.tenantId, b.tenant.id);
  assert.equal(hasil.outletId, b.outlet.id);
  assert.equal(hasil.ownerId, b.owner.id);

  const outlet = await lihat(b.tenant.id, 'SELECT id, name, timezone FROM outlet');
  assert.equal(outlet.length, 1);
  assert.equal(outlet[0].timezone, 'Asia/Jakarta');

  const user = await lihat(b.tenant.id, 'SELECT id, name, password_hash FROM "user"');
  assert.equal(user.length, 1);
  assert.notEqual(user[0].password_hash, null, 'owner tanpa password tidak dapat login selamanya');
  assert.ok(
    !String(user[0].password_hash).includes(b.owner.password),
    'password tersimpan apa adanya'
  );
});

test('⛔ owner berperan owner ber-scope TENANT, dan terhubung ke outlet', async () => {
  // Scope outlet akan membuat owner tidak dapat membuat outlet kedua —
  // ia akan terkunci di cabang pertamanya sendiri.
  const b = badan();
  await daftar(b);

  const peran = await lihat(b.tenant.id, 'SELECT role, scope_type, scope_id FROM user_role');
  assert.deepEqual(peran, [{ role: 'owner', scope_type: 'tenant', scope_id: b.tenant.id }]);

  const outletUser = await lihat(b.tenant.id, 'SELECT outlet_id FROM user_outlet');
  assert.deepEqual(outletUser, [{ outlet_id: b.outlet.id }]);
});

test('⛔ profil vertikal dibuat sebagai DEFAULT TENANT, dan outlet menunjuknya', async () => {
  // `COALESCE(profil_outlet, default_tenant)` — tanpa baris default tenant,
  // resolusi jatuh ke nilai bawaan yang dipanggang di kode, dan merchant
  // tidak pernah dapat mengubah perilaku stok negatif dari back-office.
  const b = badan();
  await daftar(b);

  const profil = await lihat(
    b.tenant.id,
    'SELECT id, name, is_tenant_default, default_channel FROM vertical_profile'
  );
  assert.equal(profil.length, 1);
  assert.equal(profil[0].is_tenant_default, true);
  assert.equal(profil[0].name, 'fnb');

  const outlet = await lihat(b.tenant.id, 'SELECT vertical_profile_id FROM outlet');
  assert.equal(outlet[0].vertical_profile_id, profil[0].id);
});

test('⛔ paket adalah `free` dengan kuota tier gratis — plan dari klien DIABAIKAN', async () => {
  // Endpoint ini tidak terautentikasi. Paket yang dapat dipilih pemanggil
  // berarti siapa pun memberi dirinya kuota tanpa batas lewat satu field.
  const { KUOTA_PAKET } = await import('../../packages/domain/src/paket.ts');

  const b = badan();
  b.plan = 'enterprise';
  b.tenant.plan = 'enterprise';
  b.tenant.maxProducts = 999999;

  const res = await daftar(b);
  assert.equal(res.statusCode, 201, res.body);

  const { rows } = await appDb.query(
    'SELECT plan, status, max_outlets, max_devices, max_users, max_products FROM tenant WHERE id = $1',
    [b.tenant.id]
  );
  assert.equal(rows[0].plan, 'free', 'plan dari klien diterima — siapa pun dapat naik tier sendiri');
  assert.equal(rows[0].status, 'active');
  assert.equal(rows[0].max_outlets, KUOTA_PAKET.free.maxOutlets);
  assert.equal(rows[0].max_devices, KUOTA_PAKET.free.maxDevices);
  assert.equal(rows[0].max_users, KUOTA_PAKET.free.maxUsers);
  assert.equal(rows[0].max_products, KUOTA_PAKET.free.maxProducts);
});

test('⛔ owner hasil pendaftaran dapat langsung LOGIN', async () => {
  // Ini yang membuat gate F5 berarti. Pendaftaran yang menghasilkan tenant
  // tapi tidak menghasilkan orang yang dapat masuk adalah pendaftaran yang
  // tetap menuntut bantuan.
  const b = badan();
  await daftar(b);

  const res = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: b.owner.email, password: b.owner.password },
    headers: { 'x-tenant-id': b.tenant.id },
  });
  assert.equal(res.statusCode, 200, res.body);
  assert.ok(JSON.parse(res.body).token, 'login tidak mengembalikan token');
});

test('⛔ password lemah ditolak, dan TIDAK ADA baris yang tertinggal', async () => {
  // Satu transaksi: tenant yang lahir tanpa owner tidak dapat dimasuki
  // siapa pun selamanya — setiap endpoint lain menuntut X-Actor-Id yang sah.
  const b = badan();
  b.owner.password = 'password123';

  const res = await daftar(b);
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'PASSWORD_BREACHED');

  const { rows } = await appDb.query('SELECT id FROM tenant WHERE id = $1', [b.tenant.id]);
  assert.equal(rows.length, 0, 'tenant tertinggal tanpa owner — tidak dapat dimasuki siapa pun');
});

test('⛔ timezone di luar daftar ditolak, dan tidak menyisakan tenant', async () => {
  const b = badan();
  b.outlet.timezone = 'Europe/Amsterdam';

  const res = await daftar(b);
  assert.equal(res.statusCode, 400, res.body);

  const { rows } = await appDb.query('SELECT id FROM tenant WHERE id = $1', [b.tenant.id]);
  assert.equal(rows.length, 0);
});

test('⛔ kegagalan SESUDAH tenant ditulis tetap menggulung balik semuanya', async () => {
  // ⛔ Dua test di atas ("password lemah", "timezone salah") TIDAK menguji
  // atomisitas sama sekali: kedua validasi itu berjalan SEBELUM transaksi
  // dibuka, jadi keduanya akan tetap hijau meski tidak ada transaksi sama
  // sekali. Itu kelas test yang hijau karena keadaan yang diperiksanya tidak
  // dapat terjadi.
  //
  // Yang dibutuhkan adalah kegagalan yang terjadi SESUDAH baris `tenant`
  // ditulis. Id pengguna berbenturan lintas tenant (`"user"` PK-nya global),
  // dan benturan itu baru terjadi di INSERT terakhir.
  const pertama = badan();
  assert.equal((await daftar(pertama)).statusCode, 201);

  const kedua = badan();
  kedua.owner.id = pertama.owner.id;

  const res = await daftar(kedua);
  assert.equal(res.statusCode, 409, res.body);

  const tenant = await appDb.query('SELECT id FROM tenant WHERE id = $1', [kedua.tenant.id]);
  assert.equal(
    tenant.rows.length,
    0,
    'tenant tertinggal tanpa owner — tidak dapat dimasuki siapa pun selamanya'
  );

  // Outlet dan profil vertikal ikut tergulung.
  //
  // ⛔ Dibaca dengan `app.tenant_id` = tenant yang GAGAL dibuat, bukan tanpa
  // scope sama sekali. Percobaan pertama memakai role migrasi telanjang dan
  // jatuh dengan `unrecognized configuration parameter "app.tenant_id"` —
  // kebijakan RLS membacanya, jadi tidak ada pembacaan tabel ber-tenant yang
  // dapat berjalan tanpanya. `tenant` lolos hanya karena ia dikecualikan RLS.
  const outlet = await lihat(kedua.tenant.id, 'SELECT id FROM outlet WHERE id = $1', [
    kedua.outlet.id,
  ]);
  assert.equal(outlet.length, 0, 'outlet yatim tertinggal');
  const profil = await lihat(kedua.tenant.id, 'SELECT id FROM vertical_profile');
  assert.equal(profil.length, 0, 'profil vertikal yatim tertinggal');
});

test('id tenant yang sama diulang → 409, bukan tenant kedua', async () => {
  const b = badan();
  assert.equal((await daftar(b)).statusCode, 201);

  const lagi = badan();
  lagi.tenant.id = b.tenant.id;
  const res = await daftar(lagi);
  assert.equal(res.statusCode, 409, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'ID_ALREADY_EXISTS');

  const { rows } = await appDb.query('SELECT count(*) AS n FROM tenant WHERE id = $1', [b.tenant.id]);
  assert.equal(rows[0].n, '1');
});

test('⛔ pendaftaran tercatat di audit trail, dengan owner sebagai aktornya', async () => {
  const b = badan();
  await daftar(b);

  const audit = await lihat(
    b.tenant.id,
    `SELECT event_type, actor_user_id, outlet_id, entity_id, after
       FROM audit_event WHERE event_type = 'tenant_registered'`
  );
  assert.equal(audit.length, 1, 'pendaftaran tidak tercatat');
  assert.equal(audit[0].actor_user_id, b.owner.id);
  assert.equal(audit[0].outlet_id, b.outlet.id);
  assert.equal(audit[0].entity_id, b.tenant.id);
  assert.equal(audit[0].after.plan, 'free');
});

test('⛔ dua pendaftaran terpisah tidak saling terlihat', async () => {
  const a = badan();
  const c = badan();
  await daftar(a);
  await daftar(c);

  const outletA = await lihat(a.tenant.id, 'SELECT id FROM outlet');
  assert.deepEqual(outletA.map((r) => r.id), [a.outlet.id]);

  const userC = await lihat(c.tenant.id, 'SELECT id FROM "user"');
  assert.deepEqual(userC.map((r) => r.id), [c.owner.id]);
});
