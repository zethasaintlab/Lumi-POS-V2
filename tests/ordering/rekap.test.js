'use strict';

// Modul C-3 — FR-C12 (rekonsiliasi) dan FR-C13 (rekapitulasi).
//
// ⛔ Yang paling penting diuji di sini adalah AC FR-C13 kedua: *"Total di
// ekspor cocok dengan laporan penjualan pada periode yang sama."* Ia diuji
// dengan `assert.deepEqual` terhadap respons `GET /reports/sales`, BUKAN
// terhadap angka tulisan tangan — pola yang sama dengan B-01.
//
// Angka tulisan tangan membuktikan aritmetikanya benar HARI INI; ia tidak
// membuktikan kedua laporan akan tetap sepakat setelah salah satunya diubah.
// Dan laporan yang saling bertentangan menghancurkan kepercayaan merchant
// lebih cepat daripada fitur yang hilang (`spec-g:29`).

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');

let owner, appSetup, app, tenant, base, manajer;

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
  base = await seedTenantBase(appSetup, { suffix: 'Rekap' });
  tenant = base.tenant;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();
  manajer = await buatUser('Manajer');
});

const BUSINESS_DATE = '2026-08-10';
let deviceCounter = 0;
let seq = 0;

function req(method, url, payload, headers = {}) {
  const h = {
    'x-tenant-id': tenant.id,
    authorization: base.authHeader,
    'x-actor-id': base.user.id,
    ...headers,
  };
  const butuhKey =
    method === 'POST' && (url === '/orders' || url.endsWith('/payments') || url.endsWith('/cancel'));
  if (butuhKey && h['idempotency-key'] === undefined) {
    h['idempotency-key'] = crypto.randomUUID();
  }
  return app.inject({ method, url, payload, headers: h });
}

async function buatUser(nama, peran = 'outlet_manager') {
  const id = crypto.randomUUID();
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await appSetup.query(
    `INSERT INTO "user" (id, tenant_id, name, is_active) VALUES ($1, $2, $3, true)`,
    [id, tenant.id, `${nama} ${id.slice(0, 6)}`]
  );
  await appSetup.query(
    `INSERT INTO user_role (id, tenant_id, user_id, role, scope_type, scope_id)
     VALUES ($1, $2, $3, $4, 'outlet', $5)`,
    [crypto.randomUUID(), tenant.id, id, peran, base.outlet.id]
  );
  await appSetup.query('COMMIT');
  return id;
}

async function setupDeviceAndShift() {
  deviceCounter += 1;
  const deviceId = crypto.randomUUID();
  const d = await req('POST', '/devices', {
    id: deviceId,
    outletId: base.outlet.id,
    code: `R${deviceCounter}`,
  });
  assert.equal(d.statusCode, 201, d.body);
  const shiftId = crypto.randomUUID();
  const s = await req('POST', '/shifts', {
    id: shiftId,
    outletId: base.outlet.id,
    deviceId,
    businessDate: BUSINESS_DATE,
    openingFloat: 100000,
  });
  assert.equal(s.statusCode, 201, s.body);
  return { deviceId, shiftId };
}

async function buatVariation(price) {
  const itemId = crypto.randomUUID();
  const variationId = crypto.randomUUID();
  const res = await app.inject({
    method: 'POST',
    url: '/items',
    payload: {
      id: itemId,
      name: `P${variationId.slice(0, 6)}`,
      variations: [{ id: variationId, price }],
    },
    headers: { 'x-tenant-id': tenant.id, authorization: base.authHeader },
  });
  assert.equal(res.statusCode, 201, res.body);
  return variationId;
}

async function buatOrder(fx, lines) {
  seq += 1;
  const res = await req('POST', '/orders', {
    id: crypto.randomUUID(),
    outletId: base.outlet.id,
    deviceId: fx.deviceId,
    shiftId: fx.shiftId,
    receiptNumber: `R1-20260810-${String(seq).padStart(4, '0')}`,
    businessDate: BUSINESS_DATE,
    sequence: seq,
    channel: 'takeaway',
    checkId: crypto.randomUUID(),
    lines,
  });
  assert.equal(res.statusCode, 201, res.body);
  return JSON.parse(res.body);
}

function baris(variationId, qtyMilli = 1000, discountAmount = 0) {
  return { id: crypto.randomUUID(), variationId, quantityMilli: qtyMilli, discountAmount };
}

async function bayarTunai(order) {
  const res = await req('POST', `/orders/${order.id}/payments`, {
    id: crypto.randomUUID(),
    method: 'cash',
    tenderedAmount: order.amountDue ?? order.total,
  });
  assert.equal(res.statusCode, 201, res.body);
  return JSON.parse(res.body);
}

