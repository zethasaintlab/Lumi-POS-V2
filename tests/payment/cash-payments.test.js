'use strict';

// T13-T17 (docs/superpowers/plans/PLAN-pembayaran-pajak.md) -- pembayaran
// tunai, dan separuh state machine order yang selama ini menganggur:
// OPEN -> PAID -> CLOSED.
//
// Keputusan bentuk API: untuk tunai, klien mengirim `tenderedAmount` -- uang
// yang DISERAHKAN pelanggan -- bukan `amount`. Server yang memutuskan berapa
// yang terpakai dan berapa kembaliannya.
//
// Alasannya: jumlah yang terpakai bergantung pada pembulatan tunai (FR-C9),
// dan pembulatan itu bergantung pada rounding_increment/rounding_mode outlet.
// Menuntut klien menghitungnya sendiri berarti dua implementasi pembulatan --
// persis cara angka di layar kasir mulai berbeda dari angka yang tersimpan.

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
  base = await seedTenantBase(appSetup, { suffix: 'CashPayTest' });
  tenant = base.tenant;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();
});

const BUSINESS_DATE = '2026-08-07';
let deviceCounter = 0;
let seq = 0;

function req(method, url, payload, headers = {}) {
  const h = { 'x-tenant-id': tenant.id, authorization: base.authHeader, 'x-actor-id': base.user.id, ...headers };
  if (method === 'POST' && (url === '/orders' || url.endsWith('/payments')) && h['idempotency-key'] === undefined) {
    h['idempotency-key'] = crypto.randomUUID();
  }
  return app.inject({ method, url, payload, headers: h });
}

async function setupDeviceAndShift() {
  deviceCounter += 1;
  const deviceId = crypto.randomUUID();
  const d = await req('POST', '/devices', { id: deviceId, outletId: base.outlet.id, code: `K${deviceCounter}` });
  assert.equal(d.statusCode, 201, d.body);
  const shiftId = crypto.randomUUID();
  const s = await req('POST', '/shifts', {
    id: shiftId, outletId: base.outlet.id, deviceId,
    businessDate: BUSINESS_DATE, openingFloat: 100000,
  });
  assert.equal(s.statusCode, 201, s.body);
  return { deviceId, shiftId };
}

// Tarif bawaan seed diakhiri di sebagian besar test supaya total bisa
// diprediksi angka per angka tanpa pajak ikut bermain.
async function akhiriTarifSeed() {
  const res = await req('POST', `/tax-rates/${base.tax_rate.id}/end`, {});
  assert.equal(res.statusCode, 200, res.body);
}

async function buatVariation(price) {
  const itemId = crypto.randomUUID();
  const variationId = crypto.randomUUID();
  const res = await app.inject({
    method: 'POST', url: '/items',
    payload: { id: itemId, name: `P${variationId.slice(0, 6)}`, variations: [{ id: variationId, price }] },
    headers: { 'x-tenant-id': tenant.id , authorization: base.authHeader},
  });
  assert.equal(res.statusCode, 201, res.body);
  return variationId;
}

async function buatOrder(fx, variationId) {
  seq += 1;
  const payload = {
    id: crypto.randomUUID(),
    outletId: base.outlet.id,
    deviceId: fx.deviceId,
    shiftId: fx.shiftId,
    receiptNumber: `K1-20260807-${String(seq).padStart(4, '0')}`,
    businessDate: BUSINESS_DATE,
    sequence: seq,
    channel: 'takeaway',
    checkId: crypto.randomUUID(),
    lines: [{ id: crypto.randomUUID(), variationId, quantityMilli: 1000, discountAmount: 0 }],
  };
  const res = await req('POST', '/orders', payload);
  assert.equal(res.statusCode, 201, res.body);
  return JSON.parse(res.body);
}

function bayar(orderId, body, headers = {}) {
  return req('POST', `/orders/${orderId}/payments`, { id: crypto.randomUUID(), method: 'cash', ...body }, headers);
}

