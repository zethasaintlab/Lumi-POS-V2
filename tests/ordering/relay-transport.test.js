'use strict';

// ⛔ SETIAP jenis item outbox, lewat transport relay yang SUNGGUHAN.
//
// Aturan ini lahir dari cacat yang nyata (`refund-offline-relay.test.js`):
// setiap refund yang dibuat offline dijawab `400 MISSING_APPROVER_ID` dan
// berhenti permanen di antrean, sementara delapan belas test void/refund tetap
// hijau. Semuanya memanggil endpoint LANGSUNG dengan header yang ditulis test
// itu sendiri — dan header yang tidak pernah disusun `buatPengirimHttp` tidak
// dapat hilang dari test yang menuliskan headernya sendiri.
//
// Berkas ini menutup kelas itu untuk SELURUH jenis, bukan satu sebagai wakil.
// Yang dipakai adalah `buatPengirimHttp` dan `klasifikasi` yang ASLI; yang
// dipalsukan hanya `fetch`, dan ia meneruskan ke server sungguhan.
//
// ⛔ Penjaga di bawah menuntut setiap jenis di `RUTE_DIDUKUNG` muncul di sini.
// Jenis yang ditambahkan besok tanpa test transport akan membuatnya merah —
// itu satu-satunya hal yang mencegah cacat yang sama lahir lagi.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');
const { buatPengirimHttp, RUTE_DIDUKUNG } = require('../../packages/sync-client/src/http.ts');
const { klasifikasi } = require('../../packages/sync-client/src/klasifikasi.ts');

/** Jenis yang berkas ini benar-benar kirim lewat transport. */
const DIUJI = new Set();

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
  base = await seedTenantBase(appSetup, { suffix: 'RelayTransport' });
  tenant = base.tenant;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();
  manajer = await buatManajer();
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

/** Mengirim satu baris outbox lewat relay ASLI, dan mencatat jenisnya. */
async function relaikan(baris) {
  DIUJI.add(baris.entity_type);
  const kirim = buatPengirimHttp({
    baseUrl: 'http://server.uji',
    tenantId: tenant.id,
    actorId: base.user.id,
    fetchFn: fetchKeServer(),
  });
  return kirim({
    id: crypto.randomUUID(),
    operation: 'create',
    idempotency_key: crypto.randomUUID(),
    status: 'pending',
    attempts: 0,
    last_error: null,
    last_attempt_at: null,
    created_at: new Date().toISOString(),
    depends_on: null,
    actor_id: base.user.id,
    ...baris,
    payload: JSON.stringify(baris.payload),
  });
}

function sampai(hasil, apa) {
  assert.equal(klasifikasi(hasil), 'terkirim', `${apa} tidak sampai: ${JSON.stringify(hasil)}`);
}

const TANGGAL = '2026-08-21';
let n = 0;

async function perangkatDanShift() {
  n += 1;
  const deviceId = crypto.randomUUID();
  assert.equal(
    (await req('POST', '/devices', { id: deviceId, outletId: base.outlet.id, code: `K${n}` })).statusCode,
    201
  );
  return { deviceId, shiftId: crypto.randomUUID(), seq: n };
}

async function variasi(harga = 20000) {
  const variationId = crypto.randomUUID();
  assert.equal(
    (await req('POST', '/items', {
      id: crypto.randomUUID(),
      name: `P${variationId.slice(0, 6)}`,
      variations: [{ id: variationId, price: harga }],
    })).statusCode,
    201
  );
  return variationId;
}

// ---------------------------------------------------------------------------

test('shift dibuka lewat relay', async () => {
  const fx = await perangkatDanShift();
  const hasil = await relaikan({
    entity_type: 'shift',
    entity_id: fx.shiftId,
    payload: {
      id: fx.shiftId,
      outletId: base.outlet.id,
      deviceId: fx.deviceId,
      businessDate: TANGGAL,
      openingFloat: 100000,
    },
  });
  sampai(hasil, 'shift');
});

