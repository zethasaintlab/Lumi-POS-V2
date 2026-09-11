'use strict';

// ⛔ HASH YANG DITULIS LANGSUNG KE TABEL WAJIB DAPAT DIPAKAI MASUK.
//
// ## Kenapa jalur ini ada sama sekali
//
// `password123` ada di dalam `PASSWORD_BOCOR` (FR-F2b), jadi
// `PUT /users/{id}/password` menjawab `400 PASSWORD_BREACHED` — perilaku yang
// BENAR. `tools/seed-explore.mjs` karena itu mencoba API dulu dan hanya
// menulis hash langsung ke tabel bila API menolaknya karena bocor.
//
// Jalur itu melangkahi kontrol produk, dan satu-satunya hal yang membuatnya
// aman adalah bahwa hash-nya dibuat `buatPinHasher()` yang SAMA dengan yang
// server pakai untuk memverifikasi. Kalau parameter Argon2id-nya menyimpang —
// memory, passes, parallelism, atau format PHC-nya — seed menghasilkan akun
// yang TIDAK DAPAT MASUK, dan gejalanya `401` berpesan "Email atau password
// salah."
//
// ## Kenapa test ini ditulis 11 September 2026
//
// Persis salah baca itu benar-benar terjadi. Dilaporkan sebagai cacat:
// *"password seed `password123` tidak terverifikasi meski `password_hash`
// sudah terisi"*. Ia TIDAK PERNAH ADA — yang terjadi adalah login diuji tanpa
// `x-tenant-id` pada email yang ada di dua tenant, dan 401 dari resolusi
// tenant yang ambigu terbaca sebagai password yang salah.
//
// Pesan 401-nya memang SATU untuk setiap sebab kegagalan (`spec-f:148`), dan
// itu kontrol yang benar: membedakannya menjadikan login oracle enumerasi.
// Ongkosnya ditanggung di sini — dugaan "hash seed rusak" tidak lagi dapat
// dijawab dengan menatap kode, karena ada test yang menjawabnya.
//
// ⛔ Ia menguji sampai LOGIN SUNGGUHAN, bukan berhenti di `verifikasi()`.
// `pin-hasher.test.js` sudah membuktikan hasher-nya konsisten dengan dirinya
// sendiri; yang belum dibuktikan siapa pun adalah bahwa hash yang mendarat di
// kolom lewat `INSERT`/`UPDATE` langsung benar-benar diterima jalur
// `POST /auth/login`. Hasher yang konsisten dengan dirinya sendiri tetap
// menghasilkan akun yang tidak dapat masuk bila kolom, encoding, atau
// pembacanya berbeda.

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

const SANDI_BOOTSTRAP = 'Eksplorasi#2026Lumi';

/** Sama seperti langkah 1 `seed:explore`: tenant + outlet + owner lewat API. */
async function daftar(email) {
  const b = {
    tenant: { id: crypto.randomUUID(), name: 'Kopi Hash' },
    outlet: { id: crypto.randomUUID(), name: 'Pusat', timezone: 'Asia/Jakarta' },
    owner: { id: crypto.randomUUID(), name: 'Pemilik', email, password: SANDI_BOOTSTRAP },
  };
  const res = await app.inject({
    method: 'POST',
    url: '/tenants',
    payload: b,
    headers: { 'content-type': 'application/json' },
  });
  assert.equal(res.statusCode, 201, res.body);
  return { tenantId: b.tenant.id, ownerId: b.owner.id };
}

/** Tulis hash langsung ke kolom — jalur yang seed pakai saat API menolak. */
async function tulisHashLangsung(tenantId, userId, sandi) {
  const { buatPinHasher } = await import(
    '../../apps/server/src/modules/identity/pin-hasher.ts'
  );
  const phc = await buatPinHasher().hash(sandi);

  await appDb.query('BEGIN');
  await appDb.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
  const { rowCount } = await appDb.query(
    'UPDATE "user" SET password_hash = $2 WHERE id = $1',
    [userId, phc]
  );
  await appDb.query('COMMIT');
  assert.equal(rowCount, 1, 'hash tidak tertulis — RLS?');
  return phc;
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

test('⛔ password yang BOCOR ditolak API — jalur bypass seed memang perlu ada', async () => {
  // Prasyarat yang membuat sisa berkas ini masuk akal. Kalau kontrol ini
  // hilang, seed tidak lagi butuh bypass, dan test di bawah menjaga jalur yang
  // tidak dipakai siapa pun.
  const t = await daftar('bocor@contoh.id');
  const sesi = JSON.parse(
    (await masuk({ email: 'bocor@contoh.id', password: SANDI_BOOTSTRAP })).body
  );

  const res = await app.inject({
    method: 'PUT',
    url: `/users/${t.ownerId}/password`,
    payload: { password: 'password123' },
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${sesi.token}`,
      'x-tenant-id': t.tenantId,
    },
  });
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'PASSWORD_BREACHED');
});

test('⛔ hash `password123` yang ditulis LANGSUNG diterima POST /auth/login', async () => {
  // Inti berkas ini. `password123` dipakai apa adanya — bukan sandi lain yang
  // "mirip" — karena ia yang seed tulis, dan ia yang pernah dilaporkan tidak
  // terverifikasi.
  const t = await daftar('langsung@contoh.id');
  await tulisHashLangsung(t.tenantId, t.ownerId, 'password123');

  const res = await masuk(
    { email: 'langsung@contoh.id', password: 'password123' },
    { 'x-tenant-id': t.tenantId }
  );
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(JSON.parse(res.body).userId, t.ownerId);
});

test('⛔ hash langsung juga bekerja TANPA x-tenant-id saat owner tunggal', async () => {
  // Kedua jalur sekaligus: hash ditulis langsung, DAN tenant diresolusi dari
  // email. Gabungan inilah yang dipakai orang saat membuka back-office setelah
  // `seed:explore` — dan gabungan inilah yang pernah dilaporkan gagal.
  const t = await daftar('tunggal@contoh.id');
  await tulisHashLangsung(t.tenantId, t.ownerId, 'password123');

  const res = await masuk({ email: 'tunggal@contoh.id', password: 'password123' });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(JSON.parse(res.body).tenantId, t.tenantId);
});

test('⛔ hash langsung MENGGANTI sandi lama, tidak menumpuk', async () => {
  // Kalau sandi bootstrap masih diterima sesudah hash ditulis ulang, berarti
  // ada kolom atau cabang KEDUA yang memverifikasi — dan sandi yang merchant
  // kira sudah diganti ternyata masih hidup.
  const t = await daftar('ganti@contoh.id');
  await tulisHashLangsung(t.tenantId, t.ownerId, 'password123');

  const lama = await masuk(
    { email: 'ganti@contoh.id', password: SANDI_BOOTSTRAP },
    { 'x-tenant-id': t.tenantId }
  );
  assert.equal(lama.statusCode, 401, 'sandi lama masih diterima sesudah hash diganti');
});

test('⛔ sandi SALAH atas hash langsung tetap ditolak', async () => {
  // Kontrol terhadap test di atas. Tanpa ini, verifikasi yang selalu menjawab
  // "cocok" akan membuat ketiganya hijau — dan hijaunya berarti pintu terbuka
  // untuk siapa pun.
  const t = await daftar('salah@contoh.id');
  await tulisHashLangsung(t.tenantId, t.ownerId, 'password123');

  const res = await masuk(
    { email: 'salah@contoh.id', password: 'password124' },
    { 'x-tenant-id': t.tenantId }
  );
  assert.equal(res.statusCode, 401, res.body);
});
