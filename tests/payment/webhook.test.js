'use strict';

// G12-G13 (PLAN-void-refund-gateway.md §5.7) -- webhook Midtrans.
//
// Keputusan Q4 (user, 7 Agu 2026): endpoint + verifikasi signature dibangun
// dan diuji dengan payload BUATAN. Midtrans mengirim notifikasi ke URL yang
// dapat dijangkau internet, dan di mesin lokal itu butuh tunnel -- di luar
// kendali. Seluruh jalur kodenya teruji tanpa jaringan; jabat tangan
// sungguhannya adalah langkah manual yang dicatat di HANDOFF.md sebagai gap
// yang diketahui.
//
// ## Kenapa webhook berbeda dari seluruh endpoint lain di repo ini
//
// Ia satu-satunya yang TIDAK membawa X-Tenant-Id. Midtrans tidak tahu apa-apa
// soal tenant kami. Karena itu:
//
//   1. Signature diverifikasi LEBIH DULU, sebelum satu query pun dijalankan.
//   2. Tenant dibaca dari notifikasi (custom_field1 yang kami titipkan saat
//      charge), lalu dipakai SET LOCAL app.tenant_id -- sehingga pencarian
//      payment tetap tunduk RLS. Tenant palsu tidak menemukan apa-apa.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');

// Kunci KARANGAN, dipakai untuk menghitung signature di test. Bukan kunci
// sungguhan, dan .env tidak pernah dibaca di berkas ini.
const KUNCI_UJI = 'SB-Mid-server-UJICOBA0123456789';

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
  base = await seedTenantBase(appSetup, { suffix: 'Webhook' });
  tenant = base.tenant;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  const { createFakeProvider } = await import('../../apps/server/src/modules/payment/providers/index.ts');
  fake = createFakeProvider();
  if (app) await app.close();
  app = await buildApp({ paymentProvider: fake, webhookSecret: KUNCI_UJI });
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

async function buatOrderDanQris(harga = 20000) {
  deviceCounter += 1;
  seq += 1;
  const deviceId = crypto.randomUUID();
  await req('POST', '/devices', { id: deviceId, outletId: base.outlet.id, code: `K${deviceCounter}` });
  const shiftId = crypto.randomUUID();
  await req('POST', '/shifts', {
    id: shiftId, outletId: base.outlet.id, deviceId, businessDate: BUSINESS_DATE, openingFloat: 100000,
  });
  const variationId = crypto.randomUUID();
  await app.inject({
    method: 'POST', url: '/items',
    payload: { id: crypto.randomUUID(), name: `P${seq}`, variations: [{ id: variationId, price: harga }] },
    headers: { 'x-tenant-id': tenant.id , authorization: base.authHeader},
  });
  const orderId = crypto.randomUUID();
  const o = await req('POST', '/orders', {
    id: orderId, outletId: base.outlet.id, deviceId, shiftId,
    receiptNumber: `K1-20260807-${String(seq).padStart(4, '0')}`,
    businessDate: BUSINESS_DATE, sequence: seq, channel: 'takeaway',
    checkId: crypto.randomUUID(),
    lines: [{ id: crypto.randomUUID(), variationId, quantityMilli: 1000, discountAmount: 0 }],
  });
  assert.equal(o.statusCode, 201, o.body);

  const paymentId = crypto.randomUUID();
  const p = await req('POST', `/orders/${orderId}/payments`, {
    id: paymentId, method: 'qris_dynamic', amount: harga,
  });
  assert.equal(p.statusCode, 201, p.body);
  return { orderId, paymentId, harga };
}

// Rumus Midtrans: SHA512(order_id + status_code + gross_amount + ServerKey).
// Diketik ulang dari dokumentasi, BUKAN diimpor dari kode -- kalau test dan
// implementasi lahir dari sumber yang sama, keduanya bisa salah bersamaan.
function tandaTangan({ orderId, statusCode, grossAmount, kunci = KUNCI_UJI }) {
  return crypto.createHash('sha512').update(`${orderId}${statusCode}${grossAmount}${kunci}`).digest('hex');
}

function notifikasi(over = {}) {
  const dasar = {
    order_id: over.order_id,
    status_code: over.status_code ?? '200',
    gross_amount: over.gross_amount ?? '20000.00',
    transaction_status: over.transaction_status ?? 'settlement',
    custom_field1: over.custom_field1 ?? tenant.id,
  };
  const body = {
    ...dasar,
    signature_key: over.signature_key ?? tandaTangan({
      orderId: dasar.order_id,
      statusCode: dasar.status_code,
      grossAmount: dasar.gross_amount,
      kunci: over.kunci,
    }),
  };
  return body;
}

