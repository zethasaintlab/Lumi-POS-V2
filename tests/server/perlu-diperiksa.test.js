'use strict';

// B-15 "Perlu Diperiksa" — oversell dan selisih kas.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');

let owner, db, app, base, tenant, outletId, device, varId;

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

beforeEach(async () => {
  await db.query('ROLLBACK').catch(() => {});
  await resetAll(owner);
  base = await seedTenantBase(db, { suffix: 'PerluPeriksa' });
  tenant = base.tenant;
  outletId = base.outlet.id;

  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();

  device = crypto.randomUUID();
  varId = crypto.randomUUID();
  const itemId = crypto.randomUUID();

  await db.query('BEGIN');
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await db.query(
    `INSERT INTO device (id, tenant_id, outlet_id, code, name, platform, app_version, schema_version)
     VALUES ($1,$2,$3,'K1','K1','tauri','0','1')`,
    [device, tenant.id, outletId]
  );
  await db.query(`INSERT INTO item (id, tenant_id, name) VALUES ($1,$2,'Kopi Susu')`, [itemId, tenant.id]);
  await db.query(
    `INSERT INTO item_variation (id, tenant_id, item_id, name, price, track_stock)
     VALUES ($1,$2,$3,'Reguler',25000,true)`,
    [varId, tenant.id, itemId]
  );
  await db.query('COMMIT');
});

async function oversell({
  qty = 3000,
  hari = 0,
  selesai = false,
  variationId = null,
} = {}) {
  const id = crypto.randomUUID();
  await db.query('BEGIN');
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await db.query(
    `INSERT INTO oversell_event
       (id, tenant_id, outlet_id, variation_id, detected_at, devices_involved,
        orders_involved, quantity_over, resolved_by, resolved_at, resolution_note)
     VALUES ($1,$2,$3,$4, now() - ($5 || ' days')::interval, $6::jsonb, $7::jsonb, $8, $9, $10, $11)`,
    [
      id, tenant.id, outletId, variationId ?? varId, String(hari),
      JSON.stringify([device]), JSON.stringify([crypto.randomUUID()]), qty,
      selesai ? base.user.id : null,
      selesai ? new Date().toISOString() : null,
      selesai ? 'Sudah dicek gudang' : null,
    ]
  );
  await db.query('COMMIT');
  return id;
}

async function shiftTertutup({ selisih = -50000, tanggal = '2026-08-10' } = {}) {
  const id = crypto.randomUUID();
  await db.query('BEGIN');
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await db.query(
    `INSERT INTO cash_drawer_shift
       (id, tenant_id, outlet_id, device_id, business_date, status, opening_float,
        opened_by, counted_amount, expected_amount, difference, closed_by, closed_at,
        variance_reason_code)
     VALUES ($1,$2,$3,$4,$5,'closed',100000,$6,$7,100000,$8,$6, now(), 'kesalahan_hitung')`,
    [id, tenant.id, outletId, device, tanggal, base.user.id, 100000 + selisih, selisih]
  );
  await db.query('COMMIT');
  return id;
}

async function shiftTerbuka() {
  const id = crypto.randomUUID();
  await db.query('BEGIN');
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await db.query(
    `INSERT INTO cash_drawer_shift (id, tenant_id, outlet_id, device_id, business_date, status, opening_float, opened_by)
     VALUES ($1,$2,$3,$4,'2026-08-10','open',100000,$5)`,
    [id, tenant.id, outletId, device, base.user.id]
  );
  await db.query('COMMIT');
  return id;
}

const RENTANG = 'from=2026-08-01&to=2026-12-31';
const periksa = (q = RENTANG) =>
  app.inject({ method: 'GET', url: `/reports/inventory/oversells?${q}`, headers: hdr() });

// ---------------------------------------------------------------------------
// Oversell
// ---------------------------------------------------------------------------

test('oversell membawa NAMA produk, bukan hanya id', async () => {
  // Tanpa JOIN katalog barisnya hanya berisi UUID, dan manajer yang harus
  // memutuskan tidak dapat menyelidiki kejadian yang tidak ia kenali barangnya.
  await oversell({ qty: 3000 });
  const res = await periksa();
  assert.equal(res.statusCode, 200, res.body);
  const b = res.json().oversell[0];

  assert.equal(b.itemName, 'Kopi Susu');
  assert.equal(b.variationName, 'Reguler');
  assert.notEqual(b.itemName, b.variationId);
});

test('⛔ kuantitas keluar sebagai STRING, presisi utuh', async () => {
  await oversell({ qty: '9007199254740993' });
  const b = (await periksa()).json().oversell[0];
  assert.equal(typeof b.quantityOver, 'string');
  assert.equal(b.quantityOver, '9007199254740993');
});

test('perangkat dan order yang terlibat ikut', async () => {
  await oversell({});
  const b = (await periksa()).json().oversell[0];
  assert.equal(Array.isArray(b.devicesInvolved), true);
  assert.equal(b.devicesInvolved[0], device);
  assert.equal(b.ordersInvolved.length, 1);
});

test('⛔ yang sudah DITINDAKLANJUTI disembunyikan secara bawaan', async () => {
  await oversell({ selesai: true });
  await oversell({ selesai: false });

  const bawaan = (await periksa()).json().oversell;
  assert.equal(bawaan.length, 1, 'yang sudah selesai ikut muncul');
  assert.equal(bawaan[0].resolvedAt, null);

  const semua = (await periksa(`${RENTANG}&include_resolved=true`)).json().oversell;
  assert.equal(semua.length, 2);
});