// Void menuntut `receiptNumber` untuk order PEMBATAL — ia baris tersendiri
// dengan nomor struknya sendiri (`spec-b:235`).
async function batalkan(orderId) {
  seq += 1;
  return req(
    'POST',
    `/orders/${orderId}/cancel`,
    {
      id: crypto.randomUUID(),
      reasonCode: 'salah_input',
      receiptNumber: `R1-20260810-${String(seq).padStart(4, '0')}`,
      sequence: seq,
    },
    { 'x-approver-id': manajer }
  );
}

async function bayarQrisStatis(order, amount) {
  const res = await req('POST', `/orders/${order.id}/payments`, {
    id: crypto.randomUUID(),
    method: 'qris_static',
    amount,
    reference: `REF-${crypto.randomUUID().slice(0, 8)}`,
  });
  assert.equal(res.statusCode, 201, res.body);
  return JSON.parse(res.body);
}

const rentang = () => `?from=${BUSINESS_DATE}&to=${BUSINESS_DATE}`;

async function ambilRekap() {
  const res = await req('GET', `/reports/recap${rentang()}`);
  assert.equal(res.statusCode, 200, res.body);
  return JSON.parse(res.body).rekap;
}

async function ambilPenjualan() {
  const res = await req('GET', `/reports/sales${rentang()}`);
  assert.equal(res.statusCode, 200, res.body);
  return JSON.parse(res.body).penjualan;
}

async function query(sql, params) {
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  try {
    const { rows } = await appSetup.query(sql, params);
    await appSetup.query('COMMIT');
    return rows;
  } catch (err) {
    await appSetup.query('ROLLBACK');
    throw err;
  }
}

// ===========================================================================
// AC FR-C13 kedua — total cocok dengan laporan penjualan
// ===========================================================================

test('⛔ angka kepala rekap IDENTIK dengan GET /reports/sales', async () => {
  const fx = await setupDeviceAndShift();
  const v = await buatVariation(25000);
  await bayarTunai(await buatOrder(fx, [baris(v), baris(v, 2000)]));
  await bayarTunai(await buatOrder(fx, [baris(v)]));

  // Satu order dibatalkan, supaya aturan "order yang punya pembatal
  // dikeluarkan" ikut terlibat di KEDUA laporan.
  const dibatalkan = await buatOrder(fx, [baris(v)]);
  const batal = await batalkan(dibatalkan.id);
  assert.equal(batal.statusCode, 201, batal.body);

  const rekap = await ambilRekap();
  const penjualan = await ambilPenjualan();

  // ⛔ Dibandingkan sebagai OBJEK, bukan field per field: field baru yang
  // ditambahkan ke salah satunya lalu menyimpang tidak akan tertangkap oleh
  // perbandingan yang menyebutkan namanya satu per satu.
  assert.deepEqual(
    {
      omzetKotor: rekap.omzetKotor,
      voidAmount: rekap.voidAmount,
      refundAmount: rekap.refundAmount,
      omzetBersih: rekap.omzetBersih,
      pajakTerkumpul: rekap.pajakTerkumpul,
      jumlahTransaksi: rekap.jumlahTransaksi,
      rataRataPerTransaksi: rekap.rataRataPerTransaksi,
    },
    penjualan,
    'rekapitulasi menyimpang dari laporan penjualan untuk periode yang sama'
  );
});

test('order yang dibatalkan tidak menyumbang diskon, service charge, atau pembulatan', async () => {
  const fx = await setupDeviceAndShift();
  const v = await buatVariation(30000);

  const hidup = await buatOrder(fx, [baris(v, 1000, 5000)]);
  await bayarTunai(hidup);

  const mati = await buatOrder(fx, [baris(v, 1000, 7000)]);
  const batal = await batalkan(mati.id);
  assert.equal(batal.statusCode, 201, batal.body);

  const rekap = await ambilRekap();
  // ⛔ Hanya diskon order HIDUP. Kalau order pembatal ikut terhitung, angkanya
  // 12.000 — dan tidak ada satu pun error yang menandainya.
  assert.equal(rekap.totalDiskonBaris, '5000');
});

// ===========================================================================
// AC FR-C13 pertama — pajak dipisah per jenis DAN yurisdiksi
// ===========================================================================

