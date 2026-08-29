'use strict';

// Tutup shift di server + B-04/B-05.
//
// ⛔ Yang paling penting di berkas ini: kasir A TIDAK boleh menutup shift
// kasir B. Shift memegang uang yang dipertanggungjawabkan satu orang, dan
// kasir yang dapat menutup shift rekannya dapat menyembunyikan selisihnya
// sendiri di sana.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');

let owner, db, app, base, tenant, outletId, device;

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

const hdr = (ubah = {}) => ({
  'x-tenant-id': tenant.id,
  authorization: base.authHeader,
  'x-actor-id': base.user.id,
  'content-type': 'application/json',
  ...ubah,
});

beforeEach(async () => {
  await db.query('ROLLBACK').catch(() => {});
  await resetAll(owner);
  base = await seedTenantBase(db, { suffix: 'ShiftTutup' });
  tenant = base.tenant;
  outletId = base.outlet.id;

  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();

  device = crypto.randomUUID();
  await db.query('BEGIN');
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await db.query(
    `INSERT INTO device (id, tenant_id, outlet_id, code, name, platform, app_version, schema_version)
     VALUES ($1,$2,$3,'K1','K1','tauri','0','1')`,
    [device, tenant.id, outletId]
  );
  await db.query('COMMIT');
});

/** Shift `open` milik `pemilik`, dengan `opening_float`. */
async function shift({ pemilik = null, saldoAwal = 100000, tanggal = '2026-08-10' } = {}) {
  const id = crypto.randomUUID();
  await db.query('BEGIN');
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await db.query(
    `INSERT INTO cash_drawer_shift (id, tenant_id, outlet_id, device_id, business_date, status, opening_float, opened_by)
     VALUES ($1,$2,$3,$4,$5,'open',$6,$7)`,
    [id, tenant.id, outletId, device, tanggal, saldoAwal, pemilik ?? base.user.id]
  );
  await db.query('COMMIT');
  return id;
}

/** Baris audit bertipe tertentu pada satu shift. */
async function auditRows(eventType, shiftId) {
  await db.query('BEGIN');
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  const r = await db.query(
    `SELECT actor_user_id, approver_user_id, reason_code, after
       FROM audit_event WHERE event_type = $1 AND entity_id = $2`,
    [eventType, shiftId]
  );
  await db.query('COMMIT');
  return r.rows;
}

/** Satu baris `cash_movement` pada shift. */
async function gerak(shiftId, { tipe = 'sale', delta = 50000, counterpart = 'sales_revenue' } = {}) {
  await db.query('BEGIN');
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await db.query(
    `INSERT INTO cash_movement (id, tenant_id, shift_id, type, delta, counterpart_type, created_by, hlc)
     VALUES ($1,$2,$3,$4,$5,$6,$7,1)`,
    [crypto.randomUUID(), tenant.id, shiftId, tipe, delta, counterpart, base.user.id]
  );
  await db.query('COMMIT');
}

const tutup = (shiftId, payload, ubah = {}) =>
  app.inject({
    method: 'POST',
    url: `/shifts/${shiftId}/close`,
    headers: hdr(ubah),
    payload,
  });

// ---------------------------------------------------------------------------
// Saldo dan selisih
// ---------------------------------------------------------------------------

test('shift tanpa selisih tertutup tanpa menuntut apa pun', async () => {
  const id = await shift({ saldoAwal: 100000 });
  await gerak(id, { delta: 50000 });

  const res = await tutup(id, { countedAmount: '150000' });
  assert.equal(res.statusCode, 200, res.body);
  const b = res.json();
  assert.equal(b.expectedAmount, '150000');
  assert.equal(b.difference, '0');
  assert.equal(b.butuhOtorisasi, false);
  assert.equal(b.status, 'closed');
});

test('⛔ opening_float TIDAK dijumlahkan dua kali', async () => {
  // Kalau ia ikut dijumlahkan dari `cash_movement`, setiap shift terlihat
  // kelebihan sebesar modalnya sendiri — dan itu cacat F3 yang sudah tercatat.
  const id = await shift({ saldoAwal: 100000 });
  await gerak(id, { tipe: 'opening_float', delta: 100000, counterpart: 'unidentified' });
  await gerak(id, { delta: 25000 });

  const b = (await tutup(id, { countedAmount: '125000' })).json();
  assert.equal(b.expectedAmount, '125000', 'modal awal dihitung dua kali');
  assert.equal(b.difference, '0');
});

