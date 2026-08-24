'use strict';

// FR-F1 — mengubah peran pengguna yang sudah ada. `spec-f:27-53`.
//
// ⛔ Kenapa berkas ini lahir 24 Agustus 2026: `createUser` menerima `roles`,
// `updateUser` TIDAK. Merchant yang menaikkan kasirnya menjadi manajer outlet
// karena itu tidak punya jalan apa pun — kecuali membuat pengguna KEDUA dengan
// nama orang yang sama, yang membuat setiap laporan per kasir memecah orang itu
// menjadi dua baris dan riwayat lamanya menggantung pada akun yang
// dinonaktifkan.
//
// Yang paling menentukan di sini adalah dua penjaga yang HANYA ada di jalur
// ubah, dan yang keduanya tidak terlihat sebagai kelalaian sampai ditulis:
//
// 1. Peran LAMA target ikut diperiksa. `createUser` tidak perlu — pengguna yang
//    belum ada belum berperan apa pun. Di sini, mengabaikannya membiarkan
//    Manajer Outlet menurunkan seorang Owner menjadi kasir, lalu mengelolanya
//    dengan bebas.
// 2. Owner terakhir tidak dapat DICABUT PERANNYA, bukan hanya tidak dapat
//    dinonaktifkan. Keduanya meninggalkan tenant dalam keadaan yang persis
//    sama; penjaga yang menutup satu dari dua jalan bukan penjaga.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase, freshId } = require('../isolation/helpers/seed');

let owner, appSetup, app, tenant, outlet, outlet2, aktor, base;

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
  base = await seedTenantBase(appSetup, { suffix: 'UbahPeran' });
  tenant = base.tenant;
  outlet = base.outlet;
  aktor = base.user;

  // ⛔ Peran aktor DIGANTI menjadi `area_manager` saja — peran fixture-nya
  // (kasir DAN owner, `seed.js:122`) DIHAPUS lebih dulu.
  //
  // Bukan kerapian: aktor yang tetap berperan owner membuat setiap tenant di
  // berkas ini punya owner tersembunyi, dan test "owner terakhir" hijau karena
  // alasan yang salah — ia tidak pernah benar-benar sampai ke owner terakhir.
  // Ditemukan justru karena test itu MERAH; versi pertama berkas ini hanya
  // menambahkan `area_manager` tanpa menghapus apa pun.
  //
  // `area_manager` cukup untuk mengelola peran apa pun (`bolehKelolaPengguna`)
  // tanpa ikut terhitung sebagai owner.
  outlet2 = freshId();
  await kueriTenant('DELETE FROM user_role WHERE user_id = $1', [aktor.id]);
  await kueriTenant(
    `INSERT INTO user_role (id, tenant_id, user_id, role, scope_type, scope_id)
     VALUES ($1, $2, $3, 'area_manager', 'tenant', $2)`,
    [freshId(), tenant.id, aktor.id]
  );
  await kueriTenant(
    `INSERT INTO outlet (id, tenant_id, name, timezone) VALUES ($1, $2, 'Cabang Dua', 'Asia/Jakarta')`,
    [outlet2, tenant.id]
  );

  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();
});

function hdr(extra = {}) {
  return {
    'x-tenant-id': tenant.id,
    authorization: base.authHeader,
    'x-actor-id': aktor.id,
    ...extra,
  };
}

async function kueriTenant(sql, params) {
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  const hasil = await appSetup.query(sql, params);
  await appSetup.query('COMMIT');
  return hasil;
}

async function buatUser({ roles, outletIds = [outlet.id], nama = 'Sari' } = {}) {
  const id = freshId();
  const res = await app.inject({
    method: 'POST',
    url: '/users',
    payload: {
      id,
      name: nama,
      roles: roles ?? [{ role: 'cashier', scopeType: 'outlet', scopeId: outlet.id }],
      outletIds,
    },
    headers: hdr(),
  });
  assert.equal(res.statusCode, 201, res.body);
  return id;
}

