'use strict';

// FR-D5 — kas masuk & kas keluar di server
// (`POST /shifts/{shiftId}/cash-movements`).
//
// ⛔ Yang paling penting diuji: barisnya benar-benar menggerakkan
// `saldoSeharusnya`. Endpoint yang menulis `cash_movement` dengan `delta` nol,
// bertanda terbalik, atau bertipe yang `saldoSeharusnya` kecualikan akan lulus
// setiap test yang hanya memeriksa bahwa barisnya ada — dan tutup kas tetap
// melaporkan selisih yang fitur ini justru ada untuk menghapusnya.

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
  base = await seedTenantBase(db, { suffix: 'KasManual' });
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

async function shift({ status = 'open', openingFloat = 100000 } = {}) {
  const id = crypto.randomUUID();
  await db.query('BEGIN');
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await db.query(
    `INSERT INTO cash_drawer_shift (id, tenant_id, outlet_id, device_id, business_date, status, opening_float, opened_by)
     VALUES ($1,$2,$3,$4,'2026-08-24',$5,$6,$7)`,
    [id, tenant.id, outletId, device, status, openingFloat, base.user.id]
  );
  await db.query('COMMIT');
  return id;
}

const kas = (shiftId, payload = {}, ubah = {}, key = crypto.randomUUID()) =>
  app.inject({
    method: 'POST',
    url: `/shifts/${shiftId}/cash-movements`,
    headers: { 'idempotency-key': key, ...hdr(ubah) },
    payload: {
      id: crypto.randomUUID(),
      arah: 'keluar',
      jumlah: '50000',
      reasonCode: 'bayar_pemasok',
      ...payload,
    },
  });

async function query(sql, params) {
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

// ---------------------------------------------------------------------------

test('kas keluar menulis cash_movement bertanda NEGATIF dengan counterpart dari alasannya', async () => {
  const id = await shift();
  const res = await kas(id, { reasonCode: 'ambil_pemilik', jumlah: '500000' });
  assert.equal(res.statusCode, 201, res.body);
  const body = JSON.parse(res.body);
  assert.equal(body.delta, '-500000');
  assert.equal(body.counterpartType, 'owner_draw');

  const [row] = await query(
    `SELECT type, delta, counterpart_type, reason_code, created_by, order_id, shift_id
       FROM cash_movement WHERE id = $1`,
    [body.id]
  );
  assert.equal(row.type, 'paid_out');
  assert.equal(String(row.delta), '-500000');
  assert.equal(row.counterpart_type, 'owner_draw');
  assert.equal(row.reason_code, 'ambil_pemilik');
  assert.equal(row.created_by, base.user.id);
  assert.equal(row.order_id, null, 'kas manual tidak menempel pada penjualan mana pun');
  assert.equal(row.shift_id, id);
});

test('kas masuk menulis delta POSITIF', async () => {
  const id = await shift();
  const res = await kas(id, { arah: 'masuk', reasonCode: 'tambah_modal', jumlah: '200000' });
  assert.equal(res.statusCode, 201, res.body);
  const body = JSON.parse(res.body);
  assert.equal(body.delta, '200000');

  const [row] = await query('SELECT type, delta FROM cash_movement WHERE id = $1', [body.id]);
  assert.equal(row.type, 'paid_in');
  assert.equal(String(row.delta), '200000');
});

test('⛔ barisnya BENAR-BENAR menggerakkan saldo TUTUP KAS — inti fiturnya', async () => {
  // ⛔ Lewat endpoint `POST /shifts/{id}/close`, BUKAN dengan menjumlahkan
  // ulang deltanya sendiri. Penjumlahan yang ditulis test hanya membuktikan
  // test-nya dapat menambah; yang harus dibuktikan adalah barisnya SAMPAI ke
  // perhitungan tutup kas. Endpoint yang menulis baris bertipe
  // `opening_float` — yang `close` kecualikan — akan lulus setiap assertion di
  // atas sambil tidak menghapus satu rupiah pun dari selisih palsu yang
  // seluruh fitur ini ada untuk menghapusnya.
  const id = await shift({ openingFloat: 100000 });
  await kas(id, { arah: 'keluar', reasonCode: 'bayar_pemasok', jumlah: '30000' });
  await kas(id, { arah: 'masuk', reasonCode: 'tambah_modal', jumlah: '10000' });

  // Uang fisik di laci: 100.000 − 30.000 + 10.000 = 80.000.
  const res = await app.inject({
    method: 'POST',
    url: `/shifts/${id}/close`,
    headers: hdr(),
    payload: { countedAmount: '80000' },
  });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().expectedAmount, '80000');
  assert.equal(res.json().difference, '0', 'selisihnya NOL — tidak ada otorisasi yang dituntut');
});

