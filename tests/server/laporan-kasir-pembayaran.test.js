'use strict';

// Modul G REST — `GET /reports/cashiers` (B-18) dan `GET /reports/payments`
// (B-19).
//
// ⛔ Sifat yang paling penting di berkas ini: JUMLAH SELURUH KASIR sama
// dengan angka laporan global. Dua laporan di aplikasi yang sama yang
// menjawab pertanyaan yang sama dengan angka berbeda menghancurkan
// kepercayaan lebih cepat daripada fitur yang hilang (`spec-g:29`).

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');

let owner, appSetup, app, base, tenant, device, shift, kasirB;

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
  await appSetup.query('ROLLBACK').catch(() => {});
  await resetAll(owner);
  base = await seedTenantBase(appSetup, { suffix: 'KasirTest' });
  tenant = base.tenant;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();

  device = crypto.randomUUID();
  shift = crypto.randomUUID();
  kasirB = crypto.randomUUID();
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await appSetup.query(
    `INSERT INTO device (id, tenant_id, outlet_id, code, name, platform, app_version, schema_version)
     VALUES ($1, $2, $3, 'K1', 'K1', 'tauri', '0', '1')`,
    [device, tenant.id, base.outlet.id]
  );
  await appSetup.query(
    `INSERT INTO cash_drawer_shift (id, tenant_id, outlet_id, device_id, business_date, status, opening_float, opened_by)
     VALUES ($1, $2, $3, $4, '2026-08-10', 'open', 0, $5)`,
    [shift, tenant.id, base.outlet.id, device, base.user.id]
  );
  await appSetup.query(
    `INSERT INTO "user" (id, tenant_id, name) VALUES ($1, $2, 'Budi Manajer')`,
    [kasirB, tenant.id]
  );
  await appSetup.query('COMMIT');
});

let n = 0;

async function buatOrder({ createdBy, total = 100000, tax = 0, status = 'closed', voided = null, bd = '2026-08-10' }) {
  const id = crypto.randomUUID();
  n += 1;
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await appSetup.query(
    `INSERT INTO "order"
       (id, tenant_id, outlet_id, device_id, shift_id, receipt_number, business_date, sequence,
        status, channel, subtotal, order_discount, service_charge_amount, tax_amount,
        rounding_adjustment, total, amount_due, voided_by_order_id, created_by, occurred_at, hlc)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::int,$9,'takeaway',$10,0,0,$11,0,$10,$10,$12,$13,$14,$8::bigint)`,
    [id, tenant.id, base.outlet.id, device, shift, `K1-${bd.replace(/-/g, '')}-${n}`, bd, n,
     status, total, tax, voided, createdBy, `${bd}T10:00:00Z`]
  );
  await appSetup.query(
    `INSERT INTO "check" (id, tenant_id, order_id, subtotal, total) VALUES ($1,$2,$3,0,$4)`,
    [`c-${id}`, tenant.id, id, total]
  );
  await appSetup.query('COMMIT');
  return id;
}

async function buatPayment(orderId, { method = 'cash', amount = 100000, status = 'confirmed' }) {
  n += 1;
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await appSetup.query(
    `INSERT INTO payment (id, tenant_id, outlet_id, device_id, order_id, check_id, method, amount, status, occurred_at, tendered_at, hlc, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'2026-08-10T10:00:00Z','2026-08-10T10:00:00Z',$10::bigint,$11)`,
    [crypto.randomUUID(), tenant.id, base.outlet.id, device, orderId, `c-${orderId}`, method, amount, status, n, base.user.id]
  );
  await appSetup.query('COMMIT');
}

const hdr = () => ({
  'x-tenant-id': tenant.id,
  authorization: base.authHeader,
  'x-actor-id': base.user.id,
});

const kasir = (q) => app.inject({ method: 'GET', url: `/reports/cashiers?${q}`, headers: hdr() });
const bayar = (q) => app.inject({ method: 'GET', url: `/reports/payments?${q}`, headers: hdr() });
const global_ = (q) => app.inject({ method: 'GET', url: `/reports/sales?${q}`, headers: hdr() });

const RENTANG = 'from=2026-08-10&to=2026-08-10';

// --- B-18 --------------------------------------------------------------------

test('kasir dipisah, masing-masing memakai posisiPenjualan', async () => {
  await buatOrder({ createdBy: base.user.id, total: 60000, tax: 6000 });
  await buatOrder({ createdBy: kasirB, total: 40000, tax: 4000 });

  const res = await kasir(RENTANG);
  assert.equal(res.statusCode, 200, res.body);
  const daftar = res.json().kasir;
  assert.equal(daftar.length, 2);
  // Terurut omzet bersih menurun.
  assert.equal(daftar[0].penjualan.omzetKotor, '60000');
  assert.equal(daftar[1].penjualan.omzetKotor, '40000');
  assert.equal(daftar[1].name, 'Budi Manajer');
});

