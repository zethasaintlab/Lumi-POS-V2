'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

test('getTenantId: header hilang melempar HttpError 400', async () => {
  const { getTenantId } = await import('../../apps/server/src/tenant-context.ts');
  const { HttpError } = await import('../../apps/server/src/http-error.ts');
  assert.throws(
    () => getTenantId({ headers: {} }),
    (err) => err instanceof HttpError && err.statusCode === 400 && err.code === 'MISSING_TENANT_ID'
  );
});

test('getTenantId: header valid dikembalikan apa adanya', async () => {
  const { getTenantId } = await import('../../apps/server/src/tenant-context.ts');
  const result = getTenantId({ headers: { 'x-tenant-id': 'tenant-abc-123' } });
  assert.equal(result, 'tenant-abc-123');
});

test('GET /health masih jalan tanpa X-Tenant-Id (bukan hook global)', async () => {
  const { buildApp } = await import('../../apps/server/src/app.ts');
  const app = await buildApp();
  const res = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(res.statusCode, 200);
  await app.close();
});

test('getTenantId: header > 64 karakter ditolak', async () => {
  const { getTenantId } = await import('../../apps/server/src/tenant-context.ts');
  const { HttpError } = await import('../../apps/server/src/http-error.ts');
  assert.throws(
    () => getTenantId({ headers: { 'x-tenant-id': 'x'.repeat(65) } }),
    (err) => err instanceof HttpError && err.statusCode === 400
  );
});
