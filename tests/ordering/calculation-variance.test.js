'use strict';

// H1-H6 (docs/superpowers/plans/PLAN-f2-sinkronisasi.md §5.1) -- FR-H6,
// validasi ulang di server.
//
// spec-h:77 -- "Klien tidak dipercaya. Server menghitung ulang total
// transaksi dari katalog dan aturan pajak yang berlaku pada `occurred_at`."
//
// ## Aturan yang berlawanan dengan naluri, dan justru itu intinya
//
// spec-h:95 -- "Server TIDAK MENOLAK transaksi yang selisih. Menolak berarti
// kehilangan penjualan yang sudah terjadi dan uangnya sudah diterima
// merchant. Yang benar adalah menerima, menandai, dan melaporkan."
//
// Setiap test di bawah yang mengirim angka salah karena itu tetap menuntut
// 201. Yang diperiksa bukan penolakannya, melainkan penandaannya.

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
  base = await seedTenantBase(appSetup, { suffix: 'Variance' });
  tenant = base.tenant;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();
  await akhiriTarifSeed();
});

const BUSINESS_DATE = '2026-08-07';
let deviceCounter = 0;
let seq = 0;

function req(method, url, payload, headers = {}) {
  const h = { 'x-tenant-id': tenant.id, 'x-actor-id': base.user.id, ...headers };
  if (method === 'POST' && url === '/orders' && h['idempotency-key'] === undefined) {
    h['idempotency-key'] = crypto.randomUUID();
  }
  return app.inject({ method, url, payload, headers: h });
}

// Pajak diakhiri supaya total dapat diprediksi angka per angka -- berkas ini
// soal selisih perhitungan, bukan soal pajak.
async function akhiriTarifSeed() {
  const res = await req('POST', `/tax-rates/${base.tax_rate.id}/end`, {});
  assert.equal(res.statusCode, 200, res.body);
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

async function buatVariation(price) {
  const itemId = crypto.randomUUID();
  const variationId = crypto.randomUUID();
  const res = await app.inject({
    method: 'POST', url: '/items',
    payload: { id: itemId, name: `P${variationId.slice(0, 6)}`, variations: [{ id: variationId, price }] },
    headers: { 'x-tenant-id': tenant.id },
  });
  assert.equal(res.statusCode, 201, res.body);
  return { itemId, variationId };
}

async function ubahHarga({ itemId, variationId }, price, effectiveFrom) {
  const res = await req('POST', `/items/${itemId}/variations/${variationId}/prices`, {
    id: crypto.randomUUID(), price, effectiveFrom,
  });
  assert.equal(res.statusCode, 201, res.body);
}

// Jam DATABASE, bukan jam Node. CLAUDE.md mencatat bug nyata di repo ini:
// resolusi harga menstempel effective_from dengan jam PostgreSQL tapi membaca
// `at` dari jam Node, dan skew +-2 ms menggagalkan 4 dari 12 run. Test yang
// menghitung waktunya sendiri di Node akan menghidupkan bug itu kembali,
// kali ini sebagai kegagalan yang berkedip.
async function jamDatabase() {
  const rows = await query('SELECT now() AS t');
  return rows[0].t;
}

function geser(waktu, detik) {
  return new Date(waktu.getTime() + detik * 1000).toISOString();
}

async function buatOrder(fx, lines, over = {}) {
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
    lines,
    ...over,
  };
  const res = await req('POST', '/orders', payload);
  return res;
}

