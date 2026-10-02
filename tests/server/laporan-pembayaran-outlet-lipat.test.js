'use strict';

// ⛔ Dua penjaga laporan pembayaran yang sebelumnya HAMPA (sabotase independen
// Opus, PR 2B Task 7):
//
//  S12  predikat `o.outlet_id = $3` di `ambilPembayaran` bisa dinetralkan tanpa
//       satu test pun merah -- fixture lama hanya punya SATU outlet. Di sini dua
//       outlet satu tenant, masing-masing punya transfer; `outlet_id=A` hanya
//       boleh memuat uang A di FR-C12, rekap FR-C13, dan ekspor CSV.
//  S13  cabang penjumlahan-lipat di TypeScript tak pernah jalan: SQL sudah
//       GROUP BY (method, provider) dan fixture lama tidak punya dua baris yang
//       melipat ke kode yang sama. `payment.provider` TIDAK punya CHECK, jadi
//       baris legacy `other` + provider lain dapat disisipkan langsung dan
//       melipat bersama `other` tanpa provider. Nominal > 2^53 membuktikan
//       penjumlahan tetap bigint (bukan lewat Number).

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');

let owner, appSetup, app, base, tenant, outletB, dev, shf;
const RENTANG = 'from=2026-08-10&to=2026-08-10';
const BESAR = 9007199254740993n; // 2^53 + 1

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
async function jual(outletId, spec) {
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  try {
    await jualDalamTx(outletId, spec);
    await appSetup.query('COMMIT');
  } catch (e) {
    await appSetup.query('ROLLBACK');
    throw e;
  }
}
async function jualDalamTx(outletId, { total, method, provider = null }) {
  const id = crypto.randomUUID();
  n += 1;
  await appSetup.query(
    `INSERT INTO "order" (id,tenant_id,outlet_id,device_id,shift_id,receipt_number,business_date,sequence,
       status,channel,subtotal,order_discount,service_charge_amount,tax_amount,rounding_adjustment,
       total,amount_due,created_by,occurred_at,hlc)
     VALUES ($1,$2,$3,$4,$5,$6,'2026-08-10',$7::int,'closed','takeaway',$8,0,0,0,0,$8,$8,$9,'2026-08-10T10:00:00Z',$7::bigint)`,
    [id, tenant.id, outletId, dev[outletId], shf[outletId], `K-${n}`, n, total.toString(), base.user.id]
  );
  await appSetup.query(`INSERT INTO "check" (id,tenant_id,order_id,subtotal,total) VALUES ($1,$2,$3,0,$4)`,
    [`c-${id}`, tenant.id, id, total.toString()]);
  await appSetup.query(
    `INSERT INTO payment (id,tenant_id,outlet_id,device_id,order_id,check_id,method,provider,amount,status,
       confirmed_manually,occurred_at,tendered_at,hlc,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'confirmed',true,'2026-08-10T10:00:00Z','2026-08-10T10:00:00Z',$10::bigint,$11)`,
    [crypto.randomUUID(), tenant.id, outletId, dev[outletId], id, `c-${id}`, method, provider, total.toString(), n, base.user.id]
  );
}

beforeEach(async () => {
  await appSetup.query('ROLLBACK').catch(() => {});
  await resetAll(owner);
  base = await seedTenantBase(appSetup, { suffix: 'LapOutlet' });
  tenant = base.tenant;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();

  outletB = crypto.randomUUID();
  dev = {}; shf = {};
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await appSetup.query(
    `INSERT INTO outlet (id,tenant_id,name,address,timezone,business_day_ends_at,rounding_increment,rounding_mode,
       service_charge_rate,vertical_profile_id,archived_at)
     VALUES ($1,$2,'Outlet B','Jl. B','Asia/Jakarta','04:00',100,'half_up',0,$3,NULL)`,
    [outletB, tenant.id, base.vertical_profile.id]
  );
  for (const o of [base.outlet.id, outletB]) {
    dev[o] = crypto.randomUUID();
    shf[o] = crypto.randomUUID();
    await appSetup.query(
      `INSERT INTO device (id, tenant_id, outlet_id, code, name, platform, app_version, schema_version)
       VALUES ($1,$2,$3,$4,'K','tauri','0','1')`,
      [dev[o], tenant.id, o, `D${o.slice(0, 6)}`]
    );
    await appSetup.query(
      `INSERT INTO cash_drawer_shift (id, tenant_id, outlet_id, device_id, business_date, status, opening_float, opened_by)
       VALUES ($1,$2,$3,$4,'2026-08-10','open',0,$5)`,
      [shf[o], tenant.id, o, dev[o], base.user.id]
    );
  }
  await appSetup.query('COMMIT');
});