test('⛔ JUMLAH seluruh kasir SAMA dengan laporan global', async () => {
  // Sifat yang paling penting. Dua laporan yang menjawab pertanyaan yang sama
  // dengan angka berbeda menghancurkan kepercayaan (`spec-g:29`).
  const a = await buatOrder({ createdBy: base.user.id, total: 60000, tax: 6000 });
  await buatOrder({ createdBy: kasirB, total: 40000, tax: 4000 });
  const dibatalkan = await buatOrder({ createdBy: kasirB, total: 25000, tax: 2500 });
  await buatOrder({ createdBy: base.user.id, status: 'voided', total: 25000, tax: 2500, voided: dibatalkan });
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await appSetup.query(
    `INSERT INTO refund (id, tenant_id, order_id, amount, reason_code, created_by, approved_by, hlc)
     VALUES ($1,$2,$3,10000,'salah_input',$4,$4,9999)`,
    [crypto.randomUUID(), tenant.id, a, base.user.id]
  );
  await appSetup.query('COMMIT');

  const g = (await global_(RENTANG)).json().penjualan;
  const daftar = (await kasir(RENTANG)).json().kasir;

  const jumlah = (kunci) =>
    daftar.reduce((t, k) => t + BigInt(k.penjualan[kunci]), 0n).toString();

  assert.equal(jumlah('omzetKotor'), g.omzetKotor);
  assert.equal(jumlah('voidAmount'), g.voidAmount);
  assert.equal(jumlah('refundAmount'), g.refundAmount);
  assert.equal(jumlah('omzetBersih'), g.omzetBersih);
  assert.equal(jumlah('pajakTerkumpul'), g.pajakTerkumpul);
  assert.equal(
    daftar.reduce((t, k) => t + k.penjualan.jumlahTransaksi, 0),
    g.jumlahTransaksi
  );
});

test('⛔ kasir PEMBATAL tidak dapat penalti; void melekat pada pemilik penjualan', async () => {
  // Order pembatal punya `created_by` sendiri — orang yang menekan tombol
  // void. Kalau pengelompokan lurus per `created_by`, kelompok kasir penjual
  // tidak memuat pembatalnya, dan penjualan yang SUDAH dibatalkan tetap masuk
  // omzetnya.
  const jualan = await buatOrder({ createdBy: kasirB, total: 50000, tax: 5000 });
  // Manajer (base.user) yang membatalkan.
  await buatOrder({ createdBy: base.user.id, status: 'voided', total: 50000, tax: 5000, voided: jualan });

  const daftar = (await kasir(RENTANG)).json().kasir;
  const budi = daftar.find((k) => k.name === 'Budi Manajer');

  assert.ok(budi, 'kasir penjual hilang dari laporan');
  assert.equal(budi.penjualan.omzetKotor, '0', 'penjualan yang dibatalkan tetap masuk omzet kasir');
  assert.equal(budi.penjualan.voidAmount, '50000', 'void tidak melekat pada pemilik penjualan');
  assert.equal(budi.penjualan.jumlahTransaksi, 0);

  // Manajer yang menekan tombol TIDAK muncul dengan void, dan tidak muncul
  // sama sekali karena ia tidak menjual apa pun.
  const manajer = daftar.find((k) => k.userId === base.user.id);
  assert.equal(manajer, undefined, 'penekan tombol void muncul sebagai kasir');
});

test('refund melekat pada kasir pemilik order', async () => {
  const a = await buatOrder({ createdBy: kasirB, total: 100000, tax: 10000 });
  await buatOrder({ createdBy: base.user.id, total: 50000 });
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await appSetup.query(
    `INSERT INTO refund (id, tenant_id, order_id, amount, reason_code, created_by, approved_by, hlc)
     VALUES ($1,$2,$3,40000,'salah_input',$4,$4,8888)`,
    [crypto.randomUUID(), tenant.id, a, base.user.id]
  );
  await appSetup.query('COMMIT');

  const daftar = (await kasir(RENTANG)).json().kasir;
  const budi = daftar.find((k) => k.name === 'Budi Manajer');
  assert.equal(budi.penjualan.refundAmount, '40000');
  assert.equal(budi.penjualan.omzetBersih, '60000');
  assert.equal(daftar.find((k) => k.userId === base.user.id).penjualan.refundAmount, '0');
});

test('⛔ uang dikirim sebagai STRING, bukan number', async () => {
  await buatOrder({ createdBy: base.user.id, total: 100000 });
  const k = (await kasir(RENTANG)).json().kasir[0].penjualan;
  for (const kunci of ['omzetKotor', 'voidAmount', 'refundAmount', 'omzetBersih', 'pajakTerkumpul', 'rataRataPerTransaksi']) {
    assert.equal(typeof k[kunci], 'string', `${kunci} bukan string`);
  }
  assert.equal(typeof k.jumlahTransaksi, 'number');
});

