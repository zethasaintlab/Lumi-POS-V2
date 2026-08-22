'use strict';

// Penjaga sesi back-office (`apps/server/src/sesi.ts`).
//
// Sebelum ini, `X-Actor-Id` adalah satu-satunya "identitas" yang dipegang
// server — header biasa berisi id pengguna. Siapa pun yang tahu sepasang
// tenant_id + user_id dapat memanggil seluruh permukaan back-office.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { buatSesi, headerSesi } = require('../isolation/helpers/sesi');

let owner, appDb, app, tenant, token;

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
  tenant = await daftar();
  token = await buatSesi(appDb, { tenantId: tenant.id, userId: tenant.ownerId });
});

async function daftar() {
  const b = {
    tenant: { id: crypto.randomUUID(), name: 'Kopi Sesi' },
    outlet: { id: crypto.randomUUID(), name: 'Pusat', timezone: 'Asia/Jakarta' },
    owner: {
      id: crypto.randomUUID(),
      name: 'Pemilik',
      email: `owner+${crypto.randomUUID()}@contoh.id`,
      password: 'kopi susu gula aren',
    },
  };
  const res = await app.inject({
    method: 'POST',
    url: '/tenants',
    payload: b,
    headers: { 'content-type': 'application/json' },
  });
  assert.equal(res.statusCode, 201, res.body);
  return { id: b.tenant.id, outletId: b.outlet.id, ownerId: b.owner.id };
}

const RUTE_UJI = { method: 'GET', url: '/tenants/usage' };

// --- penolakan -------------------------------------------------------------

test('⛔ TANPA Bearer → 401, meski X-Actor-Id dikirim', async () => {
  // Inilah lubangnya. Sebelum middleware ini, permintaan berikut BERHASIL.
  const res = await app.inject({
    ...RUTE_UJI,
    headers: { 'x-tenant-id': tenant.id, 'x-actor-id': tenant.ownerId },
  });
  assert.equal(res.statusCode, 401, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'SESSION_INVALID');
});

test('⛔ token KARANGAN ditolak', async () => {
  const res = await app.inject({
    ...RUTE_UJI,
    headers: headerSesi(tenant.id, crypto.randomBytes(32).toString('base64url')),
  });
  assert.equal(res.statusCode, 401, res.body);
});

test('⛔ token KEDALUWARSA ditolak', async () => {
  const kedaluwarsa = await buatSesi(appDb, {
    tenantId: tenant.id,
    userId: tenant.ownerId,
    kedaluwarsaDalamJam: -1,
  });
  const res = await app.inject({ ...RUTE_UJI, headers: headerSesi(tenant.id, kedaluwarsa) });
  assert.equal(res.statusCode, 401, res.body);
});

test('⛔ token milik TENANT LAIN ditolak', async () => {
  // Petunjuk tenant yang dipalsukan tidak membeli apa pun: token tenant A
  // tidak akan ditemukan saat dicari di tenant B.
  const lain = await daftar();
  const tokenLain = await buatSesi(appDb, { tenantId: lain.id, userId: lain.ownerId });

  const res = await app.inject({ ...RUTE_UJI, headers: headerSesi(tenant.id, tokenLain) });
  assert.equal(res.statusCode, 401, res.body);
});

test('⛔ sesi pengguna yang DINONAKTIFKAN langsung mati', async () => {
  // Tanpa `u.is_active = true` di pencarian, memecat kasir tidak mencabut apa
  // pun sampai sesinya kedaluwarsa sendiri — sampai 12 jam kemudian.
  assert.equal((await app.inject({ ...RUTE_UJI, headers: headerSesi(tenant.id, token) })).statusCode, 200);

  await appDb.query('BEGIN');
  await appDb.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await appDb.query('UPDATE "user" SET is_active = false WHERE id = $1', [tenant.ownerId]);
  await appDb.query('COMMIT');

  const res = await app.inject({ ...RUTE_UJI, headers: headerSesi(tenant.id, token) });
  assert.equal(res.statusCode, 401, res.body);
});

