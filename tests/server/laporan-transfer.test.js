'use strict';

// ⛔ G-LAPORAN-TRF — Transfer tampil sebagai "Transfer" di SETIAP laporan per
// metode, tidak pernah "Lainnya", dan tidak ada uang yang hilang dari
// pengelompokan.
//
// ## Kenapa penjaga ini ada
//
// Transfer disimpan sebagai `method = 'other'` + `provider = 'bank_transfer'`
// (tanpa migrasi, keputusan user P1). Syaratnya, kata user: *"laporan per
// metode dan rekonsiliasi FR-C12 mengelompokkan menurut `provider` dan
// menampilkan 'Transfer', tidak pernah 'Lainnya'. Uang bank tidak boleh
// tersembunyi dari pemilik."*
//
// Kegagalannya senyap: query yang lupa membawa `provider` tetap mengembalikan
// baris sah — hanya saja uang transfer terlipat ke `other` bersama `other`
// tanpa provider, dan pemilik yang mencocokkan mutasi rekening tidak
// menemukan baris yang dicarinya. Kelas "nol baris, bukan error"
// (`docs/verifikasi/KELAS-GAGAL.md`).
//
// Satu fixture untuk semua laporan: tunai + QRIS statis + DUA transfer + satu
// `other` TANPA provider + payment yang belum terkonfirmasi (harus diabaikan),
// di satu shift/tanggal/outlet.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');

let owner, appSetup, app, base, tenant, device, shift, ordTransfer;

const RENTANG = 'from=2026-08-10&to=2026-08-10';

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

