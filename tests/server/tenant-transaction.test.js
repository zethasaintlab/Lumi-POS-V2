'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');

let owner, appSetup, pool, tenantA, tenantB;

before(async () => {
  owner = await connectAsOwner();
  appSetup = await connectAsApp();
  await resetAll(owner);

  const baseA = await seedTenantBase(appSetup, { suffix: 'ServerTxA' });
  tenantA = baseA.tenant;
  const baseB = await seedTenantBase(appSetup, { suffix: 'ServerTxB' });
  tenantB = baseB.tenant;

  const { createPool } = await import('../../apps/server/src/db.ts');
  // max: 1 forces every pool.connect() below to reuse the SAME physical
  // connection -- this is the exact connection-pooling scenario that must
  // not leak tenant context between calls.
  pool = createPool();
  pool.options.max = 1;
});

after(async () => {
  await pool.end();
  await resetAll(owner);
  await owner.end();
  await appSetup.end();
});

test('withTenantTransaction: tenant A melihat hanya datanya sendiri', async () => {
  const { withTenantTransaction } = await import('../../apps/server/src/db.ts');
  const rows = await withTenantTransaction(pool, tenantA.id, async (client) => {
    const { rows } = await client.query('SELECT id FROM outlet WHERE tenant_id = $1', [tenantA.id]);
    return rows;
  });
  assert.equal(rows.length, 1);
});

test('withTenantTransaction: koneksi fisik dipakai ulang, tenant B tidak melihat data tenant A', async () => {
  const { withTenantTransaction } = await import('../../apps/server/src/db.ts');
  const rows = await withTenantTransaction(pool, tenantB.id, async (client) => {
    const { rows } = await client.query('SELECT id FROM outlet WHERE tenant_id = $1', [tenantA.id]);
    return rows;
  });
  assert.deepEqual(rows, [], 'konteks tenant B tidak boleh melihat baris tenant A meski koneksi fisik sama');
});

test('withTenantTransaction: error di tengah transaksi di-ROLLBACK, tidak bocor ke pemanggilan pool berikutnya', async () => {
  const { withTenantTransaction } = await import('../../apps/server/src/db.ts');

  await assert.rejects(
    withTenantTransaction(pool, tenantA.id, async () => {
      throw new Error('kegagalan sengaja di tengah transaksi');
    }),
    /kegagalan sengaja/
  );

  const rows = await withTenantTransaction(pool, tenantB.id, async (client) => {
    const { rows } = await client.query('SELECT id FROM outlet WHERE tenant_id = $1', [tenantA.id]);
    return rows;
  });
  assert.deepEqual(rows, [], 'setelah ROLLBACK, pemanggilan pool berikutnya tidak boleh melihat sisa konteks tenant A');
});
