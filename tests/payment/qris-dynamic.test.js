'use strict';

// G3-G7 (PLAN-void-refund-gateway.md §5.7) -- QRIS dinamis lewat gateway.
//
// ## Aturan mutlak yang dijaga berkas ini
//
// spec-c:320 -- "Sistem TIDAK PERNAH menandai pembayaran lunas tanpa
// konfirmasi dari gateway."
// spec-c:321 -- "Kasir TIDAK DAPAT menutup order sebagai PAID selama ada
// payment pending_confirmation."
//
// Seluruh test memakai fake provider yang di-inject lewat buildApp. CI
// mengisi MIDTRANS_SERVER_KEY dengan string kosong, jadi tidak ada satu pun
// test di sini yang boleh menyentuh jaringan.

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
  base = await seedTenantBase(appSetup, { suffix: 'QrisTest' });
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
  const h = { 'x-tenant-id': tenant.id, authorization: base.authHeader, 'x-actor-id': base.user.id, ...headers };
  const butuhKey = method === 'POST' && (url === '/orders' || url.endsWith('/payments'));
  if (butuhKey && h['idempotency-key'] === undefined) {
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

async function buatVariation(price) {
  const itemId = crypto.randomUUID();
  const variationId = crypto.randomUUID();
  const res = await app.inject({
    method: 'POST', url: '/items',
    payload: { id: itemId, name: `P${variationId.slice(0, 6)}`, variations: [{ id: variationId, price }] },
    headers: { 'x-tenant-id': tenant.id , authorization: base.authHeader},
  });
  assert.equal(res.statusCode, 201, res.body);
  return variationId;
}

async function buatOrder(fx, price = 20000) {
  seq += 1;
  const variationId = await buatVariation(price);
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

function bayarQris(orderId, over = {}, headers = {}) {
  return req('POST', `/orders/${orderId}/payments`, {
    id: crypto.randomUUID(), method: 'qris_dynamic', ...over,
  }, headers);
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
// G3 -- initiate SELALU berhenti di pending_confirmation
// ============================================================

test('QRIS dinamis menghasilkan payment pending_confirmation, bukan confirmed', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx);

  const res = await bayarQris(order.id, { amount: order.total });
  assert.equal(res.statusCode, 201, res.body);
  const body = JSON.parse(res.body);

  // spec-c:320 -- aturan mutlak. Tidak ada jalan dari initiate langsung ke
  // confirmed, apa pun yang dijawab gateway.
  assert.equal(body.payment.status, 'pending_confirmation');
  assert.equal(body.payment.method, 'qris_dynamic');
  assert.ok(body.qrString.length > 0, 'QR harus dikembalikan supaya klien bisa merendernya');
  assert.equal(body.gatewayReachable, true);

  const rows = await query('SELECT status, provider, provider_reference, amount FROM payment');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'pending_confirmation');
  assert.equal(rows[0].provider, 'fake');
  assert.ok(rows[0].provider_reference, 'referensi gateway harus tersimpan');
  assert.equal(rows[0].amount, String(order.total));
});

test('order TIDAK berpindah status saat QRIS baru diinisiasi', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx);

  const res = await bayarQris(order.id, { amount: order.total });
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(JSON.parse(res.body).order.status, 'open');

  const rows = await query('SELECT status FROM "order" WHERE id = $1', [order.id]);
  assert.equal(rows[0].status, 'open');
});

test('amount nol, negatif, atau bukan bilangan bulat ditolak', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx);

  for (const amount of [0, -1, 1.5, '20000', null, undefined]) {
    const res = await bayarQris(order.id, { amount });
    assert.equal(res.statusCode, 400, `${JSON.stringify(amount)}: ${res.body}`);
  }
  assert.equal((await query('SELECT id FROM payment')).length, 0);
  assert.equal(fake.initiateCalls(), 0, 'gateway tidak boleh dipanggil untuk input tidak valid');
});

// ============================================================
// G4 -- payment pending TIDAK melunasi order (spec-c:321)
// ============================================================

