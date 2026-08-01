'use strict';

// Whole-branch review FIX 8: buildApp() creates a pg Pool (createPool())
// BEFORE assertAllOperationsImplemented() runs. If that check throws --
// which it does whenever serviceHandlers is missing an operationId declared
// in openapi.yaml -- buildApp() used to exit without ever calling
// pool.end(), leaking the Pool's connections/handles. Same leak shape for
// ANY throw between pool creation and the point where `app.addHook('onClose',
// ...)` registers the cleanup (e.g. a bad openapi-glue registration), so the
// fix wraps the whole body, not just the one call site.
//
// buildApp() now accepts an optional { pool, specPath } override so this can
// be tested without needing a real broken serviceHandlers set -- passing a
// spec path that doesn't exist makes assertAllOperationsImplemented's
// readFileSync throw synchronously, exactly like a missing operationId would.
// Default behaviour (buildApp() with no args) is unchanged for every other
// caller in this test suite.

const { test } = require('node:test');
const assert = require('node:assert/strict');

test('buildApp: pool ditutup kalau gagal sebelum onClose hook terdaftar (specPath tidak valid)', async () => {
  const { buildApp } = await import('../../apps/server/src/app.ts');
  const { createPool } = await import('../../apps/server/src/db.ts');

  const pool = createPool();
  await assert.rejects(
    buildApp({ pool, specPath: 'C:/definitely/does/not/exist-lumi-pos-test.yaml' })
  );
  assert.equal(
    pool.ended,
    true,
    'pool yang dibuat sebelum assertAllOperationsImplemented harus ditutup kalau buildApp gagal, bukan dibiarkan bocor'
  );
});

test('buildApp: jalur sukses tetap menutup pool lewat onClose seperti biasa', async () => {
  const { buildApp } = await import('../../apps/server/src/app.ts');
  const app = await buildApp();
  assert.equal(app.pool.ended, false);
  await app.close();
  assert.equal(app.pool.ended, true);
});
