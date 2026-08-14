'use strict';

// T10-T13 (docs/superpowers/plans/PLAN-void-refund-gateway.md) -- refund,
// lewat endpoint yang SAMA dengan void: POST /orders/{orderId}/cancel.
//
// spec-b:235 -- sistem yang memilih operasi, bukan kasir. Order CLOSED
// menghasilkan refund; order OPEN/PAID menghasilkan void. Klien tidak
// mengirim kata "refund" di mana pun.
//
// ## Keputusan user 7 Agustus 2026 -- TIDAK ada payment negatif
//
// spec-b:230 menulis refund membuat "payment negatif", tapi
// `payment.amount` punya CHECK (amount > 0) (0008_payment.sql:17) dan
// `refund.amount` tidak punya CHECK sama sekali. Keduanya tidak bisa benar
// bersamaan. Keputusan user: pakai baris `refund` + stock_movement balik +
// audit, tanpa menyentuh skema payment -- tabel `refund` memang dibuat untuk
// aliran data ini, dan mempertahankan amount > 0 menjaga konsistensi laporan
// keuangan.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');

let owner, appSetup, app, tenant, base, manajer;

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
  base = await seedTenantBase(appSetup, { suffix: 'RefundTest' });
  tenant = base.tenant;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();
  manajer = await buatUser('Manajer');
  await akhiriTarifSeed();
});

const BUSINESS_DATE = '2026-08-07';
let deviceCounter = 0;
let seq = 0;

function req(method, url, payload, headers = {}) {
  const h = { 'x-tenant-id': tenant.id, 'x-actor-id': base.user.id, ...headers };
  const butuhKey = method === 'POST' && (url === '/orders' || url.endsWith('/payments') || url.endsWith('/cancel'));
  if (butuhKey && h['idempotency-key'] === undefined) {
    h['idempotency-key'] = crypto.randomUUID();
  }
  return app.inject({ method, url, payload, headers: h });
}

// Penyetuju harus user LAIN: audit_event punya CHECK yang menolak aktor
// menyetujui dirinya sendiri, jadi seluruh test refund butuh dua user.
async function buatUser(nama, peran = 'outlet_manager') {
  const id = crypto.randomUUID();
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await appSetup.query(
    `INSERT INTO "user" (id, tenant_id, name, is_active) VALUES ($1, $2, $3, true)`,
    [id, tenant.id, `${nama} ${id.slice(0, 6)}`]
  );
  // §5 PLAN-modul-f-identitas.md. Sebelum Modul F, user di sini sengaja tanpa
  // peran -- yang dibutuhkan hanya user AKTIF kedua, karena CHECK di
  // audit_event menolak aktor menyetujui dirinya sendiri.
  //
  // Sekarang `tulisRefund` menuntut penyetuju punya hak `approve_authorization`
  // (`spec-f:42`), jadi peran menjadi bagian dari prasyarat. Default
  // `outlet_manager` -- peran yang memang menyetujui refund di outletnya.
  await appSetup.query(
    `INSERT INTO user_role (id, tenant_id, user_id, role, scope_type, scope_id)
     VALUES ($1, $2, $3, $4, 'outlet', $5)`,
    [crypto.randomUUID(), tenant.id, id, peran, base.outlet.id]
  );
  await appSetup.query('COMMIT');
  return id;
}

// Tarif bawaan seed diakhiri supaya total dapat diprediksi angka per angka --
// test ini soal batas refund, bukan soal pajak.
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
    headers: { 'x-tenant-id': tenant.id },
  });
  assert.equal(res.statusCode, 201, res.body);
  return variationId;
}

async function buatOrder(fx, lines) {
  seq += 1;
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
    lines,
  };
  const res = await req('POST', '/orders', payload);
  assert.equal(res.statusCode, 201, res.body);
  return JSON.parse(res.body);
}

