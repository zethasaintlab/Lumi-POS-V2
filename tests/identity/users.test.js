'use strict';

// §4 (docs/superpowers/plans/PLAN-modul-f-identitas.md) -- REST identitas.
//
// FR-F2 (PIN), FR-F4 (rate limiting), FR-F6 (audit), `spec-f:425` (owner
// terakhir), `spec-f:420` (reset PIN oleh manajer).
//
// ⛔ Yang paling penting di berkas ini: PIN unik per outlet TIDAK dapat
// ditegakkan database (lihat migrasi 0019). Test "PIN duplikat dalam satu
// outlet ditolak" karena itu menguji aplikasi, dan tanpa test itu tidak ada
// apa pun yang menjaganya.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase, freshId } = require('../isolation/helpers/seed');

let owner, appSetup, app, tenant, outlet, aktor, base;

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
  base = await seedTenantBase(appSetup, { suffix: 'UserTest' });
  tenant = base.tenant;
  outlet = base.outlet;
  aktor = base.user;

  // `seedTenantBase` memberi user-nya peran `cashier`, dan kasir memang TIDAK
  // boleh mengelola pengguna (`spec-f:50`). Aktor di berkas ini dinaikkan jadi
  // `area_manager` supaya yang diuji adalah endpoint-nya, bukan penolakan
  // RBAC-nya.
  //
  // ⛔ `area_manager`, BUKAN `owner`, dan itu bukan pilihan sembarang: aktor
  // ber-peran owner akan membuat setiap tenant di berkas ini punya owner
  // tersembunyi, dan test "owner terakhir" akan hijau karena alasan yang
  // salah -- ia tidak akan pernah benar-benar sampai ke owner terakhir.
  // Ditemukan justru karena test itu merah.
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await appSetup.query(
    `INSERT INTO user_role (id, tenant_id, user_id, role, scope_type, scope_id)
     VALUES ($1, $2, $3, 'area_manager', 'tenant', $2)`,
    [freshId(), tenant.id, aktor.id]
  );
  await appSetup.query('COMMIT');

  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();
});

function hdr(extra = {}) {
  return { 'x-tenant-id': tenant.id, authorization: base.authHeader, 'x-actor-id': aktor.id, ...extra };
}

async function kueriTenant(sql, params, tenantId = tenant.id) {
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
  const hasil = await appSetup.query(sql, params);
  await appSetup.query('COMMIT');
  return hasil;
}

async function buatUser(over = {}) {
  return app.inject({
    method: 'POST',
    url: '/users',
    payload: {
      id: freshId(),
      name: 'Sari',
      roles: [{ role: 'cashier', scopeType: 'outlet', scopeId: outlet.id }],
      outletIds: [outlet.id],
      ...over,
    },
    headers: hdr(),
  });
}

async function setPin(userId, pin, extra = {}) {
  return app.inject({
    method: 'PUT',
    url: `/users/${userId}/pin`,
    payload: { pin, ...extra },
    headers: hdr(),
  });
}

// ---------------------------------------------------------------------------

test('POST /users: membuat pengguna, peran, dan keanggotaan outlet dalam satu transaksi', async () => {
  const res = await buatUser();
  assert.equal(res.statusCode, 201, res.body);
  const body = res.json();
  assert.equal(body.name, 'Sari');
  assert.deepEqual(body.roles.map((r) => r.role), ['cashier']);
  assert.deepEqual(body.outletIds, [outlet.id]);

  // Invariant #1 berlaku juga di sini: pengguna tanpa peran dan tanpa outlet
  // adalah pengguna yang tidak dapat melakukan apa pun dan tidak terlihat
  // perangkat mana pun. Kalau ketiganya tidak satu transaksi, kegagalan di
  // tengah menghasilkan tepat keadaan itu.
  const { rows } = await kueriTenant(
    `SELECT (SELECT count(*) FROM user_role WHERE user_id = $1) AS peran,
            (SELECT count(*) FROM user_outlet WHERE user_id = $1) AS outlet`,
    [body.id]
  );
  assert.equal(Number(rows[0].peran), 1);
  assert.equal(Number(rows[0].outlet), 1);
});

