'use strict';

// T3, T5, T7, T9, T14 -- POST /orders, GET /orders/{orderId} (modul ordering
// BARU). Pola test SAMA PERSIS dengan tests/ordering/shifts.test.js dan
// tests/catalog/prices.test.js: seedTenantBase dua kali untuk skenario
// lintas tenant, appSetup dipakai untuk pembuktian langsung ke DB
// (BEGIN/set_config/COMMIT) supaya SELECT itu sendiri tunduk RLS.
//
// docs/superpowers/plans/PLAN-ordering-fondasi.md T3/T5/T6/T7/T9/T14.

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
  base = await seedTenantBase(appSetup, { suffix: 'OrderTest' });
  tenant = base.tenant;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();
});

const BUSINESS_DATE = '2026-08-02';

function ordersUrl() {
  return '/orders';
}

function orderUrl(orderId) {
  return `/orders/${orderId}`;
}

// T10 (PLAN-ordering-fondasi.md) -- Idempotency-Key kini WAJIB untuk
// POST /orders. Default di sini adalah crypto.randomUUID() BARU per
// panggilan (bukan konstanta) supaya test-test T3/T5/T7/T9/T14 di berkas
// ini -- yang masing-masing membuat BEBERAPA order berbeda per test, dan
// TIDAK menguji idempotency -- tidak diam-diam saling tabrak lewat
// request_hash yang berbeda di key yang sama (422) atau dianggap retry.
// Test yang MEMANG menguji idempotency (tests/ordering/idempotency.test.js)
// mengoper headernya sendiri secara eksplisit, meng-override default ini.
function req(method, url, payload, headers = {}) {
  const defaultHeaders = { 'x-tenant-id': tenant.id, 'x-actor-id': base.user.id };
  if (method === 'POST' && url === ordersUrl() && headers['idempotency-key'] === undefined) {
    defaultHeaders['idempotency-key'] = crypto.randomUUID();
  }
  return app.inject({
    method,
    url,
    payload,
    headers: { ...defaultHeaders, ...headers },
  });
}

// --- fixtures: device + shift terbuka, lewat endpoint sungguhan (T0b/T0c) ---

async function createDevice(outletId, code, headers = {}) {
  const deviceId = crypto.randomUUID();
  const res = await app.inject({
    method: 'POST',
    url: '/devices',
    payload: { id: deviceId, outletId, code },
    headers: { 'x-tenant-id': tenant.id, ...headers },
  });
  assert.equal(res.statusCode, 201, `gagal membuat device persiapan test: ${res.body}`);
  return JSON.parse(res.body);
}

async function openShift(outletId, deviceId, headers = {}) {
  const shiftId = crypto.randomUUID();
  const res = await app.inject({
    method: 'POST',
    url: '/shifts',
    payload: { id: shiftId, outletId, deviceId, businessDate: BUSINESS_DATE, openingFloat: 100000 },
    headers: { 'x-tenant-id': tenant.id, 'x-actor-id': base.user.id, ...headers },
  });
  assert.equal(res.statusCode, 201, `gagal membuka shift persiapan test: ${res.body}`);
  return JSON.parse(res.body);
}

// Persiapan lengkap: device + shift open di outlet tenant test, siap dipakai
// createOrder. `n` menghasilkan kode device unik supaya bisa dipanggil > 1x
// per test tanpa bentrok ux_device_outlet_code. `tenantId`/`actorId`
// override -- dibutuhkan test lintas tenant (deviceId milik tenant lain):
// device+shift-nya harus BENAR-BENAR dibuat sebagai tenant lain, bukan
// tenant test dengan outletId yang dipinjam (yang akan gagal di
// assertOutletVisible/getOutletSettings sebelum sempat jadi kasus yang
// relevan sama sekali).
let deviceCounter = 0;
async function setupDeviceAndShift(outletId = base.outlet.id, { tenantId = tenant.id, actorId = base.user.id } = {}) {
  deviceCounter += 1;
  const device = await createDevice(outletId, `K${deviceCounter}`, { 'x-tenant-id': tenantId });
  const shift = await openShift(outletId, device.id, { 'x-tenant-id': tenantId, 'x-actor-id': actorId });
  return { device, shift };
}

