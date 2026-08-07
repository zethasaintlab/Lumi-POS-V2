'use strict';

// T6-T9 (docs/superpowers/plans/PLAN-void-refund-gateway.md) -- void lewat
// POST /orders/{orderId}/cancel.
//
// spec-b:235 -- "Kasir tidak memilih 'void' atau 'refund' -- kasir menekan
// 'Batalkan transaksi', dan SISTEM menentukan operasi mana yang berlaku."
// Karena itu satu endpoint, dan responsnya menyebut operasi mana yang
// dilakukan supaya UI bisa menjelaskannya ke kasir.
//
// AC FR-B7 pertama: "Tidak ada UPDATE pada order asli saat void maupun
// refund." Itu memaksa satu pembacaan skema -- lihat komentar panjang di
// test "voided_by_order_id ada di order PEMBATAL" di bawah.

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
  base = await seedTenantBase(appSetup, { suffix: 'VoidTest' });
  tenant = base.tenant;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();
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

// Baris dikirim apa adanya supaya test bisa memakai lebih dari satu variation
// -- restock harus menulis SATU stock_movement per baris, bukan satu per
// order.
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

function batalkanPayload(over = {}) {
  seq += 1;
  return {
    id: crypto.randomUUID(),
    receiptNumber: `K1-20260807-${String(seq).padStart(4, '0')}`,
    sequence: seq,
    reasonCode: 'salah_input',
    ...over,
  };
}

