'use strict';

// M-01/M-02 — `GET /reports/needs-attention`.
//
// ⛔ Yang berkas ini ada untuk menjaga: daftarnya TERTUNGGAK, bukan "terjadi
// hari ini". Daftar yang disaring per tanggal mengosongkan dirinya setiap
// tengah malam, dan owner yang membukanya pukul 23:00 lalu 00:30 melihat dua
// jawaban berbeda untuk pertanyaan yang sama.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');

let owner, appSetup, app, base, tenant, device;

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
  await appSetup.query('ROLLBACK').catch(() => {});
  await resetAll(owner);
  base = await seedTenantBase(appSetup, { suffix: 'PerhatianTest' });
  tenant = base.tenant;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();
  device = crypto.randomUUID();
  await dalamTenant(
    `INSERT INTO device (id, tenant_id, outlet_id, code, name, platform, app_version, schema_version)
     VALUES ($1, $2, $3, 'K1', 'Kasir 1', 'tauri', '0.0.0', '1')`,
    [device, tenant.id, base.outlet.id]
  );
});

async function dalamTenant(sql, params) {
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  const hasil = await appSetup.query(sql, params);
  await appSetup.query('COMMIT');
  return hasil;
}

const hdr = (ubah = {}) => ({
  'x-tenant-id': tenant.id,
  authorization: base.authHeader,
  'x-actor-id': base.user.id,
  ...ubah,
});

const perhatian = (q = '', ubah = {}) =>
  app.inject({ method: 'GET', url: `/reports/needs-attention${q}`, headers: hdr(ubah) });

/** Oversell yang belum ditindaklanjuti, `hariLalu` hari yang lalu. */
async function buatOversell({ hariLalu = 0, outletId } = {}) {
  const id = crypto.randomUUID();
  await dalamTenant(
    `INSERT INTO oversell_event (id, tenant_id, outlet_id, variation_id, detected_at, quantity_over)
     VALUES ($1, $2, $3, $4, now() - ($5 || ' days')::interval, 3000)`,
    [id, tenant.id, outletId ?? base.outlet.id, crypto.randomUUID(), String(hariLalu)]
  );
  return id;
}

/** Shift tertutup dengan selisih. `difference = 0` berarti beres. */
async function buatShiftTertutup({ difference, hariLalu = 0, outletId } = {}) {
  const id = crypto.randomUUID();
  await dalamTenant(
    `INSERT INTO cash_drawer_shift
       (id, tenant_id, outlet_id, device_id, business_date, status, opening_float,
        opened_by, closed_by, closed_at, counted_amount, expected_amount, difference)
     VALUES ($1, $2, $3, $4, current_date - $5::int, 'closed', 0,
             $6, $6, now() - ($5 || ' days')::interval, 100000, 100000, $7)`,
    [id, tenant.id, outletId ?? base.outlet.id, device, String(hariLalu), base.user.id, difference]
  );
  return id;
}

/** Payment `pending_confirmation` berumur `jamLalu`. */
async function buatPembayaranMenggantung({ jamLalu = 48, status = 'pending_confirmation' } = {}) {
  const orderId = crypto.randomUUID();
  const checkId = crypto.randomUUID();
  const shiftId = await buatShiftTertutup({ difference: 0 });
  await dalamTenant(
    `INSERT INTO "order"
       (id, tenant_id, outlet_id, device_id, shift_id, receipt_number, business_date, sequence,
        status, channel, subtotal, order_discount, service_charge_amount, tax_amount,
        rounding_adjustment, total, amount_due, created_by, occurred_at, hlc)
     VALUES ($1, $2, $3, $4, $5, $6, current_date, 1,
             'open', 'takeaway', 50000, 0, 0, 0,
             0, 50000, 50000, $7, now(), 1)`,
    [orderId, tenant.id, base.outlet.id, device, shiftId, `K1-X-${Date.now() % 10000}`, base.user.id]
  );
  await dalamTenant(
    `INSERT INTO "check" (id, tenant_id, order_id, subtotal, total)
     VALUES ($1, $2, $3, 50000, 50000)`,
    [checkId, tenant.id, orderId]
  );
  const id = crypto.randomUUID();
  await dalamTenant(
    `INSERT INTO payment
       (id, tenant_id, outlet_id, device_id, order_id, check_id, method, amount, status,
        tendered_at, created_by, occurred_at, hlc)
     VALUES ($1, $2, $3, $4, $5, $6, 'qris_dynamic', 50000, $8,
             now() - ($7 || ' hours')::interval, $9,
             now() - ($7 || ' hours')::interval, 1)`,
    [
      id,
      tenant.id,
      base.outlet.id,
      device,
      orderId,
      checkId,
      String(jamLalu),
      status,
      base.user.id,
    ]
  );
  return id;
}

