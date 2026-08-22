'use strict';

// ⛔ QRIS statis dan EDC yang dibuat OFFLINE, lewat transport relay yang SAMA.
//
// Aturan yang lahir 21 Agustus 2026 (`CLAUDE.md`, "Transport perangkat diuji
// SEBAGAI transport"): setiap operasi yang perangkat kirim lewat outbox wajib
// punya satu test yang memakai `buatPengirimHttp` dan `klasifikasi` yang
// ASLI, dengan hanya `fetch` yang dipalsukan.
//
// Alasannya di sini persis sama dengan pada refund: muatan pembayaran disusun
// `simpanPenjualan` dan dikirim `buatPengirimHttp`, dan yang membuktikan
// keduanya cocok dengan server BUKAN test yang menuliskan muatannya sendiri.
// QRIS statis menuntut `reference`; EDC menuntut `approvalCode`. Muatan yang
// melewatkan salah satunya dijawab `400` → `gagal-permanen`, dan berhenti di
// antrean SELAMANYA — sementara pelanggan sudah membayar.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');
const { buatPengirimHttp } = require('../../packages/sync-client/src/http.ts');
const { klasifikasi } = require('../../packages/sync-client/src/klasifikasi.ts');

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
  base = await seedTenantBase(appSetup, { suffix: 'RelayBayar' });
  tenant = base.tenant;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();
});

function req(method, url, payload, headers = {}) {
  return app.inject({
    method,
    url,
    payload,
    headers: {
      'x-tenant-id': tenant.id,
      authorization: base.authHeader,
      'x-actor-id': base.user.id,
      'idempotency-key': crypto.randomUUID(),
      ...headers,
    },
  });
}