function batalkan(orderId, payload, headers = {}) {
  return req('POST', `/orders/${orderId}/cancel`, payload, headers);
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

async function baris(variationId, qtyMilli = 1000) {
  return { id: crypto.randomUUID(), variationId, quantityMilli: qtyMilli, discountAmount: 0 };
}

// ============================================================
// T6 -- sistem memilih operasi, dan order asli tidak berubah
// ============================================================

test('order OPEN dibatalkan -> operasi void, bukan refund', async () => {
  const fx = await setupDeviceAndShift();
  const v = await buatVariation(20000);
  const order = await buatOrder(fx, [await baris(v)]);

  const res = await batalkan(order.id, batalkanPayload());
  assert.equal(res.statusCode, 201, res.body);
  const body = JSON.parse(res.body);
  // AC FR-B7 kedua: "Sistem memilih operasi berdasarkan state, kasir tidak
  // memilihnya." Klien TIDAK mengirim kata "void" di mana pun -- server yang
  // menjawabnya.
  assert.equal(body.operation, 'void');
  assert.equal(body.order.status, 'voided');
});

// AC FR-B7 pertama: "Tidak ada UPDATE pada order asli saat void maupun
// refund." Dibaca ulang dari database, bukan dari respons -- respons bisa saja
// benar sementara barisnya sudah berubah.
test('order asli TIDAK berubah sedikit pun setelah void', async () => {
  const fx = await setupDeviceAndShift();
  const v = await buatVariation(35000);
  const order = await buatOrder(fx, [await baris(v)]);

  const sebelum = (await query('SELECT * FROM "order" WHERE id = $1', [order.id]))[0];
  const res = await batalkan(order.id, batalkanPayload());
  assert.equal(res.statusCode, 201, res.body);
  const sesudah = (await query('SELECT * FROM "order" WHERE id = $1', [order.id]))[0];

  assert.deepEqual(sesudah, sebelum, 'satu kolom pun tidak boleh berubah pada order asli');
  assert.equal(sesudah.status, 'open', 'status asli tetap open, bukan voided');
});

// Kolom `voided_by_order_id` hanya punya SATU pembacaan yang tidak melanggar
// invariant #2 dan AC FR-B7 pertama: ia ada di baris order PEMBATAL dan
// menunjuk order yang dibatalkan.
//
// Pembacaan sebaliknya -- kolom di order ASLI menunjuk pembatalnya -- menuntut
// UPDATE pada order asli, karena order pembatal belum ada saat order asli
// ditulis. Itu dilarang eksplisit. Namanya memang terbaca terbalik untuk
// pembacaan yang tersisa ini, dan itu dicatat sebagai temuan, bukan diam-diam
// dibetulkan sendiri.
test('voided_by_order_id ada di order PEMBATAL dan menunjuk order asli', async () => {
  const fx = await setupDeviceAndShift();
  const v = await buatVariation(15000);
  const order = await buatOrder(fx, [await baris(v)]);

  const res = await batalkan(order.id, batalkanPayload());
  const body = JSON.parse(res.body);

  const rows = await query('SELECT id, status, voided_by_order_id FROM "order" ORDER BY sequence');
  assert.equal(rows.length, 2, 'void menambah baris order, tidak mengubah yang ada');
  const asli = rows.find((r) => r.id === order.id);
  const pembatal = rows.find((r) => r.id === body.order.id);

  assert.equal(asli.voided_by_order_id, null, 'order asli tidak disentuh sama sekali');
  assert.equal(pembatal.status, 'voided');
  assert.equal(pembatal.voided_by_order_id, order.id);
});

test('order PAID juga di-void (belum di-settle)', async () => {
  const fx = await setupDeviceAndShift();
  const v = await buatVariation(10000);
  const order = await buatOrder(fx, [await baris(v)]);

  // Bayar kurang dari total supaya order berhenti di PAID tanpa lanjut CLOSED?
  // Tidak: jalur tunai menutup order begitu lunas. Yang dibutuhkan di sini
  // adalah status PAID, jadi ditulis langsung -- test ini soal void, bukan
  // soal bagaimana order sampai ke PAID.
  await query(`UPDATE "order" SET status = 'paid' WHERE id = $1`, [order.id]);

  const res = await batalkan(order.id, batalkanPayload());
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(JSON.parse(res.body).operation, 'void');
});

test('order VOIDED tidak dapat dibatalkan lagi', async () => {
  const fx = await setupDeviceAndShift();
  const v = await buatVariation(10000);
  const order = await buatOrder(fx, [await baris(v)]);
  const pertama = await batalkan(order.id, batalkanPayload());
  assert.equal(pertama.statusCode, 201, pertama.body);
  const idPembatal = JSON.parse(pertama.body).order.id;

  const res = await batalkan(idPembatal, batalkanPayload());
  assert.equal(res.statusCode, 409, res.body);
});

// Order asli tetap OPEN setelah di-void (tidak ada UPDATE), jadi tidak ada
// apa pun di STATUS-nya yang mencegah void kedua. Yang mencegahnya adalah
// pemeriksaan "sudah ada pembatal yang menunjuk order ini" -- tanpa itu, dua
// permintaan dengan Idempotency-Key berbeda akan me-restock stok dua kali.
test('order yang sudah di-void tidak dapat di-void lagi walau statusnya masih open', async () => {
  const fx = await setupDeviceAndShift();
  const v = await buatVariation(10000);
  const order = await buatOrder(fx, [await baris(v)]);

  const pertama = await batalkan(order.id, batalkanPayload());
  assert.equal(pertama.statusCode, 201, pertama.body);

  // Idempotency-Key BERBEDA, jadi ini bukan retry -- ini permintaan baru.
  const kedua = await batalkan(order.id, batalkanPayload());
  assert.equal(kedua.statusCode, 409, kedua.body);
  assert.equal(JSON.parse(kedua.body).error.code, 'ORDER_ALREADY_VOIDED');

  const movements = await query('SELECT id FROM stock_movement WHERE order_id = $1', [order.id]);
  assert.equal(movements.length, 1, 'stok tidak boleh dikembalikan dua kali');
});

// Kode error diperiksa, bukan hanya status: route yang belum terdaftar juga
// menjawab 404, dan test yang hanya melihat angkanya akan hijau sebelum satu
// baris implementasi pun ditulis.
test('order yang tidak ada -> 404 NOT_FOUND', async () => {
  await setupDeviceAndShift();
  const res = await batalkan(crypto.randomUUID(), batalkanPayload());
  assert.equal(res.statusCode, 404, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'NOT_FOUND');
});

// ============================================================
// T7 -- restock + audit, dalam SATU transaksi (invariant #1)
// ============================================================

test('void menulis satu stock_movement per baris, type void, delta POSITIF', async () => {
  const fx = await setupDeviceAndShift();
  const v1 = await buatVariation(10000);
  const v2 = await buatVariation(25000);
  const order = await buatOrder(fx, [await baris(v1, 2000), await baris(v2, 500)]);

  const res = await batalkan(order.id, batalkanPayload({ reasonCode: 'pelanggan_batal' }));
  assert.equal(res.statusCode, 201, res.body);

  const movements = await query(
    'SELECT variation_id, type, delta, reason_code, order_id, outlet_id, device_id FROM stock_movement ORDER BY delta'
  );
  assert.equal(movements.length, 2);
  // Void MENGEMBALIKAN stok, jadi delta positif dan besarnya persis kuantitas
  // yang terjual (x1000).
  assert.deepEqual(movements.map((m) => m.delta), ['500', '2000']);
  assert.deepEqual(movements.map((m) => m.type), ['void', 'void']);
  assert.deepEqual(movements.map((m) => m.variation_id).sort(), [v2, v1].sort());
  for (const m of movements) {
    assert.equal(m.reason_code, 'pelanggan_batal');
    assert.equal(m.order_id, order.id, 'movement menunjuk order yang DIBATALKAN, bukan pembatalnya');
    assert.equal(m.outlet_id, base.outlet.id);
    assert.equal(m.device_id, fx.deviceId);
  }
});

test('void menulis audit_event dengan aktor, alasan, dan TANPA penyetuju', async () => {
  const fx = await setupDeviceAndShift();
  const v = await buatVariation(10000);
  const order = await buatOrder(fx, [await baris(v)]);

  const res = await batalkan(order.id, batalkanPayload({ reasonCode: 'lainnya', reasonNote: 'salah tekan tombol' }));
  assert.equal(res.statusCode, 201, res.body);

  const events = await query('SELECT * FROM audit_event');
  assert.equal(events.length, 1);
  const e = events[0];
  assert.equal(e.event_type, 'order.voided');
  assert.equal(e.entity_type, 'order');
  assert.equal(e.entity_id, order.id);
  assert.equal(e.actor_user_id, base.user.id);
  // Keputusan user 1 Agu 2026: void TANPA PIN manajer. Kolomnya harus NULL,
  // bukan diisi aktor sendiri -- CHECK database menolak yang terakhir.
  assert.equal(e.approver_user_id, null);
  assert.equal(e.reason_code, 'lainnya');
  assert.equal(e.reason_note, 'salah tekan tombol');
});

// Invariant #1: satu pembatalan = SATU transaksi. `recorded_at` default-nya
// now() = transaction_timestamp(), yang TETAP sepanjang satu transaksi dan
// berbeda antar transaksi pada resolusi mikrodetik. Kalau restock atau audit
// ditulis di transaksi terpisah, stempelnya akan berbeda.
test('order pembatal, stock_movement, audit_event, dan outbox berbagi satu stempel transaksi', async () => {
  const fx = await setupDeviceAndShift();
  const v1 = await buatVariation(10000);
  const v2 = await buatVariation(20000);
  const order = await buatOrder(fx, [await baris(v1), await baris(v2)]);

  const res = await batalkan(order.id, batalkanPayload());
  const body = JSON.parse(res.body);

  const [pembatal] = await query('SELECT recorded_at FROM "order" WHERE id = $1', [body.order.id]);
  const movements = await query('SELECT recorded_at FROM stock_movement');
  const events = await query('SELECT recorded_at FROM audit_event');

  assert.equal(movements.length, 2);
  assert.equal(events.length, 1);

  const stempel = pembatal.recorded_at.toISOString();
  for (const r of movements) assert.equal(r.recorded_at.toISOString(), stempel, 'stock_movement di transaksi lain');
  for (const r of events) assert.equal(r.recorded_at.toISOString(), stempel, 'audit_event di transaksi lain');

  // `outbox` tidak punya kolom waktu sama sekali (0013_server_only.sql), jadi
  // ia tidak bisa ikut perbandingan stempel. Keberadaannya diperiksa di sini;
  // bahwa ia ter-rollback bersama yang lain dibuktikan test atomisitas.
  const outbox = await query('SELECT id FROM outbox WHERE aggregate_id = $1', [body.order.id]);
  assert.equal(outbox.length, 1);
});

// Kegagalan dipicu lewat DATA yang melanggar constraint (pola sama dengan
// tests/ordering/orders-atomicity.test.js), bukan lewat mock.
test('atomisitas: nomor struk pembatal bentrok -> nol baris di SEMUA tabel', async () => {
  const fx = await setupDeviceAndShift();
  const v = await buatVariation(10000);
  const order = await buatOrder(fx, [await baris(v)]);

  const payload = batalkanPayload({ sequence: order.sequence, receiptNumber: order.receiptNumber });
  const res = await batalkan(order.id, payload);
  assert.equal(res.statusCode, 409, res.body);

  assert.equal((await query('SELECT id FROM "order" WHERE id = $1', [payload.id])).length, 0);
  assert.equal((await query('SELECT id FROM stock_movement')).length, 0, 'stok tidak boleh dikembalikan');
  assert.equal((await query('SELECT id FROM audit_event')).length, 0, 'audit tidak boleh tertinggal');
  // Klaim idempotency ikut ter-rollback -- kalau tidak, retry akan dianggap
  // cache hit terhadap sesuatu yang tidak pernah tersimpan.
  const keys = await query('SELECT key FROM idempotency_key');
  assert.equal(keys.length, 1, 'hanya key milik POST /orders yang tersisa');
});

// ============================================================
// T8 -- alasan daftar tertutup
// ============================================================

test('alasan di luar daftar void ditolak', async () => {
  const fx = await setupDeviceAndShift();
  const v = await buatVariation(10000);
  const order = await buatOrder(fx, [await baris(v)]);

  for (const reasonCode of ['barang_rusak', 'alasan_bebas', '', 'Salah Input']) {
    const res = await batalkan(order.id, batalkanPayload({ reasonCode }));
    assert.equal(res.statusCode, 400, `${reasonCode}: ${res.body}`);
    assert.equal(JSON.parse(res.body).error.code, 'VALIDATION_ERROR');
  }
  assert.equal((await query('SELECT id FROM "order" WHERE status = $1', ['voided'])).length, 0);
});

test('`lainnya` tanpa catatan >= 10 karakter ditolak', async () => {
  const fx = await setupDeviceAndShift();
  const v = await buatVariation(10000);
  const order = await buatOrder(fx, [await baris(v)]);

  for (const reasonNote of [undefined, null, '', 'pendek', '         ']) {
    const res = await batalkan(order.id, batalkanPayload({ reasonCode: 'lainnya', reasonNote }));
    assert.equal(res.statusCode, 400, `${JSON.stringify(reasonNote)}: ${res.body}`);
  }
  const ok = await batalkan(order.id, batalkanPayload({ reasonCode: 'lainnya', reasonNote: 'sepuluh kar' }));
  assert.equal(ok.statusCode, 201, ok.body);
});

test('seluruh alasan void yang sah diterima', async () => {
  const fx = await setupDeviceAndShift();
  for (const reasonCode of ['salah_input', 'pelanggan_batal', 'item_habis', 'uji_coba']) {
    const v = await buatVariation(10000);
    const order = await buatOrder(fx, [await baris(v)]);
    const res = await batalkan(order.id, batalkanPayload({ reasonCode }));
    assert.equal(res.statusCode, 201, `${reasonCode}: ${res.body}`);
  }
});

// ============================================================
// T9 -- void TANPA PIN manajer (keputusan user 1 Agu 2026)
// ============================================================

// research/08 §3 semula menuntut PIN untuk void; keputusan 1 Agu 2026 adalah
// override eksplisit terhadapnya. Test ini menjaga override itu tetap berlaku
// -- kalau seseorang kelak mewajibkan X-Approver-Id di sini, ia akan merah,
// dan orang itu harus membaca keputusannya lebih dulu.
test('void berhasil TANPA header X-Approver-Id', async () => {
  const fx = await setupDeviceAndShift();
  const v = await buatVariation(10000);
  const order = await buatOrder(fx, [await baris(v)]);

  const res = await app.inject({
    method: 'POST',
    url: `/orders/${order.id}/cancel`,
    payload: batalkanPayload(),
    headers: {
      'x-tenant-id': tenant.id,
      'x-actor-id': base.user.id,
      'idempotency-key': crypto.randomUUID(),
      // TIDAK ADA x-approver-id, dan itu memang inti test ini.
    },
  });
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(JSON.parse(res.body).operation, 'void');
});

test('X-Approver-Id yang dikirim pada void diabaikan, tidak tersimpan', async () => {
  const fx = await setupDeviceAndShift();
  const v = await buatVariation(10000);
  const order = await buatOrder(fx, [await baris(v)]);

  // Aktor yang sama dengan penyetuju: kalau header ini dipakai, CHECK
  // database akan menolaknya dan permintaan gagal. Ia harus diabaikan.
  const res = await batalkan(order.id, batalkanPayload(), { 'x-approver-id': base.user.id });
  assert.equal(res.statusCode, 201, res.body);
  const events = await query('SELECT approver_user_id FROM audit_event');
  assert.equal(events[0].approver_user_id, null);
});