function ubah(userId, payload, extra = {}) {
  return app.inject({
    method: 'PATCH',
    url: `/users/${userId}`,
    payload,
    headers: hdr(extra),
  });
}

async function peranDb(userId) {
  const { rows } = await kueriTenant(
    'SELECT role FROM user_role WHERE user_id = $1 ORDER BY role',
    [userId]
  );
  return rows.map((r) => r.role);
}

// ---------------------------------------------------------------------------
// Jalur bahagia
// ---------------------------------------------------------------------------

test('kasir dinaikkan menjadi manajer outlet', async () => {
  const id = await buatUser();
  const res = await ubah(id, {
    roles: [{ role: 'outlet_manager', scopeType: 'outlet', scopeId: outlet.id }],
  });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(
    res.json().roles.map((r) => r.role),
    ['outlet_manager']
  );
  assert.deepEqual(await peranDb(id), ['outlet_manager']);
});

test('⛔ peran DIGANTI seluruhnya, bukan ditambahkan', async () => {
  // Peran adalah himpunan; PATCH yang menambahkan tanpa dapat menghapus
  // membuat PENURUNAN peran mustahil — dan penurunan peran adalah separuh
  // alasan endpoint ini ada.
  const id = await buatUser({
    roles: [
      { role: 'cashier', scopeType: 'outlet', scopeId: outlet.id },
      { role: 'outlet_manager', scopeType: 'outlet', scopeId: outlet.id },
    ],
  });
  assert.deepEqual(await peranDb(id), ['cashier', 'outlet_manager']);

  const res = await ubah(id, {
    roles: [{ role: 'cashier', scopeType: 'outlet', scopeId: outlet.id }],
  });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(await peranDb(id), ['cashier']);
});

test('tanpa `roles`, peran tidak berubah', async () => {
  const id = await buatUser();
  const res = await ubah(id, { name: 'Sari Dewi' });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().name, 'Sari Dewi');
  assert.deepEqual(await peranDb(id), ['cashier']);
});

test('outlet dapat diganti bersamaan dengan peran', async () => {
  const id = await buatUser();
  const res = await ubah(id, {
    roles: [{ role: 'area_manager', scopeType: 'tenant', scopeId: tenant.id }],
    outletIds: [outlet.id, outlet2],
  });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual([...res.json().outletIds].sort(), [outlet.id, outlet2].sort());
});

// ---------------------------------------------------------------------------
// ⛔ Cakupan
// ---------------------------------------------------------------------------

test('⛔ cakupan diperiksa terhadap gabungan yang AKAN berlaku', async () => {
  // Mengubah peran SAJA menjadi Kasir, sementara pengguna sudah terdaftar di
  // dua outlet, menghasilkan tepat keadaan yang `spec-f:32` larang — dan tidak
  // ada apa pun di permintaan itu yang terlihat salah. Penjaga yang hanya
  // melihat apa yang dikirim tidak akan pernah menyalakannya.
  const id = await buatUser({
    roles: [{ role: 'area_manager', scopeType: 'tenant', scopeId: tenant.id }],
    outletIds: [outlet.id, outlet2],
  });

  const res = await ubah(id, {
    roles: [{ role: 'cashier', scopeType: 'outlet', scopeId: outlet.id }],
  });
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(res.json().error.code, 'ROLE_SCOPE_TOO_WIDE');
  // Dan tidak ada yang tersimpan setengah jalan.
  assert.deepEqual(await peranDb(id), ['area_manager']);
});

test('menyempitkan outlet bersamaan dengan peran diterima', async () => {
  const id = await buatUser({
    roles: [{ role: 'area_manager', scopeType: 'tenant', scopeId: tenant.id }],
    outletIds: [outlet.id, outlet2],
  });
  const res = await ubah(id, {
    roles: [{ role: 'cashier', scopeType: 'outlet', scopeId: outlet.id }],
    outletIds: [outlet.id],
  });
  assert.equal(res.statusCode, 200, res.body);
});

