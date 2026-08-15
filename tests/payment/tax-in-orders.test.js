'use strict';

// T9-T12 (docs/superpowers/plans/PLAN-pembayaran-pajak.md) -- pajak yang
// SUNGGUHAN mengalir dari tabel tax_rate ke order_line, lewat endpoint.
//
// Resolusinya sendiri (item > category > all_items, outlet > null, channel >
// all) sudah diuji sebagai fungsi murni di tests/domain/tax.test.js. Yang
// diuji DI SINI adalah bahwa jalur database-nya benar-benar memasok kandidat
// yang tepat, dan bahwa snapshot di order_line kebal perubahan tarif.
//
// seedTenantBase menyemai satu tax_rate: PB1 10% INKLUSIF, outlet ini,
// all_items, channel all. Beberapa test di bawah mengakhirinya lebih dulu
// untuk mendapat papan bersih.

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
  base = await seedTenantBase(appSetup, { suffix: 'TaxOrderTest' });
  tenant = base.tenant;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();
});

const BUSINESS_DATE = '2026-08-06';
let deviceCounter = 0;

function req(method, url, payload, headers = {}) {
  const h = { 'x-tenant-id': tenant.id, authorization: base.authHeader, 'x-actor-id': base.user.id, ...headers };
  if (method === 'POST' && url === '/orders' && h['idempotency-key'] === undefined) {
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

let seq = 0;
async function buatOrder({ deviceId, shiftId }, { channel = 'takeaway', variationId = null } = {}) {
  seq += 1;
  const payload = {
    id: crypto.randomUUID(),
    outletId: base.outlet.id,
    deviceId,
    shiftId,
    receiptNumber: `K1-20260806-${String(seq).padStart(4, '0')}`,
    businessDate: BUSINESS_DATE,
    sequence: seq,
    channel,
    checkId: crypto.randomUUID(),
    lines: [{
      id: crypto.randomUUID(),
      variationId: variationId ?? base.item_variation.id,
      quantityMilli: 1000,
      discountAmount: 0,
    }],
  };
  const res = await req('POST', '/orders', payload);
  assert.equal(res.statusCode, 201, res.body);
  return JSON.parse(res.body);
}

// Mengakhiri tarif bawaan seed supaya test punya papan bersih.
async function akhiriTarifSeed() {
  const res = await req('POST', `/tax-rates/${base.tax_rate.id}/end`, {});
  assert.equal(res.statusCode, 200, res.body);
}

async function buatTarif(over = {}) {
  const payload = {
    id: crypto.randomUUID(),
    name: 'PBJT 10%',
    type: 'pbjt',
    rate: '0.1000',
    isInclusive: false,
    ...over,
  };
  const res = await req('POST', '/tax-rates', payload);
  assert.equal(res.statusCode, 201, res.body);
  return JSON.parse(res.body);
}

// --- T11: tarif 0% berbeda dari tidak ada tarif ---

test('tanpa tarif yang berlaku: pajak 0 DAN tidak ada tax_rate_id', async () => {
  await akhiriTarifSeed();
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx);
  assert.equal(order.taxAmount, 0);
  assert.equal(order.lines[0].taxAmount, 0);
  assert.equal(order.lines[0].taxRateId, null, 'tidak ada pajak -> tidak ada baris pajak di struk');
});

test('tarif 0%: pajak 0 TAPI tax_rate_id terisi (AC FR-C6 kelima)', async () => {
  await akhiriTarifSeed();
  const tarif = await buatTarif({ rate: '0.0000', name: 'PPN 0%' });
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx);
  assert.equal(order.taxAmount, 0);
  assert.equal(order.lines[0].taxRateId, tarif.id, '0% TETAP mencetak baris "PPN 0%  Rp 0"');
  assert.equal(order.lines[0].taxRate, '0.0000');
});

// --- T9: penyaringan waktu ---

test('AC FR-C6 pertama: tarif yang sudah diakhiri tidak memengaruhi transaksi baru', async () => {
  await akhiriTarifSeed();
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx);
  assert.equal(order.taxAmount, 0, 'tarif seed sudah diakhiri, jadi tidak berlaku lagi');
});

test('tarif eksklusif 10% menambah total, bukan diekstrak', async () => {
  await akhiriTarifSeed();
  await buatTarif({ rate: '0.1000', isInclusive: false });
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx);
  // base.item_variation.price = 20.000
  assert.equal(order.subtotal, 20000);
  assert.equal(order.taxAmount, 2000, '20.000 x 10%');
  assert.equal(order.total, 22000, 'eksklusif MENAMBAH total');
  assert.equal(order.amountDue, 22000);
});

