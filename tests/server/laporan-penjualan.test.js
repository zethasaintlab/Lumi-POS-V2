'use strict';

// Modul G sisi REST — `GET /reports/sales`.
//
// ⛔ Dua hal yang seluruh berkas ini ada untuk menjaga:
//
//   1. Rentang memakai `business_date`, BUKAN `occurred_at`.
//      `order.business_date` dihitung SEKALI saat penjualan dari zona outlet,
//      dan sejak itu hanya DIBACA. Tanggal bisnis juga tidak berakhir tengah
//      malam melainkan saat tutup shift (default 04:00) — jadi `occurred_at`
//      pukul 01:00 milik tanggal bisnis SEBELUMNYA. Laporan yang memfilter
//      `occurred_at` menjadi tempat KEDUA yang memutuskan tanggal sebuah
//      penjualan.
//
//   2. Angkanya dihitung `posisiPenjualan()` yang SAMA dengan aplikasi kasir.
//      AC FR-G4: "angka laporan lokal cocok dengan laporan server".

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');

let owner, appSetup, app, base, tenant;

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
  // ⛔ Koneksi setup dibagi seluruh test di berkas ini. Satu INSERT yang gagal
  // meninggalkan transaksi dalam keadaan aborted, dan SETIAP query sesudahnya
  // dijawab "current transaction is aborted" — empat test tumbang karena satu
  // kolom yang hilang di test kelima. Dibersihkan sebelum apa pun dimulai.
  await appSetup.query('ROLLBACK').catch(() => {});
  await resetAll(owner);
  base = await seedTenantBase(appSetup, { suffix: 'LaporanTest' });
  tenant = base.tenant;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();
  await seedPerangkat();
});

let urutan = 0;
let device, shift;

/**
 * `order.device_id` dan `order.shift_id` NOT NULL — keduanya dibuat sekali per
 * test. Laporan tidak membacanya, tapi skema menuntutnya, dan test yang
 * menyiasatinya dengan NULL akan menguji tabel yang tidak dapat ada.
 */
async function seedPerangkat() {
  device = crypto.randomUUID();
  shift = crypto.randomUUID();
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await appSetup.query(
    `INSERT INTO device (id, tenant_id, outlet_id, code, name, platform, app_version, schema_version)
     VALUES ($1, $2, $3, 'K1', 'Kasir 1', 'tauri', '0.0.0', '1')`,
    [device, tenant.id, base.outlet.id]
  );
  await appSetup.query(
    `INSERT INTO cash_drawer_shift (id, tenant_id, outlet_id, device_id, business_date, status, opening_float, opened_by)
     VALUES ($1, $2, $3, $4, '2026-08-10', 'open', 0, $5)`,
    [shift, tenant.id, base.outlet.id, device, base.user.id]
  );
  await appSetup.query('COMMIT');
}

/** Menulis order LANGSUNG, supaya `business_date` dan `occurred_at` dapat dipisah. */
async function buatOrder({
  businessDate,
  occurredAt,
  status = 'closed',
  total = 100000,
  taxAmount = 0,
  voidedByOrderId = null,
  outletId,
}) {
  const id = crypto.randomUUID();
  urutan += 1;
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await appSetup.query(
    `INSERT INTO "order"
       (id, tenant_id, outlet_id, device_id, shift_id, receipt_number, business_date, sequence,
        status, channel, subtotal, order_discount, service_charge_amount, tax_amount,
        rounding_adjustment, total, amount_due, voided_by_order_id, created_by, occurred_at, hlc)
     VALUES ($1, $2, $3, $14, $15, $4, $5, $6,
             $7, 'takeaway', $8, 0, 0, $9,
             0, $8, $8, $10, $11, $12, $13)`,
    [
      id,
      tenant.id,
      outletId ?? base.outlet.id,
      `K1-${String(businessDate).replace(/-/g, '')}-${String(urutan).padStart(4, '0')}`,
      businessDate,
      urutan,
      status,
      total,
      taxAmount,
      voidedByOrderId,
      base.user.id,
      occurredAt ?? `${businessDate}T10:00:00Z`,
      urutan,
      device,
      shift,
    ]
  );
  await appSetup.query('COMMIT');
  return id;
}

