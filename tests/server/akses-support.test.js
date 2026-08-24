'use strict';

// F.5 — akses support (`spec-f:391`).
//
// Empat acceptance criteria, dan keempatnya diuji lewat HTTP:
//
//   1. Akses support tanpa persetujuan merchant tidak mungkin
//   2. Sesi berakhir otomatis saat `expires_at`
//   3. Banner terlihat di semua layar selama sesi aktif  → sisi server:
//      daftarnya dapat dibaca SETIAP peran, bukan owner saja
//   4. Setiap tindakan selama sesi support tercatat dengan penanda
//
// ⛔ AC keempat adalah yang paling mudah lulus secara hampa. Test yang hanya
// memeriksa bahwa `support_session_started` tertulis membuktikan pemberian
// aksesnya tercatat — bukan bahwa TINDAKAN selama sesi itu tercatat. Yang
// diuji di sini karena itu adalah baris audit dari perubahan katalog yang
// dilakukan LEWAT token support.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');

let owner, db, app, base, tenant;

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

/** Header yang dipakai petugas support: token support di Bearer. */
const hdrSupport = (token, ubah = {}) => ({
  'x-tenant-id': tenant.id,
  authorization: `Bearer ${token}`,
  'content-type': 'application/json',
  ...ubah,
});

beforeEach(async () => {
  await db.query('ROLLBACK').catch(() => {});
  await resetAll(owner);
  base = await seedTenantBase(db, { suffix: 'Support' });
  tenant = base.tenant;

  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();
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

const beri = (payload = {}, ubah = {}) =>
  app.inject({
    method: 'POST',
    url: '/support-sessions',
    headers: hdr(ubah),
    payload: {
      adminLabel: 'Rina (support Lumi)',
      reasonCode: 'investigasi_laporan_bug',
      ...payload,
    },
  });

/**
 * ⛔ Peran diganti pada PEMILIK SESI, bukan lewat `X-Actor-Id`: header itu
 * diabaikan sepenuhnya di rute terlindungi ("sesi menang").
 *
 * Cakupan mengikuti `spec-f:27-33` — owner dan akuntan ber-cakupan tenant,
 * sisanya per outlet. `scope_id` `NOT NULL`, jadi cakupan tenant memakai id
 * tenantnya sendiri.
 */
async function jadikanPeran(peran) {
  const tenantWide = peran === 'owner' || peran === 'accountant';
  await query('DELETE FROM user_role WHERE user_id = $1', [base.user.id]);
  await query(
    `INSERT INTO user_role (id, tenant_id, user_id, role, scope_type, scope_id)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      crypto.randomUUID(),
      tenant.id,
      base.user.id,
      peran,
      tenantWide ? 'tenant' : 'outlet',
      tenantWide ? tenant.id : base.outlet.id,
    ]
  );
}

/**
 * Menua-kan sesi sehingga ia sudah lewat batasnya.
 *
 * ⛔ KEDUA stempel digeser, bukan hanya `expires_at`. CHECK
 * `expires_at > started_at` menolak yang sebelah — dan itu constraint yang
 * memang harus ada: sesi yang berakhir sebelum ia mulai bukan keadaan yang
 * boleh dapat ditulis, termasuk oleh test.
 */
async function tuakan(id, menit = 1) {
  await query(
    `UPDATE support_session
        SET started_at = started_at - ($2 || ' minutes')::interval - interval '2 hours',
            expires_at = expires_at - ($2 || ' minutes')::interval - interval '2 hours'
      WHERE id = $1`,
    [id, String(menit)]
  );
}

// ---------------------------------------------------------------------------
// AC 1 — akses tanpa persetujuan merchant tidak mungkin
// ---------------------------------------------------------------------------

test('⛔ token support ADA hanya sebagai keluaran pemberian oleh owner', async () => {
  const res = await beri();
  assert.equal(res.statusCode, 201, res.body);
  const b = res.json();
  assert.ok(typeof b.token === 'string' && b.token.length >= 40, 'token tidak diterbitkan');
  assert.equal(b.state, 'aktif');
  assert.equal(b.writeEnabled, false, 'read-only adalah bawaan');

  // ⛔ Yang tersimpan HASH-nya. Siapa pun yang dapat membaca tabel ini tidak
  // boleh dapat menyamar jadi petugas support.
  const [row] = await query('SELECT token_hash FROM support_session WHERE id = $1', [b.id]);
  assert.notEqual(row.token_hash, b.token);
  assert.equal(
    row.token_hash,
    crypto.createHash('sha256').update(b.token).digest('hex')
  );
});

test('⛔ token tidak pernah dapat dibaca kembali sesudahnya', async () => {
  const dibuat = (await beri()).json();
  const daftar = await app.inject({ method: 'GET', url: '/support-sessions', headers: hdr() });
  assert.equal(daftar.statusCode, 200, daftar.body);
  const sesi = daftar.json().sessions.find((s) => s.id === dibuat.id);
  assert.ok(sesi, 'sesinya harus ada di daftar');
  assert.equal(sesi.token, undefined, 'token TIDAK boleh muncul lagi');
});

test('⛔ token asing ditolak 401, sama seperti Bearer asing mana pun', async () => {
  const res = await app.inject({
    method: 'GET',
    url: '/items',
    headers: hdrSupport(crypto.randomBytes(32).toString('base64url')),
  });
  assert.equal(res.statusCode, 401, res.body);
});

test('non-owner tidak dapat memberi akses', async () => {
  for (const peran of ['area_manager', 'outlet_manager', 'cashier', 'accountant']) {
    await jadikanPeran(peran);
    const res = await beri();
    assert.equal(res.statusCode, 403, `${peran}: ${res.body}`);
  }
  const rows = await query('SELECT id FROM support_session');
  assert.equal(rows.length, 0, 'tidak ada sesi yang tertulis');
});

test('sesi aktif yang sudah ada menolak yang baru — dua token hidup mustahil', async () => {
  assert.equal((await beri()).statusCode, 201);
  const kedua = await beri();
  assert.equal(kedua.statusCode, 409, kedua.body);
  assert.equal(kedua.json().error.code, 'SUPPORT_SESSION_ACTIVE');
});

test('alasan asing, nama kosong, dan durasi di atas 24 jam ditolak sebelum menulis', async () => {
  for (const p of [
    { reasonCode: 'penasaran_saja' },
    { adminLabel: '  ' },
    { durationMinutes: 1441 },
    { reasonCode: 'lainnya' },
  ]) {
    const res = await beri(p);
    assert.equal(res.statusCode, 400, `${JSON.stringify(p)}: ${res.body}`);
  }
  const rows = await query('SELECT id FROM support_session');
  assert.equal(rows.length, 0);
});

// ---------------------------------------------------------------------------
// AC 2 — sesi berakhir otomatis
// ---------------------------------------------------------------------------

test('⛔ sesi yang KEDALUWARSA menolak akses, termasuk membaca', async () => {
  const b = (await beri()).json();
  // Sesi yang kedaluwarsa masih dapat membaca adalah sesi yang tidak
  // benar-benar berbatas waktu. Waktunya digeser lewat database — kedaluwarsa
  // dihitung dari jam DATABASE, bukan jam Node.
  await tuakan(b.id);

  const res = await app.inject({ method: 'GET', url: '/items', headers: hdrSupport(b.token) });
  assert.equal(res.statusCode, 403, res.body);
  assert.equal(res.json().error.code, 'SUPPORT_SESSION_EXPIRED');
});

test('⛔ kedaluwarsa dijawab 403 EXPIRED, bukan 401 — dan perbedaannya berguna', async () => {
  // Petugas support yang menerima 401 untuk sesi yang baru saja kedaluwarsa
  // akan menyimpulkan tokennya salah dan meminta merchant mengulang seluruh
  // prosesnya. Yang dimaksud adalah "mintalah persetujuan baru".
  const b = (await beri()).json();
  await tuakan(b.id);
  const kedaluwarsa = await app.inject({
    method: 'GET',
    url: '/items',
    headers: hdrSupport(b.token),
  });
  const asing = await app.inject({
    method: 'GET',
    url: '/items',
    headers: hdrSupport(crypto.randomBytes(32).toString('base64url')),
  });
  assert.equal(kedaluwarsa.statusCode, 403);
  assert.equal(asing.statusCode, 401);
});

test('sesi yang DIAKHIRI berhenti berlaku seketika', async () => {
  const b = (await beri()).json();
  assert.equal(
    (await app.inject({ method: 'GET', url: '/items', headers: hdrSupport(b.token) })).statusCode,
    200,
    'sebelum diakhiri harus dapat membaca'
  );

  const akhiri = await app.inject({
    method: 'POST',
    url: `/support-sessions/${b.id}/end`,
    headers: hdr(),
    payload: {},
  });
  assert.equal(akhiri.statusCode, 200, akhiri.body);
  assert.equal(akhiri.json().state, 'diakhiri');

  const sesudah = await app.inject({
    method: 'GET',
    url: '/items',
    headers: hdrSupport(b.token),
  });
  assert.equal(sesudah.statusCode, 403, sesudah.body);
});

test('mengakhiri sesi yang sudah berakhir dijawab 409, yang tidak ada 404', async () => {
  const b = (await beri()).json();
  await app.inject({
    method: 'POST',
    url: `/support-sessions/${b.id}/end`,
    headers: hdr(),
    payload: {},
  });
  const lagi = await app.inject({
    method: 'POST',
    url: `/support-sessions/${b.id}/end`,
    headers: hdr(),
    payload: {},
  });
  assert.equal(lagi.statusCode, 409, lagi.body);
  assert.equal(lagi.json().error.code, 'SUPPORT_SESSION_ENDED');

  const asing = await app.inject({
    method: 'POST',
    url: `/support-sessions/${crypto.randomUUID()}/end`,
    headers: hdr(),
    payload: {},
  });
  assert.equal(asing.statusCode, 404, asing.body);
});

test('⛔ owner yang DINONAKTIFKAN mencabut sesi yang ia beri', async () => {
  // Persetujuan itu miliknya; orang yang sudah tidak ada di merchant tidak
  // dapat terus mengizinkan akses atas namanya.
  const b = (await beri()).json();
  await query('UPDATE "user" SET is_active = false WHERE id = $1', [base.user.id]);
  const res = await app.inject({ method: 'GET', url: '/items', headers: hdrSupport(b.token) });
  assert.equal(res.statusCode, 401, res.body);
});

// ---------------------------------------------------------------------------
// AC 3 — banner: daftarnya dapat dibaca SETIAP peran
// ---------------------------------------------------------------------------

test('⛔ setiap peran dapat MEMBACA daftar sesi — banner harus terlihat semua orang', async () => {
  await beri();
  for (const peran of ['owner', 'area_manager', 'outlet_manager', 'cashier', 'accountant']) {
    await jadikanPeran(peran);
    const res = await app.inject({ method: 'GET', url: '/support-sessions', headers: hdr() });
    assert.equal(res.statusCode, 200, `${peran}: ${res.body}`);
    assert.equal(res.json().sessions.length, 1, peran);
  }
});

test('riwayat ikut di daftar, bukan hanya sesi aktif', async () => {
  const b = (await beri()).json();
  await app.inject({
    method: 'POST',
    url: `/support-sessions/${b.id}/end`,
    headers: hdr(),
    payload: {},
  });
  const res = await app.inject({ method: 'GET', url: '/support-sessions', headers: hdr() });
  const sesi = res.json().sessions;
  assert.equal(sesi.length, 1);
  assert.equal(sesi[0].state, 'diakhiri', 'sesi berakhir tetap terlihat');
});

// ---------------------------------------------------------------------------
// ⛔ Read-only bawaan
// ---------------------------------------------------------------------------

test('⛔ sesi read-only DAPAT membaca dan TIDAK dapat menulis', async () => {
  const b = (await beri()).json();

  const baca = await app.inject({ method: 'GET', url: '/items', headers: hdrSupport(b.token) });
  assert.equal(baca.statusCode, 200, baca.body);

  const tulis = await app.inject({
    method: 'POST',
    url: '/categories',
    headers: { ...hdrSupport(b.token), 'idempotency-key': crypto.randomUUID() },
    payload: { id: crypto.randomUUID(), name: 'Dibuat support' },
  });
  assert.equal(tulis.statusCode, 403, tulis.body);
  assert.equal(tulis.json().error.code, 'SUPPORT_SESSION_READ_ONLY');

  const rows = await query(`SELECT id FROM category WHERE name = 'Dibuat support'`);
  assert.equal(rows.length, 0, 'tidak ada baris yang tertulis');
});

test('sesi ber-izin tulis dapat menulis', async () => {
  const b = (await beri({ writeEnabled: true })).json();
  assert.equal(b.writeEnabled, true);
  const res = await app.inject({
    method: 'POST',
    url: '/categories',
    headers: { ...hdrSupport(b.token), 'idempotency-key': crypto.randomUUID() },
    payload: { id: crypto.randomUUID(), name: 'Diperbaiki support' },
  });
  assert.equal(res.statusCode, 201, res.body);
});

test('⛔ sesi support TETAP tunduk RBAC — ia meminjam peran owner, bukan melewatinya', async () => {
  // Melewati penjaga peran akan membuat akses support satu-satunya jalan di
  // sistem ini yang tidak tunduk RBAC sama sekali.
  await jadikanPeran('owner');
  const b = (await beri({ writeEnabled: true })).json();

  // Turunkan pemberi menjadi kasir SESUDAH sesi dibuat: token yang sama kini
  // meminjam peran kasir, dan kasir tidak boleh menyunting katalog.
  await jadikanPeran('cashier');
  const res = await app.inject({
    method: 'POST',
    url: '/categories',
    headers: { ...hdrSupport(b.token), 'idempotency-key': crypto.randomUUID() },
    payload: { id: crypto.randomUUID(), name: 'Lewat RBAC?' },
  });
  assert.equal(res.statusCode, 403, res.body);
  assert.equal(res.json().error.code, 'FORBIDDEN');
});

// ---------------------------------------------------------------------------
// AC 4 — PENANDA pada setiap tindakan
// ---------------------------------------------------------------------------

test('⛔ tindakan LEWAT sesi support ditandai support_session_id', async () => {
  // Inti AC keempat, dan bagian yang paling mudah lulus secara hampa: yang
  // diperiksa di sini bukan `support_session_started` melainkan baris audit
  // dari PERUBAHAN KATALOG yang dilakukan lewat token support.
  const b = (await beri({ writeEnabled: true })).json();
  const kategoriId = crypto.randomUUID();
  const res = await app.inject({
    method: 'POST',
    url: '/categories',
    headers: { ...hdrSupport(b.token), 'idempotency-key': crypto.randomUUID() },
    payload: { id: kategoriId, name: 'Kopi' },
  });
  assert.equal(res.statusCode, 201, res.body);

  const itemId = crypto.randomUUID();
  const item = await app.inject({
    method: 'POST',
    url: '/items',
    headers: { ...hdrSupport(b.token), 'idempotency-key': crypto.randomUUID() },
    payload: {
      id: itemId,
      name: 'Kopi Susu',
      categoryId: kategoriId,
      variations: [{ id: crypto.randomUUID(), name: 'Regular', price: 20000 }],
    },
  });
  assert.equal(item.statusCode, 201, item.body);

  const [row] = await query(
    `SELECT support_session_id, actor_user_id, event_type
       FROM audit_event WHERE event_type = 'item_created' AND entity_id = $1`,
    [itemId]
  );
  assert.ok(row, 'item_created tidak dipancarkan');
  assert.equal(row.support_session_id, b.id, 'penanda sesi support hilang');
  // ⛔ Aktor tetap owner yang menyetujui: `actor_user_id` NOT NULL ber-FK ke
  // `"user"`, dan staf kami tidak punya baris di sana. Penanda inilah yang
  // mencegah pembaca menyimpulkan owner sendiri yang melakukannya.
  assert.equal(row.actor_user_id, base.user.id);
});

test('⛔ tindakan yang SAMA tanpa sesi support TIDAK ditandai', async () => {
  // Kontrol negatif. Penanda yang selalu terisi tidak membedakan apa pun, dan
  // test di atas akan hijau untuk kode yang menstempel setiap baris audit.
  const itemId = crypto.randomUUID();
  const res = await app.inject({
    method: 'POST',
    url: '/items',
    headers: { ...hdr(), 'idempotency-key': crypto.randomUUID() },
    payload: {
      id: itemId,
      name: 'Kopi Biasa',
      variations: [{ id: crypto.randomUUID(), name: 'Regular', price: 20000 }],
    },
  });
  assert.equal(res.statusCode, 201, res.body);

  const [row] = await query(
    `SELECT support_session_id FROM audit_event
      WHERE event_type = 'item_created' AND entity_id = $1`,
    [itemId]
  );
  assert.equal(row.support_session_id, null);
});

test('pemberian dan pengakhiran menulis audit — dan keduanya TIDAK ditandai', async () => {
  const b = (await beri({ reasonCode: 'pemulihan_data' })).json();
  const [mulai] = await query(
    `SELECT actor_user_id, entity_type, entity_id, reason_code, after, support_session_id
       FROM audit_event WHERE event_type = 'support_session_started'`
  );
  assert.ok(mulai, 'support_session_started tidak dipancarkan');
  assert.equal(mulai.actor_user_id, base.user.id);
  assert.equal(mulai.entity_type, 'support_session');
  assert.equal(mulai.entity_id, b.id);
  assert.equal(mulai.reason_code, 'pemulihan_data');
  assert.equal(mulai.after.writeEnabled, false);
  // ⛔ Pemberian akses adalah tindakan OWNER, bukan tindakan support — sesi
  // support tidak dapat memperpanjang dirinya sendiri.
  assert.equal(mulai.support_session_id, null);
  // ⛔ Token TIDAK masuk audit. Jejaknya bertahan lima tahun; kredensial di
  // dalamnya akan bertahan lima tahun juga.
  assert.equal(JSON.stringify(mulai.after).includes(b.token), false);

  await app.inject({
    method: 'POST',
    url: `/support-sessions/${b.id}/end`,
    headers: hdr(),
    payload: {},
  });
  const [selesai] = await query(
    `SELECT entity_id, after, support_session_id FROM audit_event
      WHERE event_type = 'support_session_ended'`
  );
  assert.ok(selesai, 'support_session_ended tidak dipancarkan');
  assert.equal(selesai.entity_id, b.id);
  assert.equal(selesai.after.endedEarly, true, 'diakhiri lebih awal harus tercatat sebagai itu');
  assert.equal(selesai.support_session_id, null);
});

// ---------------------------------------------------------------------------
// Isolasi tenant
// ---------------------------------------------------------------------------

test('⛔ token support tenant lain tidak menemukan apa pun di tenant ini', async () => {
  const b = (await beri()).json();
  const lain = await seedTenantBase(db, { suffix: 'SupportLain' });
  const res = await app.inject({
    method: 'GET',
    url: '/items',
    headers: {
      'x-tenant-id': lain.tenant.id,
      authorization: `Bearer ${b.token}`,
      'content-type': 'application/json',
    },
  });
  // Berbohong tentang tenant tidak membeli apa pun: tokennya tidak ditemukan
  // saat dicari di tenant lain. Pola yang sama dengan sesi pengguna.
  assert.equal(res.statusCode, 401, res.body);
});

// ---------------------------------------------------------------------------
// Penanda TERBACA di B-22 — data yang tidak dibaca siapa pun bukan kontrol
// ---------------------------------------------------------------------------

test('⛔ GET /audit-events membawa penanda di SETIAP baris, bukan hanya saat disaring', async () => {
  // Baris yang dilakukan support terlihat SAMA PERSIS dengan baris yang orang
  // merchant lakukan sendiri kalau penandanya tidak dibawa — dan `actorUserId`
  // pada baris support adalah owner yang menyetujui. Layar audit dibaca saat
  // sengketa; kesalahan atribusi di sana menyangkut orang.
  const b = (await beri({ writeEnabled: true, adminLabel: 'Rina (support Lumi)' })).json();
  const lewatSupport = crypto.randomUUID();
  await app.inject({
    method: 'POST',
    url: '/items',
    headers: { ...hdrSupport(b.token), 'idempotency-key': crypto.randomUUID() },
    payload: {
      id: lewatSupport,
      name: 'Dibuat support',
      variations: [{ id: crypto.randomUUID(), name: 'Regular', price: 20000 }],
    },
  });
  const langsung = crypto.randomUUID();
  await app.inject({
    method: 'POST',
    url: '/items',
    headers: { ...hdr(), 'idempotency-key': crypto.randomUUID() },
    payload: {
      id: langsung,
      name: 'Dibuat owner',
      variations: [{ id: crypto.randomUUID(), name: 'Regular', price: 20000 }],
    },
  });

  const hari = new Date().toISOString().slice(0, 10);
  const res = await app.inject({
    method: 'GET',
    url: `/audit-events?from=${hari}&to=${hari}&event_type=item_created`,
    headers: hdr(),
  });
  assert.equal(res.statusCode, 200, res.body);
  const peristiwa = res.json().peristiwa;

  const support = peristiwa.find((p) => p.entityId === lewatSupport);
  assert.ok(support, 'baris support tidak ditemukan');
  assert.equal(support.supportSessionId, b.id);
  assert.equal(support.supportAdmin, 'Rina (support Lumi)', 'nama petugas harus terbaca');

  const sendiri = peristiwa.find((p) => p.entityId === langsung);
  assert.ok(sendiri, 'baris langsung tidak ditemukan');
  // ⛔ Kontrol negatif: penanda yang selalu terisi tidak membedakan apa pun.
  assert.equal(sendiri.supportSessionId, null);
  assert.equal(sendiri.supportAdmin, null);
  // Keduanya berpelaku SAMA — itu justru kenapa penandanya harus ada.
  assert.equal(support.aktorId, sendiri.aktorId);
});

test('⛔ support_only=true menyaring; nilai lain TIDAK menyaring apa pun', async () => {
  const b = (await beri({ writeEnabled: true })).json();
  await app.inject({
    method: 'POST',
    url: '/items',
    headers: { ...hdrSupport(b.token), 'idempotency-key': crypto.randomUUID() },
    payload: {
      id: crypto.randomUUID(),
      name: 'Lewat support',
      variations: [{ id: crypto.randomUUID(), name: 'Regular', price: 20000 }],
    },
  });
  await app.inject({
    method: 'POST',
    url: '/items',
    headers: { ...hdr(), 'idempotency-key': crypto.randomUUID() },
    payload: {
      id: crypto.randomUUID(),
      name: 'Langsung',
      variations: [{ id: crypto.randomUUID(), name: 'Regular', price: 20000 }],
    },
  });

  const hari = new Date().toISOString().slice(0, 10);
  const ambil = async (tambahan) =>
    (
      await app.inject({
        method: 'GET',
        url: `/audit-events?from=${hari}&to=${hari}&event_type=item_created${tambahan}`,
        headers: hdr(),
      })
    ).json();

  const semua = await ambil('');
  assert.equal(semua.peristiwa.length, 2);
  assert.equal(semua.hanyaSupport, false, 'saringan yang aktif ikut di respons');

  const disaring = await ambil('&support_only=true');
  assert.equal(disaring.peristiwa.length, 1);
  assert.equal(disaring.hanyaSupport, true);
  assert.ok(disaring.peristiwa.every((p) => p.supportSessionId !== null));

  // ⛔ Nilai selain `true` DITOLAK 400 oleh enum kontrak, tidak diterima lalu
  // ditafsirkan.
  //
  // Versi pertama test ini membungkus assertion-nya dalam
  // `if (res.statusCode === 200)` — dan karena enum menolak KETIGA nilainya,
  // assertion-nya tidak pernah berjalan sama sekali. Ia hijau untuk kode yang
  // menyaring pada nilai apa pun; dibuktikan lewat sabotase
  // (`q.support_only !== undefined`), yang lolos tanpa satu test merah.
  //
  // Bentuk hampa yang sama dengan 18 test `stock_movement` yang F3 temukan.
  for (const nilai of ['', 'false', '1', 'TRUE']) {
    const res = await app.inject({
      method: 'GET',
      url: `/audit-events?from=${hari}&to=${hari}&event_type=item_created&support_only=${nilai}`,
      headers: hdr(),
    });
    assert.equal(res.statusCode, 400, `support_only=${nilai} seharusnya ditolak: ${res.body}`);
  }

  // ⛔ TIDAK ADA nilai yang MENYEMBUNYIKAN tindakan support. Diuji sebagai
  // bentuk: enum kontraknya berisi tepat satu nilai, dan yang menyaring hanya
  // ke arah "tampilkan yang bertanda".
  const kontrak = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../../packages/contracts/openapi.yaml'),
    'utf8'
  );
  assert.match(
    kontrak,
    /name: support_only[\s\S]{0,1600}?schema: \{ type: string, enum: \["true"\] \}/,
    'enum support_only berubah — periksa bahwa tidak ada nilai yang menyembunyikan audit'
  );
});
