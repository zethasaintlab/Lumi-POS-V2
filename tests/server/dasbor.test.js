'use strict';

// B-01 — dasbor beranda.
//
// ⛔ Test terpenting di berkas ini membandingkan dasbor dengan LAPORAN, bukan
// dengan angka yang saya tulis sendiri. Dasbor adalah layar yang pertama
// dilihat merchant setiap pagi dan yang paling jarang diperiksa ulang; angka
// di sana yang berbeda dari laporan akan dipercaya lebih dulu.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');

let owner, db, app, base, tenant, outletId, device, shift, varA, varB, varJasa;

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

const hdr = () => ({
  'x-tenant-id': tenant.id,
  authorization: base.authHeader,
  'x-actor-id': base.user.id,
  'content-type': 'application/json',
});

beforeEach(async () => {
  await db.query('ROLLBACK').catch(() => {});
  await resetAll(owner);
  base = await seedTenantBase(db, { suffix: 'Dasbor' });
  tenant = base.tenant;
  outletId = base.outlet.id;

  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();

  device = crypto.randomUUID();
  shift = crypto.randomUUID();
  varA = crypto.randomUUID();
  varB = crypto.randomUUID();
  varJasa = crypto.randomUUID();

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
  for (const [varId, item, lacak] of [
    [varA, 'Kopi Susu', true],
    [varB, 'Teh Tarik', true],
    [varJasa, 'Jasa Antar', false],
  ]) {
    const itemId = crypto.randomUUID();
    await db.query(`INSERT INTO item (id, tenant_id, name) VALUES ($1,$2,$3)`, [itemId, tenant.id, item]);
    await db.query(
      `INSERT INTO item_variation (id, tenant_id, item_id, name, price, track_stock)
       VALUES ($1,$2,$3,'Reguler',25000,$4)`,
      [varId, tenant.id, itemId, lacak]
    );
  }
  await db.query('COMMIT');
});

let seq = 0;

async function jual({ variationId, qtyMilli = 1000, total = 25000, tanggal = '2026-08-10' } = {}) {
  seq += 1;
  const id = crypto.randomUUID();
  const checkId = crypto.randomUUID();
  await db.query('BEGIN');
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await db.query(
    `INSERT INTO "order" (id,tenant_id,outlet_id,device_id,shift_id,receipt_number,business_date,sequence,
       status,channel,subtotal,tax_amount,total,amount_due,created_by,occurred_at,hlc)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::int,'closed','takeaway',$9,0,$9,$9,$10,
             ($7::date + time '10:00') AT TIME ZONE 'UTC',$8::bigint)`,
    [id, tenant.id, outletId, device, shift, `K1-${seq}`, tanggal, seq, total, base.user.id]
  );
  await db.query(
    `INSERT INTO "check" (id,tenant_id,order_id,subtotal,total) VALUES ($1,$2,$3,$4,$4)`,
    [checkId, tenant.id, id, total]
  );
  await db.query(
    `INSERT INTO order_line (id,tenant_id,outlet_id,device_id,order_id,check_id,variation_id,item_name,
       variation_name,unit_price,quantity,line_total,created_by,occurred_at,hlc,
       variation_count_at_sale)
     VALUES ($1,$2,$3,$4,$5,$6,$7,
             (SELECT i.name FROM item i JOIN item_variation iv ON iv.item_id = i.id WHERE iv.id = $7),
             'Reguler',$8,$9::bigint,$10,$11,($12::date + time '10:00') AT TIME ZONE 'UTC',$13::bigint,1)`,
    [crypto.randomUUID(), tenant.id, outletId, device, id, checkId, variationId,
     total, qtyMilli, total, base.user.id, tanggal, seq]
  );
  await db.query('COMMIT');
  return id;
}

async function gerakStok(variationId, delta) {
  await db.query('BEGIN');
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await db.query(
    `INSERT INTO stock_movement (id, tenant_id, outlet_id, variation_id, type, delta, created_by, occurred_at, hlc)
     VALUES ($1,$2,$3,$4,'receipt',$5,$6, now(), 1)`,
    [crypto.randomUUID(), tenant.id, outletId, variationId, delta, base.user.id]
  );
  await db.query('COMMIT');
}

