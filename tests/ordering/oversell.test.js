'use strict';

// FR-E6 — deteksi oversell pasca-sinkronisasi.
//
// `spec-e:166`: "Dua device offline yang menjual item terakhir akan sama-sama
// BERHASIL. Ini konsekuensi teorema CAP, bukan bug. Yang dapat dan harus
// dilakukan: membuat konsekuensinya TERLIHAT dan tertangani sebagai proses
// bisnis."
//
// Pencegahan adalah non-goal PERMANEN (PRD). Yang diuji di sini karena itu
// bukan bahwa oversell dicegah — melainkan bahwa ia tidak pernah ditolak, dan
// tidak pernah hilang diam-diam.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');

const BUSINESS_DATE = '2026-08-13';

let owner, appSetup, app, tenant, base;
let deviceCounter = 0;
let seq = 0;

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
  base = await seedTenantBase(appSetup, { suffix: 'OversellTest' });
  tenant = base.tenant;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();
  deviceCounter = 0;
  seq = 0;
});

function req(method, url, payload, headers = {}) {
  return app.inject({
    method,
    url,
    payload,
    headers: {
      'x-tenant-id': tenant.id, authorization: base.authHeader,
      'x-actor-id': base.user.id,
      'idempotency-key': crypto.randomUUID(),
      ...headers,
    },
  });
}

async function buatPerangkatDanShift() {
  deviceCounter += 1;
  const deviceId = crypto.randomUUID();
  const resD = await req('POST', '/devices', {
    id: deviceId,
    outletId: base.outlet.id,
    code: `K${deviceCounter}`,
    name: `Kasir ${deviceCounter}`,
  });
  assert.equal(resD.statusCode, 201, resD.body);

  const shiftId = crypto.randomUUID();
  const resS = await req('POST', '/shifts', {
    id: shiftId,
    outletId: base.outlet.id,
    deviceId,
    businessDate: BUSINESS_DATE,
    openingFloat: 100000,
  });
  assert.equal(resS.statusCode, 201, resS.body);
  return { deviceId, shiftId };
}

async function buatVariation(price = 25000) {
  const itemId = crypto.randomUUID();
  const variationId = crypto.randomUUID();
  const res = await req('POST', '/items', {
    id: itemId,
    name: `Produk ${variationId.slice(0, 8)}`,
    variations: [{ id: variationId, price }],
  });
  assert.equal(res.statusCode, 201, res.body);
  return variationId;
}

/** Menerima barang, supaya stok punya titik awal positif. */
async function terimaStok(variationId, qtyMilli) {
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await appSetup.query(
    `INSERT INTO stock_movement
       (id, tenant_id, outlet_id, variation_id, type, delta, created_by, hlc, occurred_at)
     VALUES ($1, $2, $3, $4, 'receipt', $5, $6, 1, now())`,
    [crypto.randomUUID(), tenant.id, base.outlet.id, variationId, String(qtyMilli), base.user.id]
  );
  await appSetup.query('COMMIT');
}

async function jual({ deviceId, shiftId }, variationId, qtyMilli = 1000) {
  seq += 1;
  const orderId = crypto.randomUUID();
  const res = await req('POST', '/orders', {
    id: orderId,
    outletId: base.outlet.id,
    deviceId,
    shiftId,
    receiptNumber: `K${deviceCounter}-20260813-${String(seq).padStart(4, '0')}`,
    businessDate: BUSINESS_DATE,
    sequence: seq,
    channel: 'takeaway',
    checkId: crypto.randomUUID(),
    lines: [{ id: crypto.randomUUID(), variationId, quantityMilli: qtyMilli, discountAmount: 0 }],
  });
  return { res, orderId };
}

async function event() {
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  const { rows } = await appSetup.query(
    `SELECT variation_id, quantity_over, devices_involved, orders_involved,
            resolved_by, resolved_at
       FROM oversell_event ORDER BY detected_at`
  );
  await appSetup.query('COMMIT');
  return rows;
}

// ---------------------------------------------------------------------------

test('⛔ dua perangkat menjual item terakhir: KEDUANYA diterima', async () => {
  // `spec-e:177`: "kedua penjualan DITERIMA — tidak ada yang ditolak."
  // Menolak yang kedua berarti menolak uang yang sudah diterima merchant.
  const v = await buatVariation();
  await terimaStok(v, 1000);

  const k1 = await buatPerangkatDanShift();
  const k2 = await buatPerangkatDanShift();

  const a = await jual(k1, v);
  const b = await jual(k2, v);

  assert.equal(a.res.statusCode, 201, a.res.body);
  assert.equal(b.res.statusCode, 201, b.res.body);
});

