'use strict';

// FR-G5 X2–X7 — enam laporan exception sisanya. `spec-g:149`.
//
// "Setiap laporan berasal dari pola deteksi fraud yang terdokumentasi
// industri. Ini fitur yang DIBELI OWNER, bukan sekadar kontrol keamanan."
//
// ⛔ Yang paling menentukan di berkas ini adalah pembandingnya. `spec-g:153`:
// "yang dicari bukan nilai absolut melainkan VARIASI — angka yang lebih tinggi
// dari biasanya untuk orang atau periode tertentu". Laporan yang memakai
// ambang rupiah tetap menandai seluruh kasir di kafe besar dan tidak pernah
// menandai siapa pun di kafe kecil.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');
const { EVENT_NO_SALE } = require('../../packages/domain/src/no-sale.ts');

const MOD = '../../apps/server/src/modules/reporting/handlers/exception.ts';

let owner, appSetup, base, tenant, device, kasirB;
let n = 0;

before(async () => {
  owner = await connectAsOwner();
  appSetup = await connectAsApp();
});

after(async () => {
  await resetAll(owner);
  await owner.end();
  await appSetup.end();
});

beforeEach(async () => {
  await appSetup.query('ROLLBACK').catch(() => {});
  await resetAll(owner);
  base = await seedTenantBase(appSetup, { suffix: 'ExcX27' });
  tenant = base.tenant;
  device = crypto.randomUUID();
  kasirB = crypto.randomUUID();

  await tx(async () => {
    await appSetup.query(
      `INSERT INTO device (id,tenant_id,outlet_id,code,name,platform,app_version,schema_version)
       VALUES ($1,$2,$3,'K1','K1','tauri','0','1')`,
      [device, tenant.id, base.outlet.id]
    );
    await appSetup.query(`INSERT INTO "user" (id,tenant_id,name) VALUES ($1,$2,'Budi Kasir')`, [
      kasirB,
      tenant.id,
    ]);
  });
});

async function tx(fn) {
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  const hasil = await fn();
  await appSetup.query('COMMIT');
  return hasil;
}

async function buatShift({ closedAt = null, closedBy = null, difference = null } = {}) {
  const id = crypto.randomUUID();
  await tx(async () => {
    await appSetup.query(
      `INSERT INTO cash_drawer_shift
         (id,tenant_id,outlet_id,device_id,business_date,status,opening_float,opened_by,
          closed_by,closed_at,difference,counted_amount,expected_amount)
       VALUES ($1,$2,$3,$4,'2026-08-10',$5,0,$6,$7,$8::timestamptz,$9::bigint,0,0)`,
      [
        id, tenant.id, base.outlet.id, device,
        closedAt === null ? 'open' : 'closed',
        base.user.id, closedBy, closedAt, difference,
      ]
    );
  });
  return id;
}

async function jual({ shiftId, total = 100000, createdBy = base.user.id }) {
  const id = crypto.randomUUID();
  n += 1;
  await tx(async () => {
    await appSetup.query(
      `INSERT INTO "order" (id,tenant_id,outlet_id,device_id,shift_id,receipt_number,business_date,
         sequence,status,channel,subtotal,order_discount,service_charge_amount,tax_amount,
         rounding_adjustment,total,amount_due,created_by,occurred_at,hlc)
       VALUES ($1,$2,$3,$4,$5,$6,'2026-08-10',$7::int,'closed','takeaway',$8,0,0,0,0,$8,$8,$9,
               '2026-08-10T10:00:00Z',$7::bigint)`,
      [id, tenant.id, base.outlet.id, device, shiftId, `K1-2026-${n}`, n, total, createdBy]
    );
  });
  return id;
}