test('POST /users: outlet milik tenant lain ditolak (FK tidak tunduk RLS)', async () => {
  // Temuan F1, bentuk keenam. Setiap FK klien-suplai baru dianggap terpapar
  // sampai dibuktikan sebaliknya -- `user_outlet.outlet_id` adalah salah satu.
  const lain = await seedTenantBase(appSetup, { suffix: 'UserTestLain' });
  const res = await buatUser({ outletIds: [lain.outlet.id] });
  assert.equal(res.statusCode, 404, res.body);
  assert.equal(res.json().error.code, 'OUTLET_NOT_FOUND');
});

test('PUT /pin: PIN lemah ditolak, dan pesannya menyebut POLA MANA (spec-f:144)', async () => {
  const u = (await buatUser()).json();

  const berulang = await setPin(u.id, '000000');
  assert.equal(berulang.statusCode, 400);
  assert.equal(berulang.json().error.code, 'PIN_TOO_WEAK');
  assert.match(berulang.json().error.message, /berulang/i);

  const urutan = await setPin(u.id, '123456');
  assert.match(urutan.json().error.message, /urutan/i);

  // Pesan yang seragam untuk kelima pola akan membuat kedua assertion di atas
  // hijau kalau salah satunya dihapus. Keduanya harus BERBEDA.
  assert.notEqual(berulang.json().error.message, urutan.json().error.message);
});

test('PUT /pin: 4 dan 5 digit ditolak (spec-f:143)', async () => {
  const u = (await buatUser()).json();
  for (const pin of ['4829', '48291', '4829134', '48291a']) {
    const res = await setPin(u.id, pin);
    assert.equal(res.statusCode, 400, `${pin} seharusnya ditolak`);
  }
});

test('PUT /pin: tersimpan sebagai Argon2id PHC, tidak pernah plaintext', async () => {
  const u = (await buatUser()).json();
  assert.equal((await setPin(u.id, '482913')).statusCode, 204);

  const { rows } = await kueriTenant('SELECT pin_hash, pin_algo FROM "user" WHERE id = $1', [u.id]);
  assert.match(rows[0].pin_hash, /^\$argon2id\$v=19\$m=\d+,t=\d+,p=\d+\$/);
  assert.equal(rows[0].pin_algo, 'argon2id');
  assert.equal(rows[0].pin_hash.includes('482913'), false, 'PIN tidak boleh muncul di kolom hash');
});

test('⛔ PUT /pin: PIN duplikat dalam SATU outlet ditolak; antar outlet DIIZINKAN', async () => {
  // `spec-f:126`: "PIN unik dalam satu outlet -- dua kasir dengan PIN sama
  // membuat atribusi ambigu." dan `spec-f:127`: "PIN boleh sama antar outlet
  // berbeda."
  //
  // Ini SATU-SATUNYA yang menjaga aturan itu. `UNIQUE(outlet_id, pin_hash)`
  // di ERD:143 mustahil ditegakkan -- salt per pengguna membuat dua PIN
  // identik menghasilkan hash berbeda, jadi index unik akan hijau selamanya
  // sambil membiarkan tepat keadaan yang dilarang.
  const sari = (await buatUser({ name: 'Sari' })).json();
  const budi = (await buatUser({ name: 'Budi' })).json();

  assert.equal((await setPin(sari.id, '482913')).statusCode, 204);

  const bentrok = await setPin(budi.id, '482913');
  assert.equal(bentrok.statusCode, 409, bentrok.body);
  assert.equal(bentrok.json().error.code, 'PIN_TAKEN');
  // Pesan TIDAK boleh menyebut siapa pemakai PIN itu -- menyebutnya berarti
  // memberi tahu Budi PIN siapa yang baru saja ia tebak.
  assert.equal(/sari/i.test(bentrok.json().error.message), false);

  // PIN yang sama di outlet BERBEDA harus lolos.
  const outletDua = await kueriTenant(
    `INSERT INTO outlet (id, tenant_id, name, address, timezone, business_day_ends_at,
                         rounding_increment, rounding_mode, service_charge_rate, vertical_profile_id)
     SELECT $1, $2, 'Cabang Dua', 'Jl. Contoh No. 2', timezone, business_day_ends_at,
            rounding_increment, rounding_mode, service_charge_rate, vertical_profile_id
       FROM outlet WHERE id = $3
     RETURNING id`,
    [freshId(), tenant.id, outlet.id]
  );
  const rina = (await buatUser({ name: 'Rina', outletIds: [outletDua.rows[0].id] })).json();
  assert.equal((await setPin(rina.id, '482913')).statusCode, 204, 'PIN sama di outlet lain harus boleh');
});