const RENTANG = 'from=2026-08-01&to=2026-08-31';
const dasbor = (q = RENTANG) =>
  app.inject({ method: 'GET', url: `/reports/dashboard/summary?${q}`, headers: hdr() });

// ---------------------------------------------------------------------------
// ⛔ Angkanya SAMA dengan laporan
// ---------------------------------------------------------------------------

test('⛔ omzet dasbor SAMA PERSIS dengan GET /reports/sales', async () => {
  // Dibandingkan dengan laporan, bukan dengan angka yang saya tulis sendiri.
  // Kalau keduanya dihitung dua fungsi berbeda, test ini yang menangkapnya —
  // dan itu satu-satunya cara menangkapnya sebelum merchant yang melakukannya.
  await jual({ variationId: varA, total: 125000 });
  await jual({ variationId: varB, total: 87000 });

  const d = (await dasbor()).json();
  const laporan = (
    await app.inject({ method: 'GET', url: `/reports/sales?${RENTANG}`, headers: hdr() })
  ).json();

  assert.deepEqual(d.penjualan, laporan.penjualan);
});

test('⛔ produk terlaris SAMA dengan GET /reports/products, hanya dipotong 5', async () => {
  for (let i = 0; i < 3; i += 1) await jual({ variationId: varA, qtyMilli: 2000 });
  await jual({ variationId: varB, qtyMilli: 1000 });

  const d = (await dasbor()).json();
  const laporan = (
    await app.inject({ method: 'GET', url: `/reports/products?${RENTANG}`, headers: hdr() })
  ).json();

  assert.deepEqual(
    d.terlaris.map((t) => [t.variationId, t.kuantitas]),
    laporan.produk.slice(0, 5).map((t) => [t.variationId, t.kuantitas])
  );
});

test('⛔ terlaris dibatasi 5, terurut kuantitas menurun', async () => {
  // Tujuh varian supaya batasnya benar-benar terpakai.
  const tambahan = [];
  await db.query('BEGIN');
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  for (let i = 0; i < 5; i += 1) {
    const itemId = crypto.randomUUID();
    const vId = crypto.randomUUID();
    await db.query(`INSERT INTO item (id, tenant_id, name) VALUES ($1,$2,$3)`, [itemId, tenant.id, `Produk ${i}`]);
    await db.query(
      `INSERT INTO item_variation (id, tenant_id, item_id, name, price) VALUES ($1,$2,$3,'Reguler',1000)`,
      [vId, tenant.id, itemId]
    );
    tambahan.push(vId);
  }
  await db.query('COMMIT');

  // Kuantitas menaik supaya urutannya jelas.
  let qty = 1000;
  for (const v of [varA, varB, ...tambahan]) {
    qty += 1000;
    await jual({ variationId: v, qtyMilli: qty });
  }

  const d = (await dasbor()).json();
  assert.equal(d.terlaris.length, 5, 'batas 5 tidak berlaku');
  const kuantitas = d.terlaris.map((t) => BigInt(t.kuantitas));
  for (let i = 1; i < kuantitas.length; i += 1) {
    assert.ok(kuantitas[i - 1] >= kuantitas[i], 'urutan terlaris tidak menurun');
  }
});

test('⛔ uang dan kuantitas keluar sebagai STRING', async () => {
  await jual({ variationId: varA, total: '9007199254740993' });
  const d = (await dasbor()).json();
  assert.equal(typeof d.penjualan.omzetKotor, 'string');
  assert.equal(d.penjualan.omzetKotor, '9007199254740993');
  assert.equal(typeof d.terlaris[0].kuantitas, 'string');
});

// ---------------------------------------------------------------------------
// Ringkasan stok
// ---------------------------------------------------------------------------

test('ringkasan stok menghitung minus dan habis TERPISAH', async () => {
  // Nol berarti barangnya memang tidak ada — wajar. Minus mustahil secara
  // fisik. Menggabungkannya membuat merchant baru melihat satu angka besar
  // yang tidak dapat ia tindaklanjuti.
  await gerakStok(varA, -3000); // minus
  // varB dibiarkan tanpa movement → habis (0)

  const d = (await dasbor(`${RENTANG}&outlet_id=${outletId}`)).json();
  assert.equal(d.stok.minus, 1);
  assert.ok(d.stok.habis >= 1, 'varian tanpa movement seharusnya terhitung habis');
});

