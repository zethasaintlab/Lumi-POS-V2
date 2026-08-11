'use strict';

// CORS untuk aplikasi kasir.
//
// ⛔ Ditemukan dengan menjalankan aplikasi, bukan dengan membaca kode: klien
// di `http://localhost:1420` tidak dapat mencapai server sama sekali —
// *"Response to preflight request doesn't pass access control check"*. Tanpa
// ini, seluruh jalur naik dan seluruh penukaran token mati di browser,
// meskipun setiap test server hijau.
//
// Daftar origin datang dari ENV, bukan dari kode (invariant #5). Kosong
// berarti TIDAK ADA yang diizinkan — default yang aman, dan yang berlaku di
// CI.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

let app;
const ASAL = 'http://localhost:1420';

before(async () => {
  const { buildApp } = await import('../../apps/server/src/app.ts');
  app = await buildApp({ corsOrigins: [ASAL] });
});

after(async () => {
  if (app) await app.close();
});

test('preflight dari origin yang diizinkan dijawab dengan header yang dibutuhkan', async () => {
  const res = await app.inject({
    method: 'OPTIONS',
    url: '/devices/dev-1/sync-token',
    headers: {
      origin: ASAL,
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'authorization,x-tenant-id',
    },
  });

  assert.equal(res.statusCode, 204, res.body);
  assert.equal(res.headers['access-control-allow-origin'], ASAL);
  // Ketiga header ini yang benar-benar dipakai klien; tanpa salah satunya
  // browser menolak permintaannya sebelum terkirim.
  const izinHeader = String(res.headers['access-control-allow-headers']).toLowerCase();
  for (const h of ['authorization', 'x-tenant-id', 'x-actor-id', 'idempotency-key']) {
    assert.ok(izinHeader.includes(h), `header ${h} tidak diizinkan: ${izinHeader}`);
  }
  assert.match(String(res.headers['access-control-allow-methods']), /POST/);
});

test('respons biasa membawa Access-Control-Allow-Origin', async () => {
  const res = await app.inject({ method: 'GET', url: '/health', headers: { origin: ASAL } });
  assert.equal(res.headers['access-control-allow-origin'], ASAL);
});

// Origin yang tidak terdaftar TIDAK diberi header — browser yang menolaknya,
// dan itu memang pembagian kerjanya. Yang penting: server tidak pernah
// menjawab `*`.
test('origin asing tidak diberi izin, dan tidak pernah dijawab bintang', async () => {
  const res = await app.inject({
    method: 'GET',
    url: '/health',
    headers: { origin: 'http://penyerang.contoh' },
  });
  assert.equal(res.headers['access-control-allow-origin'], undefined);

  const pre = await app.inject({
    method: 'OPTIONS',
    url: '/health',
    headers: { origin: 'http://penyerang.contoh', 'access-control-request-method': 'GET' },
  });
  assert.notEqual(pre.headers['access-control-allow-origin'], '*');
});

test('tanpa konfigurasi: tidak ada origin yang diizinkan', async () => {
  const { buildApp } = await import('../../apps/server/src/app.ts');
  const polos = await buildApp({ corsOrigins: [] });
  try {
    const res = await polos.inject({ method: 'GET', url: '/health', headers: { origin: ASAL } });
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  } finally {
    await polos.close();
  }
});

// Permintaan tanpa `Origin` (curl, server-ke-server) tidak boleh terpengaruh.
test('permintaan tanpa Origin tetap dilayani seperti biasa', async () => {
  const res = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['access-control-allow-origin'], undefined);
});
