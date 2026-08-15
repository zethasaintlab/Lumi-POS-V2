'use strict';

// B-21 — pelacakan pelaku pembatalan (FR-G5 X1).
//
// ⛔ Sejak keputusan 1 Agustus 2026 menghapus PIN manajer dari void, laporan
// exception adalah SATU-SATUNYA kontrol yang tersisa terhadap
// penyalahgunaannya (`CLAUDE.md`). Yang dibuktikan berkas ini: pelakunya dapat
// dilacak akurat, termasuk saat ia BUKAN kasir yang menjual.
//
// Belum ada endpoint — helper diuji langsung.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');

const MOD = '../../apps/server/src/modules/ordering/handlers/exceptions-data.ts';

let owner, appSetup, base, tenant, device, shift, manajer;

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
  base = await seedTenantBase(appSetup, { suffix: 'ExcTest' });
  tenant = base.tenant;
  device = crypto.randomUUID();
  shift = crypto.randomUUID();
  manajer = crypto.randomUUID();

  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await appSetup.query(
    `INSERT INTO device (id,tenant_id,outlet_id,code,name,platform,app_version,schema_version)
     VALUES ($1,$2,$3,'K1','K1','tauri','0','1')`,
    [device, tenant.id, base.outlet.id]
  );
  await appSetup.query(
    `INSERT INTO cash_drawer_shift (id,tenant_id,outlet_id,device_id,business_date,status,opening_float,opened_by)
     VALUES ($1,$2,$3,$4,'2026-08-10','open',0,$5)`,
    [shift, tenant.id, base.outlet.id, device, base.user.id]
  );
  await appSetup.query(`INSERT INTO "user" (id,tenant_id,name) VALUES ($1,$2,'Doni Manajer')`, [
    manajer,
    tenant.id,
  ]);
  await appSetup.query('COMMIT');
});

let n = 0;

async function jual({ createdBy, total = 100000 }) {
  const id = crypto.randomUUID();
  n += 1;
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await appSetup.query(
    `INSERT INTO "order" (id,tenant_id,outlet_id,device_id,shift_id,receipt_number,business_date,
       sequence,status,channel,subtotal,order_discount,service_charge_amount,tax_amount,
       rounding_adjustment,total,amount_due,created_by,occurred_at,hlc)
     VALUES ($1,$2,$3,$4,$5,$6,'2026-08-10',$7::int,'closed','takeaway',$8,0,0,0,0,$8,$8,$9,
             '2026-08-10T10:00:00Z',$7::bigint)`,
    [id, tenant.id, base.outlet.id, device, shift, `K1-2026-${n}`, n, total, createdBy]
  );
  await appSetup.query('COMMIT');
  return id;
}

/** Menulis `audit_event` persis seperti `cancel.ts` melakukannya. */
async function catatAudit({ orderId, jenis, aktor, penyetuju = null, reason = 'salah_input' }) {
  n += 1;
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await appSetup.query(
    `INSERT INTO audit_event (id,tenant_id,outlet_id,device_id,actor_user_id,approver_user_id,
       event_type,entity_type,entity_id,reason_code,reason_note,occurred_at,hlc)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'order',$8,$9,NULL,'2026-08-10T11:00:00Z',$10::bigint)`,
    [
      crypto.randomUUID(),
      tenant.id,
      base.outlet.id,
      device,
      aktor,
      penyetuju,
      jenis === 'void' ? 'order.voided' : 'order.refunded',
      orderId,
      reason,
      n,
    ]
  );
  await appSetup.query('COMMIT');
}

async function baca(outletId = null) {
  const { ambilPeristiwaException } = await import(MOD);
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  const hasil = await ambilPeristiwaException(appSetup, {
    from: '2026-08-10',
    to: '2026-08-10',
    outletId,
  });
  await appSetup.query('COMMIT');
  return hasil;
}

// ---------------------------------------------------------------------------