test('⛔ varian yang stoknya TIDAK DILACAK tidak ikut dihitung', async () => {
  // Produk jasa tidak punya stok untuk habis.
  const d = (await dasbor(`${RENTANG}&outlet_id=${outletId}`)).json();
  const idJasa = d.stok.contoh.map((c) => c.variationId);
  assert.ok(!idJasa.includes(varJasa), 'produk jasa muncul di peringatan stok');
});

test('⛔ ringkasan stok NULL bila outlet tidak dipilih', async () => {
  // Stok bersifat per outlet; satu angka gabungan tidak dapat dipakai
  // memutuskan apa pun — kekurangan di satu cabang tertutup kelebihan di
  // cabang lain.
  const d = (await dasbor()).json();
  assert.equal(d.stok, null);
});

test('contoh stok dibatasi lima', async () => {
  const d = (await dasbor(`${RENTANG}&outlet_id=${outletId}`)).json();
  assert.ok(d.stok.contoh.length <= 5);
});

// ---------------------------------------------------------------------------
// Rentang dan akses
// ---------------------------------------------------------------------------

test('rentang menyaring — hari lain tidak ikut', async () => {
  await jual({ variationId: varA, total: 50000, tanggal: '2026-08-10' });
  await jual({ variationId: varA, total: 99000, tanggal: '2026-08-20' });

  const d = (await dasbor('from=2026-08-01&to=2026-08-15')).json();
  assert.equal(d.penjualan.omzetKotor, '50000');
});

test('rentang kosong mengembalikan nol, bukan error', async () => {
  const res = await dasbor('from=2026-01-01&to=2026-01-31');
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().penjualan.jumlahTransaksi, 0);
  assert.deepEqual(res.json().terlaris, []);
});

test('rentang tak sah ditolak 400', async () => {
  const res = await dasbor('from=2026-08-12&to=2026-08-10');
  assert.equal(res.statusCode, 400, res.body);
});

test('⛔ isolasi tenant: dasbor tenant lain kosong', async () => {
  await jual({ variationId: varA, total: 125000 });
  const lain = await seedTenantBase(db, { suffix: 'DasborLain' });

  const res = await app.inject({
    method: 'GET',
    url: `/reports/dashboard/summary?${RENTANG}`,
    headers: {
      'x-tenant-id': lain.tenant.id,
      authorization: lain.authHeader,
      'x-actor-id': lain.user.id,
    },
  });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().penjualan.jumlahTransaksi, 0);
  assert.deepEqual(res.json().terlaris, []);
});

test('⛔ outlet tenant lain ditolak 404', async () => {
  const lain = await seedTenantBase(db, { suffix: 'DasborOutletLain' });
  const res = await dasbor(`${RENTANG}&outlet_id=${lain.outlet.id}`);
  assert.equal(res.statusCode, 404, res.body);
});

test('⛔ tanpa sesi ditolak 401', async () => {
  const res = await app.inject({
    method: 'GET',
    url: `/reports/dashboard/summary?${RENTANG}`,
    headers: { 'x-tenant-id': tenant.id },
  });
  assert.equal(res.statusCode, 401, res.body);
});

// ---------------------------------------------------------------------------
// FR-H8 sisi owner — perangkat yang berhenti menyapa (`spec-h:311`)
// ---------------------------------------------------------------------------

/**
 * ⛔ `last_seen_at` disetel RELATIF terhadap jam DATABASE (`now() - interval`),
 * bukan terhadap jam Node. Umurnya juga dihitung di database; dua jam berbeda
 * di kedua sisi perbandingan adalah bug yang pernah nyata di repo ini
 * (resolusi harga, 4 dari 12 run gagal karena skew ±2 ms).
 */
async function setelTerlihat(deviceId, interval) {
  await db.query('BEGIN');
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await db.query(
    `UPDATE device SET token_hash = 'x', last_seen_at = now() - $2::interval WHERE id = $1`,
    [deviceId, interval]
  );
  await db.query('COMMIT');
}

