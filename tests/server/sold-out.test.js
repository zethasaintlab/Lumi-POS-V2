'use strict';

// FR-E5 — `POST /inventory/sold-out`, jalur naik penandaan habis.
//
// ⛔ Kenapa endpoint ini akhirnya dibangun: penandaan sudah berjalan di
// perangkat sejak F3, tapi LOKAL saja. Akibatnya barista menandai kopi habis
// di terminal 1, dan kasir di terminal 2 tetap menerima pesanannya lima menit
// kemudian — dengan pelanggan berdiri di depannya.
//
// Jalur turunnya sudah ada sejak F2 (`sold_out_flag` adalah raw table yang
// direplikasi PowerSync); yang hilang hanya jalur naiknya.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');

let owner, db, app, base, tenant, outletId, variationId;

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
  await db.query('ROLLBACK').catch(() => {});
  await resetAll(owner);
  base = await seedTenantBase(db, { suffix: 'Habis' });
  tenant = base.tenant;
  outletId = base.outlet.id;
  variationId = base.item_variation.id;

  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();
});

/**
 * ⛔ TANPA `Authorization`. Ia jalur PERANGKAT — relay outbox mengirim tepat
 * empat header dan tidak satu pun Bearer. Test yang menyertakan sesi akan
 * hijau sambil menyembunyikan endpoint yang sebenarnya menolak setiap
 * penandaan yang menyusul dari perangkat offline.
 */
function tandai(body, extra = {}) {
  return app.inject({
    method: 'POST',
    url: '/inventory/sold-out',
    payload: body,
    headers: {
      'content-type': 'application/json',
      'x-tenant-id': tenant.id,
      'x-actor-id': base.user.id,
      'idempotency-key': crypto.randomUUID(),
      ...extra,
    },
  });
}

const badan = (over = {}) => ({
  id: crypto.randomUUID(),
  outletId,
  variationId,
  isSoldOut: true,
  ...over,
});

async function baris() {
  await db.query('BEGIN');
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  const { rows } = await db.query(
    'SELECT id, variation_id, is_sold_out, set_by, hlc::text AS hlc, set_at FROM sold_out_flag ORDER BY hlc'
  );
  await db.query('COMMIT');
  return rows;
}

// ---------------------------------------------------------------------------

test('penandaan tercatat, dan responsnya membawa HLC yang dipakai', async () => {
  const b = badan();
  const res = await tandai(b);
  assert.equal(res.statusCode, 201, res.body);

  const hasil = JSON.parse(res.body);
  assert.equal(hasil.id, b.id);
  assert.equal(hasil.isSoldOut, true);
  assert.ok(hasil.hlc, 'HLC dikembalikan supaya klien dapat menyelaraskan jamnya');

  const rows = await baris();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].is_sold_out, true);
  assert.equal(rows[0].set_by, base.user.id);
});

test('⛔ TANPA sesi back-office — ia jalur perangkat', async () => {
  // Relay outbox tidak mengirim Bearer sama sekali. Melindungi rute ini
  // berarti setiap penandaan yang menyusul dari perangkat offline dijawab 401.
  const res = await tandai(badan());
  assert.equal(res.statusCode, 201, res.body);
});

test('⛔ tabel LOG: pembatalan adalah baris BARU, order asli tidak disentuh', async () => {
  const pertama = badan();
  assert.equal((await tandai(pertama)).statusCode, 201);
  assert.equal((await tandai(badan({ isSoldOut: false }))).statusCode, 201);

  const rows = await baris();
  assert.equal(rows.length, 2, 'tidak ada UPDATE — dua baris, penanda terbaru yang menang');
  assert.deepEqual(
    rows.map((r) => r.is_sold_out),
    [true, false]
  );
});

test('HLC dari perangkat dipakai apa adanya bila lebih maju', async () => {
  const jauh = '900000000000000';
  const res = await tandai(badan({ hlc: jauh }));
  assert.equal(res.statusCode, 201, res.body);

  // `update` menyerap jam yang lebih maju dan mengembalikan nilai >= yang
  // dikirim — itu yang menjaga monotonisitas per perangkat (I10).
  assert.ok(BigInt(JSON.parse(res.body).hlc) >= BigInt(jauh));
});

test('hlc yang bukan bilangan ditolak 400, bukan 500', async () => {
  const res = await tandai(badan({ hlc: 'kemarin' }));
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'VALIDATION_ERROR');
});

test('isSoldOut wajib boolean — penghapusan bukan cara membatalkan', async () => {
  const res = await tandai(badan({ isSoldOut: 'ya' }));
  assert.equal(res.statusCode, 400, res.body);
});