// ---------------------------------------------------------------------------
// ⛔ Penjaga yang hanya ada di jalur ubah
// ---------------------------------------------------------------------------

test('⛔ peran LAMA target ikut diperiksa — manajer outlet tidak dapat menurunkan owner', async () => {
  // `createUser` hanya perlu memeriksa peran BARU. Di sini, mengabaikan peran
  // lama membiarkan Manajer Outlet — yang matriks izinkan mengelola "kasir
  // saja" — menurunkan seorang Owner menjadi kasir, lalu mengelolanya dengan
  // bebas. Pemisahan tugas `spec-f:91` runtuh tanpa satu pun aturan terlihat
  // dilanggar.
  const targetOwner = await buatUser({
    nama: 'Pemilik',
    roles: [{ role: 'owner', scopeType: 'tenant', scopeId: tenant.id }],
  });

  // Aktor diturunkan menjadi manajer outlet murni.
  await kueriTenant('DELETE FROM user_role WHERE user_id = $1', [aktor.id]);
  await kueriTenant(
    `INSERT INTO user_role (id, tenant_id, user_id, role, scope_type, scope_id)
     VALUES ($1, $2, $3, 'outlet_manager', 'outlet', $4)`,
    [freshId(), tenant.id, aktor.id, outlet.id]
  );

  const res = await ubah(targetOwner, {
    roles: [{ role: 'cashier', scopeType: 'outlet', scopeId: outlet.id }],
  });
  assert.equal(res.statusCode, 403, res.body);
  assert.equal(res.json().error.code, 'FORBIDDEN_ROLE_MANAGEMENT');
  assert.deepEqual(await peranDb(targetOwner), ['owner']);
});

test('manajer outlet TETAP dapat mengelola kasir', async () => {
  // Penjaga di atas tidak boleh menutup yang matriks memang izinkan.
  const kasir = await buatUser();
  await kueriTenant('DELETE FROM user_role WHERE user_id = $1', [aktor.id]);
  await kueriTenant(
    `INSERT INTO user_role (id, tenant_id, user_id, role, scope_type, scope_id)
     VALUES ($1, $2, $3, 'outlet_manager', 'outlet', $4)`,
    [freshId(), tenant.id, aktor.id, outlet.id]
  );

  const res = await ubah(kasir, {
    roles: [{ role: 'cashier', scopeType: 'outlet', scopeId: outlet.id }],
  });
  assert.equal(res.statusCode, 200, res.body);
});

test('⛔ peran owner TERAKHIR tidak dapat dicabut', async () => {
  // `spec-f:425` menulis aturannya untuk penonaktifan, dan `updateUser` sudah
  // menegakkannya di sana. Mencabut peran `owner` meninggalkan tenant dalam
  // keadaan yang PERSIS sama — tidak ada seorang pun yang dapat mengurus
  // billing — tanpa satu pun pengguna dinonaktifkan.
  const satuSatunya = await buatUser({
    nama: 'Pemilik',
    roles: [{ role: 'owner', scopeType: 'tenant', scopeId: tenant.id }],
  });

  const res = await ubah(satuSatunya, {
    roles: [{ role: 'cashier', scopeType: 'outlet', scopeId: outlet.id }],
  });
  assert.equal(res.statusCode, 409, res.body);
  assert.equal(res.json().error.code, 'LAST_OWNER');
  assert.deepEqual(await peranDb(satuSatunya), ['owner']);
});

test('owner dapat dicabut perannya bila ada owner AKTIF lain', async () => {
  await buatUser({
    nama: 'Pemilik Satu',
    roles: [{ role: 'owner', scopeType: 'tenant', scopeId: tenant.id }],
  });
  const dua = await buatUser({
    nama: 'Pemilik Dua',
    roles: [{ role: 'owner', scopeType: 'tenant', scopeId: tenant.id }],
  });

  const res = await ubah(dua, {
    roles: [{ role: 'cashier', scopeType: 'outlet', scopeId: outlet.id }],
  });
  assert.equal(res.statusCode, 200, res.body);
});