function orderPayload(overrides = {}) {
  const orderId = overrides.id ?? crypto.randomUUID();
  return {
    id: orderId,
    outletId: base.outlet.id,
    deviceId: overrides.deviceId,
    shiftId: overrides.shiftId,
    receiptNumber: overrides.receiptNumber ?? `K1-20260802-${String(overrides.sequence ?? 1).padStart(4, '0')}`,
    businessDate: BUSINESS_DATE,
    sequence: overrides.sequence ?? 1,
    channel: overrides.channel ?? 'takeaway',
    checkId: overrides.checkId ?? crypto.randomUUID(),
    lines: overrides.lines ?? [
      {
        id: crypto.randomUUID(),
        variationId: base.item_variation.id,
        quantityMilli: 1000,
        discountAmount: 0,
      },
    ],
    ...(overrides.hlc !== undefined ? { hlc: overrides.hlc } : {}),
  };
}

// Membuktikan langsung ke DB bahwa TIDAK ADA baris order/check/order_line
// tersimpan untuk id yang dikirim -- status code saja tidak cukup (temuan
// F1, dibuktikan berulang di repo ini).
async function assertNoOrderRowsSaved(callerTenantId, orderId, checkId) {
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [callerTenantId]);
  const { rows: orderRows } = await appSetup.query('SELECT id FROM "order" WHERE id = $1', [orderId]);
  const { rows: checkRows } = await appSetup.query('SELECT id FROM "check" WHERE id = $1', [checkId]);
  const { rows: lineRows } = await appSetup.query('SELECT id FROM order_line WHERE order_id = $1', [orderId]);
  await appSetup.query('COMMIT');
  assert.equal(orderRows.length, 0, 'tidak boleh ada baris order tersimpan untuk request yang ditolak');
  assert.equal(checkRows.length, 0, 'tidak boleh ada baris check tersimpan untuk request yang ditolak');
  assert.equal(lineRows.length, 0, 'tidak boleh ada baris order_line tersimpan untuk request yang ditolak');
}

// Variation dengan harga yang TIDAK bulat ke kelipatan 100 -- dibutuhkan
// untuk membuktikan `total` tidak dibulatkan (FR-C8).
async function createVariation(price) {
  const itemId = crypto.randomUUID();
  const variationId = crypto.randomUUID();
  const res = await app.inject({
    method: 'POST',
    url: '/items',
    payload: { id: itemId, name: `Produk ${variationId.slice(0, 8)}`, variations: [{ id: variationId, price }] },
    headers: { 'x-tenant-id': tenant.id },
  });
  assert.equal(res.statusCode, 201, `gagal membuat variation persiapan test: ${res.body}`);
  return { itemId, variationId };
}

// --- FR-C8/C9: total tidak dibulatkan, amount_due mengikuti ---
//
// Koreksi terhadap versi pertama modul ini, yang membulatkan `total` ke
// kelipatan outlet.rounding_increment lalu menulis nilai yang SAMA ke
// `order.total` dan `order.amount_due`.
//
// spec-c-pembayaran-pajak.md:113-116 menetapkan yang dibulatkan adalah
// `amount_due` (langkah 14), bukan `total` (langkah 12). Dan FR-C9
// menetapkan pembulatan hanya berlaku bila ada pembayaran TUNAI.
//
// Order yang baru dibuat belum punya pembayaran apa pun, jadi yang benar di
// sini adalah: rounding_adjustment = 0 dan amount_due = total, keduanya
// tanpa pembulatan. Pembulatan masuk bersama pembayaran (Modul C).
test('FR-C8: total tidak dibulatkan ke rounding_increment outlet', async () => {
  const { device, shift } = await setupDeviceAndShift();
  // 64.167 bukan kelipatan 100. Versi lama akan menulis 64.200.
  const { variationId } = await createVariation(64167);
  const payload = orderPayload({
    deviceId: device.id,
    shiftId: shift.id,
    lines: [{ id: crypto.randomUUID(), variationId, quantityMilli: 1000, discountAmount: 0 }],
  });

  const res = await req('POST', ordersUrl(), payload);
  assert.equal(res.statusCode, 201, res.body);
  const body = JSON.parse(res.body);

  assert.equal(body.subtotal, 64167);
  assert.equal(body.total, 64167, 'total adalah nilai transaksi -- tidak boleh digeser pembulatan');
  assert.equal(body.roundingAdjustment, 0, 'belum ada pembayaran tunai, jadi belum ada pembulatan');
  assert.equal(body.amountDue, 64167, 'tanpa pembayaran tunai, amount_due = total');
});

// ============================================================
// T3 -- jalur bahagia
// ============================================================

