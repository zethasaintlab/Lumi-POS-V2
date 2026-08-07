'use strict';

// G8-G9 (PLAN-void-refund-gateway.md §5.7) -- QRIS statis dan EDC.
//
// Keduanya dikonfirmasi MANUSIA, bukan sistem. Tidak ada gateway yang
// ditanyai, dan karena itu tidak ada apa pun yang memverifikasi bahwa uangnya
// benar-benar masuk. Kontrol yang menyertainya bukan pelengkap -- ia satu-
// satunya yang berdiri di sana:
//
//   QRIS statis (FR-C2) : field referensi WAJIB + confirmed_manually + masuk
//                         laporan exception. Ia satu-satunya metode digital
//                         yang berfungsi OFFLINE, jadi kasir mengonfirmasi
//                         tanpa verifikasi sistem sama sekali.
//   EDC (FR-C4)         : approval_code WAJIB. Kartu ditangani terminal
//                         bersertifikat; POS hanya mencatat hasilnya.
//
// FR-C5, larangan data kartu: tidak ada field mana pun -- termasuk field bebas
// seperti referensi -- yang boleh menerima 13-19 digit berurutan tanpa
// penolakan. Itu bentuk nomor kartu.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');

let owner, appSetup, app, tenant, base;

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
  base = await seedTenantBase(appSetup, { suffix: 'ManualPay' });
  tenant = base.tenant;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  const { createFakeProvider } = await import('../../apps/server/src/modules/payment/providers/index.ts');
  if (app) await app.close();
  app = await buildApp({ paymentProvider: createFakeProvider() });
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

function bayar(orderId, over) {
  return req('POST', `/orders/${orderId}/payments`, { id: crypto.randomUUID(), ...over });
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
// G8 -- QRIS statis
// ============================================================

test('QRIS statis dengan referensi -> confirmed, confirmed_manually true, order CLOSED', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx, 27000);

  const res = await bayar(order.id, { method: 'qris_static', amount: 27000, reference: 'BCA 4821' });
  assert.equal(res.statusCode, 201, res.body);
  const body = JSON.parse(res.body);
  assert.equal(body.payment.status, 'confirmed');
  assert.equal(body.payment.confirmedManually, true);
  assert.equal(body.order.status, 'closed');
  assert.equal(body.outstanding, 0);

  const rows = await query('SELECT status, confirmed_manually, provider_reference, provider FROM payment');
  assert.equal(rows[0].status, 'confirmed');
  assert.equal(rows[0].confirmed_manually, true);
  assert.equal(rows[0].provider_reference, 'BCA 4821');
  // Tidak ada gateway yang terlibat. `provider` harus kosong -- mengisinya
  // dengan nama adapter akan membuat laporan mengira transaksi ini pernah
  // diverifikasi sistem.
  assert.equal(rows[0].provider, null);
});

// Ini kontrol anti-fraud yang wajib menyertainya (FR-C2). Tanpa referensi,
// "sudah dibayar" hanyalah pernyataan kasir tanpa jejak apa pun.
test('QRIS statis TANPA referensi ditolak', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx);

  for (const reference of [undefined, null, '', '   ', 'ab']) {
    const res = await bayar(order.id, { method: 'qris_static', amount: 20000, reference });
    assert.equal(res.statusCode, 400, `${JSON.stringify(reference)}: ${res.body}`);
    assert.equal(JSON.parse(res.body).error.code, 'VALIDATION_ERROR');
  }
  assert.equal((await query('SELECT id FROM payment')).length, 0);
});

test('QRIS statis dapat difilter di laporan lewat confirmed_manually', async () => {
  const fx = await setupDeviceAndShift();
  const a = await buatOrder(fx, 10000);
  const b = await buatOrder(fx, 10000);
  await bayar(a.id, { method: 'qris_static', amount: 10000, reference: 'MANDIRI 9931' });
  await bayar(b.id, { method: 'cash', tenderedAmount: 10000 });

  const manual = await query('SELECT method FROM payment WHERE confirmed_manually = true');
  assert.deepEqual(manual.map((r) => r.method), ['qris_static']);
});