// Order sampai ke CLOSED lewat jalur pembayaran SUNGGUHAN, bukan UPDATE
// langsung: refund hanya berlaku untuk order yang benar-benar sudah tertutup,
// dan menempuh jalurnya juga membuktikan void/refund tidak menabrak apa pun di
// jalur uang yang sudah hidup.
async function buatOrderTertutup(fx, lines) {
  const order = await buatOrder(fx, lines);
  const bayar = await req('POST', `/orders/${order.id}/payments`, {
    id: crypto.randomUUID(), method: 'cash', tenderedAmount: order.total,
  });
  assert.equal(bayar.statusCode, 201, bayar.body);
  assert.equal(JSON.parse(bayar.body).order.status, 'closed');
  return order;
}

function baris(variationId, qtyMilli = 1000) {
  return { id: crypto.randomUUID(), variationId, quantityMilli: qtyMilli, discountAmount: 0 };
}

function refundPayload(over = {}) {
  return { id: crypto.randomUUID(), reasonCode: 'barang_rusak', ...over };
}

function batalkan(orderId, payload, headers = {}) {
  return req('POST', `/orders/${orderId}/cancel`, payload, { 'x-approver-id': manajer, ...headers });
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
// T10 -- sistem memilih refund, bukan void
// ============================================================

test('order CLOSED dibatalkan -> operasi refund, bukan void', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrderTertutup(fx, [baris(await buatVariation(20000))]);

  const res = await batalkan(order.id, refundPayload({ amount: 20000 }));
  assert.equal(res.statusCode, 201, res.body);
  const body = JSON.parse(res.body);
  assert.equal(body.operation, 'refund');
  assert.equal(body.cancelledOrderId, order.id);
  assert.equal(body.refund.amount, 20000);
  // Tidak ada order baru: refund BUKAN void. Yang lahir adalah baris `refund`.
  assert.equal((await query(`SELECT id FROM "order" WHERE status = 'voided'`)).length, 0);
});

test('refund tidak mengubah order asli sedikit pun', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrderTertutup(fx, [baris(await buatVariation(15000))]);

  const sebelum = (await query('SELECT * FROM "order" WHERE id = $1', [order.id]))[0];
  const res = await batalkan(order.id, refundPayload({ amount: 15000 }));
  assert.equal(res.statusCode, 201, res.body);
  const sesudah = (await query('SELECT * FROM "order" WHERE id = $1', [order.id]))[0];

  assert.deepEqual(sesudah, sebelum, 'AC FR-B7 pertama: tidak ada UPDATE pada order asli');
  assert.equal(sesudah.status, 'closed');
});

// Keputusan user 7 Agu 2026. Kalau seseorang kelak menambahkan payment
// negatif, test ini merah dan ia harus membaca keputusannya lebih dulu.
test('refund TIDAK membuat payment negatif; payment penjualan tetap utuh', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrderTertutup(fx, [baris(await buatVariation(30000))]);

  const res = await batalkan(order.id, refundPayload({ amount: 30000 }));
  assert.equal(res.statusCode, 201, res.body);

  const payments = await query('SELECT amount, status FROM payment WHERE order_id = $1', [order.id]);
  assert.equal(payments.length, 1, 'hanya payment penjualan, tidak ada baris kedua');
  assert.equal(payments[0].amount, '30000');
  assert.equal(payments[0].status, 'confirmed');
});

test('alasan void ditolak untuk refund', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrderTertutup(fx, [baris(await buatVariation(10000))]);

  for (const reasonCode of ['salah_input', 'item_habis', 'uji_coba']) {
    const res = await batalkan(order.id, refundPayload({ amount: 10000, reasonCode }));
    assert.equal(res.statusCode, 400, `${reasonCode}: ${res.body}`);
  }
});

test('seluruh alasan refund yang sah diterima', async () => {
  const fx = await setupDeviceAndShift();
  for (const reasonCode of ['barang_rusak', 'pesanan_salah', 'pelanggan_tidak_puas', 'kelebihan_bayar']) {
    const order = await buatOrderTertutup(fx, [baris(await buatVariation(10000))]);
    const res = await batalkan(order.id, refundPayload({ amount: 10000, reasonCode }));
    assert.equal(res.statusCode, 201, `${reasonCode}: ${res.body}`);
  }
});

