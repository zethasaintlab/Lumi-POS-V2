'use strict';

// F6 — staged rollout, sisi server. `ARCH:§12`, KEP-36.
//
// KEP-36 menolak dua jalan yang lebih mudah: auto-update paksa menghentikan
// outlet di jam makan siang, dan update manual berarti delapan versi di
// lapangan setelah setahun. Yang diuji di sini adalah jalan ketiga —
// dan yang paling penting di antaranya adalah APA YANG DITOLAK.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');

let owner, appSetup, app, tenant, outlet, base;

before(async () => {
  owner = await connectAsOwner();
  appSetup = await connectAsApp();
});

after(async () => {
  await owner.query('DELETE FROM app_release');
  await resetAll(owner);
  await owner.end();
  await appSetup.end();
  if (app) await app.close();
});

beforeEach(async () => {
  await resetAll(owner);
  // `app_release` dikecualikan RLS dan tidak punya tenant_id, jadi
  // `resetAll` tidak menyentuhnya — ia harus dibersihkan sendiri, kalau tidak
  // rilis dari test sebelumnya bocor ke test berikutnya.
  await owner.query('DELETE FROM app_release');
  base = await seedTenantBase(appSetup, { suffix: 'RilisTest' });
  tenant = base.tenant;
  outlet = base.outlet;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();
});

function headerTenant(id = tenant.id, auth = base.authHeader) {
  return { 'x-tenant-id': id, authorization: auth };
}

async function buatPerangkat(kode = 'K1') {
  const id = crypto.randomUUID();
  let res = await app.inject({
    method: 'POST',
    url: '/devices',
    payload: { id, outletId: outlet.id, code: kode, appVersion: '1.0.0' },
    headers: headerTenant(),
  });
  assert.equal(res.statusCode, 201, res.body);
  res = await app.inject({
    method: 'POST',
    url: `/devices/${id}/credentials`,
    headers: headerTenant(),
  });
  assert.equal(res.statusCode, 201, res.body);
  return { id, secret: res.json().secret };
}

async function buatRilis(versi, opsi = {}) {
  await owner.query(
    `INSERT INTO app_release (version, stage, mandatory_reason, created_at)
     VALUES ($1, $2, $3, now() + ($4 || ' seconds')::interval)`,
    [versi, opsi.stage ?? 'penuh', opsi.mandatoryReason ?? null, String(opsi.urutan ?? 0)]
  );
}

/** Menyetel jendela outlet supaya jam apa pun sekarang masuk atau tidak. */
async function setelJendela(mulai, selesai) {
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await appSetup.query(
    'UPDATE outlet SET update_window_start_hour = $2, update_window_end_hour = $3 WHERE id = $1',
    [outlet.id, mulai, selesai]
  );
  await appSetup.query('COMMIT');
}

/** Jam lokal outlet SEKARANG, dari jam database — sama seperti server.
 *
 * ⛔ Dibaca lewat transaksi ber-`app.tenant_id`, bukan lewat koneksi owner:
 * `FORCE ROW LEVEL SECURITY` berlaku untuk owner juga, dan `outlet` tunduk
 * RLS. Versi pertama test ini memakai `owner` dan gagal dengan
 * "unrecognized configuration parameter" — pesan yang tidak menyebut RLS sama
 * sekali. */
async function jamLokalSekarang() {
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  const { rows } = await appSetup.query(
    `SELECT EXTRACT(hour FROM now() AT TIME ZONE timezone)::int AS jam FROM outlet WHERE id = $1`,
    [outlet.id]
  );
  await appSetup.query('COMMIT');
  return rows[0].jam;
}

async function jadikanKanari() {
  await owner.query('UPDATE tenant SET is_canary = true WHERE id = $1', [tenant.id]);
}

function tanya(p) {
  return app.inject({
    method: 'GET',
    url: `/devices/${p.id}/update`,
    headers: { 'x-tenant-id': tenant.id, authorization: `Bearer ${p.secret}` },
  });
}

function tunda(p) {
  return app.inject({
    method: 'POST',
    url: `/devices/${p.id}/update/defer`,
    headers: { 'x-tenant-id': tenant.id, authorization: `Bearer ${p.secret}` },
  });
}

// ---------------------------------------------------------------------------
// Jalur normal
// ---------------------------------------------------------------------------

test('tanpa rilis: perangkat tidak diminta melakukan apa pun', async () => {
  const p = await buatPerangkat();
  const res = await tanya(p);
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().alasan, 'tidak_ada_rilis');
  assert.equal(res.json().versi, null);
});

