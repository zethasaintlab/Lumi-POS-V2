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
  const h = { 'x-tenant-id': tenant.id, authorization: base.authHeader, 'x-actor-id': base.user.id, ...headers };
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
    headers: { 'x-tenant-id': tenant.id , authorization: base.authHeader},
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

// ============================================================
// Transfer bank -- `other` + `bank_transfer` (spec kasir § 5, P1/P2)
// ============================================================

test('⛔ transfer dengan referensi -> confirmed, method other, provider bank_transfer, confirmed_manually true, order CLOSED', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx, 27000);

  const res = await bayar(order.id, {
    method: 'other', provider: 'bank_transfer', amount: 27000,
    reference: 'TRF-20260807-0042', acquirer: 'BCA',
  });
  assert.equal(res.statusCode, 201, res.body);
  const body = JSON.parse(res.body);
  assert.equal(body.payment.status, 'confirmed');
  assert.equal(body.payment.confirmedManually, true);
  assert.equal(body.payment.provider, 'bank_transfer');
  assert.equal(body.order.status, 'closed');

  const rows = await query(
    'SELECT method, provider, provider_reference, acquirer, confirmed_manually, tendered_amount FROM payment'
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].method, 'other');
  assert.equal(rows[0].provider, 'bank_transfer');
  assert.equal(rows[0].provider_reference, 'TRF-20260807-0042');
  assert.equal(rows[0].acquirer, 'BCA');
  assert.equal(rows[0].confirmed_manually, true);
  assert.equal(rows[0].tendered_amount, null);
});

test('⛔ G-TRF: transfer TANPA referensi ditolak dengan pesan yang SAMA dengan domain', async () => {
  const { periksaTransfer } = await import('../../packages/domain/src/pembayaran-manual.ts');
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx);

  for (const reference of [undefined, null, '', '   ', 'ab']) {
    const res = await bayar(order.id, {
      method: 'other', provider: 'bank_transfer', amount: 20000, reference,
    });
    assert.equal(res.statusCode, 400, `${JSON.stringify(reference)}: ${res.body}`);
    const err = JSON.parse(res.body).error;
    assert.equal(err.code, 'VALIDATION_ERROR');
    assert.equal(err.message, periksaTransfer(reference, null).pesan);
  }
  assert.equal((await query('SELECT id FROM payment')).length, 0);
});

test('provider di luar daftar tertutup ditolak', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx);

  for (const provider of [undefined, null, '', 'voucher', 'BANK_TRANSFER', 'midtrans', 'xendit', 42]) {
    const res = await bayar(order.id, {
      method: 'other', provider, amount: 20000, reference: 'TRF-0001',
    });
    assert.equal(res.statusCode, 400, `${JSON.stringify(provider)}: ${res.body}`);
    assert.equal(JSON.parse(res.body).error.code, 'VALIDATION_ERROR');
  }
  assert.equal((await query('SELECT id FROM payment')).length, 0);
});

test('⛔ referensi atau bank berbentuk nomor kartu ditolak POSSIBLE_CARD_NUMBER', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx);

  for (const [reference, acquirer] of [
    ['4111 1111 1111 1111', undefined],
    ['4111-1111-1111-1111', undefined],
    ['TRF-0001', '4111111111111111'],
  ]) {
    const res = await bayar(order.id, {
      method: 'other', provider: 'bank_transfer', amount: 20000, reference, acquirer,
    });
    assert.equal(res.statusCode, 400, res.body);
    assert.equal(JSON.parse(res.body).error.code, 'POSSIBLE_CARD_NUMBER');
  }
  assert.equal((await query('SELECT id FROM payment')).length, 0);
});

test('⛔ G-TRF-KAS server: transfer TIDAK menulis cash_movement', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx, 27000);
  const res = await bayar(order.id, {
    method: 'other', provider: 'bank_transfer', amount: 27000, reference: 'TRF-0042',
  });
  assert.equal(res.statusCode, 201, res.body);

  const kas = await query('SELECT id FROM cash_movement WHERE order_id = $1', [order.id]);
  assert.equal(kas.length, 0, 'transfer menulis cash_movement ke laci');
});

