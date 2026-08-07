'use strict';

// G5 (PLAN-void-refund-gateway.md §5.7) -- cek status pembayaran gateway.
//
// spec-c:293-316 -- setelah initiate, klien mem-polling status. Yang ada di
// sini adalah ENDPOINT-nya; penjadwalannya (tiap 2 detik, maksimal 5 menit)
// adalah perilaku klien dan sengaja tidak dibangun di server.
//
// spec-c:320, aturan mutlak: pembayaran hanya menjadi lunas setelah gateway
// mengonfirmasi. Berkas ini adalah satu-satunya tempat di mana perpindahan itu
// boleh terjadi untuk QRIS.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');

let owner, appSetup, app, tenant, base, fake;

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
  base = await seedTenantBase(appSetup, { suffix: 'QrisStatus' });
  tenant = base.tenant;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  const { createFakeProvider } = await import('../../apps/server/src/modules/payment/providers/index.ts');
  fake = createFakeProvider();
  if (app) await app.close();
  app = await buildApp({ paymentProvider: fake });
  await akhiriTarifSeed();
});

const BUSINESS_DATE = '2026-08-07';
let deviceCounter = 0;
let seq = 0;

function req(method, url, payload, headers = {}) {
  const h = { 'x-tenant-id': tenant.id, 'x-actor-id': base.user.id, ...headers };
  if (method === 'POST' && (url === '/orders' || url.endsWith('/payments')) && h['idempotency-key'] === undefined) {
    h['idempotency-key'] = crypto.randomUUID();
  }
  return app.inject({ method, url, payload, headers: h });
}

async function akhiriTarifSeed() {
  const res = await req('POST', `/tax-rates/${base.tax_rate.id}/end`, {});
  assert.equal(res.statusCode, 200, res.body);
}

async function setupDeviceAndShift() {
  deviceCounter += 1;
  const deviceId = crypto.randomUUID();
  const d = await req('POST', '/devices', { id: deviceId, outletId: base.outlet.id, code: `K${deviceCounter}` });
  assert.equal(d.statusCode, 201, d.body);
  const shiftId = crypto.randomUUID();
  const s = await req('POST', '/shifts', {
    id: shiftId, outletId: base.outlet.id, deviceId,
    businessDate: BUSINESS_DATE, openingFloat: 100000,
  });
  assert.equal(s.statusCode, 201, s.body);
  return { deviceId, shiftId };
}

async function buatOrder(fx, price = 20000) {
  seq += 1;
  const itemId = crypto.randomUUID();
  const variationId = crypto.randomUUID();
  const it = await app.inject({
    method: 'POST', url: '/items',
    payload: { id: itemId, name: `P${variationId.slice(0, 6)}`, variations: [{ id: variationId, price }] },
    headers: { 'x-tenant-id': tenant.id },
  });
  assert.equal(it.statusCode, 201, it.body);

  const payload = {
    id: crypto.randomUUID(),
    outletId: base.outlet.id,
    deviceId: fx.deviceId,
    shiftId: fx.shiftId,
    receiptNumber: `K1-20260807-${String(seq).padStart(4, '0')}`,
    businessDate: BUSINESS_DATE,
    sequence: seq,
    channel: 'takeaway',
    checkId: crypto.randomUUID(),
    lines: [{ id: crypto.randomUUID(), variationId, quantityMilli: 1000, discountAmount: 0 }],
  };
  const res = await req('POST', '/orders', payload);
  assert.equal(res.statusCode, 201, res.body);
  return JSON.parse(res.body);
}

async function mulaiQris(orderId, amount) {
  const paymentId = crypto.randomUUID();
  const res = await req('POST', `/orders/${orderId}/payments`, {
    id: paymentId, method: 'qris_dynamic', amount,
  });
  assert.equal(res.statusCode, 201, res.body);
  return { paymentId, body: JSON.parse(res.body) };
}

function cekStatus(paymentId, headers = {}) {
  return req('POST', `/payments/${paymentId}/check-status`, {}, headers);
}

async function query(sql, params) {
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  try {
    const { rows } = await appSetup.query(sql, params);
    await appSetup.query('COMMIT');
    return rows;
  } catch (err) {
    await appSetup.query('ROLLBACK');
    throw err;
  }
}

// ============================================================
// Gateway masih pending
// ============================================================

test('gateway masih pending -> payment dan order tidak berubah', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx);
  const { paymentId } = await mulaiQris(order.id, order.total);

  const res = await cekStatus(paymentId);
  assert.equal(res.statusCode, 200, res.body);
  const body = JSON.parse(res.body);
  assert.equal(body.payment.status, 'pending_confirmation');
  assert.equal(body.order.status, 'open');

  const rows = await query('SELECT status FROM payment WHERE id = $1', [paymentId]);
  assert.equal(rows[0].status, 'pending_confirmation');
});

