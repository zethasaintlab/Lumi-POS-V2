'use strict';

// B-03 — `GET /reports/transactions/{order_id}`, modul `reporting`.
//
// ⛔ Integrasi atas PostgreSQL sungguhan, dan di sini itu bukan pilihan:
// yang diuji justru penggabungan LINTAS MODUL — order, order_line, payment,
// refund, dan "user" sekaligus. Fake apa pun akan memakai asumsi saya sendiri
// tentang bentuk sambungannya.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');

let owner, db, app, base, tenant, device, shift;

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
  base = await seedTenantBase(db, { suffix: 'DetailTx' });
  tenant = base.tenant;

  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();

  device = crypto.randomUUID();
  shift = crypto.randomUUID();
  await db.query('BEGIN');
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await db.query(
    `INSERT INTO device (id, tenant_id, outlet_id, code, name, platform, app_version, schema_version)
     VALUES ($1,$2,$3,'K1','K1','tauri','0','1')`,
    [device, tenant.id, base.outlet.id]
  );
  await db.query(
    `INSERT INTO cash_drawer_shift (id, tenant_id, outlet_id, device_id, business_date, status, opening_float, opened_by)
     VALUES ($1,$2,$3,$4,'2026-08-10','open',0,$5)`,
    [shift, tenant.id, base.outlet.id, device, base.user.id]
  );
  await db.query('COMMIT');
});

let n = 0;

/** Satu order + check + satu baris. Mengembalikan idnya. */
async function transaksi({ total = 100000, status = 'closed', qty = 1000 } = {}) {
  const id = crypto.randomUUID();
  const checkId = `c-${id}`;
  const lineId = crypto.randomUUID();
  n += 1;
  await db.query('BEGIN');
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await db.query(
    `INSERT INTO "order" (id,tenant_id,outlet_id,device_id,shift_id,receipt_number,business_date,sequence,
       status,channel,subtotal,tax_amount,total,amount_due,created_by,occurred_at,hlc)
     VALUES ($1,$2,$3,$4,$5,$6,'2026-08-10',$7::int,$8,'takeaway',$9,0,$9,$9,$10,
             timestamptz '2026-08-10 10:00:00+00',$7::bigint)`,
    [id, tenant.id, base.outlet.id, device, shift, `K1-20260810-${n}`, n, status, total, base.user.id]
  );
  await db.query(
    `INSERT INTO "check" (id,tenant_id,order_id,subtotal,total) VALUES ($1,$2,$3,$4,$4)`,
    [checkId, tenant.id, id, total]
  );
  await db.query(
    `INSERT INTO order_line (id,tenant_id,outlet_id,device_id,order_id,check_id,variation_id,item_name,
       variation_name,unit_price,quantity,line_total,created_by,occurred_at,hlc)
     VALUES ($1,$2,$3,$4,$5,$6,'v1','Kopi Susu','Regular',$7,$8::bigint,$7,$9,
             timestamptz '2026-08-10 10:00:00+00',$10::bigint)`,
    [lineId, tenant.id, base.outlet.id, device, id, checkId, total, qty, base.user.id, n]
  );
  await db.query('COMMIT');
  return { id, checkId, lineId };
}

async function bayar(t, { amount = 100000, tendered = 100000, change = 0, status = 'confirmed', method = 'cash' } = {}) {
  await db.query('BEGIN');
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await db.query(
    `INSERT INTO payment (id,tenant_id,outlet_id,device_id,order_id,check_id,method,amount,
       tendered_amount,change_amount,status,occurred_at,tendered_at,hlc,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
             timestamptz '2026-08-10 10:05:00+00',timestamptz '2026-08-10 10:05:00+00',1,$12)`,
    [crypto.randomUUID(), tenant.id, base.outlet.id, device, t.id, t.checkId, method,
     amount, tendered, change, status, base.user.id]
  );
  await db.query('COMMIT');
}

const hdr = () => ({
  'x-tenant-id': tenant.id,
  authorization: base.authHeader,
  'x-actor-id': base.user.id,
});

const minta = (id) =>
  app.inject({ method: 'GET', url: `/reports/transactions/${id}`, headers: hdr() });

// ---------------------------------------------------------------------------
// Penggabungan lintas modul
// ---------------------------------------------------------------------------

test('menggabungkan order, baris, pembayaran, dan NAMA kasir', async () => {
  const t = await transaksi({ total: 125000 });
  await bayar(t, { amount: 125000, tendered: 150000, change: 25000 });

  const res = await minta(t.id);
  assert.equal(res.statusCode, 200, res.body);
  const d = res.json();

  assert.equal(d.receiptNumber.startsWith('K1-'), true);
  assert.equal(d.businessDate, '2026-08-10');
  // ⛔ Nama, bukan id — inti alasan modul ini ada.
  assert.equal(d.createdByNama, base.user.name);
  assert.notEqual(d.createdByNama, d.createdBy);
  assert.equal(d.lines.length, 1);
  assert.equal(d.lines[0].itemName, 'Kopi Susu');
  assert.equal(d.payments.length, 1);
  assert.equal(d.payments[0].method, 'cash');
  assert.equal(d.payments[0].tenderedAmount, '150000');
  assert.equal(d.payments[0].changeAmount, '25000');
  assert.equal(d.totalDibayar, '125000');
});

