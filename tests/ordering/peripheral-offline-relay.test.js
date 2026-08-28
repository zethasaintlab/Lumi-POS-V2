'use strict';

// ⛔ Pilihan profil printer yang dibuat OFFLINE, dikirim lewat transport relay
// yang SAMA dengan yang dipakai perangkat sungguhan.
//
// Aturan 21 Agustus 2026 (`CLAUDE.md`): *setiap operasi yang perangkat kirim
// lewat outbox wajib punya satu test yang memakai `buatPengirimHttp` dan
// `klasifikasi` yang ASLI*, dengan hanya `fetch` yang dipalsukan dan
// diteruskan ke server sungguhan.
//
// `POST /peripherals` adalah paparan KEEMPAT bentuk cacat itu — setelah refund
// offline (21 Agu), kas manual (24 Agu), dan abandon: rute yang TIDAK terdaftar
// di `RUTE_TERBUKA` dijawab **401** oleh penjaga sesi lalu berhenti permanen di
// antrean. Kasir sudah memilih profil printernya, strukanya sudah benar di
// perangkat, dan servernya tidak pernah tahu.
//
// ⛔ Dua properti yang BERBEDA, dan masing-masing punya testnya sendiri —
// dipisahkan setelah sabotase menunjukkan bahwa berkas ini semula hanya
// membuktikan yang pertama:
//
//   1. **Entri rutenya ADA** di `RUTE_TERBUKA` (`apps/server/src/sesi.ts`).
//      Yang menjaganya berkas INI: menghapus entrinya membuat lima test di
//      bawah merah.
//   2. **`sesiOpsional: true`** pada entri itu — sesi tidak dituntut, tapi
//      DITEGAKKAN bila dibawa, sehingga Bearer tidak sah ditolak alih-alih
//      diabaikan. Yang menjaganya `tests/server/peripheral.test.js` ("tanpa
//      sesi ditolak 401"); menghapus barisnya membuat test itu merah dan
//      berkas ini tetap hijau.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');
const { buatPengirimHttp } = require('../../packages/sync-client/src/http.ts');
const { klasifikasi } = require('../../packages/sync-client/src/klasifikasi.ts');

let owner, appSetup, app, tenant, base, device, profilId;

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

async function kueri(sql, params) {
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  try {
    const { rows } = await appSetup.query(sql, params);
    await appSetup.query('COMMIT');
    return rows;
  } catch (e) {
    await appSetup.query('ROLLBACK');
    throw e;
  }
}

beforeEach(async () => {
  await resetAll(owner);
  base = await seedTenantBase(appSetup, { suffix: 'RelayPeripheral' });
  tenant = base.tenant;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();

  device = crypto.randomUUID();
  await kueri(
    `INSERT INTO device (id, tenant_id, outlet_id, code, name, platform, app_version, schema_version)
     VALUES ($1,$2,$3,'K1','K1','tauri','0','1')`,
    [device, tenant.id, base.outlet.id]
  );
  // `printer_profile` dikecualikan RLS — ditulis lewat koneksi owner.
  profilId = crypto.randomUUID();
  await owner.query(
    `INSERT INTO printer_profile (id, name, paper_width_mm, chars_per_line)
     VALUES ($1, 'Epson TM-T82', 80, 48)`,
    [profilId]
  );
});