function baris(variationId, over = {}) {
  return { id: crypto.randomUUID(), variationId, quantityMilli: 1000, discountAmount: 0, ...over };
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

// ============================================================
// H1 -- harga dihitung pada occurred_at, bukan saat paketnya sampai
// ============================================================

// Ini perubahan perilaku pada jalur yang sudah hidup, dan spec-h:77
// menuntutnya: "aturan pajak yang berlaku pada `occurred_at`".
//
// Order yang antre offline berjam-jam harus dihitung dengan harga saat
// PENJUALAN TERJADI. Memakai harga saat paketnya sampai berarti merchant yang
// menaikkan harga sore hari mendapati penjualan pagi ikut naik -- struk yang
// sudah dipegang pelanggan tidak lagi cocok dengan yang tersimpan.
test('order offline memakai harga yang berlaku saat penjualan terjadi', async () => {
  const fx = await setupDeviceAndShift();
  const v = await buatVariation(10000);
  const sekarang = await jamDatabase();
  await ubahHarga(v, 25000, geser(sekarang, -60));

  // occurredAt DUA menit lalu -- sebelum harga naik satu menit lalu.
  const res = await buatOrder(fx, [baris(v.variationId)], { occurredAt: geser(sekarang, -120) });
  assert.equal(res.statusCode, 201, res.body);
  const body = JSON.parse(res.body);
  assert.equal(body.lines[0].unitPrice, 10000, 'harga LAMA yang berlaku saat penjualan terjadi');
  assert.equal(body.total, 10000);
});

test('order yang terjadi setelah harga naik memakai harga baru', async () => {
  const fx = await setupDeviceAndShift();
  const v = await buatVariation(10000);
  const sekarang = await jamDatabase();
  await ubahHarga(v, 25000, geser(sekarang, -120));

  const res = await buatOrder(fx, [baris(v.variationId)], { occurredAt: geser(sekarang, -60) });
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(JSON.parse(res.body).lines[0].unitPrice, 25000);
});

// Tanpa occurredAt, perilakunya harus persis seperti sebelumnya: jam
// DATABASE. Klien versi N-1 tidak mengirim field ini.
test('tanpa occurredAt, harga dihitung pada jam database seperti sebelumnya', async () => {
  const fx = await setupDeviceAndShift();
  const v = await buatVariation(10000);
  const sekarang = await jamDatabase();
  await ubahHarga(v, 25000, geser(sekarang, -60));

  const res = await buatOrder(fx, [baris(v.variationId)]);
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(JSON.parse(res.body).lines[0].unitPrice, 25000, 'harga yang berlaku SEKARANG');
});

// ============================================================
// H2-H3 -- total klien dibandingkan, selisih ditandai, transaksi DITERIMA
// ============================================================

test('total klien yang cocok tidak menghasilkan penanda apa pun', async () => {
  const fx = await setupDeviceAndShift();
  const v = await buatVariation(20000);

  const res = await buatOrder(fx, [baris(v.variationId, { unitPrice: 20000 })], { total: 20000 });
  assert.equal(res.statusCode, 201, res.body);
  const body = JSON.parse(res.body);
  assert.equal(body.hasCalculationVariance, false);

  const rows = await query('SELECT has_calculation_variance, variance_amount FROM "order" WHERE id = $1', [body.id]);
  assert.equal(rows[0].has_calculation_variance, false);
  assert.equal(rows[0].variance_amount, null);
});

// AC pertama FR-H6, dan aturan yang paling mudah dilanggar orang berikutnya.
test('total klien yang TIDAK dapat dijelaskan tetap diterima 201, dan ditandai', async () => {
  const fx = await setupDeviceAndShift();
  const v = await buatVariation(20000);

  // 5000 tidak pernah menjadi harga variation ini -- tidak dapat dijelaskan.
  const res = await buatOrder(fx, [baris(v.variationId, { unitPrice: 5000 })], { total: 5000 });
  assert.equal(res.statusCode, 201, res.body);
  const body = JSON.parse(res.body);
  assert.equal(body.hasCalculationVariance, true);

  const rows = await query('SELECT has_calculation_variance, variance_amount, total FROM "order" WHERE id = $1', [body.id]);
  assert.equal(rows[0].has_calculation_variance, true);
  // Selisih = total klien - total server.
  assert.equal(rows[0].variance_amount, '-15000');
  // Dan yang TERSIMPAN sebagai angka transaksi adalah hitungan SERVER.
  assert.equal(rows[0].total, '20000');
});

test('selisih ke arah sebaliknya juga ditandai', async () => {
  const fx = await setupDeviceAndShift();
  const v = await buatVariation(20000);
  const res = await buatOrder(fx, [baris(v.variationId, { unitPrice: 99000 })], { total: 99000 });
  assert.equal(res.statusCode, 201, res.body);

  const rows = await query('SELECT variance_amount FROM "order" WHERE id = $1', [JSON.parse(res.body).id]);
  assert.equal(rows[0].variance_amount, '79000');
});

// Klien versi N-1 tidak mengirim total sama sekali. Ia tidak boleh patah, dan
// tidak boleh ditandai selisih hanya karena diam.
test('tanpa total dari klien, tidak ada yang dibandingkan dan tidak ada penanda', async () => {
  const fx = await setupDeviceAndShift();
  const v = await buatVariation(20000);
  const res = await buatOrder(fx, [baris(v.variationId)]);
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(JSON.parse(res.body).hasCalculationVariance, false);
});

// ============================================================
// H4 -- selisih yang DAPAT dijelaskan riwayat harga tidak ditandai
// ============================================================

// AC kedua FR-H6. spec-h:97 -- "Sumber selisih yang wajar: harga berubah
// setelah perangkat terakhir tersinkron. Ini bukan anomali dan tidak boleh
// membanjiri laporan."
//
// Perangkat yang seminggu offline memakai harga seminggu lalu. Menandainya
// berarti setiap order dari perangkat itu masuk laporan exception, dan
// laporan yang penuh hal normal tidak akan dibaca siapa pun.
test('klien yang memakai harga LAMA tidak ditandai -- ia hanya belum tersinkron', async () => {
  const fx = await setupDeviceAndShift();
  const v = await buatVariation(10000);
  const sekarang = await jamDatabase();
  await ubahHarga(v, 25000, geser(sekarang, -60));

  // Penjualan terjadi SEKARANG (harga sah 25000), tapi perangkat masih
  // memakai 10000 -- harga yang pernah berlaku sebelum ia offline.
  const res = await buatOrder(fx, [baris(v.variationId, { unitPrice: 10000 })], { total: 10000 });
  assert.equal(res.statusCode, 201, res.body);
  const body = JSON.parse(res.body);
  assert.equal(body.hasCalculationVariance, false, 'harga usang bukan anomali');

  const rows = await query('SELECT has_calculation_variance, total FROM "order" WHERE id = $1', [body.id]);
  assert.equal(rows[0].has_calculation_variance, false);
  // Tetap disimpan dengan hitungan SERVER: klien tidak dipercaya, walau
  // selisihnya dimaklumi.
  assert.equal(rows[0].total, '25000');
});

// Harga MASA DEPAN yang belum berlaku bukan penjelasan. Perangkat tidak
// mungkin memakainya karena belum pernah berlaku saat penjualan terjadi.
test('harga terjadwal masa depan bukan penjelasan yang sah', async () => {
  const fx = await setupDeviceAndShift();
  const v = await buatVariation(10000);
  const sekarang = await jamDatabase();
  await ubahHarga(v, 50000, geser(sekarang, 3600));

  const res = await buatOrder(fx, [baris(v.variationId, { unitPrice: 50000 })], { total: 50000 });
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(JSON.parse(res.body).hasCalculationVariance, true, 'harga yang belum pernah berlaku tidak menjelaskan apa pun');
});

// ============================================================
// H5 -- audit_event, dengan konteks yang dituntut AC keempat
// ============================================================

test('selisih yang ditandai memancarkan audit_event calculation_variance', async () => {
  const fx = await setupDeviceAndShift();
  const v = await buatVariation(20000);
  const res = await buatOrder(fx, [baris(v.variationId, { unitPrice: 5000 })], { total: 5000 });
  assert.equal(res.statusCode, 201, res.body);
  const orderId = JSON.parse(res.body).id;

  const events = await query(`SELECT * FROM audit_event WHERE event_type = 'calculation_variance'`);
  assert.equal(events.length, 1);
  const e = events[0];
  assert.equal(e.entity_type, 'order');
  assert.equal(e.entity_id, orderId);
  // AC keempat menuntut laporan menampilkan device, waktu, dan selisih.
  // Datanya harus ada di sini, karena laporannya (Modul G) membacanya dari
  // sini.
  assert.equal(e.device_id, fx.deviceId);
  assert.ok(e.occurred_at, 'waktu wajib');
  assert.equal(e.after.varianceAmount, -15000);
  assert.equal(e.after.serverTotal, 20000);
  assert.equal(e.after.clientTotal, 5000);
  // Bukan tindakan orang: tidak ada penyetuju.
  assert.equal(e.approver_user_id, null);
});

test('selisih yang dimaklumi TIDAK memancarkan audit_event', async () => {
  const fx = await setupDeviceAndShift();
  const v = await buatVariation(10000);
  const sekarang = await jamDatabase();
  await ubahHarga(v, 25000, geser(sekarang, -60));

  const res = await buatOrder(fx, [baris(v.variationId, { unitPrice: 10000 })], { total: 10000 });
  assert.equal(res.statusCode, 201, res.body);

  const events = await query(`SELECT id FROM audit_event WHERE event_type = 'calculation_variance'`);
  assert.equal(events.length, 0, 'laporan exception tidak boleh dibanjiri hal normal');
});

test('order tanpa selisih tidak memancarkan audit_event', async () => {
  const fx = await setupDeviceAndShift();
  const v = await buatVariation(20000);
  await buatOrder(fx, [baris(v.variationId, { unitPrice: 20000 })], { total: 20000 });
  const events = await query(`SELECT id FROM audit_event`);
  assert.equal(events.length, 0);
});

// ============================================================
// H6 -- klien tidak dipercaya, sebagai invariant yang diuji
// ============================================================

// LCG deterministik, tanpa dependency baru, kegagalannya dapat direproduksi
// persis.
function buatRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// "Klien tidak dipercaya" harus jadi invariant yang diuji, bukan slogan di
// komentar. Apa pun angka yang dikirim klien, yang TERSIMPAN adalah hitungan
// server -- dan `variance_amount` selalu selisih keduanya, tidak pernah
// mengubah totalnya.
test('property: angka yang tersimpan selalu angka server, apa pun yang dikirim klien', async () => {
  const fx = await setupDeviceAndShift();
  const rng = buatRng(20260807);
  let ditandai = 0;
  let bersih = 0;

  for (let i = 0; i < 25; i += 1) {
    const hargaSah = 1000 * (1 + Math.floor(rng() * 50));
    const v = await buatVariation(hargaSah);
    const hargaKlien = 1000 * (1 + Math.floor(rng() * 50));

    const res = await buatOrder(fx, [baris(v.variationId, { unitPrice: hargaKlien })], { total: hargaKlien });
    assert.equal(res.statusCode, 201, res.body);
    const body = JSON.parse(res.body);

    const rows = await query(
      'SELECT total, has_calculation_variance, variance_amount FROM "order" WHERE id = $1',
      [body.id]
    );
    const r = rows[0];
    assert.equal(r.total, String(hargaSah), `total tersimpan harus hitungan server (i=${i})`);

    if (hargaKlien === hargaSah) {
      assert.equal(r.has_calculation_variance, false);
      assert.equal(r.variance_amount, null);
      bersih += 1;
    } else {
      assert.equal(r.has_calculation_variance, true, `i=${i} klien=${hargaKlien} server=${hargaSah}`);
      assert.equal(r.variance_amount, String(hargaKlien - hargaSah));
      ditandai += 1;
    }
  }

  // Menjaga test ini tidak lulus karena tidak menguji apa-apa.
  assert.ok(ditandai > 15, `terlalu sedikit yang ditandai: ${ditandai}`);
  assert.ok(bersih >= 0);
});

// Ditemukan sabotase: memeriksa harga per baris SAJA membiarkan lubang yang
// justru paling penting ditangkap FR-H6.
//
// Klien mengirim harga per baris yang BENAR, tapi totalnya salah. Tidak ada
// harga usang yang menjelaskannya -- aritmetika kliennya yang keliru. Sebelum
// diperbaiki, order seperti ini lolos tanpa penanda sama sekali.
test('harga per baris benar tapi total salah TETAP ditandai', async () => {
  const fx = await setupDeviceAndShift();
  const v = await buatVariation(20000);

  const res = await buatOrder(fx, [baris(v.variationId, { unitPrice: 20000 })], { total: 19000 });
  assert.equal(res.statusCode, 201, res.body);
  const body = JSON.parse(res.body);
  assert.equal(body.hasCalculationVariance, true, 'aritmetika klien yang salah bukan harga usang');

  const rows = await query('SELECT variance_amount, total FROM "order" WHERE id = $1', [body.id]);
  assert.equal(rows[0].variance_amount, '-1000');
  assert.equal(rows[0].total, '20000');
});

// Dan kebalikannya harus tetap dimaklumi: harga usang DAN total yang konsisten
// dengan harga usang itu.
test('harga usang dengan total yang konsisten dengannya tetap tidak ditandai', async () => {
  const fx = await setupDeviceAndShift();
  const v = await buatVariation(10000);
  const sekarang = await jamDatabase();
  await ubahHarga(v, 25000, geser(sekarang, -60));

  // Dua unit dengan harga lama: 2 x 10000 = 20000, konsisten.
  const res = await buatOrder(
    fx,
    [baris(v.variationId, { unitPrice: 10000, quantityMilli: 2000 })],
    { total: 20000 }
  );
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(JSON.parse(res.body).hasCalculationVariance, false);

  const rows = await query('SELECT total FROM "order" WHERE id = $1', [JSON.parse(res.body).id]);
  assert.equal(rows[0].total, '50000', 'yang tersimpan tetap hitungan server: 2 x 25000');
});
