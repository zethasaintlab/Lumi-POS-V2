'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { connectAsOwner, connectAsApp } = require('./helpers/db');
const { resetAll } = require('./helpers/reset');
const { TABLES } = require('./helpers/tables');
const { seedTenantBase, seedTransactionCycle, seedBareTenant, seedGlobalPrinterProfile, freshId } = require('./helpers/seed');

// Requirement 1 dari tests/README.md: buat dua tenant, akses data tenant A
// dengan konteks tenant B -> SELECT kosong, INSERT/UPDATE/DELETE ditolak,
// untuk SETIAP tabel. Tabel partitioned diuji di dua bulan berbeda untuk
// membuktikan RLS tetap berlaku lintas partition boundary (ERD §1.10).
//
// Catatan INSERT: sejumlah kecil tabel (role, order, check, device,
// cash_drawer_shift) punya UNIQUE constraint di luar id. Klon impersonasi di
// sini hanya mengganti id, jadi penolakan pada tabel-tabel itu bisa datang
// dari UNIQUE constraint, bukan murni RLS WITH CHECK — keduanya tetap hasil
// keamanan yang benar (penyerang tidak bisa menyisipkan baris), dan atribusi
// presisi ke RLS sudah dibuktikan terpisah oleh sub-test SELECT/UPDATE/DELETE.

let owner, appA, appB;
let baseA, cycleA0, cycleA2, tenantB;

async function withTenantContext(client, tenantId, fn) {
  await client.query('BEGIN');
  try {
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    return await fn();
  } finally {
    await client.query('ROLLBACK');
  }
}

before(async () => {
  owner = await connectAsOwner();
  appA = await connectAsApp();
  appB = await connectAsApp();

  await resetAll(owner);
  const printerProfile = await seedGlobalPrinterProfile(owner);

  baseA = await seedTenantBase(appA, { suffix: 'A' });
  cycleA0 = await seedTransactionCycle(appA, baseA, { cycleLabel: 'A0', printerProfileId: printerProfile.id, monthOffset: 0 });
  cycleA2 = await seedTransactionCycle(appA, baseA, { cycleLabel: 'A2', printerProfileId: printerProfile.id, monthOffset: 2 });

  tenantB = await seedBareTenant(appB, { suffix: 'B' });
});

after(async () => {
  await owner.end();
  await appA.end();
  await appB.end();
});

const rowsMonth0 = () => ({ ...baseA, ...cycleA0 });
const rowsMonth2 = () => ({ ...baseA, ...cycleA2 });

for (const tableMeta of TABLES) {
  const { name, whereForRow, buildImpersonationRow, partitioned } = tableMeta;
  // getSeededRows (bukan seededRows sudah-dihitung) sengaja dipakai: describe()
  // dieksekusi sinkron saat file di-discover, sebelum before() di atas selesai
  // mengisi baseA/cycleA0/cycleA2. Memanggil rowsMonth0()/rowsMonth2() di sini
  // akan membekukan {} kosong ke closure test(). Baris ini harus tetap sebagai
  // referensi fungsi, dan dipanggil di DALAM tiap test() agar dievaluasi saat
  // eksekusi (setelah before() selesai), bukan saat registrasi.
  const variants = partitioned
    ? [
        { label: `${name} (bulan ini)`, getSeededRows: rowsMonth0 },
        { label: `${name} (bulan +2, lintas partition)`, getSeededRows: rowsMonth2 },
      ]
    : [{ label: name, getSeededRows: rowsMonth0 }];

  for (const { label, getSeededRows } of variants) {
    describe(label, () => {
      test('SELECT lintas tenant -> kosong', async () => {
        const sourceRow = getSeededRows()[name];
        const { clause, params } = whereForRow(sourceRow);
        const rows = await withTenantContext(appB, tenantB.id, async () => {
          const { rows } = await appB.query(`SELECT * FROM "${name}" WHERE ${clause}`, params);
          return rows;
        });
        assert.deepEqual(rows, []);
      });

      test('INSERT impersonasi tenant_id -> ditolak', async () => {
        const seededRows = getSeededRows();
        const sourceRow = seededRows[name];
        const impersonated = buildImpersonationRow(sourceRow, seededRows, freshId);
        await assert.rejects(
          withTenantContext(appB, tenantB.id, async () => {
            const cols = Object.keys(impersonated);
            const placeholders = cols.map((_, i) => `$${i + 1}`);
            const sql = `INSERT INTO "${name}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders.join(', ')})`;
            await appB.query(sql, cols.map((c) => impersonated[c]));
          })
        );
      });

      test('UPDATE lintas tenant -> 0 baris', async () => {
        const sourceRow = getSeededRows()[name];
        const { clause, params } = whereForRow(sourceRow);
        const rowCount = await withTenantContext(appB, tenantB.id, async () => {
          const { rowCount } = await appB.query(`UPDATE "${name}" SET tenant_id = tenant_id WHERE ${clause}`, params);
          return rowCount;
        });
        assert.equal(rowCount, 0);
      });

      test('DELETE lintas tenant -> 0 baris, baris tetap ada', async () => {
        const sourceRow = getSeededRows()[name];
        const { clause, params } = whereForRow(sourceRow);
        const rowCount = await withTenantContext(appB, tenantB.id, async () => {
          const { rowCount } = await appB.query(`DELETE FROM "${name}" WHERE ${clause}`, params);
          return rowCount;
        });
        assert.equal(rowCount, 0);

        const stillExists = await withTenantContext(appA, baseA.tenant.id, async () => {
          const { rows } = await appA.query(`SELECT * FROM "${name}" WHERE ${clause}`, params);
          return rows.length === 1;
        });
        assert.equal(stillExists, true);
      });
    });
  }
}