test('⛔ tanpa pencatatan, uang yang sama MENOLAK tutup kas dan menuduh kasir', async () => {
  // Sisi lain dari test di atas, dan seluruh alasan keberadaan FR-D5. Shift
  // yang identik — uang yang sama, keluar dengan sah — tetapi tanpa satu pun
  // `cash_movement` tidak sekadar melaporkan angka berbeda: penutupannya
  // DITOLAK sampai kasir mengarang alasan untuk selisih yang bukan salahnya,
  // dan Rp 30.000 melewati ambang Rp 20.000 sehingga otorisasi manajer
  // dituntut juga.
  const id = await shift({ openingFloat: 100000 });
  const res = await app.inject({
    method: 'POST',
    url: `/shifts/${id}/close`,
    headers: hdr(),
    payload: { countedAmount: '70000' },
  });
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(res.json().error.code, 'VARIANCE_REASON_REQUIRED');
});

test('audit event dipancarkan dengan arah, aktor, dan alasannya', async () => {
  const id = await shift();
  const res = await kas(id, { arah: 'keluar', reasonCode: 'biaya_operasional', jumlah: '75000' });
  const body = JSON.parse(res.body);

  // ⛔ Disaring per `event_type`, bukan menghitung SELURUH baris tabel —
  // bentuk hampa yang F3 temukan pada 18 test `stock_movement`.
  const [row] = await query(
    `SELECT actor_user_id, approver_user_id, entity_type, entity_id, reason_code, outlet_id, device_id, after
       FROM audit_event WHERE event_type = 'cash_paid_out' AND entity_id = $1`,
    [body.id]
  );
  assert.ok(row, 'cash_paid_out tidak dipancarkan');
  assert.equal(row.actor_user_id, base.user.id);
  // Lihat catatan kepala handler: tanpa PIN manajer, ditiru dari void.
  assert.equal(row.approver_user_id, null);
  assert.equal(row.entity_type, 'cash_movement');
  assert.equal(row.reason_code, 'biaya_operasional');
  assert.equal(row.outlet_id, outletId);
  assert.equal(row.device_id, device);
  assert.equal(row.after.delta, '-75000', 'uang sebagai STRING dan BERTANDA di jsonb');
  assert.equal(row.after.counterpartType, 'expense');
});

test('kas masuk memancarkan cash_paid_in, bukan cash_paid_out', async () => {
  const id = await shift();
  const res = await kas(id, { arah: 'masuk', reasonCode: 'setoran_pemilik' });
  const body = JSON.parse(res.body);
  const masuk = await query(
    `SELECT id FROM audit_event WHERE event_type = 'cash_paid_in' AND entity_id = $1`,
    [body.id]
  );
  const keluar = await query(
    `SELECT id FROM audit_event WHERE event_type = 'cash_paid_out' AND entity_id = $1`,
    [body.id]
  );
  assert.equal(masuk.length, 1);
  assert.equal(keluar.length, 0);
});