// ============================================================
// G9 -- EDC
// ============================================================

test('EDC dengan approval code -> confirmed dan order CLOSED', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx, 45000);

  const res = await bayar(order.id, {
    method: 'card_edc', amount: 45000,
    approvalCode: '123456', cardLast4: '4821', acquirer: 'BCA', terminalReference: 'TID-0099',
  });
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(JSON.parse(res.body).order.status, 'closed');

  const rows = await query('SELECT status, approval_code, card_last4, acquirer, terminal_reference FROM payment');
  assert.equal(rows[0].status, 'confirmed');
  assert.equal(rows[0].approval_code, '123456');
  assert.equal(rows[0].card_last4, '4821');
  assert.equal(rows[0].acquirer, 'BCA');
  assert.equal(rows[0].terminal_reference, 'TID-0099');
});

test('EDC TANPA approval code ditolak', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx);

  for (const approvalCode of [undefined, null, '', '  ']) {
    const res = await bayar(order.id, { method: 'card_edc', amount: 20000, approvalCode });
    assert.equal(res.statusCode, 400, `${JSON.stringify(approvalCode)}: ${res.body}`);
  }
  assert.equal((await query('SELECT id FROM payment')).length, 0);
});

test('EDC tanpa cardLast4 tetap diterima -- ia opsional (FR-C4)', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx, 12000);
  const res = await bayar(order.id, { method: 'card_edc', amount: 12000, approvalCode: '778899' });
  assert.equal(res.statusCode, 201, res.body);
  const rows = await query('SELECT card_last4 FROM payment');
  assert.equal(rows[0].card_last4, null);
});

// AC FR-C4 pertama: "Tidak ada input yang menerima lebih dari 4 digit nomor
// kartu."
test('cardLast4 lebih dari 4 digit ditolak aplikasi', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx);

  for (const cardLast4 of ['48210', '4111111111111111', 'abcd', '12 4', '']) {
    const res = await bayar(order.id, {
      method: 'card_edc', amount: 20000, approvalCode: '123456', cardLast4,
    });
    assert.equal(res.statusCode, 400, `${cardLast4}: ${res.body}`);
  }
  assert.equal((await query('SELECT id FROM payment')).length, 0);
});

// AC FR-C5 kedua menuntut constraint di tingkat SKEMA, bukan hanya aplikasi.
// Diuji dengan menulis LANGSUNG ke tabel, melewati seluruh validasi aplikasi.
//
// Seluruh kolom lain diisi nilai yang SAH (order sungguhan, tenant sungguhan),
// supaya satu-satunya yang bisa menolak baris ini adalah CHECK pada
// card_last4. Nilai karangan akan ditolak lebih dulu oleh RLS atau FK, dan
// test-nya akan hijau tanpa membuktikan apa pun tentang CHECK itu.
test('card_last4 > 4 karakter ditolak DATABASE, bukan hanya aplikasi', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx, 10000);
  const check = await query('SELECT id FROM "check" WHERE order_id = $1', [order.id]);

  await appSetup.query('BEGIN');
  try {
    await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
    let kode = null;
    try {
      await appSetup.query(
        `INSERT INTO payment (id, tenant_id, outlet_id, device_id, order_id, check_id, method, amount,
                              status, card_last4, tendered_at, created_by, occurred_at, hlc)
         VALUES ($1, $2, $3, $4, $5, $6, 'card_edc', 1, 'confirmed', '41111', now(), $7, now(), 1)`,
        [crypto.randomUUID(), tenant.id, base.outlet.id, fx.deviceId, order.id, check[0].id, base.user.id]
      );
    } catch (err) {
      kode = err.code;
    }
    // 23514 = check_violation. Kalau kodenya lain, yang menolak bukan CHECK
    // yang sedang diuji.
    assert.equal(kode, '23514', 'CHECK (length(card_last4) <= 4) harus yang menolaknya');
  } finally {
    // WAJIB, dan bukan kerapian: appSetup adalah koneksi BERSAMA seluruh
    // berkas ini. Transaksi yang gagal dan tidak di-rollback membuat setiap
    // query berikutnya dijawab "current transaction is aborted" -- satu test
    // yang meleset menjatuhkan semua yang sesudahnya, dan penyebab aslinya
    // terkubur.
    await appSetup.query('ROLLBACK');
  }
});

