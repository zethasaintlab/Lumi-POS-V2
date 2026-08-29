'use strict';

// `POST /peripherals` — menutup lubang TERAKHIR audit trail FR-F6.
//
// ⛔ Yang sebenarnya rusak sebelum ini: `printer_profile` sudah turun ke
// perangkat, dan K-09/K-15 memilih profil dengan `p[0]` — baris PERTAMA yang
// query kembalikan, dari query tanpa `ORDER BY`. Merchant dengan tiga model
// printer mencetak dengan profil yang dipilih urutan baris, bukan dengan
// printer yang benar-benar tercolok, dan tidak ada satu pun error.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');

let owner, appSetup, app, base, tenant, device, profilId;

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

async function dalamTenant(sql, params) {
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  const hasil = await appSetup.query(sql, params);
  await appSetup.query('COMMIT');
  return hasil;
}

beforeEach(async () => {
  await appSetup.query('ROLLBACK').catch(() => {});
  await resetAll(owner);
  base = await seedTenantBase(appSetup, { suffix: 'PeripheralTest' });
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

  // ⛔ `printer_profile` DIKECUALIKAN dari RLS — ditulis lewat koneksi owner,
  // tanpa `app.tenant_id`. Menulisnya lewat `dalamTenant` juga berhasil, dan
  // itu justru yang menyesatkan: barisnya tidak menempel pada tenant mana pun.
  profilId = crypto.randomUUID();
  await owner.query(
    `INSERT INTO printer_profile (id, name, paper_width_mm, chars_per_line, codepage, has_cutter)
     VALUES ($1, 'Epson TM-T82', 80, 48, 'cp437', true)`,
    [profilId]
  );
});

const hdr = (ubah = {}) => ({
  'x-tenant-id': tenant.id,
  authorization: base.authHeader,
  'x-actor-id': base.user.id,
  'idempotency-key': crypto.randomUUID(),
  ...ubah,
});

const daftar = (over = {}) => ({
  id: crypto.randomUUID(),
  deviceId: device,
  outletId: base.outlet.id,
  type: 'printer',
  connection: 'usb',
  address: 'USB001',
  printerProfileId: profilId,
  ...over,
});

const kirim = (payload, ubah = {}) =>
  app.inject({ method: 'POST', url: '/peripherals', headers: hdr(ubah), payload });

// ---------------------------------------------------------------------------

test('peripheral tersimpan dengan profil printernya', async () => {
  const p = daftar();
  const res = await kirim(p);
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(res.json().printerProfileId, profilId);
  assert.equal(res.json().baru, true);

  const { rows } = await dalamTenant('SELECT * FROM peripheral WHERE id = $1', [p.id]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].printer_profile_id, profilId);
  assert.equal(rows[0].tenant_id, tenant.id);
});

test('⛔ peripheral_configured DIPANCARKAN, dan itu lubang TERAKHIR FR-F6', async () => {
  await kirim(daftar());
  const { rows } = await dalamTenant(
    `SELECT event_type, entity_type, entity_id, actor_user_id, before, after
       FROM audit_event WHERE event_type = 'peripheral_configured'`
  );
  assert.equal(rows.length, 1, 'audit tidak ditulis');
  assert.equal(rows[0].entity_type, 'peripheral');
  assert.equal(rows[0].actor_user_id, base.user.id);
});

test('⛔ `before` memuat keadaan SEBELUMNYA, bukan nilai barunya sendiri', async () => {
  // Audit yang menjawab "diubah dari apa" dengan nilai barunya sendiri lolos
  // setiap test yang hanya memeriksa kolomnya terisi.
  const kedua = crypto.randomUUID();
  await owner.query(
    `INSERT INTO printer_profile (id, name, paper_width_mm, chars_per_line)
     VALUES ($1, 'Xprinter XP-58', 58, 32)`,
    [kedua]
  );

  const p = daftar();
  await kirim(p);
  const res = await kirim({ ...p, printerProfileId: kedua });
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(res.json().baru, false, 'konfigurasi ULANG dibedakan dari pendaftaran pertama');

  const { rows } = await dalamTenant(
    `SELECT before, after FROM audit_event
      WHERE event_type = 'peripheral_configured' AND entity_id = $1
      ORDER BY occurred_at`,
    [p.id]
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].before, null, 'pendaftaran pertama tidak punya keadaan sebelumnya');
  assert.equal(rows[1].before.printerProfileId, profilId, 'before memuat profil LAMA');
  assert.equal(rows[1].after.printerProfileId, kedua);
});

