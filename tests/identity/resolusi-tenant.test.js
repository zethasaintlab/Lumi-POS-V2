'use strict';

// Resolusi tenant saat login (migrasi 0023).
//
// ⛔ Ia TIDAK diekspos sebagai endpoint. Endpoint "cari tenant dari email"
// adalah oracle enumerasi, dan email back-office adalah email owner merchant
// (`spec-f:148`). Yang memanggilnya hanya `POST /auth/login`, di dalam jalur
// yang sudah menuntut password dan sudah menjawab SATU pesan untuk setiap
// kegagalan.

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

const SANDI = 'kopi susu gula aren';

async function daftar(email) {
  const b = {
    tenant: { id: crypto.randomUUID(), name: 'Kopi Resolusi' },
    outlet: { id: crypto.randomUUID(), name: 'Pusat', timezone: 'Asia/Jakarta' },
    owner: { id: crypto.randomUUID(), name: 'Pemilik', email, password: SANDI },
  };
  const res = await app.inject({
    method: 'POST',
    url: '/tenants',
    payload: b,
    headers: { 'content-type': 'application/json' },
  });
  assert.equal(res.statusCode, 201, res.body);
  return { id: b.tenant.id, ownerId: b.owner.id };
}

function masuk(payload, headers = {}) {
  return app.inject({
    method: 'POST',
    url: '/auth/login',
    payload,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

// ---------------------------------------------------------------------------

test('⛔ login TANPA X-Tenant-Id berhasil — tenant diresolusi dari email', async () => {
  // Inilah yang membuat layar masuk dapat dipakai. Merchant tidak menghafal
  // UUID tenantnya, dan yang baru mendaftar tidak punya tempat menyalinnya.
  const t = await daftar('resolusi@contoh.id');

  const res = await masuk({ email: 'resolusi@contoh.id', password: SANDI });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(JSON.parse(res.body).userId, t.ownerId);
});

test('X-Tenant-Id tetap DIHORMATI bila dikirim', async () => {
  // Aplikasi kasir sudah mengirimnya, dan merchant yang emailnya terdaftar di
  // dua tenant harus dapat menyebut yang mana.
  const t = await daftar('dua@contoh.id');
  const res = await masuk({ email: 'dua@contoh.id', password: SANDI }, { 'x-tenant-id': t.id });
  assert.equal(res.statusCode, 200, res.body);
});

test('⛔ email yang sama di DUA tenant → ditolak, bukan ditebak', async () => {
  // Tidak ada UNIQUE global pada `"user".email`, dan tidak dapat ada tanpa
  // melanggar isolasi. Mengembalikan salah satunya berarti memasukkan orang
  // ke tenant yang SALAH — dengan password yang benar, tanpa satu pun error.
  await daftar('ganda@contoh.id');
  await daftar('ganda@contoh.id');

  const res = await masuk({ email: 'ganda@contoh.id', password: SANDI });
  assert.equal(res.statusCode, 401, res.body);

  // Menyebut tenantnya secara eksplisit tetap berhasil.
  const { rows } = await appDb.query(
    `SELECT t.id FROM tenant t ORDER BY t.created_at LIMIT 1`
  );
  const dengan = await masuk(
    { email: 'ganda@contoh.id', password: SANDI },
    { 'x-tenant-id': rows[0].id }
  );
  assert.equal(dengan.statusCode, 200, dengan.body);
});

test('⛔ SATU pesan untuk email tak dikenal DAN password salah', async () => {
  // `spec-f:148`. Resolusi tenant menambah satu sebab kegagalan baru, dan ia
  // harus terlihat sama persis dengan yang lain — kalau tidak, ia menjadi
  // oracle yang justru dibuat untuk dihindari.
  await daftar('ada@contoh.id');

  const pesan = new Set();
  const kode = new Set();
  for (const payload of [
    { email: 'tidak-ada@contoh.id', password: SANDI },
    { email: 'ada@contoh.id', password: 'salah sekali sungguh' },
    { email: '', password: SANDI },
  ]) {
    const res = await masuk(payload);
    assert.equal(res.statusCode, 401, JSON.stringify(payload));
    pesan.add(JSON.parse(res.body).error.message);
    kode.add(JSON.parse(res.body).error.code);
  }
  assert.equal(pesan.size, 1, `pesan berbeda: ${[...pesan].join(' | ')}`);
  assert.deepEqual([...kode], ['INVALID_CREDENTIALS']);
});

test('⛔ pengguna NONAKTIF tidak dapat diresolusi', async () => {
  const t = await daftar('nonaktif@contoh.id');
  await appDb.query('BEGIN');
  await appDb.query("SELECT set_config('app.tenant_id', $1, true)", [t.id]);
  await appDb.query('UPDATE "user" SET is_active = false WHERE id = $1', [t.ownerId]);
  await appDb.query('COMMIT');

  const res = await masuk({ email: 'nonaktif@contoh.id', password: SANDI });
  assert.equal(res.statusCode, 401, res.body);
});

test('⛔ pengguna TANPA password (kasir) tidak dapat diresolusi', async () => {
  // `spec-f:150`: kasir tidak menerima login password. Syarat resolusi harus
  // SAMA dengan syarat login — kalau berbeda, resolusi dapat menunjuk tenant
  // tempat penggunanya justru tidak dapat masuk, dan pesannya menyalahkan
  // password.
  const t = await daftar('owner2@contoh.id');
  await appDb.query('BEGIN');
  await appDb.query("SELECT set_config('app.tenant_id', $1, true)", [t.id]);
  await appDb.query(
    'INSERT INTO "user" (id, tenant_id, name, email) VALUES ($1, $2, $3, $4)',
    [crypto.randomUUID(), t.id, 'Kasir Tanpa Password', 'kasir@contoh.id']
  );
  await appDb.query('COMMIT');

  const res = await masuk({ email: 'kasir@contoh.id', password: SANDI });
  assert.equal(res.statusCode, 401, res.body);
});

// --- ⛔ fungsi itu sendiri --------------------------------------------------

test('⛔ resolve_login_tenant TIDAK dapat dipanggil PUBLIC', async () => {
  // `SECURITY DEFINER` + EXECUTE untuk PUBLIC berarti setiap peran di
  // database dapat memanggilnya, termasuk peran yang kelak dibuat untuk
  // keperluan lain.
  const { rows } = await owner.query(
    `SELECT has_function_privilege('public', 'resolve_login_tenant(text)', 'EXECUTE') AS publik,
            has_function_privilege('lumi_app', 'resolve_login_tenant(text)', 'EXECUTE') AS aplikasi`
  );
  assert.equal(rows[0].publik, false, 'PUBLIC masih dapat memanggilnya');
  assert.equal(rows[0].aplikasi, true, 'peran aplikasi tidak dapat memanggilnya');
});

test('⛔ search_path fungsi DIKUNCI', async () => {
  // Fungsi SECURITY DEFINER tanpa search_path terkunci dapat dibajak lewat
  // objek bernama sama di skema yang dikendalikan pemanggil.
  const { rows } = await owner.query(
    `SELECT proconfig FROM pg_proc WHERE proname = 'resolve_login_tenant'`
  );
  assert.ok(rows.length === 1, 'fungsi tidak ditemukan');
  assert.ok(
    (rows[0].proconfig ?? []).some((c) => c.startsWith('search_path=')),
    `search_path tidak dikunci: ${JSON.stringify(rows[0].proconfig)}`
  );
});