test('⛔ pajak dipisah per nama tarif DAN yurisdiksi, dari SNAPSHOT', async () => {
  const fx = await setupDeviceAndShift();
  const v = await buatVariation(100000);
  await bayarTunai(await buatOrder(fx, [baris(v)]));

  const rekap = await ambilRekap();
  assert.ok(rekap.pajak.length >= 1, 'tidak ada satu pun kelompok pajak');
  const kelompok = rekap.pajak[0];
  assert.equal(kelompok.nama, base.tax_rate.name);
  assert.ok('yurisdiksi' in kelompok, 'kelompok pajak tidak menyebut yurisdiksi');
  assert.ok(BigInt(kelompok.total) > 0n, 'kelompok pajak bernilai nol');

  // ⛔ SNAPSHOT: mengubah nama tarif SEKARANG tidak boleh mengubah
  // rekapitulasi periode yang sudah lewat. Kalau namanya diresolusi lewat
  // JOIN ke `tax_rate`, ekspor kedua akan berbeda dari yang pertama tanpa
  // satu pun transaksi berubah — dan itu akan dibaca sebagai koreksi.
  await query(`UPDATE tax_rate SET name = $1 WHERE id = $2`, [
    'Nama Baru Setelah Pelaporan',
    base.tax_rate.id,
  ]);
  const sesudah = await ambilRekap();
  assert.equal(sesudah.pajak[0].nama, base.tax_rate.name, 'nama tarif diresolusi ulang saat laporan');
});

test('baris tanpa tarif sama sekali tidak menjadi kelompok pajak bernilai nol', async () => {
  // Kelompok kosong akan dibaca sebagai jenis pajak yang tidak dipungut.
  const akhiri = await req('POST', `/tax-rates/${base.tax_rate.id}/end`, {});
  assert.equal(akhiri.statusCode, 200, akhiri.body);

  const fx = await setupDeviceAndShift();
  const v = await buatVariation(50000);
  await bayarTunai(await buatOrder(fx, [baris(v)]));

  const rekap = await ambilRekap();
  assert.deepEqual(rekap.pajak, []);
  assert.equal(rekap.pajakTerkumpul, '0');
});

// ===========================================================================
// FR-C12 — perkiraan MDR
// ===========================================================================

test('QRIS statis menyimpan perkiraan MDR; tunai tidak punya perkiraan', async () => {
  const akhiri = await req('POST', `/tax-rates/${base.tax_rate.id}/end`, {});
  assert.equal(akhiri.statusCode, 200, akhiri.body);

  const fx = await setupDeviceAndShift();
  const v = await buatVariation(1000000);
  const order = await buatOrder(fx, [baris(v)]);
  await bayarQrisStatis(order, 1000000);

  const [row] = await query(
    `SELECT method, mdr_estimated FROM payment WHERE order_id = $1`,
    [order.id]
  );
  // Bawaan tenant `umi`, Rp 1.000.000 > ambang → 0,3% = 3.000.
  assert.equal(row.mdr_estimated, '3000');

  const lain = await buatOrder(fx, [baris(v)]);
  await bayarTunai(lain);
  const [tunai] = await query(
    `SELECT mdr_estimated FROM payment WHERE order_id = $1`,
    [lain.id]
  );
  // ⛔ NULL, bukan 0. Nol berarti "diperkirakan tidak dipotong"; tunai memang
  // tidak punya perkiraan sama sekali.
  assert.equal(tunai.mdr_estimated, null);
});

test('kategori merchant tenant menentukan tarif yang tersimpan', async () => {
  const akhiri = await req('POST', `/tax-rates/${base.tax_rate.id}/end`, {});
  assert.equal(akhiri.statusCode, 200, akhiri.body);
  await query(`UPDATE tenant SET merchant_category = 'uke'`);

  const fx = await setupDeviceAndShift();
  const v = await buatVariation(1000000);
  const order = await buatOrder(fx, [baris(v)]);
  await bayarQrisStatis(order, 1000000);

  const [row] = await query(`SELECT mdr_estimated FROM payment WHERE order_id = $1`, [order.id]);
  assert.equal(row.mdr_estimated, '7000', 'kategori tenant tidak dipakai');
});

test('⛔ perkiraan adalah SNAPSHOT — mengubah kategori tidak mengubah baris lama', async () => {
  const akhiri = await req('POST', `/tax-rates/${base.tax_rate.id}/end`, {});
  assert.equal(akhiri.statusCode, 200, akhiri.body);

  const fx = await setupDeviceAndShift();
  const v = await buatVariation(1000000);
  const order = await buatOrder(fx, [baris(v)]);
  await bayarQrisStatis(order, 1000000);

  await query(`UPDATE tenant SET merchant_category = 'ube'`);
  const [row] = await query(`SELECT mdr_estimated FROM payment WHERE order_id = $1`, [order.id]);
  assert.equal(row.mdr_estimated, '3000', 'perkiraan dihitung ulang saat dibaca');
});