// --- T10: channel ---

test('FR-C7: tarif channel takeaway menang atas all untuk order takeaway', async () => {
  await akhiriTarifSeed();
  await buatTarif({ rate: '0.1000', channel: 'all', name: 'Umum 10%' });
  await buatTarif({ rate: '0.1100', channel: 'takeaway', name: 'Takeaway 11%' });
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx, { channel: 'takeaway' });
  assert.equal(order.taxAmount, 2200, '20.000 x 11% -- channel spesifik menang');
});

test('FR-C7: order dine_in memakai tarif all, bukan tarif takeaway', async () => {
  await akhiriTarifSeed();
  await buatTarif({ rate: '0.1000', channel: 'all', name: 'Umum 10%' });
  await buatTarif({ rate: '0.1100', channel: 'takeaway', name: 'Takeaway 11%' });
  const fx = await setupDeviceAndShift();
  const order = await buatOrder(fx, { channel: 'dine_in' });
  assert.equal(order.taxAmount, 2000, '20.000 x 10%');
});

// --- T12: snapshot kebal perubahan tarif ---
//
// INI acceptance criteria FR-C6 kedua, dan alasan seluruh mekanisme snapshot
// ada: "Mengubah tarif tidak mengubah nilai pajak pada transaksi yang sudah
// tersimpan." Kalau ini gagal, setiap perubahan perda akan menulis ulang
// riwayat pajak seluruh merchant.

test('AC FR-C6 kedua: mengubah tarif TIDAK mengubah pajak order yang sudah tersimpan', async () => {
  await akhiriTarifSeed();
  const tarifLama = await buatTarif({ rate: '0.1000', isInclusive: false, name: 'PBJT 10%' });
  const fx = await setupDeviceAndShift();

  const orderLama = await buatOrder(fx);
  assert.equal(orderLama.taxAmount, 2000);
  assert.equal(orderLama.lines[0].taxRate, '0.1000');

  // Perda berubah: tarif lama diakhiri, tarif baru dibuat.
  await req('POST', `/tax-rates/${tarifLama.id}/end`, {});
  await buatTarif({ rate: '0.1200', isInclusive: false, name: 'PBJT 12%' });

  // Order BARU memakai tarif baru.
  const orderBaru = await buatOrder(fx);
  assert.equal(orderBaru.taxAmount, 2400, '20.000 x 12%');

  // Order LAMA dibaca ulang -- harus persis seperti saat disimpan.
  const dibaca = await req('GET', `/orders/${orderLama.id}`);
  assert.equal(dibaca.statusCode, 200, dibaca.body);
  const lagi = JSON.parse(dibaca.body);
  assert.equal(lagi.taxAmount, 2000, 'pajak order lama tidak boleh ikut berubah');
  assert.equal(lagi.total, 22000);
  assert.equal(lagi.lines[0].taxRate, '0.1000', 'tarif yang disnapshot, bukan tarif yang berlaku sekarang');
  assert.equal(lagi.lines[0].taxRateId, tarifLama.id);
});

// --- konsistensi: pajak order = jumlah pajak barisnya ---

test('order.tax_amount selalu sama dengan jumlah tax_amount barisnya', async () => {
  await akhiriTarifSeed();
  await buatTarif({ rate: '0.1000', isInclusive: false });
  const fx = await setupDeviceAndShift();
  seq += 1;

  // Tiga baris dengan variation yang sama; pembagian pajak ke baris tidak
  // harus habis, dan struk yang tidak berjumlah adalah persis yang
  // spec-c:126 peringatkan akan ditemukan merchant.
  const payload = {
    id: crypto.randomUUID(),
    outletId: base.outlet.id,
    deviceId: fx.deviceId,
    shiftId: fx.shiftId,
    receiptNumber: `K1-20260806-${String(seq).padStart(4, '0')}`,
    businessDate: BUSINESS_DATE,
    sequence: seq,
    channel: 'takeaway',
    checkId: crypto.randomUUID(),
    lines: [1, 2, 3].map(() => ({
      id: crypto.randomUUID(),
      variationId: base.item_variation.id,
      quantityMilli: 1000,
      discountAmount: 0,
    })),
  };
  const res = await req('POST', '/orders', payload);
  assert.equal(res.statusCode, 201, res.body);
  const order = JSON.parse(res.body);

  const jumlahBaris = order.lines.reduce((s, l) => s + l.taxAmount, 0);
  assert.equal(jumlahBaris, order.taxAmount, 'struk harus berjumlah');
});

