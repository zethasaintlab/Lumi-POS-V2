'use strict';

// Handler `createPayment` menjawab 422 IDEMPOTENCY_KEY_HASH_MISMATCH untuk
// semua metode manual (PR 2B Task 7); klien yang dibangkitkan dari spec harus
// tahu kode itu. Murni teks: handler dan openapi.yaml dibaca, tanpa database.

const test = require('node:test');
const assert = require('node:assert');
const { readFileSync } = require('node:fs');

const handler = readFileSync('apps/server/src/modules/payment/handlers/payments.ts', 'utf8');
const yaml = readFileSync('packages/contracts/openapi.yaml', 'utf8');

test('openapi createPayment mendeklarasikan 422 selama handler memakainya', () => {
  assert.match(
    handler,
    /422,\s*'IDEMPOTENCY_KEY_HASH_MISMATCH'/,
    'handler payments tidak lagi menjawab 422 hash-mismatch; ubah penjaga ini bersama keputusannya'
  );
  const mulai = yaml.indexOf('operationId: createPayment');
  assert.ok(mulai > 0, 'operationId createPayment hilang dari openapi.yaml');
  const berikut = yaml.indexOf('operationId:', mulai + 10);
  const blok = yaml.slice(mulai, berikut === -1 ? undefined : berikut);
  assert.match(
    blok,
    /'422':/,
    "createPayment di openapi.yaml tidak mendeklarasikan respons '422' (IDEMPOTENCY_KEY_HASH_MISMATCH)"
  );
  assert.match(blok, /IDEMPOTENCY_KEY_HASH_MISMATCH/, "respons '422' createPayment tidak menyebut IDEMPOTENCY_KEY_HASH_MISMATCH");
});