test('rilis di dalam jendela dan sudah giliran: pasang sekarang', async () => {
  const p = await buatPerangkat();
  await jadikanKanari();
  await buatRilis('1.1.0');
  const jam = await jamLokalSekarang();
  await setelJendela(jam, (jam + 1) % 24);

  const b = (await tanya(p)).json();
  assert.equal(b.versi, '1.1.0');
  assert.equal(b.pasangSekarang, true);
  assert.equal(b.alasan, 'terjadwal');
  // ⛔ Jam lokal datang dari jam DATABASE. Jendela selebar tiga jam, dan dua
  // mesin yang jamnya berselisih memasang update di luar jendela yang
  // merchant setujui.
  assert.equal(b.jamLokal, jam);
});

test('⛔ di luar jendela: TIDAK dipasang, meski merchant sudah giliran', async () => {
  const p = await buatPerangkat();
  await jadikanKanari();
  await buatRilis('1.1.0');
  const jam = await jamLokalSekarang();
  // Jendela satu jam yang PASTI bukan sekarang.
  await setelJendela((jam + 5) % 24, (jam + 6) % 24);

  const b = (await tanya(p)).json();
  assert.equal(b.pasangSekarang, false);
  assert.equal(b.alasan, 'di_luar_jendela');
  // Ini seluruh alasan jendela ada: outlet tidak boleh terganggu di jam sibuk.
  assert.equal(b.versi, '1.1.0', 'versinya tetap disebut — merchant boleh tahu');
});

test('perangkat yang sudah di versi rilis tidak diminta memasang apa pun', async () => {
  const p = await buatPerangkat();
  await jadikanKanari();
  await buatRilis('1.0.0');
  const b = (await tanya(p)).json();
  assert.equal(b.alasan, 'sudah_terbaru');
  assert.equal(b.pasangSekarang, false);
});

test('⛔ rilis yang DIHENTIKAN berhenti ditawarkan, tapi barisnya tetap ada', async () => {
  const p = await buatPerangkat();
  await jadikanKanari();
  await buatRilis('1.1.0');
  await owner.query(
    `UPDATE app_release SET halted_at = now(), halted_reason = 'crash naik' WHERE version = '1.1.0'`
  );

  assert.equal((await tanya(p)).json().alasan, 'tidak_ada_rilis');
  // Barisnya justru yang perlu dijelaskan saat perangkat terlanjur
  // memasangnya — menghapusnya membuang catatan itu.
  const { rows } = await owner.query('SELECT halted_reason FROM app_release WHERE version = $1', ['1.1.0']);
  assert.equal(rows[0].halted_reason, 'crash naik');
});

test('rilis TERBARU yang menang, bukan yang paling tinggi nomornya', async () => {
  const p = await buatPerangkat();
  await jadikanKanari();
  await buatRilis('1.1.0', { urutan: 0 });
  // Rilis perbaikan yang nomornya lebih rendah tetapi dibuat SESUDAHNYA —
  // ini bentuk rollback yang sah: menarik 1.1.0 dengan menerbitkan 1.0.9.
  await buatRilis('1.0.9', { urutan: 10 });
  assert.equal((await tanya(p)).json().versi, '1.0.9');
});

// ---------------------------------------------------------------------------
// Kohort
// ---------------------------------------------------------------------------

test('⛔ tahap kanari tidak menyentuh merchant yang tidak memilihnya', async () => {
  const p = await buatPerangkat();
  await buatRilis('1.1.0', { stage: 'kanari' });
  const b = (await tanya(p)).json();
  assert.equal(b.alasan, 'belum_giliran');
  assert.equal(b.versi, null, 'versinya tidak disebut — ia belum ditawarkan');
});

test('⛔ merchant yang belum giliran tidak memasang apa pun, termasuk yang WAJIB SEGERA', async () => {
  const p = await buatPerangkat();
  // Yang menaikkan tahap adalah orang, bukan tingkat kegentingan rilis.
  await buatRilis('1.1.0', { stage: 'kanari', mandatoryReason: 'keamanan' });
  const b = (await tanya(p)).json();
  assert.equal(b.pasangSekarang, false);
  assert.equal(b.alasan, 'belum_giliran');
});

test('tahap penuh mencakup setiap merchant', async () => {
  const p = await buatPerangkat();
  await buatRilis('1.1.0', { stage: 'penuh' });
  const jam = await jamLokalSekarang();
  await setelJendela(jam, (jam + 1) % 24);
  assert.equal((await tanya(p)).json().pasangSekarang, true);
});

// ---------------------------------------------------------------------------
// Wajib segera
// ---------------------------------------------------------------------------

test('⛔ wajib segera menembus jendela', async () => {
  const p = await buatPerangkat();
  await buatRilis('1.1.0', { stage: 'penuh', mandatoryReason: 'kehilangan_data' });
  const jam = await jamLokalSekarang();
  await setelJendela((jam + 5) % 24, (jam + 6) % 24);

  const b = (await tanya(p)).json();
  assert.equal(b.pasangSekarang, true);
  assert.equal(b.alasan, 'wajib_segera');
  assert.equal(b.bolehTunda, false);
});