async function buatRefund(orderId, amount) {
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await appSetup.query(
    `INSERT INTO refund (id, tenant_id, order_id, amount, reason_code, created_by, approved_by, hlc)
     VALUES ($1, $2, $3, $4, 'salah_input', $5, $5, $6)`,
    [crypto.randomUUID(), tenant.id, orderId, amount, base.user.id, ++urutan]
  );
  await appSetup.query('COMMIT');
}

function laporan(query, headers = {}) {
  return app.inject({
    method: 'GET',
    url: `/reports/sales?${query}`,
    headers: {
      'x-tenant-id': tenant.id,
      authorization: base.authHeader,
      'x-actor-id': base.user.id,
      ...headers,
    },
  });
}

// ---------------------------------------------------------------------------

test('rentang satu hari menjumlahkan order hari itu', async () => {
  await buatOrder({ businessDate: '2026-08-10', total: 50000, taxAmount: 5000 });
  await buatOrder({ businessDate: '2026-08-10', total: 30000, taxAmount: 3000 });

  const res = await laporan('from=2026-08-10&to=2026-08-10');
  assert.equal(res.statusCode, 200, res.body);
  const p = res.json().penjualan;

  // ⛔ Uang dikirim sebagai STRING — `bigint` di domain, dan JSON.parse
  // mengubah bilangan besar jadi double.
  assert.equal(p.omzetKotor, '80000');
  assert.equal(p.pajakTerkumpul, '8000');
  assert.equal(p.jumlahTransaksi, 2);
  assert.equal(p.omzetBersih, '80000');
});

test('⛔ RENTANG memakai business_date, BUKAN occurred_at', async () => {
  // Inti berkas ini.
  //
  // Tanggal bisnis berakhir saat tutup shift (default 04:00), bukan tengah
  // malam. Penjualan pukul 01:00 tanggal 11 karena itu milik tanggal bisnis
  // 10 — dan laporan tanggal 10 WAJIB memuatnya.
  //
  // Laporan yang memfilter `occurred_at` akan melewatkannya, dan angkanya
  // berbeda dari tutup kas di outlet yang sama.
  await buatOrder({
    businessDate: '2026-08-10',
    occurredAt: '2026-08-11T01:00:00Z',
    total: 70000,
  });

  const hari10 = await laporan('from=2026-08-10&to=2026-08-10');
  assert.equal(hari10.json().penjualan.omzetKotor, '70000', 'order dini hari hilang dari hari bisnisnya');

  const hari11 = await laporan('from=2026-08-11&to=2026-08-11');
  assert.equal(
    hari11.json().penjualan.omzetKotor,
    '0',
    'order dini hari bocor ke tanggal kalender occurred_at'
  );
});

test('⛔ order di LUAR rentang tidak ikut, batas inklusif di kedua ujung', async () => {
  await buatOrder({ businessDate: '2026-08-09', total: 10000 });
  await buatOrder({ businessDate: '2026-08-10', total: 20000 });
  await buatOrder({ businessDate: '2026-08-12', total: 40000 });
  await buatOrder({ businessDate: '2026-08-13', total: 80000 });

  const res = await laporan('from=2026-08-10&to=2026-08-12');
  assert.equal(res.json().penjualan.omzetKotor, '60000');
  assert.equal(res.json().penjualan.jumlahTransaksi, 2);
});