test('yang sudah ditindaklanjuti membawa NAMA penyelesainya', async () => {
  await oversell({ selesai: true });
  const b = (await periksa(`${RENTANG}&include_resolved=true`)).json().oversell[0];
  assert.equal(b.resolvedByNama, base.user.name);
  assert.notEqual(b.resolutionNote, null);
});

test('⛔ rentang oversell memakai detected_at, bukan tanggal bisnis', async () => {
  // Oversell lahir saat perangkat KEDUA tersinkronisasi, dan itu dapat
  // berhari-hari setelah penjualannya. Memakai tanggal bisnis membuat
  // kejadian yang baru ketahuan hari ini tersembunyi di rentang minggu lalu.
  await oversell({ hari: 0 });
  const hariIni = new Date().toISOString().slice(0, 10);
  const res = await periksa(`from=${hariIni}&to=${hariIni}`);
  assert.equal(res.json().oversell.length, 1, 'oversell hari ini tidak terjaring');
});

test('varian yang katalognya tidak terlihat tetap muncul', async () => {
  // `oversell_event.variation_id` tidak punya FK. Baris yang katalognya hilang
  // tetap harus terlihat — ia justru yang paling perlu diselidiki.
  await oversell({ variationId: crypto.randomUUID() });
  const b = (await periksa()).json().oversell[0];
  assert.notEqual(b.itemName, null);
  assert.equal(b.variationName, '—');
});

// ---------------------------------------------------------------------------
// Selisih kas
// ---------------------------------------------------------------------------

test('selisih kas ikut di respons yang sama', async () => {
  await shiftTertutup({ selisih: -50000 });
  const b = (await periksa()).json();
  assert.equal(b.selisihKas.length, 1);
  assert.equal(b.selisihKas[0].difference, '-50000');
  assert.equal(b.selisihKas[0].openedByNama, base.user.name);
});

test('⛔ shift yang selisihnya NOL tidak muncul', async () => {
  // Shift yang cocok bukan "perlu diperiksa". Mengirimnya lalu
  // menyembunyikannya di layar membuat ringkasan tidak dapat dipercaya.
  await shiftTertutup({ selisih: 0 });
  assert.deepEqual((await periksa()).json().selisihKas, []);
});

test('⛔ shift yang BELUM ditutup tidak muncul', async () => {
  // `difference` NULL berarti belum ada hitungan fisik — bukan selisih nol.
  await shiftTerbuka();
  assert.deepEqual((await periksa()).json().selisihKas, []);
});

test('selisih LEBIH juga muncul, bukan hanya kurang', async () => {
  await shiftTertutup({ selisih: 30000 });
  const b = (await periksa()).json().selisihKas;
  assert.equal(b.length, 1);
  assert.equal(b[0].difference, '30000');
});

// ---------------------------------------------------------------------------
// Akses
// ---------------------------------------------------------------------------

test('⛔ isolasi tenant: kejadian tenant lain tidak pernah muncul', async () => {
  await oversell({});
  await shiftTertutup({});
  const lain = await seedTenantBase(db, { suffix: 'PeriksaLain' });

  const res = await app.inject({
    method: 'GET',
    url: `/reports/inventory/oversells?${RENTANG}`,
    headers: {
      'x-tenant-id': lain.tenant.id,
      authorization: lain.authHeader,
      'x-actor-id': lain.user.id,
    },
  });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(res.json().oversell, []);
  assert.deepEqual(res.json().selisihKas, []);
});

test('⛔ outlet tenant lain ditolak 404', async () => {
  const lain = await seedTenantBase(db, { suffix: 'PeriksaOutletLain' });
  const res = await periksa(`${RENTANG}&outlet_id=${lain.outlet.id}`);
  assert.equal(res.statusCode, 404, res.body);
});

test('⛔ tanpa sesi ditolak 401', async () => {
  const res = await app.inject({
    method: 'GET',
    url: `/reports/inventory/oversells?${RENTANG}`,
    headers: { 'x-tenant-id': tenant.id },
  });
  assert.equal(res.statusCode, 401, res.body);
});

test('rentang tak sah ditolak 400', async () => {
  const res = await periksa('from=2026-08-12&to=2026-08-10');
  assert.equal(res.statusCode, 400, res.body);
});

test('rentang kosong mengembalikan dua daftar kosong, bukan error', async () => {
  const res = await periksa('from=2026-01-01&to=2026-01-31');
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(res.json().oversell, []);
  assert.deepEqual(res.json().selisihKas, []);
});

test('⛔ TANPA bahasa menuduh — oversell adalah non-goal, bukan kesalahan', async () => {
  // `spec-e:177` dan PRD menyebut pencegahan oversell offline sebagai non-goal
  // PERMANEN: dua perangkat yang menjual barang terakhir sama-sama benar.
  // Respons yang menyebutnya "pelanggaran" menuduh orang atas konsekuensi
  // teorema CAP.
  await oversell({});
  const res = await periksa();
  assert.doesNotMatch(
    res.body,
    /curiga|suspicious|fraud|penipuan|pelanggar|kesalahan|salah|nakal/i,
    res.body
  );
});