async function audit({ eventType, entityId, aktor = base.user.id, penyetuju = null, reason = null, after = null, occurredAt }) {
  n += 1;
  await tx(async () => {
    await appSetup.query(
      `INSERT INTO audit_event (id,tenant_id,outlet_id,device_id,actor_user_id,approver_user_id,
         event_type,entity_type,entity_id,reason_code,after,occurred_at,hlc)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'order',$8,$9,$10::jsonb,$11::timestamptz,$12::bigint)`,
      [
        crypto.randomUUID(), tenant.id, base.outlet.id, device, aktor, penyetuju,
        eventType, entityId, reason, after === null ? null : JSON.stringify(after),
        occurredAt, n,
      ]
    );
  });
}

async function refund({ orderId, amount, reason = 'barang_rusak', oleh = base.user.id, penyetuju = kasirB }) {
  n += 1;
  await tx(async () => {
    await appSetup.query(
      `INSERT INTO refund (id,tenant_id,order_id,amount,reason_code,created_by,approved_by,occurred_at,hlc)
       VALUES ($1,$2,$3,$4::bigint,$5,$6,$7,'2026-08-10T12:00:00Z',$8::bigint)`,
      [crypto.randomUUID(), tenant.id, orderId, amount, reason, oleh, penyetuju, n]
    );
  });
}

const FILTER = { from: '2026-08-10', to: '2026-08-10', outletId: null };

async function baca(nama, filter = FILTER) {
  const mod = await import(MOD);
  return tx(() => mod[nama](appSetup, filter));
}

// ---------------------------------------------------------------------------
// X2 — void mendekati / sesudah tutup shift
// ---------------------------------------------------------------------------

test('X2: void di 60 menit terakhir dan SESUDAH tutup, yang biasa dibuang', async () => {
  const shiftId = await buatShift({
    closedAt: '2026-08-10T15:00:00Z',
    closedBy: base.user.id,
    difference: 0,
  });
  const jauh = await jual({ shiftId });
  const dekat = await jual({ shiftId });
  const sesudah = await jual({ shiftId });

  await audit({ eventType: 'order.voided', entityId: jauh, occurredAt: '2026-08-10T10:00:00Z' });
  await audit({ eventType: 'order.voided', entityId: dekat, occurredAt: '2026-08-10T14:30:00Z' });
  await audit({ eventType: 'order.voided', entityId: sesudah, occurredAt: '2026-08-10T15:30:00Z' });

  const hasil = await baca('ambilVoidDekatTutup');
  // Void biasa sudah ada di X1; mengulangnya di sini membuat pola waktu
  // tenggelam di antara seluruh void.
  assert.equal(hasil.length, 2, JSON.stringify(hasil.map((h) => h.posisi)));
  // `sesudah_tutup` selalu di atas: ia keadaan yang BERBEDA.
  assert.equal(hasil[0].posisi, 'sesudah_tutup');
  assert.equal(hasil[1].posisi, 'akhir_shift');
  assert.equal(hasil[1].menitKeTutup, 30);
});

test('⛔ X2: shift yang BELUM ditutup tidak menghasilkan baris apa pun', async () => {
  const shiftId = await buatShift();
  const order = await jual({ shiftId });
  await audit({ eventType: 'order.voided', entityId: order, occurredAt: '2026-08-10T10:00:00Z' });

  // Menghitung "60 menit terakhir" dari sekarang membuat setiap void pada
  // shift berjalan tertandai selama satu jam lalu berhenti tertandai sendiri.
  assert.deepEqual(await baca('ambilVoidDekatTutup'), []);
});

// ---------------------------------------------------------------------------
// X3 — refund bernilai tinggi
// ---------------------------------------------------------------------------

test('X3: ambang p90 dihitung dari SELURUH refund periode, dan ikut dikembalikan', async () => {
  const shiftId = await buatShift();
  for (const nilai of [10000, 20000, 30000, 40000, 50000, 60000, 70000, 80000, 90000, 500000]) {
    await refund({ orderId: await jual({ shiftId, total: 600000 }), amount: nilai });
  }

  const hasil = await baca('ambilRefundTinggi');
  assert.equal(hasil.jumlahSeluruhRefund, 10);
  // Nearest-rank atas 10 nilai: p90 = nilai ke-9 = 90.000.
  assert.equal(hasil.ambang, '90000');
  assert.equal(hasil.refund.length, 2);
  // Terurut dari yang terbesar — baris teratas paling layak diselidiki.
  assert.equal(hasil.refund[0].nilai, '500000');
  // Alasan dan penyetuju ikut (`spec-g:159`).
  assert.equal(hasil.refund[0].reasonCode, 'barang_rusak');
  assert.equal(hasil.refund[0].penyetujuNama, 'Budi Kasir');
});