test('⛔ order yang DIBATALKAN keluar dari omzet kotor', async () => {
  // `spec-g:39`. Order pembatal MENYALIN business_date order aslinya
  // (`cancel.ts`), jadi rentang yang memuat aslinya selalu memuat pembatalnya
  // — deteksinya tidak pernah meleset karena batas rentang.
  const asli = await buatOrder({ businessDate: '2026-08-10', total: 50000, taxAmount: 5000 });
  await buatOrder({ businessDate: '2026-08-10', total: 30000 });
  await buatOrder({
    businessDate: '2026-08-10',
    status: 'voided',
    total: 50000,
    taxAmount: 5000,
    voidedByOrderId: asli,
  });

  const p = (await laporan('from=2026-08-10&to=2026-08-10')).json().penjualan;
  assert.equal(p.omzetKotor, '30000', 'order yang sudah dibatalkan tetap masuk omzet');
  assert.equal(p.voidAmount, '50000');
  assert.equal(p.jumlahTransaksi, 1);
  assert.equal(p.pajakTerkumpul, '0', 'pajak order batal ikut terhitung');
});

test('refund mengurangi omzet bersih dan porsi pajaknya', async () => {
  const id = await buatOrder({ businessDate: '2026-08-10', total: 100000, taxAmount: 10000 });
  await buatRefund(id, 40000);

  const p = (await laporan('from=2026-08-10&to=2026-08-10')).json().penjualan;
  assert.equal(p.omzetKotor, '100000');
  assert.equal(p.refundAmount, '40000');
  assert.equal(p.omzetBersih, '60000');
  // Porsi sebanding: 10000 * 60000 / 100000.
  assert.equal(p.pajakTerkumpul, '6000');
});

test('⛔ omzet bersih boleh NEGATIF, tanpa clamp', async () => {
  // `spec-g:283` — "ditampilkan apa adanya dengan penjelasan". Menjepitnya ke
  // nol menyembunyikan hari yang justru paling perlu dilihat.
  const id = await buatOrder({ businessDate: '2026-08-10', total: 10000 });
  await buatRefund(id, 30000);

  const p = (await laporan('from=2026-08-10&to=2026-08-10')).json().penjualan;
  assert.equal(p.omzetBersih, '-20000');
});

test('status open dan abandoned tidak dihitung sebagai penjualan', async () => {
  await buatOrder({ businessDate: '2026-08-10', status: 'open', total: 90000 });
  await buatOrder({ businessDate: '2026-08-10', status: 'abandoned', total: 90000 });
  await buatOrder({ businessDate: '2026-08-10', status: 'paid', total: 10000 });

  const p = (await laporan('from=2026-08-10&to=2026-08-10')).json().penjualan;
  assert.equal(p.omzetKotor, '10000');
  assert.equal(p.jumlahTransaksi, 1);
});

// --- outlet ------------------------------------------------------------------

test('outlet_id menyaring; tanpa outlet_id seluruh tenant ikut', async () => {
  const outletKedua = crypto.randomUUID();
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await appSetup.query(
    `INSERT INTO outlet (id, tenant_id, name, timezone) VALUES ($1, $2, 'Cabang Dua', 'Asia/Makassar')`,
    [outletKedua, tenant.id]
  );
  await appSetup.query('COMMIT');

  await buatOrder({ businessDate: '2026-08-10', total: 10000 });
  await buatOrder({ businessDate: '2026-08-10', total: 25000, outletId: outletKedua });

  const semua = await laporan('from=2026-08-10&to=2026-08-10');
  assert.equal(semua.json().penjualan.omzetKotor, '35000');
  assert.equal(semua.json().outletId, null);

  const satu = await laporan(`from=2026-08-10&to=2026-08-10&outlet_id=${outletKedua}`);
  assert.equal(satu.json().penjualan.omzetKotor, '25000');
  assert.equal(satu.json().outletId, outletKedua);
});