test('payment pending_confirmation tidak dihitung sebagai pelunasan', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx, 50000);

  const qris = await bayarQris(order.id, { amount: 50000 });
  assert.equal(qris.statusCode, 201, qris.body);

  // Bayar tunai penuh SETELAH ada QRIS pending: order harus lunas berdasarkan
  // tunai saja. Kalau QRIS pending ikut dihitung, order akan dianggap
  // terbayar dua kali lipat -- uang yang belum tentu pernah masuk.
  const tunai = await req('POST', `/orders/${order.id}/payments`, {
    id: crypto.randomUUID(), method: 'cash', tenderedAmount: 50000,
  });
  assert.equal(tunai.statusCode, 201, tunai.body);
  const body = JSON.parse(tunai.body);
  assert.equal(body.order.status, 'closed');
  assert.equal(body.outstanding, 0);

  const rows = await query('SELECT method, status FROM payment ORDER BY method');
  assert.deepEqual(rows.map((r) => `${r.method}:${r.status}`), ['cash:confirmed', 'qris_dynamic:pending_confirmation']);
});

// ============================================================
// G6 -- retry tidak membuat transaksi gateway baru
// ============================================================

test('retry dengan Idempotency-Key sama tidak membuat transaksi gateway baru', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx);
  const key = crypto.randomUUID();
  const paymentId = crypto.randomUUID();

  const a = await bayarQris(order.id, { id: paymentId, amount: order.total }, { 'idempotency-key': key });
  assert.equal(a.statusCode, 201, a.body);
  const b = await bayarQris(order.id, { id: paymentId, amount: order.total }, { 'idempotency-key': key });
  assert.equal(b.statusCode, 201, b.body);

  assert.deepEqual(JSON.parse(b.body), JSON.parse(a.body), 'respons asli dikembalikan apa adanya');
  // AC FR-C14 pertama. Diperiksa di GATEWAY, bukan hanya di database: efek di
  // database bisa saja sama walau gateway dipanggil dua kali, dan panggilan
  // kedua itulah yang menagih pelanggan dua kali.
  assert.equal(fake.gatewayTransactions(), 1);
  assert.equal((await query('SELECT id FROM payment')).length, 1);
});

// ============================================================
// G7 -- gateway gagal: payment TETAP ADA (inti FR-C14)
// ============================================================

// "Kelas bug yang paling sering menghasilkan uang hilang di POS: POS meminta
// QR, gateway timeout, pelanggan SUDAH MEMBAYAR, POS tidak tahu."
//
// Kalau panggilan gateway ada di dalam transaksi, kegagalannya me-rollback
// baris payment dan POS kehilangan satu-satunya jejak bahwa QR pernah
// diminta.
test('gateway tidak dapat dihubungi -> payment TETAP tersimpan pending_confirmation', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx);
  fake.failNextInitiate(new Error('ECONNREFUSED'));

  const res = await bayarQris(order.id, { amount: order.total });
  // BUKAN 500, dan bukan 502. Dari sudut pandang kasir permintaannya
  // berhasil: payment tercatat dan menunggu konfirmasi.
  assert.equal(res.statusCode, 201, res.body);
  const body = JSON.parse(res.body);
  assert.equal(body.gatewayReachable, false);
  assert.equal(body.qrString, null, 'tidak ada QR untuk ditampilkan');
  assert.equal(body.payment.status, 'pending_confirmation');

  const rows = await query('SELECT status, provider_reference FROM payment');
  assert.equal(rows.length, 1, 'payment TIDAK boleh hilang saat gateway gagal');
  assert.equal(rows[0].status, 'pending_confirmation');
  assert.equal(rows[0].provider_reference, null);
});

test('pesan galat gateway tidak bocor ke respons API', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx);
  fake.failNextInitiate(new Error('rahasia-internal-gateway-xyz'));

  const res = await bayarQris(order.id, { amount: order.total });
  assert.ok(!res.body.includes('rahasia-internal-gateway-xyz'), res.body);
});

// ============================================================
// Guard yang sama dengan jalur tunai
// ============================================================

