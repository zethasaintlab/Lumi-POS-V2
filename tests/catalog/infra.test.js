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

// --- T0: identitas aktor (keputusan Q1 di PLAN-katalog-harga-riwayat.md) ---
// FR-A7 mensyaratkan price_history.changed_by selalu terisi. Modul identity
// belum ada, jadi aktor dibaca dari header X-Actor-Id dengan pola yang persis
// sama dengan X-Tenant-Id -- satu titik yang nanti diganti ekstraksi token.
// Bahwa aktor itu SUNGGUH ADA di tenant ini divalidasi terpisah lewat SELECT
// yang tunduk RLS (lihat tests/catalog/prices.test.js), bukan di sini.

test('getActorId: header hilang melempar HttpError 400', async () => {
  const { getActorId } = await import('../../apps/server/src/tenant-context.ts');
  const { HttpError } = await import('../../apps/server/src/http-error.ts');
  assert.throws(
    () => getActorId({ headers: {} }),
    (err) => err instanceof HttpError && err.statusCode === 400 && err.code === 'MISSING_ACTOR_ID'
  );
});

test('getActorId: header kosong melempar HttpError 400', async () => {
  const { getActorId } = await import('../../apps/server/src/tenant-context.ts');
  const { HttpError } = await import('../../apps/server/src/http-error.ts');
  assert.throws(
    () => getActorId({ headers: { 'x-actor-id': '' } }),
    (err) => err instanceof HttpError && err.statusCode === 400 && err.code === 'MISSING_ACTOR_ID'
  );
});

test('getActorId: header valid dikembalikan apa adanya', async () => {
  const { getActorId } = await import('../../apps/server/src/tenant-context.ts');
  const result = getActorId({ headers: { 'x-actor-id': 'user-abc-123' } });
  assert.equal(result, 'user-abc-123');
});

test('getActorId: header > 64 karakter ditolak', async () => {
  const { getActorId } = await import('../../apps/server/src/tenant-context.ts');
  const { HttpError } = await import('../../apps/server/src/http-error.ts');
  assert.throws(
    () => getActorId({ headers: { 'x-actor-id': 'x'.repeat(65) } }),
    (err) => err instanceof HttpError && err.statusCode === 400 && err.code === 'MISSING_ACTOR_ID'
  );
});

// Fastify menormalkan header duplikat jadi array. getTenantId sudah menangani
// ini (Array.isArray -> [0]); getActorId harus konsisten, bukan meledak atau
// menulis "a,b" ke kolom audit.
test('getActorId: header duplikat memakai nilai pertama', async () => {
  const { getActorId } = await import('../../apps/server/src/tenant-context.ts');
  const result = getActorId({ headers: { 'x-actor-id': ['user-1', 'user-2'] } });
  assert.equal(result, 'user-1');
});