test('⛔ FR-C9 tidak menyentuh transfer: total tak bulat dilunasi apa adanya, rounding_adjustment 0', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx, 20050);
  const res = await bayar(order.id, {
    method: 'other', provider: 'bank_transfer', amount: Number(order.total), reference: 'TRF-0050',
  });
  assert.equal(res.statusCode, 201, res.body);
  const [o] = await query(
    `SELECT status, total, amount_due, rounding_adjustment FROM "order" WHERE id = $1`,
    [order.id]
  );
  assert.equal(o.status, 'closed');
  assert.notEqual(Number(o.total) % 100, 0, 'fixture harus tak bulat agar uji ini bermakna');
  assert.equal(Number(o.rounding_adjustment), 0, 'transfer menyebabkan pembulatan FR-C9');
  assert.equal(Number(o.amount_due), Number(o.total), 'amount_due ≠ total pada transfer');
  const [p] = await query(`SELECT amount FROM payment WHERE order_id = $1`, [order.id]);
  assert.equal(Number(p.amount), Number(o.total));
});

test('transfer sebagian tidak menutup order dan menyisakan tagihan', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx, 20000);

  const sebagian = await bayar(order.id, {
    method: 'other', provider: 'bank_transfer', amount: 5000, reference: 'TRF-0001',
  });
  assert.equal(sebagian.statusCode, 201, sebagian.body);
  assert.notEqual(JSON.parse(sebagian.body).order.status, 'closed');
  assert.equal(JSON.parse(sebagian.body).outstanding, 15000);
});

test('audit: payment.recorded untuk transfer membawa aktor dan metodenya', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx, 27000);
  const res = await bayar(order.id, {
    method: 'other', provider: 'bank_transfer', amount: 27000, reference: 'TRF-0042',
  });
  assert.equal(res.statusCode, 201, res.body);

  const pay = await query('SELECT id, created_by FROM payment');
  assert.equal(pay[0].created_by, base.user.id, 'aktor tidak tercatat di baris payment');

  const ev = await query(
    `SELECT payload FROM outbox WHERE event_type = 'payment.recorded' AND aggregate_id = $1`,
    [pay[0].id]
  );
  assert.equal(ev.length, 1);
  const payload = typeof ev[0].payload === 'string' ? JSON.parse(ev[0].payload) : ev[0].payload;
  assert.equal(payload.method, 'other');
  assert.equal(payload.orderId, order.id);
});

test('isolasi tenant: transfer tenant A tidak terbaca tenant B', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx, 27000);
  const res = await bayar(order.id, {
    method: 'other', provider: 'bank_transfer', amount: 27000, reference: 'TRF-0042',
  });
  assert.equal(res.statusCode, 201, res.body);

  const b = await seedTenantBase(appSetup, { suffix: 'ManualPayB' });
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [b.tenant.id]);
  const { rows } = await appSetup.query(`SELECT id FROM payment WHERE method = 'other'`);
  await appSetup.query('COMMIT');
  assert.equal(rows.length, 0, 'tenant B membaca transfer tenant A');

  assert.equal((await query(`SELECT id FROM payment WHERE method = 'other'`)).length, 1);
});

const TRANSFER = { method: 'other', provider: 'bank_transfer' };

test('nomor rekening 10 digit dan referensi 12 digit tetap diterima', async () => {
  const fx = await setupDeviceAndShift();
  for (const reference of ['1234567890', '123456789012']) {
    const order = await buatOrder(fx, 20000);
    const res = await bayar(order.id, { ...TRANSFER, amount: 20000, reference });
    assert.equal(res.statusCode, 201, `${reference}: ${res.body}`);
  }
});


test('⛔ G-TRF-KAS server: transfer TIDAK menulis cash_movement; bagian tunai menulis sebesar tunainya', async () => {
  const fx = await setupDeviceAndShift();

  // Transfer penuh: nol movement penjualan.
  const a = await buatOrder(fx, 35000);
  const ra = await bayar(a.id, { ...TRANSFER, amount: 35000, reference: 'TRF-KAS-1' });
  assert.equal(ra.statusCode, 201, ra.body);
  const sesudahTransfer = await query(`SELECT delta FROM cash_movement WHERE type = 'sale'`);
  assert.equal(sesudahTransfer.length, 0, 'pembayaran transfer menulis cash_movement -- laci naik oleh uang bank');

  // Transfer + tunai: hanya bagian tunai yang masuk laci.
  const b = await buatOrder(fx, 50000);
  const rb1 = await bayar(b.id, { ...TRANSFER, amount: 20000, reference: 'TRF-KAS-2' });
  assert.equal(rb1.statusCode, 201, rb1.body);
  assert.equal(JSON.parse(rb1.body).order.status, 'open');
  const rb2 = await bayar(b.id, { method: 'cash', tenderedAmount: 30000 });
  assert.equal(rb2.statusCode, 201, rb2.body);
  const movement = await query(`SELECT delta FROM cash_movement WHERE type = 'sale' AND order_id = $1`, [b.id]);
  assert.equal(movement.length, 1);
  assert.equal(Number(movement[0].delta), 30000, 'delta laci harus sebesar BAGIAN TUNAI, bukan total');
});