test('⛔ refund tunai MENGURANGI saldo seharusnya', async () => {
  // Cacat F3: saldo yang dihitung dari `payment` membuat refund tunai tidak
  // pernah mengurangi laci, kasir terlihat kurang sebesar nilai refund, dan
  // tutup kasnya menuntut otorisasi untuk selisih yang tidak ada.
  const id = await shift({ saldoAwal: 100000 });
  await gerak(id, { delta: 50000 });
  await gerak(id, { tipe: 'refund', delta: -30000, counterpart: 'refund' });

  const b = (await tutup(id, { countedAmount: '120000' })).json();
  assert.equal(b.expectedAmount, '120000');
  assert.equal(b.difference, '0');
});

test('⛔ selisih KURANG di bawah ambang tidak menuntut otorisasi', async () => {
  const id = await shift({ saldoAwal: 100000 });
  const b = (await tutup(id, { countedAmount: '95000' })).json();
  assert.equal(b.difference, '-5000');
  assert.equal(b.butuhOtorisasi, false);
});

test('⛔ selisih di ambang PERSIS sudah menuntut otorisasi (inklusif)', async () => {
  const id = await shift({ saldoAwal: 100000 });
  const res = await tutup(id, { countedAmount: '80000' }); // selisih -20.000
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(res.json().error.code, 'VARIANCE_REASON_REQUIRED');
});

test('⛔ KELEBIHAN kas juga menuntut otorisasi', async () => {
  // Aturannya `Math.abs` — uang lebih juga harus dijelaskan.
  const id = await shift({ saldoAwal: 100000 });
  const res = await tutup(id, { countedAmount: '130000' });
  assert.equal(res.statusCode, 400, res.body);
});

test('selisih besar dengan alasan dan penyetuju berhasil', async () => {
  const id = await shift({ saldoAwal: 100000 });
  const res = await tutup(
    id,
    { countedAmount: '50000', varianceReasonCode: 'kesalahan_hitung', varianceNote: 'Dihitung ulang' },
    { 'x-approver-id': base.user2.id }
  );
  assert.equal(res.statusCode, 200, res.body);
  const b = res.json();
  assert.equal(b.difference, '-50000');
  assert.equal(b.butuhOtorisasi, true);
  assert.equal(b.approvedBy, base.user2.id);
});

test('⛔ selisih yang disetujui menulis cash_variance_approved TERSENDIRI', async () => {
  // FR-F6 + `spec-f:293`. Peristiwa tersendiri, bukan `approver_user_id` yang
  // kadang terisi pada `shift_closed`: laporan "siapa menyetujui selisih kas
  // siapa" harus dapat dijawab dengan menyaring satu jenis peristiwa, tanpa
  // pembacanya perlu tahu bahwa satu kolom bermakna berbeda tergantung jenis
  // barisnya.
  const id = await shift({ saldoAwal: 100000 });
  const res = await tutup(
    id,
    { countedAmount: '50000', varianceReasonCode: 'kesalahan_hitung' },
    { 'x-approver-id': base.user2.id }
  );
  assert.equal(res.statusCode, 200, res.body);

  const rows = await auditRows('cash_variance_approved', id);
  assert.equal(rows.length, 1);
  // ⛔ DUA identitas, dan keduanya berbeda (FR-F7). CHECK di database
  // menegakkannya juga.
  assert.equal(rows[0].actor_user_id, base.user.id);
  assert.equal(rows[0].approver_user_id, base.user2.id);
  assert.notEqual(rows[0].actor_user_id, rows[0].approver_user_id);
  assert.equal(rows[0].reason_code, 'kesalahan_hitung');
  assert.equal(rows[0].after.difference, '-50000');
});

test('⛔ selisih DI BAWAH ambang tidak menulis cash_variance_approved', async () => {
  // Peristiwa yang menyala untuk penutupan yang tidak menuntut siapa pun
  // membuat laporan persetujuan penuh baris yang tidak ada persetujuannya.
  const id = await shift({ saldoAwal: 100000 });
  assert.equal((await tutup(id, { countedAmount: '100000' })).statusCode, 200);
  assert.equal((await auditRows('cash_variance_approved', id)).length, 0);
});

test('⛔ penyetuju TIDAK boleh orang yang sama dengan yang menghitung', async () => {
  const id = await shift({ saldoAwal: 100000 });
  const res = await tutup(
    id,
    { countedAmount: '50000', varianceReasonCode: 'kesalahan_hitung' },
    { 'x-approver-id': base.user.id }
  );
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(res.json().error.code, 'APPROVER_SAME_AS_ACTOR');
});