test('PUT /pin oleh manajer: menyalakan pin_must_change (spec-f:420)', async () => {
  const u = (await buatUser()).json();
  const res = await app.inject({
    method: 'PUT',
    url: `/users/${u.id}/pin`,
    payload: { pin: '739154', isReset: true },
    headers: hdr(),
  });
  assert.equal(res.statusCode, 204);

  const { rows } = await kueriTenant('SELECT pin_must_change FROM "user" WHERE id = $1', [u.id]);
  assert.equal(rows[0].pin_must_change, true);
});

test('PUT /pin: audit event pin_changed ditulis dalam transaksi yang sama (FR-F6)', async () => {
  const u = (await buatUser()).json();
  await setPin(u.id, '482913');

  const { rows } = await kueriTenant(
    `SELECT event_type, entity_id, before, after FROM audit_event
      WHERE event_type = 'pin_changed' AND entity_id = $1`,
    [u.id]
  );
  assert.equal(rows.length, 1);
  // ⛔ `before`/`after` TIDAK boleh memuat PIN maupun hash-nya. Audit event
  // direplikasi dan diekspor; hash PIN di dalamnya adalah kebocoran yang
  // bertahan lima tahun (retensi `spec-f:372`).
  const teks = JSON.stringify(rows[0]);
  assert.equal(teks.includes('482913'), false);
  assert.equal(teks.includes('argon2'), false);
});

test('PIN plaintext tidak pernah muncul di log (spec-f:443)', async () => {
  const potongan = [];
  const stream = { write: (s) => potongan.push(s) };
  const { buildApp } = await import('../../apps/server/src/app.ts');
  await app.close();
  app = await buildApp({ logger: { level: 'trace', stream } });

  const dibuat = await buatUser();
  assert.equal(dibuat.statusCode, 201, 'prasyarat');
  const u = dibuat.json();

  // ⛔ Kedua status DIPERIKSA. Tanpa ini test lolos secara semu: request yang
  // dijawab 404 tidak pernah menyentuh PIN sama sekali, jadi "PIN tidak
  // muncul di log" benar karena tidak ada yang pernah diproses. Terbukti --
  // versi pertama test ini hijau sebelum satu baris handler ditulis.
  assert.equal((await setPin(u.id, '905172')).statusCode, 204, 'prasyarat: PIN benar-benar diproses');
  // Juga pada jalur GAGAL -- di sana payload sering ikut tercatat.
  assert.equal((await setPin(u.id, '111111')).statusCode, 400, 'prasyarat: jalur gagal benar-benar dijalankan');

  const semua = potongan.join('');
  assert.ok(semua.length > 0, 'log harus benar-benar terisi, kalau tidak test ini tidak membuktikan apa pun');
  assert.equal(semua.includes('905172'), false, 'PIN muncul di log');
  assert.equal(semua.includes('111111'), false, 'PIN gagal muncul di log');
});

