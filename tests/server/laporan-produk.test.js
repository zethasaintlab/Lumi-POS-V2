'use strict';

// Modul G REST — `GET /reports/products`.
//
// ⛔ Aturan yang seluruh berkas ini ada untuk menjaga:
//
//   Pesanan yang DIBATALKAN diabaikan — barangnya tidak jadi keluar.
//   Pesanan yang DIREFUND TETAP dihitung — barangnya sudah keluar; uangnya
//   kembali, barangnya belum tentu (`lines: []` pada refund berarti uang
//   kembali tanpa barang kembali).
//
// `CLAUDE.md`: "basis laporan per produk adalah sebelum void & refund, dan itu
// bukan kelalaian: baris produk menyatakan barang apa yang keluar, dan refund
// uang tidak selalu mengembalikan barang".

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');

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
  base = await seedTenantBase(appSetup, { suffix: 'ProdukTest' });
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
     VALUES ($1, $2, $3, 'K1', 'Kasir 1', 'tauri', '0.0.0', '1')`,
    [device, tenant.id, base.outlet.id]
  );
  await appSetup.query(
    `INSERT INTO cash_drawer_shift (id, tenant_id, outlet_id, device_id, business_date, status, opening_float, opened_by)
     VALUES ($1, $2, $3, $4, '2026-08-10', 'open', 0, $5)`,
    [shift, tenant.id, base.outlet.id, device, base.user.id]
  );
  await appSetup.query('COMMIT');
});

let n = 0;

async function buatOrder({ businessDate = '2026-08-10', status = 'closed', voidedByOrderId = null, outletId } = {}) {
  const id = crypto.randomUUID();
  n += 1;
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await appSetup.query(
    `INSERT INTO "order"
       (id, tenant_id, outlet_id, device_id, shift_id, receipt_number, business_date, sequence,
        status, channel, subtotal, order_discount, service_charge_amount, tax_amount,
        rounding_adjustment, total, amount_due, voided_by_order_id, created_by, occurred_at, hlc)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::int, $9, 'takeaway', 0, 0, 0, 0, 0, 0, 0, $10, $11, $12, $8::bigint)`,
    [id, tenant.id, outletId ?? base.outlet.id, device, shift,
     `K1-${businessDate.replace(/-/g, '')}-${String(n).padStart(4, '0')}`, businessDate, n,
     status, voidedByOrderId, base.user.id, `${businessDate}T10:00:00Z`]
  );
  await appSetup.query(
    `INSERT INTO "check" (id, tenant_id, order_id, subtotal, total) VALUES ($1, $2, $3, 0, 0)`,
    [`chk-${id}`, tenant.id, id]
  );
  await appSetup.query('COMMIT');
  return id;
}

/** `quantity` INTEGER x1000 — `2` gelas ditulis `2000`. */
async function buatBaris(orderId, { variationId, itemName, variationName = 'Regular', quantity, unitPrice, costAtSale = 0, occurredAt = '2026-08-10T10:00:00Z' }) {
  n += 1;
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await appSetup.query(
    `INSERT INTO order_line
       (id, tenant_id, outlet_id, device_id, order_id, check_id, variation_id, item_name,
        variation_name, unit_price, quantity, cost_at_sale, line_total, created_by, occurred_at, hlc)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::bigint)`,
    [crypto.randomUUID(), tenant.id, base.outlet.id, device, orderId, `chk-${orderId}`,
     variationId, itemName, variationName, unitPrice, quantity, costAtSale,
     Math.trunc((quantity * unitPrice) / 1000), base.user.id, occurredAt, n]
  );
  await appSetup.query('COMMIT');
}

function laporan(query, headers = {}) {
  return app.inject({
    method: 'GET',
    url: `/reports/products?${query}`,
    headers: {
      'x-tenant-id': tenant.id,
      authorization: base.authHeader,
      'x-actor-id': base.user.id,
      ...headers,
    },
  });
}

// ---------------------------------------------------------------------------

test('baris dijumlahkan per variation, dengan snapshot namanya', async () => {
  const o1 = await buatOrder();
  await buatBaris(o1, { variationId: 'v-kopi', itemName: 'Kopi Susu', quantity: 2000, unitPrice: 25000 });
  const o2 = await buatOrder();
  await buatBaris(o2, { variationId: 'v-kopi', itemName: 'Kopi Susu', quantity: 1000, unitPrice: 25000 });
  await buatBaris(o2, { variationId: 'v-teh', itemName: 'Teh Tarik', quantity: 1000, unitPrice: 18000 });

  const res = await laporan('from=2026-08-10&to=2026-08-10');
  assert.equal(res.statusCode, 200, res.body);
  const produk = res.json().produk;

  assert.equal(produk.length, 2);
  const kopi = produk.find((p) => p.variationId === 'v-kopi');
  assert.equal(kopi.itemName, 'Kopi Susu');
  // 3 gelas → 3000 dalam skala x1000.
  assert.equal(kopi.kuantitas, '3000');
  assert.equal(kopi.kuantitasTampil, '3');
  // ⛔ `quantity * unit_price / 1000` — tanpa pembagian itu nilainya 1000x.
  assert.equal(kopi.nilaiKotor, '75000');
});

test('⛔ pesanan DIBATALKAN diabaikan — barangnya tidak jadi keluar', async () => {
  const asli = await buatOrder();
  await buatBaris(asli, { variationId: 'v-kopi', itemName: 'Kopi Susu', quantity: 5000, unitPrice: 25000 });

  // Order pembatal menyalin business_date aslinya (`cancel.ts`).
  const pembatal = await buatOrder({ status: 'voided', voidedByOrderId: asli });
  await buatBaris(pembatal, { variationId: 'v-kopi', itemName: 'Kopi Susu', quantity: 5000, unitPrice: 25000 });

  const tetap = await buatOrder();
  await buatBaris(tetap, { variationId: 'v-kopi', itemName: 'Kopi Susu', quantity: 1000, unitPrice: 25000 });

  const produk = (await laporan('from=2026-08-10&to=2026-08-10')).json().produk;
  assert.equal(produk.length, 1);
  // Hanya yang tersisa. Baris order asli DAN baris pembatalnya sama-sama keluar.
  assert.equal(produk[0].kuantitas, '1000');
});

test('⛔ pesanan DIREFUND TETAP dihitung — barangnya sudah keluar', async () => {
  // Uang kembali; barang belum tentu. `lines: []` pada refund berarti uang
  // kembali TANPA barang kembali, dan laporan produk menyatakan barang.
  const o = await buatOrder({ status: 'refunded' });
  await buatBaris(o, { variationId: 'v-kopi', itemName: 'Kopi Susu', quantity: 2000, unitPrice: 25000 });
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await appSetup.query(
    `INSERT INTO refund (id, tenant_id, order_id, amount, reason_code, created_by, approved_by, hlc)
     VALUES ($1, $2, $3, 50000, 'salah_input', $4, $4, 999)`,
    [crypto.randomUUID(), tenant.id, o, base.user.id]
  );
  await appSetup.query('COMMIT');

  const produk = (await laporan('from=2026-08-10&to=2026-08-10')).json().produk;
  assert.equal(produk.length, 1);
  assert.equal(produk[0].kuantitas, '2000', 'refund menghapus barang dari laporan produk');
  assert.equal(produk[0].nilaiKotor, '50000', 'nilai barang ikut berkurang oleh refund');
});

test('status open dan abandoned tidak dihitung', async () => {
  const a = await buatOrder({ status: 'open' });
  await buatBaris(a, { variationId: 'v-kopi', itemName: 'Kopi Susu', quantity: 9000, unitPrice: 25000 });
  const b = await buatOrder({ status: 'abandoned' });
  await buatBaris(b, { variationId: 'v-kopi', itemName: 'Kopi Susu', quantity: 9000, unitPrice: 25000 });
  const c = await buatOrder({ status: 'paid' });
  await buatBaris(c, { variationId: 'v-kopi', itemName: 'Kopi Susu', quantity: 1000, unitPrice: 25000 });

  const produk = (await laporan('from=2026-08-10&to=2026-08-10')).json().produk;
  assert.equal(produk[0].kuantitas, '1000');
});

test('⛔ rentang memakai business_date order, bukan occurred_at BARIS', async () => {
  // `order_line.occurred_at` adalah kolom partisi dan bisa berbeda dari
  // `order.business_date` — memfilternya akan memecah satu pesanan menjadi
  // dua hari.
  const o = await buatOrder({ businessDate: '2026-08-10' });
  await buatBaris(o, {
    variationId: 'v-kopi', itemName: 'Kopi Susu', quantity: 1000, unitPrice: 25000,
    occurredAt: '2026-08-11T01:00:00Z',
  });

  const hari10 = (await laporan('from=2026-08-10&to=2026-08-10')).json().produk;
  assert.equal(hari10.length, 1, 'baris dini hari hilang dari tanggal bisnis pesanannya');
  const hari11 = (await laporan('from=2026-08-11&to=2026-08-11')).json().produk;
  assert.equal(hari11.length, 0);
});

test('urutan deterministik: kuantitas menurun, lalu nama', async () => {
  const o = await buatOrder();
  await buatBaris(o, { variationId: 'v-a', itemName: 'Aneka', quantity: 1000, unitPrice: 1000 });
  await buatBaris(o, { variationId: 'v-b', itemName: 'Banyak', quantity: 5000, unitPrice: 1000 });
  await buatBaris(o, { variationId: 'v-c', itemName: 'Cukup', quantity: 1000, unitPrice: 1000 });

  const produk = (await laporan('from=2026-08-10&to=2026-08-10')).json().produk;
  assert.deepEqual(produk.map((p) => p.variationId), ['v-b', 'v-a', 'v-c']);
});

test('kuantitas pecahan ditampilkan dengan koma', async () => {
  const o = await buatOrder();
  await buatBaris(o, { variationId: 'v-kg', itemName: 'Biji Kopi', quantity: 500, unitPrice: 200000 });

  const produk = (await laporan('from=2026-08-10&to=2026-08-10')).json().produk;
  assert.equal(produk[0].kuantitas, '500');
  assert.equal(produk[0].kuantitasTampil, '0,5');
  assert.equal(produk[0].nilaiKotor, '100000');
});

test('outlet_id menyaring, dan outlet tenant lain ditolak 404', async () => {
  const o = await buatOrder();
  await buatBaris(o, { variationId: 'v-kopi', itemName: 'Kopi Susu', quantity: 1000, unitPrice: 25000 });

  const semua = await laporan('from=2026-08-10&to=2026-08-10');
  assert.equal(semua.json().produk.length, 1);
  assert.equal(semua.json().outletId, null);

  const lain = await seedTenantBase(appSetup, { suffix: 'ProdukLain' });
  const res = await laporan(`from=2026-08-10&to=2026-08-10&outlet_id=${lain.outlet.id}`);
  assert.equal(res.statusCode, 404, res.body);
  assert.equal(res.json().error.code, 'OUTLET_NOT_FOUND');
});

test('rentang terbalik dan tanggal tak sah ditolak 400', async () => {
  for (const q of ['from=2026-08-12&to=2026-08-10', 'from=2026-02-31&to=2026-03-01', 'from=x&to=y']) {
    const res = await laporan(q);
    assert.equal(res.statusCode, 400, `"${q}" diterima`);
    assert.equal(res.json().error.code, 'VALIDATION_ERROR');
  }
});

test('rentang tanpa penjualan mengembalikan daftar kosong, bukan 404', async () => {
  const res = await laporan('from=2026-01-01&to=2026-01-31');
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(res.json().produk, []);
});

test('⛔ tanpa sesi ditolak 401', async () => {
  const res = await app.inject({
    method: 'GET',
    url: '/reports/products?from=2026-08-10&to=2026-08-10',
    headers: { 'x-tenant-id': tenant.id },
  });
  assert.equal(res.statusCode, 401, res.body);
});

// ---------------------------------------------------------------------------
// FR-A7 AC ketiga · spec-g:86 · spec-g:99 — kolom margin
// ---------------------------------------------------------------------------

/** Menukar peran pemilik sesi. `X-Actor-Id` diabaikan di rute terlindungi. */
async function jadikanPeran(peran) {
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await appSetup.query('DELETE FROM user_role WHERE user_id = $1', [base.user.id]);
  await appSetup.query(
    `INSERT INTO user_role (id, tenant_id, user_id, role, scope_type, scope_id)
     VALUES ($1,$2,$3,$4,'outlet',$5)`,
    [crypto.randomUUID(), tenant.id, base.user.id, peran, base.outlet.id]
  );
  await appSetup.query('COMMIT');
}

async function satuProduk({ quantity = 2000, unitPrice = 20000, costAtSale = 8000 } = {}) {
  const orderId = await buatOrder({});
  await buatBaris(orderId, {
    variationId: 'var-margin',
    itemName: 'Kopi Susu',
    quantity,
    unitPrice,
    costAtSale,
  });
}

test('⛔ margin dihitung dari cost_at_sale, dan HPP-nya ikut di respons', async () => {
  // 2 unit × Rp 20.000 = Rp 40.000 kotor; HPP 2 × Rp 8.000 = Rp 16.000.
  await satuProduk();
  const res = await laporan('from=2026-08-10&to=2026-08-10');
  assert.equal(res.statusCode, 200, res.body);
  const b = res.json();
  assert.equal(b.margin, true, 'owner berhak melihat margin');

  const p = b.produk[0];
  assert.equal(p.nilaiKotor, '40000');
  assert.equal(p.hpp, '16000');
  assert.equal(p.margin, '24000');
  assert.equal(p.marginPersen, 60);
});

test('⛔ uang margin selalu STRING, tidak pernah number', async () => {
  // `bigint` tidak dapat melewati JSON, dan `Number` membuang presisi di atas
  // 2^53 — merchant yang melaporkan setahun penuh melewatinya.
  await satuProduk();
  const p = (await laporan('from=2026-08-10&to=2026-08-10')).json().produk[0];
  assert.equal(typeof p.hpp, 'string');
  assert.equal(typeof p.margin, 'string');
  assert.equal(typeof p.marginPersen, 'number', 'persen adalah angka TAMPILAN, bukan uang');
});

test('⛔ margin NEGATIF tidak di-clamp — produk yang dijual rugi itu nyata', async () => {
  // Menjepitnya ke nol menyembunyikan tepat baris yang paling perlu dilihat
  // owner.
  await satuProduk({ quantity: 1000, unitPrice: 5000, costAtSale: 8000 });
  const p = (await laporan('from=2026-08-10&to=2026-08-10')).json().produk[0];
  assert.equal(p.margin, '-3000');
  assert.equal(p.marginPersen, -60);
});

test('⛔ marginPersen null bila nilai kotor NOL, bukan 0%', async () => {
  // Produk yang seluruhnya terjual dengan potongan penuh tidak punya margin
  // persen yang berarti, dan "0%" untuknya adalah pernyataan yang salah.
  await satuProduk({ quantity: 1000, unitPrice: 0, costAtSale: 8000 });
  const p = (await laporan('from=2026-08-10&to=2026-08-10')).json().produk[0];
  assert.equal(p.nilaiKotor, '0');
  assert.equal(p.marginPersen, null);
  assert.equal(p.margin, '-8000', 'marginnya tetap dilaporkan — ia fakta');
});

test('⛔ baris ber-HPP NOL DIHITUNG dan disebutkan', async () => {
  // Nol dapat berarti "belum diisi" atau "memang tanpa biaya", dan keduanya
  // menghasilkan margin 100% yang terlihat meyakinkan. Laporan yang tidak
  // menyebutkannya akan dipercaya.
  const orderId = await buatOrder({});
  await buatBaris(orderId, {
    variationId: 'var-margin',
    itemName: 'Kopi Susu',
    quantity: 1000,
    unitPrice: 20000,
    costAtSale: 8000,
  });
  await buatBaris(orderId, {
    variationId: 'var-margin',
    itemName: 'Kopi Susu',
    quantity: 1000,
    unitPrice: 20000,
    costAtSale: 0,
  });

  const p = (await laporan('from=2026-08-10&to=2026-08-10')).json().produk[0];
  assert.equal(p.jumlahBaris, 2);
  assert.equal(p.barisTanpaHpp, 1, 'baris tanpa HPP tidak terdeteksi');
  assert.equal(p.hpp, '8000', 'baris tanpa HPP tidak menambah HPP');
});

test('⛔ KASIR tidak melihat kolom margin sama sekali', async () => {
  // `spec-g:99`, acceptance criteria harfiah. Kuncinya HILANG, bukan bernilai
  // null: kolom kosong tetap memberi tahu bahwa margin ADA dan tidak boleh
  // dilihat.
  await satuProduk();
  await jadikanPeran('cashier');
  const b = (await laporan('from=2026-08-10&to=2026-08-10')).json();

  assert.equal(b.margin, false);
  const p = b.produk[0];
  for (const kunci of ['hpp', 'margin', 'marginPersen', 'barisTanpaHpp', 'jumlahBaris']) {
    assert.ok(!(kunci in p), `kasir melihat kunci margin: ${kunci}`);
  }
});

test('⛔ kasir TETAP dapat membuka laporan produknya — 200, bukan 403', async () => {
  // `spec-g:86` menandai laporan per produk tersedia di perangkat kasir.
  // Menolak seluruh laporan demi satu kolom menutup fitur yang memang haknya.
  await satuProduk();
  await jadikanPeran('cashier');
  const res = await laporan('from=2026-08-10&to=2026-08-10');
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().produk[0].nilaiKotor, '40000', 'angka non-margin tetap utuh');
});

test('⛔ `margin` DINYATAKAN di respons, juga saat daftarnya kosong', async () => {
  // Layar yang menyimpulkan hak dari ada/tidaknya kunci pada baris pertama
  // akan menyembunyikan kolomnya untuk owner pada periode tanpa penjualan —
  // dan owner menyimpulkan haknya dicabut.
  const b = (await laporan('from=2026-01-01&to=2026-01-31')).json();
  assert.deepEqual(b.produk, []);
  assert.equal(b.margin, true);
});

test('akuntan berhak melihat margin', async () => {
  // Matriks `spec-f` memberi `view_margin` ke owner, manajer area, manajer
  // outlet, dan akuntan.
  await satuProduk();
  await jadikanPeran('accountant');
  const b = (await laporan('from=2026-08-10&to=2026-08-10')).json();
  assert.equal(b.margin, true);
  assert.equal(b.produk[0].margin, '24000');
});