test('rekap melaporkan perkiraan settlement per metode, dan null untuk yang tak punya', async () => {
  const akhiri = await req('POST', `/tax-rates/${base.tax_rate.id}/end`, {});
  assert.equal(akhiri.statusCode, 200, akhiri.body);

  const fx = await setupDeviceAndShift();
  const v = await buatVariation(1000000);
  await bayarQrisStatis(await buatOrder(fx, [baris(v)]), 1000000);
  await bayarTunai(await buatOrder(fx, [baris(v)]));

  const rekap = await ambilRekap();
  const qris = rekap.pembayaran.find((m) => m.method === 'qris_static');
  const cash = rekap.pembayaran.find((m) => m.method === 'cash');

  assert.equal(qris.perkiraanMdr, '3000');
  assert.equal(qris.perkiraanSettlement, '997000');
  // ⛔ null, dan settlement TETAP nilai penuh: yang tidak diketahui adalah
  // potongannya, bukan uangnya.
  assert.equal(cash.perkiraanMdr, null);
  assert.equal(cash.perkiraanSettlement, '1000000');

  assert.equal(rekap.totalDiterima, '2000000');
  assert.equal(rekap.totalPerkiraanMdr, '3000');
  assert.equal(rekap.totalPerkiraanSettlement, '1997000');
});

// ===========================================================================
// AC FR-C13 ketiga — periode dan tanggal dibuat DI DALAM berkas
// ===========================================================================

test('⛔ CSV rekap memuat periode dan tanggal dibuat di dalam berkasnya', async () => {
  const fx = await setupDeviceAndShift();
  const v = await buatVariation(25000);
  await bayarTunai(await buatOrder(fx, [baris(v)]));

  const res = await req('GET', `/reports/export?type=recap&from=${BUSINESS_DATE}&to=${BUSINESS_DATE}`);
  assert.equal(res.statusCode, 200, res.body);
  assert.match(res.headers['content-type'], /text\/csv/);
  assert.match(res.headers['content-disposition'], /lumi-recap-/);

  const csv = res.body;
  // Nama berkas hilang begitu seseorang menyimpannya ulang; periodenya harus
  // ada di dalam.
  assert.match(csv, new RegExp(`"periode","dari","","${BUSINESS_DATE}"`));
  assert.match(csv, new RegExp(`"periode","sampai","","${BUSINESS_DATE}"`));
  assert.match(csv, /"periode","dibuat_pada","","\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z"/);
  // Kata "PERKIRAAN" ikut ke berkas, bukan hanya ke layar (AC FR-C12 kedua).
  assert.match(csv, /PERKIRAAN/);
  // BOM UTF-8 — sama seperti ekspor lain.
  assert.equal(csv.charCodeAt(0), 0xfeff);
});

test('CSV rekap: angka ringkasannya sama dengan JSON rekap', async () => {
  const fx = await setupDeviceAndShift();
  const v = await buatVariation(25000);
  await bayarTunai(await buatOrder(fx, [baris(v), baris(v)]));

  const rekap = await ambilRekap();
  const res = await req('GET', `/reports/export?type=recap&from=${BUSINESS_DATE}&to=${BUSINESS_DATE}`);
  assert.equal(res.statusCode, 200, res.body);

  for (const [kunci, nilai] of [
    ['omzet_kotor', rekap.omzetKotor],
    ['omzet_bersih', rekap.omzetBersih],
    ['pajak_terkumpul', rekap.pajakTerkumpul],
    ['jumlah_transaksi', String(rekap.jumlahTransaksi)],
  ]) {
    assert.match(
      res.body,
      new RegExp(`"ringkasan","${kunci}","","${nilai}"`),
      `CSV tidak memuat ${kunci}=${nilai}`
    );
  }
});

test('type tak dikenal ditolak dengan pesan yang menyebut pilihan sah', async () => {
  const res = await req('GET', `/reports/export?type=rekap&from=${BUSINESS_DATE}&to=${BUSINESS_DATE}`);
  assert.equal(res.statusCode, 400, res.body);
  assert.match(JSON.parse(res.body).error.message, /recap/);
});

test('rentang terbalik ditolak, bukan dijawab nol', async () => {
  const res = await req('GET', `/reports/recap?from=2026-08-11&to=2026-08-10`);
  assert.equal(res.statusCode, 400, res.body);
});

test('outlet tenant lain tidak menjadi oracle keberadaan', async () => {
  const res = await req('GET', `/reports/recap${rentang()}&outlet_id=${crypto.randomUUID()}`);
  assert.equal(res.statusCode, 404, res.body);
});
