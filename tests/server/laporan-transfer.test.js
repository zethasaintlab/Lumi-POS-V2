'use strict';

// ⛔ G-LAPORAN-TRF — Transfer (`other` + `bank_transfer`) tampil "Transfer" di
// SETIAP laporan per metode, tidak pernah "Lainnya" (syarat user P1, 28
// September 2026: "uang bank tidak boleh tersembunyi dari pemilik").
//
// Satu fixture, satu shift/tanggal/outlet: tunai + QRIS statis + transfer +
// satu `other` TANPA provider. Yang terakhir membuktikan lipatnya hanya untuk
// `bank_transfer`, bukan untuk seluruh `other`.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');

let owner, appSetup, app, base, tenant, device, shift;
let transaksiTransferId;

const TANGGAL = '2026-08-10';
const RENTANG = `from=${TANGGAL}&to=${TANGGAL}`;
const NILAI = { cash: 100000, qris_static: 50000, transfer: 70000, other: 30000 };

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

let n = 0;

async function jual(method, provider, total, mdr = null) {
  const id = crypto.randomUUID();
  n += 1;
  await appSetup.query(
    `INSERT INTO "order" (id,tenant_id,outlet_id,device_id,shift_id,receipt_number,business_date,sequence,
       status,channel,subtotal,order_discount,service_charge_amount,tax_amount,rounding_adjustment,
       total,amount_due,created_by,occurred_at,hlc)
     VALUES ($1,$2,$3,$4,$5,$6,$10::date,$7::int,'closed','takeaway',$8,0,0,0,0,
       $8,$8,$9,'2026-08-10T10:00:00Z',$7::bigint)`,
    [id, tenant.id, base.outlet.id, device, shift, `K1-${n}`, n, total, base.user.id, TANGGAL]
  );
  await appSetup.query(
    `INSERT INTO "check" (id,tenant_id,order_id,subtotal,total) VALUES ($1,$2,$3,0,$4)`,
    [`c-${id}`, tenant.id, id, total]
  );
  await appSetup.query(
    `INSERT INTO order_line (id,tenant_id,outlet_id,device_id,order_id,check_id,variation_id,item_name,
       variation_name,unit_price,quantity,line_total,created_by,occurred_at,hlc,variation_count_at_sale)
     VALUES ($1,$2,$3,$4,$5,$6,'v1','Kopi','Regular',$7,1000,$7,$8,'2026-08-10T10:00:00Z',$9::bigint,1)`,
    [crypto.randomUUID(), tenant.id, base.outlet.id, device, id, `c-${id}`, total, base.user.id, n]
  );
  await appSetup.query(
    `INSERT INTO payment (id,tenant_id,outlet_id,device_id,order_id,check_id,method,provider,amount,status,
       confirmed_manually,occurred_at,tendered_at,hlc,created_by,mdr_estimated)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'confirmed',$10,'2026-08-10T10:00:00Z','2026-08-10T10:00:00Z',$11::bigint,$12,$13)`,
    [crypto.randomUUID(), tenant.id, base.outlet.id, device, id, `c-${id}`, method, provider, total,
     method !== 'cash', n, base.user.id, mdr]
  );
  return id;
}

beforeEach(async () => {
  await appSetup.query('ROLLBACK').catch(() => {});
  await resetAll(owner);
  base = await seedTenantBase(appSetup, { suffix: 'LapTrf' });
  tenant = base.tenant;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();

  device = crypto.randomUUID();
  shift = crypto.randomUUID();
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await appSetup.query(
    `INSERT INTO device (id, tenant_id, outlet_id, code, name, platform, app_version, schema_version)
     VALUES ($1,$2,$3,'K1','K1','tauri','0','1')`,
    [device, tenant.id, base.outlet.id]
  );
  await appSetup.query(
    `INSERT INTO cash_drawer_shift (id, tenant_id, outlet_id, device_id, business_date, status, opening_float, opened_by)
     VALUES ($1,$2,$3,$4,$5,'open',0,$6)`,
    [shift, tenant.id, base.outlet.id, device, TANGGAL, base.user.id]
  );
  await jual('cash', null, NILAI.cash);
  await jual('qris_static', null, NILAI.qris_static);
  transaksiTransferId = await jual('other', 'bank_transfer', NILAI.transfer);
  await jual('other', null, NILAI.other);
  await appSetup.query('COMMIT');
});

const hdr = () => ({
  'x-tenant-id': tenant.id,
  authorization: base.authHeader,
  'x-actor-id': base.user.id,
});
const get = (url) => app.inject({ method: 'GET', url, headers: hdr() });

const JUMLAH_SEMUA = Object.values(NILAI).reduce((a, b) => a + b, 0);

function cari(daftar, kunci, nilai) {
  return daftar.find((x) => x[kunci] === nilai);
}

test('⛔ G-LAPORAN-TRF: laporan pembayaran FR-C12 memuat baris transfer sebesar bagian transfer, terpisah dari other', async () => {
  const res = await get(`/reports/payments?${RENTANG}`);
  assert.equal(res.statusCode, 200, res.body);
  const { metode } = res.json();
  const trf = cari(metode, 'method', 'transfer');
  assert.ok(trf, `tidak ada baris "transfer": ${metode.map((m) => m.method).join(',')}`);
  assert.equal(trf.totalDiterima, String(NILAI.transfer));
  assert.equal(trf.jumlahTransaksi, 1);
  assert.equal(trf.perkiraanMdr, null, 'transfer tidak punya perkiraan MDR');
  const lain = cari(metode, 'method', 'other');
  assert.ok(lain, 'other tanpa provider harus tetap muncul terpisah');
  assert.equal(lain.totalDiterima, String(NILAI.other));
  // Urutan: SUM DESC → cash, transfer, qris_static, other.
  assert.deepEqual(metode.map((m) => m.method), ['cash', 'transfer', 'qris_static', 'other']);
});