// ============================================================
// T11 -- penyetuju wajib, dan aktor != penyetuju dijaga DATABASE
// ============================================================

test('refund tanpa X-Approver-Id ditolak', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrderTertutup(fx, [baris(await buatVariation(10000))]);

  const res = await req('POST', `/orders/${order.id}/cancel`, refundPayload({ amount: 10000 }));
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'MISSING_APPROVER_ID');
  assert.equal((await query('SELECT id FROM refund')).length, 0);
});

// spec-b:278 menandai refund "PIN manajer, tidak dapat diubah". PIN belum ada
// (Modul F), tapi keharusan ADANYA penyetuju yang berbeda sudah bisa dan harus
// ditegakkan sekarang -- dan yang menegakkannya adalah CHECK di audit_event,
// bukan sebuah if di aplikasi.
test('penyetuju yang sama dengan aktor ditolak, tidak ada baris tersimpan', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrderTertutup(fx, [baris(await buatVariation(10000))]);

  const payload = refundPayload({ amount: 10000 });
  const res = await batalkan(order.id, payload, { 'x-approver-id': base.user.id });
  assert.ok(res.statusCode >= 400, res.body);

  assert.equal((await query('SELECT id FROM refund WHERE id = $1', [payload.id])).length, 0);
  // ⛔ `type <> 'sale'` — sejak FR-E3 (14 Agustus 2026) penjualan menulis
  // movement `sale` sendiri. Yang diperiksa test-test ini adalah movement
  // BALIK (void/refund); menghitung seluruh baris akan menghitung penjualan
  // yang memang seharusnya ada.
  assert.equal((await query("SELECT id FROM stock_movement WHERE type <> 'sale'")).length, 0, 'stok tidak boleh dikembalikan');
  assert.equal((await query('SELECT id FROM audit_event')).length, 0);
});

test('penyetuju milik tenant lain ditolak', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrderTertutup(fx, [baris(await buatVariation(10000))]);
  const lain = await seedTenantBase(appSetup, { suffix: 'RefundOther' });

  const payload = refundPayload({ amount: 10000 });
  const res = await batalkan(order.id, payload, { 'x-approver-id': lain.user.id });
  assert.equal(res.statusCode, 404, res.body);
  // Kode error diperiksa, bukan hanya statusnya. Tanpa ini, guard penyetuju
  // di jalur refund TIDAK DAPAT dibedakan dari validasi yang dilakukan
  // recordAuditEvent beberapa langkah kemudian -- sabotase membuktikannya:
  // guard dimatikan, suite tetap hijau. Dan pesannya bukan detail kosmetik:
  // ACTOR_NOT_FOUND memberi tahu manajer bahwa KASIR-nya yang bermasalah.
  assert.equal(JSON.parse(res.body).error.code, 'APPROVER_NOT_FOUND');
  assert.equal((await query('SELECT id FROM refund WHERE id = $1', [payload.id])).length, 0);
});

test('refund menyimpan approved_by dan created_by yang berbeda', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrderTertutup(fx, [baris(await buatVariation(10000))]);

  const res = await batalkan(order.id, refundPayload({ amount: 10000 }));
  assert.equal(res.statusCode, 201, res.body);

  const rows = await query('SELECT created_by, approved_by, order_id, reason_code FROM refund');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].created_by, base.user.id);
  assert.equal(rows[0].approved_by, manajer);
  assert.equal(rows[0].order_id, order.id);
  assert.equal(rows[0].reason_code, 'barang_rusak');
});

// ============================================================
// T12 -- batas refund kumulatif (AC FR-B7 ketiga)
// ============================================================

test('refund melebihi total order ditolak', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrderTertutup(fx, [baris(await buatVariation(20000))]);

  const res = await batalkan(order.id, refundPayload({ amount: 20001 }));
  assert.equal(res.statusCode, 409, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'REFUND_EXCEEDS_TOTAL');
  assert.equal((await query('SELECT id FROM refund')).length, 0);
});