async function jual({ total, method, provider = null, status = 'confirmed', manual = false }) {
  const id = crypto.randomUUID();
  n += 1;
  await appSetup.query(
    `INSERT INTO "order" (id,tenant_id,outlet_id,device_id,shift_id,receipt_number,business_date,sequence,
       status,channel,subtotal,order_discount,service_charge_amount,tax_amount,rounding_adjustment,
       total,amount_due,created_by,occurred_at,hlc)
     VALUES ($1,$2,$3,$4,$5,$6,'2026-08-10',$7::int,'closed','takeaway',$8,0,0,0,0,$8,$8,$9,'2026-08-10T10:00:00Z',$7::bigint)`,
    [id, tenant.id, base.outlet.id, device, shift, `K1-${n}`, n, total, base.user.id]
  );
  await appSetup.query(
    `INSERT INTO "check" (id,tenant_id,order_id,subtotal,total) VALUES ($1,$2,$3,0,$4)`,
    [`c-${id}`, tenant.id, id, total]
  );
  await appSetup.query(
    `INSERT INTO payment (id,tenant_id,outlet_id,device_id,order_id,check_id,method,provider,amount,status,
       confirmed_manually,occurred_at,tendered_at,hlc,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'2026-08-10T10:00:00Z','2026-08-10T10:00:00Z',$12::bigint,$13)`,
    [crypto.randomUUID(), tenant.id, base.outlet.id, device, id, `c-${id}`, method, provider, total, status, manual, n, base.user.id]
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
     VALUES ($1,$2,$3,$4,'2026-08-10','open',0,$5)`,
    [shift, tenant.id, base.outlet.id, device, base.user.id]
  );
  await jual({ total: 30000, method: 'cash' });
  await jual({ total: 20000, method: 'qris_static', manual: true });
  ordTransfer = await jual({ total: 45000, method: 'other', provider: 'bank_transfer', manual: true });
  await jual({ total: 15000, method: 'other', provider: 'bank_transfer', manual: true });
  await jual({ total: 7000, method: 'other', provider: null });
  // Belum terkonfirmasi: TIDAK boleh muncul di laporan mana pun.
  await jual({ total: 5000, method: 'qris_dynamic', status: 'pending_confirmation' });
  await appSetup.query('COMMIT');
});

const hdr = () => ({
  'x-tenant-id': tenant.id,
  authorization: base.authHeader,
  'x-actor-id': base.user.id,
});
const get = (url) => app.inject({ method: 'GET', url, headers: hdr() });

/** SUM(payment confirmed) -- kebenaran dasar yang TIDAK dilewati pengelompokan. */
async function jumlahConfirmed() {
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  const { rows } = await appSetup.query(`SELECT SUM(amount)::text AS t FROM payment WHERE status = 'confirmed'`);
  await appSetup.query('COMMIT');
  return BigInt(rows[0].t);
}

const jumlah = (arr, ambil) => arr.reduce((t, x) => t + BigInt(ambil(x)), 0n);

function barisCsv(csv, awalan) {
  return csv.split('\n').filter((l) => l.startsWith(awalan));
}

// ---------------------------------------------------------------------------

test('⛔ G-LAPORAN-TRF: laporan pembayaran FR-C12 memuat baris transfer sebesar bagian transfer, terpisah dari other', async () => {
  const res = await get(`/reports/payments?${RENTANG}`);
  assert.equal(res.statusCode, 200, res.body);
  const { metode } = res.json();
  const peta = Object.fromEntries(metode.map((m) => [m.method, m]));

  assert.ok(peta.transfer, `FR-C12 tidak memuat baris transfer: ${JSON.stringify(metode.map((m) => m.method))}`);
  assert.equal(peta.transfer.totalDiterima, '60000', 'uang transfer tidak terjumlah utuh');
  assert.equal(peta.transfer.jumlahTransaksi, 2);
  assert.ok(peta.other, 'baris other (tanpa provider) hilang');
  assert.equal(peta.other.totalDiterima, '7000', 'other tercampur dengan transfer -- uang bank tersembunyi di "Lainnya"');
  assert.equal(peta.other.jumlahTransaksi, 1);
  // Transfer bank tidak dipotong MDR: tidak punya perkiraan sama sekali (null, BUKAN "0").
  assert.equal(peta.transfer.perkiraanMdr, null);
  assert.equal(peta.cash.totalDiterima, '30000');
  assert.equal(peta.qris_static.totalDiterima, '20000');
  // Urutan tetap SUM DESC, kode ASC.
  assert.deepEqual(
    metode.map((m) => m.method),
    ['transfer', 'cash', 'qris_static', 'other'],
    'urutan baris berubah'
  );
});

test('⛔ G-LAPORAN-TRF: ekspor CSV memuat baris pembayaran,transfer,… (payments dan recap)', async () => {
  const pay = await get(`/reports/export?type=payments&${RENTANG}`);
  assert.equal(pay.statusCode, 200, pay.body);
  const barisPay = barisCsv(pay.body, '"transfer"');
  assert.equal(barisPay.length, 1, `CSV payments tidak memuat baris transfer:\n${pay.body}`);
  assert.match(barisPay[0], /^"transfer","2","60000"/);
  assert.equal(barisCsv(pay.body, '"other"')[0].split(',')[2], '"7000"', 'CSV: other tercampur dengan transfer');

  const rekap = await get(`/reports/export?type=recap&${RENTANG}`);
  assert.equal(rekap.statusCode, 200, rekap.body);
  const total = barisCsv(rekap.body, '"pembayaran","transfer","total_diterima"');
  assert.equal(total.length, 1, `CSV rekap tidak memuat pembayaran,transfer:\n${rekap.body}`);
  assert.match(total[0], /"60000"/);
});

test('⛔ G-LAPORAN-TRF: rekapitulasi FR-C13 memuat transfer terpisah dari other', async () => {
  const res = await get(`/reports/recap?${RENTANG}`);
  assert.equal(res.statusCode, 200, res.body);
  const peta = Object.fromEntries(res.json().rekap.pembayaran.map((m) => [m.method, m]));
  assert.equal(peta.transfer?.totalDiterima, '60000', 'rekap tidak memuat transfer');
  assert.equal(peta.other?.totalDiterima, '7000');
});

test('⛔ G-LAPORAN-TRF: ringkasan HP M-01 perMetode memuat transfer', async () => {
  const res = await get('/reports/daily-summary?date=2026-08-10');
  assert.equal(res.statusCode, 200, res.body);
  const peta = Object.fromEntries(res.json().perMetode.map((m) => [m.metode, m]));
  assert.equal(peta.transfer?.total, '60000', 'M-01 tidak memuat transfer');
  assert.equal(peta.transfer?.jumlah, 2);
  assert.equal(peta.other?.total, '7000');
});

test('⛔ G-LAPORAN-TRF: detail shift perMetode memuat transfer terpisah dari kelompok other', async () => {
  const res = await get(`/reports/shifts/${shift}`);
  assert.equal(res.statusCode, 200, res.body);
  const peta = Object.fromEntries(res.json().perMetode.map((m) => [m.method, m]));
  assert.equal(peta.transfer?.total, '60000', 'detail shift: perMetode tidak memuat transfer');
  assert.equal(peta.transfer?.jumlahTransaksi, 2);
  assert.equal(peta.other?.total, '7000', 'detail shift: kelompok other tercampur dengan transfer');
});

test('⛔ G-LAPORAN-TRF: detail transaksi B-04 membawa provider bank_transfer', async () => {
  const res = await get(`/reports/transactions/${ordTransfer}`);
  assert.equal(res.statusCode, 200, res.body);
  const [p] = res.json().payments;
  assert.equal(p.method, 'other');
  assert.equal(p.provider, 'bank_transfer', 'detail transaksi tidak membawa provider -- klien menyebutnya Lainnya');
  assert.equal(p.confirmedManually, true);
});

test('⛔ G-LAPORAN-TRF property: di SETIAP laporan, jumlah seluruh baris metode = SUM pembayaran confirmed', async () => {
  const kebenaran = await jumlahConfirmed();
  assert.equal(kebenaran, 117000n, 'fixture berubah -- kebenaran dasar tidak lagi 117.000');

  const fr12 = (await get(`/reports/payments?${RENTANG}`)).json();
  assert.equal(jumlah(fr12.metode, (m) => m.totalDiterima), kebenaran, 'FR-C12: uang hilang dari pengelompokan');
  assert.equal(BigInt(fr12.totalDiterima), kebenaran, 'FR-C12: totalDiterima');

  const recap = (await get(`/reports/recap?${RENTANG}`)).json().rekap;
  assert.equal(jumlah(recap.pembayaran, (m) => m.totalDiterima), kebenaran, 'rekap FR-C13');

  const hp = (await get('/reports/daily-summary?date=2026-08-10')).json();
  assert.equal(jumlah(hp.perMetode, (m) => m.total), kebenaran, 'M-01');

  const sh = (await get(`/reports/shifts/${shift}`)).json();
  assert.equal(jumlah(sh.perMetode, (m) => m.total), kebenaran, 'detail shift');

  const csv = (await get(`/reports/export?type=payments&${RENTANG}`)).body;
  const dariCsv = csv
    .split('\n')
    .slice(1)
    .filter((l) => l.trim() !== '')
    .reduce((t, l) => t + BigInt(l.split(',')[2].replace(/"/g, '')), 0n);
  assert.equal(dariCsv, kebenaran, 'CSV payments');
});