test('PATCH /users: owner terakhir tidak dapat dinonaktifkan (spec-f:425)', async () => {
  // ⛔ Premisnya dibangun eksplisit, tidak diwarisi fixture.
  //
  // Versi lama mengandalkan `base.user` berperan KASIR, sehingga owner yang
  // dibuat di sini otomatis menjadi satu-satunya. Sejak fixture memberi
  // `base.user` peran owner juga (pemilik kafe kecil berdiri di kasir
  // sendiri, dan tanpa itu setiap test administratif gagal 403), premis itu
  // diam-diam batal — test ini LULUS-lalu-GAGAL karena alasan yang tidak ada
  // hubungannya dengan aturan yang dijaganya.
  //
  // Yang diuji sekarang adalah aturannya utuh, dalam urutan yang membuktikan
  // keduanya: dengan DUA owner, penonaktifan berhasil; owner TERAKHIR
  // ditolak. Test lama hanya membuktikan yang kedua.
  const pemilik = (await buatUser({
    name: 'Owner Kedua',
    roles: [{ role: 'owner', scopeType: 'tenant', scopeId: tenant.id }],
  })).json();

  // Dua owner (fixture + yang barusan): penonaktifan HARUS berhasil. Kalau
  // tidak, aturannya bukan "minimal satu owner" melainkan "owner tidak dapat
  // dinonaktifkan".
  const duaOwner = await app.inject({
    method: 'PATCH',
    url: `/users/${pemilik.id}`,
    payload: { isActive: false },
    headers: hdr(),
  });
  assert.equal(duaOwner.statusCode, 200, duaOwner.body);

  // Kini fixture adalah owner AKTIF terakhir — dan ia tidak dapat
  // menonaktifkan dirinya sendiri.
  const res = await app.inject({
    method: 'PATCH',
    url: `/users/${base.user.id}`,
    payload: { isActive: false },
    headers: hdr(),
  });
  assert.equal(res.statusCode, 409, res.body);
  assert.equal(res.json().error.code, 'LAST_OWNER');

});

test('POST /pin-attempts: 5 gagal mengunci 60 detik (FR-F4)', async () => {
  const u = (await buatUser()).json();
  await setPin(u.id, '482913');

  let res;
  for (let i = 0; i < 5; i += 1) {
    res = await app.inject({
      method: 'POST',
      url: `/users/${u.id}/pin-attempts`,
      payload: { outcome: 'failed' },
      headers: hdr(),
    });
    assert.equal(res.statusCode, 200, res.body);
  }
  assert.equal(res.json().lockedUntil !== null, true, 'gagal kelima harus mengunci');
  assert.equal(res.json().lockSeconds, 60);

  const { rows } = await kueriTenant(
    'SELECT pin_failed_attempts, pin_locked_until FROM "user" WHERE id = $1',
    [u.id]
  );
  assert.equal(rows[0].pin_failed_attempts, 5);
  assert.notEqual(rows[0].pin_locked_until, null, 'penguncian WAJIB persisten -- spec-f:226');
});

test('POST /pin-attempts: penguncian ketiga dalam satu jam naik jadi 15 menit (spec-f:229)', async () => {
  const u = (await buatUser()).json();
  await setPin(u.id, '482913');

  let terakhir;
  for (let putaran = 0; putaran < 3; putaran += 1) {
    for (let i = 0; i < 5; i += 1) {
      terakhir = await app.inject({
        method: 'POST',
        url: `/users/${u.id}/pin-attempts`,
        payload: { outcome: 'failed' },
        headers: hdr(),
      });
    }
    // Penguncian dibersihkan supaya putaran berikutnya dapat berjalan; yang
    // diuji adalah INGATAN lintas penguncian, bukan penguncian tunggal.
    await kueriTenant(`UPDATE "user" SET pin_locked_until = NULL, pin_failed_attempts = 0 WHERE id = $1`, [u.id]);
  }
  assert.equal(terakhir.json().lockSeconds, 900, 'penguncian ketiga = 15 menit');
});

