'use strict';

// §9 (docs/superpowers/plans/PLAN-modul-f-identitas.md) -- FR-F2b, login
// back-office dengan email + password.
//
// ⛔ Permukaan ini BELUM punya konsumen UI: layar B-01 menunggu F5
// (`ARCH:§14`). Ia dibangun sekarang karena FR-F2b adalah P0 dan seluruh
// aturannya dapat diuji lewat API — bukan karena ada yang memakainya.
// Dinyatakan, tidak didiamkan.
//
// `spec-f:111` menetapkan pembagiannya: back-office memakai email+password
// karena "diakses dari laptop, sesi panjang, hak akses luas"; kasir memakai
// PIN karena otorisasi step-up terjadi di tengah transaksi. AC `spec-f:150`
// menuntut keduanya TIDAK dapat saling dipakai.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase, freshId } = require('../isolation/helpers/seed');
const { headerSesi } = require('../isolation/helpers/sesi');

let owner, appSetup, app, tenant, outlet, base;

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
  base = await seedTenantBase(appSetup, { suffix: 'Auth' });
  tenant = base.tenant;
  outlet = base.outlet;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();
});

async function kueriTenant(sql, params) {
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  const hasil = await appSetup.query(sql, params);
  await appSetup.query('COMMIT');
  return hasil;
}

async function buatPengguna({ email, password, peran = 'owner' }) {
  const id = freshId();
  await kueriTenant(`INSERT INTO "user" (id, tenant_id, name, email) VALUES ($1, $2, 'Uji', $3)`, [
    id,
    tenant.id,
    email,
  ]);
  await kueriTenant(
    `INSERT INTO user_role (id, tenant_id, user_id, role, scope_type, scope_id)
     VALUES ($1, $2, $3, $4, 'tenant', $2)`,
    [freshId(), tenant.id, id, peran]
  );
  await kueriTenant(
    `INSERT INTO user_outlet (id, tenant_id, user_id, outlet_id) VALUES ($1, $2, $3, $4)`,
    [freshId(), tenant.id, id, outlet.id]
  );
  if (password) {
    const res = await app.inject({
      method: 'PUT',
      url: `/users/${id}/password`,
      payload: { password },
      headers: headerSesi(tenant.id, base.sessionToken, { 'x-actor-id': id }),
    });
    assert.equal(res.statusCode, 204, res.body);
  }
  return id;
}

function login(email, password) {
  return app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password },
    headers: { 'x-tenant-id': tenant.id },
  });
}

// ---------------------------------------------------------------------------

test('password < 10 karakter ditolak (spec-f:180)', async () => {
  const id = await buatPengguna({ email: 'a@contoh.id' });
  const res = await app.inject({
    method: 'PUT',
    url: `/users/${id}/password`,
    payload: { password: 'pendek123' },
    headers: headerSesi(tenant.id, base.sessionToken, { 'x-actor-id': id }),
  });
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(res.json().error.code, 'PASSWORD_TOO_SHORT');
});

test('password dari daftar bocor ditolak, dengan pesan yang menjelaskan', async () => {
  const id = await buatPengguna({ email: 'b@contoh.id' });
  const res = await app.inject({
    method: 'PUT',
    url: `/users/${id}/password`,
    payload: { password: 'password123' },
    headers: headerSesi(tenant.id, base.sessionToken, { 'x-actor-id': id }),
  });
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(res.json().error.code, 'PASSWORD_BREACHED');
  assert.match(res.json().error.message, /sering|bocor/i);
});

test('login berhasil mengembalikan sesi; password tersimpan Argon2id', async () => {
  await buatPengguna({ email: 'c@contoh.id', password: 'kopi-susu-gula-aren-2026' });

  const res = await login('c@contoh.id', 'kopi-susu-gula-aren-2026');
  assert.equal(res.statusCode, 200, res.body);
  const body = res.json();
  assert.ok(body.token, 'sesi harus punya token');
  assert.ok(body.expiresAt);
  assert.deepEqual(body.roles, ['owner']);

  const { rows } = await kueriTenant(`SELECT password_hash FROM "user" WHERE email = 'c@contoh.id'`);
  assert.match(rows[0].password_hash, /^\$argon2id\$/);
  assert.equal(rows[0].password_hash.includes('kopi-susu'), false);
});

test('⛔ pesan kegagalan tidak membocorkan keberadaan pengguna (spec-f:148)', async () => {
  await buatPengguna({ email: 'd@contoh.id', password: 'kopi-susu-gula-aren-2026' });

  const salahPassword = await login('d@contoh.id', 'salah-sekali-passwordnya');
  const tidakAda = await login('tidak-ada@contoh.id', 'salah-sekali-passwordnya');

  assert.equal(salahPassword.statusCode, 401);
  assert.equal(tidakAda.statusCode, 401);
  assert.deepEqual(
    salahPassword.json().error,
    tidakAda.json().error,
    'kedua respons HARUS identik — selisih apa pun adalah oracle enumerasi email'
  );
});