test('⛔ X3: periode tanpa refund tidak melempar dan tidak mengarang ambang', async () => {
  const hasil = await baca('ambilRefundTinggi');
  assert.equal(hasil.ambang, '0');
  assert.deepEqual(hasil.refund, []);
});

// ---------------------------------------------------------------------------
// X4 — frekuensi no-sale
// ---------------------------------------------------------------------------

test('X4: no-sale per kasir per shift, dengan rasio terhadap rekan kerja', async () => {
  const shiftId = await buatShift();
  for (let i = 0; i < 6; i += 1) {
    await audit({
      eventType: EVENT_NO_SALE,
      entityId: shiftId,
      aktor: base.user.id,
      occurredAt: '2026-08-10T11:00:00Z',
    });
  }
  await audit({
    eventType: EVENT_NO_SALE,
    entityId: shiftId,
    aktor: kasirB,
    occurredAt: '2026-08-10T11:00:00Z',
  });

  const hasil = await baca('ambilNoSalePerKasir');
  assert.equal(hasil.length, 2);
  // Yang frekuensinya jauh di atas rekan kerja ada di atas.
  assert.equal(hasil[0].jumlah, 6);
  assert.equal(hasil[0].jumlahShift, 1);
  assert.equal(hasil[0].perShift, '6.0');
  // Rata-rata (6+1)/2 = 3,5. 6/3,5 = 1,7.
  assert.equal(hasil[0].rasio, '1.7');
});

// ---------------------------------------------------------------------------
// X5 — diskon manual per kasir
// ---------------------------------------------------------------------------

test('X5: nilai, frekuensi, dan SEBARAN ALASAN per kasir', async () => {
  const shiftId = await buatShift();
  const a = await jual({ shiftId });
  const b = await jual({ shiftId });
  const c = await jual({ shiftId });

  await audit({
    eventType: 'discount_applied', entityId: a, aktor: base.user.id,
    reason: 'karyawan', after: { orderDiscount: 30000 }, occurredAt: '2026-08-10T11:00:00Z',
  });
  await audit({
    eventType: 'discount_applied', entityId: b, aktor: base.user.id,
    reason: 'karyawan', after: { orderDiscount: 20000 }, occurredAt: '2026-08-10T11:30:00Z',
  });
  await audit({
    eventType: 'discount_applied', entityId: c, aktor: kasirB,
    reason: 'promo_berjalan', after: { orderDiscount: 5000 }, occurredAt: '2026-08-10T12:00:00Z',
  });

  const hasil = await baca('ambilDiskonPerKasir');
  assert.equal(hasil.length, 2);
  assert.equal(hasil[0].nilai, '50000');
  assert.equal(hasil[0].jumlah, 2);
  // Sinyal yang `spec-g:161` sebut: bukan diskon besar melainkan diskon yang
  // selalu beralasan sama.
  assert.deepEqual(hasil[0].alasan, [{ reasonCode: 'karyawan', jumlah: 2 }]);
});

test('⛔ X5: diskon berpenyetuju dihitung TERPISAH', async () => {
  const shiftId = await buatShift();
  const a = await jual({ shiftId });
  const b = await jual({ shiftId });
  await audit({
    eventType: 'discount_applied', entityId: a, aktor: base.user.id, penyetuju: kasirB,
    reason: 'kompensasi_keluhan', after: { orderDiscount: 90000 }, occurredAt: '2026-08-10T11:00:00Z',
  });
  await audit({
    eventType: 'discount_applied', entityId: b, aktor: base.user.id,
    reason: 'promo_berjalan', after: { orderDiscount: 1000 }, occurredAt: '2026-08-10T11:00:00Z',
  });

  const hasil = await baca('ambilDiskonPerKasir');
  // Kasir yang seluruh diskonnya di bawah ambang tidak sama dengan kasir yang
  // selalu memanggil manajer — dan laporan yang menggabungkan keduanya tidak
  // dapat membedakannya.
  assert.equal(hasil[0].jumlah, 2);
  assert.equal(hasil[0].jumlahBerpenyetuju, 1);
});

