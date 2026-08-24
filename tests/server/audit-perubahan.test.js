'use strict';

// FR-F6 — setiap mutasi katalog, harga, stok, dan pajak meninggalkan jejak.
//
// AC pertamanya: *"Setiap event dalam daftar menghasilkan record."* AC
// ketiganya: *"Event dibuat dalam transaksi yang sama dengan operasi yang
// dicatatnya."*
//
// ⛔ Yang diuji di sini adalah SATU-SATUNYA cara membuktikan keduanya: memanggil
// endpointnya sungguhan lewat `app.inject`, lalu membaca `audit_event` dari
// database. Test yang memanggil `catatPerubahanServer` langsung membuktikan
// bahwa fungsinya menulis — bukan bahwa handler-nya memanggilnya. Kelas yang
// sama dengan pelajaran 21 Agustus 2026: header yang tidak pernah disusun
// `buatPengirimHttp` tidak dapat hilang dari test yang menuliskan headernya
// sendiri.
//
// ⛔ Dan `before` diuji ISINYA, bukan keberadaannya. Audit yang menjawab
// "harganya diubah dari berapa" dengan angka barunya sendiri lolos setiap test
// yang hanya memeriksa bahwa kolomnya terisi.

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
  base = await seedTenantBase(appSetup, { suffix: 'AuditMutasi' });
  tenant = base.tenant;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();
});

function req(method, url, payload) {
  return app.inject({
    method,
    url,
    payload,
    headers: { 'x-tenant-id': tenant.id, authorization: base.authHeader },
  });
}

/** Baris audit bertipe tertentu, terbaru lebih dulu. */
async function auditRows(eventType) {
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  const { rows } = await appSetup.query(
    `SELECT event_type, entity_type, entity_id, actor_user_id, approver_user_id,
            outlet_id, device_id, hlc::text AS hlc, before, after
       FROM audit_event WHERE event_type = $1 ORDER BY occurred_at DESC, id DESC`,
    [eventType]
  );
  await appSetup.query('COMMIT');
  return rows;
}

async function buatItem({ price = 25000 } = {}) {
  const itemId = crypto.randomUUID();
  const varId = crypto.randomUUID();
  const res = await req('POST', '/items', {
    id: itemId,
    name: 'Kopi Susu',
    variations: [{ id: varId, price }],
  });
  assert.equal(res.statusCode, 201, res.body);
  return { itemId, varId };
}

// ---------------------------------------------------------------------------
// Katalog
// ---------------------------------------------------------------------------

test('createItem menulis item_created di transaksi yang sama', async () => {
  const { itemId } = await buatItem();
  const rows = await auditRows('item_created');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].entity_id, itemId);
  assert.equal(rows[0].entity_type, 'item');
  assert.equal(rows[0].actor_user_id, base.user.id);
  // ⛔ Tanpa penyetuju — `catalog_edit` adalah hak PERAN, bukan tindakan yang
  // menuntut orang kedua. Mengisinya dengan aktor ditolak CHECK di database.
  assert.equal(rows[0].approver_user_id, null);
  // ⛔ `hlc = 0` adalah nilai yang jujur: perubahan back-office tidak punya
  // perangkat dan tidak berhak mengklaim posisi dalam urutan kausal.
  assert.equal(rows[0].hlc, '0');
  assert.equal(rows[0].device_id, null);
  assert.equal(rows[0].after.name, 'Kopi Susu');
});

test('⛔ createItem yang GAGAL tidak meninggalkan baris audit', async () => {
  // AC ketiga FR-F6 diuji dari sisi sebaliknya: audit yang ditulis di luar
  // transaksi akan bertahan saat operasinya di-rollback, dan trail yang memuat
  // perubahan yang tidak pernah terjadi lebih buruk daripada trail berlubang.
  const { itemId } = await buatItem();
  const ulang = await req('POST', '/items', {
    id: itemId,
    name: 'Duplikat',
    variations: [{ id: crypto.randomUUID(), price: 1000 }],
  });
  assert.equal(ulang.statusCode, 409, ulang.body);
  assert.equal((await auditRows('item_created')).length, 1);
});

test('⛔ updateItem menulis BEFORE yang berbeda dari AFTER', async () => {
  // Audit yang menjawab "diubah dari apa" dengan nilai barunya sendiri lolos
  // setiap test yang hanya memeriksa bahwa kolomnya terisi.
  const { itemId } = await buatItem();
  const res = await req('PATCH', `/items/${itemId}`, { name: 'Kopi Susu Gula Aren' });
  assert.equal(res.statusCode, 200, res.body);

  const rows = await auditRows('item_updated');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].before.name, 'Kopi Susu');
  assert.equal(rows[0].after.name, 'Kopi Susu Gula Aren');
});