test('⛔ SELURUH uang keluar sebagai STRING', async () => {
  const t = await transaksi({ total: '9007199254740993' });
  await bayar(t, { amount: '9007199254740993', tendered: '9007199254740993', change: 0 });

  const d = (await minta(t.id)).json();
  assert.equal(d.total, '9007199254740993', 'presisi total hilang');
  assert.equal(d.payments[0].amount, '9007199254740993', 'presisi pembayaran hilang');
  assert.equal(d.totalDibayar, '9007199254740993', 'presisi penjumlahan hilang');
});

test('⛔ tenderedAmount null DIPERTAHANKAN untuk metode non-tunai', async () => {
  // "Tunai diterima: Rp 0" adalah pernyataan yang SALAH untuk QRIS — bukan
  // sekadar kosong. Menjadikannya '0' membuat layar berbohong.
  const t = await transaksi({ total: 50000 });
  await bayar(t, { amount: 50000, tendered: null, change: null, method: 'qris_dynamic' });

  const d = (await minta(t.id)).json();
  assert.equal(d.payments[0].tenderedAmount, null);
  assert.equal(d.payments[0].changeAmount, null);
});

test('⛔ hanya pembayaran CONFIRMED yang dijumlahkan', async () => {
  // `spec-c:223`. QRIS yang masih menunggu konfirmasi bukan uang yang diterima.
  const t = await transaksi({ total: 100000 });
  await bayar(t, { amount: 60000, status: 'confirmed' });
  await bayar(t, { amount: 40000, status: 'pending_confirmation', method: 'qris_dynamic' });

  const d = (await minta(t.id)).json();
  assert.equal(d.payments.length, 2, 'pembayaran pending harus tetap TERLIHAT');
  assert.equal(d.totalDibayar, '60000', 'pembayaran pending ikut dijumlahkan');
});

test('modifier ikut pada barisnya', async () => {
  const t = await transaksi({ total: 30000 });
  await db.query('BEGIN');
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await db.query(
    `INSERT INTO order_line_modifier (id,tenant_id,order_line_id,name,price,quantity)
     VALUES ($1,$2,$3,'Extra shot',5000,1000)`,
    [crypto.randomUUID(), tenant.id, t.lineId]
  );
  await db.query('COMMIT');

  const d = (await minta(t.id)).json();
  assert.equal(d.lines[0].modifiers.length, 1);
  assert.equal(d.lines[0].modifiers[0].name, 'Extra shot');
  assert.equal(d.lines[0].modifiers[0].price, '5000');
});

test('refund muncul beserta nama pembuat dan penyetujunya', async () => {
  const t = await transaksi({ total: 100000 });
  await bayar(t, { amount: 100000 });
  await db.query('BEGIN');
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await db.query(
    `INSERT INTO refund (id,tenant_id,order_id,amount,reason_code,created_by,approved_by,hlc,method)
     VALUES ($1,$2,$3,40000,'barang_rusak',$4,$5,1,'cash')`,
    [crypto.randomUUID(), tenant.id, t.id, base.user.id, base.user2.id]
  );
  await db.query('COMMIT');

  const d = (await minta(t.id)).json();
  assert.equal(d.refunds.length, 1);
  assert.equal(d.refunds[0].amount, '40000');
  assert.equal(d.refunds[0].createdByNama, base.user.name);
  assert.equal(d.refunds[0].approvedByNama, base.user2.name);
  assert.equal(d.totalRefund, '40000');
});

test('⛔ transaksi yang dibatalkan membawa penunjuk ke pembatalnya', async () => {
  // Order asli tetap `status = open` (AC FR-B7). Tanpa penunjuk ini, layar
  // detail tidak dapat membedakan penjualan yang dibatalkan dari keranjang
  // yang belum dibayar.
  const asli = await transaksi({ total: 25000, status: 'open' });
  const pembatal = await transaksi({ total: 25000, status: 'voided' });
  await db.query('BEGIN');
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await db.query(`UPDATE "order" SET voided_by_order_id = $1 WHERE id = $2`, [asli.id, pembatal.id]);
  await db.query('COMMIT');

  const d = (await minta(asli.id)).json();
  assert.equal(d.dibatalkanOleh, pembatal.id);
  assert.notEqual(d.dibatalkanPada, null);
});