test('order dan payment mendarat lewat relay, berurutan', async () => {
  const fx = await perangkatDanShift();
  await relaikan({
    entity_type: 'shift',
    entity_id: fx.shiftId,
    payload: {
      id: fx.shiftId, outletId: base.outlet.id, deviceId: fx.deviceId,
      businessDate: TANGGAL, openingFloat: 100000,
    },
  });
  const variationId = await variasi();
  const orderId = crypto.randomUUID();

  const hasilOrder = await relaikan({
    entity_type: 'order',
    entity_id: orderId,
    payload: {
      id: orderId, outletId: base.outlet.id, deviceId: fx.deviceId, shiftId: fx.shiftId,
      receiptNumber: `K${fx.seq}-20260821-0001`, businessDate: TANGGAL, sequence: 1,
      channel: 'takeaway', checkId: crypto.randomUUID(),
      lines: [{ id: crypto.randomUUID(), variationId, quantityMilli: 1000, discountAmount: 0 }],
    },
  });
  sampai(hasilOrder, 'order');

  const hasilBayar = await relaikan({
    entity_type: 'payment',
    entity_id: orderId,
    payload: { id: crypto.randomUUID(), method: 'cash', tenderedAmount: 20000 },
  });
  sampai(hasilBayar, 'payment');
});

test('penandaan habis (sold_out) mendarat lewat relay', async () => {
  const variationId = await variasi();
  const hasil = await relaikan({
    entity_type: 'sold_out',
    entity_id: crypto.randomUUID(),
    payload: {
      id: crypto.randomUUID(),
      outletId: base.outlet.id,
      variationId,
      isSoldOut: true,
      hlc: '1',
    },
  });
  sampai(hasil, 'sold_out');
});

test('no-sale di BAWAH ambang mendarat tanpa penyetuju', async () => {
  const fx = await perangkatDanShift();
  await relaikan({
    entity_type: 'shift',
    entity_id: fx.shiftId,
    payload: {
      id: fx.shiftId, outletId: base.outlet.id, deviceId: fx.deviceId,
      businessDate: TANGGAL, openingFloat: 100000,
    },
  });
  const hasil = await relaikan({
    entity_type: 'no_sale',
    entity_id: fx.shiftId,
    payload: { id: crypto.randomUUID(), reasonCode: 'tukar_uang', reasonNote: null },
  });
  sampai(hasil, 'no_sale');
});

test('kas masuk/keluar (cash_movement) mendarat lewat relay', async () => {
  // FR-D5. Rincian arah, tanda `delta`, counterpart, idempotensi, dan
  // klasifikasi kegagalannya diuji di `kas-manual-offline-relay.test.js`;
  // yang ditegakkan DI SINI adalah bahwa jenisnya benar-benar pernah melewati
  // transport asli — itulah yang dibaca penjaga `RUTE_DIDUKUNG` di bawah.
  const fx = await perangkatDanShift();
  await relaikan({
    entity_type: 'shift',
    entity_id: fx.shiftId,
    payload: {
      id: fx.shiftId, outletId: base.outlet.id, deviceId: fx.deviceId,
      businessDate: TANGGAL, openingFloat: 100000,
    },
  });
  const hasil = await relaikan({
    entity_type: 'cash_movement',
    entity_id: fx.shiftId,
    payload: {
      id: crypto.randomUUID(),
      arah: 'keluar',
      jumlah: '50000',
      reasonCode: 'bayar_pemasok',
      reasonNote: null,
    },
  });
  sampai(hasil, 'cash_movement');
});

test('⛔ no-sale di ATAS ambang mendarat KARENA penyetuju ikut di baris outbox', async () => {
  const fx = await perangkatDanShift();
  await relaikan({
    entity_type: 'shift',
    entity_id: fx.shiftId,
    payload: {
      id: fx.shiftId, outletId: base.outlet.id, deviceId: fx.deviceId,
      businessDate: TANGGAL, openingFloat: 100000,
    },
  });

  // `AMBANG_NO_SALE = 3` berarti tiga yang bebas; yang KEEMPAT menuntut PIN.
  for (let i = 0; i < 3; i += 1) {
    const bebas = await relaikan({
      entity_type: 'no_sale',
      entity_id: fx.shiftId,
      payload: { id: crypto.randomUUID(), reasonCode: 'tukar_uang', reasonNote: null },
    });
    sampai(bebas, `no_sale ke-${i + 1}`);
  }

  // ⛔ Inilah bentuk cacat yang sama dengan refund offline: laci sudah
  // terbuka, PIN manajer sudah dimasukkan di perangkat, dan tanpa
  // `approver_id` di baris outbox servernya tidak pernah tahu.
  const keempat = await relaikan({
    entity_type: 'no_sale',
    entity_id: fx.shiftId,
    payload: { id: crypto.randomUUID(), reasonCode: 'tukar_uang', reasonNote: null },
    approver_id: manajer,
  });
  sampai(keempat, 'no_sale keempat');
});