test('arsip dan pemulihan memakai peristiwa yang SAMA, dibedakan nilainya', async () => {
  // `spec-f:294` hanya menyebut `item_archived`. Memancarkan `item_restored`
  // yang tidak ada di daftar berarti kosakata yang tidak dapat dibandingkan
  // dengan spec-nya.
  const { itemId } = await buatItem();
  assert.equal((await req('POST', `/items/${itemId}/archive`)).statusCode, 200);
  assert.equal((await req('POST', `/items/${itemId}/restore`)).statusCode, 200);

  const rows = await auditRows('item_archived');
  assert.equal(rows.length, 2);
  const arsip = rows.find((r) => r.before.archivedAt === null);
  const pulih = rows.find((r) => r.before.archivedAt !== null);
  assert.notEqual(arsip, undefined, 'peristiwa pengarsipan tidak ditemukan');
  assert.notEqual(pulih, undefined, 'peristiwa pemulihan tidak ditemukan');
  assert.notEqual(arsip.after.archivedAt, null);
  assert.equal(pulih.after.archivedAt, null);
});

test('varian yang ditambah dan diubah tercatat pada ITEM-nya', async () => {
  // `entityId` menunjuk item, bukan varian: menelusuri satu item harus
  // mengembalikan seluruh riwayat variannya.
  const { itemId } = await buatItem();
  const varBaru = crypto.randomUUID();
  assert.equal(
    (await req('POST', `/items/${itemId}/variations`, { id: varBaru, name: 'Large', price: 30000 }))
      .statusCode,
    201
  );
  assert.equal(
    (await req('PATCH', `/items/${itemId}/variations/${varBaru}`, { name: 'Jumbo' })).statusCode,
    200
  );

  const rows = await auditRows('item_updated');
  assert.equal(rows.length, 2);
  for (const r of rows) assert.equal(r.entity_id, itemId);
  const diubah = rows.find((r) => r.before !== null);
  assert.equal(diubah.before.variation.name, 'Large');
  assert.equal(diubah.after.variation.name, 'Jumbo');
});

// ---------------------------------------------------------------------------
// Harga
// ---------------------------------------------------------------------------

test('⛔ price_changed menyebut harga yang BERLAKU sebelumnya, bukan harga barunya', async () => {
  // Baris baru menang di tangga resolusi begitu ia tertulis. Meresolusi
  // SESUDAH insert membuat `before` sama dengan `after` — dan audit yang
  // menjawab "harganya diubah dari berapa" dengan angka barunya sendiri lebih
  // buruk daripada audit yang tidak menjawab.
  const { itemId, varId } = await buatItem({ price: 25000 });
  const res = await req('POST', `/items/${itemId}/variations/${varId}/prices`, {
    id: crypto.randomUUID(),
    price: 30000,
  });
  assert.equal(res.statusCode, 201, res.body);

  const rows = await auditRows('price_changed');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].entity_id, varId);
  assert.equal(rows[0].before.price, '25000');
  assert.equal(rows[0].after.price, '30000');
});

test('harga per outlet mencatat outletnya', async () => {
  const { itemId, varId } = await buatItem({ price: 25000 });
  const res = await req('POST', `/items/${itemId}/variations/${varId}/prices`, {
    id: crypto.randomUUID(),
    price: 27000,
    outletId: base.outlet.id,
  });
  assert.equal(res.statusCode, 201, res.body);

  const rows = await auditRows('price_changed');
  assert.equal(rows[0].outlet_id, base.outlet.id);
  assert.equal(rows[0].after.outletId, base.outlet.id);
});

// ---------------------------------------------------------------------------
// Stok
// ---------------------------------------------------------------------------

test('⛔ stock_adjusted mencatat DELTA dan alasannya, bukan stok akhirnya', async () => {
  // Stok adalah `SUM(stock_movement.delta)` dan tidak punya kolom; menuliskan
  // "stok akhir" ke audit berarti angka kedua yang harus dijaga sepakat dengan
  // ledger-nya.
  const { varId } = await buatItem();
  const res = await req('POST', '/inventory/movements', {
    outletId: base.outlet.id,
    variationId: varId,
    type: 'adjustment',
    delta: '-3000',
    reasonCode: 'rusak',
  });
  assert.equal(res.statusCode, 201, res.body);

  const rows = await auditRows('stock_adjusted');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].entity_id, varId);
  assert.equal(rows[0].outlet_id, base.outlet.id);
  assert.equal(rows[0].after.delta, '-3000');
  assert.equal(rows[0].after.reasonCode, 'rusak');
  assert.equal('stokAkhir' in rows[0].after, false);
});

