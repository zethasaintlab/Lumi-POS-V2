'use strict';

// FR-F12 -- token perangkat.
//
// `spec-f:242`: "Perangkat kasir adalah kelas perangkat yang AKAN hilang.
// Asumsi desain: setiap tablet yang dikirim ke merchant suatu saat akan
// berada di tangan yang salah."
//
// Ditarik ke F2 karena ia satu-satunya potongan Modul F yang menutup ⛔
// token PowerSync: prototipe 04/05 mencetak JWT simetris DI BROWSER, dan pada
// jalur turun sync rules adalah satu-satunya batas tenant.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });

let owner, appSetup, app, tenant, outlet;

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

async function bangun(opsi = {}) {
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp({ syncJwtPrivateKey: PEM, ...opsi });
}

beforeEach(async () => {
  await resetAll(owner);
  const base = await seedTenantBase(appSetup, { suffix: 'TokenTest' });
  tenant = base.tenant;
  outlet = base.outlet;
  await bangun();
});

function headerTenant(id = tenant.id) {
  return { 'x-tenant-id': id };
}

/* Query verifikasi WAJIB berjalan di dalam transaksi ber-`app.tenant_id`.

   `appSetup` terhubung sebagai user yang tunduk RLS (invariant #8), jadi
   tanpa `set_config` ia melihat NOL baris -- dan test yang membaca nol baris
   akan gagal dengan pesan yang menyalahkan kode aplikasi, bukan dirinya
   sendiri. Pola yang sama dipakai tests/ordering/devices.test.js. */
async function kueriTenant(sql, params, tenantId = tenant.id) {
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
  const hasil = await appSetup.query(sql, params);
  await appSetup.query('COMMIT');
  return hasil;
}

async function buatDevice(kode = 'K1') {
  const id = crypto.randomUUID();
  const res = await app.inject({
    method: 'POST',
    url: '/devices',
    payload: { id, outletId: outlet.id, code: kode },
    headers: headerTenant(),
  });
  assert.equal(res.statusCode, 201, res.body);
  return id;
}

function terbitkanKredensial(deviceId, headers = headerTenant()) {
  return app.inject({ method: 'POST', url: `/devices/${deviceId}/credentials`, headers });
}

function mintaToken(deviceId, secret, headers = headerTenant()) {
  return app.inject({
    method: 'POST',
    url: `/devices/${deviceId}/sync-token`,
    headers: { ...headers, authorization: `Bearer ${secret}` },
  });
}

function payload(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
}

// --- F12-2 penerbitan kredensial -------------------------------------------

test('F12-2 kredensial diterbitkan sekali, dan yang tersimpan hanya hash-nya', async () => {
  const deviceId = await buatDevice();
  const res = await terbitkanKredensial(deviceId);
  assert.equal(res.statusCode, 201, res.body);

  const body = res.json();
  assert.equal(body.deviceId, deviceId);
  assert.ok(body.secret.length >= 43, 'secret terlalu pendek untuk 256 bit');
  assert.ok(body.expiresAt, 'kredensial tanpa batas waktu');

  // Rahasianya TIDAK BOLEH ada di database. Kalau ia tersimpan apa adanya,
  // siapa pun yang membaca satu baris `device` dapat menyamar jadi perangkat
  // itu -- dan `spec-f:242` menetapkan perangkat memang akan jatuh ke tangan
  // yang salah.
  const { rows } = await kueriTenant(
    `SELECT token_hash, credentials_expire_at FROM device WHERE id = $1`,
    [deviceId]
  );
  assert.equal(rows.length, 1);
  assert.ok(rows[0].token_hash, 'token_hash kosong');
  assert.notEqual(rows[0].token_hash, body.secret, 'secret tersimpan apa adanya');
  assert.equal(
    rows[0].token_hash,
    crypto.createHash('sha256').update(body.secret).digest('hex')
  );
  assert.ok(rows[0].credentials_expire_at);
});

test('F12-2 menerbitkan ulang mengganti kredensial lama', async () => {
  const deviceId = await buatDevice();
  const lama = (await terbitkanKredensial(deviceId)).json().secret;
  const baru = (await terbitkanKredensial(deviceId)).json().secret;
  assert.notEqual(lama, baru);

  assert.equal((await mintaToken(deviceId, baru)).statusCode, 200);
  // Kredensial lama HARUS mati. Perangkat yang di-provisioning ulang karena
  // dicurigai bocor tidak akan tertolong kalau yang lama tetap hidup.
  assert.equal((await mintaToken(deviceId, lama)).statusCode, 401);
});

test('F12-2 device milik tenant lain tidak dapat diberi kredensial', async () => {
  const deviceId = await buatDevice();
  const lain = await seedTenantBase(appSetup, { suffix: 'TokenLain' });
  const res = await terbitkanKredensial(deviceId, headerTenant(lain.tenant.id));
  assert.equal(res.statusCode, 404, res.body);
});

// --- F12-3 & F12-4 penukaran jadi token -----------------------------------

test('F12-3 secret yang benar ditukar jadi JWT berumur pendek', async () => {
  const deviceId = await buatDevice();
  const { secret } = (await terbitkanKredensial(deviceId)).json();

  const res = await mintaToken(deviceId, secret);
  assert.equal(res.statusCode, 200, res.body);
  const body = res.json();
  assert.ok(body.endpoint, 'respons tanpa endpoint PowerSync');
  assert.ok(body.token, 'respons tanpa token');

  const p = payload(body.token);
  assert.equal(p.sub, deviceId);
  assert.ok(p.exp - p.iat <= 3600, `token berumur ${p.exp - p.iat} detik -- terlalu panjang`);
});

