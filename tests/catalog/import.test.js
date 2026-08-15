'use strict';

// FR-A8 — endpoint impor katalog.
//
// Parser dan validatornya diuji di `tests/domain/impor-katalog.test.js`. Yang
// diuji DI SINI adalah hal-hal yang hanya server dapat buktikan: `dryRun`
// benar-benar tidak menulis, kategori baru benar-benar dibuat, nama yang sudah
// ada benar-benar terdeteksi lewat RLS, dan impor tercatat di audit trail
// (`spec-a:290`).

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');

let owner, appSetup, app, tenant, base;

before(async () => {
  owner = await connectAsOwner();
  appSetup = await connectAsApp();
});

after(async () => {
  await resetAll(owner);
  await owner.end();
  await appSetup.end();
  if (app) await app.close();
});

beforeEach(async () => {
  await resetAll(owner);
  base = await seedTenantBase(appSetup, { suffix: 'ImportTest' });
  tenant = base.tenant;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();
});

function impor(payload, headers = {}) {
  return app.inject({
    method: 'POST',
    url: '/catalog/import',
    payload,
    headers: {
      'x-tenant-id': tenant.id,
      'x-actor-id': base.user.id,
      'idempotency-key': crypto.randomUUID(),
      ...headers,
    },
  });
}

async function query(sql, params = []) {
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  const { rows } = await appSetup.query(sql, params);
  await appSetup.query('COMMIT');
  return rows;
}

// ⛔ Nama produk dan kategori di sini sengaja TIDAK bertabrakan dengan
// `seedTenantBase`, yang sudah membuat item "Kopi Susu" dan kategori
// "Minuman". Versi pertama berkas ini memakai keduanya, dan hasilnya terbaca
// sebagai cacat kode — padahal aturan "sudah ada di katalog → dilewati" justru
// bekerja dengan benar.
const CSV = ['nama,kategori,harga', 'Latte Aren,Kopi Susu Kategori,25.000', 'Roti Bakar,Makanan,15000'].join('\n');

// ---------------------------------------------------------------------------

test('⛔ dryRun TIDAK menulis satu baris pun', async () => {
  // Bawaannya `true`, dan itu sengaja: impor yang berjalan karena field lupa
  // diisi tidak dapat dibatalkan — katalog tidak pernah di-DELETE
  // (invariant #2), jadi produk yang salah masuk harus diarsipkan satu per
  // satu.
  const res = await impor({ csv: CSV });
  assert.equal(res.statusCode, 200, res.body);
  const body = JSON.parse(res.body);

  assert.equal(body.dryRun, true, 'dryRun harus BAWAAN true');
  assert.equal(body.jumlahBaris, 2);
  assert.equal(body.diimpor, 2, 'pratinjau melaporkan berapa yang AKAN diimpor');

  const item = await query(`SELECT id FROM item WHERE name = 'Latte Aren'`);
  assert.equal(item.length, 0, 'dryRun menulis item');
  const kategori = await query(`SELECT id FROM category WHERE name = 'Makanan'`);
  assert.equal(kategori.length, 0, 'dryRun menulis kategori');
});

test('impor sungguhan menulis item beserta variation-nya', async () => {
  const res = await impor({ csv: CSV, dryRun: false });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(JSON.parse(res.body).diimpor, 2);

  const item = await query(`SELECT id, name, category_id FROM item WHERE name = 'Latte Aren'`);
  assert.equal(item.length, 1);
  const v = await query(`SELECT price::text AS price FROM item_variation WHERE item_id = $1`, [item[0].id]);
  assert.equal(v.length, 1, 'item tanpa variation melanggar ITEM_NO_VARIATION');
  assert.equal(v[0].price, '25000', 'harga bergaya "25.000" harus jadi 25000');
});

test('⛔ kategori yang belum ada DIBUAT, dan item menunjuk ke sana', async () => {
  const res = await impor({ csv: CSV, dryRun: false });
  const body = JSON.parse(res.body);
  assert.deepEqual(body.kategoriBaru.sort(), ['Kopi Susu Kategori', 'Makanan']);

  const kategori = await query(`SELECT id, name FROM category WHERE name = 'Makanan'`);
  assert.equal(kategori.length, 1);
  const item = await query(`SELECT category_id FROM item WHERE name = 'Roti Bakar'`);
  assert.equal(item[0].category_id, kategori[0].id, 'item tidak menunjuk kategori yang dibuat');
});

test('⛔ kategori yang SUDAH ada dipakai ulang, tidak diduplikat', async () => {
  await impor({ csv: CSV, dryRun: false });
  const lagi = ['nama,kategori,harga', 'Teh Manis,Makanan,10000'].join('\n');
  const res = await impor({ csv: lagi, dryRun: false });

  assert.deepEqual(JSON.parse(res.body).kategoriBaru, [], 'kategori lama dilaporkan sebagai baru');
  const kategori = await query(`SELECT id FROM category WHERE name = 'Makanan'`);
  assert.equal(kategori.length, 1, 'kategori terduplikat');
});

test('⛔ nama yang SUDAH ADA di katalog dilewati, dan dilaporkan terpisah', async () => {
  await impor({ csv: CSV, dryRun: false });
  const res = await impor({ csv: CSV, dryRun: false, bilaSudahAda: 'lewati' });
  const body = JSON.parse(res.body);

  assert.equal(body.dilewati, 2);
  assert.equal(body.diimpor, 0);
  assert.deepEqual(body.masalah, [], 'dilewati BUKAN masalah');

  const item = await query(`SELECT id FROM item WHERE name = 'Latte Aren'`);
  assert.equal(item.length, 1, 'produk terduplikat');
});

