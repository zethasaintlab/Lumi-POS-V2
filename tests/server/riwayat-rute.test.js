'use strict';

// `GET /orders` — rute B-02.
//
// Aturan yang sulit sudah diuji di `riwayat-pesanan.test.js` terhadap helper.
// Yang diuji di sini lapisan HTTP-nya: validasi parameter, kursor buram, dan
// hal-hal yang hanya dapat salah setelah query string terlibat.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');

let owner, dbApp, app, base, tenant, device, shift;

before(async () => {
  owner = await connectAsOwner();
  dbApp = await connectAsApp();
});

after(async () => {
  await resetAll(owner);
  await owner.end();
  await dbApp.end();
  if (app) await app.close();
});

beforeEach(async () => {
  await dbApp.query('ROLLBACK').catch(() => {});
  await resetAll(owner);
  base = await seedTenantBase(dbApp, { suffix: 'RiwayatRute' });
  tenant = base.tenant;

  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();

  device = crypto.randomUUID();
  shift = crypto.randomUUID();
  await dbApp.query('BEGIN');
  await dbApp.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await dbApp.query(
    `INSERT INTO device (id, tenant_id, outlet_id, code, name, platform, app_version, schema_version)
     VALUES ($1,$2,$3,'K1','K1','tauri','0','1')`,
    [device, tenant.id, base.outlet.id]
  );
  await dbApp.query(
    `INSERT INTO cash_drawer_shift (id, tenant_id, outlet_id, device_id, business_date, status, opening_float, opened_by)
     VALUES ($1,$2,$3,$4,'2026-08-10','open',0,$5)`,
    [shift, tenant.id, base.outlet.id, device, base.user.id]
  );
  await dbApp.query('COMMIT');
});

let n = 0;

async function order({ status = 'closed', total = 100000, tanggal = '2026-08-10' } = {}) {
  const id = crypto.randomUUID();
  n += 1;
  await dbApp.query('BEGIN');
  await dbApp.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await dbApp.query(
    `INSERT INTO "order" (id,tenant_id,outlet_id,device_id,shift_id,receipt_number,business_date,sequence,
       status,channel,subtotal,total,amount_due,created_by,occurred_at,hlc)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::int,$9,'takeaway',$10,$10,$10,$11,
             ($7::date + time '10:00') AT TIME ZONE 'UTC',$8::bigint)`,
    [id, tenant.id, base.outlet.id, device, shift, `K1-${String(tanggal).replace(/-/g, '')}-${n}`,
     tanggal, n, status, total, base.user.id]
  );
  await dbApp.query('COMMIT');
  return id;
}

const hdr = () => ({
  'x-tenant-id': tenant.id,
  authorization: base.authHeader,
  'x-actor-id': base.user.id,
});

const RENTANG = 'from=2026-08-01&to=2026-08-31';
const minta = (q) => app.inject({ method: 'GET', url: `/orders?${q}`, headers: hdr() });

test('mengembalikan halaman transaksi', async () => {
  await order({ total: 125000 });
  const res = await minta(RENTANG);
  assert.equal(res.statusCode, 200, res.body);
  const body = res.json();
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].total, '125000');
  assert.equal(body.items[0].status, 'terjual');
  assert.equal(body.cursorBerikut, null);
});

test('⛔ uang tetap STRING lewat HTTP', async () => {
  await order({ total: '9007199254740993' });
  const body = (await minta(RENTANG)).json();
  assert.equal(body.items[0].total, '9007199254740993');
});