// ---------------------------------------------------------------------------

test('daftar kosong dijawab nol yang jujur, bukan 404', async () => {
  const res = await perhatian();
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().jumlah, 0);
  assert.deepEqual(res.json().temuan, []);
});

test('⛔ oversell LAMA tetap muncul — daftarnya tertunggak, bukan harian', async () => {
  // Oversell yang belum ditindaklanjuti tiga hari lalu masih perlu
  // ditindaklanjuti malam ini. Daftar yang disaring per tanggal mengosongkan
  // dirinya setiap tengah malam.
  await buatOversell({ hariLalu: 30 });
  const res = await perhatian();
  assert.equal(res.json().jumlah, 1, res.body);
  assert.equal(res.json().temuan[0].jenis, 'oversell');
});

test('⛔ oversell yang SUDAH ditindaklanjuti tidak muncul lagi', async () => {
  const id = await buatOversell({});
  await dalamTenant(
    `UPDATE oversell_event SET resolved_at = now(), resolved_by = $2 WHERE id = $1`,
    [id, base.user.id]
  );
  assert.equal((await perhatian()).json().jumlah, 0);
});

test('⛔ selisih kas NOL tidak muncul — nol berarti beres', async () => {
  // Shift yang cocok persis tidak perlu diperiksa siapa pun. Memasukkannya
  // membuat daftar ini memuat satu baris per shift, selamanya, dan yang
  // benar-benar perlu diperiksa tenggelam di antaranya.
  await buatShiftTertutup({ difference: 0 });
  assert.equal((await perhatian()).json().jumlah, 0);
});

test('selisih kas KURANG maupun LEBIH sama-sama muncul', async () => {
  // Laci yang KELEBIHAN uang sama perlu diperiksanya dengan yang kurang —
  // uang yang tidak dapat dijelaskan adalah uang yang tidak dapat dijelaskan.
  await buatShiftTertutup({ difference: -50000, hariLalu: 1 });
  await buatShiftTertutup({ difference: 50000, hariLalu: 2 });
  const t = (await perhatian()).json().temuan;
  assert.equal(t.length, 2);
  assert.deepEqual(
    t.map((x) => x.nilai).sort(),
    ['-50000', '50000']
  );
});

test('⛔ shift yang BELUM ditutup tidak muncul', async () => {
  // `difference` dibekukan saat penutupan; membacanya sebelum itu berarti
  // melaporkan angka yang belum ditandatangani siapa pun.
  await dalamTenant(
    `INSERT INTO cash_drawer_shift
       (id, tenant_id, outlet_id, device_id, business_date, status, opening_float, opened_by)
     VALUES ($1, $2, $3, $4, current_date, 'open', 0, $5)`,
    [crypto.randomUUID(), tenant.id, base.outlet.id, device, base.user.id]
  );
  assert.equal((await perhatian()).json().jumlah, 0);
});

test('⛔ pembayaran menggantung > 24 jam muncul; yang MUDA tidak', async () => {
  await buatPembayaranMenggantung({ jamLalu: 48 });
  assert.equal((await perhatian()).json().jumlah, 1);

  await resetAll(owner);
  base = await seedTenantBase(appSetup, { suffix: 'PerhatianTest2' });
  tenant = base.tenant;
  device = crypto.randomUUID();
  await dalamTenant(
    `INSERT INTO device (id, tenant_id, outlet_id, code, name, platform, app_version, schema_version)
     VALUES ($1, $2, $3, 'K1', 'Kasir 1', 'tauri', '0.0.0', '1')`,
    [device, tenant.id, base.outlet.id]
  );
  await buatPembayaranMenggantung({ jamLalu: 2 });
  assert.equal(
    (await perhatian()).json().jumlah,
    0,
    'QRIS yang baru diminta dua jam lalu masih normal menunggu'
  );
});

