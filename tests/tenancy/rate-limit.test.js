'use strict';

// ⛔ `POST /tenants` adalah satu-satunya endpoint yang membuat baris database
// TANPA autentikasi apa pun.
//
// Tabel `tenant` dikecualikan RLS, jadi tidak ada lapisan lain yang menahan
// pembuatan tenant. Tanpa batas laju, satu skrip dapat mengisi database
// dengan tenant, outlet, dan pengguna sampai penuh.
//
// Store-nya IN-MEMORY: `research/03` mengunci "tanpa Redis di v1".
// Konsekuensinya jujur — hitungan per-proses, hilang saat restart. Ia menahan
// penyalahgunaan kasar, bukan penyerang terdistribusi.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');

let owner, app;

before(async () => {
  owner = await connectAsOwner();
});

after(async () => {
  await resetAll(owner);
  await owner.end();
  if (app) await app.close();
});

beforeEach(async () => {
  await resetAll(owner);
});

/**
 * Batasnya di-inject, tidak dibaca dari `.env`.
 *
 * ⛔ Bergantung pada nilai produksi (5 per 15 menit) akan membuat test ini
 * mengirim enam permintaan sungguhan setiap kali ia berjalan, dan
 * MENGUBAHNYA di environment mana pun akan mematikan test tanpa satu pun
 * baris kode berubah. Seam-nya sama dengan `paymentProvider` dan `logger`.
 */
async function bangun(batas) {
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp({ batasPendaftaran: batas });
  return app;
}

function badan() {
  return {
    tenant: { id: crypto.randomUUID(), name: 'Kopi Laju' },
    outlet: { id: crypto.randomUUID(), name: 'Pusat', timezone: 'Asia/Jakarta' },
    owner: {
      id: crypto.randomUUID(),
      name: 'Pemilik',
      email: `owner+${crypto.randomUUID()}@contoh.id`,
      password: 'kopi susu gula aren',
    },
  };
}

function daftar() {
  return app.inject({
    method: 'POST',
    url: '/tenants',
    payload: badan(),
    headers: { 'content-type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------

test('⛔ pendaftaran melewati batas dijawab 429', async () => {
  await bangun({ max: 2, jendela: '1 minute' });

  assert.equal((await daftar()).statusCode, 201);
  assert.equal((await daftar()).statusCode, 201);

  const res = await daftar();
  assert.equal(res.statusCode, 429, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'RATE_LIMITED');
});

test('⛔ pesan penolakan menyebut BERAPA LAMA harus menunggu', async () => {
  // "Terlalu banyak permintaan" tanpa angka membuat merchant yang sah — yang
  // salah ketik lalu mengulang — menebak apakah ia diblokir selamanya.
  await bangun({ max: 1, jendela: '1 minute' });
  await daftar();

  const res = await daftar();
  assert.equal(res.statusCode, 429);
  const pesan = JSON.parse(res.body).error.message;
  assert.match(pesan, /1/, 'pesan tidak menyebut batasnya');
  assert.match(pesan, /menit|minute|detik|second/i, 'pesan tidak menyebut jendelanya');
});

test('⛔ tenant ke-3 BENAR-BENAR tidak tertulis, bukan sekadar dijawab 429', async () => {
  // Batas laju yang menjawab 429 setelah barisnya ditulis tidak menutup apa
  // pun — ia hanya menyembunyikan hasilnya dari penyerang yang tidak peduli
  // dengan responsnya.
  await bangun({ max: 2, jendela: '1 minute' });
  await daftar();
  await daftar();
  await daftar();

  const { rows } = await owner.query('SELECT count(*) AS n FROM tenant');
  assert.equal(rows[0].n, '2', 'permintaan ke-3 tetap menulis tenant');
});

test('⛔ batasnya HANYA di /tenants — endpoint lain tidak ikut dibatasi', async () => {
  // `global: false`. Membatasi jalur kasir berarti membangun kemampuan
  // menghentikan penjualan dari sisi server — hal yang sama yang
  // `research/09` § 6 larang untuk kuota. Perangkat di balik satu NAT outlet
  // berbagi alamat IP; batas global akan mengunci kasir kedua pada jam sibuk.
  await bangun({ max: 1, jendela: '1 minute' });

  for (let i = 0; i < 12; i += 1) {
    const res = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(res.statusCode, 200, `/health ikut dibatasi pada permintaan ke-${i + 1}`);
  }
});

test('⛔ jalur kasir tidak ikut dibatasi meski pendaftaran sudah 429', async () => {
  // Diuji terhadap endpoint yang benar-benar dipakai kasir, bukan hanya
  // /health. Penolakan yang diharapkan di sini adalah penolakan TENANT
  // (400/404) — apa pun kecuali 429.
  await bangun({ max: 1, jendela: '1 minute' });
  await daftar();
  assert.equal((await daftar()).statusCode, 429);

  for (const url of ['/orders', '/shifts']) {
    for (let i = 0; i < 8; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url,
        payload: {},
        headers: { 'content-type': 'application/json', 'x-tenant-id': crypto.randomUUID() },
      });
      assert.notEqual(res.statusCode, 429, `${url} ikut dibatasi pada permintaan ke-${i + 1}`);
    }
  }
});

test('bawaan produksi berlaku bila tidak di-override', async () => {
  // Bahwa seam test-nya ada tidak boleh berarti produksi berjalan tanpa
  // batas. Empat pendaftaran berturut-turut harus lolos pada bawaan 5.
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();

  for (let i = 0; i < 4; i += 1) {
    assert.equal((await daftar()).statusCode, 201, `pendaftaran ke-${i + 1} ditolak`);
  }
});