test('⛔ kursor BURAM dan dapat dipakai apa adanya', async () => {
  // Klien menyalin `cursorBerikut` tanpa membacanya. Kursor yang harus disusun
  // klien mengundang tebakan, dan kursor tebakan menghasilkan halaman yang
  // melewatkan transaksi tanpa satu pun error.
  for (let i = 0; i < 3; i += 1) await order({});

  const h1 = (await minta(`${RENTANG}&limit=2`)).json();
  assert.equal(h1.items.length, 2);
  assert.equal(typeof h1.cursorBerikut, 'string');
  assert.doesNotMatch(h1.cursorBerikut, /\{|"/, 'kursor bocor sebagai JSON mentah');

  const h2 = (await minta(`${RENTANG}&limit=2&cursor=${encodeURIComponent(h1.cursorBerikut)}`)).json();
  assert.equal(h2.items.length, 1);
  assert.equal(h2.cursorBerikut, null);

  const semua = [...h1.items, ...h2.items].map((i) => i.id);
  assert.equal(new Set(semua).size, 3, 'halaman tumpang tindih atau melewatkan');
});

test('⛔ kursor cacat ditolak 400, tidak diam-diam diabaikan', async () => {
  // Kursor yang diabaikan mengembalikan HALAMAN PERTAMA untuk permintaan
  // halaman kedua — pengguna menekan "berikutnya" dan melihat baris yang sama,
  // atau lebih buruk, mengira itu semua yang ada.
  for (const jahat of ['bukan-base64!!', 'e30', encodeURIComponent('{"businessDate":"besok"}')]) {
    const res = await minta(`${RENTANG}&limit=2&cursor=${jahat}`);
    assert.equal(res.statusCode, 400, `cursor "${jahat}" diterima: ${res.body}`);
    assert.equal(res.json().error.code, 'VALIDATION_ERROR');
  }
});

test('⛔ status tak dikenal ditolak, tidak diabaikan', async () => {
  // Mengabaikannya mengembalikan SELURUH daftar untuk penyaring yang salah
  // ketik, dan layar menampilkannya seolah itu hasil penyaringan.
  await order({});
  const res = await minta(`${RENTANG}&status=selesai`);
  assert.equal(res.statusCode, 400, res.body);
  assert.match(res.json().error.message, /terjual/);
});

test('⛔ status yang disembunyikan backend juga ditolak di rute', async () => {
  const res = await minta(`${RENTANG}&status=terbuka`);
  assert.equal(res.statusCode, 400, res.body);
});

test('status yang sah menyaring', async () => {
  await order({});
  const res = await minta(`${RENTANG}&status=terjual`);
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().items.length, 1);
});

test('⛔ status BERGANDA dipisah koma — B-02 menyaringnya lewat pilihan ganda', async () => {
  // "Dibatalkan + Refund" adalah pertanyaan yang wajar: koreksi apa saja yang
  // terjadi minggu ini. Bentuk tunggal memaksa layar memilih antara satu
  // status atau semuanya, dan tidak ada di antaranya.
  const terjual = await order({});
  const asli = await order({ status: 'open' });
  await dbApp.query('BEGIN');
  await dbApp.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  n += 1;
  await dbApp.query(
    `INSERT INTO "order" (id,tenant_id,outlet_id,device_id,shift_id,receipt_number,business_date,sequence,
       status,channel,subtotal,total,amount_due,created_by,occurred_at,hlc,voided_by_order_id)
     VALUES ($1,$2,$3,$4,$5,$6,'2026-08-10',$7::int,'voided','takeaway',0,0,0,$8,
             now(),$7::bigint,$9)`,
    [crypto.randomUUID(), tenant.id, base.outlet.id, device, shift, `K1-X-${n}`, n, base.user.id, asli]
  );
  await dbApp.query('COMMIT');

  const satu = (await minta(`${RENTANG}&status=dibatalkan`)).json();
  assert.deepEqual(satu.items.map((i) => i.id), [asli]);

  const dua = (await minta(`${RENTANG}&status=dibatalkan,terjual`)).json();
  assert.equal(dua.items.length, 2);
  assert.ok(dua.items.some((i) => i.id === terjual));
  assert.ok(dua.items.some((i) => i.id === asli));
});

test('⛔ satu status asing di dalam daftar menolak SELURUH permintaan', async () => {
  // Menyaring yang dikenal saja dan mengabaikan sisanya mengembalikan hasil
  // yang tidak sesuai permintaan, dan tidak ada yang memeriksanya.
  const res = await minta(`${RENTANG}&status=terjual,terbuka`);
  assert.equal(res.statusCode, 400, res.body);
});

test('limit di luar batas ditolak', async () => {
  for (const l of ['0', '201', 'banyak', '1.5']) {
    const res = await minta(`${RENTANG}&limit=${l}`);
    assert.equal(res.statusCode, 400, `limit ${l} diterima`);
  }
});

test('pencarian struk kosong diperlakukan sebagai tanpa pencarian', async () => {
  // Kotak pencarian yang dikosongkan mengirim string kosong. Mencari `%%`
  // membuang kerja untuk hasil yang sama dengan tanpa penyaring.
  await order({});
  const res = await minta(`${RENTANG}&receipt_number=`);
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().items.length, 1);
});

test('pencarian struk sebagian lewat HTTP', async () => {
  await order({});
  const semua = (await minta(RENTANG)).json();
  const potongan = semua.items[0].receiptNumber.slice(-3);
  const res = await minta(`${RENTANG}&receipt_number=${encodeURIComponent(potongan)}`);
  assert.equal(res.json().items.length, 1);
});

test('rentang tak sah ditolak, memakai validasi yang sama', async () => {
  const res = await minta('from=2026-08-12&to=2026-08-10');
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(res.json().error.code, 'VALIDATION_ERROR');
});

test('⛔ tanpa sesi ditolak 401', async () => {
  const res = await app.inject({
    method: 'GET',
    url: `/orders?${RENTANG}`,
    headers: { 'x-tenant-id': tenant.id },
  });
  assert.equal(res.statusCode, 401, res.body);
});

test('⛔ outlet tenant lain ditolak 404', async () => {
  const lain = await seedTenantBase(dbApp, { suffix: 'RiwayatRuteLain' });
  const res = await minta(`${RENTANG}&outlet_id=${lain.outlet.id}`);
  assert.equal(res.statusCode, 404, res.body);
});

test('rentang kosong mengembalikan daftar kosong, bukan error', async () => {
  const res = await minta('from=2026-01-01&to=2026-01-31');
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(res.json().items, []);
  assert.equal(res.json().cursorBerikut, null);
});