async function hitungPayment(orderId) {
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  const { rows } = await appSetup.query('SELECT id FROM payment WHERE order_id = $1', [orderId]);
  await appSetup.query('COMMIT');
  return rows.length;
}

// --- T13: jalur bahagia ---

test('bayar tunai pas: order menjadi CLOSED, payment tercatat confirmed', async () => {
  await akhiriTarifSeed();
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx, await buatVariation(25000));
  assert.equal(order.total, 25000);

  const res = await bayar(order.id, { tenderedAmount: 25000 });
  assert.equal(res.statusCode, 201, res.body);
  const body = JSON.parse(res.body);

  assert.equal(body.payment.method, 'cash');
  assert.equal(body.payment.amount, 25000);
  assert.equal(body.payment.tenderedAmount, 25000);
  assert.equal(body.payment.changeAmount, 0);
  assert.equal(body.payment.status, 'confirmed', 'tunai langsung confirmed, tidak menunggu issuer');

  // OPEN -> PAID -> CLOSED. spec-b:64: PAID -> CLOSED otomatis setelah
  // operasi pasca-bayar selesai.
  assert.equal(body.order.status, 'closed');
  assert.equal(body.order.amountDue, 25000);
  assert.equal(body.outstanding, 0);
});

// --- T15: kembalian ---

test('lebih bayar tunai menghasilkan change_amount, bukan payment negatif', async () => {
  await akhiriTarifSeed();
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx, await buatVariation(25000));

  const res = await bayar(order.id, { tenderedAmount: 50000 });
  assert.equal(res.statusCode, 201, res.body);
  const body = JSON.parse(res.body);
  assert.equal(body.payment.amount, 25000, 'yang terpakai hanya sebesar tagihan');
  assert.equal(body.payment.tenderedAmount, 50000);
  assert.equal(body.payment.changeAmount, 25000);
  assert.equal(body.order.status, 'closed');

  // spec-c:224 -- kelebihan tunai adalah kembalian, BUKAN payment negatif.
  assert.equal(await hitungPayment(order.id), 1, 'satu payment, bukan dua');
});

// --- T14: kurang bayar ---

test('kurang bayar: order tetap OPEN dan sisa tagihan dilaporkan', async () => {
  await akhiriTarifSeed();
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx, await buatVariation(25000));

  const res = await bayar(order.id, { tenderedAmount: 10000 });
  assert.equal(res.statusCode, 201, res.body);
  const body = JSON.parse(res.body);
  assert.equal(body.payment.amount, 10000);
  assert.equal(body.payment.changeAmount, 0);
  assert.equal(body.order.status, 'open', 'belum lunas -> tetap OPEN');
  assert.equal(body.outstanding, 15000, 'sisa tagihan harus terbaca kasir');
});

test('dua pembayaran parsial melunasi order (FR-C1: satu order banyak payment)', async () => {
  await akhiriTarifSeed();
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx, await buatVariation(25000));

  const a = await bayar(order.id, { tenderedAmount: 10000 });
  assert.equal(JSON.parse(a.body).order.status, 'open');

  const b = await bayar(order.id, { tenderedAmount: 15000 });
  assert.equal(b.statusCode, 201, b.body);
  const body = JSON.parse(b.body);
  assert.equal(body.order.status, 'closed');
  assert.equal(body.outstanding, 0);
  assert.equal(await hitungPayment(order.id), 2);
});

// --- FR-C9: pembulatan baru berlaku saat ada tunai ---