test('kill switch pembayaran_transfer MATI tidak menolak transfer yang sudah terjadi di perangkat', async () => {
  // Kill switch menyembunyikan tab di layar; ia tidak boleh membuat penjualan
  // yang SUDAH tersimpan di perangkat berhenti di antrean (CLAUDE.md: kuota /
  // switch tidak menghentikan penjualan).
  await owner.query(
    `INSERT INTO feature_flag (id, key, tenant_id, enabled, reason, updated_by)
     VALUES ($1, 'pembayaran_transfer', $2, false, 'uji', 'test')`,
    [crypto.randomUUID(), tenant.id]
  );
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx, 12000);
  const res = await bayar(order.id, { ...TRANSFER, amount: 12000, reference: 'TRF-OFFLINE' });
  assert.equal(res.statusCode, 201, res.body);
});


test('⛔ idempotensi transfer: key sama + isi berbeda (per medan) = 422; retry identik = cache', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx, 40000);
  const key = crypto.randomUUID();
  const id = crypto.randomUUID();
  const asli = { id, ...TRANSFER, amount: 40000, reference: 'TRF-IDEM', acquirer: 'BCA' };

  const a = await req('POST', `/orders/${order.id}/payments`, asli, { 'idempotency-key': key });
  assert.equal(a.statusCode, 201, a.body);

  // Setiap medan tersimpan diubah SATU per satu: semuanya harus 422.
  const variasi = {
    reference: 'TRF-LAIN',
    acquirer: 'BNI',
    amount: 39000,
    method: 'qris_static',
    id: crypto.randomUUID(),
  };
  for (const [medan, nilai] of Object.entries(variasi)) {
    const b = await req('POST', `/orders/${order.id}/payments`, { ...asli, [medan]: nilai }, { 'idempotency-key': key });
    assert.equal(b.statusCode, 422, `medan ${medan} diubah tetapi dijawab ${b.statusCode}: ${b.body}`);
    assert.equal(JSON.parse(b.body).error.code, 'IDEMPOTENCY_KEY_HASH_MISMATCH', `medan ${medan}`);
  }

  const c = await req('POST', `/orders/${order.id}/payments`, asli, { 'idempotency-key': key });
  assert.equal(c.statusCode, 201, c.body);
  assert.deepEqual(JSON.parse(c.body), JSON.parse(a.body), 'retry identik harus mengembalikan respons asli');
  assert.equal((await query('SELECT id FROM payment')).length, 1, 'retry menghasilkan baris ganda');
});

// PERUBAHAN PERILAKU (PR 2B Task 7): hash isi idempotensi kini berlaku untuk SEMUA
// metode manual, bukan hanya Transfer. Sebelumnya QRIS statis/EDC dengan key sama
// dan isi berbeda dijawab dari cache; sekarang 422.
test('⛔ idempotensi qris_static dan card_edc: key sama + isi berbeda = 422 IDEMPOTENCY_KEY_HASH_MISMATCH', async () => {
  const fx = await setupDeviceAndShift();
  const kasus = [
    { method: 'qris_static', amount: 21000, reference: 'QRS-IDEM', ubah: { reference: 'QRS-LAIN' } },
    { method: 'card_edc', amount: 22000, approvalCode: '654321', ubah: { approvalCode: '111222' } },
  ];
  for (const { ubah, ...isi } of kasus) {
    const order = await buatOrder(fx, isi.amount);
    const key = crypto.randomUUID();
    const asli = { id: crypto.randomUUID(), ...isi };
    const a = await req('POST', `/orders/${order.id}/payments`, asli, { 'idempotency-key': key });
    assert.equal(a.statusCode, 201, a.body);
    const b = await req('POST', `/orders/${order.id}/payments`, { ...asli, ...ubah }, { 'idempotency-key': key });
    assert.equal(b.statusCode, 422, `${isi.method}: isi berbeda dijawab ${b.statusCode}: ${b.body}`);
    assert.equal(JSON.parse(b.body).error.code, 'IDEMPOTENCY_KEY_HASH_MISMATCH', isi.method);
  }
});