test('alasan tanpa penyetuju ditolak', async () => {
  const id = await shift({ saldoAwal: 100000 });
  const res = await tutup(id, { countedAmount: '50000', varianceReasonCode: 'kesalahan_hitung' });
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(res.json().error.code, 'APPROVER_REQUIRED');
});

// ---------------------------------------------------------------------------
// ⛔ Otorisasi: kasir A vs shift kasir B
// ---------------------------------------------------------------------------

test('⛔ KASIR TIDAK DAPAT MENUTUP SHIFT KASIR LAIN', async () => {
  // Skenario yang diminta. Shift memegang uang yang dipertanggungjawabkan satu
  // orang; kasir yang dapat menutup shift rekannya dapat menyembunyikan
  // selisihnya sendiri di sana.
  const shiftOrangLain = await shift({ pemilik: base.user2.id, saldoAwal: 100000 });

  // Aktor dijadikan kasir MURNI — tanpa peran manajer.
  await db.query('BEGIN');
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await db.query(`DELETE FROM user_role WHERE user_id = $1 AND role <> 'cashier'`, [base.user.id]);
  await db.query('COMMIT');

  const res = await tutup(shiftOrangLain, { countedAmount: '100000' });
  assert.equal(res.statusCode, 403, res.body);
  assert.match(res.json().error.message, /kasir yang membuka shift ini atau manajer/i);

  // Dan shiftnya benar-benar tidak berubah.
  await db.query('BEGIN');
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  const cek = await db.query('SELECT status, closed_at FROM cash_drawer_shift WHERE id = $1', [
    shiftOrangLain,
  ]);
  await db.query('COMMIT');
  assert.equal(cek.rows[0].status, 'open', 'shift tertutup walau ditolak');
  assert.equal(cek.rows[0].closed_at, null);
});

test('kasir DAPAT menutup shiftnya SENDIRI', async () => {
  // Sisi lain aturan yang sama — kalau ini gagal, jalur normalnya patah.
  const id = await shift({ pemilik: base.user.id, saldoAwal: 100000 });
  await db.query('BEGIN');
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await db.query(`DELETE FROM user_role WHERE user_id = $1 AND role <> 'cashier'`, [base.user.id]);
  await db.query('COMMIT');

  const res = await tutup(id, { countedAmount: '100000' });
  assert.equal(res.statusCode, 200, res.body);
});

test('MANAJER dapat menutup shift kasir lain', async () => {
  // `base.user` menyandang owner di seed — ia manajer untuk aturan ini.
  const id = await shift({ pemilik: base.user2.id, saldoAwal: 100000 });
  const res = await tutup(id, { countedAmount: '100000' });
  assert.equal(res.statusCode, 200, res.body);
});

// ---------------------------------------------------------------------------
// Keadaan dan validasi
// ---------------------------------------------------------------------------

test('⛔ shift yang sudah tertutup ditolak 409', async () => {
  const id = await shift({ saldoAwal: 100000 });
  assert.equal((await tutup(id, { countedAmount: '100000' })).statusCode, 200);
  const dua = await tutup(id, { countedAmount: '100000' });
  assert.equal(dua.statusCode, 409, dua.body);
});

test('hitungan negatif ditolak — laci tidak dapat berisi uang minus', async () => {
  const id = await shift({ saldoAwal: 100000 });
  const res = await tutup(id, { countedAmount: '-1' });
  assert.equal(res.statusCode, 400, res.body);
});

test('hitungan cacat ditolak', async () => {
  const id = await shift({ saldoAwal: 100000 });
  for (const n of ['', 'seratus', '1.5']) {
    assert.equal((await tutup(id, { countedAmount: n })).statusCode, 400, `"${n}" diterima`);
  }
});

test('⛔ shift tenant lain menjawab 404', async () => {
  const lain = await seedTenantBase(db, { suffix: 'ShiftLain' });
  const id = await shift({ saldoAwal: 100000 });
  const res = await app.inject({
    method: 'POST',
    url: `/shifts/${id}/close`,
    headers: {
      'x-tenant-id': lain.tenant.id,
      authorization: lain.authHeader,
      'x-actor-id': lain.user.id,
      'content-type': 'application/json',
    },
    payload: { countedAmount: '100000' },
  });
  assert.equal(res.statusCode, 404, res.body);
});