test('⛔ outlet milik tenant lain ditolak 404 — FK tidak tunduk RLS', async () => {
  // Temuan F1 (`CLAUDE.md`): FK PostgreSQL dicek dengan privilese owner tabel
  // dan TIDAK tunduk FORCE ROW LEVEL SECURITY. Di sini idnya bahkan tidak
  // masuk INSERT mana pun — yang dijaga adalah agar laporan tidak menjadi
  // oracle keberadaan outlet tenant lain.
  const lain = await seedTenantBase(appSetup, { suffix: 'LaporanLain' });
  const res = await laporan(`from=2026-08-10&to=2026-08-10&outlet_id=${lain.outlet.id}`);
  assert.equal(res.statusCode, 404, res.body);
  assert.equal(res.json().error.code, 'OUTLET_NOT_FOUND');
});

test('⛔ order tenant lain tidak pernah ikut', async () => {
  const lain = await seedTenantBase(appSetup, { suffix: 'LaporanLain2' });
  const deviceLain = crypto.randomUUID();
  const shiftLain = crypto.randomUUID();
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [lain.tenant.id]);
  await appSetup.query(
    `INSERT INTO device (id, tenant_id, outlet_id, code, name, platform, app_version, schema_version)
     VALUES ($1, $2, $3, 'K9', 'Kasir 9', 'tauri', '0.0.0', '1')`,
    [deviceLain, lain.tenant.id, lain.outlet.id]
  );
  await appSetup.query(
    `INSERT INTO cash_drawer_shift (id, tenant_id, outlet_id, device_id, business_date, status, opening_float, opened_by)
     VALUES ($1, $2, $3, $4, '2026-08-10', 'open', 0, $5)`,
    [shiftLain, lain.tenant.id, lain.outlet.id, deviceLain, lain.user.id]
  );
  await appSetup.query(
    `INSERT INTO "order"
       (id, tenant_id, outlet_id, device_id, shift_id, receipt_number, business_date, sequence,
        status, channel, subtotal, order_discount, service_charge_amount, tax_amount,
        rounding_adjustment, total, amount_due, created_by, hlc)
     VALUES ($1, $2, $3, $4, $5, 'K9-20260810-0001', '2026-08-10', 9001, 'closed', 'takeaway',
             999000, 0, 0, 0, 0, 999000, 999000, $6, 9001)`,
    [crypto.randomUUID(), lain.tenant.id, lain.outlet.id, deviceLain, shiftLain, lain.user.id]
  );
  await appSetup.query('COMMIT');

  const p = (await laporan('from=2026-08-10&to=2026-08-10')).json().penjualan;
  assert.equal(p.omzetKotor, '0');
});

// --- validasi ----------------------------------------------------------------

test('from/to bukan YYYY-MM-DD ditolak 400', async () => {
  for (const q of ['from=10-08-2026&to=2026-08-10', 'from=2026-08-10&to=kemarin', 'from=&to=']) {
    const res = await laporan(q);
    assert.equal(res.statusCode, 400, `"${q}" diterima: ${res.body}`);
    assert.equal(res.json().error.code, 'VALIDATION_ERROR');
  }
});

test('⛔ from lebih besar dari to ditolak, bukan mengembalikan nol diam-diam', async () => {
  // Rentang terbalik menghasilkan nol baris, dan nol yang terlihat seperti
  // "tidak ada penjualan" adalah jawaban paling berbahaya yang dapat diberikan
  // laporan keuangan.
  const res = await laporan('from=2026-08-12&to=2026-08-10');
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(res.json().error.code, 'VALIDATION_ERROR');
});

test('rentang tanpa transaksi mengembalikan nol yang jujur, bukan 404', async () => {
  const res = await laporan('from=2026-01-01&to=2026-01-31');
  assert.equal(res.statusCode, 200, res.body);
  const p = res.json().penjualan;
  assert.equal(p.omzetKotor, '0');
  assert.equal(p.jumlahTransaksi, 0);
  assert.equal(p.rataRataPerTransaksi, '0');
});

test('⛔ tanpa sesi ditolak 401', async () => {
  const res = await app.inject({
    method: 'GET',
    url: '/reports/sales?from=2026-08-10&to=2026-08-10',
    headers: { 'x-tenant-id': tenant.id },
  });
  assert.equal(res.statusCode, 401, res.body);
});