// --- FR-C6: tarif ber-scope ITEM benar-benar berlaku ---

test('⛔ tarif ber-scope ITEM berlaku untuk itemnya (FR-C6)', async () => {
  // ⛔ Sampai 14 Agustus 2026 ini TIDAK PERNAH berlaku, dan tidak ada satu pun
  // error. `getVariationSnapshot` memetakan `itemId` dan `categoryId` ke
  // hasilnya tanpa pernah menyeleksi kolomnya, jadi keduanya `undefined` —
  // dan `calculateTax` mencocokkan tarif ber-`applies_to` 'item'/'category'
  // lewat kedua nilai itu. Resolusinya diam-diam jatuh ke `all_items`.
  //
  // Test yang ada hanya menguji PEMBUATAN tarif ber-scope item, bukan
  // penerapannya ke order. Celah itu yang membuatnya bertahan.
  await akhiriTarifSeed();
  const fx = await setupDeviceAndShift();

  await buatTarif({
    name: 'Pajak item khusus 10%',
    appliesTo: 'item',
    appliesToIds: [base.item.id],
  });

  const order = await buatOrder(fx);
  assert.equal(
    order.taxAmount > 0,
    true,
    'tarif ber-scope item tidak berlaku sama sekali — resolusinya jatuh ke all_items'
  );
});

test('⛔ tarif ber-scope item TIDAK berlaku untuk item lain', async () => {
  // Sisi sebaliknya, dan ia yang membuktikan test di atas tidak hijau karena
  // tarifnya kebetulan berlaku untuk semua.
  await akhiriTarifSeed();
  const fx = await setupDeviceAndShift();

  // Item LAIN yang sungguhan — id karangan ditolak `ITEM_NOT_FOUND` oleh
  // guard di `tax-rates.ts`, dan penolakan itu memang benar.
  const lainId = crypto.randomUUID();
  const resItem = await req('POST', '/items', {
    id: lainId,
    name: 'Produk lain',
    variations: [{ id: crypto.randomUUID(), price: 10000 }],
  });
  assert.equal(resItem.statusCode, 201, resItem.body);

  await buatTarif({
    name: 'Pajak item lain 10%',
    appliesTo: 'item',
    appliesToIds: [lainId],
  });

  const order = await buatOrder(fx);
  assert.equal(order.taxAmount, 0, 'tarif item lain ikut dikenakan');
});

// --- F5: nama tarif sebagai SNAPSHOT di order_line ---

test('⛔ order_line menyimpan NAMA tarif, bukan hanya id-nya', async () => {
  // Keputusan user 15 Agustus 2026. Tanpa kolom ini, cetak ulang hanya dapat
  // menulis "Pajak" — nama tarif hidup di `tax_rate`, dan `spec-b:145`
  // melarang cetak ulang menyentuh tabel katalog.
  await akhiriTarifSeed();
  const fx = await setupDeviceAndShift();
  await buatTarif({ name: 'PBJT 10%' });

  const order = await buatOrder(fx);

  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  const { rows } = await appSetup.query(
    'SELECT tax_rate_id, tax_rate_name FROM order_line WHERE order_id = $1',
    [order.id]
  );
  await appSetup.query('COMMIT');

  assert.ok(rows.length > 0, 'order_line tidak ada');
  assert.equal(rows[0].tax_rate_name, 'PBJT 10%', 'nama tarif tidak tersimpan');
  assert.ok(rows[0].tax_rate_id, 'tax_rate_id ikut hilang');
});

test('⛔ baris TANPA tarif menyimpan NULL, bukan string kosong', async () => {
  // `null` berarti "tidak ada tarif yang berlaku"; string kosong akan
  // tercetak sebagai baris pajak tanpa nama di struk.
  await akhiriTarifSeed();
  const fx = await setupDeviceAndShift();

  const order = await buatOrder(fx);

  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  const { rows } = await appSetup.query(
    'SELECT tax_rate_name FROM order_line WHERE order_id = $1',
    [order.id]
  );
  await appSetup.query('COMMIT');

  assert.equal(rows[0].tax_rate_name, null);
});