test('audit event shift_closed dipancarkan dengan uang sebagai STRING', async () => {
  const id = await shift({ saldoAwal: 100000 });
  await tutup(id, { countedAmount: '100000' });

  await db.query('BEGIN');
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  const r = await db.query(
    `SELECT after FROM audit_event WHERE event_type = 'shift_closed' AND entity_id = $1`,
    [id]
  );
  await db.query('COMMIT');
  assert.equal(r.rows.length, 1);
  assert.equal(typeof r.rows[0].after.countedAmount, 'string');
});

test('percobaan hitungan TERCATAT, dengan jam database', async () => {
  const id = await shift({ saldoAwal: 100000 });
  const b = (await tutup(id, { countedAmount: '100000' })).json();
  assert.equal(b.jumlahPercobaan, 1);

  await db.query('BEGIN');
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  const r = await db.query('SELECT count_attempts FROM cash_drawer_shift WHERE id = $1', [id]);
  await db.query('COMMIT');
  const p = r.rows[0].count_attempts[0];
  assert.equal(p.hitungan, '100000');
  // ⛔ Jamnya dari database. Versi pertama mengisinya dari Node lalu berniat
  // "diperbaiki SQL" — jsonb tidak menstempel dirinya sendiri, dan hasilnya
  // waktu palsu yang terlihat sah.
  assert.notEqual(p.pada, null);
  assert.ok(!Number.isNaN(Date.parse(p.pada)), `waktu percobaan tidak sah: ${p.pada}`);
});

// ---------------------------------------------------------------------------
// B-04 & B-05
// ---------------------------------------------------------------------------

const daftar = (q = 'from=2026-08-01&to=2026-08-31') =>
  app.inject({ method: 'GET', url: `/reports/shifts?${q}`, headers: hdr() });
const detail = (id) =>
  app.inject({ method: 'GET', url: `/reports/shifts/${id}`, headers: hdr() });

test('B-04 hanya menampilkan shift TERTUTUP secara bawaan', async () => {
  const tertutup = await shift({ saldoAwal: 100000 });
  await tutup(tertutup, { countedAmount: '100000' });
  await shift({ saldoAwal: 50000 }); // masih terbuka

  const items = (await daftar()).json().items;
  assert.equal(items.length, 1);
  assert.equal(items[0].id, tertutup);
  assert.equal(items[0].status, 'closed');
});

test('include_open menyertakan shift berjalan, dengan angka NULL', async () => {
  // ⛔ `null`, bukan `'0'`. `'0'` terbaca sebagai "sudah dihitung, hasilnya
  // nol" — pernyataan yang salah, bukan kosong.
  await shift({ saldoAwal: 50000 });
  const items = (await daftar('from=2026-08-01&to=2026-08-31&include_open=true')).json().items;
  const terbuka = items.find((s) => s.status === 'open');
  assert.notEqual(terbuka, undefined);
  assert.equal(terbuka.countedAmount, null);
  assert.equal(terbuka.difference, null);
});

test('B-04 membawa NAMA kasir, bukan hanya id', async () => {
  const id = await shift({ saldoAwal: 100000 });
  await tutup(id, { countedAmount: '100000' });
  const b = (await daftar()).json().items[0];
  assert.equal(b.openedByNama, base.user.name);
  assert.notEqual(b.openedByNama, b.openedBy);
});

test('⛔ B-05 merinci pembayaran per metode — hanya yang confirmed', async () => {
  const id = await shift({ saldoAwal: 100000 });

  // Satu order berbayar tunai (confirmed) + satu QRIS pending.
  const orderId = crypto.randomUUID();
  const checkId = crypto.randomUUID();
  await db.query('BEGIN');
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await db.query(
    `INSERT INTO "order" (id,tenant_id,outlet_id,device_id,shift_id,receipt_number,business_date,sequence,
       status,channel,subtotal,total,amount_due,created_by,occurred_at,hlc)
     VALUES ($1,$2,$3,$4,$5,'K1-1','2026-08-10',1,'closed','takeaway',80000,80000,80000,$6,now(),1)`,
    [orderId, tenant.id, outletId, device, id, base.user.id]
  );
  await db.query(
    `INSERT INTO "check" (id,tenant_id,order_id,subtotal,total) VALUES ($1,$2,$3,80000,80000)`,
    [checkId, tenant.id, orderId]
  );
  for (const [method, amount, status] of [
    ['cash', 50000, 'confirmed'],
    ['qris_dynamic', 30000, 'confirmed'],
    ['qris_dynamic', 99000, 'pending_confirmation'],
  ]) {
    await db.query(
      `INSERT INTO payment (id,tenant_id,outlet_id,device_id,order_id,check_id,method,amount,status,
         occurred_at,tendered_at,hlc,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),now(),1,$10)`,
      [crypto.randomUUID(), tenant.id, outletId, device, orderId, checkId, method, amount, status, base.user.id]
    );
  }
  await db.query('COMMIT');

  await tutup(id, { countedAmount: '100000' });
  const d = (await detail(id)).json();

  assert.equal(d.totalDiterima, '80000', 'pembayaran pending ikut dijumlahkan');
  const metode = Object.fromEntries(d.perMetode.map((m) => [m.method, m.total]));
  assert.equal(metode.cash, '50000');
  assert.equal(metode.qris_dynamic, '30000');
});