test('Idempotency-Key wajib', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/inventory/sold-out',
    payload: badan(),
    headers: {
      'content-type': 'application/json',
      'x-tenant-id': tenant.id,
      'x-actor-id': base.user.id,
    },
  });
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'MISSING_IDEMPOTENCY_KEY');
});

test('⛔ retry dengan key yang sama TIDAK menulis penanda kedua', async () => {
  // Relay mengirim ulang item yang responsnya hilang. Penanda kedua bukan
  // sekadar baris berlebih: ia memakai HLC yang berbeda, dan penanda terbaru
  // yang menang — jadi retry dapat menghidupkan kembali keadaan yang sudah
  // dibatalkan di antaranya.
  const b = badan();
  const key = crypto.randomUUID();

  const satu = await tandai(b, { 'idempotency-key': key });
  const dua = await tandai(b, { 'idempotency-key': key });

  assert.equal(satu.statusCode, 201, satu.body);
  assert.equal(dua.statusCode, 201, dua.body);
  assert.deepEqual(JSON.parse(dua.body), JSON.parse(satu.body), 'respons ASLI dikembalikan');
  assert.equal((await baris()).length, 1);
});

test('⛔ id yang sama tanpa key yang sama tetap tidak menggandakan baris', async () => {
  // `ON CONFLICT (id) DO NOTHING`, bukan UPDATE: menimpanya berarti server
  // menulis ulang penanda yang mungkin sudah kalah dari penanda perangkat lain
  // yang tiba di antaranya.
  const b = badan();
  assert.equal((await tandai(b)).statusCode, 201);
  // ⛔ Isi yang BERBEDA dengan id yang sama. Dengan `DO UPDATE`, baris pertama
  // akan tertimpa — dan itu persis keadaan yang berbahaya: penanda perangkat
  // lain yang tiba di antaranya sudah menang, lalu retry sebuah penanda lama
  // menghidupkan kembali keadaan yang sudah dibatalkan. Tanpa isi yang
  // berbeda, `DO NOTHING` dan `DO UPDATE` menghasilkan hasil yang identik dan
  // test-nya tidak membuktikan apa pun.
  assert.equal((await tandai({ ...b, isSoldOut: false })).statusCode, 201);

  const rows = await baris();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].is_sold_out, true, 'baris pertama TIDAK tertimpa');
});

test('⛔ variation tenant LAIN ditolak — kolomnya tanpa FK sama sekali', async () => {
  // `sold_out_flag.variation_id` adalah `text NOT NULL` tanpa referensi. Bukan
  // sekadar FK yang tidak tunduk RLS (temuan F1): di sini tidak ada apa pun di
  // database yang menolak id karangan, apalagi id milik tenant lain.
  const lain = await seedTenantBase(db, { suffix: 'HabisLain' });
  const res = await tandai(badan({ variationId: lain.item_variation.id }));
  assert.equal(res.statusCode, 404, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'VARIATION_NOT_FOUND');
  assert.equal((await baris()).length, 0, 'tidak ada baris yang tertulis sebelum ditolak');
});

test('⛔ outlet tenant lain ditolak', async () => {
  const lain = await seedTenantBase(db, { suffix: 'HabisOutlet' });
  const res = await tandai(badan({ outletId: lain.outlet.id }));
  assert.equal(res.statusCode, 404, res.body);
  assert.equal((await baris()).length, 0);
});

test('⛔ aktor karangan ditolak — `set_by` juga tanpa FK', async () => {
  const res = await tandai(badan(), { 'x-actor-id': crypto.randomUUID() });
  assert.equal(res.statusCode, 404, res.body);
  assert.equal((await baris()).length, 0);
});

test('⛔ endpoint ini TIDAK menyentuh stock_movement', async () => {
  // `spec-e:220`: penandaan habis dan stok terhitung tidak pernah saling
  // menyimpulkan. Produk dapat ditandai habis meski stok tercatat 10 — bahan
  // habis, mesin rusak, atau alasan lain yang tidak ada di ledger.
  await db.query('BEGIN');
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  const { rows: sebelum } = await db.query('SELECT count(*)::int AS n FROM stock_movement');
  await db.query('COMMIT');

  assert.equal((await tandai(badan())).statusCode, 201);

  await db.query('BEGIN');
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  const { rows: sesudah } = await db.query('SELECT count(*)::int AS n FROM stock_movement');
  await db.query('COMMIT');

  assert.equal(sesudah[0].n, sebelum[0].n);
});