test('POST /pin-attempts: sukses mereset hitungan, dan penguncian PER PENGGUNA', async () => {
  const sari = (await buatUser({ name: 'Sari' })).json();
  const budi = (await buatUser({ name: 'Budi' })).json();
  await setPin(sari.id, '482913');
  await setPin(budi.id, '739154');

  for (let i = 0; i < 5; i += 1) {
    await app.inject({
      method: 'POST',
      url: `/users/${sari.id}/pin-attempts`,
      payload: { outcome: 'failed' },
      headers: hdr(),
    });
  }

  // `spec-f:236`: "Penguncian tidak menghalangi kasir lain yang PIN-nya benar
  // -- penguncian per pengguna, bukan per perangkat."
  const { rows } = await kueriTenant('SELECT pin_locked_until FROM "user" WHERE id = $1', [budi.id]);
  assert.equal(rows[0].pin_locked_until, null, 'Budi tidak boleh ikut terkunci');

  const sukses = await app.inject({
    method: 'POST',
    url: `/users/${budi.id}/pin-attempts`,
    payload: { outcome: 'succeeded' },
    headers: hdr(),
  });
  assert.equal(sukses.statusCode, 200);
  const setelah = await kueriTenant('SELECT pin_failed_attempts FROM "user" WHERE id = $1', [budi.id]);
  assert.equal(setelah.rows[0].pin_failed_attempts, 0);
});

test('POST /pin-attempts: audit pin_failed dan pin_lockout tercatat (FR-F6)', async () => {
  const u = (await buatUser()).json();
  await setPin(u.id, '482913');
  for (let i = 0; i < 5; i += 1) {
    await app.inject({
      method: 'POST',
      url: `/users/${u.id}/pin-attempts`,
      payload: { outcome: 'failed' },
      headers: hdr(),
    });
  }

  const { rows } = await kueriTenant(
    `SELECT event_type, count(*)::int AS n FROM audit_event
      WHERE entity_id = $1 GROUP BY event_type`,
    [u.id]
  );
  const per = Object.fromEntries(rows.map((r) => [r.event_type, r.n]));
  assert.equal(per.pin_failed, 5, 'setiap percobaan gagal tercatat -- spec-f:235');
  assert.equal(per.pin_lockout, 1);
});

// ---------------------------------------------------------------------------
// ⛔ Cakupan "Satu outlet" — `spec-f:31` dan `spec-f:32`
// ---------------------------------------------------------------------------
//
// B-27 sudah menolaknya di layar, dan itu TIDAK CUKUP. Penjaga yang hanya
// hidup di klien adalah penjaga yang hilang begitu ada yang memanggil API
// langsung — dan permukaan ini dipakai Manajer Outlet, bukan hanya owner.
//
// Yang dijaga bukan formalitas: Kasir yang terdaftar di dua outlet muncul di
// layar login KEDUA tablet, dan penjualannya dapat dinisbatkan ke outlet yang
// tidak pernah ia tempati. Manajer Outlet yang bercakupan dua outlet
// menyetujui refund di outlet yang bukan tanggung jawabnya — dan `spec-f:91`
// (pemisahan tugas) runtuh tanpa satu pun aturan terlihat dilanggar.

test('⛔ POST /users: cashier dengan DUA outlet ditolak 400', async () => {
  const outletKedua = freshId();
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await appSetup.query(
    `INSERT INTO outlet (id, tenant_id, name, timezone) VALUES ($1, $2, 'Cabang Dua', 'Asia/Jakarta')`,
    [outletKedua, tenant.id]
  );
  await appSetup.query('COMMIT');

  const res = await buatUser({
    roles: [{ role: 'cashier', scopeType: 'outlet', scopeId: outlet.id }],
    outletIds: [outlet.id, outletKedua],
  });

  assert.equal(res.statusCode, 400, res.body);
  assert.equal(res.json().error.code, 'ROLE_SCOPE_TOO_WIDE');
  // Pesannya menyebut peran MANA dan jalan keluarnya. Penolakan yang hanya
  // berkata "tidak boleh" membuat pemanggil menebak batas mana yang kena.
  assert.match(res.json().error.message, /Kasir|cashier/i);
});