test('⛔ sold_out_toggled mencatat ARAHNYA', async () => {
  // Penandaan habis terpisah dari stok terhitung (`spec-e:220`); audit yang
  // hanya mencatat "ditandai" tidak dapat membedakan menandai habis dari
  // membatalkannya.
  const { varId } = await buatItem();
  for (const isSoldOut of [true, false]) {
    const res = await app.inject({
      method: 'POST',
      url: '/inventory/sold-out',
      payload: { outletId: base.outlet.id, variationId: varId, isSoldOut },
      headers: {
        'x-tenant-id': tenant.id,
        authorization: base.authHeader,
        'idempotency-key': crypto.randomUUID(),
      },
    });
    assert.equal(res.statusCode, 201, res.body);
  }

  const rows = await auditRows('sold_out_toggled');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.after.isSoldOut).sort(), [false, true]);
});

// ---------------------------------------------------------------------------
// Pajak
// ---------------------------------------------------------------------------

test('tax_rate_changed dicatat saat dibuat dan saat diakhiri', async () => {
  const id = crypto.randomUUID();
  assert.equal(
    (
      await req('POST', '/tax-rates', {
        id,
        name: 'PBJT 11%',
        type: 'pbjt',
        rate: '0.1100',
        isInclusive: false,
        effectiveFrom: new Date().toISOString(),
      })
    ).statusCode,
    201
  );
  assert.equal((await req('POST', `/tax-rates/${id}/end`)).statusCode, 200);

  const rows = await auditRows('tax_rate_changed');
  assert.equal(rows.length, 2);
  for (const r of rows) assert.equal(r.entity_id, id);

  const dibuat = rows.find((r) => r.before === null);
  const diakhiri = rows.find((r) => r.before !== null);
  // ⛔ Tarif disalin sebagai STRING dari kolom numeric. Melewatkannya lewat
  // Number adalah persis yang `numeric.ts` ada untuk mencegah — dan audit
  // trail pajak yang angkanya bergeser adalah bukti yang lebih buruk daripada
  // tidak ada bukti.
  assert.equal(dibuat.after.rate, '0.1100');
  assert.equal(typeof dibuat.after.rate, 'string');
  assert.equal(diakhiri.before.effectiveTo, null);
  assert.notEqual(diakhiri.after.effectiveTo, null);
});

// ---------------------------------------------------------------------------
// Sesi, shift, perangkat, ekspor
// ---------------------------------------------------------------------------

/** Pengguna ber-email + password, satu-satunya bentuk yang dapat login. */
async function buatPenggunaLogin(email, password) {
  const id = crypto.randomUUID();
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await appSetup.query(`INSERT INTO "user" (id,tenant_id,name,email) VALUES ($1,$2,'Uji Login',$3)`, [
    id,
    tenant.id,
    email,
  ]);
  await appSetup.query(
    `INSERT INTO user_role (id,tenant_id,user_id,role,scope_type,scope_id)
     VALUES ($1,$2,$3,'owner','tenant',$2)`,
    [crypto.randomUUID(), tenant.id, id]
  );
  await appSetup.query('COMMIT');

  const res = await app.inject({
    method: 'PUT',
    url: `/users/${id}/password`,
    payload: { password },
    headers: { 'x-tenant-id': tenant.id, authorization: base.authHeader, 'x-actor-id': id },
  });
  assert.equal(res.statusCode, 204, res.body);
  return id;
}

test('login menulis jejak dengan PERAN yang berlaku saat itu', async () => {
  // ⛔ `after` memuat peran, bukan email atau alamat IP. Peran pada saat itu
  // yang menjelaskan "kenapa orang ini dapat melakukan itu" berbulan-bulan
  // kemudian, saat perannya sudah berbeda.
  const userId = await buatPenggunaLogin('audit-login@contoh.id', 'kataSandiPanjang123');
  const res = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: 'audit-login@contoh.id', password: 'kataSandiPanjang123' },
    headers: { 'x-tenant-id': tenant.id },
  });
  assert.equal(res.statusCode, 200, res.body);

  const rows = await auditRows('login');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].actor_user_id, userId);
  assert.equal(rows[0].entity_type, 'user_session');
  assert.ok(Array.isArray(rows[0].after.roles));
  // ⛔ Tidak ada email di jejak. Audit trail bertahan lima tahun
  // (`spec-f:372`); setiap field yang masuk ke sana masuk untuk lima tahun.
  assert.equal(JSON.stringify(rows[0].after).includes('@'), false);
});