/** `fetch` yang meneruskan ke server sungguhan, apa adanya. */
function fetchKeServer(intip) {
  return async (url, opts) => {
    if (intip) intip(opts, new URL(url).pathname);
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

function relay(intip) {
  return buatPengirimHttp({
    baseUrl: 'http://server.uji',
    tenantId: tenant.id,
    actorId: base.user.id,
    fetchFn: fetchKeServer(intip),
  });
}

/**
 * Baris `outbox_local` dalam bentuk yang PERSIS ditulis
 * `simpanPeripheralPrinter` (`apps/kasir/src/cetak/simpan-peripheral.ts`).
 */
function barisOutbox(over = {}) {
  const peripheralId = over.entity_id ?? crypto.randomUUID();
  return {
    id: crypto.randomUUID(),
    entity_type: 'peripheral',
    entity_id: peripheralId,
    operation: 'create',
    payload: JSON.stringify({
      id: peripheralId,
      deviceId: device,
      outletId: base.outlet.id,
      type: 'printer',
      connection: 'usb',
      printerProfileId: profilId,
      ...over.payloadOver,
    }),
    idempotency_key: `peripheral:${peripheralId}:${profilId}`,
    status: 'pending',
    attempts: 0,
    last_error: null,
    last_attempt_at: null,
    created_at: new Date().toISOString(),
    depends_on: null,
    actor_id: base.user.id,
    approver_id: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------

test('⛔ pilihan profil yang dibuat OFFLINE mendarat di server', async () => {
  const baris = barisOutbox();
  const hasil = await relay()(baris);

  assert.equal(klasifikasi(hasil), 'terkirim', `relay gagal: ${JSON.stringify(hasil)}`);

  const rows = await kueri('SELECT printer_profile_id FROM peripheral WHERE id = $1', [
    baris.entity_id,
  ]);
  assert.equal(rows.length, 1, 'barisnya tidak pernah sampai ke server');
  assert.equal(rows[0].printer_profile_id, profilId);
});

test('⛔ relay TIDAK mengirim sesi, dan rutenya tetap menerimanya', async () => {
  // Inti berkas ini. Rute jalur perangkat yang hanya `DIKECUALIKAN` dari RBAC
  // dijawab 401 oleh penjaga sesi lalu berhenti permanen di antrean.
  let dilihat = null;
  const hasil = await relay((opts, jalur) => {
    dilihat = { headers: opts.headers, jalur };
  })(barisOutbox());

  const kunci = Object.keys(dilihat.headers).map((k) => k.toLowerCase());
  assert.ok(!kunci.includes('authorization'), 'relay tidak pernah mengirim Bearer sesi');
  assert.equal(
    klasifikasi(hasil),
    'terkirim',
    `rutenya menolak permintaan tanpa sesi: ${JSON.stringify(hasil)}`
  );
});

test('⛔ rutenya /peripherals — bukan 404 yang terbaca seperti kegagalan lain', async () => {
  let jalurDipakai = null;
  await relay((_opts, jalur) => {
    jalurDipakai = jalur;
  })(barisOutbox());
  assert.equal(jalurDipakai, '/peripherals');
});

test('⛔ aktor DIBEKUKAN di barisnya, dan audit mencatatkannya', async () => {
  // Antrean dapat terkuras setelah pergantian shift: memakai "siapa yang
  // sedang masuk" akan mencatatkan perubahan atas nama kasir yang salah.
  let dikirim = null;
  await relay((opts) => {
    dikirim = Object.fromEntries(
      Object.entries(opts.headers).map(([k, v]) => [k.toLowerCase(), v])
    );
  })(barisOutbox());

  assert.equal(dikirim['x-actor-id'], base.user.id);

  const rows = await kueri(
    `SELECT actor_user_id FROM audit_event WHERE event_type = 'peripheral_configured'`
  );
  assert.equal(rows.length, 1, 'peripheral_configured tidak dipancarkan lewat jalur relay');
  assert.equal(rows[0].actor_user_id, base.user.id);
});

test('⛔ Idempotency-Key diambil dari BARIS, bukan digenerate saat pengiriman', async () => {
  // Relay mengembalikan item `sending` yang tertinggal menjadi `pending`
  // setelah aplikasi mati mendadak. Itu aman HANYA karena key-nya sudah
  // ditulis saat item dibuat: retry memakai key yang sama dan server
  // menjawabnya dari cache alih-alih menulis baris kedua.
  const baris = barisOutbox();
  let dikirim = null;
  const kirim = relay((opts) => {
    dikirim = Object.fromEntries(
      Object.entries(opts.headers).map(([k, v]) => [k.toLowerCase(), v])
    );
  });

  await kirim(baris);
  assert.equal(dikirim['idempotency-key'], baris.idempotency_key);

  // Retry baris yang SAMA persis — hanya satu baris audit yang boleh lahir.
  const ulang = await kirim(baris);
  assert.equal(klasifikasi(ulang), 'terkirim', JSON.stringify(ulang));
  const rows = await kueri(
    `SELECT id FROM audit_event WHERE event_type = 'peripheral_configured'`
  );
  assert.equal(rows.length, 1, 'retry menulis audit kedua untuk operasi yang sama');
});

test('⛔ profil yang tidak ada dijawab GAGAL PERMANEN, bukan diulang selamanya', async () => {
  // 404 atas muatan yang bentuknya benar tidak akan pernah berubah dengan
  // mengulanginya. Antrean yang mengulang selamanya menahan baris di
  // belakangnya — dan yang di belakangnya adalah penjualan.
  const hasil = await relay()(
    barisOutbox({ payloadOver: { printerProfileId: crypto.randomUUID() } })
  );
  assert.equal(hasil.status, 404);
  assert.equal(klasifikasi(hasil), 'gagal-permanen', JSON.stringify(hasil));
});