test('⛔ ekspor CSV memuat baris pembayaran,transfer,…', async () => {
  const res = await get(`/reports/export?type=payments&${RENTANG}`);
  assert.equal(res.statusCode, 200, res.body);
  const baris = res.body.split(/\r?\n/);
  const trf = baris.find((b) => b.includes('transfer'));
  assert.ok(trf, `CSV tidak memuat transfer:\n${res.body}`);
  assert.match(trf, new RegExp(String(NILAI.transfer)));
  assert.ok(baris.some((b) => /"other"/.test(b) && b.includes(String(NILAI.other))), 'other hilang dari CSV');

  const rekap = await get(`/reports/export?type=recap&${RENTANG}`);
  assert.equal(rekap.statusCode, 200, rekap.body);
  assert.match(rekap.body, /pembayaran","?transfer/i, 'ekspor rekap tidak memuat pembayaran,transfer');
});

test('⛔ ringkasan HP M-01: perMetode memuat transfer', async () => {
  const res = await get(`/reports/daily-summary?date=${TANGGAL}`);
  assert.equal(res.statusCode, 200, res.body);
  const trf = cari(res.json().perMetode, 'metode', 'transfer');
  assert.ok(trf, 'M-01 tidak memuat transfer');
  assert.equal(trf.total, String(NILAI.transfer));
});

test('⛔ detail shift: perMetode memuat transfer dan kelompok other terpisah', async () => {
  const res = await get(`/reports/shifts/${shift}`);
  assert.equal(res.statusCode, 200, res.body);
  const { perMetode } = res.json();
  const trf = cari(perMetode, 'method', 'transfer');
  assert.ok(trf, `detail shift tidak memuat transfer: ${perMetode.map((m) => m.method).join(',')}`);
  assert.equal(trf.total, String(NILAI.transfer));
  const lain = cari(perMetode, 'method', 'other');
  assert.ok(lain, 'kelompok other (tanpa provider) hilang dari detail shift');
  assert.equal(lain.total, String(NILAI.other));
});

test('⛔ detail transaksi B-04 membawa provider bank_transfer', async () => {
  const res = await get(`/reports/transactions/${transaksiTransferId}`);
  assert.equal(res.statusCode, 200, res.body);
  const [p] = res.json().payments;
  assert.equal(p.method, 'other');
  assert.equal(p.provider, 'bank_transfer');
});

test('⛔ property: di setiap laporan, jumlah seluruh baris metode = SUM pembayaran confirmed', async () => {
  const pay = (await get(`/reports/payments?${RENTANG}`)).json();
  assert.equal(
    pay.metode.reduce((t, m) => t + BigInt(m.totalDiterima), 0n),
    BigInt(JUMLAH_SEMUA),
    'laporan pembayaran kehilangan uang'
  );
  assert.equal(pay.totalDiterima, String(JUMLAH_SEMUA));

  const hp = (await get(`/reports/daily-summary?date=${TANGGAL}`)).json();
  assert.equal(hp.perMetode.reduce((t, m) => t + BigInt(m.total), 0n), BigInt(JUMLAH_SEMUA), 'M-01 kehilangan uang');

  const sh = (await get(`/reports/shifts/${shift}`)).json();
  assert.equal(sh.perMetode.reduce((t, m) => t + BigInt(m.total), 0n), BigInt(JUMLAH_SEMUA), 'detail shift kehilangan uang');
  assert.equal(sh.totalDiterima, String(JUMLAH_SEMUA));
});

test('⛔ dua grup SQL yang terlipat ke SATU kode dijumlahkan, bukan salah satunya dibuang', async () => {
  // qris_dynamic dengan provider 'midtrans' dan NULL = dua grup GROUP BY
  // (method, provider) yang kodenya sama setelah dilipat.
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await jual('qris_dynamic', 'midtrans', 20000, 350);
  await jual('qris_dynamic', null, 30000, null);
  await appSetup.query('COMMIT');

  const res = await get(`/reports/payments?${RENTANG}`);
  assert.equal(res.statusCode, 200, res.body);
  const { metode, totalDiterima, totalPerkiraanMdr } = res.json();
  const qd = metode.filter((m) => m.method === 'qris_dynamic');
  assert.equal(qd.length, 1, `qris_dynamic muncul ${qd.length} baris, harus satu`);
  assert.equal(qd[0].jumlahTransaksi, 2, 'jumlah transaksi grup terlipat');
  assert.equal(qd[0].totalDiterima, '50000', 'total grup terlipat');
  assert.equal(qd[0].perkiraanMdr, '350', 'mdr grup terlipat');
  assert.equal(qd[0].tanpaPerkiraan, 1, 'tanpa_mdr grup terlipat');
  assert.equal(totalDiterima, String(JUMLAH_SEMUA + 50000));
  // Property yang sama dengan di atas, kini pada data yang MELIPAT dua grup SQL.
  assert.equal(
    metode.reduce((t, m) => t + BigInt(m.totalDiterima), 0n),
    BigInt(JUMLAH_SEMUA + 50000),
    'jumlah baris metode ≠ SUM pembayaran ketika dua grup terlipat'
  );
  assert.equal(totalPerkiraanMdr, '350');
  // Urutan: total DESC, seri diurutkan kode: qris_dynamic sebelum qris_static.
  assert.deepEqual(
    metode.map((m) => m.method),
    ['cash', 'transfer', 'qris_dynamic', 'qris_static', 'other']
  );
});