// ---------------------------------------------------------------------------
// X7 — selisih kas per kasir
// ---------------------------------------------------------------------------

test('X7: total, mutlak, arah, dan deretnya', async () => {
  for (const d of [-5000, -6000, -20000, -25000]) {
    await buatShift({ closedAt: '2026-08-10T15:00:00Z', closedBy: base.user.id, difference: d });
  }

  const hasil = await baca('ambilSelisihKasPerKasir');
  assert.equal(hasil.length, 1);
  assert.equal(hasil[0].totalSelisih, '-56000');
  assert.equal(hasil[0].jumlahKurang, 4);
  assert.equal(hasil[0].jumlahLebih, 0);
  // "Selisih konsisten satu arah" (`spec-g:163`).
  assert.equal(hasil[0].tren, 'turun');
  assert.equal(hasil[0].deret.length, 4);
});

test('⛔ X7: total NOL dan mutlak BESAR adalah cerita yang berbeda', async () => {
  for (const d of [50000, -50000]) {
    await buatShift({ closedAt: '2026-08-10T15:00:00Z', closedBy: base.user.id, difference: d });
  }

  const hasil = await baca('ambilSelisihKasPerKasir');
  // Menampilkan salah satunya saja menyembunyikan yang lain: kasir ini tidak
  // "seimbang", ia meleset Rp 100.000 dalam dua shift.
  assert.equal(hasil[0].totalSelisih, '0');
  assert.equal(hasil[0].totalMutlak, '100000');
});

test('⛔ X7: shift yang belum ditutup TIDAK ikut', async () => {
  await buatShift();
  assert.deepEqual(await baca('ambilSelisihKasPerKasir'), []);
});

// ---------------------------------------------------------------------------
// Sifat yang berlaku untuk SELURUH laporan
// ---------------------------------------------------------------------------

test('⛔ tidak ada satu pun field yang menuduh', async () => {
  const shiftId = await buatShift({ closedAt: '2026-08-10T15:00:00Z', closedBy: base.user.id, difference: -9000 });
  const order = await jual({ shiftId });
  await audit({ eventType: 'order.voided', entityId: order, occurredAt: '2026-08-10T14:59:00Z' });
  await refund({ orderId: order, amount: 5000 });
  await audit({
    eventType: 'discount_applied', entityId: order,
    reason: 'karyawan', after: { orderDiscount: 1000 }, occurredAt: '2026-08-10T11:00:00Z',
  });
  await audit({ eventType: EVENT_NO_SALE, entityId: shiftId, occurredAt: '2026-08-10T11:00:00Z' });

  // `spec-g:168`: "produk yang menuduh karyawan merchant akan merusak hubungan
  // merchant dengan stafnya". Yang dikembalikan angka dan konteks.
  const TERLARANG = /mencurigakan|suspicious|fraud|skor|score|pelanggar|nakal/i;
  for (const nama of [
    'ambilVoidDekatTutup',
    'ambilRefundTinggi',
    'ambilNoSalePerKasir',
    'ambilDiskonPerKasir',
    'ambilSelisihKasPerKasir',
  ]) {
    const hasil = await baca(nama);
    assert.equal(
      TERLARANG.test(JSON.stringify(hasil)),
      false,
      `${nama} mengembalikan bahasa menuduh: ${JSON.stringify(hasil)}`
    );
  }
});