function kirimWebhook(body) {
  return app.inject({ method: 'POST', url: '/webhooks/midtrans', payload: body });
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
// G12 -- verifikasi signature
// ============================================================

test('notifikasi bertanda tangan sah -> payment confirmed dan order CLOSED', async () => {
  const { orderId, paymentId } = await buatOrderDanQris(20000);

  const res = await kirimWebhook(notifikasi({ order_id: paymentId }));
  assert.equal(res.statusCode, 200, res.body);

  const p = await query('SELECT status FROM payment WHERE id = $1', [paymentId]);
  assert.equal(p[0].status, 'confirmed');
  const o = await query('SELECT status FROM "order" WHERE id = $1', [orderId]);
  assert.equal(o[0].status, 'closed');
});

// Tanpa ini, siapa pun yang menemukan URL webhook dapat menandai order mana
// pun lunas. Ditolak SEBELUM satu query pun dijalankan.
test('signature salah ditolak, tidak ada yang tersentuh', async () => {
  const { orderId, paymentId } = await buatOrderDanQris();

  for (const signature_key of ['salah', '', 'a'.repeat(128)]) {
    const res = await kirimWebhook(notifikasi({ order_id: paymentId, signature_key }));
    assert.equal(res.statusCode, 401, `${signature_key}: ${res.body}`);
    assert.equal(JSON.parse(res.body).error.code, 'INVALID_SIGNATURE');
  }

  // Field signature yang HILANG sama sekali, bukan yang bernilai salah.
  // Ditulis terpisah karena `?? ` di helper notifikasi() justru MENGISI-nya
  // dengan tanda tangan yang sah saat nilainya undefined -- versi pertama test
  // ini lolos karena itu, bukan karena kodenya benar.
  const tanpaField = notifikasi({ order_id: paymentId });
  delete tanpaField.signature_key;
  const res = await kirimWebhook(tanpaField);
  assert.ok(res.statusCode === 400 || res.statusCode === 401, res.body);

  const p = await query('SELECT status FROM payment WHERE id = $1', [paymentId]);
  assert.equal(p[0].status, 'pending_confirmation');
  const o = await query('SELECT status FROM "order" WHERE id = $1', [orderId]);
  assert.equal(o[0].status, 'open');
});

// Signature dihitung dari kunci server. Kunci lain berarti pengirim lain.
test('signature yang dihitung dengan kunci berbeda ditolak', async () => {
  const { paymentId } = await buatOrderDanQris();
  const res = await kirimWebhook(notifikasi({ order_id: paymentId, kunci: 'SB-Mid-server-KUNCILAIN123456' }));
  assert.equal(res.statusCode, 401, res.body);
});

// Mengubah satu field saja membuat signature tidak lagi cocok -- itu inti
// gunanya. Nominal adalah field yang paling menggiurkan untuk diubah.
test('nominal yang diubah setelah ditandatangani ditolak', async () => {
  const { paymentId } = await buatOrderDanQris(20000);
  const sah = notifikasi({ order_id: paymentId });
  const dipalsukan = { ...sah, gross_amount: '1.00' };

  const res = await kirimWebhook(dipalsukan);
  assert.equal(res.statusCode, 401, res.body);
});

// Kunci kosong (keadaan CI) TIDAK boleh berarti "terima apa adanya". Endpoint
// yang menerima notifikasi tanpa verifikasi lebih berbahaya daripada endpoint
// yang mati.
test('webhook menolak semuanya bila kunci tidak dikonfigurasi', async () => {
  const { buildApp } = await import('../../apps/server/src/app.ts');
  const { createFakeProvider } = await import('../../apps/server/src/modules/payment/providers/index.ts');
  const app2 = await buildApp({ paymentProvider: createFakeProvider(), webhookSecret: '' });
  try {
    const res = await app2.inject({
      method: 'POST', url: '/webhooks/midtrans',
      payload: { order_id: 'x', status_code: '200', gross_amount: '1.00', signature_key: 'apa pun' },
    });
    assert.equal(res.statusCode, 503, res.body);
    assert.equal(JSON.parse(res.body).error.code, 'WEBHOOK_NOT_CONFIGURED');
  } finally {
    await app2.close();
  }
});

// ============================================================
// Tenant: dibaca dari notifikasi, tapi TETAP tunduk RLS
// ============================================================

test('tenant palsu di notifikasi tidak menemukan payment tenant lain', async () => {
  const { orderId, paymentId } = await buatOrderDanQris();
  const lain = await seedTenantBase(appSetup, { suffix: 'WebhookOther' });

  // Signature-nya SAH -- yang dipalsukan hanya tenant-nya. Kalau pencarian
  // payment tidak tunduk RLS, notifikasi ini akan menutup order tenant lain.
  const res = await kirimWebhook(notifikasi({ order_id: paymentId, custom_field1: lain.tenant.id }));
  assert.equal(res.statusCode, 404, res.body);

  const p = await query('SELECT status FROM payment WHERE id = $1', [paymentId]);
  assert.equal(p[0].status, 'pending_confirmation');
  const o = await query('SELECT status FROM "order" WHERE id = $1', [orderId]);
  assert.equal(o[0].status, 'open');
});

// Kode error diperiksa, bukan hanya statusnya: tanpa tenant, RLS memang juga
// tidak menemukan apa pun, jadi selama jawabannya sama persis dengan
// PAYMENT_NOT_FOUND guard ini tidak dapat dibedakan dari perilaku RLS -- dan
// guard yang tidak dapat dibedakan adalah guard yang tidak teruji.
test('notifikasi tanpa tenant ditolak dengan kode tersendiri', async () => {
  const { paymentId } = await buatOrderDanQris();
  const res = await kirimWebhook(notifikasi({ order_id: paymentId, custom_field1: '' }));
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'MISSING_TENANT_REFERENCE');
});