// Contoh persis dari spec-b:271 -- "sudah direfund Rp 60.000 dari total
// Rp 93.600, mencoba refund Rp 50.000, ditolak; maksimum yang tersisa
// Rp 33.600." Angkanya harus MUNCUL di pesan: kasir perlu tahu berapa yang
// masih bisa dikembalikan tanpa menebak.
test('refund parsial berulang: kumulatif dibatasi, sisa disebut di pesan', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrderTertutup(fx, [baris(await buatVariation(93600))]);
  assert.equal(order.total, 93600);

  // `lines: []` -- uang kembali, barang tidak. Itu keadaan nyata (kompensasi
  // keluhan, kelebihan bayar), dan harus dinyatakan, bukan ditebak server.
  const pertama = await batalkan(order.id, refundPayload({ amount: 60000, lines: [] }));
  assert.equal(pertama.statusCode, 201, pertama.body);

  const kedua = await batalkan(order.id, refundPayload({ amount: 50000, lines: [] }));
  assert.equal(kedua.statusCode, 409, kedua.body);
  const pesan = JSON.parse(kedua.body).error.message;
  assert.ok(pesan.includes('33600'), `pesan harus menyebut sisa 33600: ${pesan}`);

  // Sisanya PERSIS masih bisa direfund.
  const ketiga = await batalkan(order.id, refundPayload({ amount: 33600, lines: [] }));
  assert.equal(ketiga.statusCode, 201, ketiga.body);

  const rows = await query('SELECT amount FROM refund ORDER BY amount');
  assert.deepEqual(rows.map((r) => r.amount), ['33600', '60000']);
  assert.equal((await query("SELECT id FROM stock_movement WHERE type <> 'sale'")).length, 0, 'tidak ada barang yang kembali');

  // Setelah habis, satu rupiah pun ditolak.
  const keempat = await batalkan(order.id, refundPayload({ amount: 1, lines: [] }));
  assert.equal(keempat.statusCode, 409, keempat.body);
});

// Refund uang parsial TANPA daftar baris akan mengembalikan seluruh stok
// order, padahal pelanggan hanya menerima sebagian uangnya. Barang yang tidak
// pernah kembali akan tercatat ada di rak, dan itu baru ketahuan saat stock
// opname. Server tidak boleh menebaknya.
test('refund sebagian tanpa `lines` ditolak, bukan ditebak', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrderTertutup(fx, [baris(await buatVariation(50000))]);

  const res = await batalkan(order.id, refundPayload({ amount: 20000 }));
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'REFUND_LINES_REQUIRED');
  assert.equal((await query('SELECT id FROM refund')).length, 0);
  assert.equal((await query("SELECT id FROM stock_movement WHERE type <> 'sale'")).length, 0);
});

// Refund kedua atas order yang sama juga harus eksplisit, walau nominalnya
// kebetulan menghabiskan sisa: barang mana yang kembali tidak dapat
// disimpulkan dari angka uang.
test('refund penuh atas sisa, setelah refund sebelumnya, tetap menuntut `lines`', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrderTertutup(fx, [baris(await buatVariation(50000))]);

  const pertama = await batalkan(order.id, refundPayload({ amount: 20000, lines: [] }));
  assert.equal(pertama.statusCode, 201, pertama.body);

  const kedua = await batalkan(order.id, refundPayload({ amount: 30000 }));
  assert.equal(kedua.statusCode, 400, kedua.body);
  assert.equal(JSON.parse(kedua.body).error.code, 'REFUND_LINES_REQUIRED');
});

test('amount nol, negatif, atau bukan bilangan bulat ditolak', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrderTertutup(fx, [baris(await buatVariation(10000))]);

  for (const amount of [0, -1, 1.5, '10000', null, undefined]) {
    const res = await batalkan(order.id, refundPayload({ amount }));
    assert.equal(res.statusCode, 400, `${JSON.stringify(amount)}: ${res.body}`);
  }
  assert.equal((await query('SELECT id FROM refund')).length, 0);
});