test('createOrder: jalur bahagia, 201, status open, total dihitung packages/domain/money.ts', async () => {
  const { device, shift } = await setupDeviceAndShift();
  const payload = orderPayload({ deviceId: device.id, shiftId: shift.id });
  const res = await req('POST', ordersUrl(), payload);
  assert.equal(res.statusCode, 201, res.body);
  const body = JSON.parse(res.body);
  assert.equal(body.id, payload.id);
  assert.equal(body.outletId, base.outlet.id);
  assert.equal(body.deviceId, device.id);
  assert.equal(body.shiftId, shift.id);
  assert.equal(body.status, 'open');
  assert.equal(body.channel, 'takeaway');
  assert.equal(body.checkId, payload.checkId);
  assert.equal(body.taxAmount, 0, 'invariant #7 -- pajak nol di sub-project ini');
  assert.equal(body.subtotal, 20000, 'base.item_variation.price = 20000 (seedTenantBase)');
  assert.equal(body.total, 20000);
  assert.equal(body.amountDue, 20000, 'belum ada pembayaran -- amount_due = total');
  assert.equal(body.createdBy, base.user.id);
  assert.ok(body.occurredAt);
  assert.ok(body.hlc, 'hlc harus terisi walau klien tidak mengirim (server tick())');
  assert.equal(body.lines.length, 1);
  assert.equal(body.lines[0].unitPrice, 20000);
  assert.equal(body.lines[0].quantityMilli, 1000);
  assert.equal(body.lines[0].lineTotal, 20000);
  assert.equal(body.lines[0].itemName, 'Kopi Susu');
  assert.equal(body.lines[0].variationName, 'Regular');
  assert.equal(body.lines[0].costAtSale, 8000);
  assert.equal(body.lines[0].taxAmount, 0);
  assert.equal(body.lines[0].isTaxInclusive, false);
});

test('createOrder: DRAFT (lines kosong) ditolak 400, tidak pernah tersimpan', async () => {
  const { device, shift } = await setupDeviceAndShift();
  const payload = orderPayload({ deviceId: device.id, shiftId: shift.id, lines: [] });
  const res = await req('POST', ordersUrl(), payload);
  assert.ok(res.statusCode >= 400 && res.statusCode < 500, `harusnya 4xx, dapat ${res.statusCode}: ${res.body}`);
  await assertNoOrderRowsSaved(tenant.id, payload.id, payload.checkId);
});

test('createOrder: dengan modifier, line_total dan modifier_snapshot benar', async () => {
  const { device, shift } = await setupDeviceAndShift();
  const modifierId = crypto.randomUUID();
  const lineId = crypto.randomUUID();
  const payload = orderPayload({
    deviceId: device.id,
    shiftId: shift.id,
    lines: [
      {
        id: lineId,
        variationId: base.item_variation.id,
        quantityMilli: 2000,
        discountAmount: 0,
        modifiers: [{ id: modifierId, modifierId: base.modifier.id, name: 'Extra shot', price: 5000, quantityMilli: 1000 }],
      },
    ],
  });
  const res = await req('POST', ordersUrl(), payload);
  assert.equal(res.statusCode, 201, res.body);
  const body = JSON.parse(res.body);
  // 2 x (20000 + 5000) = 50000
  assert.equal(body.lines[0].lineTotal, 50000);
  assert.equal(body.lines[0].modifiers.length, 1);
  assert.equal(body.lines[0].modifiers[0].name, 'Extra shot');
  assert.equal(body.lines[0].modifiers[0].price, 5000);
  assert.equal(body.lines[0].modifierSnapshot.length, 1);
  assert.equal(body.lines[0].modifierSnapshot[0].name, 'Extra shot');
});

// ============================================================
// T5 -- snapshot: spec-b:132-139
// ============================================================

