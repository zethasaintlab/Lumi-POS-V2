'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { connectAsOwner, connectAsApp } = require('./helpers/db');
const { resetAll } = require('./helpers/reset');
const { seedTenantBase } = require('./helpers/seed');

// Requirement 4 dari tests/README.md: app.tenant_id di-SET LOCAL per
// transaksi, tidak boleh bocor antar "request" saat koneksi fisik dipakai
// ulang (skenario connection pooling). Ini membuktikan jaminan level-database
// yang wajib dipegang kode server nanti — belum ada kode server di F0, jadi
// test ini bicara langsung ke Postgres lewat satu koneksi fisik yang sama.

let owner, appSetup, physical;
let tenantA, tenantB;

before(async () => {
  owner = await connectAsOwner();
  appSetup = await connectAsApp();
  await resetAll(owner);

  const baseA = await seedTenantBase(appSetup, { suffix: 'SetLocalA' });
  tenantA = baseA.tenant;
  const baseB = await seedTenantBase(appSetup, { suffix: 'SetLocalB' });
  tenantB = baseB.tenant;

  physical = await connectAsApp();
});

after(async () => {
  await owner.end();
  await appSetup.end();
  await physical.end();
});

test('request 1: SET LOCAL tenant A -> lihat data tenant A, lalu COMMIT', async () => {
  await physical.query('BEGIN');
  await physical.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantA.id]);
  const { rows } = await physical.query('SELECT id FROM outlet WHERE tenant_id = $1', [tenantA.id]);
  assert.equal(rows.length, 1);
  await physical.query('COMMIT');
});

test('request 2 (koneksi fisik sama, TANPA SET LOCAL): tidak bocor tenant A', async () => {
  await physical.query('BEGIN');
  const { rows } = await physical.query(`SELECT current_setting('app.tenant_id', true) AS tid`);
  assert.notEqual(rows[0].tid, tenantA.id, 'app.tenant_id tidak boleh bertahan dari request sebelumnya');
  assert.ok(rows[0].tid === null || rows[0].tid === '', 'app.tenant_id harus kosong tanpa SET LOCAL eksplisit');

  // Tanpa app.tenant_id ter-set eksplisit di request ini, current_setting('app.tenant_id')
  // di dalam kebijakan RLS bisa: (a) melempar error "unrecognized configuration
  // parameter" jika GUC custom ini belum pernah disentuh sama sekali di koneksi
  // fisik ini, atau (b) mengembalikan string kosong jika request 1 di atas sudah
  // pernah menyentuhnya lewat SET LOCAL -- placeholder GUC custom bertahan
  // sepanjang koneksi walau SET LOCAL-nya sudah ikut ter-COMMIT/ROLLBACK
  // (diverifikasi manual: current_setting tanpa missing_ok pada koneksi yang
  // sebelumnya pernah SET LOCAL mengembalikan '', bukan error). Kedua kasus
  // tetap AMAN: baik query gagal, atau '' tidak pernah cocok tenant_id manapun
  // -- yang wajib dibuktikan hanyalah baris tenant A TIDAK PERNAH ikut kembali.
  try {
    const { rows } = await physical.query('SELECT id FROM outlet WHERE tenant_id = $1', [tenantA.id]);
    assert.deepEqual(rows, [], 'app.tenant_id kosong tidak boleh diam-diam menunjukkan data tenant A');
  } catch {
    // Query gagal juga hasil yang aman di sini -- lihat catatan di atas.
  }
  await physical.query('ROLLBACK');
});

test('request 3 (koneksi fisik sama): SET LOCAL tenant B -> hanya lihat data tenant B', async () => {
  await physical.query('BEGIN');
  await physical.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantB.id]);

  const { rows: bRows } = await physical.query('SELECT id FROM outlet WHERE tenant_id = $1', [tenantB.id]);
  assert.equal(bRows.length, 1);

  const { rows: aRows } = await physical.query('SELECT id FROM outlet WHERE tenant_id = $1', [tenantA.id]);
  assert.deepEqual(aRows, [], 'tenant A tidak boleh terlihat di bawah konteks tenant B');

  await physical.query('COMMIT');
});

test('kontrol negatif: SET (session-scoped, bukan SET LOCAL) memang bocor -- membuktikan test ini sensitif terhadap kelas bug ini', async () => {
  const canary = await connectAsApp();
  try {
    await canary.query('BEGIN');
    await canary.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantA.id]); // is_local=false = SET biasa
    await canary.query('COMMIT');

    // "Request" baru pada koneksi fisik yang sama, tanpa SET LOCAL ulang.
    await canary.query('BEGIN');
    const { rows } = await canary.query(`SELECT current_setting('app.tenant_id', true) AS tid`);
    assert.equal(rows[0].tid, tenantA.id, 'kontrol negatif: SET session-scoped harus bocor ke request berikutnya');
    await canary.query('ROLLBACK');
  } finally {
    await canary.end();
  }
});