// ============================================================
// T13 -- stock_movement type refund + audit dengan aktor DAN penyetuju
// ============================================================

test('refund penuh mengembalikan seluruh baris, type refund, delta positif', async () => {
  const fx = await setupDeviceAndShift();
  const v1 = await buatVariation(10000);
  const v2 = await buatVariation(20000);
  const order = await buatOrderTertutup(fx, [baris(v1, 2000), baris(v2, 1000)]);

  const res = await batalkan(order.id, refundPayload({ amount: order.total }));
  assert.equal(res.statusCode, 201, res.body);

  const movements = await query("SELECT variation_id, type, delta, order_id FROM stock_movement WHERE type <> 'sale' ORDER BY delta");
  assert.equal(movements.length, 2);
  assert.deepEqual(movements.map((m) => m.type), ['refund', 'refund']);
  assert.deepEqual(movements.map((m) => m.delta), ['1000', '2000']);
  for (const m of movements) assert.equal(m.order_id, order.id);
});

test('audit refund memuat aktor DAN penyetuju', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrderTertutup(fx, [baris(await buatVariation(10000))]);

  const res = await batalkan(order.id, refundPayload({ amount: 10000, reasonCode: 'lainnya', reasonNote: 'pelanggan komplain rasa' }));
  assert.equal(res.statusCode, 201, res.body);

  const events = await query('SELECT * FROM audit_event');
  assert.equal(events.length, 1);
  assert.equal(events[0].event_type, 'order.refunded');
  assert.equal(events[0].entity_id, order.id);
  assert.equal(events[0].actor_user_id, base.user.id);
  assert.equal(events[0].approver_user_id, manajer);
  assert.equal(events[0].reason_code, 'lainnya');
  assert.equal(events[0].reason_note, 'pelanggan komplain rasa');
});

// Invariant #1: refund + stock_movement + audit dalam SATU transaksi.
// recorded_at = transaction_timestamp(), tetap sepanjang transaksi.
test('refund, stock_movement, dan audit_event berbagi satu stempel transaksi', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrderTertutup(fx, [baris(await buatVariation(10000)), baris(await buatVariation(20000))]);

  const res = await batalkan(order.id, refundPayload({ amount: order.total }));
  assert.equal(res.statusCode, 201, res.body);

  const [r] = await query('SELECT recorded_at FROM refund');
  const movements = await query("SELECT recorded_at FROM stock_movement WHERE type <> 'sale'");
  const events = await query('SELECT recorded_at FROM audit_event');
  assert.equal(movements.length, 2);
  const stempel = r.recorded_at.toISOString();
  for (const m of movements) assert.equal(m.recorded_at.toISOString(), stempel);
  assert.equal(events[0].recorded_at.toISOString(), stempel);
});

// Refund parsial hanya mengembalikan baris yang dipilih kasir (spec-b:233).
// Tanpa daftar baris, refund parsial akan mengembalikan SELURUH stok padahal
// pelanggan hanya mengembalikan sebagian pesanan.
test('refund parsial hanya mengembalikan baris yang disebut', async () => {
  const fx = await setupDeviceAndShift();
  const v1 = await buatVariation(10000);
  const v2 = await buatVariation(20000);
  const order = await buatOrderTertutup(fx, [baris(v1, 1000), baris(v2, 1000)]);
  const lineV2 = order.lines.find((l) => l.variationId === v2);

  const res = await batalkan(order.id, refundPayload({
    amount: 20000,
    lines: [{ lineId: lineV2.id, quantityMilli: 1000 }],
  }));
  assert.equal(res.statusCode, 201, res.body);

  const movements = await query("SELECT variation_id, delta FROM stock_movement WHERE type <> 'sale'");
  assert.equal(movements.length, 1, 'hanya baris yang dipilih');
  assert.equal(movements[0].variation_id, v2);
  assert.equal(movements[0].delta, '1000');
});