test('B-05 memuat gerakan kas NON-penjualan', async () => {
  const id = await shift({ saldoAwal: 100000 });
  await gerak(id, { delta: 50000 }); // sale — tidak muncul di gerakanKas
  await gerak(id, { tipe: 'bank_deposit', delta: -70000, counterpart: 'bank' });
  await tutup(id, { countedAmount: '80000' });

  const d = (await detail(id)).json();
  assert.equal(d.gerakanKas.length, 1);
  assert.equal(d.gerakanKas[0].type, 'bank_deposit');
  assert.equal(d.gerakanKas[0].delta, '-70000');
});

test('⛔ B-05 shift tenant lain menjawab 404', async () => {
  const id = await shift({ saldoAwal: 100000 });
  const lain = await seedTenantBase(db, { suffix: 'ShiftDetailLain' });
  const res = await app.inject({
    method: 'GET',
    url: `/reports/shifts/${id}`,
    headers: {
      'x-tenant-id': lain.tenant.id,
      authorization: lain.authHeader,
      'x-actor-id': lain.user.id,
    },
  });
  assert.equal(res.statusCode, 404, res.body);
});

test('⛔ ambang selisih SATU nilai, dibagi server dan perangkat', async () => {
  // Dua salinan angka yang sama akan menyimpang, dan bentuk penyimpangannya
  // buruk: perangkat menuntut otorisasi untuk selisih yang server terima
  // diam-diam, pada shift yang sama.
  const { AMBANG_SELISIH } = await import('../../packages/domain/src/buku-kas.ts');
  const { AMBANG_SELISIH: dariKasir } = await import('../../apps/kasir/src/kas/tutup.ts');
  assert.equal(dariKasir, AMBANG_SELISIH);
  assert.equal(AMBANG_SELISIH, 20000);
});

// ---------------------------------------------------------------------------
// FR-D2 — percobaan hitungan kas, jalur tulis TERSENDIRI
// ---------------------------------------------------------------------------

async function kueri(sql, params) {
  await db.query('BEGIN');
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  try {
    const { rows } = await db.query(sql, params);
    await db.query('COMMIT');
    return rows;
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  }
}

const percobaan = (shiftId, payload = {}, ubah = {}) =>
  app.inject({
    method: 'POST',
    url: `/shifts/${shiftId}/count-attempts`,
    headers: hdr({ 'idempotency-key': crypto.randomUUID(), ...ubah }),
    payload: {
      id: crypto.randomUUID(),
      countedAmount: '2450000',
      attemptNumber: 1,
      ...payload,
    },
  });

test('⛔ percobaan hitungan tercatat di audit, dengan angka dan urutannya', async () => {
  const id = await shift({ saldoAwal: 100000 });
  const res = await percobaan(id, { countedAmount: '2450000', attemptNumber: 1 });
  assert.equal(res.statusCode, 201, res.body);

  // ⛔ Disaring per `event_type`, bukan menghitung SELURUH baris tabel.
  const [row] = await kueri(
    `SELECT actor_user_id, entity_type, entity_id, after FROM audit_event
      WHERE event_type = 'shift_count_attempt' AND entity_id = $1`,
    [id]
  );
  assert.ok(row, 'shift_count_attempt tidak dipancarkan');
  assert.equal(row.entity_type, 'cash_drawer_shift');
  assert.equal(row.after.countedAmount, '2450000');
  assert.equal(row.after.attemptNumber, 1);
});