test('outbox event dipancarkan di transaksi yang sama', async () => {
  const id = await shift();
  const res = await kas(id, { arah: 'keluar' });
  const body = JSON.parse(res.body);
  const rows = await query(
    `SELECT event_type, aggregate_id, payload FROM outbox
      WHERE aggregate_id = $1 AND event_type = 'cash.paid_out'`,
    [id]
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].payload.movementId, body.id);
  assert.equal(rows[0].payload.delta, '-50000');
});

test('⛔ shift TERTUTUP menolak 409 — angka yang sudah ditandatangani tidak berubah', async () => {
  const id = await shift({ status: 'closed' });
  const res = await kas(id);
  assert.equal(res.statusCode, 409, res.body);
  assert.equal(res.json().error.code, 'SHIFT_NOT_OPEN');

  const rows = await query('SELECT id FROM cash_movement WHERE shift_id = $1', [id]);
  assert.equal(rows.length, 0, 'tidak ada baris yang tertulis');
});

test('shift milik tenant lain: 404, dan tidak ada baris tertulis', async () => {
  // Temuan F1 — FK PostgreSQL tidak tunduk RLS. Yang menahannya adalah SELECT
  // di aplikasi, bukan constraint.
  const lain = await seedTenantBase(db, { suffix: 'KasLain' });
  const asing = crypto.randomUUID();
  await db.query('BEGIN');
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [lain.tenant.id]);
  await db.query(
    `INSERT INTO device (id, tenant_id, outlet_id, code, name, platform, app_version, schema_version)
     VALUES ($1,$2,$3,'K9','K9','tauri','0','1')`,
    [asing, lain.tenant.id, lain.outlet.id]
  );
  const shiftAsing = crypto.randomUUID();
  await db.query(
    `INSERT INTO cash_drawer_shift (id, tenant_id, outlet_id, device_id, business_date, status, opening_float, opened_by)
     VALUES ($1,$2,$3,$4,'2026-08-24','open',100000,$5)`,
    [shiftAsing, lain.tenant.id, lain.outlet.id, asing, lain.user.id]
  );
  await db.query('COMMIT');

  const res = await kas(shiftAsing);
  assert.equal(res.statusCode, 404, res.body);
  assert.equal(res.json().error.code, 'SHIFT_NOT_FOUND');
});

test('nol, jumlah negatif, dan alasan asing semuanya ditolak sebelum menulis', async () => {
  const id = await shift();
  const nol = await kas(id, { jumlah: '0' });
  assert.equal(nol.statusCode, 400, nol.body);
  assert.equal(nol.json().error.code, 'VALIDATION_ERROR');

  // ⛔ Tanda di jumlah TIDAK PERNAH diterima — arahnya dinyatakan `arah`.
  const negatif = await kas(id, { jumlah: '-50000' });
  assert.equal(negatif.statusCode, 400, negatif.body);

  const asing = await kas(id, { reasonCode: 'beli_kopi_buat_saya' });
  assert.equal(asing.statusCode, 400, asing.body);
  assert.equal(asing.json().error.code, 'REASON_INVALID');

  // Alasan yang sah untuk arah LAIN tetap ditolak.
  const silang = await kas(id, { arah: 'masuk', reasonCode: 'bayar_pemasok' });
  assert.equal(silang.statusCode, 400, silang.body);

  const rows = await query('SELECT id FROM cash_movement WHERE shift_id = $1', [id]);
  assert.equal(rows.length, 0);
});

test('"lainnya" tanpa catatan ditolak; dengan catatan diterima', async () => {
  const id = await shift();
  const tanpa = await kas(id, { reasonCode: 'lainnya' });
  assert.equal(tanpa.statusCode, 400, tanpa.body);
  assert.equal(tanpa.json().error.code, 'REASON_NOTE_REQUIRED');

  const dengan = await kas(id, { reasonCode: 'lainnya', reasonNote: 'ganti galon' });
  assert.equal(dengan.statusCode, 201, dengan.body);
  const [row] = await query('SELECT counterpart_type, note FROM cash_movement WHERE id = $1', [
    JSON.parse(dengan.body).id,
  ]);
  assert.equal(row.counterpart_type, 'unidentified', 'alasan bebas tidak ditebak sebagai expense');
  assert.equal(row.note, 'ganti galon');
});

