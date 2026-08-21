'use strict';

// ⛔ Refund yang dibuat OFFLINE, dikirim lewat transport relay yang SAMA.
//
// Ini bukan test yang menambah cakupan — ia menutup cacat yang sudah hidup di
// kode yang lolos review dan lolos gate:
//
//   `POST /orders/{id}/cancel` menuntut `X-Approver-Id` untuk setiap refund.
//   Relay outbox TIDAK PERNAH mengirim header itu, dan `outbox_local` tidak
//   punya kolom untuk menyimpannya. Jadi SETIAP REFUND YANG DIBUAT OFFLINE
//   dijawab `400 MISSING_APPROVER_ID`, diklasifikasi `gagal-permanen`, dan
//   berhenti di antrean SELAMANYA — sementara kasir sudah mengembalikan
//   uangnya, stok sudah kembali, dan laci sudah berkurang.
//
// Buku merchant dan buku server berpisah, tanpa satu pun error di mana pun.
//
// ## ⛔ Kenapa tidak tertangkap 18 test void/refund yang sudah ada
//
// Semuanya memanggil endpoint LANGSUNG dengan header lengkap — yaitu bentuk
// yang dipakai back-office, bukan bentuk yang dipakai perangkat kasir. Yang
// tidak pernah diuji adalah JALAN MASUKNYA: `buatPengirimHttp` menyusun
// headernya sendiri, dan header yang tidak pernah disusunnya tidak dapat
// hilang dari test yang menuliskan headernya sendiri.
//
// Karena itu test ini memakai `buatPengirimHttp` yang SUNGGUHAN dan
// `klasifikasi` yang SUNGGUHAN. Yang dipalsukan hanya `fetch`, dan ia
// meneruskan ke server sungguhan.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');
const { buatPengirimHttp } = require('../../packages/sync-client/src/http.ts');
const { klasifikasi } = require('../../packages/sync-client/src/klasifikasi.ts');

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
  base = await seedTenantBase(appSetup, { suffix: 'RelayRefund' });
  tenant = base.tenant;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();
  manajer = await buatManajer();
});

function req(method, url, payload, headers = {}) {
  const h = {
    'x-tenant-id': tenant.id,
    authorization: base.authHeader,
    'x-actor-id': base.user.id,
    'idempotency-key': crypto.randomUUID(),
    ...headers,
  };
  return app.inject({ method, url, payload, headers: h });
}

async function buatManajer() {
  const id = crypto.randomUUID();
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await appSetup.query(
    `INSERT INTO "user" (id, tenant_id, name, is_active) VALUES ($1, $2, 'Manajer', true)`,
    [id, tenant.id]
  );
  await appSetup.query(
    `INSERT INTO user_role (id, tenant_id, user_id, role, scope_type, scope_id)
     VALUES ($1, $2, $3, 'outlet_manager', 'outlet', $4)`,
    [crypto.randomUUID(), tenant.id, id, base.outlet.id]
  );
  await appSetup.query('COMMIT');
  return id;
}

/** Satu order yang benar-benar tertutup, lewat jalur uang yang sungguhan. */
async function orderTertutup(seq) {
  const deviceId = crypto.randomUUID();
  assert.equal(
    (await req('POST', '/devices', { id: deviceId, outletId: base.outlet.id, code: `K${seq}` })).statusCode,
    201
  );
  const shiftId = crypto.randomUUID();
  assert.equal(
    (await req('POST', '/shifts', {
      id: shiftId, outletId: base.outlet.id, deviceId,
      businessDate: '2026-08-21', openingFloat: 100000,
    })).statusCode,
    201
  );
  const variationId = crypto.randomUUID();
  assert.equal(
    (await req('POST', '/items', {
      id: crypto.randomUUID(), name: `Kopi ${seq}`,
      variations: [{ id: variationId, price: 20000 }],
    })).statusCode,
    201
  );
  const orderId = crypto.randomUUID();
  const o = await req('POST', '/orders', {
    id: orderId, outletId: base.outlet.id, deviceId, shiftId,
    receiptNumber: `K${seq}-20260821-000${seq}`,
    businessDate: '2026-08-21', sequence: seq, channel: 'takeaway',
    checkId: crypto.randomUUID(),
    lines: [{ id: crypto.randomUUID(), variationId, quantityMilli: 1000, discountAmount: 0 }],
  });
  assert.equal(o.statusCode, 201, o.body);
  const total = o.json().total;
  const p = await req('POST', `/orders/${orderId}/payments`, {
    id: crypto.randomUUID(), method: 'cash', tenderedAmount: total,
  });
  assert.equal(p.statusCode, 201, p.body);
  assert.equal(p.json().order.status, 'closed');
  return { orderId, total };
}

/** `fetch` yang meneruskan ke server sungguhan, apa adanya. */
function fetchKeServer() {
  return async (url, opts) => {
    const res = await app.inject({
      method: opts.method,
      url: new URL(url).pathname,
      payload: opts.body,
      headers: opts.headers,
    });
    return {
      status: res.statusCode,
      ok: res.statusCode >= 200 && res.statusCode < 300,
      async json() {
        return res.json();
      },
    };
  };
}

function relay() {
  return buatPengirimHttp({
    baseUrl: 'http://server.uji',
    tenantId: tenant.id,
    actorId: base.user.id,
    fetchFn: fetchKeServer(),
  });
}

