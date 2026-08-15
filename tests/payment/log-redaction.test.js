'use strict';

// G10-G11 (PLAN-void-refund-gateway.md §5.7) -- FR-C5, redaksi log.
//
// AC FR-C5 ketiga: "Lapisan logging meredaksi payload pembayaran secara
// otomatis -- diverifikasi test yang mengirim payload berisi pola nomor kartu
// dan memeriksa log."
//
// Kata "lapisan logging" menentukan bentuknya: redaksi tidak boleh bergantung
// pada pemanggil mengingat untuk memakainya. Ia dipasang di logger, sehingga
// SETIAP baris log tersaring -- termasuk yang ditulis kode yang belum ada.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { Writable } = require('node:stream');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');

const REDACTION = '../../apps/server/src/log-redaction.ts';

// --- bagian murni: tanpa database, tanpa server ---

test('nomor kartu di dalam string diredaksi', async () => {
  const { redactSensitive } = await import(REDACTION);
  const hasil = redactSensitive({ reference: 'bayar 4111111111111111 ok' });
  assert.ok(!JSON.stringify(hasil).includes('4111111111111111'));
});

// Bentuk yang paling mungkin diketik orang. Memeriksa digit berurutan saja
// akan meloloskan ketiganya.
test('nomor kartu berspasi dan bertanda hubung ikut diredaksi', async () => {
  const { redactSensitive } = await import(REDACTION);
  for (const nilai of ['4111 1111 1111 1111', '4111-1111-1111-1111', '4111 1111-1111 1111']) {
    const hasil = JSON.stringify(redactSensitive({ note: nilai }));
    assert.ok(!hasil.includes('1111 1111'), nilai);
    assert.ok(!hasil.includes('4111-1111'), nilai);
  }
});

test('nomor kartu bersarang di objek dan array ikut diredaksi', async () => {
  const { redactSensitive } = await import(REDACTION);
  const hasil = JSON.stringify(redactSensitive({
    a: { b: [{ c: '378282246310005' }] },
    d: ['aman', '4111111111111111'],
  }));
  assert.ok(!hasil.includes('378282246310005'));
  assert.ok(!hasil.includes('4111111111111111'));
  assert.ok(hasil.includes('aman'), 'nilai lain tidak boleh ikut hilang');
});

// Kunci gateway dipakai di header Authorization -- itu memang tempatnya. Yang
// dilarang adalah ia mendarat di log.
test('nilai berkunci rahasia diredaksi apa pun isinya', async () => {
  const { redactSensitive } = await import(REDACTION);
  const hasil = JSON.stringify(redactSensitive({
    MIDTRANS_SERVER_KEY: 'SB-Mid-server-ABC',
    authorization: 'Basic c2VjcmV0',
    password: 'rahasia',
    apiToken: 'tok_123',
    biasa: 'boleh tampil',
  }));
  assert.ok(!hasil.includes('SB-Mid-server-ABC'));
  assert.ok(!hasil.includes('c2VjcmV0'));
  assert.ok(!hasil.includes('rahasia'));
  assert.ok(!hasil.includes('tok_123'));
  assert.ok(hasil.includes('boleh tampil'));
});

// Redaksi yang terlalu rakus sama berbahayanya: log yang tidak bisa dipakai
// mendiagnosis apa pun akan dimatikan orang, dan hilanglah seluruh gunanya.
test('angka yang BUKAN nomor kartu tetap terbaca', async () => {
  const { redactSensitive } = await import(REDACTION);
  const hasil = JSON.stringify(redactSensitive({
    total: 1847000,
    receiptNumber: 'K1-20260807-0007',
    hlc: '123456789012',
    orderId: '018f2c1a-7b3e-7c4d-9e2f-1a2b3c4d5e6f',
  }));
  assert.ok(hasil.includes('1847000'));
  assert.ok(hasil.includes('K1-20260807-0007'));
  assert.ok(hasil.includes('123456789012'), '12 digit bukan nomor kartu');
});

