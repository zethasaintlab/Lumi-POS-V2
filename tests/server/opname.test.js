'use strict';

// B-14 — stock opname (FR-E7).
//
// ⛔ Test yang paling penting di berkas ini adalah "penjualan SELAMA opname
// tidak terhapus". Ia menguji satu klausa SQL — `occurred_at <= snapshot_at` —
// dan tanpa klausa itu opname akan mengembalikan barang yang benar-benar sudah
// keluar dari rak, tanpa satu pun error.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');

let owner, db, app, base, tenant, outletId, device, shift, varId, varLain;

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
  base = await seedTenantBase(db, { suffix: 'Opname' });
  tenant = base.tenant;
  outletId = base.outlet.id;

  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();

  device = crypto.randomUUID();
  shift = crypto.randomUUID();
  varId = crypto.randomUUID();
  varLain = crypto.randomUUID();
  const itemId = crypto.randomUUID();

  await db.query('BEGIN');
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await db.query(
    `INSERT INTO device (id, tenant_id, outlet_id, code, name, platform, app_version, schema_version)
     VALUES ($1,$2,$3,'K1','K1','tauri','0','1')`,
    [device, tenant.id, outletId]
  );
  await db.query(
    `INSERT INTO cash_drawer_shift (id, tenant_id, outlet_id, device_id, business_date, status, opening_float, opened_by)
     VALUES ($1,$2,$3,$4,'2026-08-10','open',0,$5)`,
    [shift, tenant.id, outletId, device, base.user.id]
  );
  await db.query(`INSERT INTO item (id, tenant_id, name) VALUES ($1,$2,'Kopi Susu')`, [itemId, tenant.id]);
  for (const [id, nama] of [[varId, 'Reguler'], [varLain, 'Large']]) {
    await db.query(
      `INSERT INTO item_variation (id, tenant_id, item_id, name, price, track_stock)
       VALUES ($1,$2,$3,$4,25000,true)`,
      [id, tenant.id, itemId, nama]
    );
  }
  await db.query('COMMIT');
});

/** Movement langsung — alat untuk menyiapkan saldo. `mundurDetik` menua occurred_at. */
async function gerak({ variationId = null, delta = 10000, tipe = 'receipt', mundurDetik = 0 } = {}) {
  await db.query('BEGIN');
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await db.query(
    `INSERT INTO stock_movement (id, tenant_id, outlet_id, variation_id, type, delta, created_by, occurred_at, hlc)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now() - ($8 || ' seconds')::interval, 1)`,
    [crypto.randomUUID(), tenant.id, outletId, variationId ?? varId, tipe, delta, base.user.id, String(mundurDetik)]
  );
  await db.query('COMMIT');
}

async function saldo(variationId = varId) {
  await db.query('BEGIN');
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  const r = await db.query(
    `SELECT COALESCE(SUM(delta),0)::text s FROM stock_movement
      WHERE outlet_id = $1 AND variation_id = $2`,
    [outletId, variationId]
  );
  await db.query('COMMIT');
  return r.rows[0].s;
}

const mulai = (ubah = {}) =>
  app.inject({ method: 'POST', url: '/inventory/stocktakes', headers: hdr(ubah), payload: { outletId } });

const simpan = (id, lines, ubah = {}) =>
  app.inject({
    method: 'PUT',
    url: `/inventory/stocktakes/${id}/lines`,
    headers: hdr(ubah),
    payload: { lines },
  });

const selesai = (id, ubah = {}) =>
  app.inject({
    method: 'POST',
    url: `/inventory/stocktakes/${id}/complete`,
    headers: {
      'x-tenant-id': tenant.id,
      authorization: base.authHeader,
      'x-actor-id': base.user.id,
      ...ubah,
    },
  });

// ---------------------------------------------------------------------------
// ⛔ Aturan inti: snapshot waktu T
// ---------------------------------------------------------------------------

test('⛔ PENJUALAN SELAMA OPNAME TIDAK TERHAPUS (AC FR-E7)', async () => {
  // Skenario dari catatan kepala handler, dijalankan utuh:
  //   stok sistem 10 · hitung fisik 8 (susut 2) · 3 terjual sambil menghitung
  //   → stok akhir HARUS 5, bukan 8.
  //
  // Kalau selisih dihitung terhadap stok SAAT PENYELESAIAN (7), deltanya
  // menjadi +1 dan opname MENAMBAH barang yang tidak ada.
  await gerak({ delta: 10000, mundurDetik: 60 }); // stok 10, sebelum T
  const id = (await mulai()).json().id;

  // Petugas menghitung fisik 8.
  await simpan(id, [{ variationId: varId, countedQty: '8000' }]);

  // Sambil menghitung, 3 terjual — SETELAH T.
  await gerak({ delta: -3000, tipe: 'sale' });
  assert.equal(await saldo(), '7000', 'prasyarat: stok sistem 7 sebelum penyelesaian');

  const res = await selesai(id);
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().movementDitulis, 1);

  // 8 dihitung − 10 pada T = −2. Stok akhir 7 − 2 = 5.
  assert.equal(await saldo(), '5000', 'penjualan selama opname terhapus');
});