test('⛔ kasir tanpa email TIDAK dapat mengakses back-office (spec-f:184)', async () => {
  // "Pengguna tanpa email tidak dapat mengakses back-office — ini BENAR,
  // kasir memang tidak seharusnya bisa." Diuji supaya ia tetap benar.
  const id = freshId();
  await kueriTenant(`INSERT INTO "user" (id, tenant_id, name, email) VALUES ($1, $2, 'Kasir', NULL)`, [
    id,
    tenant.id,
  ]);
  const res = await login(null, 'kopi-susu-gula-aren-2026');
  assert.equal(res.statusCode, 401);
});

test('⛔ PIN tidak dapat dipakai sebagai password back-office (spec-f:150)', async () => {
  // "Back-office dan owner mobile TIDAK menerima login PIN." Pengguna yang
  // punya PIN tapi belum punya password harus ditolak — kalau `pin_hash`
  // ikut dicoba di sini, permukaan laptop mewarisi kekuatan 6 digit.
  const id = await buatPengguna({ email: 'e@contoh.id' });
  const setPin = await app.inject({
    method: 'PUT',
    url: `/users/${id}/pin`,
    payload: { pin: '482913' },
    headers: headerSesi(tenant.id, base.sessionToken, { 'x-actor-id': id }),
  });
  assert.equal(setPin.statusCode, 204, setPin.body);

  const res = await login('e@contoh.id', '482913');
  assert.equal(res.statusCode, 401);
});

test('pengguna nonaktif tidak dapat login', async () => {
  const id = await buatPengguna({ email: 'f@contoh.id', password: 'kopi-susu-gula-aren-2026' });
  await kueriTenant(`UPDATE "user" SET is_active = false WHERE id = $1`, [id]);

  const res = await login('f@contoh.id', 'kopi-susu-gula-aren-2026');
  assert.equal(res.statusCode, 401);
});

test('sesi kedaluwarsa 12 jam (spec-f:176) dan dapat diakhiri', async () => {
  await buatPengguna({ email: 'g@contoh.id', password: 'kopi-susu-gula-aren-2026' });
  const masuk = await login('g@contoh.id', 'kopi-susu-gula-aren-2026');
  const { token, expiresAt } = masuk.json();

  const selisihJam = (Date.parse(expiresAt) - Date.now()) / 3_600_000;
  assert.ok(selisihJam > 11.5 && selisihJam < 12.5, `umur sesi ${selisihJam} jam, seharusnya ~12`);

  const keluar = await app.inject({
    method: 'POST',
    url: '/auth/logout',
    headers: { 'x-tenant-id': tenant.id, authorization: `Bearer ${token}` },
  });
  assert.equal(keluar.statusCode, 204, keluar.body);

  // Logout kedua dengan token yang sama ditolak — sesi benar-benar dihapus,
  // bukan hanya ditandai di klien.
  const lagi = await app.inject({
    method: 'POST',
    url: '/auth/logout',
    headers: { 'x-tenant-id': tenant.id, authorization: `Bearer ${token}` },
  });
  assert.equal(lagi.statusCode, 401);
});

test('token sesi disimpan sebagai HASH, bukan apa adanya', async () => {
  const id = await buatPengguna({ email: 'h@contoh.id', password: 'kopi-susu-gula-aren-2026' });
  const { token } = (await login('h@contoh.id', 'kopi-susu-gula-aren-2026')).json();

  // Sejajar dengan `device.token_hash` (FR-F12): siapa pun yang dapat membaca
  // tabel sesi tidak boleh dapat menyamar jadi setiap pengguna yang sedang
  // masuk.
  //
  // Disaring per `user_id`, BUKAN `SELECT * FROM user_session`: `seedTenantBase`
  // menyisipkan satu sesi miliknya sendiri untuk suite isolasi, dan test yang
  // menghitung seluruh tabel akan merah karena tetangganya. Ditemukan saat
  // menjalankan suite penuh, bukan saat menulis test ini.
  const { rows } = await kueriTenant(`SELECT token_hash FROM user_session WHERE user_id = $1`, [id]);
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].token_hash, token, 'token mentah tidak boleh tersimpan');
  assert.equal(rows[0].token_hash.includes(token), false);
  assert.match(rows[0].token_hash, /^[0-9a-f]{64}$/, 'SHA-256 heksadesimal');
});

test('password plaintext tidak pernah muncul di log', async () => {
  const potongan = [];
  const { buildApp } = await import('../../apps/server/src/app.ts');
  await app.close();
  app = await buildApp({ logger: { level: 'trace', stream: { write: (s) => potongan.push(s) } } });

  const PASSWORD = 'rahasia-yang-panjang-2026';
  await buatPengguna({ email: 'i@contoh.id', password: PASSWORD });
  assert.equal((await login('i@contoh.id', PASSWORD)).statusCode, 200, 'prasyarat');
  assert.equal((await login('i@contoh.id', 'salah-sekali-sekali')).statusCode, 401, 'prasyarat jalur gagal');

  const semua = potongan.join('');
  assert.ok(semua.length > 0, 'log harus terisi, kalau tidak test ini tidak membuktikan apa pun');
  assert.equal(semua.includes(PASSWORD), false, 'password muncul di log');
});