// ============================================================
// Gateway confirmed -> DI SINI order menjadi lunas, dan hanya di sini
// ============================================================

test('gateway confirmed -> payment confirmed dan order CLOSED', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx, 35000);
  const { paymentId, body: awal } = await mulaiQris(order.id, 35000);
  fake.setStatus(awal.payment.providerReference, 'confirmed');

  const res = await cekStatus(paymentId);
  assert.equal(res.statusCode, 200, res.body);
  const body = JSON.parse(res.body);
  assert.equal(body.payment.status, 'confirmed');
  assert.equal(body.order.status, 'closed');
  assert.equal(body.outstanding, 0);

  const p = await query('SELECT status FROM payment WHERE id = $1', [paymentId]);
  assert.equal(p[0].status, 'confirmed');
  const o = await query('SELECT status, rounding_adjustment, amount_due FROM "order" WHERE id = $1', [order.id]);
  assert.equal(o[0].status, 'closed');
  // Pembulatan tunai (FR-C9) TIDAK berlaku: tidak ada uang tunai yang
  // diserahkan. QRIS dibayar tepat sesuai nominal.
  assert.equal(o[0].rounding_adjustment, '0');
  assert.equal(o[0].amount_due, String(order.total));
});

test('QRIS yang mengonfirmasi SEBAGIAN tidak menutup order', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx, 50000);
  const { paymentId, body: awal } = await mulaiQris(order.id, 20000);
  fake.setStatus(awal.payment.providerReference, 'confirmed');

  const res = await cekStatus(paymentId);
  assert.equal(res.statusCode, 200, res.body);
  const body = JSON.parse(res.body);
  assert.equal(body.payment.status, 'confirmed');
  assert.equal(body.order.status, 'open');
  assert.equal(body.outstanding, 30000);
});

// ============================================================
// Gateway failed / expired
// ============================================================

test('gateway failed -> payment failed, order TETAP open', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx);
  const { paymentId, body: awal } = await mulaiQris(order.id, order.total);
  fake.setStatus(awal.payment.providerReference, 'failed');

  const res = await cekStatus(paymentId);
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(JSON.parse(res.body).payment.status, 'failed');
  assert.equal(JSON.parse(res.body).order.status, 'open');

  const o = await query('SELECT status FROM "order" WHERE id = $1', [order.id]);
  assert.equal(o[0].status, 'open', 'order harus tetap bisa dibayar dengan cara lain');
});

test('gateway expired -> payment failed, order TETAP open', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx);
  const { paymentId, body: awal } = await mulaiQris(order.id, order.total);
  fake.setStatus(awal.payment.providerReference, 'expired');

  const res = await cekStatus(paymentId);
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(JSON.parse(res.body).payment.status, 'failed');
  assert.equal(JSON.parse(res.body).gatewayStatus, 'expired', 'sebab aslinya tetap terbaca klien');
});

// Order yang QRIS-nya gagal harus masih bisa dibayar tunai -- kalau tidak,
// pelanggan berdiri di kasir dengan pesanan yang tidak bisa diselesaikan.
test('setelah QRIS gagal, order masih dapat dibayar tunai sampai CLOSED', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx, 25000);
  const { paymentId, body: awal } = await mulaiQris(order.id, 25000);
  fake.setStatus(awal.payment.providerReference, 'failed');
  await cekStatus(paymentId);

  const tunai = await req('POST', `/orders/${order.id}/payments`, {
    id: crypto.randomUUID(), method: 'cash', tenderedAmount: 25000,
  });
  assert.equal(tunai.statusCode, 201, tunai.body);
  assert.equal(JSON.parse(tunai.body).order.status, 'closed');
});

// ============================================================
// Idempotensi dan guard
// ============================================================

// Klien mem-polling tiap 2 detik. Kalau tiap panggilan menembak gateway walau
// jawabannya sudah final, satu order menghasilkan puluhan panggilan yang tidak
// mengubah apa pun -- boros kuota, dan menaikkan peluang kena rate limit
// justru saat pembayaran lain sedang berlangsung.
test('payment yang sudah final tidak memanggil gateway lagi', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx);
  const { paymentId, body: awal } = await mulaiQris(order.id, order.total);
  fake.setStatus(awal.payment.providerReference, 'confirmed');

  await cekStatus(paymentId);
  const sesudahPertama = fake.pollCalls();
  const kedua = await cekStatus(paymentId);
  assert.equal(kedua.statusCode, 200, kedua.body);
  assert.equal(JSON.parse(kedua.body).payment.status, 'confirmed');
  assert.equal(fake.pollCalls(), sesudahPertama, 'gateway tidak boleh dipanggil ulang');
});

