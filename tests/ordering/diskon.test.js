'use strict';

// FR-B8 & FR-B9 — diskon tingkat order dengan otorisasi step-up.
//
// ⛔ Sebelum ini `order_discount` SELALU NOL. Kolomnya ada sejak F0 dan
// `computeOrderTotals` sudah menghitungnya sejak Modul C, tapi `POST /orders`
// menulis nol ke sana — jadi tidak ada satu pun jalan bagi merchant untuk
// memberi diskon, dan tidak ada satu pun test yang merah karenanya.
//
// Yang diuji di sini bukan "apakah angkanya benar" melainkan APA YANG
// DITOLAK, dan satu hal lagi yang lebih halus: order berdiskon tidak boleh
// ditandai `has_calculation_variance`.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');

let owner, appSetup, app, tenant, base, manajer, kasirBiasa;

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
  base = await seedTenantBase(appSetup, { suffix: 'DiskonTest' });
  tenant = base.tenant;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();
  manajer = await buatUser('Manajer', 'outlet_manager');
  kasirBiasa = await buatUser('Kasir', 'cashier');
  await akhiriTarifSeed();
});

const BUSINESS_DATE = '2026-08-21';
let deviceCounter = 0;
let seq = 0;

function req(method, url, payload, headers = {}) {
  const h = { 'x-tenant-id': tenant.id, authorization: base.authHeader, 'x-actor-id': base.user.id, ...headers };
  if (method === 'POST' && h['idempotency-key'] === undefined) {
    h['idempotency-key'] = crypto.randomUUID();
  }
  return app.inject({ method, url, payload, headers: h });
}

async function buatUser(nama, peran) {
  const id = crypto.randomUUID();
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await appSetup.query(
    `INSERT INTO "user" (id, tenant_id, name, is_active) VALUES ($1, $2, $3, true)`,
    [id, tenant.id, `${nama} ${id.slice(0, 6)}`]
  );
  await appSetup.query(
    `INSERT INTO user_role (id, tenant_id, user_id, role, scope_type, scope_id)
     VALUES ($1, $2, $3, $4, 'outlet', $5)`,
    [crypto.randomUUID(), tenant.id, id, peran, base.outlet.id]
  );
  await appSetup.query('COMMIT');
  return id;
}

/** Pajak diakhiri supaya angkanya dapat diperiksa satu per satu. */
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

async function jamDatabase() {
  const { rows } = await kueriTenant('SELECT now() AS t', []);
  return rows[0].t;
}

function geser(waktu, detik) {
  return new Date(waktu.getTime() + detik * 1000).toISOString();
}

async function ubahHarga({ itemId, variationId }, price, effectiveFrom) {
  const res = await req('POST', `/items/${itemId}/variations/${variationId}/prices`, {
    id: crypto.randomUUID(), price, effectiveFrom,
  });
  assert.equal(res.statusCode, 201, res.body);
}

async function buatVariation(price) {
  const itemId = crypto.randomUUID();
  const variationId = crypto.randomUUID();
  const res = await app.inject({
    method: 'POST', url: '/items',
    payload: { id: itemId, name: `P${variationId.slice(0, 6)}`, variations: [{ id: variationId, price }] },
    headers: { 'x-tenant-id': tenant.id, authorization: base.authHeader },
  });
  assert.equal(res.statusCode, 201, res.body);
  return variationId;
}

/** Bentuk lengkap, untuk test yang perlu mengubah harga. */
async function buatVariationLengkap(price) {
  const itemId = crypto.randomUUID();
  const variationId = crypto.randomUUID();
  const res = await app.inject({
    method: 'POST', url: '/items',
    payload: { id: itemId, name: `P${variationId.slice(0, 6)}`, variations: [{ id: variationId, price }] },
    headers: { 'x-tenant-id': tenant.id, authorization: base.authHeader },
  });
  assert.equal(res.statusCode, 201, res.body);
  return { itemId, variationId };
}