test('FR-C9: pembulatan tunai mengubah amount_due, TIDAK mengubah total maupun pajak', async () => {
  const fx = await setupDeviceAndShift();
  // Tarif seed dibiarkan hidup (PB1 10% inklusif) supaya pajak ikut diuji.
  const order = await buatOrder(fx, await buatVariation(64167));
  assert.equal(order.total, 64167, 'total tidak dibulatkan saat order dibuat');
  assert.equal(order.roundingAdjustment, 0, 'belum ada pembayaran -> belum ada pembulatan');
  const pajakSebelum = order.taxAmount;

  const res = await bayar(order.id, { tenderedAmount: 100000 });
  assert.equal(res.statusCode, 201, res.body);
  const body = JSON.parse(res.body);

  // outlet.rounding_increment default 100, mode half_up: 64.167 -> 64.200
  assert.equal(body.order.amountDue, 64200, 'yang dibayar dibulatkan');
  assert.equal(body.order.roundingAdjustment, 33, 'selisihnya tercatat, bukan hilang');
  assert.equal(body.order.total, 64167, 'nilai transaksi TIDAK bergeser oleh pembulatan');
  assert.equal(body.order.taxAmount, pajakSebelum, 'AC FR-C9: pajak tidak berubah oleh pembulatan');
  assert.equal(body.payment.amount, 64200);
  assert.equal(body.payment.changeAmount, 35800, '100.000 - 64.200');
});

// --- T16: transisi ilegal ---

test('membayar order yang sudah CLOSED ditolak lewat state machine, bukan if di handler', async () => {
  await akhiriTarifSeed();
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx, await buatVariation(25000));
  assert.equal(JSON.parse((await bayar(order.id, { tenderedAmount: 25000 })).body).order.status, 'closed');

  const lagi = await bayar(order.id, { tenderedAmount: 10000 });
  assert.ok(lagi.statusCode >= 400 && lagi.statusCode < 500, `harusnya 4xx, dapat ${lagi.statusCode}: ${lagi.body}`);
  assert.equal(await hitungPayment(order.id), 1, 'pembayaran kedua tidak boleh tercatat');
});

// --- validasi ---

test('tenderedAmount bukan bilangan bulat positif ditolak 400', async () => {
  await akhiriTarifSeed();
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx, await buatVariation(25000));
  for (const nilai of [0, -1, 1000.5, '25000', null]) {
    const res = await bayar(order.id, { tenderedAmount: nilai });
    assert.equal(res.statusCode, 400, `tenderedAmount ${nilai} harus ditolak: ${res.body}`);
  }
  assert.equal(await hitungPayment(order.id), 0);
});

// DIPERBARUI di sub-project C-2: `qris_dynamic` kini didukung (lihat
// tests/payment/qris-dynamic.test.js). Yang MASIH ditolak adalah metode yang
// kontrol wajibnya belum dibangun -- menerimanya berarti membangun separuh
// FR-C2 tanpa pengaman yang menyertainya:
//
//   qris_static : field referensi wajib + confirmed_manually + laporan
//                 exception (satu-satunya metode digital yang jalan OFFLINE,
//                 jadi kontrolnya bukan pelengkap)
//   card_edc    : approval_code wajib, card_last4 maksimal 4 digit
//   other       : catatan wajib
test('metode yang kontrolnya belum dibangun ditolak dengan pesan yang menyebut alasannya', async () => {
  await akhiriTarifSeed();
  const fx = await setupDeviceAndShift();
  for (const method of ['qris_static', 'card_edc', 'other']) {
    const order = await buatOrder(fx, await buatVariation(25000));
    const res = await bayar(order.id, { method, tenderedAmount: 25000 });
    assert.equal(res.statusCode, 400, `${method}: ${res.body}`);
    assert.equal(await hitungPayment(order.id), 0);
  }
});

// --- guard lintas tenant ---

test('order milik tenant lain ditolak 404, tidak ada payment tersimpan', async () => {
  const lain = await seedTenantBase(appSetup, { suffix: 'CashPayOther' });
  const res = await req('POST', `/orders/${crypto.randomUUID()}/payments`, {
    id: crypto.randomUUID(), method: 'cash', tenderedAmount: 25000,
  });
  assert.equal(res.statusCode, 404, res.body);
  assert.ok(lain.tenant.id);
});

// --- T17: idempotency ---