test('order_id yang tidak dikenal -> 404', async () => {
  await buatOrderDanQris();
  const res = await kirimWebhook(notifikasi({ order_id: crypto.randomUUID() }));
  assert.equal(res.statusCode, 404, res.body);
});

// ============================================================
// G13 -- idempotensi
// ============================================================

// Midtrans mengirim ulang notifikasi yang tidak dijawab 200. Notifikasi yang
// sama dua kali tidak boleh berefek dua kali.
test('notifikasi yang sama dua kali tidak berefek dua kali', async () => {
  const { orderId, paymentId } = await buatOrderDanQris(20000);
  const body = notifikasi({ order_id: paymentId });

  const a = await kirimWebhook(body);
  assert.equal(a.statusCode, 200, a.body);
  const b = await kirimWebhook(body);
  assert.equal(b.statusCode, 200, b.body, 'pengiriman ulang tetap dijawab 200, bukan error');

  assert.equal((await query('SELECT id FROM payment')).length, 1);
  const o = await query('SELECT status FROM "order" WHERE id = $1', [orderId]);
  assert.equal(o[0].status, 'closed');
  const outbox = await query(`SELECT id FROM outbox WHERE aggregate_id = $1 AND event_type = 'payment.confirmed'`, [paymentId]);
  assert.equal(outbox.length, 1, 'event konfirmasi hanya sekali');
});

// Notifikasi susulan yang berbeda isinya tidak boleh membalikkan pembayaran
// yang sudah dikonfirmasi -- uangnya sudah masuk.
test('notifikasi expire SETELAH confirmed tidak membatalkan pembayaran', async () => {
  const { orderId, paymentId } = await buatOrderDanQris(20000);
  await kirimWebhook(notifikasi({ order_id: paymentId }));

  const res = await kirimWebhook(notifikasi({ order_id: paymentId, transaction_status: 'expire' }));
  assert.equal(res.statusCode, 200, res.body);

  const p = await query('SELECT status FROM payment WHERE id = $1', [paymentId]);
  assert.equal(p[0].status, 'confirmed', 'pembayaran yang sudah dikonfirmasi tidak dibatalkan notifikasi susulan');
  const o = await query('SELECT status FROM "order" WHERE id = $1', [orderId]);
  assert.equal(o[0].status, 'closed');
});

test('notifikasi expire pada payment pending -> payment failed, order tetap open', async () => {
  const { orderId, paymentId } = await buatOrderDanQris();
  const res = await kirimWebhook(notifikasi({ order_id: paymentId, transaction_status: 'expire' }));
  assert.equal(res.statusCode, 200, res.body);

  const p = await query('SELECT status FROM payment WHERE id = $1', [paymentId]);
  assert.equal(p[0].status, 'failed');
  const o = await query('SELECT status FROM "order" WHERE id = $1', [orderId]);
  assert.equal(o[0].status, 'open');
});

// Status gateway yang tidak dikenal tidak boleh berarti lunas (spec-c:320).
test('transaction_status tak dikenal tidak pernah melunasi', async () => {
  const { orderId, paymentId } = await buatOrderDanQris();
  const res = await kirimWebhook(notifikasi({ order_id: paymentId, transaction_status: 'sesuatu_yang_baru' }));
  assert.equal(res.statusCode, 200, res.body);

  const p = await query('SELECT status FROM payment WHERE id = $1', [paymentId]);
  assert.equal(p[0].status, 'pending_confirmation');
  const o = await query('SELECT status FROM "order" WHERE id = $1', [orderId]);
  assert.equal(o[0].status, 'open');

  // Dan TIDAK ada event apa pun yang dipancarkan. Tanpa pemeriksaan ini,
  // melepas penjagaannya tidak terlihat sama sekali: UPDATE ke status yang
  // sama nilainya tidak mengubah apa-apa, jadi satu-satunya jejak yang
  // tersisa adalah baris outbox yang tidak seharusnya ada.
  // `payment.initiated` sudah ada sejak QRIS dibuat -- yang diperiksa di sini
  // adalah event yang lahir DARI WEBHOOK.
  const outbox = await query(
    `SELECT event_type FROM outbox WHERE aggregate_id = $1 AND event_type <> 'payment.initiated'`,
    [paymentId]
  );
  assert.deepEqual(outbox.map((r) => r.event_type), [], 'status tak dikenal tidak boleh memancarkan event');
});

// Kunci server tidak boleh bocor lewat respons webhook, termasuk saat menolak.
test('respons webhook tidak pernah memuat kunci server', async () => {
  const { paymentId } = await buatOrderDanQris();
  const ditolak = await kirimWebhook(notifikasi({ order_id: paymentId, signature_key: 'salah' }));
  const diterima = await kirimWebhook(notifikasi({ order_id: paymentId }));
  for (const res of [ditolak, diterima]) {
    assert.ok(!res.body.includes(KUNCI_UJI), res.body);
  }
});