test('⛔ login yang GAGAL tidak menulis apa pun', async () => {
  // `audit_event.actor_user_id` adalah NOT NULL ber-FK; login yang gagal
  // sering memakai email yang tidak menunjuk pengguna mana pun. Batas yang
  // dinyatakan, bukan kelalaian — `spec-f:290` sendiri tidak memuat
  // `login_failed`.
  await buatPenggunaLogin('audit-gagal@contoh.id', 'kataSandiPanjang123');
  const res = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: 'audit-gagal@contoh.id', password: 'salahSekaliSekali' },
    headers: { 'x-tenant-id': tenant.id },
  });
  assert.equal(res.statusCode, 401);
  assert.equal((await auditRows('login')).length, 0);
});

test('logout menulis jejak SESUDAH sesinya dihapus', async () => {
  const userId = await buatPenggunaLogin('audit-logout@contoh.id', 'kataSandiPanjang123');
  const masuk = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: 'audit-logout@contoh.id', password: 'kataSandiPanjang123' },
    headers: { 'x-tenant-id': tenant.id },
  });
  assert.equal(masuk.statusCode, 200, masuk.body);
  const { token } = JSON.parse(masuk.body);
  const keluar = await app.inject({
    method: 'POST',
    url: '/auth/logout',
    headers: { 'x-tenant-id': tenant.id, authorization: `Bearer ${token}` },
  });
  assert.equal(keluar.statusCode, 204, keluar.body);

  // Barisnya hilang, jejaknya tidak — "sampai kapan orang ini masih masuk"
  // adalah pertanyaan sengketa.
  const rows = await auditRows('logout');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].actor_user_id, userId);
});

test('openShift menulis shift_opened dengan modal awal sebagai STRING', async () => {
  // Sampai 23 Agustus 2026 setiap shift dibuka tanpa satu pun jejak.
  const deviceId = crypto.randomUUID();
  assert.equal(
    (
      await req('POST', '/devices', {
        id: deviceId,
        outletId: base.outlet.id,
        code: 'K9',
        name: 'Kasir 9',
        platform: 'tauri',
      })
    ).statusCode,
    201
  );

  const res = await req('POST', '/shifts', {
    id: crypto.randomUUID(),
    outletId: base.outlet.id,
    deviceId,
    businessDate: '2026-08-23',
    openingFloat: 500000,
  });
  assert.equal(res.statusCode, 201, res.body);

  const rows = await auditRows('shift_opened');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].outlet_id, base.outlet.id);
  // ⛔ Uang sebagai STRING. Modal awal yang melewati Number di jalur audit
  // adalah cacat yang sama dengan yang PR #32 perbaiki di payload pembatalan.
  assert.equal(rows[0].after.openingFloat, '500000');
  assert.equal(typeof rows[0].after.openingFloat, 'string');
});

test('perangkat: didaftarkan dan dicabut, keduanya berjejak', async () => {
  const deviceId = crypto.randomUUID();
  assert.equal(
    (
      await req('POST', '/devices', {
        id: deviceId,
        outletId: base.outlet.id,
        code: 'K8',
        name: 'Kasir 8',
        platform: 'tauri',
      })
    ).statusCode,
    201
  );
  assert.equal((await req('POST', `/devices/${deviceId}/revoke`)).statusCode, 200);

  const dibuat = await auditRows('device_provisioned');
  assert.equal(dibuat.length, 1);
  assert.equal(dibuat[0].after.code, 'K8');
  // ⛔ Tidak ada bahan kredensial di jejak yang bertahan lima tahun.
  assert.equal(JSON.stringify(dibuat[0].after).includes('token'), false);

  const dicabut = await auditRows('device_revoked');
  assert.equal(dicabut.length, 1);
  // ⛔ `before.revokedAt` membedakan pencabutan pertama dari klik kedua.
  assert.equal(dicabut[0].before.revokedAt, null);
  assert.notEqual(dicabut[0].after.revokedAt, null);
});

test('⛔ ekspor CSV berjejak, dan jejaknya TIDAK memuat datanya', async () => {
  // Ekspor tidak mengubah apa pun; yang berubah adalah di mana datanya
  // berada. Menyalin CSV-nya ke `after` menggandakan setiap angka penjualan ke
  // dalam tabel yang bertahan lima tahun.
  const res = await app.inject({
    method: 'GET',
    url: '/reports/export?type=sales&from=2026-08-01&to=2026-08-31',
    headers: { 'x-tenant-id': tenant.id, authorization: base.authHeader },
  });
  assert.equal(res.statusCode, 200, res.body);

  const rows = await auditRows('data_exported');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].after.jenis, 'sales');
  assert.equal(rows[0].after.from, '2026-08-01');
  assert.equal(rows[0].entity_id, 'sales');
  assert.equal('csv' in rows[0].after, false);
  assert.equal('omzetKotor' in rows[0].after, false);
});