function barisOutbox(over = {}) {
  return {
    id: crypto.randomUUID(),
    entity_type: 'order_cancel',
    entity_id: over.entity_id,
    operation: 'cancel',
    payload: JSON.stringify(over.payload),
    idempotency_key: crypto.randomUUID(),
    status: 'pending',
    attempts: 0,
    last_error: null,
    last_attempt_at: null,
    created_at: new Date().toISOString(),
    depends_on: null,
    actor_id: base.user.id,
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

test('⛔ refund offline MENDARAT di server — penyetuju ikut lewat baris outbox', async () => {
  const { orderId, total } = await orderTertutup(1);

  const hasil = await relay()(
    barisOutbox({
      entity_id: orderId,
      payload: { id: crypto.randomUUID(), reasonCode: 'barang_rusak', amount: total, lines: [] },
      // Dibekukan saat refund DIBUAT di perangkat, sama seperti `actor_id`.
      approver_id: manajer,
    })
  );

  assert.equal(klasifikasi(hasil), 'terkirim', `refund offline tidak sampai: ${JSON.stringify(hasil)}`);

  // Dan ia benar-benar tercatat, dengan DUA identitas terpisah.
  const { rows } = await kueriTenant(
    `SELECT amount, approved_by FROM refund WHERE order_id = $1`,
    [orderId]
  );
  assert.equal(rows.length, 1, 'baris refund tidak ada di server');
  assert.equal(rows[0].approved_by, manajer);
  assert.notEqual(rows[0].approved_by, base.user.id);
});

test('⛔ tanpa penyetuju, refund ditolak PERMANEN — inilah cacat yang ditutup', async () => {
  const { orderId, total } = await orderTertutup(2);

  // Bentuk yang dikirim relay SEBELUM `approver_id` ada. Ia harus tetap
  // ditolak — yang berubah bukan aturan servernya, melainkan kemampuan klien
  // membawa penyetujunya.
  const hasil = await relay()(
    barisOutbox({
      entity_id: orderId,
      payload: { id: crypto.randomUUID(), reasonCode: 'barang_rusak', amount: total, lines: [] },
      approver_id: null,
    })
  );

  assert.equal(hasil.status, 400);
  assert.equal(hasil.code, 'MISSING_APPROVER_ID');
  // `gagal-permanen` berarti item berhenti di antrean SELAMANYA. Itu yang
  // dialami setiap refund offline sebelum perbaikan ini.
  assert.equal(klasifikasi(hasil), 'gagal-permanen');
});

test('⛔ header penyetuju KOSONG tidak pernah dikirim', async () => {
  const { orderId, total } = await orderTertutup(3);
  // String kosong ditolak `getApproverId` dengan pesan yang sama persis,
  // jadi mengirimnya selalu hanya memindahkan kegagalan tanpa memperbaikinya.
  // Yang diuji: relay TIDAK mengarang header dari nilai kosong.
  let dikirim = null;
  const kirim = buatPengirimHttp({
    baseUrl: 'http://server.uji',
    tenantId: tenant.id,
    actorId: base.user.id,
    fetchFn: async (url, opts) => {
      dikirim = opts.headers;
      return fetchKeServer()(url, opts);
    },
  });
  await kirim(
    barisOutbox({
      entity_id: orderId,
      payload: { id: crypto.randomUUID(), reasonCode: 'barang_rusak', amount: total, lines: [] },
      approver_id: '',
    })
  );
  assert.equal(dikirim['X-Approver-Id'], undefined);
});

test('void offline tetap berjalan TANPA penyetuju', async () => {
  // Keputusan 1 Agustus 2026: void TIDAK menuntut PIN manajer. Kalau relay
  // mulai menuntut penyetuju untuk semua pembatalan, void offline ikut
  // berhenti — dan void adalah jalur yang jauh lebih sering dipakai.
  const deviceId = crypto.randomUUID();
  assert.equal(
    (await req('POST', '/devices', { id: deviceId, outletId: base.outlet.id, code: 'KV' })).statusCode,
    201
  );
  const shiftId = crypto.randomUUID();
  assert.equal(
    (await req('POST', '/shifts', {
      id: shiftId, outletId: base.outlet.id, deviceId,
      businessDate: '2026-08-21', openingFloat: 100000,
    })).statusCode,
    201
  );
  const variationId = crypto.randomUUID();
  assert.equal(
    (await req('POST', '/items', {
      id: crypto.randomUUID(), name: 'Teh',
      variations: [{ id: variationId, price: 15000 }],
    })).statusCode,
    201
  );
  const orderId = crypto.randomUUID();
  const o = await req('POST', '/orders', {
    id: orderId, outletId: base.outlet.id, deviceId, shiftId,
    receiptNumber: 'KV-20260821-0009', businessDate: '2026-08-21', sequence: 9,
    channel: 'takeaway', checkId: crypto.randomUUID(),
    lines: [{ id: crypto.randomUUID(), variationId, quantityMilli: 1000, discountAmount: 0 }],
  });
  assert.equal(o.statusCode, 201, o.body);

  const hasil = await relay()(
    barisOutbox({
      entity_id: orderId,
      payload: {
        id: crypto.randomUUID(),
        reasonCode: 'salah_input',
        receiptNumber: 'KV-20260821-0010',
        sequence: 10,
      },
      approver_id: null,
    })
  );
  assert.equal(klasifikasi(hasil), 'terkirim', `void offline tidak sampai: ${JSON.stringify(hasil)}`);
});