test('arah asing ditolak', async () => {
  const id = await shift();
  const res = await kas(id, { arah: 'naik' });
  assert.equal(res.statusCode, 400, res.body);
});

test('jumlah sebagai NUMBER ditolak — rupiah lewat jalur kas selalu string', async () => {
  // ⛔ Koersi AJV mengubah `number` menjadi `string` pada properti bertipe
  // string sebelum handler melihatnya; yang menahan pembulatan diam-diam
  // adalah bentuknya di kontrak. Yang diuji di sini adalah bahwa nilai
  // BUKAN-bilangan-bulat tidak lolos apa pun yang terjadi di lapisan itu.
  const id = await shift();
  const res = await kas(id, { jumlah: '50000.5' });
  assert.equal(res.statusCode, 400, res.body);
});

test('Idempotency-Key wajib, dan retry dengan key yang sama tidak menggandakan uang', async () => {
  const id = await shift();
  const tanpaKey = await app.inject({
    method: 'POST',
    url: `/shifts/${id}/cash-movements`,
    headers: hdr(),
    payload: { id: crypto.randomUUID(), arah: 'keluar', jumlah: '50000', reasonCode: 'bayar_pemasok' },
  });
  assert.equal(tanpaKey.statusCode, 400, tanpaKey.body);
  assert.equal(tanpaKey.json().error.code, 'MISSING_IDEMPOTENCY_KEY');

  const key = crypto.randomUUID();
  const movementId = crypto.randomUUID();
  const pertama = await kas(id, { id: movementId }, {}, key);
  assert.equal(pertama.statusCode, 201, pertama.body);
  const kedua = await kas(id, { id: movementId }, {}, key);
  assert.equal(kedua.statusCode, 201, 'respons ASLI dikembalikan apa adanya');
  assert.deepEqual(JSON.parse(kedua.body), JSON.parse(pertama.body));

  const rows = await query('SELECT id FROM cash_movement WHERE shift_id = $1', [id]);
  assert.equal(rows.length, 1, 'retry tidak menggandakan pergerakan uang');
});

/**
 * ⛔ Peran diganti pada PEMILIK SESI, bukan lewat `X-Actor-Id`.
 *
 * Header itu diabaikan sepenuhnya di rute terlindungi ("sesi menang"), jadi
 * test yang menggantinya sebenarnya menguji pemilik sesi — ditemukan lewat
 * test "akuntan ditolak" yang hijau dengan status 201 (`CLAUDE.md`).
 */
async function jadikanPeran(peran) {
  await query('DELETE FROM user_role WHERE user_id = $1', [base.user.id]);
  await query(
    `INSERT INTO user_role (id, tenant_id, user_id, role, scope_type, scope_id)
     VALUES ($1,$2,$3,$4,'outlet',$5)`,
    [crypto.randomUUID(), tenant.id, base.user.id, peran, outletId]
  );
}

test('akuntan ditolak — tidak dapat melakukan mutasi apa pun (`spec-f:82`)', async () => {
  const id = await shift();
  await jadikanPeran('accountant');
  const res = await kas(id);
  assert.equal(res.statusCode, 403, res.body);

  const rows = await query('SELECT id FROM cash_movement WHERE shift_id = $1', [id]);
  assert.equal(rows.length, 0);
});

test('kasir BOLEH mencatat — orang yang mengambil uang sering satu-satunya yang ada', async () => {
  // ⛔ Ini separuh yang lebih mudah dilupakan. Penjaga yang menolak SEMUA
  // orang lulus test akuntan di atas dengan sempurna, dan fiturnya mati.
  const id = await shift();
  await jadikanPeran('cashier');
  const res = await kas(id);
  assert.equal(res.statusCode, 201, res.body);
});