test('⛔ owner yang NONAKTIF tidak dihitung sebagai owner tersisa', async () => {
  // Owner yang dinonaktifkan tidak dapat mengurus billing. Menghitungnya
  // membuat penjaganya meloloskan tepat keadaan yang ia ada untuk menutup.
  const satu = await buatUser({
    nama: 'Pemilik Satu',
    roles: [{ role: 'owner', scopeType: 'tenant', scopeId: tenant.id }],
  });
  const dua = await buatUser({
    nama: 'Pemilik Dua',
    roles: [{ role: 'owner', scopeType: 'tenant', scopeId: tenant.id }],
  });
  assert.equal((await ubah(satu, { isActive: false })).statusCode, 200);

  const res = await ubah(dua, {
    roles: [{ role: 'cashier', scopeType: 'outlet', scopeId: outlet.id }],
  });
  assert.equal(res.statusCode, 409, res.body);
  assert.equal(res.json().error.code, 'LAST_OWNER');
});

test('outlet milik tenant lain ditolak — FK tidak tunduk RLS', async () => {
  // Temuan F1 (`CLAUDE.md`), bentuk yang sama: FK PostgreSQL hanya membuktikan
  // outlet itu ada di SUATU tenant.
  const lain = await seedTenantBase(appSetup, { suffix: 'UbahPeranLain' });
  const id = await buatUser();
  const res = await ubah(id, { outletIds: [lain.outlet.id] });
  assert.equal(res.statusCode, 404, res.body);
});

// ---------------------------------------------------------------------------
// ⛔ Audit
// ---------------------------------------------------------------------------

test('⛔ user_role_changed mencatat peran LAMA dan BARU', async () => {
  // `user_role` DIHAPUS lalu ditulis ulang, jadi baris audit ini adalah
  // satu-satunya riwayat peran yang ada. "Siapa berperan apa pada bulan Maret"
  // hanya dapat dijawab dari sini — dan itu tepat pertanyaan yang muncul saat
  // seseorang mempersoalkan sebuah persetujuan.
  const id = await buatUser();
  assert.equal(
    (
      await ubah(id, {
        roles: [{ role: 'outlet_manager', scopeType: 'outlet', scopeId: outlet.id }],
      })
    ).statusCode,
    200
  );

  const { rows } = await kueriTenant(
    `SELECT actor_user_id, entity_id, before, after, hlc::text AS hlc
       FROM audit_event WHERE event_type = 'user_role_changed'`,
    []
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].entity_id, id);
  assert.equal(rows[0].actor_user_id, aktor.id);
  assert.deepEqual(
    rows[0].before.roles.map((r) => r.role),
    ['cashier']
  );
  assert.deepEqual(
    rows[0].after.roles.map((r) => r.role),
    ['outlet_manager']
  );
  // Perubahan back-office tidak punya perangkat dan tidak mengklaim posisi
  // dalam urutan kausal.
  assert.equal(rows[0].hlc, '0');
});

test('⛔ perubahan yang DITOLAK tidak meninggalkan baris audit', async () => {
  // Audit yang ditulis di luar transaksi bertahan saat operasinya di-rollback,
  // dan trail yang memuat perubahan yang tidak pernah terjadi lebih buruk
  // daripada trail berlubang.
  const satuSatunya = await buatUser({
    nama: 'Pemilik',
    roles: [{ role: 'owner', scopeType: 'tenant', scopeId: tenant.id }],
  });
  assert.equal(
    (
      await ubah(satuSatunya, {
        roles: [{ role: 'cashier', scopeType: 'outlet', scopeId: outlet.id }],
      })
    ).statusCode,
    409
  );

  const { rows } = await kueriTenant(
    `SELECT id FROM audit_event WHERE event_type = 'user_role_changed'`,
    []
  );
  assert.deepEqual(rows, []);
});