test('⛔ pembayaran yang sudah CONFIRMED tidak pernah muncul', async () => {
  await buatPembayaranMenggantung({ jamLalu: 72, status: 'confirmed' });
  assert.equal((await perhatian()).json().jumlah, 0);
});

test('⛔ jumlah adalah TOTAL, dan urutannya lintas jenis', async () => {
  // Tiga daftar yang disambung apa adanya membuat M-01 — yang hanya
  // menampilkan tiga teratas — selalu menampilkan oversell dan tidak pernah
  // menampilkan selisih kas, berapa pun umurnya.
  await buatOversell({ hariLalu: 10 });
  await buatOversell({ hariLalu: 9 });
  await buatOversell({ hariLalu: 8 });
  await buatShiftTertutup({ difference: -70000, hariLalu: 0 });

  const b = (await perhatian()).json();
  assert.equal(b.jumlah, 4);
  assert.equal(b.temuan.length, 4);
  assert.equal(b.temuan[0].jenis, 'selisih_kas', 'yang terbaru harus di depan, apa pun jenisnya');
  // Terbaru lebih dulu, tanpa kecuali.
  for (let i = 1; i < b.temuan.length; i += 1) {
    assert.ok(
      b.temuan[i - 1].terjadiPada >= b.temuan[i].terjadiPada,
      `urutan pecah di ${i}: ${b.temuan[i - 1].terjadiPada} < ${b.temuan[i].terjadiPada}`
    );
  }
});

test('outlet_id menyaring', async () => {
  const lain = crypto.randomUUID();
  await dalamTenant(
    `INSERT INTO outlet (id, tenant_id, name, timezone, business_day_ends_at)
     VALUES ($1, $2, 'Cabang 2', 'Asia/Jakarta', '04:00')`,
    [lain, tenant.id]
  );
  await buatOversell({ outletId: base.outlet.id });
  await buatOversell({ outletId: lain });

  assert.equal((await perhatian()).json().jumlah, 2);
  assert.equal((await perhatian(`?outlet_id=${lain}`)).json().jumlah, 1);
});

test('⛔ outlet milik tenant lain ditolak 404 — FK tidak tunduk RLS', async () => {
  const lain = await seedTenantBase(appSetup, { suffix: 'PerhatianLain' });
  const res = await perhatian(`?outlet_id=${lain.outlet.id}`);
  assert.equal(res.statusCode, 404, res.body);
});

test('⛔ temuan tenant lain tidak pernah ikut', async () => {
  const lain = await seedTenantBase(appSetup, { suffix: 'PerhatianBocor' });
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [lain.tenant.id]);
  await appSetup.query(
    `INSERT INTO oversell_event (id, tenant_id, outlet_id, variation_id, quantity_over)
     VALUES ($1, $2, $3, $4, 5000)`,
    [crypto.randomUUID(), lain.tenant.id, lain.outlet.id, crypto.randomUUID()]
  );
  await appSetup.query('COMMIT');

  assert.equal((await perhatian()).json().jumlah, 0);
});

test('⛔ tanpa sesi ditolak 401', async () => {
  const res = await app.inject({
    method: 'GET',
    url: '/reports/needs-attention',
    headers: { 'x-tenant-id': tenant.id },
  });
  assert.equal(res.statusCode, 401, res.body);
});

test('⛔ tanpa bahasa menuduh — tidak ada skor maupun label di respons', async () => {
  // `spec-g:168`: produk yang menuduh karyawan merchant akan merusak hubungan
  // merchant dengan stafnya. Diperiksa atas JSON keluarannya, bukan atas kode.
  await buatOversell({});
  await buatShiftTertutup({ difference: -90000 });
  const teks = JSON.stringify((await perhatian()).json()).toLowerCase();
  for (const kata of ['skor', 'score', 'risiko', 'mencurigakan', 'pelaku', 'curang', 'fraud']) {
    assert.ok(!teks.includes(kata), `respons memuat kata menuduh: ${kata}`);
  }
});