// ---------------------------------------------------------------------------
// ⛔ Aktor
// ---------------------------------------------------------------------------

test('⛔ aktor datang dari SESI, bukan dari header yang klien tulis', async () => {
  // `getActorId`: sesi menang. Test yang mengganti `X-Actor-Id` untuk menguji
  // aktor lain sebenarnya menguji pemilik sesi (`CLAUDE.md`) — dan audit trail
  // yang aktornya dapat dipalsukan lewat header tidak membuktikan apa pun.
  const orangLain = crypto.randomUUID();
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await appSetup.query(`INSERT INTO "user" (id,tenant_id,name) VALUES ($1,$2,'Orang Lain')`, [
    orangLain,
    tenant.id,
  ]);
  await appSetup.query('COMMIT');

  const res = await app.inject({
    method: 'POST',
    url: '/items',
    payload: {
      id: crypto.randomUUID(),
      name: 'Teh Tarik',
      variations: [{ id: crypto.randomUUID(), price: 15000 }],
    },
    headers: {
      'x-tenant-id': tenant.id,
      authorization: base.authHeader,
      'x-actor-id': orangLain,
    },
  });
  assert.equal(res.statusCode, 201, res.body);

  const rows = await auditRows('item_created');
  assert.equal(rows[0].actor_user_id, base.user.id);
  assert.notEqual(rows[0].actor_user_id, orangLain);
});

// ---------------------------------------------------------------------------
// FR-F9 / FR-F10 — audit trail tidak dapat dimatikan, dan Owner tidak
// dikecualikan darinya
// ---------------------------------------------------------------------------

test('⛔ FR-F10 — OWNER tidak dikecualikan dari audit trail', async () => {
  // `spec-f` menaruhnya sebagai FR tersendiri justru karena ia adalah godaan
  // yang wajar: owner adalah pemilik datanya, dan "kenapa tindakan saya
  // sendiri harus dicatat" adalah pertanyaan yang akan diajukan seseorang.
  //
  // Jawabannya: audit trail dibaca saat SENGKETA, dan sengketa yang paling
  // mahal adalah antara owner dan rekan pemiliknya, atau antara owner dan
  // investornya. Trail yang mengecualikan owner tidak dapat menjawab satu pun
  // dari keduanya — dan yang mengecualikan dirinya adalah orang yang paling
  // ingin dikecualikan.
  //
  // Tidak ada apa pun di `recordAuditEvent` yang memeriksa peran, dan itulah
  // yang membuat FR ini benar. Test ini menjaga agar pemeriksaan seperti itu
  // tidak pernah ditambahkan.
  await jadikanPeranTunggal('owner');
  const { itemId } = await buatItem();

  const rows = await auditRows('item_created');
  const milikOwner = rows.filter((r) => r.entity_id === itemId);
  assert.equal(milikOwner.length, 1, 'tindakan owner TIDAK tercatat di audit trail');
  assert.equal(milikOwner[0].actor_user_id, base.user.id);
});

test('⛔ FR-F10 — peran APA PUN menghasilkan baris audit yang sama bentuknya', async () => {
  // Kontrol negatif untuk test di atas: "owner tercatat" tidak boleh berarti
  // "owner tercatat berbeda". Baris audit yang bentuknya bergantung pada peran
  // pelakunya membuat laporan yang menyaring per jenis melewatkan sebagian.
  const bentuk = [];
  for (const peran of ['owner', 'area_manager']) {
    await jadikanPeranTunggal(peran);
    const { itemId } = await buatItem();
    const rows = await auditRows('item_created');
    const row = rows.find((r) => r.entity_id === itemId);
    assert.ok(row, `${peran}: tidak tercatat`);
    bentuk.push(Object.keys(row).sort().join(','));
  }
  assert.equal(new Set(bentuk).size, 1, 'bentuk baris audit berbeda antar peran');
});

/**
 * Mengganti peran PEMILIK SESI menjadi satu peran saja.
 *
 * ⛔ Lewat `user_role`, bukan lewat `X-Actor-Id`: header itu diabaikan
 * sepenuhnya di rute terlindungi ("sesi menang").
 */
async function jadikanPeranTunggal(peran) {
  const tenantWide = peran === 'owner' || peran === 'accountant';
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await appSetup.query('DELETE FROM user_role WHERE user_id = $1', [base.user.id]);
  await appSetup.query(
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
  await appSetup.query('COMMIT');
}