test('⛔ other + tenderedAmount TIDAK PERNAH menjadi pembayaran tunai atau menulis cash_movement', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx, 30000);
  const res = await bayar(order.id, { ...TRANSFER, amount: 30000, reference: 'TRF-TND', tenderedAmount: 50000 });
  assert.ok(res.statusCode < 500, `other + tenderedAmount menjatuhkan server: ${res.statusCode} ${res.body}`);
  const tunai = await query(`SELECT id FROM payment WHERE method = 'cash'`);
  assert.equal(tunai.length, 0, 'transfer tercatat sebagai pembayaran TUNAI');
  const kas = await query(`SELECT id FROM cash_movement WHERE type = 'sale'`);
  assert.equal(kas.length, 0, 'transfer menulis cash_movement -- laci naik oleh uang bank');
});

test('⛔ isolasi tenant: transfer tenant A tidak terbaca dan tidak dapat dibayar tenant B', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx, 25000);
  const res = await bayar(order.id, { ...TRANSFER, amount: 25000, reference: 'TRF-TENANT-A' });
  assert.equal(res.statusCode, 201, res.body);

  const lain = await seedTenantBase(appSetup, { suffix: 'ManualPayOther' });
  await appSetup.query('BEGIN');
  try {
    await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [lain.tenant.id]);
    const { rows } = await appSetup.query(`SELECT id FROM payment WHERE method = 'other'`);
    assert.equal(rows.length, 0, 'tenant B membaca payment transfer milik tenant A');
  } finally {
    await appSetup.query('ROLLBACK');
  }

  // Tenant B tidak dapat membayar order tenant A.
  const serang = await app.inject({
    method: 'POST',
    url: `/orders/${order.id}/payments`,
    payload: { id: crypto.randomUUID(), ...TRANSFER, amount: 1000, reference: 'TRF-SERANG' },
    headers: {
      'x-tenant-id': lain.tenant.id, authorization: lain.authHeader, 'x-actor-id': lain.user.id,
      'idempotency-key': crypto.randomUUID(),
    },
  });
  assert.equal(serang.statusCode, 404, serang.body);
});

test('⛔ idempotensi transfer: dua request BERSAMAAN dengan key sama tidak menghasilkan baris ganda', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx, 22000);
  const key = crypto.randomUUID();
  const badan = { id: crypto.randomUUID(), ...TRANSFER, amount: 22000, reference: 'TRF-BERSAMAAN' };

  const [a, b] = await Promise.all([
    req('POST', `/orders/${order.id}/payments`, badan, { 'idempotency-key': key }),
    req('POST', `/orders/${order.id}/payments`, badan, { 'idempotency-key': key }),
  ]);
  const kode = [a.statusCode, b.statusCode].sort();
  assert.ok(
    kode.every((k) => k === 201 || k === 409),
    `status tak terduga: ${kode.join(',')} -- ${a.body} ${b.body}`
  );
  assert.ok(kode.includes(201), 'tidak satu pun request berhasil');
  assert.equal((await query('SELECT id FROM payment')).length, 1, 'request bersamaan menghasilkan baris payment ganda');
});

test('retry atas baris idempotensi berhash LAMA (sebelum PR 2B) tetap dijawab dari cache, bukan 422', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx, 16000);
  const key = crypto.randomUUID();
  const badan = { id: crypto.randomUUID(), ...TRANSFER, amount: 16000, reference: 'TRF-LAMA' };
  const a = await req('POST', `/orders/${order.id}/payments`, badan, { 'idempotency-key': key });
  assert.equal(a.statusCode, 201, a.body);

  // Rilis lama menulis `orderId:paymentId` sebagai hash. Respons yang hilang di
  // seberang rilis tidak boleh berubah menjadi 422 -> gagal-permanen.
  await owner.query('BEGIN');
  await owner.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await owner.query('UPDATE idempotency_key SET request_hash = $2 WHERE key = $1', [key, `${order.id}:${badan.id}`]);
  await owner.query('COMMIT');
  const b = await req('POST', `/orders/${order.id}/payments`, badan, { 'idempotency-key': key });
  assert.equal(b.statusCode, 201, b.body);
  assert.deepEqual(JSON.parse(b.body), JSON.parse(a.body));
  assert.equal((await query('SELECT id FROM payment')).length, 1);
});