test('⛔ endpoint TIDAK menyentuh cash_drawer_shift sama sekali', async () => {
  // Endpoint yang menulis percobaan DAN memperbarui shift akan menjadi jalan
  // kedua menuju penutupan — tanpa pemeriksaan ambang, tanpa penyetuju, tanpa
  // buku kas. Yang ditulis di sini hanya JEJAK.
  const id = await shift({ saldoAwal: 100000 });
  const [sebelum] = await kueri(
    `SELECT status, counted_amount, expected_amount, closed_at FROM cash_drawer_shift WHERE id = $1`,
    [id]
  );
  await percobaan(id, { countedAmount: '9999999' });
  const [sesudah] = await kueri(
    `SELECT status, counted_amount, expected_amount, closed_at FROM cash_drawer_shift WHERE id = $1`,
    [id]
  );
  assert.deepEqual(sesudah, sebelum, 'shift tidak boleh berubah sama sekali');
});

test('⛔ percobaan BERTAHAN meski penutupan berikutnya DITOLAK', async () => {
  // Inti FR-D2. Kasir mencoba Rp 2.450.000, melihat selisihnya melewati
  // ambang, lalu mengetik angka yang cocok. Tanpa jalur tulis tersendiri,
  // percobaan pertama tidak meninggalkan jejak apa pun — dan justru itulah
  // yang `spec-d:127` ingin buktikan tidak dapat diulang diam-diam.
  const id = await shift({ saldoAwal: 100000 });
  await percobaan(id, { countedAmount: '50000', attemptNumber: 1 });

  // Penutupan dengan selisih besar tanpa alasan → DITOLAK, transaksi rollback.
  const tolak = await tutup(id, { countedAmount: '50000' });
  assert.equal(tolak.statusCode, 400, tolak.body);

  const jejak = await kueri(
    `SELECT after FROM audit_event WHERE event_type = 'shift_count_attempt' AND entity_id = $1`,
    [id]
  );
  assert.equal(jejak.length, 1, 'jejak percobaan hilang bersama rollback penutupan');
  assert.equal(jejak[0].after.countedAmount, '50000');
});

test('percobaan KEDUA tercatat terpisah — riwayatnya utuh', async () => {
  const id = await shift({ saldoAwal: 100000 });
  await percobaan(id, { countedAmount: '2450000', attemptNumber: 1 });
  await percobaan(id, { countedAmount: '2485000', attemptNumber: 2 });

  const jejak = await kueri(
    `SELECT after FROM audit_event WHERE event_type = 'shift_count_attempt' AND entity_id = $1
      ORDER BY (after->>'attemptNumber')::int`,
    [id]
  );
  assert.equal(jejak.length, 2);
  assert.equal(jejak[0].after.countedAmount, '2450000');
  assert.equal(jejak[1].after.countedAmount, '2485000');
});

test('⛔ shift yang SUDAH TERTUTUP tetap menerima percobaan', async () => {
  // Yang dikirim terlambat — perangkat yang antreannya baru terkuras — adalah
  // jejak dari SEBELUM penutupan. Menolaknya menghapus jejak justru pada
  // perangkat yang paling lama offline.
  const id = await shift({ saldoAwal: 100000 });
  assert.equal((await tutup(id, { countedAmount: '100000' })).statusCode, 200);

  const res = await percobaan(id, { countedAmount: '100000', attemptNumber: 1 });
  assert.equal(res.statusCode, 201, res.body);
});

test('muatan cacat ditolak sebelum menulis apa pun', async () => {
  // ⛔ `countedAmount: 2450000` (NUMBER) TIDAK ada di daftar ini, dan itu
  // batas yang dinyatakan: koersi AJV mengubahnya menjadi string `"2450000"`
  // sebelum handler melihatnya. Kontrak bertipe string tidak dapat menolak
  // `number` di handler — kelas yang sama dengan temuan ambang otorisasi
  // (`number` → `string`) dan telemetri (`null` → `0`).
  //
  // Yang MASIH dapat dijaga adalah nilainya: pecahan dan tanda negatif
  // menghasilkan string yang gagal regex, dan itu yang diuji di bawah.
  const id = await shift({ saldoAwal: 100000 });
  for (const p of [
    { countedAmount: '-100' },
    { countedAmount: '24.5' },
    { attemptNumber: 0 },
    { attemptNumber: 'satu' },
    { id: '' },
  ]) {
    const res = await percobaan(id, p);
    assert.equal(res.statusCode, 400, `${JSON.stringify(p)}: ${res.body}`);
  }
  const jejak = await kueri(
    `SELECT id FROM audit_event WHERE event_type = 'shift_count_attempt' AND entity_id = $1`,
    [id]
  );
  assert.equal(jejak.length, 0);
});

test('shift milik tenant lain dijawab 404', async () => {
  const res = await percobaan(crypto.randomUUID());
  assert.equal(res.statusCode, 404, res.body);
});