test('baris refund melebihi kuantitas yang terjual ditolak', async () => {
  const fx = await setupDeviceAndShift();
  const v = await buatVariation(10000);
  const order = await buatOrderTertutup(fx, [baris(v, 2000)]);
  const line = order.lines[0];

  const res = await batalkan(order.id, refundPayload({
    amount: 10000,
    lines: [{ lineId: line.id, quantityMilli: 2001 }],
  }));
  assert.equal(res.statusCode, 409, res.body);
  assert.equal((await query("SELECT id FROM stock_movement WHERE type <> 'sale'")).length, 0);
});

// Kumulatif per baris, bukan hanya per permintaan: dua refund parsial yang
// masing-masing sah bisa bersama-sama mengembalikan lebih banyak daripada
// yang pernah terjual. Bentuk kegagalannya sama dengan batas uang -- stok
// mengembang, dan baru ketahuan saat stock opname.
test('kumulatif restock per baris tidak melebihi kuantitas terjual', async () => {
  const fx = await setupDeviceAndShift();
  const v = await buatVariation(10000);
  const order = await buatOrderTertutup(fx, [baris(v, 2000)]);
  const line = order.lines[0];

  const pertama = await batalkan(order.id, refundPayload({
    amount: 10000, lines: [{ lineId: line.id, quantityMilli: 1500 }],
  }));
  assert.equal(pertama.statusCode, 201, pertama.body);

  const kedua = await batalkan(order.id, refundPayload({
    amount: 5000, lines: [{ lineId: line.id, quantityMilli: 600 }],
  }));
  assert.equal(kedua.statusCode, 409, kedua.body);

  const sisa = await batalkan(order.id, refundPayload({
    amount: 5000, lines: [{ lineId: line.id, quantityMilli: 500 }],
  }));
  assert.equal(sisa.statusCode, 201, sisa.body);

  const movements = await query("SELECT delta FROM stock_movement WHERE type <> 'sale' ORDER BY delta");
  assert.deepEqual(movements.map((m) => m.delta), ['500', '1500']);
});

test('lineId milik order lain ditolak, tidak ada baris tersimpan', async () => {
  const fx = await setupDeviceAndShift();
  const orderA = await buatOrderTertutup(fx, [baris(await buatVariation(10000))]);
  const orderB = await buatOrderTertutup(fx, [baris(await buatVariation(10000))]);

  const payload = refundPayload({ amount: 10000, lines: [{ lineId: orderB.lines[0].id, quantityMilli: 1000 }] });
  const res = await batalkan(orderA.id, payload);
  assert.equal(res.statusCode, 404, res.body);
  assert.equal((await query('SELECT id FROM refund WHERE id = $1', [payload.id])).length, 0);
  assert.equal((await query("SELECT id FROM stock_movement WHERE type <> 'sale'")).length, 0);
});

// ============================================================
// T14 (bagian refund) -- idempotency
// ============================================================

test('retry dengan Idempotency-Key sama tidak menghasilkan refund kedua', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrderTertutup(fx, [baris(await buatVariation(20000))]);
  const payload = refundPayload({ amount: 20000 });
  const key = crypto.randomUUID();

  const a = await batalkan(order.id, payload, { 'idempotency-key': key });
  assert.equal(a.statusCode, 201, a.body);
  const b = await batalkan(order.id, payload, { 'idempotency-key': key });
  assert.equal(b.statusCode, 201, b.body);
  assert.deepEqual(JSON.parse(b.body), JSON.parse(a.body), 'respons asli dikembalikan apa adanya');

  assert.equal((await query('SELECT id FROM refund')).length, 1);
  assert.equal((await query("SELECT id FROM stock_movement WHERE type <> 'sale'")).length, 1, 'stok tidak dikembalikan dua kali');
  assert.equal((await query('SELECT id FROM audit_event')).length, 1);
});

