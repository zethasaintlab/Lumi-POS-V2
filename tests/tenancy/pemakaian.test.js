'use strict';

// `GET /tenants/usage` — data untuk layar B-29 "Langganan & Batas".
//
// ⛔ Yang paling penting diuji di sini BUKAN bahwa angkanya benar, melainkan
// bahwa angka yang DITAMPILKAN sama dengan angka yang DITEGAKKAN. Dua salinan
// query yang menyimpang pada aturan arsip menghasilkan gejala terburuk yang
// mungkin untuk layar ini: merchant melihat "12 dari 200" lalu operasinya
// ditolak karena kuota penuh — tanpa satu pun error yang menjelaskan mana
// dari dua angka itu yang bohong.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');

let owner, appDb, app, tenant;

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
  tenant = await daftarkanMerchant();
});

async function daftarkanMerchant() {
  const b = {
    tenant: { id: crypto.randomUUID(), name: 'Kopi Pemakaian' },
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

function H(extra = {}) {
  return {
    'content-type': 'application/json',
    'x-tenant-id': tenant.id,
    'x-actor-id': tenant.ownerId,
    ...extra,
  };
}

const post = (url, payload, headers = {}) =>
  app.inject({ method: 'POST', url, payload, headers: H(headers) });

async function pemakaian(headers = {}) {
  const res = await app.inject({ method: 'GET', url: '/tenants/usage', headers: H(headers) });
  assert.equal(res.statusCode, 200, res.body);
  return JSON.parse(res.body);
}

async function setelKuota(kolom, nilai) {
  await appDb.query(`UPDATE tenant SET ${kolom} = $2 WHERE id = $1`, [tenant.id, nilai]);
}

function buatItem(nama) {
  const id = crypto.randomUUID();
  return post('/items', {
    id,
    name: nama,
    variations: [{ id: crypto.randomUUID(), name: 'Regular', price: '10000' }],
  }).then((res) => {
    assert.equal(res.statusCode, 201, res.body);
    return id;
  });
}

const buatPengguna = (nama) =>
  post('/users', {
    id: crypto.randomUUID(),
    name: nama,
    roles: [{ role: 'cashier', scopeType: 'outlet', scopeId: tenant.outletId }],
    outletIds: [tenant.outletId],
  });

const buatPerangkat = (id, kode) =>
  post('/devices', { id, outletId: tenant.outletId, code: kode });

// ---------------------------------------------------------------------------

test('pemakaian awal mencerminkan apa yang dibuat pendaftaran', async () => {
  const b = await pemakaian();

  assert.equal(b.plan, 'free');
  assert.equal(b.status, 'active');
  assert.deepEqual(b.kuota.outlet, { terpakai: 1, batas: 1 }, 'pendaftaran membuat satu outlet');
  assert.deepEqual(b.kuota.pengguna, { terpakai: 1, batas: 3 }, 'pendaftaran membuat owner');
  assert.deepEqual(b.kuota.device, { terpakai: 0, batas: 2 });
  assert.deepEqual(b.kuota.produk, { terpakai: 0, batas: 200 });
});

test('⛔ setiap dimensi di DIMENSI_KUOTA muncul — tanpa daftar tulis tangan', async () => {
  // Dimensi yang ditambahkan kelak harus muncul di layar ini tanpa ada yang
  // perlu ingat menambahkannya, dan dimensi yang dihapus tidak boleh
  // tertinggal sebagai baris hantu.
  const { DIMENSI_KUOTA } = await import('../../packages/domain/src/kuota.ts');
  const b = await pemakaian();
  assert.deepEqual(Object.keys(b.kuota).sort(), [...DIMENSI_KUOTA].sort());
});

// --- yang TIDAK dihitung ---------------------------------------------------

test('⛔ produk yang DIARSIPKAN tidak ikut terhitung', async () => {
  await buatItem('Kopi Satu');
  const id = await buatItem('Kopi Arsip');
  assert.equal((await pemakaian()).kuota.produk.terpakai, 2);

  assert.equal((await post(`/items/${id}/archive`, {})).statusCode, 200);
  assert.equal(
    (await pemakaian()).kuota.produk.terpakai,
    1,
    'item terarsip masih dihitung — kuota jadi penghitung seumur hidup'
  );
});

test('⛔ outlet yang DIARSIPKAN tidak ikut terhitung', async () => {
  await setelKuota('max_outlets', 5);
  const id = crypto.randomUUID();
  assert.equal(
    (await post('/outlets', { id, name: 'Cabang Dua', timezone: 'Asia/Jakarta' })).statusCode,
    201
  );
  assert.equal((await pemakaian()).kuota.outlet.terpakai, 2);

  // Belum ada endpoint arsip outlet — diarsipkan langsung di database, lewat
  // koneksi ber-app.tenant_id supaya tetap tunduk RLS seperti aplikasi.
  await appDb.query('BEGIN');
  await appDb.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await appDb.query('UPDATE outlet SET archived_at = now() WHERE id = $1', [id]);
  await appDb.query('COMMIT');

  assert.equal((await pemakaian()).kuota.outlet.terpakai, 1, 'outlet terarsip masih dihitung');
});

test('⛔ pengguna yang DINONAKTIFKAN tidak ikut terhitung', async () => {
  const id = crypto.randomUUID();
  assert.equal(
    (
      await post('/users', {
        id,
        name: 'Kasir Satu',
        roles: [{ role: 'cashier', scopeType: 'outlet', scopeId: tenant.outletId }],
        outletIds: [tenant.outletId],
      })
    ).statusCode,
    201
  );
  assert.equal((await pemakaian()).kuota.pengguna.terpakai, 2);

  const nonaktif = await app.inject({
    method: 'PATCH',
    url: `/users/${id}`,
    payload: { isActive: false },
    headers: H(),
  });
  assert.equal(nonaktif.statusCode, 200, nonaktif.body);

  assert.equal(
    (await pemakaian()).kuota.pengguna.terpakai,
    1,
    'pengguna nonaktif masih dihitung — baris "user" tidak pernah dihapus, jadi slotnya hilang selamanya'
  );
});

test('⛔ perangkat yang DICABUT tidak ikut terhitung', async () => {
  const id = crypto.randomUUID();
  assert.equal((await buatPerangkat(id, 'K1')).statusCode, 201);
  assert.equal((await pemakaian()).kuota.device.terpakai, 1);

  assert.equal((await post(`/devices/${id}/revoke`, {})).statusCode, 200);
  assert.equal((await pemakaian()).kuota.device.terpakai, 0, 'perangkat tercabut masih dihitung');
});

// --- ⛔ yang ditampilkan == yang ditegakkan ---------------------------------

test('⛔ angka yang DITAMPILKAN adalah angka yang DITEGAKKAN — keempat dimensi', async () => {
  // Penjaga inti berkas ini. Untuk tiap dimensi: isi sampai layar berkata
  // penuh, lalu buktikan operasi berikutnya BENAR-BENAR ditolak. Kalau kedua
  // angka berasal dari query berbeda, salah satu dari dua assertion ini
  // gagal.
  await setelKuota('max_outlets', 2);

  // produk: batas 200, terlalu mahal diisi satu-satu — kuota diturunkan.
  await setelKuota('max_products', 2);
  await buatItem('Kopi A');
  await buatItem('Kopi B');
  let b = await pemakaian();
  assert.equal(b.kuota.produk.terpakai, b.kuota.produk.batas, 'layar belum menyatakan penuh');
  const produkTolak = await post('/items', {
    id: crypto.randomUUID(),
    name: 'Kopi C',
    variations: [{ id: crypto.randomUUID(), name: 'Regular', price: '10000' }],
  });
  assert.equal(produkTolak.statusCode, 403, 'layar berkata penuh tapi server menerima');

  // outlet
  assert.equal(
    (await post('/outlets', { id: crypto.randomUUID(), name: 'Dua', timezone: 'Asia/Jakarta' }))
      .statusCode,
    201
  );
  b = await pemakaian();
  assert.equal(b.kuota.outlet.terpakai, b.kuota.outlet.batas);
  assert.equal(
    (await post('/outlets', { id: crypto.randomUUID(), name: 'Tiga', timezone: 'Asia/Jakarta' }))
      .statusCode,
    403
  );

  // pengguna: batas 3, owner sudah satu
  assert.equal((await buatPengguna('Kasir Satu')).statusCode, 201);
  assert.equal((await buatPengguna('Kasir Dua')).statusCode, 201);
  b = await pemakaian();
  assert.equal(b.kuota.pengguna.terpakai, b.kuota.pengguna.batas);
  assert.equal((await buatPengguna('Kasir Tiga')).statusCode, 403);

  // device: batas 2
  assert.equal((await buatPerangkat(crypto.randomUUID(), 'K1')).statusCode, 201);
  assert.equal((await buatPerangkat(crypto.randomUUID(), 'K2')).statusCode, 201);
  b = await pemakaian();
  assert.equal(b.kuota.device.terpakai, b.kuota.device.batas);
  assert.equal((await buatPerangkat(crypto.randomUUID(), 'K3')).statusCode, 403);
});

test('⛔ pemakaian yang DITAMPILKAN cocok dengan angka di pesan penolakan kuota', async () => {
  // Pesan penolakan membawa `terpakai` (`spec-e:152`, pola yang sama). Kalau
  // ia berbeda dari yang di layar, merchant membaca dua angka berbeda untuk
  // satu hal yang sama, di dua tempat yang keduanya mengaku benar.
  await buatItem('Kopi Satu');
  await buatItem('Kopi Dua');
  await setelKuota('max_products', 2);

  const terpakai = (await pemakaian()).kuota.produk.terpakai;
  const tolak = await post('/items', {
    id: crypto.randomUUID(),
    name: 'Kopi Tiga',
    variations: [{ id: crypto.randomUUID(), name: 'Regular', price: '10000' }],
  });

  assert.equal(tolak.statusCode, 403);
  assert.match(
    JSON.parse(tolak.body).error.message,
    new RegExp(`terpakai ${terpakai}\\b`),
    `layar berkata ${terpakai}, pesan penolakan berkata lain`
  );
});

// --- akses & isolasi -------------------------------------------------------

test('⛔ hanya Owner yang boleh melihat langganan (spec-f:52)', async () => {
  const kasirId = crypto.randomUUID();
  assert.equal(
    (
      await post('/users', {
        id: kasirId,
        name: 'Kasir',
        roles: [{ role: 'cashier', scopeType: 'outlet', scopeId: tenant.outletId }],
        outletIds: [tenant.outletId],
      })
    ).statusCode,
    201
  );

  const res = await app.inject({
    method: 'GET',
    url: '/tenants/usage',
    headers: H({ 'x-actor-id': kasirId }),
  });
  assert.equal(res.statusCode, 403, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'FORBIDDEN');
});

test('⛔ pemakaian tenant lain tidak bocor', async () => {
  const lain = await daftarkanMerchant();
  await appDb.query('BEGIN');
  await appDb.query(`SELECT set_config('app.tenant_id', $1, true)`, [lain.id]);
  await appDb.query(
    `INSERT INTO item (id, tenant_id, name) VALUES ($1, $2, 'Produk Tenant Lain')`,
    [crypto.randomUUID(), lain.id]
  );
  await appDb.query('COMMIT');

  assert.equal(
    (await pemakaian()).kuota.produk.terpakai,
    0,
    'produk tenant lain terhitung sebagai milik tenant ini'
  );
});

test('⛔ batas `null` dikembalikan apa adanya, bukan 0', async () => {
  // Tier enterprise. `null` yang dikonversi jadi 0 di lapisan mana pun akan
  // membuat layar berkata "12 dari 0" — dan bar progres yang membagi dengan
  // nol.
  await setelKuota('max_products', null);
  const b = await pemakaian();
  assert.equal(b.kuota.produk.batas, null);
  assert.equal(b.kuota.outlet.batas, 1, 'dimensi lain tidak ikut berubah');
});