test('⛔ skema Authorization selain Bearer ditolak', async () => {
  for (const nilai of [`Basic ${token}`, token, 'Bearer', 'Bearer    ']) {
    const res = await app.inject({
      ...RUTE_UJI,
      headers: { 'x-tenant-id': tenant.id, authorization: nilai },
    });
    assert.equal(res.statusCode, 401, `"${nilai}" diterima`);
  }
});

test('⛔ SATU pesan untuk semua sebab penolakan', async () => {
  // Membedakan "tidak ada token" dari "kedaluwarsa" dari "tenant salah"
  // memberi penebak peta untuk memperbaiki tebakannya (`spec-f:148`).
  const kedaluwarsa = await buatSesi(appDb, {
    tenantId: tenant.id,
    userId: tenant.ownerId,
    kedaluwarsaDalamJam: -1,
  });
  const pesan = new Set();
  for (const h of [
    { 'x-tenant-id': tenant.id },
    headerSesi(tenant.id, 'karangan'),
    headerSesi(tenant.id, kedaluwarsa),
    headerSesi('tenant-tidak-ada', token),
  ]) {
    const res = await app.inject({ ...RUTE_UJI, headers: h });
    assert.equal(res.statusCode, 401);
    pesan.add(JSON.parse(res.body).error.message);
  }
  assert.equal(pesan.size, 1, `pesan berbeda-beda: ${[...pesan].join(' | ')}`);
});

// --- pengambilalihan konteks -----------------------------------------------

test('⛔ X-Actor-Id yang DIPALSUKAN diabaikan sepenuhnya', async () => {
  // Ini pokok seluruh perubahan. Aktor datang dari baris sesi, bukan dari
  // header — jadi audit trail tidak dapat dinisbatkan ke orang lain.
  const kasirId = crypto.randomUUID();
  const buat = await app.inject({
    method: 'POST',
    url: '/users',
    payload: {
      id: kasirId,
      name: 'Kasir',
      roles: [{ role: 'cashier', scopeType: 'outlet', scopeId: tenant.outletId }],
      outletIds: [tenant.outletId],
    },
    headers: headerSesi(tenant.id, token),
  });
  assert.equal(buat.statusCode, 201, buat.body);

  // Owner login; klaim bertindak sebagai kasir.
  const res = await app.inject({
    method: 'POST',
    url: '/outlets',
    payload: { id: crypto.randomUUID(), name: 'Cabang', timezone: 'Asia/Jakarta' },
    headers: headerSesi(tenant.id, token, { 'x-actor-id': kasirId }),
  });

  // Kuota outlet tier gratis = 1, jadi 403 QUOTA_EXCEEDED. Yang PENTING: ia
  // BUKAN 403 FORBIDDEN — kalau header dipakai, aktornya kasir dan RBAC yang
  // menolak lebih dulu.
  assert.equal(res.statusCode, 403, res.body);
  assert.equal(
    JSON.parse(res.body).error.code,
    'QUOTA_EXCEEDED',
    'X-Actor-Id dari klien dipakai — aktor dapat dipalsukan'
  );
});

test('⛔ X-Tenant-Id yang berbeda dari sesi tidak dapat memindahkan penulisan', async () => {
  // Pencarian sesi berjalan di tenant yang diklaim, jadi klaim yang salah
  // sudah gagal di 401. Yang diuji di sini: setelah lolos, tenant yang
  // BERLAKU adalah milik sesinya.
  const res = await app.inject({ ...RUTE_UJI, headers: headerSesi(tenant.id, token) });
  assert.equal(res.statusCode, 200, res.body);
  const b = JSON.parse(res.body);
  assert.equal(b.kuota.outlet.terpakai, 1, 'pemakaian dibaca dari tenant sesi');
});

// --- rute terbuka ----------------------------------------------------------