// ⛔ `tenant_id` adalah klaim TOP-LEVEL, bukan di dalam objek `parameters`.
// Diukur di prototipe 05: `auth.parameter('x')` membaca `payload.x`. Salah
// tempat berarti sync rules mencocokkan `tenant_id` dengan `undefined` --
// dan yang turun bukan error, melainkan NOL BARIS.
test('F12-4 token membawa tenant_id dan outlet_id sebagai klaim top-level', async () => {
  const deviceId = await buatDevice();
  const { secret } = (await terbitkanKredensial(deviceId)).json();
  const p = payload((await mintaToken(deviceId, secret)).json().token);

  assert.equal(p.tenant_id, tenant.id);
  assert.equal(p.outlet_id, outlet.id);
  assert.equal(p.parameters, undefined, 'klaim ditaruh di dalam `parameters` -- sync rules tidak membacanya di sana');
});

test('F12-3 secret salah, kosong, atau tanpa header ditolak 401', async () => {
  const deviceId = await buatDevice();
  await terbitkanKredensial(deviceId);

  assert.equal((await mintaToken(deviceId, 'bukan-secret')).statusCode, 401);
  assert.equal((await mintaToken(deviceId, '')).statusCode, 401);
  const tanpaHeader = await app.inject({
    method: 'POST',
    url: `/devices/${deviceId}/sync-token`,
    headers: headerTenant(),
  });
  assert.equal(tanpaHeader.statusCode, 401);
});

test('F12-3 perangkat yang belum pernah diberi kredensial ditolak 401', async () => {
  const deviceId = await buatDevice();
  assert.equal((await mintaToken(deviceId, 'apa saja')).statusCode, 401);
});

// AC PERTAMA FR-F12: "Token tidak dapat dipakai di perangkat lain."
test('F12-4 secret milik satu perangkat tidak dapat dipakai perangkat lain', async () => {
  const a = await buatDevice('K1');
  const b = await buatDevice('K2');
  const { secret } = (await terbitkanKredensial(a)).json();
  await terbitkanKredensial(b);

  assert.equal((await mintaToken(b, secret)).statusCode, 401);
});

// Berbohong soal tenant tidak memberi apa pun: device id-nya tidak ditemukan
// di sana, karena pencariannya tunduk RLS (invariant #8).
test('F12-4 tenant yang salah tidak dapat menukar secret yang benar', async () => {
  const deviceId = await buatDevice();
  const { secret } = (await terbitkanKredensial(deviceId)).json();
  const lain = await seedTenantBase(appSetup, { suffix: 'TokenLain2' });

  const res = await mintaToken(deviceId, secret, headerTenant(lain.tenant.id));
  assert.equal(res.statusCode, 401, res.body);
});

// AC KEDUA FR-F12: "Pencabutan berlaku pada koneksi berikutnya."
test('F12-6 device yang dicabut tidak dapat lagi menukar tokennya', async () => {
  const deviceId = await buatDevice();
  const { secret } = (await terbitkanKredensial(deviceId)).json();
  assert.equal((await mintaToken(deviceId, secret)).statusCode, 200);

  const cabut = await app.inject({
    method: 'POST',
    url: `/devices/${deviceId}/revoke`,
    headers: headerTenant(),
  });
  assert.equal(cabut.statusCode, 200, cabut.body);

  assert.equal((await mintaToken(deviceId, secret)).statusCode, 401);
});

// OQ-08 (keputusan 7 Agustus 2026): batas kredensial offline 30 hari.
test('F12-3 kredensial yang kedaluwarsa ditolak, dan pesannya menyebut sebabnya', async () => {
  const deviceId = await buatDevice();
  const { secret } = (await terbitkanKredensial(deviceId)).json();
  await kueriTenant(
    `UPDATE device SET credentials_expire_at = now() - interval '1 day' WHERE id = $1`,
    [deviceId]
  );

  const res = await mintaToken(deviceId, secret);
  assert.equal(res.statusCode, 401, res.body);
  assert.match(res.json().error.code, /EXPIRED/);
});

test('F12-3 penukaran yang berhasil mencatat last_seen_at', async () => {
  const deviceId = await buatDevice();
  const { secret } = (await terbitkanKredensial(deviceId)).json();
  await mintaToken(deviceId, secret);

  const { rows } = await kueriTenant('SELECT last_seen_at FROM device WHERE id = $1', [deviceId]);
  assert.ok(rows[0].last_seen_at, 'last_seen_at tidak diperbarui -- dashboard tidak dapat melihat perangkat diam');
});

// --- F12-5 JWKS ------------------------------------------------------------

test('F12-5 JWKS dilayani tanpa header tenant dan tanpa kredensial', async () => {
  const res = await app.inject({ method: 'GET', url: '/.well-known/jwks.json' });
  assert.equal(res.statusCode, 200, res.body);
  const jwk = res.json().keys[0];
  assert.equal(jwk.kty, 'RSA');
  assert.equal(jwk.d, undefined, 'JWKS membocorkan kunci privat');
});

test('F12-5 tanpa kunci: JWKS dan penukaran token 503, bukan token tanpa tanda tangan', async () => {
  await bangun({ syncJwtPrivateKey: '' });
  const base = await seedTenantBase(appSetup, { suffix: 'TokenKosong' });
  tenant = base.tenant;
  outlet = base.outlet;

  const jwks = await app.inject({ method: 'GET', url: '/.well-known/jwks.json' });
  assert.equal(jwks.statusCode, 503, jwks.body);

  const deviceId = await buatDevice('K9');
  const { secret } = (await terbitkanKredensial(deviceId)).json();
  const res = await mintaToken(deviceId, secret);
  assert.equal(res.statusCode, 503, res.body);
});