test('⛔ movement bertipe stocktake, BUKAN adjustment', async () => {
  // FR-E7 menyebutnya eksplisit, dan `adjustment` wajib beralasan (AC FR-E2)
  // sementara hasil opname tidak selalu punya satu.
  await gerak({ delta: 10000, mundurDetik: 60 });
  const id = (await mulai()).json().id;
  await simpan(id, [{ variationId: varId, countedQty: '8000' }]);
  await selesai(id);

  await db.query('BEGIN');
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  const r = await db.query(
    `SELECT type, delta::text d, stocktake_id FROM stock_movement
      WHERE variation_id = $1 AND type <> 'receipt'`,
    [varId]
  );
  await db.query('COMMIT');

  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].type, 'stocktake');
  assert.equal(r.rows[0].d, '-2000');
  // ⛔ Tertelusur ke opnamenya. Kolomnya ada sejak migrasi 0010 dan tidak
  // pernah diisi sampai sekarang.
  assert.equal(r.rows[0].stocktake_id, id);
});

test('baris yang COCOK tidak menghasilkan movement', async () => {
  await gerak({ delta: 10000, mundurDetik: 60 });
  const id = (await mulai()).json().id;
  await simpan(id, [{ variationId: varId, countedQty: '10000' }]);

  const b = (await selesai(id)).json();
  assert.equal(b.jumlahBaris, 1);
  assert.equal(b.jumlahBerselisih, 0);
  assert.equal(b.movementDitulis, 0);
  assert.equal(await saldo(), '10000');
});

test('selisih LEBIH juga dicatat, bukan hanya kurang', async () => {
  await gerak({ delta: 10000, mundurDetik: 60 });
  const id = (await mulai()).json().id;
  await simpan(id, [{ variationId: varId, countedQty: '12000' }]);
  await selesai(id);
  assert.equal(await saldo(), '12000');
});

test('varian tanpa movement sama sekali: expected 0', async () => {
  const id = (await mulai()).json().id;
  const b = (await simpan(id, [{ variationId: varId, countedQty: '4000' }])).json();
  assert.equal(b.lines[0].expectedQty, '0');
  await selesai(id);
  assert.equal(await saldo(), '4000');
});

// ---------------------------------------------------------------------------
// Siklus hidup
// ---------------------------------------------------------------------------

test('⛔ opname dapat DIJEDA dan dilanjutkan tanpa kehilangan data (AC FR-E7)', async () => {
  await gerak({ delta: 10000, mundurDetik: 60 });
  const id = (await mulai()).json().id;

  await simpan(id, [{ variationId: varId, countedQty: '8000' }]);
  // Koreksi: petugas menghitung ulang.
  await simpan(id, [{ variationId: varId, countedQty: '9000' }]);

  const d = (await app.inject({ method: 'GET', url: `/inventory/stocktakes/${id}`, headers: hdr() })).json();
  assert.equal(d.lines.length, 1, 'penyimpanan ulang menghasilkan baris ganda');
  assert.equal(d.lines[0].countedQty, '9000');
});

test('⛔ expected_qty TIDAK bergerak walau stok berubah setelah T', async () => {
  // ⛔ Test ini menguji PENYARING SNAPSHOT, bukan klausa `ON CONFLICT`.
  //
  // Sabotase membuktikannya: menambahkan `expected_qty = EXCLUDED.expected_qty`
  // ke `DO UPDATE` TIDAK menjatuhkan satu test pun — karena `saldoPadaT`
  // menghitung ulang dengan penyaring yang sama, dan hasilnya identik.
  //
  // Yang benar-benar menjaga waktu T adalah `occurred_at <= snapshot_at`.
  // Komentar di handler sempat mengklaim sebaliknya; klaim itu dikoreksi.
  await gerak({ delta: 10000, mundurDetik: 60 });
  const id = (await mulai()).json().id;
  await simpan(id, [{ variationId: varId, countedQty: '8000' }]);

  // Stok berubah SETELAH T, lalu petugas menyimpan ulang.
  await gerak({ delta: -5000, tipe: 'sale' });
  await simpan(id, [{ variationId: varId, countedQty: '8000' }]);

  const d = (await app.inject({ method: 'GET', url: `/inventory/stocktakes/${id}`, headers: hdr() })).json();
  assert.equal(d.lines[0].expectedQty, '10000', 'snapshot waktu T bergeser');
});

test('beberapa varian dalam satu opname', async () => {
  await gerak({ variationId: varId, delta: 10000, mundurDetik: 60 });
  await gerak({ variationId: varLain, delta: 5000, mundurDetik: 60 });
  const id = (await mulai()).json().id;
  await simpan(id, [
    { variationId: varId, countedQty: '9000' },
    { variationId: varLain, countedQty: '5000' },
  ]);

  const b = (await selesai(id)).json();
  assert.equal(b.jumlahBaris, 2);
  assert.equal(b.jumlahBerselisih, 1, 'hanya yang berselisih dihitung');
  assert.equal(await saldo(varId), '9000');
  assert.equal(await saldo(varLain), '5000');
});

