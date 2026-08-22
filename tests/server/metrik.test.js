'use strict';

// F6 — observability sisi server (`ARCH:294` § 10).
//
// ⛔ Yang paling penting diuji di sini adalah apa yang TIDAK ada: `/metrics`
// tidak boleh memuat satu pun data merchant. `ARCH:309` menyebutnya batas
// ETIS, bukan preferensi — "tidak pernah mengirim nama produk, harga, nilai
// transaksi, data pelanggan, atau nama merchant."
//
// Dan satu lagi yang hanya test dapat tangkap: kardinalitas label. Metrik yang
// memakai URL mentah alih-alih POLA rute membuat setiap `/orders/<uuid>`
// menjadi deret waktu tersendiri — monitoring yang penuh deret waktu
// sekali-pakai berhenti dapat dipakai, dan gejalanya baru terlihat berminggu
// kemudian saat penyimpanan metriknya penuh.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');

let owner, db, app, base, tenant;

before(async () => {
  owner = await connectAsOwner();
  db = await connectAsApp();
});

after(async () => {
  await resetAll(owner);
  await owner.end();
  await db.end();
  if (app) await app.close();
});

beforeEach(async () => {
  await resetAll(owner);
  base = await seedTenantBase(db, { suffix: 'Metrik' });
  tenant = base.tenant;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();
});

const metrics = () => app.inject({ method: 'GET', url: '/metrics' });

const hdr = () => ({
  'x-tenant-id': tenant.id,
  authorization: base.authHeader,
  'content-type': 'application/json',
});

// ---------------------------------------------------------------------------

test('/metrics dijawab tanpa sesi — scraper tidak punya kredensial manusia', async () => {
  const res = await metrics();
  assert.equal(res.statusCode, 200, res.body);
  assert.match(res.headers['content-type'], /text\/plain/);
  assert.match(res.body, /^lumi_up 1$/m);
});

test('permintaan tercatat per METODE, POLA rute, dan kelas status', async () => {
  await app.inject({ method: 'GET', url: '/health' });
  await app.inject({ method: 'GET', url: '/health' });

  const b = (await metrics()).body;
  assert.match(b, /lumi_http_requests_total\{method="GET",route="\/health",status="2xx"\} 2/);
  assert.match(b, /lumi_http_request_duration_seconds_count\{method="GET",route="\/health"\} 2/);
});

test('⛔ label rute memakai POLA, bukan URL mentah', async () => {
  // Kalau URL mentah yang dipakai, setiap id menjadi deret waktu tersendiri.
  // Dua permintaan ke dua order berbeda harus mendarat di SATU deret.
  const a = crypto.randomUUID();
  const c = crypto.randomUUID();
  await app.inject({ method: 'GET', url: `/orders/${a}`, headers: hdr() });
  await app.inject({ method: 'GET', url: `/orders/${c}`, headers: hdr() });

  const b = (await metrics()).body;
  assert.ok(!b.includes(a), 'id order bocor ke label metrik');
  assert.ok(!b.includes(c), 'id order bocor ke label metrik');
  assert.match(b, /route="\/orders\/:orderId"/);
  assert.match(b, /lumi_http_request_duration_seconds_count\{method="GET",route="\/orders\/:orderId"\} 2/);
});

test('⛔ permintaan yang GAGAL ikut tercatat — bukan hanya jalur bahagia', async () => {
  // Hook yang hanya berjalan pada jalur sukses menghasilkan grafik yang paling
  // cerah tepat saat server paling sakit.
  await app.inject({ method: 'GET', url: '/orders/tidak-ada', headers: hdr() });
  const b = (await metrics()).body;
  assert.match(b, /lumi_http_requests_total\{method="GET",route="\/orders\/:orderId",status="4xx"\} 1/);
});

test('permintaan tanpa sesi tercatat sebagai 4xx, bukan hilang', async () => {
  await app.inject({ method: 'GET', url: '/items' });
  const b = (await metrics()).body;
  assert.match(b, /route="\/items",status="4xx"/);
});

test('⛔ `/metrics` sendiri TIDAK dicatat', async () => {
  // Scraper memanggilnya setiap belasan detik. Membiarkannya masuk membuat
  // rute tersibuk di grafik adalah monitoring itu sendiri.
  await metrics();
  await metrics();
  const b = (await metrics()).body;
  assert.ok(!b.includes('route="/metrics"'), '/metrics mencatat dirinya sendiri');
});

test('⛔ NOL data merchant di respons — batas etis ARCH:309', async () => {
  // Satu penjualan penuh dulu, supaya ada nama produk, nilai, dan nama
  // merchant yang BISA bocor.
  const listItems = await app.inject({ method: 'GET', url: '/items', headers: hdr() });
  assert.equal(listItems.statusCode, 200, listItems.body);

  const b = (await metrics()).body;
  const rahasia = [
    tenant.id,
    tenant.name,
    base.outlet.id,
    base.outlet.name,
    base.item.name,
    base.item_variation.id,
    base.user.id,
    base.user.email,
  ].filter(Boolean);

  const bocor = rahasia.filter((n) => b.includes(String(n)));
  assert.deepEqual(
    bocor,
    [],
    `Nilai milik merchant muncul di /metrics:\n  ${bocor.join('\n  ')}`
  );
});

test('gauge pool koneksi ada dan berupa angka', async () => {
  const b = (await metrics()).body;
  for (const state of ['total', 'idle', 'waiting']) {
    const m = b.match(new RegExp(`lumi_db_pool_connections\\{state="${state}"\\} (\\d+)`));
    assert.ok(m, `gauge ${state} tidak ada`);
  }
});

test('histogram: ember kumulatif dan tidak pernah melebihi count', async () => {
  for (let i = 0; i < 3; i += 1) await app.inject({ method: 'GET', url: '/health' });
  const b = (await metrics()).body;

  const ember = [...b.matchAll(/lumi_http_request_duration_seconds_bucket\{method="GET",route="\/health",le="([^"]+)"\} (\d+)/g)]
    .map((m) => [m[1], Number(m[2])]);
  assert.ok(ember.length > 1);

  // Kumulatif: setiap ember >= ember sebelumnya, dan yang terakhir (`+Inf`)
  // sama dengan count.
  let sebelum = -1;
  for (const [, n] of ember) {
    assert.ok(n >= sebelum, 'ember histogram tidak kumulatif');
    sebelum = n;
  }
  const count = Number(b.match(/lumi_http_request_duration_seconds_count\{method="GET",route="\/health"\} (\d+)/)[1]);
  assert.equal(ember[ember.length - 1][1], count, '+Inf harus sama dengan count');
  assert.equal(count, 3);
});

test('⛔ metrik yang server TIDAK dapat lihat memang tidak ada', async () => {
  // Antrean yang menua adalah penjualan yang belum pernah sampai ke server —
  // tidak ada baris untuk dihitung. Metrik bernama seperti itu akan dipercaya
  // orang, dan angkanya akan selalu nol.
  const b = (await metrics()).body;
  for (const nama of ['queue_age', 'antrean', 'outbox', 'oversell', 'crash']) {
    assert.ok(!b.includes(nama), `metrik "${nama}" tidak dapat dihasilkan server ini`);
  }
});