test('⛔ pengiriman ulang MEMPERBARUI, tidak menggandakan barisnya', async () => {
  // Kasir mengubah profil printernya berkali-kali sampai strukanya benar, dan
  // setiap perubahan adalah konfigurasi ULANG peripheral yang sama.
  const p = daftar();
  await kirim(p);
  await kirim({ ...p, address: 'USB002' });

  const { rows } = await dalamTenant('SELECT id, address FROM peripheral WHERE id = $1', [p.id]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].address, 'USB002');
});

test('⛔ Idempotency-Key yang SAMA mengembalikan respons tersimpan', async () => {
  const p = daftar();
  const kunci = crypto.randomUUID();
  const satu = await kirim(p, { 'idempotency-key': kunci });
  const dua = await kirim({ ...p, address: 'BERUBAH' }, { 'idempotency-key': kunci });
  assert.equal(dua.statusCode, satu.statusCode);
  assert.deepEqual(dua.json(), satu.json());

  const { rows } = await dalamTenant('SELECT address FROM peripheral WHERE id = $1', [p.id]);
  assert.equal(rows[0].address, 'USB001', 'retry tidak boleh menerapkan muatan yang berubah');
});

test('Idempotency-Key yang hilang ditolak 400', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/peripherals',
    headers: {
      'x-tenant-id': tenant.id,
      authorization: base.authHeader,
      'x-actor-id': base.user.id,
    },
    payload: daftar(),
  });
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(res.json().error.code, 'MISSING_IDEMPOTENCY_KEY');
});

test('⛔ type dan connection adalah daftar TERTUTUP, dan pesannya menyebutnya', async () => {
  // Nilai di luar CHECK constraint ditolak database dengan galat yang tidak
  // menunjuk ke sebabnya sama sekali.
  for (const [field, nilai] of [
    ['type', 'mesin_kopi'],
    ['connection', 'wifi'],
  ]) {
    const res = await kirim(daftar({ [field]: nilai }));
    assert.equal(res.statusCode, 400, `${field}: ${res.body}`);
    assert.equal(res.json().error.code, 'VALIDATION_ERROR');
    assert.match(res.json().error.message, new RegExp(field));
  }
});