test('order yang sudah lunas menolak QRIS baru', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx);
  const tunai = await req('POST', `/orders/${order.id}/payments`, {
    id: crypto.randomUUID(), method: 'cash', tenderedAmount: order.total,
  });
  assert.equal(tunai.statusCode, 201, tunai.body);

  const res = await bayarQris(order.id, { amount: 10000 });
  assert.equal(res.statusCode, 409, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'ORDER_NOT_PAYABLE');
  assert.equal(fake.initiateCalls(), 0, 'gateway tidak dipanggil untuk order yang sudah lunas');
});

test('order milik tenant lain -> 404, gateway tidak dipanggil', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx);
  const lain = await seedTenantBase(appSetup, { suffix: 'QrisOther' });

  const res = await app.inject({
    method: 'POST',
    url: `/orders/${order.id}/payments`,
    payload: { id: crypto.randomUUID(), method: 'qris_dynamic', amount: 10000 },
    headers: {
      'x-tenant-id': lain.tenant.id, authorization: lain.authHeader,
      'x-actor-id': lain.user.id,
      'idempotency-key': crypto.randomUUID(),
    },
  });
  assert.equal(res.statusCode, 404, res.body);
  assert.equal(fake.initiateCalls(), 0);
  assert.equal((await query('SELECT id FROM payment')).length, 0);
});

// INI yang membuat "retry memakai idempotency key yang sama" berarti sesuatu.
//
// Test retry di atas tidak membuktikannya: retry setelah initiate SUKSES
// dijawab dari cache dan tidak pernah menyentuh gateway lagi, jadi key apa pun
// yang diteruskan akan menghasilkan angka yang sama. Yang benar-benar menguji
// key adalah jalur setelah gateway GAGAL -- di situ panggilan diulang, dan
// key-lah satu-satunya yang mencegah transaksi gateway kedua.
//
// spec-c:293-316, cabang "Timeout/error": "JANGAN buat request baru -- pakai
// idempotency key yang sama".
test('gateway gagal lalu retry: QR akhirnya didapat, TANPA transaksi gateway kedua', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx);
  const key = crypto.randomUUID();
  const paymentId = crypto.randomUUID();

  fake.failNextInitiate(new Error('ETIMEDOUT'));
  const a = await bayarQris(order.id, { id: paymentId, amount: order.total }, { 'idempotency-key': key });
  assert.equal(a.statusCode, 201, a.body);
  assert.equal(JSON.parse(a.body).gatewayReachable, false);
  assert.equal(JSON.parse(a.body).qrString, null);

  // Retry dengan key yang SAMA. Kalau key yang gagal ikut diselesaikan,
  // jawaban di bawah akan datang dari cache dan qrString tetap null selamanya.
  const b = await bayarQris(order.id, { id: paymentId, amount: order.total }, { 'idempotency-key': key });
  assert.equal(b.statusCode, 201, b.body);
  const body = JSON.parse(b.body);
  assert.equal(body.gatewayReachable, true, 'retry harus benar-benar memanggil gateway lagi');
  assert.ok(body.qrString.length > 0, 'kasir akhirnya mendapat QR-nya');

  assert.equal(fake.gatewayTransactions(), 1, 'tetap SATU transaksi gateway');
  assert.equal((await query('SELECT id FROM payment')).length, 1, 'tidak ada payment kedua');
  const rows = await query('SELECT provider_reference FROM payment');
  assert.ok(rows[0].provider_reference, 'referensi gateway akhirnya tersimpan');
});


// ============================================================
// G8 -- BALAPAN: dua request bersamaan, dan apa yang SEBENARNYA melindungi
// ============================================================