test('⛔ pelaku pembatalan terlacak meski ia BUKAN kasir yang menjual', async () => {
  // Inti berkas ini. B-18 sengaja melekatkan void pada pemilik penjualan;
  // pertanyaan "siapa yang menekan tombol" hanya dapat dijawab di sini.
  const order = await jual({ createdBy: base.user.id, total: 50000 });
  await catatAudit({ orderId: order, jenis: 'void', aktor: manajer });

  const hasil = await baca();
  assert.equal(hasil.length, 1);
  assert.equal(hasil[0].aktorId, manajer, 'pelaku pembatalan tidak terlacak');
  assert.equal(hasil[0].aktorNama, 'Doni Manajer');
  assert.equal(hasil[0].jenis, 'void');
  assert.equal(hasil[0].nilai, '50000');
  assert.equal(hasil[0].reasonCode, 'salah_input');
});

test('⛔ nilai diambil dari order.total, bukan dari payload audit', async () => {
  // `cancel.ts` menulis `before: { total: Number(asli.total) }` — `Number()`
  // atas `bigint`. Di atas 2^53 presisinya hilang, dan nilainya sudah
  // terlanjur tersimpan begitu di jsonb.
  const besar = '9007199254740993';
  const order = await jual({ createdBy: base.user.id, total: besar });
  await catatAudit({ orderId: order, jenis: 'void', aktor: base.user.id });

  const hasil = await baca();
  assert.equal(hasil[0].nilai, besar, 'presisi nilai hilang');
});

test('penyetuju refund ikut, dan ia berbeda dari aktor', async () => {
  // `audit_event` punya CHECK yang menjamin approver <> actor.
  const order = await jual({ createdBy: base.user.id });
  await catatAudit({ orderId: order, jenis: 'refund', aktor: base.user.id, penyetuju: manajer });

  const hasil = await baca();
  assert.equal(hasil[0].jenis, 'refund');
  assert.equal(hasil[0].penyetujuId, manajer);
  assert.equal(hasil[0].penyetujuNama, 'Doni Manajer');
});

test('void tanpa penyetuju tetap terbaca — void memang tanpa PIN manajer', async () => {
  // Keputusan 1 Agustus 2026: void TANPA PIN manajer. `approver_user_id`
  // karena itu NULL, dan laporan tidak boleh menjatuhkan barisnya.
  const order = await jual({ createdBy: base.user.id });
  await catatAudit({ orderId: order, jenis: 'void', aktor: base.user.id });

  const hasil = await baca();
  assert.equal(hasil.length, 1);
  assert.equal(hasil[0].penyetujuId, null);
  assert.equal(hasil[0].penyetujuNama, null);
});

test('⛔ peristiwa DI LUAR rentang tanggal bisnis tidak ikut', async () => {
  // Rentangnya memakai `order.business_date`, sama seperti keempat laporan
  // lain — bukan `audit_event.occurred_at`.
  const order = await jual({ createdBy: base.user.id });
  await catatAudit({ orderId: order, jenis: 'void', aktor: base.user.id });

  const { ambilPeristiwaException } = await import(MOD);
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  const lain = await ambilPeristiwaException(appSetup, {
    from: '2026-09-01',
    to: '2026-09-30',
    outletId: null,
  });
  await appSetup.query('COMMIT');
  assert.deepEqual(lain, []);
});

test('event_type LAIN tidak ikut — hanya void dan refund', async () => {
  const order = await jual({ createdBy: base.user.id });
  n += 1;
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await appSetup.query(
    `INSERT INTO audit_event (id,tenant_id,outlet_id,actor_user_id,event_type,entity_type,
       entity_id,occurred_at,hlc)
     VALUES ($1,$2,$3,$4,'calculation_variance','order',$5,'2026-08-10T11:00:00Z',$6::bigint)`,
    [crypto.randomUUID(), tenant.id, base.outlet.id, base.user.id, order, n]
  );
  await appSetup.query('COMMIT');

  assert.deepEqual(await baca(), []);
});

test('⛔ peristiwa tenant lain tidak pernah ikut', async () => {
  const lain = await seedTenantBase(appSetup, { suffix: 'ExcLain' });
  const order = await jual({ createdBy: base.user.id });
  await catatAudit({ orderId: order, jenis: 'void', aktor: base.user.id });

  const { ambilPeristiwaException } = await import(MOD);
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [lain.tenant.id]);
  const hasil = await ambilPeristiwaException(appSetup, {
    from: '2026-08-10',
    to: '2026-08-10',
    outletId: null,
  });
  await appSetup.query('COMMIT');
  assert.deepEqual(hasil, []);
});