test('snapshot: harga naik + item rename + arsip TIDAK mengubah order lama (spec-b:132-139)', async () => {
  const { device, shift } = await setupDeviceAndShift();
  const payload = orderPayload({ deviceId: device.id, shiftId: shift.id });
  const createRes = await req('POST', ordersUrl(), payload);
  assert.equal(createRes.statusCode, 201, createRes.body);
  const created = JSON.parse(createRes.body);
  assert.equal(created.lines[0].unitPrice, 20000, 'base.item_variation.price = 20000 (seedTenantBase)');

  // Naikkan harga jadi 28000
  const priceRes = await req(
    'POST',
    `/items/${base.item.id}/variations/${base.item_variation.id}/prices`,
    { id: crypto.randomUUID(), price: 28000, outletId: base.outlet.id }
  );
  assert.equal(priceRes.statusCode, 201, priceRes.body);

  // Rename item
  const renameRes = await req('PATCH', `/items/${base.item.id}`, { name: 'Kopi Susu Baru' });
  assert.equal(renameRes.statusCode, 200, renameRes.body);

  // Arsipkan item
  const archiveRes = await req('POST', `/items/${base.item.id}/archive`, {});
  assert.equal(archiveRes.statusCode, 200, archiveRes.body);

  // Baca order lama lagi -- harus tetap 20000 dan nama lama
  const getRes = await req('GET', orderUrl(payload.id));
  assert.equal(getRes.statusCode, 200, getRes.body);
  const reread = JSON.parse(getRes.body);
  assert.equal(reread.lines[0].unitPrice, 20000, 'snapshot tidak boleh terpengaruh harga baru');
  assert.equal(reread.lines[0].itemName, 'Kopi Susu', 'snapshot tidak boleh terpengaruh rename');
  assert.equal(reread.lines[0].variationName, 'Regular');
  assert.equal(reread.total, 20000);
});

// ============================================================
// T7 -- guard FK klien-suplai lintas tenant
// ============================================================

test('createOrder: variationId milik tenant lain ditolak 404 VARIATION_NOT_FOUND, tidak ada baris tersimpan', async () => {
  const other = await seedTenantBase(appSetup, { suffix: 'OrderTestOtherVariation' });
  const { device, shift } = await setupDeviceAndShift();
  const payload = orderPayload({
    deviceId: device.id,
    shiftId: shift.id,
    lines: [{ id: crypto.randomUUID(), variationId: other.item_variation.id, quantityMilli: 1000, discountAmount: 0 }],
  });
  const res = await req('POST', ordersUrl(), payload);
  assert.equal(res.statusCode, 404, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'VARIATION_NOT_FOUND');
  await assertNoOrderRowsSaved(tenant.id, payload.id, payload.checkId);
});

test('createOrder: outletId milik tenant lain ditolak 404 OUTLET_NOT_FOUND, tidak ada baris tersimpan', async () => {
  const other = await seedTenantBase(appSetup, { suffix: 'OrderTestOtherOutlet' });
  const { device, shift } = await setupDeviceAndShift();
  const payload = orderPayload({ deviceId: device.id, shiftId: shift.id });
  payload.outletId = other.outlet.id;
  const res = await req('POST', ordersUrl(), payload);
  assert.equal(res.statusCode, 404, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'OUTLET_NOT_FOUND');
  await assertNoOrderRowsSaved(tenant.id, payload.id, payload.checkId);
});

test('createOrder: deviceId milik tenant lain ditolak 404 DEVICE_NOT_FOUND, tidak ada baris tersimpan', async () => {
  const other = await seedTenantBase(appSetup, { suffix: 'OrderTestOtherDevice' });
  const { device: otherDevice } = await setupDeviceAndShift(other.outlet.id, {
    tenantId: other.tenant.id,
    actorId: other.user.id,
  });
  const { shift } = await setupDeviceAndShift();
  const payload = orderPayload({ deviceId: otherDevice.id, shiftId: shift.id });
  const res = await req('POST', ordersUrl(), payload);
  assert.equal(res.statusCode, 404, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'DEVICE_NOT_FOUND');
  await assertNoOrderRowsSaved(tenant.id, payload.id, payload.checkId);
});

test('createOrder: shiftId milik tenant lain ditolak 404 SHIFT_NOT_FOUND, tidak ada baris tersimpan', async () => {
  const other = await seedTenantBase(appSetup, { suffix: 'OrderTestOtherShift' });
  deviceCounter += 1;
  const otherDevice = await createDevice(other.outlet.id, `KO${deviceCounter}`, { 'x-tenant-id': other.tenant.id });
  const otherShiftRes = await app.inject({
    method: 'POST',
    url: '/shifts',
    payload: { id: crypto.randomUUID(), outletId: other.outlet.id, deviceId: otherDevice.id, businessDate: BUSINESS_DATE, openingFloat: 50000 },
    headers: { 'x-tenant-id': other.tenant.id, 'x-actor-id': other.user.id },
  });
  assert.equal(otherShiftRes.statusCode, 201, otherShiftRes.body);
  const otherShift = JSON.parse(otherShiftRes.body);

  const { device } = await setupDeviceAndShift();
  const payload = orderPayload({ deviceId: device.id, shiftId: otherShift.id });
  const res = await req('POST', ordersUrl(), payload);
  assert.equal(res.statusCode, 404, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'SHIFT_NOT_FOUND');
  await assertNoOrderRowsSaved(tenant.id, payload.id, payload.checkId);
});