test('⛔ alasan wajib segera di luar daftar TERTUTUP ditolak DATABASE', async () => {
  // `ARCH:356` menuntut kategorinya "didefinisikan tertulis". CHECK constraint
  // ADALAH definisi tertulisnya — tanpa itu setiap rilis menemukan alasan
  // untuk mendesak, dan jendela update berhenti berarti apa pun.
  await assert.rejects(
    () => buatRilis('9.9.9', { mandatoryReason: 'fitur_baru' }),
    /mandatory_reason/
  );
});

// ---------------------------------------------------------------------------
// Penundaan
// ---------------------------------------------------------------------------

test('penundaan dicatat, dan habis setelah 2x', async () => {
  const p = await buatPerangkat();
  await buatRilis('1.1.0', { stage: 'penuh' });

  const satu = await tunda(p);
  assert.equal(satu.statusCode, 200, satu.body);
  assert.deepEqual(satu.json(), { versi: '1.1.0', sudahTunda: 1, sisaTunda: 1 });

  const dua = await tunda(p);
  assert.deepEqual(dua.json(), { versi: '1.1.0', sudahTunda: 2, sisaTunda: 0 });

  const tiga = await tunda(p);
  assert.equal(tiga.statusCode, 409, tiga.body);
  assert.equal(tiga.json().error.code, 'DEFERRAL_NOT_ALLOWED');
});

test('⛔ penundaan yang habis TIDAK membatalkan update — ia membuatnya wajib', async () => {
  const p = await buatPerangkat();
  await buatRilis('1.1.0', { stage: 'penuh' });
  const jam = await jamLokalSekarang();
  await setelJendela(jam, (jam + 1) % 24);
  await tunda(p);
  await tunda(p);

  const b = (await tanya(p)).json();
  assert.equal(b.bolehTunda, false);
  assert.equal(b.pasangSekarang, true, 'jatah habis berarti pasang, bukan lupakan');
  assert.equal(b.sisaTunda, 0);
});

test('⛔ penghitung penundaan direset saat VERSINYA berganti', async () => {
  const p = await buatPerangkat();
  await buatRilis('1.1.0', { stage: 'penuh', urutan: 0 });
  await tunda(p);
  await tunda(p);
  assert.equal((await tunda(p)).statusCode, 409, 'prasyarat: jatah 1.1.0 habis');

  // Tanpa reset, merchant kehilangan hak menunda 1.2.0 tanpa pernah
  // memakainya — penundaan yang terkumpul untuk versi lama membuat versi
  // berikutnya wajib segera saat pertama kali muncul.
  await buatRilis('1.2.0', { stage: 'penuh', urutan: 10 });
  const res = await tunda(p);
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(res.json(), { versi: '1.2.0', sudahTunda: 1, sisaTunda: 1 });
});

test('⛔ pembaruan wajib segera TIDAK dapat ditunda', async () => {
  const p = await buatPerangkat();
  await buatRilis('1.1.0', { stage: 'penuh', mandatoryReason: 'keamanan' });
  const res = await tunda(p);
  assert.equal(res.statusCode, 409, res.body);
  assert.equal(res.json().error.code, 'DEFERRAL_NOT_ALLOWED');
  assert.match(res.json().error.message, /wajib segera/);
});

test('menunda tanpa rilis aktif ditolak 409', async () => {
  const p = await buatPerangkat();
  const res = await tunda(p);
  assert.equal(res.statusCode, 409, res.body);
  assert.equal(res.json().error.code, 'NO_ACTIVE_RELEASE');
});

// ---------------------------------------------------------------------------
// Kredensial
// ---------------------------------------------------------------------------

test('⛔ tanpa Bearer, secret salah, atau perangkat dicabut: 401', async () => {
  const p = await buatPerangkat();
  await buatRilis('1.1.0', { stage: 'penuh' });

  const tanpa = await app.inject({
    method: 'GET',
    url: `/devices/${p.id}/update`,
    headers: { 'x-tenant-id': tenant.id },
  });
  assert.equal(tanpa.statusCode, 401, tanpa.body);

  const salah = await tanya({ id: p.id, secret: 'bukan-secret' });
  assert.equal(salah.statusCode, 401, salah.body);

  const cabut = await app.inject({
    method: 'POST',
    url: `/devices/${p.id}/revoke`,
    headers: headerTenant(),
  });
  assert.equal(cabut.statusCode, 200, cabut.body);
  assert.equal((await tanya(p)).statusCode, 401);
});

test('⛔ isolasi tenant: perangkat tenant lain tidak dapat dituju', async () => {
  const p = await buatPerangkat();
  const lain = await seedTenantBase(appSetup, { suffix: 'RilisLain' });
  const res = await app.inject({
    method: 'GET',
    url: `/devices/${p.id}/update`,
    headers: { 'x-tenant-id': lain.tenant.id, authorization: `Bearer ${p.secret}` },
  });
  assert.equal(res.statusCode, 401, res.body);
});