function baris(variationId, qtyMilli = 1000) {
  return { id: crypto.randomUUID(), variationId, quantityMilli: qtyMilli, discountAmount: 0 };
}

function payloadOrder(fx, lines, over = {}) {
  seq += 1;
  return {
    id: crypto.randomUUID(),
    outletId: base.outlet.id,
    deviceId: fx.deviceId,
    shiftId: fx.shiftId,
    receiptNumber: `K1-20260821-${String(seq).padStart(4, '0')}`,
    businessDate: BUSINESS_DATE,
    sequence: seq,
    channel: 'takeaway',
    checkId: crypto.randomUUID(),
    lines,
    ...over,
  };
}

async function kueriTenant(sql, params) {
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  const hasil = await appSetup.query(sql, params);
  await appSetup.query('COMMIT');
  return hasil;
}

// ---------------------------------------------------------------------------
// Jalur normal
// ---------------------------------------------------------------------------

test('diskon di BAWAH ambang tidak menuntut penyetuju, dan tersimpan', async () => {
  const fx = await setupDeviceAndShift();
  const v = await buatVariation(100_000);
  const res = await req(
    'POST',
    '/orders',
    payloadOrder(fx, [baris(v)], {
      discount: { tipe: 'persen', nilai: 1000 }, // 10%
      discountReasonCode: 'promo_berjalan',
    })
  );
  assert.equal(res.statusCode, 201, res.body);
  const order = JSON.parse(res.body);
  assert.equal(order.orderDiscount, 10_000);
  assert.equal(order.subtotal, 100_000);
  // Pajak sudah diakhiri, jadi total = subtotal - diskon.
  assert.equal(order.total, 90_000);
});

test('⛔ diskon berpengaruh ke TOTAL yang tersimpan, bukan sekadar dicatat', async () => {
  const fx = await setupDeviceAndShift();
  const v = await buatVariation(100_000);
  const res = await req(
    'POST',
    '/orders',
    payloadOrder(fx, [baris(v)], {
      // Rp 15.000 dari Rp 100.000 = 15%: di bawah KEDUA ambang. Versi
      // pertama test ini memakai Rp 25.000 dan dijawab 403 — nominalnya
      // memang kecil, tapi persennya 25%. Itu justru aturan yang sedang
      // dijaga di berkas ini, dan yang tertangkap adalah assert-nya.
      discount: { tipe: 'nominal', nilai: 15_000 },
      discountReasonCode: 'karyawan',
    })
  );
  assert.equal(res.statusCode, 201, res.body);
  const { rows } = await kueriTenant(
    'SELECT subtotal, order_discount, total, amount_due FROM "order" WHERE id = $1',
    [JSON.parse(res.body).id]
  );
  assert.equal(Number(rows[0].order_discount), 15_000);
  assert.equal(Number(rows[0].total), 85_000);
  assert.equal(Number(rows[0].amount_due), 85_000);
});

test('order tanpa diskon tetap berjalan seperti sebelumnya', async () => {
  // Klien versi N-1 tidak mengirim `discount` sama sekali, dan tidak boleh
  // patah.
  const fx = await setupDeviceAndShift();
  const v = await buatVariation(50_000);
  const res = await req('POST', '/orders', payloadOrder(fx, [baris(v)]));
  assert.equal(res.statusCode, 201, res.body);
  const order = JSON.parse(res.body);
  assert.equal(order.orderDiscount, 0);
  assert.equal(order.total, 50_000);
});

// ---------------------------------------------------------------------------
// Otorisasi step-up — inti FR-B8
// ---------------------------------------------------------------------------