test('Idempotency-Key sama dengan body berbeda -> 422', async () => {
  const fx = await setupDeviceAndShift();
  const order = await buatOrderTertutup(fx, [baris(await buatVariation(20000))]);
  const key = crypto.randomUUID();

  const a = await batalkan(order.id, refundPayload({ amount: 10000, lines: [] }), { 'idempotency-key': key });
  assert.equal(a.statusCode, 201, a.body);
  const b = await batalkan(order.id, refundPayload({ amount: 5000, lines: [] }), { 'idempotency-key': key });
  assert.equal(b.statusCode, 422, b.body);
  assert.equal((await query('SELECT id FROM refund')).length, 1);
});

// ---------------------------------------------------------------------------
// §5 PLAN-modul-f-identitas.md -- penegakan RBAC pada penyetuju refund.
//
// Diletakkan di berkas ini, bukan di tests/identity/, karena ia menuntut order
// yang benar-benar TERTUTUP lewat jalur pembayaran sungguhan -- dan harness
// itu hidup di sini. Guard-nya sendiri (`assertBoleh`) diuji terpisah dan
// tanpa database di tests/identity/rbac-penegakan.test.js.
// ---------------------------------------------------------------------------

test('⛔ kasir TIDAK dapat menjadi penyetuju refund, meski id-nya sah dan aktif', async () => {
  // `spec-f:42` -- "Menyetujui void/refund/diskon: Kasir ❌".
  // `spec-b:278` -- refund selalu PIN manajer, tidak dapat diubah.
  //
  // Sebelum §5, satu-satunya yang berdiri di sini adalah
  // `assertApproverVisible`, yang hanya membuktikan penyetujunya ADA dan
  // AKTIF. Kasir mana pun lolos, dan pemisahan tugas `spec-f:91` runtuh tanpa
  // satu pun aturan terlihat dilanggar.
  const fx = await setupDeviceAndShift();
  const order = await buatOrderTertutup(fx, [baris(await buatVariation(20000))]);
  const kasir = await buatUser('Kasir Penyetuju', 'cashier');

  const res = await batalkan(order.id, refundPayload({ amount: 5000, lines: [] }), {
    'x-approver-id': kasir,
  });

  assert.equal(res.statusCode, 403, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'FORBIDDEN');
  // Pesan menunjuk PENYETUJU, bukan aktor. Manajer yang berdiri di kasir
  // dengan pelanggan menunggu akan mencari masalah di tempat yang keliru
  // kalau pesannya menyebut kasirnya -- pelajaran yang sama yang melahirkan
  // APPROVER_NOT_FOUND (CLAUDE.md, temuan F1 bentuk kelima).
  assert.match(JSON.parse(res.body).error.message, /menyetujui refund/i);

  // Dan TIDAK ADA JEJAK yang tertulis. Refund yang ditolak otorisasinya tidak
  // boleh meninggalkan baris refund, stok, maupun audit.
  assert.equal((await query('SELECT id FROM refund')).length, 0);
  assert.equal((await query("SELECT id FROM stock_movement WHERE type <> 'sale'")).length, 0);
});

test('akuntan tidak dapat menyetujui refund; manajer outlet dapat', async () => {
  // Sisi kedua. Tanpa ini, `assertBoleh` yang selalu melempar akan membuat
  // test di atas hijau -- yang membedakan guard dari dinding adalah bahwa ada
  // orang yang LEWAT.
  const fx = await setupDeviceAndShift();
  const akuntan = await buatUser('Akuntan', 'accountant');

  const a = await buatOrderTertutup(fx, [baris(await buatVariation(20000))]);
  const ditolak = await batalkan(a.id, refundPayload({ amount: 5000, lines: [] }), {
    'x-approver-id': akuntan,
  });
  assert.equal(ditolak.statusCode, 403, ditolak.body);

  const b = await buatOrderTertutup(fx, [baris(await buatVariation(20000))]);
  const diterima = await batalkan(b.id, refundPayload({ amount: 5000, lines: [] }));
  assert.equal(diterima.statusCode, 201, diterima.body);
});