test('redaksi tidak mengubah objek aslinya', async () => {
  const { redactSensitive } = await import(REDACTION);
  const asli = { reference: '4111111111111111' };
  redactSensitive(asli);
  assert.equal(asli.reference, '4111111111111111', 'input tidak boleh dimutasi');
});

// Log ditulis di jalur panas. Struktur melingkar tidak boleh menjatuhkan
// server -- kehilangan satu baris log jauh lebih ringan daripada crash.
test('struktur melingkar tidak menjatuhkan redaksi', async () => {
  const { redactSensitive } = await import(REDACTION);
  const a = { nama: 'x' };
  a.diri = a;
  assert.doesNotThrow(() => JSON.stringify(redactSensitive(a)));
});

// --- bagian integrasi: log server sungguhan ---

let owner, appSetup, app, tenant, base, barisLog;

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

function penampungLog() {
  const baris = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      baris.push(chunk.toString());
      cb();
    },
  });
  return { baris, stream };
}

beforeEach(async () => {
  await resetAll(owner);
  base = await seedTenantBase(appSetup, { suffix: 'LogRedact' });
  tenant = base.tenant;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  const { createFakeProvider } = await import('../../apps/server/src/modules/payment/providers/index.ts');
  const penampung = penampungLog();
  barisLog = penampung.baris;
  if (app) await app.close();
  app = await buildApp({
    paymentProvider: createFakeProvider(),
    logger: { level: 'info', stream: penampung.stream },
  });
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

async function setupOrder() {
  deviceCounter += 1;
  seq += 1;
  const deviceId = crypto.randomUUID();
  await req('POST', '/devices', { id: deviceId, outletId: base.outlet.id, code: `K${deviceCounter}` });
  const shiftId = crypto.randomUUID();
  await req('POST', '/shifts', {
    id: shiftId, outletId: base.outlet.id, deviceId, businessDate: BUSINESS_DATE, openingFloat: 100000,
  });
  const itemId = crypto.randomUUID();
  const variationId = crypto.randomUUID();
  await app.inject({
    method: 'POST', url: '/items',
    payload: { id: itemId, name: `P${seq}`, variations: [{ id: variationId, price: 20000 }] },
    headers: { 'x-tenant-id': tenant.id , authorization: base.authHeader},
  });
  const orderId = crypto.randomUUID();
  const res = await req('POST', '/orders', {
    id: orderId, outletId: base.outlet.id, deviceId, shiftId,
    receiptNumber: `K1-20260807-${String(seq).padStart(4, '0')}`,
    businessDate: BUSINESS_DATE, sequence: seq, channel: 'takeaway',
    checkId: crypto.randomUUID(),
    lines: [{ id: crypto.randomUUID(), variationId, quantityMilli: 1000, discountAmount: 0 }],
  });
  assert.equal(res.statusCode, 201, res.body);
  return orderId;
}

const PAN = '4111111111111111';

// AC FR-C5 ketiga, dijalankan apa adanya: kirim payload berisi pola nomor
// kartu, lalu periksa log.
test('payload pembayaran berisi pola nomor kartu tidak muncul utuh di log', async () => {
  const orderId = await setupOrder();
  const res = await req('POST', `/orders/${orderId}/payments`, {
    id: crypto.randomUUID(), method: 'qris_static', amount: 20000, reference: PAN,
  });
  assert.equal(res.statusCode, 400, res.body);

  const semua = barisLog.join('\n');
  assert.ok(semua.length > 0, 'log harus benar-benar menulis sesuatu, kalau tidak test ini kosong');
  assert.ok(!semua.includes(PAN), `nomor kartu bocor ke log:\n${semua}`);
});

test('nomor kartu berspasi di payload juga tidak muncul di log', async () => {
  const orderId = await setupOrder();
  await req('POST', `/orders/${orderId}/payments`, {
    id: crypto.randomUUID(), method: 'qris_static', amount: 20000, reference: '4111 1111 1111 1111',
  });
  const semua = barisLog.join('\n');
  assert.ok(!semua.includes('1111 1111 1111'), `nomor kartu bocor ke log:\n${semua}`);
});

// Payload yang DITERIMA juga harus tersaring, bukan hanya yang ditolak.
// Approval code EDC sah dan tersimpan; kalau lapisan log hanya menyaring jalur
// error, transaksi yang berhasil justru yang bocor.
test('payload pembayaran yang BERHASIL juga tersaring', async () => {
  const orderId = await setupOrder();
  const res = await req('POST', `/orders/${orderId}/payments`, {
    id: crypto.randomUUID(), method: 'card_edc', amount: 20000,
    approvalCode: '123456', cardLast4: '1111', terminalReference: `TID ${PAN}`,
  });
  assert.equal(res.statusCode, 400, res.body);
  const semua = barisLog.join('\n');
  assert.ok(!semua.includes(PAN), `nomor kartu bocor ke log:\n${semua}`);
});

// G11 -- kunci gateway tidak pernah mendarat di log.
//
// Diuji lewat NILAI-nya, bukan hanya nama field: kunci yang menyelinap ke dalam
// pesan error muncul sebagai teks bebas, tanpa nama field apa pun yang bisa
// dikenali. Itu jalur kebocoran yang paling mungkin, dan penyaringan berbasis
// nama sama sekali tidak menutupnya.
test('nilai MIDTRANS_SERVER_KEY tidak muncul di log, di mana pun ia diletakkan', async () => {
  const { buildApp } = await import('../../apps/server/src/app.ts');
  const { createFakeProvider } = await import('../../apps/server/src/modules/payment/providers/index.ts');

  const asli = process.env.MIDTRANS_SERVER_KEY;
  const kunciPalsu = 'SB-Mid-server-BOCOR123456';
  process.env.MIDTRANS_SERVER_KEY = kunciPalsu;
  const penampung = penampungLog();
  let app2;
  try {
    app2 = await buildApp({
      paymentProvider: createFakeProvider(),
      logger: { level: 'info', stream: penampung.stream },
    });
    // Tiga tempat berbeda: nama field, teks bebas, dan di dalam sebuah Error.
    app2.log.info({ MIDTRANS_SERVER_KEY: kunciPalsu }, 'lewat nama field');
    app2.log.info({ catatan: `kunci kami ${kunciPalsu} bocor` }, 'lewat teks bebas');
    app2.log.error({ err: new Error(`gagal auth dengan ${kunciPalsu}`) }, 'lewat pesan error');
  } finally {
    if (app2) await app2.close();
    if (asli === undefined) delete process.env.MIDTRANS_SERVER_KEY;
    else process.env.MIDTRANS_SERVER_KEY = asli;
  }

  const semua = penampung.baris.join('\n');
  assert.ok(semua.length > 0, 'log harus benar-benar menulis sesuatu');
  assert.ok(!semua.includes(kunciPalsu), `kunci bocor ke log:\n${semua}`);
});

// Redaksi dipasang di LAPISAN LOGGING, bukan di pemanggil. Kalau ia hidup di
// tiap handler, jalur yang lupa memakainya akan bocor -- dan jalur itu belum
// tentu sudah ditulis hari ini.
test('baris log apa pun tersaring, termasuk yang ditulis kode lain', async () => {
  app.log.info({ apa: { pun: { dalam: PAN } } }, 'baris sembarang');
  const semua = barisLog.join('\n');
  assert.ok(!semua.includes(PAN), `bocor:\n${semua}`);
});

test('log tetap berisi informasi yang dapat dipakai mendiagnosis', async () => {
  const orderId = await setupOrder();
  await req('POST', `/orders/${orderId}/payments`, {
    id: crypto.randomUUID(), method: 'qris_static', amount: 20000, reference: 'BCA 4821',
  });
  const semua = barisLog.join('\n');
  assert.ok(semua.includes('BCA 4821'), 'referensi sah harus tetap terbaca di log');
});