test('createOrder: shift milik device lain (bukan shift open device pemanggil) ditolak 409 SHIFT_DEVICE_MISMATCH', async () => {
  const { device: deviceA, shift: shiftA } = await setupDeviceAndShift();
  deviceCounter += 1;
  const deviceB = await createDevice(base.outlet.id, `KB${deviceCounter}`);
  // deviceB belum punya shift; pakai shift milik deviceA lewat deviceB
  const payload = orderPayload({ deviceId: deviceB.id, shiftId: shiftA.id });
  const res = await req('POST', ordersUrl(), payload);
  assert.equal(res.statusCode, 409, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'SHIFT_DEVICE_MISMATCH');
  await assertNoOrderRowsSaved(tenant.id, payload.id, payload.checkId);
});

// ============================================================
// T9 -- nomor struk (FR-B5)
// ============================================================

test('createOrder: bentrok (device_id, business_date, sequence) ditolak 409 RECEIPT_SEQUENCE_TAKEN', async () => {
  const { device, shift } = await setupDeviceAndShift();
  const first = orderPayload({ deviceId: device.id, shiftId: shift.id, sequence: 1 });
  const firstRes = await req('POST', ordersUrl(), first);
  assert.equal(firstRes.statusCode, 201, firstRes.body);

  const second = orderPayload({ deviceId: device.id, shiftId: shift.id, sequence: 1 });
  const secondRes = await req('POST', ordersUrl(), second);
  assert.equal(secondRes.statusCode, 409, secondRes.body);
  assert.equal(JSON.parse(secondRes.body).error.code, 'RECEIPT_SEQUENCE_TAKEN');
  await assertNoOrderRowsSaved(tenant.id, second.id, second.checkId);
});

test('createOrder: dua device berbeda dengan sequence sama diterima', async () => {
  const { device: deviceA, shift: shiftA } = await setupDeviceAndShift();
  const { device: deviceB, shift: shiftB } = await setupDeviceAndShift();

  const first = orderPayload({ deviceId: deviceA.id, shiftId: shiftA.id, sequence: 1 });
  const firstRes = await req('POST', ordersUrl(), first);
  assert.equal(firstRes.statusCode, 201, firstRes.body);

  const second = orderPayload({ deviceId: deviceB.id, shiftId: shiftB.id, sequence: 1 });
  const secondRes = await req('POST', ordersUrl(), second);
  assert.equal(secondRes.statusCode, 201, secondRes.body);
});

test('createOrder: sequence bukan integer positif ditolak 4xx bersih, bukan 500', async () => {
  const { device, shift } = await setupDeviceAndShift();
  const payload = orderPayload({ deviceId: device.id, shiftId: shift.id });
  payload.sequence = -1;
  const res = await req('POST', ordersUrl(), payload);
  assert.ok(res.statusCode >= 400 && res.statusCode < 500, `harusnya 4xx, dapat ${res.statusCode}: ${res.body}`);
  const body = JSON.parse(res.body);
  assert.ok(body.error && body.error.code, `envelope error tidak konsisten: ${res.body}`);
});

test('createOrder: receiptNumber salah format ditolak 4xx bersih, bukan 500', async () => {
  const { device, shift } = await setupDeviceAndShift();
  const payload = orderPayload({ deviceId: device.id, shiftId: shift.id });
  payload.receiptNumber = 'bukan-format-struk';
  const res = await req('POST', ordersUrl(), payload);
  assert.ok(res.statusCode >= 400 && res.statusCode < 500, `harusnya 4xx, dapat ${res.statusCode}: ${res.body}`);
  const body = JSON.parse(res.body);
  assert.ok(body.error && body.error.code, `envelope error tidak konsisten: ${res.body}`);
});

// ============================================================
// T14 -- check dikunci 1:1 (FR-B12)
// ============================================================