test('⛔ diskon di ATAS ambang tanpa penyetuju ditolak 403, bukan 400', async () => {
  const fx = await setupDeviceAndShift();
  const v = await buatVariation(100_000);
  const res = await req(
    'POST',
    '/orders',
    payloadOrder(fx, [baris(v)], {
      discount: { tipe: 'persen', nilai: 3000 }, // 30% > 20%
      discountReasonCode: 'kompensasi_keluhan',
    })
  );
  // Permintaannya tidak cacat, ia hanya belum disetujui. Kasir yang menerima
  // 400 akan mengira ia salah memasukkan angka.
  assert.equal(res.statusCode, 403, res.body);
  assert.equal(res.json().error.code, 'APPROVAL_REQUIRED');

  const { rows } = await kueriTenant('SELECT count(*) AS n FROM "order"', []);
  assert.equal(Number(rows[0].n), 0, 'order tidak boleh tersimpan sebagian');
});

test('⛔ ambang NOMINAL menyala meski persennya kecil', async () => {
  const fx = await setupDeviceAndShift();
  const v = await buatVariation(1_000_000);
  // Rp 60.000 dari Rp 1.000.000 hanya 6%, tapi melewati ambang Rp 50.000.
  const res = await req(
    'POST',
    '/orders',
    payloadOrder(fx, [baris(v)], {
      discount: { tipe: 'nominal', nilai: 60_000 },
      discountReasonCode: 'promo_berjalan',
    })
  );
  assert.equal(res.statusCode, 403, res.body);
});

test('diskon di atas ambang DITERIMA dengan penyetuju yang berhak', async () => {
  const fx = await setupDeviceAndShift();
  const v = await buatVariation(100_000);
  const res = await req(
    'POST',
    '/orders',
    payloadOrder(fx, [baris(v)], {
      discount: { tipe: 'persen', nilai: 3000 },
      discountReasonCode: 'kompensasi_keluhan',
    }),
    { 'x-approver-id': manajer }
  );
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(JSON.parse(res.body).orderDiscount, 30_000);
});

test('⛔ penyetuju yang TIDAK berhak ditolak 403', async () => {
  const fx = await setupDeviceAndShift();
  const v = await buatVariation(100_000);
  // Kasir tidak punya `approve_authorization` (`spec-f:42`). Tanpa penjaga
  // ini, "otorisasi manajer" dapat dipenuhi kasir kedua yang berdiri di
  // sebelahnya.
  const res = await req(
    'POST',
    '/orders',
    payloadOrder(fx, [baris(v)], {
      discount: { tipe: 'persen', nilai: 3000 },
      discountReasonCode: 'kompensasi_keluhan',
    }),
    { 'x-approver-id': kasirBiasa }
  );
  assert.equal(res.statusCode, 403, res.body);
  assert.equal(res.json().error.code, 'FORBIDDEN');
});

test('⛔ penyetuju yang tidak ada dijawab APPROVER_NOT_FOUND, bukan ACTOR_NOT_FOUND', async () => {
  const fx = await setupDeviceAndShift();
  const v = await buatVariation(100_000);
  // Manajer yang penyetujuannya ditolak tidak boleh diberi tahu bahwa
  // KASIR-nya yang tidak ditemukan — ia sedang berdiri di kasir dengan
  // pelanggan menunggu, dan akan mencari masalah di tempat yang keliru.
  const res = await req(
    'POST',
    '/orders',
    payloadOrder(fx, [baris(v)], {
      discount: { tipe: 'persen', nilai: 3000 },
      discountReasonCode: 'kompensasi_keluhan',
    }),
    { 'x-approver-id': crypto.randomUUID() }
  );
  assert.equal(res.statusCode, 404, res.body);
  assert.equal(res.json().error.code, 'APPROVER_NOT_FOUND');
});

test('⛔ ambang dapat dikonfigurasi per outlet', async () => {
  const fx = await setupDeviceAndShift();
  const v = await buatVariation(100_000);
  // Outlet yang menaikkan ambangnya ke 50% — diskon 30% berhenti menuntut PIN.
  await kueriTenant('UPDATE outlet SET discount_threshold_percent = 0.5 WHERE id = $1', [base.outlet.id]);

  const res = await req(
    'POST',
    '/orders',
    payloadOrder(fx, [baris(v)], {
      discount: { tipe: 'persen', nilai: 3000 },
      discountReasonCode: 'promo_berjalan',
    })
  );
  assert.equal(res.statusCode, 201, res.body);
});