async function buatPerangkat(kode) {
  const id = crypto.randomUUID();
  await db.query('BEGIN');
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await db.query(
    `INSERT INTO device (id, tenant_id, outlet_id, code, name, platform, app_version, schema_version)
     VALUES ($1,$2,$3,$4,$4,'tauri','0','1')`,
    [id, tenant.id, outletId, kode]
  );
  await db.query('COMMIT');
  return id;
}

test('⛔ perangkat TANPA kredensial tidak pernah dilaporkan menua', async () => {
  // Ia belum pernah dapat menyapa server. Menandainya "belum terhubung 30
  // hari" adalah memberi tahu owner tentang perangkat yang memang belum
  // dipasang — dan peringatan yang selalu menyala adalah peringatan yang
  // diabaikan.
  await buatPerangkat('K9');
  const res = await dasbor();
  assert.equal(res.statusCode, 200, res.body);
  const p = JSON.parse(res.body).perangkat;
  assert.deepEqual(p.menua, []);
  assert.equal(p.total, 0, 'yang tanpa kredensial tidak ikut dihitung sama sekali');
});

test('perangkat yang baru menyapa tidak muncul', async () => {
  await setelTerlihat(device, '1 hour');
  const p = JSON.parse((await dasbor()).body).perangkat;
  assert.deepEqual(p.menua, []);
  assert.equal(p.total, 1);
  assert.equal(p.belumPernah, 0);
});

test('tangga 4 / 24 / 72 jam berlaku di server juga', async () => {
  const tingkatUntuk = async (interval) => {
    await setelTerlihat(device, interval);
    const p = JSON.parse((await dasbor()).body).perangkat;
    return p.menua[0]?.tingkat ?? 'aman';
  };

  assert.equal(await tingkatUntuk('3 hours'), 'aman');
  assert.equal(await tingkatUntuk('5 hours'), 'peringatan');
  assert.equal(await tingkatUntuk('30 hours'), 'kritis');
  assert.equal(await tingkatUntuk('100 hours'), 'darurat');
});

test('⛔ belum pernah menyapa DIBEDAKAN dari basi', async () => {
  // Keduanya bukan hal yang sama: yang pertama belum dipasang, yang kedua
  // sedang menahan penjualan. Menggabungkannya membuat owner menindaklanjuti
  // hal yang salah.
  const k2 = await buatPerangkat('K2');
  await db.query('BEGIN');
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await db.query(`UPDATE device SET token_hash = 'x' WHERE id = $1`, [k2]);
  await db.query('COMMIT');
  await setelTerlihat(device, '100 hours');

  const p = JSON.parse((await dasbor()).body).perangkat;
  assert.equal(p.total, 2);
  assert.equal(p.belumPernah, 1);
  assert.equal(p.menua.length, 1);
  assert.equal(p.menua[0].code, 'K1');
});

test('yang menua terurut TERLAMA dulu', async () => {
  const k2 = await buatPerangkat('K2');
  const k3 = await buatPerangkat('K3');
  await setelTerlihat(device, '5 hours');
  await setelTerlihat(k2, '200 hours');
  await setelTerlihat(k3, '30 hours');

  const p = JSON.parse((await dasbor()).body).perangkat;
  assert.deepEqual(
    p.menua.map((d) => d.code),
    ['K2', 'K3', 'K1'],
    'yang paling lama diam adalah yang paling lama tidak mencatat penjualan'
  );
});

test('⛔ isolasi tenant: perangkat tenant lain tidak muncul', async () => {
  await setelTerlihat(device, '100 hours');
  const lain = await seedTenantBase(db, { suffix: 'DasborLain' });
  const res = await app.inject({
    method: 'GET',
    url: `/reports/dashboard/summary?${RENTANG}`,
    headers: {
      'x-tenant-id': lain.tenant.id,
      authorization: lain.authHeader,
      'x-actor-id': lain.user.id,
    },
  });
  assert.equal(res.statusCode, 200, res.body);
  const p = JSON.parse(res.body).perangkat;
  assert.deepEqual(p.menua, []);
  assert.equal(p.total, 0);
});