test('transaksi tanpa pembayaran tetap dapat dibuka', async () => {
  const t = await transaksi({ total: 25000, status: 'open' });
  const d = (await minta(t.id)).json();
  assert.deepEqual(d.payments, []);
  assert.equal(d.totalDibayar, '0');
});

// ---------------------------------------------------------------------------
// Kuantitas
// ---------------------------------------------------------------------------

test('⛔ kuantitas x1000 tidak dibagi di SQL', async () => {
  // `quantity / 1000` di PostgreSQL atas kolom bigint adalah pembagian
  // INTEGER: `2500` menjadi `2`, dan setengah kilogram menghilang tanpa error.
  const t = await transaksi({ total: 50000, qty: 2500 });
  const d = (await minta(t.id)).json();
  assert.equal(d.lines[0].quantityMilli, 2500);
});

test('kuantitasTampil membuat x1000 terbaca manusia', async () => {
  const { kuantitasTampil } = await import(
    '../../apps/server/src/modules/reporting/handlers/detail-transaksi.ts'
  );
  assert.equal(kuantitasTampil(1000), '1');
  assert.equal(kuantitasTampil(2500), '2,5');
  assert.equal(kuantitasTampil(500), '0,5');
  assert.equal(kuantitasTampil(3000), '3');
});

// ---------------------------------------------------------------------------
// ⛔ Akses dan isolasi
// ---------------------------------------------------------------------------

test('⛔ transaksi tenant lain menjawab 404 dengan pesan yang SAMA', async () => {
  // Membedakan "tidak ada" dari "milik orang lain" memberi tahu penyerang
  // bahwa id yang ia tebak benar-benar ada di suatu tempat.
  const t = await transaksi({ total: 10000 });
  const lain = await seedTenantBase(db, { suffix: 'DetailLain' });

  const resLain = await app.inject({
    method: 'GET',
    url: `/reports/transactions/${t.id}`,
    headers: {
      'x-tenant-id': lain.tenant.id,
      authorization: lain.authHeader,
      'x-actor-id': lain.user.id,
    },
  });
  const resHantu = await minta(crypto.randomUUID());

  assert.equal(resLain.statusCode, 404, resLain.body);
  assert.equal(resHantu.statusCode, 404, resHantu.body);
  assert.equal(resLain.json().error.code, resHantu.json().error.code);
});

test('⛔ tanpa sesi ditolak 401', async () => {
  const t = await transaksi({});
  const res = await app.inject({
    method: 'GET',
    url: `/reports/transactions/${t.id}`,
    headers: { 'x-tenant-id': tenant.id },
  });
  assert.equal(res.statusCode, 401, res.body);
});

// ---------------------------------------------------------------------------
// ⛔ Batas modul
// ---------------------------------------------------------------------------

const AKAR = join(__dirname, '..', '..');
const REPORTING = join(AKAR, 'apps', 'server', 'src', 'modules', 'reporting');

test('⛔ modul reporting TIDAK menulis apa pun', async () => {
  // Izin membaca lintas domain aman justru karena modul ini tidak memiliki
  // tabel dan tidak menulis. Agregator yang boleh menulis menjadi jalan pintas
  // kedua ke setiap tabel di sistem, dan invariant #1 tidak lagi punya satu
  // pintu.
  const { readdirSync, statSync } = require('node:fs');
  const berkas = [];
  const telusuri = (d) => {
    for (const nama of readdirSync(d)) {
      const p = join(d, nama);
      if (statSync(p).isDirectory()) telusuri(p);
      else if (/\.ts$/.test(nama)) berkas.push(p);
    }
  };
  telusuri(REPORTING);
  assert.ok(berkas.length >= 2, `hanya ${berkas.length} berkas terpindai`);

  for (const f of berkas) {
    const isi = readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '')
      .replace(/^\s*--.*$/gm, '');
    for (const pola of [/\bINSERT\s+INTO\b/i, /\bUPDATE\s+"?\w/i, /\bDELETE\s+FROM\b/i]) {
      assert.doesNotMatch(isi, pola, `modul reporting menulis di ${f}`);
    }
  }
});

test('⛔ ordering TETAP tidak boleh menjangkau payment atau user', async () => {
  // Izin lintas domain berhenti di `reporting`. Test ini ada di sini supaya
  // orang yang menambah JOIN ke `ordering` "karena reporting boleh" mendapat
  // jawabannya di tempat yang sama dengan izinnya.
  const f = join(AKAR, 'apps', 'server', 'src', 'modules', 'ordering', 'handlers', 'riwayat-data.ts');
  const sql = readFileSync(f, 'utf8')
    .replace(/^\s*\*.*$/gm, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/--.*$/gm, '');
  for (const tabel of ['payment', 'audit_event', '"user"']) {
    assert.doesNotMatch(sql, new RegExp(`(FROM|JOIN)\\s+${tabel}\\b`, 'i'), `ordering menjangkau ${tabel}`);
  }
});