test('cek status dua kali tidak menutup order dua kali', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx);
  const { paymentId, body: awal } = await mulaiQris(order.id, order.total);
  fake.setStatus(awal.payment.providerReference, 'confirmed');

  await cekStatus(paymentId);
  const kedua = await cekStatus(paymentId);
  assert.equal(kedua.statusCode, 200, kedua.body);
  assert.equal(JSON.parse(kedua.body).order.status, 'closed');
  assert.equal((await query('SELECT id FROM payment')).length, 1);
});

test('payment milik tenant lain -> 404, gateway tidak dipanggil', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx);
  const { paymentId } = await mulaiQris(order.id, order.total);
  const lain = await seedTenantBase(appSetup, { suffix: 'QrisStatusOther' });

  const sebelum = fake.pollCalls();
  const res = await app.inject({
    method: 'POST',
    url: `/payments/${paymentId}/check-status`,
    payload: {},
    headers: { 'x-tenant-id': lain.tenant.id, 'x-actor-id': lain.user.id },
  });
  assert.equal(res.statusCode, 404, res.body);
  assert.equal(fake.pollCalls(), sebelum);

  const rows = await query('SELECT status FROM payment WHERE id = $1', [paymentId]);
  assert.equal(rows[0].status, 'pending_confirmation', 'tidak boleh tersentuh tenant lain');
});

test('payment yang tidak ada -> 404', async () => {
  await setupDeviceAndShift();
  const res = await cekStatus(crypto.randomUUID());
  assert.equal(res.statusCode, 404, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'PAYMENT_NOT_FOUND');
});

// Pembayaran tunai tidak punya gateway untuk ditanyai. Menjawabnya dengan
// memanggil provider akan mengirim referensi kosong ke Midtrans.
test('payment tunai tidak dapat dicek statusnya ke gateway', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx, 15000);
  const paymentId = crypto.randomUUID();
  const tunai = await req('POST', `/orders/${order.id}/payments`, {
    id: paymentId, method: 'cash', tenderedAmount: 15000,
  });
  assert.equal(tunai.statusCode, 201, tunai.body);

  const sebelum = fake.pollCalls();
  const res = await cekStatus(paymentId);
  assert.equal(res.statusCode, 409, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'PAYMENT_NOT_GATEWAY');
  assert.equal(fake.pollCalls(), sebelum);
});

// Payment yang gateway-nya gagal saat initiate tidak punya
// provider_reference. Ia tetap harus bisa dicek -- itu justru keadaan yang
// paling butuh pengecekan (FR-C14: pelanggan mungkin sudah membayar).
test('payment tanpa provider_reference tetap dapat dicek', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx);
  fake.failNextInitiate(new Error('ETIMEDOUT'));
  const { paymentId, body } = await mulaiQris(order.id, order.total);
  assert.equal(body.payment.providerReference, null);

  const res = await cekStatus(paymentId);
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(JSON.parse(res.body).payment.status, 'pending_confirmation');
  assert.ok(fake.pollCalls() > 0, 'gateway tetap ditanyai, memakai id payment');
});

// Gateway tidak dapat dihubungi BUKAN berarti pembayaran gagal. Menandainya
// `failed` di sini akan membatalkan pembayaran yang mungkin sudah diterima
// issuer -- persis kelas bug yang FR-C14 ada untuk mencegahnya, hanya dari
// arah sebaliknya: bukan uang yang hilang, tapi uang yang masuk lalu dianggap
// tidak pernah ada.
test('gateway tidak dapat dihubungi saat cek status -> payment TETAP pending', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx);
  const { paymentId } = await mulaiQris(order.id, order.total);
  fake.failNextPoll(new Error('ETIMEDOUT'));

  const res = await cekStatus(paymentId);
  assert.equal(res.statusCode, 200, res.body);
  const body = JSON.parse(res.body);
  assert.equal(body.payment.status, 'pending_confirmation');
  assert.notEqual(body.gatewayStatus, 'failed');
  assert.equal(body.order.status, 'open');

  const rows = await query('SELECT status FROM payment WHERE id = $1', [paymentId]);
  assert.equal(rows[0].status, 'pending_confirmation', 'tidak boleh dibatalkan hanya karena jaringan');
});