// ---------------------------------------------------------------------------
// Audit — AC FR-B8 kedua
// ---------------------------------------------------------------------------

test('⛔ audit menyimpan DUA identitas terpisah beserta alasannya', async () => {
  const fx = await setupDeviceAndShift();
  const v = await buatVariation(100_000);
  const res = await req(
    'POST',
    '/orders',
    payloadOrder(fx, [baris(v)], {
      discount: { tipe: 'persen', nilai: 3000 },
      discountReasonCode: 'kompensasi_keluhan',
    }),
    { 'x-approver-id': manajer }
  );
  assert.equal(res.statusCode, 201, res.body);

  const { rows } = await kueriTenant(
    `SELECT actor_user_id, approver_user_id, reason_code, after
       FROM audit_event WHERE event_type = 'discount_applied'`,
    []
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].actor_user_id, base.user.id);
  assert.equal(rows[0].approver_user_id, manajer);
  assert.notEqual(rows[0].actor_user_id, rows[0].approver_user_id);
  assert.equal(rows[0].reason_code, 'kompensasi_keluhan');
  assert.equal(rows[0].after.orderDiscount, 30_000);
});

test('⛔ diskon di BAWAH ambang tetap menghasilkan audit, tanpa penyetuju', async () => {
  const fx = await setupDeviceAndShift();
  const v = await buatVariation(100_000);
  // Pola diskon kecil yang berulang adalah persis yang laporan exception
  // FR-G5 ada untuk menemukannya. Baris tanpa jejak tidak dapat ditemukan.
  const res = await req(
    'POST',
    '/orders',
    payloadOrder(fx, [baris(v)], {
      discount: { tipe: 'persen', nilai: 500 },
      discountReasonCode: 'karyawan',
    })
  );
  assert.equal(res.statusCode, 201, res.body);
  const { rows } = await kueriTenant(
    `SELECT approver_user_id, after FROM audit_event WHERE event_type = 'discount_applied'`,
    []
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].approver_user_id, null);
  assert.equal(rows[0].after.butuhPenyetuju, false);
});

test('order tanpa diskon tidak menghasilkan audit diskon', async () => {
  const fx = await setupDeviceAndShift();
  const v = await buatVariation(100_000);
  await req('POST', '/orders', payloadOrder(fx, [baris(v)]));
  const { rows } = await kueriTenant(
    `SELECT count(*) AS n FROM audit_event WHERE event_type = 'discount_applied'`,
    []
  );
  assert.equal(Number(rows[0].n), 0);
});

// ---------------------------------------------------------------------------
// Alasan
// ---------------------------------------------------------------------------

test('⛔ diskon tanpa alasan ditolak', async () => {
  const fx = await setupDeviceAndShift();
  const v = await buatVariation(100_000);
  const res = await req(
    'POST',
    '/orders',
    payloadOrder(fx, [baris(v)], { discount: { tipe: 'persen', nilai: 500 } })
  );
  assert.equal(res.statusCode, 400, res.body);
});

test('⛔ alasan di luar daftar tertutup ditolak', async () => {
  const fx = await setupDeviceAndShift();
  const v = await buatVariation(100_000);
  const res = await req(
    'POST',
    '/orders',
    payloadOrder(fx, [baris(v)], {
      discount: { tipe: 'persen', nilai: 500 },
      discountReasonCode: 'barang_rusak', // alasan REFUND, bukan diskon
    })
  );
  assert.equal(res.statusCode, 400, res.body);
});