// `HANDOFF.md`: "Idempotency key gateway pada balapan dua request bersamaan
// belum diuji: pada jalur BERURUTAN, yang mencegah transaksi gateway kedua
// adalah baris `idempotency_key` dan baris `payment` yang dipakai ulang. Key
// yang diteruskan ke gateway penting untuk dua request yang BERBARENGAN, dan
// untuk itu belum ada test."
//
// ⛔ YANG DIUKUR DI SINI BUKAN "gateway dipanggil sekali". Ia memang TIDAK.
//
// Diukur 29 Agustus 2026: sepuluh request bersamaan menghasilkan **sepuluh**
// panggilan `initiate`. Itu bukan cacat, itu konsekuensi bentuk jalurnya —
// QRIS dinamis memakai DUA transaksi (payment `pending_confirmation` di-commit
// SEBELUM gateway dipanggil, supaya kegagalan gateway tidak me-rollback
// satu-satunya jejak bahwa QR pernah diminta, FR-C14). Request yang tiba saat
// payment sudah ada tapi `provider_reference` belum terisi akan memanggil
// gateway lagi — dan itu jalur yang SAMA yang membuat retry setelah gateway
// timeout akhirnya mendapat QR-nya (G7b).
//
// ⛔ Jadi yang melindungi uang di sini HANYA SATU HAL: setiap panggilan itu
// membawa idempotency key yang SAMA, sehingga gateway men-dedupe-nya menjadi
// satu transaksi. Kalau server menurunkan key per-percobaan, sepuluh request
// menerbitkan SEPULUH QR untuk satu pesanan — pelanggan membayar salah
// satunya, sembilan sisanya menagih uang yang tidak ada pesanannya, dan
// merchant menemukannya saat rekonsiliasi.
//
// `gatewayTransactions()` adalah `byKey.size` di fake: ia menghitung KEY YANG
// BERBEDA, meniru dedupe Midtrans. Itulah angka yang harus 1. `initiateCalls()`
// dinyatakan terpisah supaya ketergantungan pada dedupe gateway TERTULIS,
// bukan tersirat.

test('⛔ sepuluh request QRIS bersamaan: gateway menerima SATU key, bukan sepuluh', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx);
  const key = crypto.randomUUID();
  const badan = { id: crypto.randomUUID(), amount: order.total };

  const hasil = await Promise.all(
    Array.from({ length: 10 }, () => bayarQris(order.id, badan, { 'idempotency-key': key }))
  );

  // INI yang menjaga uangnya.
  assert.equal(
    fake.gatewayTransactions(),
    1,
    'server mengirim key BERBEDA ke gateway — tiap key adalah QR baru untuk satu pesanan'
  );
  assert.equal((await query('SELECT id FROM payment')).length, 1, 'lebih dari satu baris payment');

  // Dinyatakan, bukan disembunyikan: server MEMANG memanggil gateway berkali-kali
  // di bawah konkurensi. Kalau angka ini kelak menjadi 1, jalurnya berubah dan
  // komentar panjang di atas harus ikut berubah.
  assert.ok(
    fake.initiateCalls() >= 1,
    'keamanan jalur ini bersandar pada dedupe gateway, dan itu harus tetap benar'
  );

  for (const r of hasil) {
    assert.ok([201, 409].includes(r.statusCode), `status tak terduga: ${r.statusCode} ${r.body}`);
  }
});

test('⛔ balapan tidak pernah menghasilkan DUA QR berbeda untuk satu order', async () => {
  // Bentuk paling mahal dari cacat ini: kasir menunjukkan satu QR ke pelanggan
  // sementara gateway menunggu pembayaran atas QR yang lain, dan pembayaran
  // yang sah tidak pernah dicocokkan dengan pesanannya.
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx);
  const key = crypto.randomUUID();
  const badan = { id: crypto.randomUUID(), amount: order.total };

  const hasil = await Promise.all(
    Array.from({ length: 5 }, () => bayarQris(order.id, badan, { 'idempotency-key': key }))
  );

  const qr = hasil
    .filter((r) => r.statusCode === 201)
    .map((r) => JSON.parse(r.body).qrString)
    .filter(Boolean);
  assert.ok(qr.length >= 1, 'tidak satu pun request berhasil');
  assert.equal(new Set(qr).size, 1, `QR BERBEDA terbit untuk satu order: ${[...new Set(qr)].join(' | ')}`);

  // Dan yang tersimpan di database adalah QR yang sama itu.
  const rows = await query('SELECT provider_reference FROM payment');
  assert.equal(rows.length, 1);
  assert.ok(qr[0].includes(rows[0].provider_reference), `QR di respons tidak cocok dengan yang tersimpan`);
});