test('createOrder: order kedua tidak bisa memakai checkId yang sama, 409 bersih bukan 500', async () => {
  const { device, shift } = await setupDeviceAndShift();
  const sharedCheckId = crypto.randomUUID();
  const first = orderPayload({ deviceId: device.id, shiftId: shift.id, sequence: 1, checkId: sharedCheckId });
  const firstRes = await req('POST', ordersUrl(), first);
  assert.equal(firstRes.statusCode, 201, firstRes.body);

  const second = orderPayload({ deviceId: device.id, shiftId: shift.id, sequence: 2, checkId: sharedCheckId });
  const secondRes = await req('POST', ordersUrl(), second);
  assert.ok(secondRes.statusCode >= 400 && secondRes.statusCode < 500, `harusnya 4xx bersih, dapat ${secondRes.statusCode}: ${secondRes.body}`);
  const body = JSON.parse(secondRes.body);
  assert.ok(body.error && body.error.code, `envelope error tidak konsisten: ${secondRes.body}`);

  // Order kedua sendiri (bukan hanya check-nya) tidak boleh tersimpan.
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  const { rows } = await appSetup.query('SELECT id FROM "order" WHERE id = $1', [second.id]);
  await appSetup.query('COMMIT');
  assert.equal(rows.length, 0, 'order kedua tidak boleh tersimpan kalau check-nya gagal dibuat');
});

// Test di atas membuktikan `check_pkey` (checkId duplikat) -- BUKAN kunci 1:1
// order<->check yang jadi inti FR-B12. Keduanya berbeda, dan membiarkan yang
// pertama berpura-pura menguji yang kedua akan meninggalkan lubang.
//
// Lewat API, kunci 1:1 memang mustahil dilanggar: createOrder selalu membuat
// check baru untuk order yang baru saja dibuat, jadi `check.order_id` tidak
// pernah bisa menunjuk order yang sudah punya check. Itu jaminan STRUKTURAL,
// dan bagus. Tapi FR-B12 ada justru supaya split bill nanti menjadi
// pelonggaran validasi, bukan migrasi data -- jadi jaminannya harus terbukti
// ada di database, bukan hanya di bentuk kode hari ini.
//
// Karena itu constraint-nya diuji LANGSUNG ke database. Ini satu-satunya
// tempat di suite ordering yang menulis SQL mentah alih-alih lewat endpoint,
// dan alasannya persis itu: yang diuji adalah lapisan yang endpoint tidak
// bisa jangkau.
test('FR-B12: satu order tepat punya satu check, dan database menolak yang kedua', async () => {
  const { device, shift } = await setupDeviceAndShift();
  const payload = orderPayload({ deviceId: device.id, shiftId: shift.id });
  const res = await req('POST', ordersUrl(), payload);
  assert.equal(res.statusCode, 201, res.body);

  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);

  const { rows: checks } = await appSetup.query('SELECT id FROM "check" WHERE order_id = $1', [payload.id]);
  assert.equal(checks.length, 1, 'satu order harus menghasilkan tepat satu check, tidak nol dan tidak dua');

  let ditolak = false;
  try {
    await appSetup.query(
      `INSERT INTO "check" (id, tenant_id, order_id, subtotal, total) VALUES ($1, $2, $3, 0, 0)`,
      [crypto.randomUUID(), tenant.id, payload.id]
    );
  } catch (err) {
    // 23505 = unique_violation. Yang dijaga adalah UNIQUE(check.order_id),
    // bukan primary key -- id yang dipakai di atas sengaja baru.
    ditolak = err.code === '23505';
  }
  await appSetup.query('ROLLBACK');
  assert.ok(ditolak, 'database harus menolak check kedua untuk order yang sama (UNIQUE order_id)');
});

// --- GET /orders/{orderId} ---

test('getOrder: 404 untuk id yang tidak ada', async () => {
  const res = await req('GET', orderUrl(crypto.randomUUID()));
  assert.equal(res.statusCode, 404, res.body);
});

test('getOrder: order lintas tenant tidak terlihat (RLS)', async () => {
  const other = await seedTenantBase(appSetup, { suffix: 'OrderTestGetOtherTenant' });
  const { device, shift } = await setupDeviceAndShift();
  const payload = orderPayload({ deviceId: device.id, shiftId: shift.id });
  const createRes = await req('POST', ordersUrl(), payload);
  assert.equal(createRes.statusCode, 201, createRes.body);

  const res = await app.inject({
    method: 'GET',
    url: orderUrl(payload.id),
    headers: { 'x-tenant-id': other.tenant.id },
  });
  assert.equal(res.statusCode, 404, res.body);
});
