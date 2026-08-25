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

const hdr = (ubah = {}) => ({
  'x-tenant-id': tenant.id,
  authorization: base.authHeader,
  'x-actor-id': base.user.id,
  ...ubah,
});

function laporan(query, headers = {}) {
  return app.inject({
    method: 'GET',
    url: `/reports/sales?${query}`,
    headers: hdr(headers),
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

// ---------------------------------------------------------------------------
// FR-G6 — ringkasan harian untuk HP (M-01)
// ---------------------------------------------------------------------------

const ringkasan = (tanggal, q = '', ubah = {}) =>
  app.inject({
    method: 'GET',
    url: `/reports/daily-summary?date=${tanggal}${q}`,
    headers: hdr(ubah),
  });

test('⛔ FR-G6 — omzetnya SAMA PERSIS dengan /reports/sales hari itu', async () => {
  // Owner yang melihat omzet berbeda tergantung layar mana yang ia buka akan
  // mempercayai yang ia lihat pukul 23:00, dan itu yang paling jarang
  // diperiksa ulang. Dibandingkan terhadap respons endpoint lain, bukan
  // terhadap angka tulisan tangan.
  await buatOrder({ businessDate: '2026-08-24', total: 120000 });
  await buatOrder({ businessDate: '2026-08-24', total: 80000 });

  const hp = await ringkasan('2026-08-24');
  assert.equal(hp.statusCode, 200, hp.body);

  const penuh = await app.inject({
    method: 'GET',
    url: '/reports/sales?from=2026-08-24&to=2026-08-24',
    headers: hdr(),
  });
  assert.equal(penuh.statusCode, 200, penuh.body);

  assert.equal(hp.json().omzetBersih, penuh.json().penjualan.omzetBersih);
  assert.equal(hp.json().jumlahTransaksi, penuh.json().penjualan.jumlahTransaksi);
});

test('⛔ delta dibandingkan HARI YANG SAMA empat minggu terakhir', async () => {
  // 24 Agustus 2026 adalah Senin. Pembandingnya 17, 10, 3 Agustus dan 27 Juli
  // — bukan 23 Agustus.
  //
  // ⛔ Hari SEBELUMNYA sengaja diberi omzet yang sangat berbeda: kalau
  // implementasinya membandingkan ke sana, deltanya akan jauh meleset.
  await buatOrder({ businessDate: '2026-08-23', total: 9_000_000 });
  for (const tgl of ['2026-08-17', '2026-08-10', '2026-08-03', '2026-07-27']) {
    await buatOrder({ businessDate: tgl, total: 1_000_000 });
  }
  await buatOrder({ businessDate: '2026-08-24', total: 1_100_000 });

  const b = (await ringkasan('2026-08-24')).json();
  assert.equal(b.tren.rataRata, '1000000', 'rata-rata harus dari hari SENIN');
  assert.equal(b.tren.deltaPersen, 10);
  assert.equal(b.tren.arah, 'naik');
  assert.equal(b.tren.basisMinggu, 4);
});

test('⛔ delta null bila belum ada cukup hari pembanding — BUKAN 0%', async () => {
  // "0%" mengaku omzet hari ini persis sama dengan kebiasaannya, dan kebiasaan
  // itu belum ada.
  await buatOrder({ businessDate: '2026-08-24', total: 1_000_000 });
  const b = (await ringkasan('2026-08-24')).json();
  assert.equal(b.tren.deltaPersen, null);
  assert.equal(b.tren.rataRata, null);
  assert.equal(b.tren.basisMinggu, 0);
});

test('⛔ hari pembanding TANPA transaksi tidak menyeret rata-rata', async () => {
  // Outlet yang tutup pada satu Senin tidak punya kebiasaan untuk hari itu.
  // Memperlakukannya sebagai omzet nol membuat Senin berikutnya terlihat naik
  // puluhan persen karena outletnya kebetulan buka.
  for (const tgl of ['2026-08-17', '2026-08-10']) {
    await buatOrder({ businessDate: tgl, total: 1_000_000 });
  }
  // 3 Agustus dan 27 Juli: tutup, tanpa satu pun order.
  await buatOrder({ businessDate: '2026-08-24', total: 1_000_000 });

  const b = (await ringkasan('2026-08-24')).json();
  assert.equal(b.tren.rataRata, '1000000');
  assert.equal(b.tren.deltaPersen, 0);
  assert.equal(b.tren.basisMinggu, 2, 'hanya hari yang punya data yang dipakai');
});

test('⛔ rataRataPerTransaksi null untuk hari TANPA transaksi', async () => {
  const b = (await ringkasan('2026-08-24')).json();
  assert.equal(b.jumlahTransaksi, 0);
  assert.equal(b.rataRataPerTransaksi, null, 'bukan "Rp 0 per transaksi"');
});

test('uang selalu STRING, tidak pernah number', async () => {
  await buatOrder({ businessDate: '2026-08-24', total: 120000 });
  const b = (await ringkasan('2026-08-24')).json();
  assert.equal(typeof b.omzetBersih, 'string');
  assert.equal(typeof b.rataRataPerTransaksi, 'string');
  for (const m of b.perMetode) assert.equal(typeof m.total, 'string', m.metode);
});

test('tanggal cacat ditolak 400', async () => {
  for (const t of ['', '24-08-2026', '2026-8-24', 'kemarin']) {
    const res = await ringkasan(t);
    assert.equal(res.statusCode, 400, `${t}: ${res.body}`);
  }
});

test('outlet milik tenant lain dijawab 404', async () => {
  const lain = await seedTenantBase(appSetup, { suffix: 'RingkasLain' });
  const res = await ringkasan('2026-08-24', `&outlet_id=${lain.outlet.id}`);
  assert.equal(res.statusCode, 404, res.body);
});

// ---------------------------------------------------------------------------
// FR-G6 — "hari ini" diputuskan SERVER, bukan jam HP
// ---------------------------------------------------------------------------

/** Outlet kedua, supaya zona/jam tutup dapat dibuat berbeda. */
async function buatOutlet({ timezone = 'Asia/Jakarta', batas = '04:00', nama = 'Cabang 2' }) {
  const id = crypto.randomUUID();
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await appSetup.query(
    `INSERT INTO outlet (id, tenant_id, name, timezone, business_day_ends_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, tenant.id, nama, timezone, batas]
  );
  await appSetup.query('COMMIT');
  return id;
}

test('⛔ date DIKOSONGKAN berarti hari ini, dan servernya yang menghitung', async () => {
  // Jam HP dapat salah — FR-F8 ada di produk ini justru karena jam perangkat
  // berbohong. Yang menghitung tanggal bisnis karena itu server, dari jam
  // database dan zona outletnya.
  // ⛔ `date` benar-benar TIDAK DIKIRIM — bukan dikirim kosong. Perbedaannya
  // diuji terpisah di test berikutnya.
  const res = await app.inject({
    method: 'GET',
    url: `/reports/daily-summary?outlet_id=${base.outlet.id}`,
    headers: hdr(),
  });
  assert.equal(res.statusCode, 200, res.body);

  const { tanggalBisnis } = await import('../../packages/domain/src/tanggal-bisnis.ts');
  const { rows } = await appSetup.query('SELECT now() AS sekarang');
  const diharapkan = tanggalBisnis(rows[0].sekarang, 'Asia/Jakarta', '04:00');

  // ⛔ Dibandingkan terhadap fungsi domain yang SAMA yang kasir pakai, bukan
  // terhadap `new Date()` di test — dua tempat yang menghitung tanggal bisnis
  // adalah persis yang berkas ini ada untuk mencegah.
  assert.equal(res.json().tanggal, diharapkan);
});

test('⛔ date KOSONG tetap ditolak — beda dari date yang tidak dikirim', async () => {
  // String kosong berarti klien bermaksud menyebut tanggal dan gagal.
  // Memperlakukannya sebagai "hari ini" menyembunyikan bug klien di balik
  // jawaban yang terlihat masuk akal.
  const res = await app.inject({
    method: 'GET',
    url: `/reports/daily-summary?date=&outlet_id=${base.outlet.id}`,
    headers: hdr(),
  });
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(res.json().error.code, 'VALIDATION_ERROR');
});

test('⛔ tanpa outlet_id, "hari ini" hanya dijawab bila outlet SEPAKAT', async () => {
  // Satu outlet: tidak ada yang dapat berselisih.
  const satu = await app.inject({
    method: 'GET',
    url: '/reports/daily-summary',
    headers: hdr(),
  });
  assert.equal(satu.statusCode, 200, satu.body);

  // Outlet kedua di zona yang sama, jam tutup sama: masih satu jawaban.
  await buatOutlet({});
  const dua = await app.inject({
    method: 'GET',
    url: '/reports/daily-summary',
    headers: hdr(),
  });
  assert.equal(dua.statusCode, 200, dua.body);
  assert.equal(dua.json().tanggal, satu.json().tanggal);
});

test('⛔ zona waktu berbeda → 400 BUSINESS_DATE_AMBIGUOUS, bukan angka gabungan', async () => {
  // Pukul 23:00 di Jayapura masih pukul 21:00 di Jakarta; angka gabungan
  // memuat dua hari bisnis berbeda dan tidak dapat dicocokkan dengan tutup kas
  // cabang mana pun.
  await buatOutlet({ timezone: 'Asia/Jayapura', nama: 'Cabang Timur' });
  const res = await app.inject({
    method: 'GET',
    url: '/reports/daily-summary',
    headers: hdr(),
  });
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(res.json().error.code, 'BUSINESS_DATE_AMBIGUOUS');
  // Pesannya harus menyebut jalan keluarnya — memilih outlet.
  assert.match(res.json().error.message, /pilih satu outlet/i);
});

test('⛔ JAM TUTUP berbeda juga membuatnya ambigu, bukan hanya zona', async () => {
  // Cabang yang tutup 02:00 dan cabang yang tutup 06:00 berada di tanggal
  // bisnis berbeda selama empat jam setiap malam — tepat jam yang owner
  // membuka aplikasi ini.
  await buatOutlet({ batas: '06:00', nama: 'Cabang Malam' });
  const res = await app.inject({
    method: 'GET',
    url: '/reports/daily-summary',
    headers: hdr(),
  });
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(res.json().error.code, 'BUSINESS_DATE_AMBIGUOUS');
});

test('outlet yang DIARSIPKAN tidak membuat "hari ini" ambigu', async () => {
  // Cabang yang sudah ditutup tidak punya hari bisnis yang berjalan; ia tetap
  // ada karena riwayat penjualan menunjuknya.
  const id = await buatOutlet({ timezone: 'Asia/Jayapura', nama: 'Cabang Tutup' });
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await appSetup.query(`UPDATE outlet SET archived_at = now() WHERE id = $1`, [id]);
  await appSetup.query('COMMIT');

  const res = await app.inject({
    method: 'GET',
    url: '/reports/daily-summary',
    headers: hdr(),
  });
  assert.equal(res.statusCode, 200, res.body);
});

// ---------------------------------------------------------------------------
// FR-G6 AC keempat — rincian per outlet
// ---------------------------------------------------------------------------

test('⛔ perOutlet null saat outlet_id DISEBUT, bukan larik satu baris', async () => {
  // Rincian dari satu outlet mengulang angka yang sudah tertera di atasnya,
  // dan pengulangan itu membuat pembacanya mencari perbedaan yang tidak ada.
  await buatOrder({ businessDate: '2026-08-24', total: 100000 });
  const b = (await ringkasan('2026-08-24', `&outlet_id=${base.outlet.id}`)).json();
  assert.equal(b.perOutlet, null);
});

test('⛔ rincian per outlet MENJUMLAH menjadi totalnya', async () => {
  // Owner yang menjumlahkan barisnya lalu mendapat angka lain dari yang
  // tertera di atas tidak punya cara memutuskan mana yang benar. Keduanya
  // dihitung `posisiPenjualan` yang sama, jadi ini benar menurut konstruksi —
  // dan test ini yang menahannya tetap begitu.
  const kedua = await buatOutlet({ nama: 'Cabang Rincian' });
  await buatOrder({ businessDate: '2026-08-24', total: 120000 });
  await buatOrder({ businessDate: '2026-08-24', total: 80000, outletId: kedua });

  const b = (await ringkasan('2026-08-24')).json();
  assert.equal(b.perOutlet.length, 2, JSON.stringify(b.perOutlet));

  const jumlah = b.perOutlet.reduce((a, o) => a + BigInt(o.omzetBersih), 0n);
  assert.equal(jumlah.toString(), b.omzetBersih);
  assert.equal(
    b.perOutlet.reduce((a, o) => a + o.jumlahTransaksi, 0),
    b.jumlahTransaksi
  );
});

test('⛔ order yang DIBATALKAN keluar dari rincian outletnya juga', async () => {
  // Pengelompokan per outlet hanya benar selama pembatal berada di outlet yang
  // sama; kalau tidak, order batal terhitung sebagai omzet di satu cabang dan
  // dikurangkan di cabang lain.
  const asli = await buatOrder({ businessDate: '2026-08-24', total: 90000 });
  await buatOrder({
    businessDate: '2026-08-24',
    status: 'voided',
    total: 90000,
    voidedByOrderId: asli,
  });

  const b = (await ringkasan('2026-08-24')).json();
  assert.equal(b.omzetBersih, '0');
  assert.equal(b.perOutlet.length, 1);
  assert.equal(b.perOutlet[0].omzetBersih, '0', 'void tidak terlihat di rincian outletnya');
});

test('⛔ refund menempel pada outlet ORDER-nya', async () => {
  // `refund` tidak punya `outlet_id`. Refund yang jatuh ke outlet yang salah
  // membuat satu cabang terlihat merugi dan satu terlihat untung, keduanya
  // sebesar nilai yang sama.
  const kedua = await buatOutlet({ nama: 'Cabang Refund' });
  await buatOrder({ businessDate: '2026-08-24', total: 100000 });
  const diRefund = await buatOrder({ businessDate: '2026-08-24', total: 100000, outletId: kedua });
  await buatRefund(diRefund, 40000);

  const b = (await ringkasan('2026-08-24')).json();
  const perId = Object.fromEntries(b.perOutlet.map((o) => [o.outletId, o]));
  assert.equal(perId[base.outlet.id].omzetBersih, '100000');
  assert.equal(perId[kedua].omzetBersih, '60000');
});

test('outlet TANPA transaksi tidak muncul sebagai baris nol', async () => {
  // Dua puluh baris "Rp 0" mengubur dua yang berisi, dan layar 390px hanya
  // memuat beberapa baris.
  await buatOutlet({ nama: 'Cabang Sepi' });
  await buatOrder({ businessDate: '2026-08-24', total: 100000 });
  const b = (await ringkasan('2026-08-24')).json();
  assert.equal(b.perOutlet.length, 1);
  assert.equal(b.perOutlet[0].outletId, base.outlet.id);
});

test('rincian diurutkan omzet TERBESAR lebih dulu', async () => {
  // Yang owner cari di layar 390px adalah cabang yang paling banyak bergerak,
  // bukan yang namanya paling awal secara abjad.
  const kecil = await buatOutlet({ nama: 'A Cabang Kecil' });
  await buatOrder({ businessDate: '2026-08-24', total: 10000, outletId: kecil });
  await buatOrder({ businessDate: '2026-08-24', total: 500000 });

  const b = (await ringkasan('2026-08-24')).json();
  assert.equal(b.perOutlet[0].outletId, base.outlet.id);
  assert.equal(b.perOutlet[0].omzetBersih, '500000');
});

test('⛔ rincian outlet tenant lain tidak pernah ikut', async () => {
  await seedTenantBase(appSetup, { suffix: 'RincianLain' });
  await buatOrder({ businessDate: '2026-08-24', total: 100000 });
  const b = (await ringkasan('2026-08-24')).json();
  assert.equal(b.perOutlet.length, 1);
  assert.equal(b.perOutlet[0].outletId, base.outlet.id);
});

test('nama outlet ikut, supaya rinciannya dapat dibaca', async () => {
  await buatOrder({ businessDate: '2026-08-24', total: 100000 });
  const b = (await ringkasan('2026-08-24')).json();
  assert.equal(typeof b.perOutlet[0].outletNama, 'string');
  assert.ok(b.perOutlet[0].outletNama.length > 0);
});