// ============================================================
// Penjaga yang sebelumnya HAMPA (sabotase independen Opus, PR 2B Task 7)
// ============================================================

// S5b: hash idempotensi harus mencakup SETIAP medan yang ditulis
// INSERT_MANUAL_PAYMENT_SQL. Medan yang terbuang dari hash membuat key sama +
// isi beda dijawab dari cache dan pembayaran kedua hilang diam-diam.
// Tabel di bawah dikunci terhadap SQL-nya: kolom baru di INSERT tanpa baris di
// sini membuat test ini merah (bukan diam).
test('⛔ S5b: hash idempotensi mencakup SETIAP medan INSERT_MANUAL_PAYMENT_SQL (per metode, satu medan per kali)', async () => {
  const fs = require('node:fs');
  const sumber = fs.readFileSync(
    require('node:path').join(__dirname, '..', '..', 'apps/server/src/modules/payment/handlers/payments.ts'), 'utf8'
  );
  const kolom = /const INSERT_MANUAL_PAYMENT_SQL = `\s*INSERT INTO payment \(([^)]*)\)/.exec(sumber)[1]
    .split(',').map((k) => k.trim());
  // Kolom -> medan body yang memengaruhinya. `null` = bukan isi request
  // (diturunkan server / metadata yang sengaja di luar hash).
  const PETA = {
    id: 'id', tenant_id: null, outlet_id: null, device_id: null, order_id: null, check_id: null,
    method: 'method', amount: 'amount', status: null, confirmed_manually: null,
    provider_reference: 'reference', approval_code: 'approvalCode', card_last4: 'cardLast4',
    acquirer: 'acquirer', terminal_reference: 'terminalReference', tendered_at: null, created_by: null,
    // `provider` ada di hash tetapi TIDAK divariasikan di bawah: daftar tertutupnya satu nilai,
    // variasinya ditolak 400 sebelum hash. Dinyatakan di sini, tidak dihitung "teruji".
    occurred_at: 'occurredAt', hlc: null, mdr_estimated: null, provider: null,
  };
  for (const k of kolom) {
    assert.ok(k in PETA, `kolom INSERT baru '${k}' belum dipetakan ke medan hash idempotensi`);
  }

  const fx = await setupDeviceAndShift();
  const kasus = [
    {
      isi: { ...TRANSFER, amount: 31000, reference: 'TRF-H1', acquirer: 'BCA', terminalReference: 'T-1', occurredAt: '2026-08-07T03:00:00.000Z' },
      ubah: { reference: 'TRF-H2', acquirer: 'BNI', terminalReference: 'T-2', occurredAt: '2026-08-07T04:00:00.000Z', amount: 30000 },
    },
    {
      isi: { method: 'card_edc', amount: 32000, approvalCode: '654321', cardLast4: '1234', acquirer: 'BCA', terminalReference: 'T-1', occurredAt: '2026-08-07T03:00:00.000Z' },
      ubah: { approvalCode: '111222', cardLast4: '9876', acquirer: 'BNI', terminalReference: 'T-2', occurredAt: '2026-08-07T04:00:00.000Z', amount: 31000 },
    },
    {
      isi: { method: 'qris_static', amount: 33000, reference: 'QRS-H1', acquirer: 'BCA', terminalReference: 'T-1', occurredAt: '2026-08-07T03:00:00.000Z' },
      ubah: { reference: 'QRS-H2', acquirer: 'BNI', terminalReference: 'T-2', occurredAt: '2026-08-07T04:00:00.000Z', amount: 32000 },
    },
  ];
  // Setiap medan yang dipetakan dari kolom INSERT harus tercakup variasinya.
  const medanTerpetakan = new Set(kolom.map((k) => PETA[k]).filter(Boolean));
  const medanDiuji = new Set(kasus.flatMap((k) => Object.keys(k.ubah)).concat('id', 'method'));
  for (const m of medanTerpetakan) assert.ok(medanDiuji.has(m), `medan '${m}' tidak punya variasi di test hash`);

  for (const { isi, ubah } of kasus) {
    const order = await buatOrder(fx, isi.amount);
    const key = crypto.randomUUID();
    const asli = { id: crypto.randomUUID(), ...isi };
    const a = await req('POST', `/orders/${order.id}/payments`, asli, { 'idempotency-key': key });
    assert.equal(a.statusCode, 201, a.body);
    for (const [medan, nilai] of Object.entries(ubah)) {
      const b = await req('POST', `/orders/${order.id}/payments`, { ...asli, [medan]: nilai }, { 'idempotency-key': key });
      assert.equal(b.statusCode, 422, `${isi.method}: medan ${medan} diubah (key sama) tetapi dijawab ${b.statusCode}: ${b.body}`);
      assert.equal(JSON.parse(b.body).error.code, 'IDEMPOTENCY_KEY_HASH_MISMATCH', `${isi.method}/${medan}`);
    }
    const c = await req('POST', `/orders/${order.id}/payments`, asli, { 'idempotency-key': key });
    assert.equal(c.statusCode, 201, `${isi.method}: retry identik harus dijawab dari cache: ${c.body}`);
  }
});

// S9: pembulatan FR-C9 hanya pada SISA TUNAI. Pembayaran Transfer tidak pernah
// membulatkan -- dibuktikan dari BARIS order di database (bukan dari respons,
// yang dulu menulis literal 0 dan karena itu tidak dapat mengungkap apa-apa).
// Total 35.050 bukan kelipatan 100, jadi bila transfer ikut membulatkan,
// rounding_adjustment/amount_due menyimpang dari 0/total.
test('⛔ S9: transfer penuh atas total 35.050 (rounding_increment 100) menutup order dengan rounding_adjustment 0 dan amount_due = total, dibaca dari DB', async () => {
  await owner.query(`UPDATE outlet SET rounding_increment = 100 WHERE id = $1`, [base.outlet.id]);
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx, 35050);

  const res = await bayar(order.id, { ...TRANSFER, amount: 35050, reference: 'TRF-RND', acquirer: 'BCA' });
  assert.equal(res.statusCode, 201, res.body);
  const body = JSON.parse(res.body);

  const [o] = await query(
    `SELECT status, total::text AS total, rounding_adjustment::text AS ra, amount_due::text AS due FROM "order" WHERE id = $1`,
    [order.id]
  );
  assert.equal(o.status, 'closed');
  assert.equal(o.total, '35050');
  assert.equal(o.ra, '0', 'transfer membulatkan order (rounding_adjustment != 0) -- FR-C9 hanya untuk sisa TUNAI');
  assert.equal(o.due, o.total, 'amount_due != total pada order lunas via transfer');
  // Respons harus mencerminkan baris, bukan literal.
  assert.equal(body.order.roundingAdjustment, Number(o.ra));
  assert.equal(body.order.amountDue, Number(o.due));
  assert.equal((await query('SELECT amount::text AS a FROM payment WHERE order_id = $1', [order.id]))[0].a, '35050');
});

// M3: asersi respons S9 lulus juga terhadap literal 0 (baris memang 0/total). Di sini baris
// DISEMAI nilai tak-nol (keadaan buatan) supaya respons yang menulis literal terungkap.
test('⛔ S9b: respons manual mencerminkan rounding_adjustment/amount_due BARIS order, bukan literal 0', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx, 30000);
  await owner.query('BEGIN');
  await owner.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  const semai = await owner.query(`UPDATE "order" SET rounding_adjustment = -50 WHERE id = $1`, [order.id]);
  await owner.query('COMMIT');
  assert.equal(semai.rowCount, 1, 'fixture tidak tersemai (RLS?)');
  // Sebagian: order tetap terbuka, baris tidak disentuh (FR-C9 hanya pada sisa tunai).
  const res = await bayar(order.id, { ...TRANSFER, amount: 10000, reference: 'TRF-S9B' });
  assert.equal(res.statusCode, 201, res.body);
  const body = JSON.parse(res.body);
  const [o] = await query(`SELECT rounding_adjustment::text AS ra, amount_due::text AS due FROM "order" WHERE id = $1`, [order.id]);
  assert.equal(o.ra, '-50', 'transfer menyentuh rounding_adjustment');
  assert.equal(body.order.roundingAdjustment, -50, 'respons menulis literal, bukan nilai baris order');
  assert.equal(body.order.amountDue, Number(o.due));
});