// --- ringkasan (murni, tanpa database) ---------------------------------------

const P = (over) => ({
  auditId: 'a', occurredAt: 'x', recordedAt: 'x', jenis: 'void',
  aktorId: 'u1', aktorNama: 'Sari', penyetujuId: null, penyetujuNama: null,
  orderId: 'o', receiptNumber: 'K1', nilai: '50000',
  reasonCode: 'salah_input', reasonNote: null, outletId: null, ...over,
});

test('⛔ rasio dihitung terhadap RATA-RATA, bukan nilai absolut', async () => {
  // `spec-g`: "yang dicari bukan nilai absolut melainkan VARIASI". Contoh
  // ACnya: Sari 12 void, rata-rata kasir lain 3, rasio 4,0×.
  const { ringkasPerAktor } = await import(MOD);
  const peristiwa = [
    ...Array.from({ length: 12 }, (_, i) => P({ auditId: `s${i}`, aktorId: 'sari', aktorNama: 'Sari' })),
    ...Array.from({ length: 3 }, (_, i) => P({ auditId: `b${i}`, aktorId: 'budi', aktorNama: 'Budi' })),
    ...Array.from({ length: 3 }, (_, i) => P({ auditId: `c${i}`, aktorId: 'cici', aktorNama: 'Cici' })),
  ];
  const hasil = ringkasPerAktor(peristiwa);

  assert.equal(hasil[0].name, 'Sari', 'yang paling layak diselidiki tidak di baris teratas');
  assert.equal(hasil[0].jumlahTotal, 12);
  // rata-rata = 18/3 = 6 → 12/6 = 2.0
  assert.equal(hasil[0].rasio, '2.0');
  assert.equal(hasil[1].rasio, '0.5');
});

test('⛔ TIDAK ada bahasa menuduh di bentuk keluarannya', async () => {
  // AC `spec-g`: "produk yang menuduh karyawan merchant akan merusak hubungan
  // merchant dengan stafnya". Test ini menyematkan larangan itu pada BENTUK
  // data — field bernama `mencurigakan` atau `skorFraud` tidak akan pernah
  // lolos tanpa seseorang menghapus test ini lebih dulu.
  const { ringkasPerAktor } = await import(MOD);
  const kunci = Object.keys(ringkasPerAktor([P({})])[0]);
  const terlarang = /curiga|suspicious|fraud|nakal|tuduh|flag/i;
  const melanggar = kunci.filter((k) => terlarang.test(k));
  assert.deepEqual(melanggar, [], `field menuduh: ${melanggar.join(', ')}`);
});

test('void dan refund dipisah, nilainya dijumlah lewat bigint', async () => {
  const { ringkasPerAktor } = await import(MOD);
  const hasil = ringkasPerAktor([
    P({ auditId: '1', nilai: '9007199254740993' }),
    P({ auditId: '2', jenis: 'refund', nilai: '1' }),
  ]);
  assert.equal(hasil[0].jumlahVoid, 1);
  assert.equal(hasil[0].nilaiVoid, '9007199254740993');
  assert.equal(hasil[0].jumlahRefund, 1);
  assert.equal(hasil[0].nilaiRefund, '1');
});

test('sebaran alasan ikut, terurut jumlah menurun', async () => {
  // AC: "menampilkan sebaran alasan void Sari".
  const { ringkasPerAktor } = await import(MOD);
  const hasil = ringkasPerAktor([
    P({ auditId: '1', reasonCode: 'salah_input' }),
    P({ auditId: '2', reasonCode: 'salah_input' }),
    P({ auditId: '3', reasonCode: 'pelanggan_batal' }),
  ]);
  assert.deepEqual(hasil[0].alasan, [
    { reasonCode: 'salah_input', jumlah: 2 },
    { reasonCode: 'pelanggan_batal', jumlah: 1 },
  ]);
});

test('daftar kosong tidak melempar dan tidak membagi nol', async () => {
  const { ringkasPerAktor } = await import(MOD);
  assert.deepEqual(ringkasPerAktor([]), []);
});