test('⛔ jalur perangkat kasir TETAP jalan tanpa Bearer', async () => {
  // Relay outbox mengirim TEPAT empat header dan tidak satu pun Bearer
  // (`packages/sync-client/src/http.ts`). Melindungi rute ini berarti setiap
  // penjualan offline yang menyusul dijawab 401 — jalur naik mati.
  //
  // Diuji lewat `POST /shifts`: yang diharapkan adalah penolakan APA PUN
  // selain 401, karena payload-nya memang tidak lengkap di sini.
  const res = await app.inject({
    method: 'POST',
    url: '/shifts',
    payload: {},
    headers: {
      'content-type': 'application/json',
      'x-tenant-id': tenant.id,
      'x-actor-id': tenant.ownerId,
    },
  });
  assert.notEqual(res.statusCode, 401, 'jalur perangkat ikut terkunci — jalur naik mati');
});

test('endpoint terbuka tetap dapat dicapai tanpa sesi', async () => {
  assert.equal((await app.inject({ method: 'GET', url: '/health' })).statusCode, 200);
  assert.notEqual(
    (await app.inject({ method: 'GET', url: '/.well-known/jwks.json' })).statusCode,
    401
  );
  // Login: kredensial salah → 401 INVALID_CREDENTIALS, BUKAN SESSION_INVALID.
  const login = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: 'x@y.id', password: 'salah sekali sungguh' },
    headers: { 'content-type': 'application/json', 'x-tenant-id': tenant.id },
  });
  assert.equal(JSON.parse(login.body).error.code, 'INVALID_CREDENTIALS');
});

// --- ⛔ daftar rute terbuka tidak boleh menyimpang dari rute yang ada -------

test('⛔ setiap pola di RUTE_TERBUKA benar-benar terdaftar di server', async () => {
  // Pola yang salah ketik menjadi rute yang tidak pernah cocok — dan
  // konsekuensinya diam: rute yang dimaksud terbuka justru TERLINDUNGI, lalu
  // jalur naik mati di produksi. Daftar terbuka adalah tempat salah ketik
  // paling mahal di berkas itu.
  const { DAFTAR_RUTE_TERBUKA } = await import('../../apps/server/src/sesi.ts');
  const pohon = app.printRoutes({ commonPrefix: false });

  const tidakAda = [];
  for (const r of DAFTAR_RUTE_TERBUKA) {
    // `printRoutes` menuliskan segmen berjenjang; dicocokkan lewat segmen
    // terakhir + metodenya, cukup untuk menangkap salah ketik.
    const segmen = r.pola.split('/').filter(Boolean).pop() ?? '';
    if (!pohon.includes(segmen)) tidakAda.push(`${r.metode} ${r.pola}`);
  }
  assert.deepEqual(tidakAda, [], `pola tidak cocok rute mana pun: ${tidakAda.join(', ')}`);
});

test('⛔ setiap rute terbuka punya ALASAN tertulis', async () => {
  // Daftar pengecualian keamanan tanpa alasan akan bertambah panjang sampai
  // ia tidak menjaga apa pun — pola yang sama dengan penjaga sync-rules yang
  // daftarnya diturunkan dari DDL, bukan ditulis tangan.
  const { DAFTAR_RUTE_TERBUKA } = await import('../../apps/server/src/sesi.ts');
  for (const r of DAFTAR_RUTE_TERBUKA) {
    assert.ok(
      typeof r.alasan === 'string' && r.alasan.length > 20,
      `${r.metode} ${r.pola} tidak punya alasan yang berarti`
    );
  }
});

// --- logout ----------------------------------------------------------------

test('logout menghapus barisnya dan token itu tidak dapat dipakai lagi', async () => {
  const keluar = await app.inject({
    method: 'POST',
    url: '/auth/logout',
    headers: { 'x-tenant-id': tenant.id, authorization: `Bearer ${token}` },
  });
  assert.equal(keluar.statusCode, 204, keluar.body);

  const lagi = await app.inject({ ...RUTE_UJI, headers: headerSesi(tenant.id, token) });
  assert.equal(lagi.statusCode, 401, 'token masih berlaku setelah logout');
});