test('⛔ opname yang sudah selesai tidak dapat diubah maupun diselesaikan ulang', async () => {
  await gerak({ delta: 10000, mundurDetik: 60 });
  const id = (await mulai()).json().id;
  await simpan(id, [{ variationId: varId, countedQty: '8000' }]);
  assert.equal((await selesai(id)).statusCode, 200);

  assert.equal((await selesai(id)).statusCode, 409, 'penyelesaian kedua diterima');
  assert.equal((await simpan(id, [{ variationId: varId, countedQty: '1000' }])).statusCode, 409);
  // Dan stoknya tidak bergerak lagi.
  assert.equal(await saldo(), '8000');
});

test('riwayat opname memuat ringkasan dan NAMA pemulainya', async () => {
  await gerak({ delta: 10000, mundurDetik: 60 });
  const id = (await mulai()).json().id;
  await simpan(id, [{ variationId: varId, countedQty: '8000' }]);
  await selesai(id);

  const daftar = (await app.inject({ method: 'GET', url: '/inventory/stocktakes', headers: hdr() })).json();
  assert.equal(daftar.items.length, 1);
  const it = daftar.items[0];
  assert.equal(it.status, 'approved');
  assert.equal(it.startedByNama, base.user.name);
  assert.equal(it.jumlahDihitung, 1);
  assert.equal(it.jumlahBerselisih, 1);
});

test('rincian membawa nama produk dan selisih per baris', async () => {
  await gerak({ delta: 10000, mundurDetik: 60 });
  const id = (await mulai()).json().id;
  await simpan(id, [{ variationId: varId, countedQty: '8000' }]);

  const d = (await app.inject({ method: 'GET', url: `/inventory/stocktakes/${id}`, headers: hdr() })).json();
  assert.equal(d.lines[0].itemName, 'Kopi Susu');
  assert.equal(d.lines[0].variationName, 'Reguler');
  assert.equal(d.lines[0].selisih, '-2000');
});

// ---------------------------------------------------------------------------
// Validasi dan akses
// ---------------------------------------------------------------------------

test('hitungan fisik NEGATIF ditolak — rak tidak berisi barang minus', async () => {
  const id = (await mulai()).json().id;
  const res = await simpan(id, [{ variationId: varId, countedQty: '-1' }]);
  assert.equal(res.statusCode, 400, res.body);
});

test('⛔ variation tenant lain ditolak — kolomnya tidak punya FK', async () => {
  const lain = await seedTenantBase(db, { suffix: 'OpnameLain' });
  const varAsing = crypto.randomUUID();
  const itemAsing = crypto.randomUUID();
  await db.query('BEGIN');
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [lain.tenant.id]);
  await db.query(`INSERT INTO item (id, tenant_id, name) VALUES ($1,$2,'Asing')`, [itemAsing, lain.tenant.id]);
  await db.query(
    `INSERT INTO item_variation (id, tenant_id, item_id, name, price) VALUES ($1,$2,$3,'R',1000)`,
    [varAsing, lain.tenant.id, itemAsing]
  );
  await db.query('COMMIT');

  const id = (await mulai()).json().id;
  const res = await simpan(id, [{ variationId: varAsing, countedQty: '1000' }]);
  assert.equal(res.statusCode, 404, res.body);
});

test('⛔ kasir tidak dapat memulai maupun menyelesaikan opname', async () => {
  const id = (await mulai()).json().id;
  await db.query('BEGIN');
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await db.query(`DELETE FROM user_role WHERE user_id = $1 AND role <> 'cashier'`, [base.user.id]);
  await db.query('COMMIT');

  assert.equal((await mulai()).statusCode, 403);
  assert.equal((await simpan(id, [{ variationId: varId, countedQty: '1' }])).statusCode, 403);
  assert.equal((await selesai(id)).statusCode, 403);
});

test('⛔ opname tenant lain menjawab 404', async () => {
  const id = (await mulai()).json().id;
  const lain = await seedTenantBase(db, { suffix: 'OpnameTenantLain' });
  const res = await app.inject({
    method: 'GET',
    url: `/inventory/stocktakes/${id}`,
    headers: {
      'x-tenant-id': lain.tenant.id,
      authorization: lain.authHeader,
      'x-actor-id': lain.user.id,
    },
  });
  assert.equal(res.statusCode, 404, res.body);
});

test('outlet tenant lain ditolak saat memulai', async () => {
  const lain = await seedTenantBase(db, { suffix: 'OpnameOutletLain' });
  const res = await app.inject({
    method: 'POST',
    url: '/inventory/stocktakes',
    headers: hdr(),
    payload: { outletId: lain.outlet.id },
  });
  assert.equal(res.statusCode, 404, res.body);
});

test('lines kosong ditolak', async () => {
  const id = (await mulai()).json().id;
  assert.equal((await simpan(id, [])).statusCode, 400);
});
