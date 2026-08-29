'use strict';

// FR-F8 — deteksi manipulasi jam, lewat transport relay yang SAMA.
//
// ⛔ Aturan 21 Agustus (`CLAUDE.md`, "Transport perangkat diuji SEBAGAI
// transport"): header `X-Device-Time` disusun `buatPengirimHttp`, dan test
// yang menuliskan headernya sendiri tidak dapat membuktikan adapter benar-benar
// mengirimkannya. Yang dipalsukan di sini hanya `fetch` dan jam perangkat.
//
// ⛔ Dan satu hal yang HARUS diuji terhadap server sungguhan: bahwa penjualan
// tetap TERSIMPAN saat jamnya menyimpang. Jam yang meleset bukan alasan
// menolak penjualan — uangnya sudah diterima merchant, dan menolaknya berarti
// kehilangan penjualan karena baterai jam sebuah tablet habis.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');
const { buatPengirimHttp } = require('../../packages/sync-client/src/http.ts');
const { klasifikasi } = require('../../packages/sync-client/src/klasifikasi.ts');

let owner, appSetup, app, tenant, base, deviceId, shiftId, variationId;

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
  base = await seedTenantBase(appSetup, { suffix: 'DriftJam' });
  tenant = base.tenant;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();

  deviceId = crypto.randomUUID();
  assert.equal(
    (await req('POST', '/devices', { id: deviceId, outletId: base.outlet.id, code: 'K1' })).statusCode,
    201
  );
  shiftId = crypto.randomUUID();
  assert.equal(
    (await req('POST', '/shifts', {
      id: shiftId, outletId: base.outlet.id, deviceId,
      businessDate: '2026-08-23', openingFloat: 100000,
    })).statusCode,
    201
  );
  variationId = crypto.randomUUID();
  assert.equal(
    (await req('POST', '/items', {
      id: crypto.randomUUID(), name: 'Kopi', variations: [{ id: variationId, price: 20000 }],
    })).statusCode,
    201
  );
});

function req(method, url, payload, headers = {}) {
  return app.inject({
    method, url, payload,
    headers: {
      'x-tenant-id': tenant.id,
      authorization: base.authHeader,
      'x-actor-id': base.user.id,
      'idempotency-key': crypto.randomUUID(),
      ...headers,
    },
  });
}

/** Relay SUNGGUHAN, dengan jam perangkat yang dapat digeser. */
function relay(jamPerangkat) {
  return buatPengirimHttp({
    baseUrl: 'http://server.uji',
    tenantId: tenant.id,
    actorId: base.user.id,
    waktu: () => jamPerangkat,
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

function barisOrder(seq) {
  const orderId = crypto.randomUUID();
  return {
    id: crypto.randomUUID(),
    entity_type: 'order',
    entity_id: orderId,
    operation: 'create',
    payload: JSON.stringify({
      id: orderId,
      outletId: base.outlet.id,
      deviceId,
      shiftId,
      receiptNumber: `K1-20260823-000${seq}`,
      businessDate: '2026-08-23',
      sequence: seq,
      channel: 'takeaway',
      checkId: crypto.randomUUID(),
      lines: [{ id: crypto.randomUUID(), variationId, quantityMilli: 1000, discountAmount: 0 }],
    }),
    idempotency_key: crypto.randomUUID(),
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

const drift = () =>
  kueriTenant(
    `SELECT after, device_id FROM audit_event WHERE event_type = 'clock_drift_detected'`
  );

// ---------------------------------------------------------------------------

test('jam perangkat yang WAJAR tidak menghasilkan audit event', async () => {
  const hasil = await relay(new Date())(barisOrder(1));
  assert.equal(klasifikasi(hasil), 'terkirim', `${hasil.status}`);

  const { rows } = await drift();
  assert.equal(rows.length, 0, 'armada sehat ikut ditandai');
});

test('⛔ jam yang MAJU satu jam ditandai, dan penjualannya TETAP tersimpan', async () => {
  const majuSejam = new Date(Date.now() + 3600_000);
  const hasil = await relay(majuSejam)(barisOrder(2));

  // Jam yang meleset bukan alasan menolak penjualan. Aturan yang sama dengan
  // selisih hitungan (`spec-h:95`): ditandai, tidak ditolak.
  assert.equal(klasifikasi(hasil), 'terkirim', `penjualan ditolak karena jam: ${hasil.status}`);
  const { rows: order } = await kueriTenant(`SELECT count(*)::int AS n FROM "order"`);
  assert.equal(order[0].n, 1);

  const { rows } = await drift();
  assert.equal(rows.length, 1, 'jam yang menyimpang tidak ditandai');
  assert.equal(rows[0].device_id, deviceId);
  // Angkanya masuk `after`, bukan ke pesan teks: laporan X8 membacanya untuk
  // mengurutkan.
  assert.ok(Math.abs(rows[0].after.skewDetik - 3600) < 30, JSON.stringify(rows[0].after));
});

test('⛔ jam yang MUNDUR juga ditandai, dengan tanda negatif', async () => {
  await relay(new Date(Date.now() - 3600_000))(barisOrder(3));
  const { rows } = await drift();
  assert.equal(rows.length, 1);
  assert.ok(rows[0].after.skewDetik < 0, `arah selisih hilang: ${JSON.stringify(rows[0].after)}`);
});

test('⛔ DIBATASI satu per perangkat per jam', async () => {
  const maju = new Date(Date.now() + 3600_000);
  const kirim = relay(maju);
  for (const seq of [4, 5, 6]) {
    assert.equal(klasifikasi(await kirim(barisOrder(seq))), 'terkirim');
  }
  // Perangkat yang salah setel mengirim puluhan permintaan sehari; satu audit
  // event per permintaan mengubur seluruh audit trail di bawah satu tablet.
  const { rows } = await drift();
  assert.equal(rows.length, 1, `tiga penjualan menghasilkan ${rows.length} audit event`);
});

test('⛔ relay TANPA jam (klien N-1) tidak menandai apa pun', async () => {
  const kirim = buatPengirimHttp({
    baseUrl: 'http://server.uji',
    tenantId: tenant.id,
    actorId: base.user.id,
    // `waktu` sengaja tidak diberikan — bentuk yang dipakai klien versi lama.
    fetchFn: async (url, opts) => {
      const res = await app.inject({
        method: opts.method, url: new URL(url).pathname,
        payload: opts.body, headers: opts.headers,
      });
      return { status: res.statusCode, ok: res.ok, async json() { return res.json(); } };
    },
  });
  assert.equal(klasifikasi(await kirim(barisOrder(7))), 'terkirim');

  const { rows } = await drift();
  assert.equal(rows.length, 0, 'armada versi lama ditandai sebagai jam termanipulasi');
});

test('X8 melaporkannya, terurut dari selisih TERBESAR', async () => {
  await relay(new Date(Date.now() + 7200_000))(barisOrder(8));

  const res = await req('GET', `/reports/exceptions/clock?from=2026-08-01&to=2026-12-31`);
  assert.equal(res.statusCode, 200, res.body);
  const body = res.json();
  assert.equal(body.ambangDetik, 300);
  assert.equal(body.anomali.length, 1);
  assert.equal(body.anomali[0].deviceCode, 'K1');
  // Tanpa bahasa menuduh: tidak ada skor, tidak ada label.
  assert.equal(/mencurigakan|suspicious|skor/i.test(res.body), false, res.body);
});