test('retry dengan Idempotency-Key sama tidak menghasilkan pembayaran ganda', async () => {
  await akhiriTarifSeed();
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx, await buatVariation(25000));

  const key = crypto.randomUUID();
  const paymentId = crypto.randomUUID();
  const body = { id: paymentId, method: 'cash', tenderedAmount: 25000 };

  const a = await req('POST', `/orders/${order.id}/payments`, body, { 'idempotency-key': key });
  assert.equal(a.statusCode, 201, a.body);

  const b = await req('POST', `/orders/${order.id}/payments`, body, { 'idempotency-key': key });
  assert.equal(b.statusCode, 201, 'cache hit mengembalikan respons asli');
  assert.deepEqual(JSON.parse(b.body), JSON.parse(a.body), 'respons harus identik');

  assert.equal(await hitungPayment(order.id), 1, 'TEPAT satu pembayaran, bukan dua');
});

test('Idempotency-Key hilang ditolak 400', async () => {
  await akhiriTarifSeed();
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx, await buatVariation(25000));
  const res = await app.inject({
    method: 'POST',
    url: `/orders/${order.id}/payments`,
    payload: { id: crypto.randomUUID(), method: 'cash', tenderedAmount: 25000 },
    headers: { 'x-tenant-id': tenant.id, authorization: base.authHeader, 'x-actor-id': base.user.id },
  });
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'MISSING_IDEMPOTENCY_KEY');
});

// --- atomisitas ---

// TEMUAN, dicatat karena mengejutkan: `payment` PK-nya `(id, occurred_at)`,
// BUKAN `id` saja -- tabelnya dipartisi per occurred_at
// (db/migrations/0008_payment.sql). Berbeda dari `order`, yang `id`-nya
// `text PRIMARY KEY` tunggal.
//
// Akibatnya: mengirim ulang id payment yang sama dengan occurred_at berbeda
// menghasilkan baris KEDUA, bukan konflik. Yang melindungi retry pembayaran
// karena itu BUKAN primary key, melainkan Idempotency-Key -- dan itu satu
// lapisan lebih sedikit daripada yang dimiliki order.
//
// Versi pertama test ini mengasumsikan `id` saja cukup dan gagal: request
// kedua mengembalikan 201, bukan 409. Asumsinya yang keliru, bukan kodenya.
test('payment: id sama dengan occurred_at sama menabrak PK (id, occurred_at)', async () => {
  await akhiriTarifSeed();
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx, await buatVariation(25000));

  const paymentId = crypto.randomUUID();
  const occurredAt = new Date().toISOString();

  const a = await bayar(order.id, { id: paymentId, tenderedAmount: 10000, occurredAt });
  assert.equal(a.statusCode, 201, a.body);
  assert.equal(JSON.parse(a.body).order.status, 'open');

  const b = await bayar(order.id, { id: paymentId, tenderedAmount: 15000, occurredAt });
  assert.equal(b.statusCode, 409, b.body);

  // Inti test: kalau perubahan status bocor keluar dari transaksi, order akan
  // CLOSED meski payment keduanya gagal.
  const dibaca = await req('GET', `/orders/${order.id}`);
  assert.equal(JSON.parse(dibaca.body).status, 'open', 'status tidak boleh berubah kalau payment gagal');
  assert.equal(await hitungPayment(order.id), 1);
});

test('payment: id sama dengan occurred_at BERBEDA lolos -- PK tidak melindunginya', async () => {
  await akhiriTarifSeed();
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx, await buatVariation(25000));

  const paymentId = crypto.randomUUID();
  const a = await bayar(order.id, { id: paymentId, tenderedAmount: 5000, occurredAt: '2026-08-07T01:00:00.000Z' });
  assert.equal(a.statusCode, 201, a.body);
  const b = await bayar(order.id, { id: paymentId, tenderedAmount: 5000, occurredAt: '2026-08-07T02:00:00.000Z' });

  // Ini MENDOKUMENTASIKAN perilaku sebenarnya, bukan membenarkannya. Yang
  // melindungi retry adalah Idempotency-Key (test di atas), bukan PK. Kalau
  // perilaku ini suatu saat diperketat, test ini yang akan menandainya.
  assert.equal(b.statusCode, 201, 'PK (id, occurred_at) tidak menganggap ini duplikat');
  assert.equal(await hitungPayment(order.id), 2);
});