const get = (url) =>
  app.inject({
    method: 'GET', url,
    headers: { 'x-tenant-id': tenant.id, authorization: base.authHeader, 'x-actor-id': base.user.id },
  });

test('⛔ S12: laporan pembayaran, rekap, dan CSV per outlet_id hanya memuat uang outlet itu', async () => {
  const A = base.outlet.id;
  await jual(A, { total: 40000, method: 'other', provider: 'bank_transfer' });
  await jual(outletB, { total: 70000, method: 'other', provider: 'bank_transfer' });
  await jual(outletB, { total: 5000, method: 'cash' });

  const fr12 = (await get(`/reports/payments?${RENTANG}&outlet_id=${A}`)).json();
  assert.equal(fr12.totalDiterima, '40000', 'FR-C12 outlet A memuat uang outlet lain -- filter outlet_id tidak berlaku');
  assert.deepEqual(fr12.metode.map((m) => [m.method, m.totalDiterima]), [['transfer', '40000']]);

  const rekap = (await get(`/reports/recap?${RENTANG}&outlet_id=${A}`)).json().rekap;
  assert.deepEqual(rekap.pembayaran.map((m) => [m.method, m.totalDiterima]), [['transfer', '40000']],
    'rekap FR-C13 outlet A memuat uang outlet lain');

  const csv = (await get(`/reports/export?type=payments&${RENTANG}&outlet_id=${A}`)).body;
  assert.match(csv, /^"transfer","1","40000"/m, `CSV outlet A:\n${csv}`);
  assert.doesNotMatch(csv, /70000|"cash"/, `CSV outlet A memuat uang outlet B:\n${csv}`);

  // Pembanding: tanpa filter keduanya muncul (fixture memang berisi uang B).
  const semua = (await get(`/reports/payments?${RENTANG}`)).json();
  assert.equal(semua.totalDiterima, '115000');
});

test('⛔ S13: baris (method, provider) berbeda yang melipat ke kode sama dijumlahkan, bigint > 2^53 utuh', async () => {
  const A = base.outlet.id;
  await jual(A, { total: BESAR, method: 'other', provider: null });
  await jual(A, { total: 6n, method: 'other', provider: 'dompet_legacy' });
  await jual(A, { total: 4n, method: 'other', provider: 'va_legacy' });
  await jual(A, { total: 10n, method: 'other', provider: 'bank_transfer' });

  const { metode, totalDiterima } = (await get(`/reports/payments?${RENTANG}`)).json();
  const peta = Object.fromEntries(metode.map((m) => [m.method, m]));
  assert.equal(peta.other.jumlahTransaksi, 3, 'tiga baris SQL berbeda harus terlipat ke satu baris other');
  assert.equal(peta.other.totalDiterima, (BESAR + 10n).toString(),
    'lipat: penjumlahan menimpa atau kehilangan presisi (harus bigint, bukan Number)');
  assert.equal(peta.other.tanpaPerkiraan, 3);
  assert.equal(peta.transfer.totalDiterima, '10');
  assert.equal(totalDiterima, (BESAR + 20n).toString(), 'total keseluruhan kehilangan presisi');
});
