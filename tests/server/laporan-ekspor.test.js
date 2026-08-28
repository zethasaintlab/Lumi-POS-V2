'use strict';

// `GET /reports/export` — keempat laporan sebagai CSV.
//
// ⛔ Yang paling penting: angkanya HARUS sama dengan endpoint JSON. CSV adalah
// berkas yang merchant bawa ke akuntannya — ia dipercaya, disimpan, dan
// dibandingkan dengan catatan lain berbulan-bulan kemudian.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');

const EKSPOR = '../../apps/server/src/modules/ordering/handlers/reports-ekspor.ts';

let owner, appSetup, app, base, tenant, device, shift;

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
  await appSetup.query('ROLLBACK').catch(() => {});
  await resetAll(owner);
  base = await seedTenantBase(appSetup, { suffix: 'EksporTest' });
  tenant = base.tenant;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();

  device = crypto.randomUUID();
  shift = crypto.randomUUID();
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await appSetup.query(
    `INSERT INTO device (id, tenant_id, outlet_id, code, name, platform, app_version, schema_version)
     VALUES ($1,$2,$3,'K1','K1','tauri','0','1')`,
    [device, tenant.id, base.outlet.id]
  );
  await appSetup.query(
    `INSERT INTO cash_drawer_shift (id, tenant_id, outlet_id, device_id, business_date, status, opening_float, opened_by)
     VALUES ($1,$2,$3,$4,'2026-08-10','open',0,$5)`,
    [shift, tenant.id, base.outlet.id, device, base.user.id]
  );
  await appSetup.query('COMMIT');
});

let n = 0;

async function jual({ total = 100000, tax = 0, itemName = 'Kopi Susu' } = {}) {
  const id = crypto.randomUUID();
  n += 1;
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await appSetup.query(
    `INSERT INTO "order" (id,tenant_id,outlet_id,device_id,shift_id,receipt_number,business_date,sequence,
       status,channel,subtotal,order_discount,service_charge_amount,tax_amount,rounding_adjustment,
       total,amount_due,created_by,occurred_at,hlc)
     VALUES ($1,$2,$3,$4,$5,$6,'2026-08-10',$7::int,'closed','takeaway',$8,0,0,$9,0,$8,$8,$10,'2026-08-10T10:00:00Z',$7::bigint)`,
    [id, tenant.id, base.outlet.id, device, shift, `K1-${n}`, n, total, tax, base.user.id]
  );
  await appSetup.query(
    `INSERT INTO "check" (id,tenant_id,order_id,subtotal,total) VALUES ($1,$2,$3,0,$4)`,
    [`c-${id}`, tenant.id, id, total]
  );
  await appSetup.query(
    `INSERT INTO order_line (id,tenant_id,outlet_id,device_id,order_id,check_id,variation_id,item_name,
       variation_name,unit_price,quantity,line_total,created_by,occurred_at,hlc,
       variation_count_at_sale)
     VALUES ($1,$2,$3,$4,$5,$6,'v1',$7,'Regular',$8,1000,$8,$9,'2026-08-10T10:00:00Z',$10::bigint,1)`,
    [crypto.randomUUID(), tenant.id, base.outlet.id, device, id, `c-${id}`, itemName, total, base.user.id, n]
  );
  await appSetup.query(
    `INSERT INTO payment (id,tenant_id,outlet_id,device_id,order_id,check_id,method,amount,status,
       occurred_at,tendered_at,hlc,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,'cash',$7,'confirmed','2026-08-10T10:00:00Z','2026-08-10T10:00:00Z',$8::bigint,$9)`,
    [crypto.randomUUID(), tenant.id, base.outlet.id, device, id, `c-${id}`, total, n, base.user.id]
  );
  await appSetup.query('COMMIT');
  return id;
}

const hdr = () => ({
  'x-tenant-id': tenant.id,
  authorization: base.authHeader,
  'x-actor-id': base.user.id,
});

const RENTANG = 'from=2026-08-10&to=2026-08-10';
const ekspor = (q) => app.inject({ method: 'GET', url: `/reports/export?${q}`, headers: hdr() });

// --- murni: penyusunan CSV ----------------------------------------------------

test('⛔ sel yang diawali = + - @ dilindungi dari eksekusi rumus', async () => {
  // Nama produk berasal dari input merchant. `=HYPERLINK(...)` dan
  // `=cmd|...` adalah vektor nyata di Excel dan Google Sheets — dan korbannya
  // bukan yang mengetiknya, melainkan akuntan yang membuka berkasnya.
  const { selCsv } = await import(EKSPOR);
  for (const jahat of ['=1+1', '+1', '-1', '@SUM(A1)', '\tx', '\rx']) {
    const hasil = selCsv(jahat);
    assert.ok(hasil.startsWith(`"'`), `"${jahat}" tidak dilindungi: ${hasil}`);
  }
});