// ============================================================
// FR-C5 -- tidak ada field yang menerima bentuk nomor kartu
// ============================================================

// AC FR-C5 keempat: "Tidak ada field bebas (notes, reference) yang divalidasi
// menerima 13-19 digit berurutan tanpa peringatan."
//
// Field referensi QRIS statis adalah field bebas yang diisi kasir sambil
// melihat layar ponsel. Ia justru tempat paling mungkin nomor kartu tersalin
// tanpa sengaja.
test('referensi berisi 13-19 digit berurutan ditolak -- itu bentuk nomor kartu', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx);

  const mirip = [
    '4111111111111111',
    '4111 1111 1111 1111',
    '4111-1111-1111-1111',
    'ref 378282246310005',
    '1234567890123',
  ];
  for (const reference of mirip) {
    const res = await bayar(order.id, { method: 'qris_static', amount: 20000, reference });
    assert.equal(res.statusCode, 400, `${reference}: ${res.body}`);
    assert.equal(JSON.parse(res.body).error.code, 'POSSIBLE_CARD_NUMBER');
  }
  assert.equal((await query('SELECT id FROM payment')).length, 0);
});

// Referensi yang SAH tidak boleh ikut tertolak. Nomor referensi bank dan
// nominal rupiah keduanya deret angka; menolak semua angka akan membuat
// kontrol ini dimatikan orang pertama yang terhalang olehnya.
test('referensi sah yang mengandung angka tetap diterima', async () => {
  const fx = await setupDeviceAndShift();
  for (const reference of ['BCA 4821', 'Rp 27.000 ref 8891', '2026-08-07 14:32', '123456789012']) {
    const order = await buatOrder(fx, 20000);
    const res = await bayar(order.id, { method: 'qris_static', amount: 20000, reference });
    assert.equal(res.statusCode, 201, `${reference}: ${res.body}`);
  }
});

test('approval code berbentuk nomor kartu juga ditolak', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx);
  const res = await bayar(order.id, {
    method: 'card_edc', amount: 20000, approvalCode: '4111111111111111',
  });
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'POSSIBLE_CARD_NUMBER');
});

// ============================================================
// Keduanya berbagi guard yang sama dengan tunai
// ============================================================

test('QRIS statis pada order yang sudah lunas ditolak', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx, 15000);
  await bayar(order.id, { method: 'cash', tenderedAmount: 15000 });

  const res = await bayar(order.id, { method: 'qris_static', amount: 5000, reference: 'BCA 1122' });
  assert.equal(res.statusCode, 409, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'ORDER_NOT_PAYABLE');
});

test('EDC sebagian tidak menutup order', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx, 50000);
  const res = await bayar(order.id, { method: 'card_edc', amount: 20000, approvalCode: '445566' });
  assert.equal(res.statusCode, 201, res.body);
  const body = JSON.parse(res.body);
  assert.equal(body.order.status, 'open');
  assert.equal(body.outstanding, 30000);
});

// Metode manual TIDAK boleh dicek ke gateway -- tidak ada gateway di baliknya.
test('QRIS statis tidak dapat dicek statusnya ke gateway', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx, 10000);
  const paymentId = crypto.randomUUID();
  const res = await req('POST', `/orders/${order.id}/payments`, {
    id: paymentId, method: 'qris_static', amount: 10000, reference: 'BNI 3321',
  });
  assert.equal(res.statusCode, 201, res.body);

  const cek = await req('POST', `/payments/${paymentId}/check-status`, {});
  assert.equal(cek.statusCode, 409, cek.body);
  assert.equal(JSON.parse(cek.body).error.code, 'PAYMENT_NOT_GATEWAY');
});
