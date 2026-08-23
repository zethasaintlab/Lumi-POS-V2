'use strict';

// Feature flag dan kill switch, sisi server. `ARCH:358`, KEP-36.
//
// "Kill switch: per fitur per merchant, dari server tanpa rilis — kebutuhan
// operasional, bukan kemewahan."
//
// ⛔ Yang paling penting diuji di sini bukan bahwa flag berfungsi, melainkan
// bahwa penyimpangan milik merchant LAIN tidak pernah ikut. Tabelnya
// DIKECUALIKAN dari RLS (migrasi 0032) karena flag adalah keputusan operator —
// jadi tidak ada apa pun di database yang menghentikan query yang lupa
// menyaring. Yang menahannya hanya satu klausa `WHERE`, dan test ini yang
// membuktikan klausa itu ada.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');

let owner, appSetup, app, tenant, outlet, base;

before(async () => {
  owner = await connectAsOwner();
  appSetup = await connectAsApp();
});

after(async () => {
  await owner.query('DELETE FROM feature_flag');
  await resetAll(owner);
  await owner.end();
  await appSetup.end();
  if (app) await app.close();
});

beforeEach(async () => {
  await resetAll(owner);
  // `feature_flag` dikecualikan RLS, jadi `resetAll` menyentuhnya lewat
  // TRUNCATE daftar EXEMPT — baris ini pengaman kalau daftarnya berubah.
  await owner.query('DELETE FROM feature_flag');
  base = await seedTenantBase(appSetup, { suffix: 'FiturTest' });
  tenant = base.tenant;
  outlet = base.outlet;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();
});

function headerTenant(id = tenant.id, auth = base.authHeader) {
  return { 'x-tenant-id': id, authorization: auth };
}

async function buatPerangkat(kode = 'K1') {
  const id = crypto.randomUUID();
  let res = await app.inject({
    method: 'POST',
    url: '/devices',
    payload: { id, outletId: outlet.id, code: kode },
    headers: headerTenant(),
  });
  assert.equal(res.statusCode, 201, res.body);
  res = await app.inject({
    method: 'POST',
    url: `/devices/${id}/credentials`,
    headers: headerTenant(),
  });
  assert.equal(res.statusCode, 201, res.body);
  return { id, secret: res.json().secret };
}

async function setelFlag({ kunci, tenantId = null, aktif }) {
  await owner.query(
    `INSERT INTO feature_flag (id, key, tenant_id, enabled, reason, updated_by)
     VALUES ($1, $2, $3, $4, 'uji', 'test')`,
    [crypto.randomUUID(), kunci, tenantId, aktif]
  );
}

function ambilFitur(perangkat) {
  return app.inject({
    method: 'GET',
    url: `/devices/${perangkat.id}/features`,
    headers: { 'x-tenant-id': tenant.id, authorization: `Bearer ${perangkat.secret}` },
  });
}

// ---------------------------------------------------------------------------

test('tanpa penyimpangan, perangkat menerima bawaan KODE', async () => {
  const { FITUR } = await import('../../packages/domain/src/fitur.ts');
  const p = await buatPerangkat();
  const res = await ambilFitur(p);

  assert.equal(res.statusCode, 200, res.body);
  const { fitur } = res.json();
  // Perangkat menerima SETIAP fitur, bukan hanya yang menyimpang: yang hanya
  // menerima penyimpangan harus menebak sisanya, dan menebak dengan daftar
  // yang lebih tua daripada server.
  assert.deepEqual(Object.keys(fitur).sort(), FITUR.map((f) => f.kunci).sort());
  for (const f of FITUR) assert.equal(fitur[f.kunci], f.bawaan);
});

test('kill switch per merchant mematikan fitur di perangkatnya', async () => {
  const p = await buatPerangkat();
  await setelFlag({ kunci: 'diskon_kasir', tenantId: tenant.id, aktif: false });

  const { fitur } = (await ambilFitur(p)).json();
  assert.equal(fitur.diskon_kasir, false);
  // Fitur lain tidak ikut mati.
  assert.equal(fitur.pembayaran_qris_statis, true);
});

test('kill switch GLOBAL berlaku untuk merchant yang tidak punya barisnya', async () => {
  const p = await buatPerangkat();
  await setelFlag({ kunci: 'pembayaran_qris_statis', tenantId: null, aktif: false });

  const { fitur } = (await ambilFitur(p)).json();
  assert.equal(fitur.pembayaran_qris_statis, false);
});