test('nama biasa tidak diberi kutip tunggal', async () => {
  const { selCsv } = await import(EKSPOR);
  assert.equal(selCsv('Kopi Susu'), '"Kopi Susu"');
  assert.equal(selCsv(25000), '"25000"');
});

test('⛔ kutip ganda di dalam sel DIGANDAKAN (RFC 4180)', async () => {
  const { selCsv } = await import(EKSPOR);
  assert.equal(selCsv('Kopi "Spesial"'), '"Kopi ""Spesial"""');
});

test('koma dan baris baru aman karena setiap sel di-quote', async () => {
  const { barisCsv } = await import(EKSPOR);
  assert.equal(barisCsv(['a,b', 'c\nd']), '"a,b","c\nd"');
});

test('⛔ CSV diawali BOM UTF-8 dan memakai CRLF', async () => {
  // Tanpa BOM, Excel di Windows membaca CSV sebagai ANSI dan setiap nama
  // ber-aksen rusak.
  const { susunCsv } = await import(EKSPOR);
  const csv = susunCsv(['a'], [['x']]);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.ok(csv.includes('\r\n'));
});

test('nilai null dan undefined jadi sel kosong, bukan "null"', async () => {
  const { selCsv } = await import(EKSPOR);
  assert.equal(selCsv(null), '""');
  assert.equal(selCsv(undefined), '""');
});

// --- endpoint -----------------------------------------------------------------

test('⛔ angka CSV SAMA dengan endpoint JSON', async () => {
  await jual({ total: 125000, tax: 12500 });
  await jual({ total: 87000, tax: 8700 });

  const json = (await app.inject({ method: 'GET', url: `/reports/sales?${RENTANG}`, headers: hdr() })).json();
  const res = await ekspor(`type=sales&${RENTANG}`);
  assert.equal(res.statusCode, 200, res.body);

  const csv = res.body;
  assert.ok(csv.includes(`"omzet_kotor","${json.penjualan.omzetKotor}"`), csv);
  assert.ok(csv.includes(`"omzet_bersih","${json.penjualan.omzetBersih}"`), csv);
  assert.ok(csv.includes(`"pajak_terkumpul","${json.penjualan.pajakTerkumpul}"`), csv);
});

test('content-type dan nama berkas menyebut jenis serta rentangnya', async () => {
  await jual({});
  const res = await ekspor(`type=products&${RENTANG}`);
  assert.match(res.headers['content-type'], /text\/csv/);
  assert.match(
    res.headers['content-disposition'],
    /attachment; filename="lumi-products-2026-08-10_2026-08-10\.csv"/
  );
});

test('keempat jenis menghasilkan CSV dengan header masing-masing', async () => {
  await jual({});
  for (const [jenis, kolom] of [
    ['sales', 'metrik'],
    ['products', 'variation_id'],
    ['cashiers', 'user_id'],
    ['payments', 'metode'],
  ]) {
    const res = await ekspor(`type=${jenis}&${RENTANG}`);
    assert.equal(res.statusCode, 200, `${jenis}: ${res.body}`);
    assert.ok(res.body.includes(`"${kolom}"`), `${jenis} tanpa kolom ${kolom}`);
  }
});

test('⛔ nama produk berisi rumus keluar dilindungi lewat endpoint', async () => {
  await jual({ itemName: '=HYPERLINK("http://jahat","klik")' });
  const res = await ekspor(`type=products&${RENTANG}`);
  assert.ok(res.body.includes(`"'=HYPERLINK`), res.body);
});

test('type tak dikenal ditolak 400 dan menyebut pilihannya', async () => {
  const res = await ekspor(`type=neraca&${RENTANG}`);
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(res.json().error.code, 'VALIDATION_ERROR');
  assert.match(res.json().error.message, /sales/);
});

test('rentang tak sah ditolak, memakai validasi yang sama', async () => {
  const res = await ekspor('type=sales&from=2026-08-12&to=2026-08-10');
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(res.json().error.code, 'VALIDATION_ERROR');
});

test('⛔ tanpa sesi ditolak 401', async () => {
  const res = await app.inject({
    method: 'GET',
    url: `/reports/export?type=sales&${RENTANG}`,
    headers: { 'x-tenant-id': tenant.id },
  });
  assert.equal(res.statusCode, 401, res.body);
});

test('⛔ outlet tenant lain ditolak 404', async () => {
  const lain = await seedTenantBase(appSetup, { suffix: 'EksporLain' });
  const res = await ekspor(`type=sales&${RENTANG}&outlet_id=${lain.outlet.id}`);
  assert.equal(res.statusCode, 404, res.body);
});

test('rentang kosong tetap menghasilkan CSV berheader, bukan berkas kosong', async () => {
  // Berkas nol byte tidak dapat dibedakan dari unduhan yang gagal.
  const res = await ekspor('type=products&from=2026-01-01&to=2026-01-31');
  assert.equal(res.statusCode, 200, res.body);
  assert.ok(res.body.includes('"variation_id"'));
});