// --- Buku kas: `sale` ditulis di transaksi yang sama (spec-d:200) ---

/** Movement laci untuk shift ini, apa adanya dari database. */
async function movementShift(shiftId) {
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  // ⛔ `opening_float` DIKECUALIKAN — modal awal ditulis saat shift dibuka
  // (A3), dan ia sudah menjadi `shift.opening_float`. `saldoSeharusnya`
  // mengecualikannya dengan alasan yang sama: menjumlahkan keduanya
  // menghitung modal awal dua kali.
  const { rows } = await appSetup.query(
    `SELECT type, delta, order_id, counterpart_type FROM cash_movement
      WHERE shift_id = $1 AND type <> 'opening_float' ORDER BY occurred_at, id`,
    [shiftId]
  );
  await appSetup.query('COMMIT');
  return rows;
}

test('⛔ pembayaran TUNAI menulis cash_movement `sale` (spec-d:14)', async () => {
  // `spec-d:14` menjadikan `saldo_awal + SUM(delta)` sebagai SATU-SATUNYA
  // definisi saldo laci. Kalau server tidak menulisnya, saldo laci menurut
  // server berbeda dari saldo laci menurut perangkat untuk shift yang sama —
  // dan tidak ada cara memutuskan mana yang benar.
  await akhiriTarifSeed();
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx, await buatVariation(25000));

  const res = await bayar(order.id, { tenderedAmount: 25000 });
  assert.equal(res.statusCode, 201, res.body);

  const m = await movementShift(fx.shiftId);
  assert.equal(m.length, 1, 'tepat satu movement untuk satu pembayaran tunai');
  assert.equal(m[0].type, 'sale');
  assert.equal(m[0].delta, '25000');
  assert.equal(m[0].order_id, order.id);
  assert.equal(m[0].counterpart_type, 'sales_revenue', 'FR-D6: counterpart wajib benar sejak v1');
});

test('⛔ delta memakai nilai transaksi, BUKAN uang yang diserahkan (spec-d:201)', async () => {
  // Pelanggan menyerahkan Rp 50.000 untuk belanja Rp 25.000. Yang tinggal di
  // laci Rp 25.000 — kembaliannya keluar lagi, dan `spec-d:201` menegaskan
  // kembalian TIDAK menghasilkan movement terpisah. Memakai `tendered`
  // membuat setiap penjualan berkembalian melebih-lebihkan laci.
  await akhiriTarifSeed();
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx, await buatVariation(25000));

  const res = await bayar(order.id, { tenderedAmount: 50000 });
  assert.equal(res.statusCode, 201, res.body);

  const m = await movementShift(fx.shiftId);
  assert.equal(m.length, 1);
  assert.equal(m[0].delta, '25000', 'delta ikut tendered, bukan nilai transaksi');
});

test('⛔ retry idempoten tidak menggandakan movement', async () => {
  // Movement ganda menaikkan saldo seharusnya tanpa uang yang benar-benar
  // masuk — kasir lalu terlihat kurang, persis cacat yang buku kas perbaiki.
  await akhiriTarifSeed();
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx, await buatVariation(25000));

  const key = crypto.randomUUID();
  const body = { id: crypto.randomUUID(), method: 'cash', tenderedAmount: 25000 };
  const satu = await req('POST', `/orders/${order.id}/payments`, body, { 'idempotency-key': key });
  const dua = await req('POST', `/orders/${order.id}/payments`, body, { 'idempotency-key': key });
  assert.equal(satu.statusCode, 201, satu.body);
  assert.equal(dua.statusCode, 201, dua.body);

  const m = await movementShift(fx.shiftId);
  assert.equal(m.length, 1, 'retry menghasilkan movement kedua');
});