test('⛔ kosakata SAMA dengan CHECK constraint di migrasi', async () => {
  // Kosakata yang menyimpang dari CHECK-nya menghasilkan baris yang database
  // tolak, dan galatnya menyebut nama constraint alih-alih apa yang salah.
  // Dibandingkan terhadap DDL, bukan terhadap ingatan.
  const { readFileSync } = require('node:fs');
  const { join } = require('node:path');
  const ddl = readFileSync(
    join(__dirname, '..', '..', 'db', 'migrations', '0012_peripheral.sql'),
    'utf8'
  );
  const { JENIS_PERIPHERAL, KONEKSI_PERIPHERAL } = await import(
    '../../packages/domain/src/peripheral.ts'
  );
  for (const [nama, daftarNilai] of [
    ['type', JENIS_PERIPHERAL],
    ['connection', KONEKSI_PERIPHERAL],
  ]) {
    const cocok = new RegExp(`CHECK \\(${nama} IN \\(([^)]*)\\)\\)`).exec(ddl);
    assert.ok(cocok, `CHECK untuk ${nama} tidak ditemukan di DDL`);
    const dariDdl = cocok[1].split(',').map((s) => s.trim().replace(/'/g, ''));
    assert.deepEqual([...daftarNilai].sort(), dariDdl.sort(), nama);
  }
});

test('⛔ outlet milik tenant lain ditolak 404 — FK tidak tunduk RLS', async () => {
  const lain = await seedTenantBase(appSetup, { suffix: 'PeripheralLain' });
  const res = await kirim(daftar({ outletId: lain.outlet.id }));
  assert.equal(res.statusCode, 404, res.body);
  assert.equal(res.json().error.code, 'OUTLET_NOT_FOUND');
});

test('⛔ perangkat milik tenant lain ditolak 404', async () => {
  const lain = await seedTenantBase(appSetup, { suffix: 'PeripheralDev' });
  const asing = crypto.randomUUID();
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [lain.tenant.id]);
  await appSetup.query(
    `INSERT INTO device (id, tenant_id, outlet_id, code, name, platform, app_version, schema_version)
     VALUES ($1, $2, $3, 'K9', 'Asing', 'tauri', '0.0.0', '1')`,
    [asing, lain.tenant.id, lain.outlet.id]
  );
  await appSetup.query('COMMIT');

  const res = await kirim(daftar({ deviceId: asing }));
  assert.equal(res.statusCode, 404, res.body);
  assert.equal(res.json().error.code, 'DEVICE_NOT_FOUND');
});

test('profil printer yang tidak ada ditolak 404 dengan kodenya sendiri', async () => {
  // Dibedakan dari OUTLET_NOT_FOUND: merchant yang salah menyalin id profil
  // tidak boleh diberi tahu bahwa OUTLET-nya yang hilang.
  const res = await kirim(daftar({ printerProfileId: crypto.randomUUID() }));
  assert.equal(res.statusCode, 404, res.body);
  assert.equal(res.json().error.code, 'PRINTER_PROFILE_NOT_FOUND');
});

test('printerProfileId boleh KOSONG — laci dan scanner tidak punya profil', async () => {
  const res = await kirim(daftar({ type: 'drawer', printerProfileId: null, address: null }));
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(res.json().printerProfileId, null);
});

test('⛔ GET /printer-profiles urut NAMA, bukan urutan baris', async () => {
  // Query tanpa urutan adalah tepat cacat yang seluruh endpoint ini perbaiki.
  await owner.query(
    `INSERT INTO printer_profile (id, name) VALUES ($1, 'AAA Pertama'), ($2, 'ZZZ Terakhir')`,
    [crypto.randomUUID(), crypto.randomUUID()]
  );
  const res = await app.inject({ method: 'GET', url: '/printer-profiles', headers: hdr() });
  assert.equal(res.statusCode, 200, res.body);
  const nama = res.json().map((p) => p.name);
  assert.deepEqual(nama, [...nama].sort(), `tidak urut: ${nama.join(', ')}`);
});

test('GET /peripherals menyaring per perangkat', async () => {
  const kedua = crypto.randomUUID();
  await dalamTenant(
    `INSERT INTO device (id, tenant_id, outlet_id, code, name, platform, app_version, schema_version)
     VALUES ($1, $2, $3, 'K2', 'Kasir 2', 'tauri', '0.0.0', '1')`,
    [kedua, tenant.id, base.outlet.id]
  );
  await kirim(daftar());
  await kirim(daftar({ deviceId: kedua }));

  const semua = await app.inject({ method: 'GET', url: '/peripherals', headers: hdr() });
  assert.equal(semua.json().length, 2);
  const satu = await app.inject({
    method: 'GET',
    url: `/peripherals?device_id=${kedua}`,
    headers: hdr(),
  });
  assert.equal(satu.json().length, 1);
  assert.equal(satu.json()[0].deviceId, kedua);
});

test('⛔ peripheral tenant lain tidak pernah ikut', async () => {
  const lain = await seedTenantBase(appSetup, { suffix: 'PeripheralBocor' });
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [lain.tenant.id]);
  await appSetup.query(
    `INSERT INTO peripheral (id, tenant_id, outlet_id, type, connection)
     VALUES ($1, $2, $3, 'printer', 'usb')`,
    [crypto.randomUUID(), lain.tenant.id, lain.outlet.id]
  );
  await appSetup.query('COMMIT');

  const res = await app.inject({ method: 'GET', url: '/peripherals', headers: hdr() });
  assert.equal(res.json().length, 0);
});

test('⛔ akuntan DITOLAK — ia tidak dapat melakukan mutasi apa pun', async () => {
  // `spec-f:82`. Rute ini ada di DIKECUALIKAN (kasir BOLEH), jadi yang
  // menutup akuntan adalah `assertBoleh(shift_open_close)` di handler.
  await dalamTenant(`DELETE FROM user_role WHERE user_id = $1`, [base.user.id]);
  await dalamTenant(
    `INSERT INTO user_role (id, user_id, tenant_id, role, scope_type, scope_id)
     VALUES ($1, $2, $3, 'accountant', 'tenant', $3)`,
    [crypto.randomUUID(), base.user.id, tenant.id]
  );
  const res = await kirim(daftar());
  assert.equal(res.statusCode, 403, res.body);
});

test('⛔ tanpa sesi ditolak 401, bukan diterima diam-diam', async () => {
  // Rutenya `sesiOpsional`: relay tidak mengirim sesi, tapi Bearer yang TIDAK
  // SAH tetap ditolak alih-alih diabaikan.
  const res = await app.inject({
    method: 'POST',
    url: '/peripherals',
    headers: {
      'x-tenant-id': tenant.id,
      'x-actor-id': base.user.id,
      'idempotency-key': crypto.randomUUID(),
      authorization: 'Bearer token-karangan',
    },
    payload: daftar(),
  });
  assert.equal(res.statusCode, 401, res.body);
});