test('⛔ jumlahBaris = diimpor + dilewati + masalah (spec-a:287)', async () => {
  const csv = [
    'nama,kategori,harga',
    'Kopi,Minuman,25000',
    ',Minuman,1000',
    'Roti,Makanan,abc',
    'Kopi,Minuman,9000',
  ].join('\n');
  const res = await impor({ csv, dryRun: false });
  const b = JSON.parse(res.body);

  assert.equal(b.diimpor + b.dilewati + b.masalah.length, b.jumlahBaris);
  assert.equal(b.jumlahBaris, 4);
});

test('baris bermasalah dilaporkan dengan NOMOR BARIS berkas', async () => {
  const csv = ['nama,kategori,harga', 'Kopi,Minuman,25000', ',Minuman,1000'].join('\n');
  const res = await impor({ csv, dryRun: false });
  const b = JSON.parse(res.body);

  assert.equal(b.masalah.length, 1);
  assert.equal(b.masalah[0].baris, 3);
  assert.match(b.masalah[0].alasan, /nama/i);
});

test('⛔ baris bermasalah TIDAK menghentikan baris yang sah', async () => {
  // `spec-a:267`: "baris bermasalah TIDAK diimpor diam-diam" — yang dilarang
  // adalah impor diam-diam, bukan impor sebagian yang DILAPORKAN. Menolak
  // seluruh berkas karena satu baris membuat merchant dengan 5.000 produk
  // tidak dapat pindah sama sekali.
  const csv = ['nama,kategori,harga', 'Kopi,Minuman,25000', 'Roti,Makanan,abc'].join('\n');
  const res = await impor({ csv, dryRun: false });
  assert.equal(JSON.parse(res.body).diimpor, 1);

  const item = await query(`SELECT name FROM item ORDER BY name`);
  assert.equal(item.some((i) => i.name === 'Kopi'), true);
  assert.equal(item.some((i) => i.name === 'Roti'), false);
});

test('⛔ impor tercatat di audit trail dengan JUMLAH BARIS (spec-a:290)', async () => {
  await impor({ csv: CSV, dryRun: false });
  const audit = await query(
    `SELECT event_type, actor_user_id, after FROM audit_event WHERE event_type = 'catalog_imported'`
  );
  assert.equal(audit.length, 1, 'impor tidak tercatat di audit');
  assert.equal(audit[0].actor_user_id, base.user.id);
  assert.equal(audit[0].after.diimpor, 2, 'jumlah baris tidak tercatat');
});

test('⛔ dryRun TIDAK menulis audit event', async () => {
  // Pratinjau bukan peristiwa. Mencatatnya membuat audit trail penuh baris
  // yang tidak mengubah apa pun, dan yang sungguhan tenggelam di antaranya.
  await impor({ csv: CSV });
  const audit = await query(`SELECT id FROM audit_event WHERE event_type = 'catalog_imported'`);
  assert.equal(audit.length, 0);
});

test('berkas tanpa kolom yang dikenal ditolak 400 dengan alasannya', async () => {
  const res = await impor({ csv: 'produk;kategori;harga\nKopi;Minuman;25000', dryRun: false });
  assert.equal(res.statusCode, 400, res.body);
  const b = JSON.parse(res.body);
  assert.equal(b.error.code, 'IMPORT_FILE_INVALID');
  assert.match(b.error.message, /kolom/i);
});

test('⛔ impor tenant lain tidak terlihat — nama yang sama tetap dapat diimpor', async () => {
  // RLS: "sudah ada di katalog" berarti ada di katalog TENANT INI.
  const lain = await seedTenantBase(appSetup, { suffix: 'ImportLain' });
  const resLain = await app.inject({
    method: 'POST',
    url: '/catalog/import',
    payload: { csv: CSV, dryRun: false },
    headers: {
      'x-tenant-id': lain.tenant.id,
      'x-actor-id': lain.user.id,
      'idempotency-key': crypto.randomUUID(),
    },
  });
  assert.equal(resLain.statusCode, 200, resLain.body);

  const res = await impor({ csv: CSV, dryRun: false });
  assert.equal(JSON.parse(res.body).diimpor, 2, 'katalog tenant lain memblokir impor tenant ini');
});

test('⛔ kontrak OpenAPI mendeklarasikan dryRun default TRUE', () => {
  // Ini penjaga pada lapisan yang BENAR-BENAR menegakkan bawaannya. Validator
  // OpenAPI mengisi `dryRun` sebelum handler berjalan; menghapus
  // `default: true` dari kontrak membuat impor berjalan SUNGGUHAN untuk klien
  // yang tidak mengirim field itu — dan katalog tidak pernah di-DELETE
  // (invariant #2), jadi produk yang salah masuk harus diarsipkan satu per
  // satu.
  //
  // Ditemukan lewat sabotase: mengubah default di handler saja tidak
  // menjatuhkan satu test pun, karena validator sudah mengisinya lebih dulu.
  const yaml = require('js-yaml');
  const { readFileSync } = require('node:fs');
  const { join } = require('node:path');
  const spec = yaml.load(
    readFileSync(join(__dirname, '..', '..', 'packages', 'contracts', 'openapi.yaml'), 'utf8')
  );
  const props =
    spec.paths['/catalog/import'].post.requestBody.content['application/json'].schema.properties;

  assert.equal(props.dryRun.default, true, 'dryRun harus BAWAAN true di kontrak');
  assert.equal(props.dryRun.type, 'boolean');
});
