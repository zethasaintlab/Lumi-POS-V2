'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

test('GET /health mengembalikan status ok, lewat pipa OpenAPI spec-first penuh', async () => {
  const { buildApp } = await import('../../apps/server/src/app.ts');
  const app = await buildApp();

  const res = await app.inject({ method: 'GET', url: '/health' });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { status: 'ok' });

  await app.close();
});