test('"lainnya" wajib catatan minimal 10 karakter', async () => {
  const fx = await setupDeviceAndShift();
  const v = await buatVariation(100_000);
  const kurang = await req(
    'POST',
    '/orders',
    payloadOrder(fx, [baris(v)], {
      discount: { tipe: 'persen', nilai: 500 },
      discountReasonCode: 'lainnya',
      discountReasonNote: 'pendek',
    })
  );
  assert.equal(kurang.statusCode, 400, kurang.body);

  const cukup = await req(
    'POST',
    '/orders',
    payloadOrder(fx, [baris(v)], {
      discount: { tipe: 'persen', nilai: 500 },
      discountReasonCode: 'lainnya',
      discountReasonNote: 'kompensasi antrean panjang',
    })
  );
  assert.equal(cukup.statusCode, 201, cukup.body);
});

test('bentuk diskon yang cacat ditolak 400', async () => {
  const fx = await setupDeviceAndShift();
  const v = await buatVariation(100_000);
  for (const discount of [
    { tipe: 'gratis', nilai: 100 },
    { tipe: 'persen', nilai: -5 },
    { tipe: 'persen', nilai: 1.5 },
    { tipe: 'persen', nilai: '1000' },
  ]) {
    const res = await req(
      'POST',
      '/orders',
      payloadOrder(fx, [baris(v)], { discount, discountReasonCode: 'promo_berjalan' })
    );
    assert.equal(res.statusCode, 400, `${JSON.stringify(discount)} lolos: ${res.body}`);
  }
});

// ---------------------------------------------------------------------------
// ⛔ Selisih hitungan (FR-H6) — yang paling mudah salah
// ---------------------------------------------------------------------------

test('total klien yang cocok pada order berdiskon tidak menghasilkan penanda', async () => {
  const fx = await setupDeviceAndShift();
  const v = await buatVariation(100_000);
  const res = await req(
    'POST',
    '/orders',
    payloadOrder(fx, [baris(v)], {
      discount: { tipe: 'persen', nilai: 1000 },
      discountReasonCode: 'promo_berjalan',
      total: 90_000,
      lines: [{ ...baris(v), unitPrice: 100_000 }],
    })
  );
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(JSON.parse(res.body).hasCalculationVariance, false);
});

test('⛔ selisih HARGA BASI pada order berdiskon tetap terjelaskan', async () => {
  const fx = await setupDeviceAndShift();
  const v = await buatVariationLengkap(10_000);
  const sekarang = await jamDatabase();
  // Harga naik satu menit lalu; perangkat masih memakai harga lama.
  await ubahHarga(v, 25_000, geser(sekarang, -60));

  // ⛔ Test ini ADA karena sabotase membuktikan versi sebelumnya HAMPA.
  // Versi pertama mengirim total yang COCOK dengan hitungan server, dan jalur
  // pemeriksaan selisih tidak pernah berjalan sama sekali — jadi meneruskan
  // diskon `0n` ke `hitungTotalVersiKlien` tidak membuat satu pun test merah.
  //
  // Yang benar-benar menguji aturannya adalah keadaan ini: total klien
  // BERBEDA dari total server (harga basi), DAN ada diskon. Server
  // menghitung ulang memakai harga klien; kalau perhitungan ulang itu
  // mengabaikan diskon, ia menghasilkan 10.000 sementara klien menyebut
  // 9.000 — selisih yang "tidak terjelaskan", dan setiap order berdiskon
  // dari perangkat yang harganya basi masuk laporan exception.
  const res = await req(
    'POST',
    '/orders',
    payloadOrder(fx, [], {
      discount: { tipe: 'persen', nilai: 1000 },
      discountReasonCode: 'promo_berjalan',
      // Klien: 10.000 - 10% = 9.000. Konsisten dengan harganya sendiri.
      total: 9_000,
      lines: [{ ...baris(v.variationId), unitPrice: 10_000 }],
    })
  );
  assert.equal(res.statusCode, 201, res.body);
  const order = JSON.parse(res.body);
  // Yang TERSIMPAN tetap hitungan server: 25.000 - 10% = 22.500.
  assert.equal(order.total, 22_500);
  assert.equal(
    order.hasCalculationVariance,
    false,
    'harga basi + diskon terbaca sebagai selisih yang tidak terjelaskan'
  );
});