test('void TIDAK terpengaruh RBAC penyetuju -- ia memang tidak punya penyetuju', async () => {
  // Keputusan user 1 Agustus 2026: void berjalan TANPA PIN manajer, cukup
  // alasan daftar tertutup + audit + restock. Guard penyetuju karena itu
  // diletakkan di jalur refund, bukan di awal handler -- pemeriksaan yang
  // berjalan sebelum server memilih operasinya akan menolak void yang sah
  // hanya karena perangkat menyertakan header nyasar.
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx, [baris(await buatVariation(20000))]);
  const kasir = await buatUser('Kasir Nyasar', 'cashier');

  seq += 1;
  const res = await batalkan(
    order.id,
    refundPayload({
      // Daftar alasan void BERBEDA dari refund (`spec-b` §B.4) -- `barang_rusak`
      // milik refund dan ditolak di sini.
      reasonCode: 'salah_input',
      receiptNumber: `K1-20260807-${String(seq).padStart(4, '0')}`,
      sequence: seq,
    }),
    { 'x-approver-id': kasir }
  );

  assert.equal(res.statusCode, 201, res.body);
  assert.equal(JSON.parse(res.body).operation, 'void');
});

// --- Buku kas: refund tunai mengurangi laci (spec-d:14) ---

test('⛔ refund atas penjualan TUNAI menulis cash_movement negatif', async () => {
  // Uang diserahkan kembali ke pelanggan, jadi ia keluar dari laci. Tanpa
  // baris ini, saldo laci menurut server tetap seolah penjualannya utuh — dan
  // kasir terlihat kurang sebesar nilai refund saat tutup kas.
  const fx = await setupDeviceAndShift();
  const order = await buatOrderTertutup(fx, [baris(await buatVariation(30000))]);

  const res = await batalkan(order.id, refundPayload({ amount: 30000 }));
  assert.equal(res.statusCode, 201, res.body);

  const m = await query(
    `SELECT type, delta, order_id, counterpart_type FROM cash_movement
      WHERE order_id = $1 AND type = 'refund'`,
    [order.id]
  );
  assert.equal(m.length, 1, 'tepat satu movement refund');
  assert.equal(m[0].delta, '-30000', 'delta harus NEGATIF — uang keluar laci');
  assert.equal(m[0].counterpart_type, 'refund');
});

test('⛔ refund.method tersimpan, diturunkan dari pembayaran order aslinya', async () => {
  // Kolomnya ditambahkan 14 Agustus 2026 (migrasi 0021). Ia yang menjawab
  // "apakah refund ini menyentuh laci" — dan jawabannya harus TERSIMPAN,
  // bukan disimpulkan ulang setiap kali laporan dibaca.
  const fx = await setupDeviceAndShift();
  const order = await buatOrderTertutup(fx, [baris(await buatVariation(12000))]);

  const res = await batalkan(order.id, refundPayload({ amount: 12000 }));
  assert.equal(res.statusCode, 201, res.body);

  const r = await query('SELECT method FROM refund WHERE order_id = $1', [order.id]);
  assert.equal(r.length, 1);
  assert.equal(r[0].method, 'cash');
});

test('⛔ saldo laci server = penjualan − refund, dan itu satu penjumlahan', async () => {
  // `spec-d:14`. Yang diperiksa di sini bukan satu baris, melainkan bahwa
  // keduanya BERSAMA menghasilkan posisi yang benar: jual 30.000 lalu refund
  // penuh mengembalikan laci ke nol pergerakan.
  const fx = await setupDeviceAndShift();
  const order = await buatOrderTertutup(fx, [baris(await buatVariation(30000))]);
  await batalkan(order.id, refundPayload({ amount: 30000 }));

  // ⛔ `opening_float` DIKECUALIKAN, persis seperti `saldoSeharusnya`
  // melakukannya: modal awal sudah menjadi `shift.opening_float`, dan
  // menjumlahkan keduanya menghitungnya dua kali.
  const m = await query(
    `SELECT delta FROM cash_movement WHERE shift_id = $1 AND type <> 'opening_float'`,
    [fx.shiftId]
  );
  const jumlah = m.reduce((s, r) => s + Number(r.delta), 0);
  assert.equal(jumlah, 0, `pergerakan laci harus nol, dapat ${jumlah}`);
});