// ---------------------------------------------------------------------------
// ⛔ Jalur perangkat: sesi TIDAK dituntut, tapi DITEGAKKAN bila dibawa
// ---------------------------------------------------------------------------
//
// Lubangnya nyata dan ditemukan lewat test yang berubah warna: menambahkan
// `/shifts/{id}/no-sale` ke `RUTE_TERBUKA` membuat "AKUNTAN ditolak" berubah
// dari 403 menjadi 201. Rute yang SEPENUHNYA terbuka mengembalikan
// kepercayaan pada `X-Actor-Id` — sekalipun pemanggilnya punya sesi — dan
// kontrol peran `spec-f:82` menguap tanpa satu pun error.

const RUTE_PERANGKAT = { method: 'POST', url: '/shifts' };

test('⛔ jalur perangkat TANPA Bearer tetap lewat — relay tidak pernah mengirimnya', async () => {
  // Menuntut Bearer di sini berarti setiap penjualan offline yang menyusul
  // dijawab 401. Itu menghancurkan jalur naik.
  const res = await app.inject({
    ...RUTE_PERANGKAT,
    payload: { id: crypto.randomUUID(), outletId: tenant.outletId, deviceId: crypto.randomUUID(),
      businessDate: '2026-08-21', openingFloat: 0 },
    headers: { 'x-tenant-id': tenant.id, 'x-actor-id': tenant.ownerId,
      'idempotency-key': crypto.randomUUID() },
  });
  // Bukan 401: ia boleh gagal karena alasan LAIN (device tidak ada), tapi
  // tidak boleh ditolak penjaga sesi.
  assert.notEqual(res.statusCode, 401, res.body);
});

test('⛔ jalur perangkat dengan Bearer TIDAK SAH ditolak 401, bukan diabaikan', async () => {
  const res = await app.inject({
    ...RUTE_PERANGKAT,
    payload: { id: crypto.randomUUID(), outletId: tenant.outletId, deviceId: crypto.randomUUID(),
      businessDate: '2026-08-21', openingFloat: 0 },
    headers: { 'x-tenant-id': tenant.id, authorization: 'Bearer bukan-token',
      'x-actor-id': tenant.ownerId, 'idempotency-key': crypto.randomUUID() },
  });
  assert.equal(res.statusCode, 401, res.body);
  assert.equal(res.json().error.code, 'SESSION_INVALID');
});

// ⛔ "Sesi yang dibawa MENANG atas `X-Actor-Id`" diuji di
// `tests/server/no-sale.test.js` ("AKUNTAN ditolak"), bukan di sini — dan
// sengaja tidak diduplikasi.
//
// Alasannya bukan kerapian: `POST /shifts` dan `POST /orders` TIDAK punya
// aturan peran sama sekali (`rbac-rute.ts`), jadi test di rute itu akan
// menyatakan penolakan yang tidak pernah dilakukan siapa pun. Satu-satunya
// jalur perangkat yang benar-benar menegakkan peran adalah
// `/shifts/{id}/no-sale`, lewat `assertBoleh` di handler-nya — dan test di
// sanalah yang berubah dari 403 menjadi 201 saat rute itu dibuka, yang
// menemukan lubang ini.

test('⛔ rute berkredensial PERANGKAT tidak pernah memverifikasi Bearer sebagai sesi', async () => {
  // Bearer di `sync-token` adalah SECRET PERANGKAT. Memverifikasinya sebagai
  // token sesi menolak perangkat yang sah dengan 401 — dan gejalanya adalah
  // seluruh armada berhenti sinkron setelah satu perubahan middleware.
  const res = await app.inject({
    method: 'POST',
    url: `/devices/${crypto.randomUUID()}/sync-token`,
    headers: { 'x-tenant-id': tenant.id, authorization: 'Bearer secret-perangkat-acak' },
  });
  // 401 DEVICE_UNAUTHORIZED dari handler, bukan SESSION_INVALID dari penjaga.
  assert.equal(res.statusCode, 401, res.body);
  assert.notEqual(res.json().error.code, 'SESSION_INVALID');
});