test('⛔ oversell menghasilkan TEPAT SATU event, bukan satu per penjualan', async () => {
  // `spec-e:197`: "Test simulasi: dua device offline menjual item terakhir ->
  // tepat satu OversellEvent." Satu event per penjualan akan membuat daftar
  // "perlu diperiksa" penuh duplikat untuk satu masalah yang sama.
  const v = await buatVariation();
  await terimaStok(v, 1000);

  const k1 = await buatPerangkatDanShift();
  const k2 = await buatPerangkatDanShift();
  await jual(k1, v);
  await jual(k2, v);

  const e = await event();
  assert.equal(e.length, 1, `tepat satu event, dapat ${e.length}`);
  assert.equal(e[0].variation_id, v);
  assert.equal(e[0].quantity_over, '1000', 'kelebihan 1 unit (x1000)');
});

test('⛔ konteksnya LENGKAP: kedua perangkat dan kedua order', async () => {
  // `spec-e:194`: "OversellEvent dibuat dengan konteks lengkap (device,
  // order, waktu)." Manajer yang harus memutuskan tidak dapat menyelidiki
  // event yang hanya menyebut produknya.
  const v = await buatVariation();
  await terimaStok(v, 1000);

  const k1 = await buatPerangkatDanShift();
  const k2 = await buatPerangkatDanShift();
  const a = await jual(k1, v);
  const b = await jual(k2, v);

  const e = await event();
  assert.equal(e.length, 1);
  const perangkat = e[0].devices_involved;
  const order = e[0].orders_involved;
  assert.equal(perangkat.includes(k1.deviceId), true, 'perangkat pertama hilang dari konteks');
  assert.equal(perangkat.includes(k2.deviceId), true, 'perangkat kedua hilang dari konteks');
  assert.equal(order.includes(a.orderId), true);
  assert.equal(order.includes(b.orderId), true);
});

test('penjualan yang TIDAK melewati stok tidak menghasilkan event', async () => {
  const v = await buatVariation();
  await terimaStok(v, 10000);

  const k1 = await buatPerangkatDanShift();
  await jual(k1, v, 3000);

  assert.deepEqual(await event(), []);
});

test('⛔ penjualan ketiga MEMPERBESAR event yang sama, tidak membuat yang baru', async () => {
  // Oversell yang memburuk adalah masalah yang sama yang membesar, bukan
  // masalah baru. Manajer memeriksanya sekali.
  const v = await buatVariation();
  await terimaStok(v, 1000);

  const k1 = await buatPerangkatDanShift();
  const k2 = await buatPerangkatDanShift();
  const k3 = await buatPerangkatDanShift();
  await jual(k1, v);
  await jual(k2, v);
  await jual(k3, v);

  const e = await event();
  assert.equal(e.length, 1, 'event kedua dibuat untuk masalah yang sama');
  assert.equal(e[0].quantity_over, '2000', 'kelebihan harus bertambah jadi 2 unit');
  assert.equal(e[0].devices_involved.length, 3);
});

test('⛔ produk BERBEDA menghasilkan event terpisah', async () => {
  const a = await buatVariation();
  const b = await buatVariation();
  await terimaStok(a, 1000);
  await terimaStok(b, 1000);

  const k1 = await buatPerangkatDanShift();
  const k2 = await buatPerangkatDanShift();
  await jual(k1, a);
  await jual(k2, a);
  await jual(k1, b);
  await jual(k2, b);

  const e = await event();
  assert.equal(e.length, 2, 'dua produk yang berbeda adalah dua masalah yang berbeda');
});

test('⛔ event yang sudah DISELESAIKAN tidak dipakai ulang', async () => {
  // Manajer sudah memeriksa dan menyelesaikan. Oversell berikutnya adalah
  // kejadian baru, dan menempelkannya ke event lama menyembunyikannya di
  // balik sesuatu yang sudah ditandai selesai.
  const v = await buatVariation();
  await terimaStok(v, 1000);

  const k1 = await buatPerangkatDanShift();
  const k2 = await buatPerangkatDanShift();
  await jual(k1, v);
  await jual(k2, v);

  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await appSetup.query(
    `UPDATE oversell_event SET resolved_by = $1, resolved_at = now(), resolution_note = 'sudah dicek'`,
    [base.user.id]
  );
  await appSetup.query('COMMIT');

  await jual(k1, v);

  const e = await event();
  assert.equal(e.length, 2, 'oversell setelah penyelesaian harus jadi event BARU');
});