test('rentang tanpa penjualan mengembalikan daftar kosong', async () => {
  const res = await kasir('from=2026-01-01&to=2026-01-31');
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(res.json().kasir, []);
});

// --- B-19 --------------------------------------------------------------------

test('pembayaran dijumlahkan per metode', async () => {
  const a = await buatOrder({ createdBy: base.user.id, total: 100000 });
  await buatPayment(a, { method: 'cash', amount: 100000 });
  const b = await buatOrder({ createdBy: base.user.id, total: 50000 });
  await buatPayment(b, { method: 'qris_dynamic', amount: 50000 });
  const c = await buatOrder({ createdBy: base.user.id, total: 30000 });
  await buatPayment(c, { method: 'cash', amount: 30000 });

  const res = await bayar(RENTANG);
  assert.equal(res.statusCode, 200, res.body);
  const { metode, totalDiterima } = res.json();

  assert.deepEqual(metode.map((m) => m.method), ['cash', 'qris_dynamic']);
  assert.equal(metode[0].totalDiterima, '130000');
  assert.equal(metode[0].jumlahTransaksi, 2);
  assert.equal(totalDiterima, '180000');
});

test('⛔ hanya payment CONFIRMED — pending dan failed tidak dihitung', async () => {
  // `spec-c:223`. QRIS dinamis yang masih `pending_confirmation` belum boleh
  // dianggap uang masuk, dan `failed` jelas bukan.
  const a = await buatOrder({ createdBy: base.user.id, total: 100000 });
  await buatPayment(a, { method: 'cash', amount: 100000, status: 'confirmed' });
  const b = await buatOrder({ createdBy: base.user.id, total: 90000 });
  await buatPayment(b, { method: 'qris_dynamic', amount: 90000, status: 'pending_confirmation' });
  const c = await buatOrder({ createdBy: base.user.id, total: 80000 });
  await buatPayment(c, { method: 'card_edc', amount: 80000, status: 'failed' });

  const { metode, totalDiterima } = (await bayar(RENTANG)).json();
  assert.deepEqual(metode.map((m) => m.method), ['cash']);
  assert.equal(totalDiterima, '100000');
});

test('⛔ pembayaran atas pesanan yang DIBATALKAN tidak dihitung', async () => {
  const dibatalkan = await buatOrder({ createdBy: base.user.id, total: 70000 });
  await buatPayment(dibatalkan, { method: 'cash', amount: 70000 });
  await buatOrder({ createdBy: base.user.id, status: 'voided', total: 70000, voided: dibatalkan });

  const tetap = await buatOrder({ createdBy: base.user.id, total: 20000 });
  await buatPayment(tetap, { method: 'cash', amount: 20000 });

  const { totalDiterima } = (await bayar(RENTANG)).json();
  assert.equal(totalDiterima, '20000');
});

test('⛔ totalDiterima dijumlahkan lewat bigint dan dikirim STRING', async () => {
  const a = await buatOrder({ createdBy: base.user.id, total: 100000 });
  await buatPayment(a, { method: 'cash', amount: 100000 });
  const { metode, totalDiterima } = (await bayar(RENTANG)).json();
  assert.equal(typeof totalDiterima, 'string');
  assert.equal(typeof metode[0].totalDiterima, 'string');
});

test('rentang tanpa pembayaran mengembalikan daftar kosong dan total nol', async () => {
  const res = await bayar('from=2026-01-01&to=2026-01-31');
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(res.json().metode, []);
  assert.equal(res.json().totalDiterima, '0');
});

// --- validasi bersama --------------------------------------------------------

test('kedua endpoint memakai validasi rentang yang sama', async () => {
  for (const panggil of [kasir, bayar]) {
    for (const q of ['from=2026-08-12&to=2026-08-10', 'from=2026-02-31&to=2026-03-01', 'from=x&to=y']) {
      const res = await panggil(q);
      assert.equal(res.statusCode, 400, `"${q}" diterima`);
      assert.equal(res.json().error.code, 'VALIDATION_ERROR');
    }
  }
});

test('⛔ keduanya menolak tanpa sesi', async () => {
  for (const url of ['/reports/cashiers', '/reports/payments']) {
    const res = await app.inject({
      method: 'GET',
      url: `${url}?${RENTANG}`,
      headers: { 'x-tenant-id': tenant.id },
    });
    assert.equal(res.statusCode, 401, `${url} tidak menolak`);
  }
});

test('⛔ outlet tenant lain ditolak 404 di kedua endpoint', async () => {
  const lain = await seedTenantBase(appSetup, { suffix: 'KasirLain' });
  for (const panggil of [kasir, bayar]) {
    const res = await panggil(`${RENTANG}&outlet_id=${lain.outlet.id}`);
    assert.equal(res.statusCode, 404, res.body);
    assert.equal(res.json().error.code, 'OUTLET_NOT_FOUND');
  }
});