test('⛔ saringan outlet berlaku untuk kelimanya', async () => {
  const shiftId = await buatShift({ closedAt: '2026-08-10T15:00:00Z', closedBy: base.user.id, difference: -9000 });
  const order = await jual({ shiftId });
  await audit({ eventType: 'order.voided', entityId: order, occurredAt: '2026-08-10T14:59:00Z' });
  await refund({ orderId: order, amount: 5000 });
  await audit({
    eventType: 'discount_applied', entityId: order,
    reason: 'karyawan', after: { orderDiscount: 1000 }, occurredAt: '2026-08-10T11:00:00Z',
  });
  await audit({ eventType: EVENT_NO_SALE, entityId: shiftId, occurredAt: '2026-08-10T11:00:00Z' });

  const lain = { from: '2026-08-10', to: '2026-08-10', outletId: crypto.randomUUID() };
  assert.deepEqual(await baca('ambilVoidDekatTutup', lain), []);
  assert.deepEqual((await baca('ambilRefundTinggi', lain)).refund, []);
  assert.deepEqual(await baca('ambilNoSalePerKasir', lain), []);
  assert.deepEqual(await baca('ambilDiskonPerKasir', lain), []);
  assert.deepEqual(await baca('ambilSelisihKasPerKasir', lain), []);
});

// ---------------------------------------------------------------------------
// Endpoint — kelima rute benar-benar terpasang, dan penjaganya menyala
// ---------------------------------------------------------------------------
//
// ⛔ `fastify-openapi-glue` mencocokkan handler lewat `operationId`. Handler
// yang salah nama TIDAK menggagalkan boot — rutenya hanya tidak ada, dan itu
// terlihat sebagai 404 di browser berbulan-bulan kemudian. Test di bawah yang
// membuktikan kelimanya benar-benar terpasang.

const RUTE = [
  '/reports/exceptions/shift-end-voids',
  '/reports/exceptions/high-refunds',
  '/reports/exceptions/no-sales',
  '/reports/exceptions/discounts',
  '/reports/exceptions/cash-variance',
];

let appX;
async function panggil(rute, headers = {}, q = 'from=2026-08-10&to=2026-08-10') {
  if (!appX) {
    const { buildApp } = await import('../../apps/server/src/app.ts');
    appX = await buildApp();
  }
  return appX.inject({
    method: 'GET',
    url: `${rute}?${q}`,
    headers: {
      'x-tenant-id': tenant.id,
      authorization: base.authHeader,
      'x-actor-id': base.user.id,
      ...headers,
    },
  });
}

test('kelima rute terpasang dan menjawab 200', async () => {
  for (const rute of RUTE) {
    const res = await panggil(rute);
    assert.equal(res.statusCode, 200, `${rute}: ${res.body}`);
    const body = res.json();
    assert.equal(body.from, '2026-08-10', rute);
  }
});

test('⛔ KASIR tidak dapat membuka satu pun dari kelimanya', async () => {
  // AC `spec-g`: "Kasir tidak dapat mengakses laporan exception". Omzet
  // outletnya sendiri bukan rahasia dari kasir; daftar siapa-membatalkan-apa
  // adalah.
  await tx(async () => {
    await appSetup.query(`DELETE FROM user_role WHERE user_id = $1 AND role <> 'cashier'`, [
      base.user.id,
    ]);
  });

  for (const rute of RUTE) {
    const res = await panggil(rute);
    assert.equal(res.statusCode, 403, `${rute} terbuka untuk kasir: ${res.body}`);
  }
});

test('⛔ rentang yang tidak sah ditolak 400, bukan diam-diam dikosongkan', async () => {
  for (const rute of RUTE) {
    const res = await panggil(rute, {}, 'from=bukan-tanggal&to=2026-08-10');
    assert.equal(res.statusCode, 400, `${rute}: ${res.body}`);
  }
});

test('⛔ outlet tenant LAIN ditolak 404 di kelimanya', async () => {
  const lain = await seedTenantBase(appSetup, { suffix: 'ExcX27Lain' });
  for (const rute of RUTE) {
    const res = await panggil(rute, {}, `from=2026-08-10&to=2026-08-10&outlet_id=${lain.outlet.id}`);
    assert.equal(res.statusCode, 404, `${rute}: ${res.body}`);
  }
});