test('⛔ no-sale keempat TANPA penyetuju ditolak permanen — kontrol negatif', async () => {
  const fx = await perangkatDanShift();
  await relaikan({
    entity_type: 'shift',
    entity_id: fx.shiftId,
    payload: {
      id: fx.shiftId, outletId: base.outlet.id, deviceId: fx.deviceId,
      businessDate: TANGGAL, openingFloat: 100000,
    },
  });
  for (let i = 0; i < 3; i += 1) {
    await relaikan({
      entity_type: 'no_sale',
      entity_id: fx.shiftId,
      payload: { id: crypto.randomUUID(), reasonCode: 'tukar_uang', reasonNote: null },
    });
  }
  // Tanpa kontrol negatif ini, test di atas tetap hijau seandainya ambangnya
  // mati sama sekali — dan "lolos karena tidak ada yang menjaga" terbaca
  // persis seperti "lolos karena penyetujunya benar".
  const hasil = await relaikan({
    entity_type: 'no_sale',
    entity_id: fx.shiftId,
    payload: { id: crypto.randomUUID(), reasonCode: 'tukar_uang', reasonNote: null },
    approver_id: null,
  });
  assert.equal(hasil.status, 403, JSON.stringify(hasil));
  assert.equal(klasifikasi(hasil), 'gagal-permanen');
});

test('pembatalan (order_cancel) mendarat lewat relay', async () => {
  // Void, bukan refund — jalur refund diuji rinci di
  // `refund-offline-relay.test.js`. Yang dibuktikan di sini adalah jenisnya
  // BENAR-BENAR dikirim lewat transport ini, supaya penjaga di bawah tidak
  // bergantung pada berkas lain untuk tetap jujur.
  const fx = await perangkatDanShift();
  await relaikan({
    entity_type: 'shift',
    entity_id: fx.shiftId,
    payload: {
      id: fx.shiftId, outletId: base.outlet.id, deviceId: fx.deviceId,
      businessDate: TANGGAL, openingFloat: 100000,
    },
  });
  const variationId = await variasi(15000);
  const orderId = crypto.randomUUID();
  await relaikan({
    entity_type: 'order',
    entity_id: orderId,
    payload: {
      id: orderId, outletId: base.outlet.id, deviceId: fx.deviceId, shiftId: fx.shiftId,
      receiptNumber: `K${fx.seq}-20260821-0005`, businessDate: TANGGAL, sequence: 5,
      channel: 'takeaway', checkId: crypto.randomUUID(),
      lines: [{ id: crypto.randomUUID(), variationId, quantityMilli: 1000, discountAmount: 0 }],
    },
  });

  const hasil = await relaikan({
    entity_type: 'order_cancel',
    entity_id: orderId,
    operation: 'cancel',
    payload: {
      id: crypto.randomUUID(),
      reasonCode: 'salah_input',
      receiptNumber: `K${fx.seq}-20260821-0006`,
      sequence: 6,
    },
  });
  sampai(hasil, 'order_cancel');
});

// ---------------------------------------------------------------------------
// Penjaga dua arah
// ---------------------------------------------------------------------------

test('⛔ SETIAP jenis di RUTE_DIDUKUNG diuji lewat transport asli', () => {
  // Jenis yang ditambahkan tanpa test transport akan membuat baris ini merah.
  // Itu satu-satunya hal yang mencegah cacat refund-offline lahir lagi pada
  // jenis berikutnya — ia tidak menghasilkan error, hanya penjualan yang
  // berhenti di antrean.
  const belum = RUTE_DIDUKUNG.filter((t) => !DIUJI.has(t));
  assert.deepEqual(
    belum,
    [],
    `jenis outbox tanpa test transport: ${belum.join(', ')}.\n` +
      'Tambahkan di tests/ordering/relay-transport.test.js — endpoint langsung ' +
      'membuktikan servernya benar, bukan bahwa kliennya memanggil dengan benar.'
  );
});