/** Order OPEN yang belum dibayar — persis keadaan sebelum relay pembayaran. */
async function orderTerbuka(seq) {
  const deviceId = crypto.randomUUID();
  assert.equal(
    (await req('POST', '/devices', { id: deviceId, outletId: base.outlet.id, code: `K${seq}` }))
      .statusCode,
    201
  );
  const shiftId = crypto.randomUUID();
  assert.equal(
    (await req('POST', '/shifts', {
      id: shiftId, outletId: base.outlet.id, deviceId,
      businessDate: '2026-08-22', openingFloat: 100000,
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
    receiptNumber: `K${seq}-20260822-000${seq}`,
    businessDate: '2026-08-22', sequence: seq, channel: 'takeaway',
    checkId: crypto.randomUUID(),
    lines: [{ id: crypto.randomUUID(), variationId, quantityMilli: 1000, discountAmount: 0 }],
  });
  assert.equal(o.statusCode, 201, o.body);
  return { orderId, total: o.json().total };
}

/** `fetch` yang meneruskan ke server sungguhan, apa adanya. */
function relay() {
  return buatPengirimHttp({
    baseUrl: 'http://server.uji',
    tenantId: tenant.id,
    actorId: base.user.id,
    fetchFn: async (url, opts) => {
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
    },
  });
}

function barisOutbox(orderId, payload) {
  return {
    id: crypto.randomUUID(),
    entity_type: 'payment',
    entity_id: orderId,
    operation: 'create',
    payload: JSON.stringify(payload),
    idempotency_key: payload.id,
    status: 'pending',
    attempts: 0,
    last_error: null,
    last_attempt_at: null,
    created_at: new Date().toISOString(),
    depends_on: null,
    actor_id: base.user.id,
    approver_id: null,
  };
}

async function kueriTenant(sql, params) {
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  const hasil = await appSetup.query(sql, params);
  await appSetup.query('COMMIT');
  return hasil;
}

/**
 * Muatan yang benar-benar disusun `simpanPenjualan` — bukan yang ditulis
 * tangan di sini. Itu seluruh gunanya test ini.
 */
async function muatanDariPerangkat(pembayaran, orderId, amountDue) {
  const { simpanPenjualan } = await import('../../apps/kasir/src/kasir/penjualan.ts');
  const tulis = [];
  const db = {
    async getAll(sql) {
      if (/FROM outlet/.test(sql)) {
        return [{
          name: 'Outlet', timezone: 'Asia/Jakarta', business_day_ends_at: '04:00:00',
          rounding_increment: 100, rounding_mode: 'half_up', service_charge_rate: 0,
          discount_threshold_percent: null, discount_threshold_amount: null,
        }];
      }
      if (/FROM device_config/.test(sql)) return [{ receipt_sequence: 0, sequence_business_date: null }];
      return [];
    },
    async execute(sql, params = []) {
      tulis.push({ sql, params });
      return { rowsAffected: 1 };
    },
    async transaction(fn) {
      return fn(db);
    },
  };

  await simpanPenjualan({
    db,
    konfig: { deviceId: 'd1', deviceCode: 'K9', tenantId: tenant.id, outletId: base.outlet.id },
    sesi: { userId: base.user.id, nama: 'Sari', peran: ['cashier'], masukPada: '', wajibGantiPin: false },
    shift: { id: 's1', businessDate: '2026-08-22', openingFloat: 0 },
    keranjang: {
      baris: [{
        id: crypto.randomUUID(), variationId: 'v1', itemName: 'Kopi',
        variationName: 'Regular', unitPrice: Number(amountDue), quantityMilli: 1000, modifier: [],
      }],
      diskon: null,
    },
    pembayaran,
    waktu: () => new Date('2026-08-22T07:00:00Z'),
    idBaru: () => crypto.randomUUID(),
    hlc: () => 1n,
  });

  const outbox = tulis.filter((t) => /INSERT INTO outbox_local/.test(t.sql));
  const bayar = outbox.find((t) => t.params.includes('payment'));
  const muatan = JSON.parse(bayar.params.find((p) => typeof p === 'string' && p.startsWith('{')));
  // Order-nya sudah ada di server lewat jalur di atas; hanya muatannya yang
  // dipinjam dari perangkat.
  return { ...muatan, id: crypto.randomUUID(), orderId };
}

// ---------------------------------------------------------------------------

test('⛔ QRIS statis dari perangkat MENDARAT di server', async () => {
  const { orderId, total } = await orderTerbuka(1);
  const muatan = await muatanDariPerangkat(
    { metode: 'qris_static', referensi: '22000 · ref 4821' },
    orderId,
    total
  );

  const hasil = await relay()(barisOutbox(orderId, muatan));
  assert.equal(
    klasifikasi(hasil),
    'terkirim',
    `pembayaran QRIS berhenti di antrean: ${hasil.status} ${JSON.stringify(hasil.body ?? {})}`
  );

  const { rows } = await kueriTenant(
    `SELECT method, confirmed_manually, provider_reference, tendered_amount
       FROM payment WHERE order_id = $1`,
    [orderId]
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].method, 'qris_static');
  // FR-G5 memakainya: tidak ada SISTEM yang memverifikasi pembayaran ini.
  assert.equal(rows[0].confirmed_manually, true);
  assert.equal(rows[0].provider_reference, '22000 · ref 4821');
  assert.equal(rows[0].tendered_amount, null);
});

test('⛔ EDC dari perangkat MENDARAT di server', async () => {
  const { orderId, total } = await orderTerbuka(2);
  const muatan = await muatanDariPerangkat(
    { metode: 'card_edc', approvalCode: 'A12345', cardLast4: '4821' },
    orderId,
    total
  );

  const hasil = await relay()(barisOutbox(orderId, muatan));
  assert.equal(klasifikasi(hasil), 'terkirim', `${hasil.status}`);

  const { rows } = await kueriTenant(
    `SELECT method, approval_code, card_last4, confirmed_manually
       FROM payment WHERE order_id = $1`,
    [orderId]
  );
  assert.equal(rows[0].method, 'card_edc');
  assert.equal(rows[0].approval_code, 'A12345');
  assert.equal(rows[0].card_last4, '4821');
  // EDC punya bukti dari acquirer; `confirmed_manually` khusus QRIS statis.
  assert.equal(rows[0].confirmed_manually, false);
});

test('⛔ QRIS statis TIDAK menghasilkan cash_movement di server', async () => {
  const { orderId, total } = await orderTerbuka(3);
  const muatan = await muatanDariPerangkat(
    { metode: 'qris_static', referensi: 'ref 4821' },
    orderId,
    total
  );
  assert.equal(klasifikasi(await relay()(barisOutbox(orderId, muatan))), 'terkirim');

  // Perangkat juga tidak menulisnya secara lokal; kalau salah satu sisi
  // menulis dan sisi lain tidak, saldo laci merchant dan saldo laci server
  // berpisah tanpa satu pun error.
  const { rows } = await kueriTenant(
    `SELECT count(*)::int AS n FROM cash_movement WHERE order_id = $1`,
    [orderId]
  );
  assert.equal(rows[0].n, 0);
});