test('⛔ POST /users: outlet_manager dengan DUA outlet ditolak 400', async () => {
  const outletKedua = freshId();
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await appSetup.query(
    `INSERT INTO outlet (id, tenant_id, name, timezone) VALUES ($1, $2, 'Cabang Tiga', 'Asia/Jakarta')`,
    [outletKedua, tenant.id]
  );
  await appSetup.query('COMMIT');

  const res = await buatUser({
    roles: [{ role: 'outlet_manager', scopeType: 'outlet', scopeId: outlet.id }],
    outletIds: [outlet.id, outletKedua],
  });
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(res.json().error.code, 'ROLE_SCOPE_TOO_WIDE');
});

test('⛔ penolakan terjadi SEBELUM satu baris pun ditulis', async () => {
  // `POST /users` menulis "user", user_role, user_outlet, dan audit_event
  // dalam satu transaksi (invariant #1). Penolakan yang terjadi di tengah akan
  // di-rollback juga — tapi yang diuji di sini adalah bahwa tidak ada jalur
  // di mana penggunanya tercipta lalu penjaganya menolak keanggotaan kedua,
  // meninggalkan pengguna separuh jadi.
  const outletKedua = freshId();
  const idBaru = freshId();
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await appSetup.query(
    `INSERT INTO outlet (id, tenant_id, name, timezone) VALUES ($1, $2, 'Cabang Empat', 'Asia/Jakarta')`,
    [outletKedua, tenant.id]
  );
  await appSetup.query('COMMIT');

  const res = await buatUser({
    id: idBaru,
    roles: [{ role: 'cashier', scopeType: 'outlet', scopeId: outlet.id }],
    outletIds: [outlet.id, outletKedua],
  });
  assert.equal(res.statusCode, 400, res.body);

  const { rows } = await kueriTenant(
    `SELECT (SELECT count(*) FROM "user" WHERE id = $1) AS u,
            (SELECT count(*) FROM user_role WHERE user_id = $1) AS r,
            (SELECT count(*) FROM user_outlet WHERE user_id = $1) AS o,
            (SELECT count(*) FROM audit_event WHERE entity_id = $1) AS a`,
    [idBaru]
  );
  assert.deepEqual(
    { u: Number(rows[0].u), r: Number(rows[0].r), o: Number(rows[0].o), a: Number(rows[0].a) },
    { u: 0, r: 0, o: 0, a: 0 }
  );
});

test('peran ber-cakupan LUAS tetap boleh banyak outlet', async () => {
  // ⛔ Penjaga yang menolak semua peran akan membuat Manajer Area mustahil
  // dibuat — `spec-f:30` menulis cakupannya "Beberapa outlet", dan Owner serta
  // Akuntan bercakupan Tenant. Test ini yang membedakan penjaga dari palang.
  const outletKedua = freshId();
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await appSetup.query(
    `INSERT INTO outlet (id, tenant_id, name, timezone) VALUES ($1, $2, 'Cabang Lima', 'Asia/Jakarta')`,
    [outletKedua, tenant.id]
  );
  await appSetup.query('COMMIT');

  for (const peran of ['area_manager', 'accountant']) {
    const res = await buatUser({
      id: freshId(),
      roles: [{ role: peran, scopeType: 'outlet', scopeId: outlet.id }],
      outletIds: [outlet.id, outletKedua],
    });
    assert.equal(res.statusCode, 201, `${peran} ditolak: ${res.body}`);
  }
});

test('satu outlet tetap lewat, dan outlet DUPLIKAT bukan dua outlet', async () => {
  // `outletIds` datang dari klien. Menghitung panjang array mentah membuat
  // `[o1, o1]` ditolak sebagai "dua outlet" — padahal ia satu, dan handler
  // sendiri mem-`Set`-kannya sebelum menulis. Penjaga harus menghitung yang
  // SAMA dengan yang ditulis.
  const res = await buatUser({ outletIds: [outlet.id, outlet.id] });
  assert.equal(res.statusCode, 201, res.body);
  assert.deepEqual(res.json().outletIds, [outlet.id]);
});