test('⛔ penyimpangan TENANT menang atas GLOBAL', async () => {
  const p = await buatPerangkat();
  await setelFlag({ kunci: 'buka_laci_no_sale', tenantId: null, aktif: false });
  await setelFlag({ kunci: 'buka_laci_no_sale', tenantId: tenant.id, aktif: true });

  // "Matikan untuk semua kecuali yang sudah kami periksa" adalah bentuk
  // pemulihan insiden yang paling sering dipakai.
  const { fitur } = (await ambilFitur(p)).json();
  assert.equal(fitur.buka_laci_no_sale, true);
});

test('⛔ penyimpangan merchant LAIN tidak pernah ikut', async () => {
  const p = await buatPerangkat();
  const lain = crypto.randomUUID();
  await setelFlag({ kunci: 'diskon_kasir', tenantId: lain, aktif: false });

  // Tabelnya dikecualikan RLS: tidak ada apa pun di database yang
  // menghentikan query yang lupa menyaring tenant. Yang menahannya hanya satu
  // klausa WHERE.
  const { fitur } = (await ambilFitur(p)).json();
  assert.equal(fitur.diskon_kasir, true, 'kill switch merchant lain ikut mematikan fitur di sini');
});

test('⛔ respons TIDAK memuat `tenant_id` siapa pun', async () => {
  const p = await buatPerangkat();
  const lain = crypto.randomUUID();
  await setelFlag({ kunci: 'diskon_kasir', tenantId: lain, aktif: false });
  await setelFlag({ kunci: 'diskon_kasir', tenantId: null, aktif: false });

  const body = (await ambilFitur(p)).body;
  // Mengirim barisnya alih-alih booleannya berarti mengirim `tenant_id`
  // merchant lain ke perangkat.
  assert.equal(body.includes(lain), false, `tenant lain bocor ke respons: ${body}`);
  assert.equal(body.includes('reason'), false, 'alasan kill switch bocor ke merchant');
});

test('⛔ kunci ASING di database tidak menyalakan apa pun', async () => {
  const { FITUR } = await import('../../packages/domain/src/fitur.ts');
  const p = await buatPerangkat();
  await setelFlag({ kunci: 'fitur_yang_sudah_dihapus', tenantId: tenant.id, aktif: true });

  const { fitur } = (await ambilFitur(p)).json();
  // Baris yang tertinggal untuk fitur yang sudah dihapus dari kode tidak boleh
  // muncul sebagai fitur yang menyala.
  assert.deepEqual(Object.keys(fitur).sort(), FITUR.map((f) => f.kunci).sort());
});

test('⛔ tanpa kredensial perangkat: 401, bukan daftar fitur', async () => {
  const p = await buatPerangkat();
  const res = await app.inject({
    method: 'GET',
    url: `/devices/${p.id}/features`,
    headers: { 'x-tenant-id': tenant.id },
  });
  // Menjawab flag ke pemanggil yang hanya menebak device id membuat daftar
  // fitur merchant dapat dibaca siapa pun yang tahu satu uuid.
  assert.equal(res.statusCode, 401, res.body);
});

test('⛔ secret perangkat LAIN ditolak', async () => {
  const a = await buatPerangkat('K1');
  const b = await buatPerangkat('K2');
  const res = await app.inject({
    method: 'GET',
    url: `/devices/${a.id}/features`,
    headers: { 'x-tenant-id': tenant.id, authorization: `Bearer ${b.secret}` },
  });
  assert.equal(res.statusCode, 401, res.body);
});

test('⛔ hanya SATU query di seluruh server yang menyentuh `feature_flag`', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const akar = path.join(__dirname, '..', '..', 'apps', 'server', 'src');

  const berkas = [];
  (function pindai(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) pindai(p);
      else if (/\.ts$/.test(e.name)) berkas.push(p);
    }
  })(akar);

  const penyentuh = berkas.filter((p) => /FROM feature_flag|INTO feature_flag|UPDATE feature_flag/.test(fs.readFileSync(p, 'utf8')));
  // Tabelnya dikecualikan RLS. Query kedua yang lupa menyaring tenant tidak
  // akan ditolak apa pun — ia hanya akan mengembalikan flag merchant lain,
  // tanpa satu pun error.
  assert.deepEqual(
    penyentuh.map((p) => path.relative(akar, p)),
    [path.join('modules', 'rilis', 'index.ts')],
    'ada query KEDUA atas `feature_flag`. Pakai `ambilPenyimpanganFitur`, yang menyaring tenant.'
  );
});
