'use strict';

// ⛔ Sesi ber-peran KASIR menembak setiap rute administratif, dan HARUS
// ditolak 403.
//
// Bukan 401 (itu berarti sesinya tidak sah — di sini ia sah sepenuhnya), dan
// bukan 400 (itu berarti payload-nya cacat — penolakan yang bergantung pada
// bentuk body akan hijau untuk alasan yang salah, dan berubah diam-diam saat
// skemanya berubah).
//
// Kasir adalah peran yang paling banyak dipegang orang di merchant ini, dan
// perangkatnya berada di ruang publik. Ia justru yang paling penting dibatasi.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');
const { buatSesi } = require('../isolation/helpers/sesi');

let owner, appSetup, app, tenant, base, tokenKasir, kasirId, deviceId;

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
  base = await seedTenantBase(appSetup, { suffix: 'RbacTolak' });
  tenant = base.tenant;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();

  // ⛔ Kasir MURNI, bukan `base.user`. Fixture memberi `base.user` peran owner
  // juga (pemilik kafe kecil berdiri di kasir sendiri), jadi memakainya di
  // sini akan membuat setiap penolakan hijau karena alasan yang salah.
  kasirId = crypto.randomUUID();
  await appSetup.query('BEGIN');
  await appSetup.query("SELECT set_config('app.tenant_id', $1, true)", [tenant.id]);
  await appSetup.query('INSERT INTO "user" (id, tenant_id, name) VALUES ($1, $2, $3)', [
    kasirId,
    tenant.id,
    'Kasir Murni',
  ]);
  await appSetup.query(
    "INSERT INTO user_role (id, tenant_id, user_id, role, scope_type, scope_id) " +
      "VALUES ($1, $2, $3, 'cashier', 'outlet', $4)",
    [crypto.randomUUID(), tenant.id, kasirId, base.outlet.id]
  );
  await appSetup.query('COMMIT');

  tokenKasir = await buatSesi(appSetup, { tenantId: tenant.id, userId: kasirId });

  // seedTenantBase TIDAK membuat perangkat — yang membuatnya
  // seedTransactionCycle, fungsi lain di berkas yang sama. Dibuat di sini
  // supaya rute kredensial dan pencabutan punya target nyata; menembak id
  // karangan akan dijawab 404 oleh handler, dan 404 bukan penolakan peran.
  deviceId = crypto.randomUUID();
  await appSetup.query('BEGIN');
  await appSetup.query("SELECT set_config('app.tenant_id', $1, true)", [tenant.id]);
  await appSetup.query(
    'INSERT INTO device (id, tenant_id, outlet_id, code) VALUES ($1, $2, $3, $4)',
    [deviceId, tenant.id, base.outlet.id, 'K9']
  );
  await appSetup.query('COMMIT');
});

function sebagaiKasir(metode, url, payload) {
  return app.inject({
    method: metode,
    url,
    payload,
    headers: {
      'content-type': 'application/json',
      'x-tenant-id': tenant.id,
      authorization: `Bearer ${tokenKasir}`,
      // ⛔ Sengaja mengirim `x-actor-id` OWNER. Kalau penjaga membaca header
      // alih-alih sesi, permintaan ini akan LOLOS — dan test menangkapnya.
      'x-actor-id': base.user.id,
      // ⛔ DAN header peran karangan.
      //
      // Sabotase pertama yang kutulis mengganti nilai bawaan `peran` di
      // server dan TIDAK menjatuhkan satu test pun — ia mengubah cabang yang
      // tidak pernah menyala. Yang benar-benar menguji penjaganya adalah
      // header yang MENGKLAIM peran, persis seperti `X-Actor-Id` dulu
      // mengklaim identitas. Header ini tinggal permanen supaya sabotase
      // "peran dibaca dari header" punya sesuatu untuk dibaca.
      'x-peran': 'owner',
      'idempotency-key': crypto.randomUUID(),
    },
  });
}

/**
 * Payload SAH untuk tiap rute.
 *
 * ⛔ Sengaja sah, bukan `{}`. Penolakan yang terjadi karena body kosong
 * adalah 400 yang menyamar sebagai penjaga peran — ia hijau hari ini dan
 * berubah diam-diam saat skema berubah.
 */
function kasus() {
  const varId = base.item_variation.id;
  const itemId = base.item.id;
  const kategoriId = base.category.id;
  const mlId = base.modifier_list.id;
  const modId = base.modifier.id;
  const pajakId = base.tax_rate.id;

  return [
    ['POST', '/categories', { id: crypto.randomUUID(), name: 'Kategori Kasir' }],
    ['PATCH', `/categories/${kategoriId}`, { name: 'Diubah Kasir' }],
    ['POST', `/categories/${kategoriId}/archive`, {}],
    ['POST', `/categories/${kategoriId}/restore`, {}],

    [
      'POST',
      '/items',
      {
        id: crypto.randomUUID(),
        name: 'Produk Kasir',
        variations: [{ id: crypto.randomUUID(), name: 'Regular', price: '10000' }],
      },
    ],
    ['PATCH', `/items/${itemId}`, { name: 'Diubah Kasir' }],
    ['POST', `/items/${itemId}/archive`, {}],
    ['POST', `/items/${itemId}/restore`, {}],
    ['POST', `/items/${itemId}/variations`, { id: crypto.randomUUID(), name: 'L', price: '2000' }],
    ['PATCH', `/items/${itemId}/variations/${varId}`, { name: 'XL' }],
    ['POST', `/items/${itemId}/variations/${varId}/archive`, {}],
    ['POST', `/items/${itemId}/variations/${varId}/restore`, {}],

    ['POST', '/modifier-lists', { id: crypto.randomUUID(), name: 'Topping', selectionType: 'single' }],
    ['PATCH', `/modifier-lists/${mlId}`, { name: 'Topping Kasir' }],
    ['POST', `/modifier-lists/${mlId}/archive`, {}],
    ['POST', `/modifier-lists/${mlId}/restore`, {}],
    ['POST', `/modifier-lists/${mlId}/modifiers`, { id: crypto.randomUUID(), name: 'Boba', priceDelta: '1000' }],

    ['PATCH', `/modifier-lists/${mlId}/modifiers/${modId}`, { name: 'Boba Kasir' }],
    ['POST', `/modifier-lists/${mlId}/modifiers/${modId}/archive`, {}],
    ['POST', `/modifier-lists/${mlId}/modifiers/${modId}/restore`, {}],

    ['POST', `/items/${itemId}/modifier-lists/${mlId}`, {}],
    ['DELETE', `/items/${itemId}/modifier-lists/${mlId}`, undefined],

    ['POST', '/catalog/import', { csv: 'nama,harga\nKopi Kasir,9000', dryRun: false }],

    // Harga: `price_edit`, bukan `catalog_edit`.
    [
      'POST',
      `/items/${itemId}/variations/${varId}/prices`,
      { id: crypto.randomUUID(), price: 12000 },
    ],

    // Profil vertikal (B-24): owner saja. Ia menentukan perilaku SELURUH
    // outlet yang mewarisinya.
    ['POST', '/vertical-profiles', { id: crypto.randomUUID() }],
    ['PATCH', `/vertical-profiles/${base.vertical_profile.id}`, { allowNegativeStock: false }],
    ['PUT', `/outlets/${base.outlet.id}/vertical-profile`, { verticalProfileId: null }],

    // ⛔ Ambang otorisasi (B-26): owner + manajer area saja.
    //
    // Kasir yang dapat menaikkan ambangnya sendiri dapat menghapus kebutuhan
    // atas setiap PIN yang produk ini ada untuk menuntut.
    ['PUT', `/outlets/${base.outlet.id}/thresholds`, { selisihKas: '999' }],

    // Pajak: owner saja.
    [
      'POST',
      '/tax-rates',
      {
        id: crypto.randomUUID(),
        outletId: base.outlet.id,
        name: 'PB1 Kasir',
        type: 'pbjt',
        rate: '0.1',
        isInclusive: true,
        phase: 'subtotal',
        channel: 'all',
        appliesTo: 'all_items',
        effectiveFrom: new Date().toISOString(),
      },
    ],

    // Perangkat.
    ['POST', '/devices', { id: crypto.randomUUID(), outletId: base.outlet.id, code: 'KX' }],
    ['POST', `/devices/${deviceId}/credentials`, {}],
    ['POST', `/devices/${deviceId}/revoke`, {}],
    ['GET', '/devices', undefined],

    // Outlet & komersial.
    [
      'POST',
      '/outlets',
      { id: crypto.randomUUID(), name: 'Cabang Kasir', timezone: 'Asia/Jakarta' },
    ],
    ['POST', `/tax-rates/${pajakId}/end`, { effectiveTo: new Date().toISOString() }],
    ['GET', '/tenants/usage', undefined],

    // F5 — langganan. `billing` di `spec-f:52` berarti uang sungguhan yang
    // keluar dari rekening merchant: kasir yang dapat menaikkan paket dapat
    // menaikkan tagihan bulanan tanpa sepengetahuan pemiliknya.
    ['POST', '/tenants/subscription/invoices', { id: crypto.randomUUID(), plan: 'standard' }],
    ['GET', '/tenants/subscription/invoices', undefined],
    ['POST', `/tenants/subscription/invoices/${crypto.randomUUID()}/check-status`, {}],

    // FR-C12 — kategori merchant. Ia menentukan angka yang merchant pakai
    // untuk menjelaskan selisih uang yang masuk rekening; kasir yang dapat
    // mengubahnya dapat membuat selisih terlihat wajar.
    ['PATCH', '/tenants/settings', { merchantCategory: 'uke' }],

    // Inventori: `stock_adjust`. Kasir tidak menyesuaikan stok — seluruh
    // pengurangan yang boleh ia sebabkan lahir dari penjualan.
    [
      'POST',
      '/inventory/movements',
      { outletId: base.outlet.id, variationId: varId, type: 'receipt', delta: '1000' },
    ],
    // ⛔ Pembersihan keranjang terbengkalai ikut `stock_adjust`, bukan
    // `void_refund` — yang terakhir mencakup kasir, dan pembersihan massal
    // lintas outlet bukan wewenangnya.
    ['POST', '/orders/cleanup-abandoned', undefined],

    // Opname: seluruh siklus hidupnya `stock_adjust`.
    ['POST', '/inventory/stocktakes', { outletId: base.outlet.id }],
    ['PUT', `/inventory/stocktakes/${crypto.randomUUID()}/lines`, { lines: [{ variationId: varId, countedQty: '1000' }] }],
    ['POST', `/inventory/stocktakes/${crypto.randomUUID()}/complete`, {}],
  ];
}

// ---------------------------------------------------------------------------

test('⛔ kasir ditolak 403 di SETIAP rute administratif', async () => {
  const gagal = [];
  for (const [metode, url, payload] of kasus()) {
    const res = await sebagaiKasir(metode, url, payload);
    if (res.statusCode !== 403) {
      gagal.push(`${metode} ${url} → ${res.statusCode} ${res.body.slice(0, 120)}`);
      continue;
    }
    const kode = JSON.parse(res.body).error.code;
    if (kode !== 'FORBIDDEN') gagal.push(`${metode} ${url} → 403 tapi kode "${kode}"`);
  }
  assert.deepEqual(gagal, [], `Rute yang TIDAK menolak kasir dengan 403 FORBIDDEN:\n  ${gagal.join('\n  ')}`);
});

test('⛔ jumlah kasus MENUTUPI seluruh PETA_PERAN', async () => {
  // Test di atas hanya sekuat daftar kasusnya. Rute yang ditambahkan ke
  // `PETA_PERAN` tapi lupa diuji di sini akan lolos tanpa satu pun test merah
  // — penjaga cakupan menjamin ia PUNYA aturan, bukan bahwa aturannya
  // BEKERJA.
  const { PETA_PERAN } = await import('../../apps/server/src/rbac-rute.ts');

  // Pola rute (`:itemId`) versus URL nyata (`abc-123`): dicocokkan lewat
  // jumlah segmen dan segmen statisnya.
  const cocok = (pola, url) => {
    const a = pola.split('/');
    const b = url.split('/');
    if (a.length !== b.length) return false;
    return a.every((seg, i) => seg.startsWith(':') || seg === b[i]);
  };

  const diuji = kasus().map(([m, u]) => ({ m, u }));
  const tidakDiuji = PETA_PERAN.filter(
    (r) => !diuji.some((k) => k.m === r.metode && cocok(r.pola, k.u))
  ).map((r) => `${r.metode} ${r.pola}`);

  assert.deepEqual(
    tidakDiuji,
    [],
    `Rute berperan yang tidak punya kasus penolakan:\n  ${tidakDiuji.join('\n  ')}`
  );
});

test('⛔ penolakan 403 TIDAK menulis satu baris pun', async () => {
  // Penjaga yang menolak SETELAH menulis tidak menutup apa pun.
  const sebelum = await hitung();
  for (const [metode, url, payload] of kasus()) {
    await sebagaiKasir(metode, url, payload);
  }
  assert.deepEqual(await hitung(), sebelum, 'ada baris tertulis oleh permintaan yang ditolak');
});

async function hitung() {
  await appSetup.query('BEGIN');
  await appSetup.query("SELECT set_config('app.tenant_id', $1, true)", [tenant.id]);
  const { rows } = await appSetup.query(
    `SELECT (SELECT count(*) FROM item) AS item,
            (SELECT count(*) FROM category) AS kategori,
            (SELECT count(*) FROM modifier_list) AS ml,
            (SELECT count(*) FROM price_history) AS harga,
            (SELECT count(*) FROM tax_rate) AS pajak,
            (SELECT count(*) FROM device) AS perangkat,
            (SELECT count(*) FROM outlet) AS outlet`
  );
  await appSetup.query('COMMIT');
  return rows[0];
}

// --- yang HARUS tetap boleh ------------------------------------------------

test('⛔ kasir tetap dapat MEMBACA katalog — batasnya menulis, bukan melihat', async () => {
  // Aplikasi kasir membaca katalog lewat jalur turun, bukan REST. Tapi
  // membatasi bacaan di sini akan menutup layar mana pun yang kelak
  // menampilkan produk kepada kasir, dan itu bukan yang `spec-f` minta.
  for (const url of ['/items', '/categories', '/modifier-lists']) {
    const res = await sebagaiKasir('GET', url, undefined);
    assert.notEqual(res.statusCode, 403, `${url} ditolak untuk kasir`);
  }
});

test('⛔ kasir tetap dapat LOGOUT', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/logout',
    headers: { 'x-tenant-id': tenant.id, authorization: `Bearer ${tokenKasir}` },
  });
  assert.equal(res.statusCode, 204, res.body);
});

test('⛔ jalur perangkat kasir TIDAK ikut tertutup', async () => {
  // Relay outbox tidak mengirim Bearer sama sekali. Kalau penjaga peran
  // menyentuhnya, setiap penjualan offline yang menyusul dijawab 403.
  const res = await app.inject({
    method: 'POST',
    url: '/shifts',
    payload: {},
    headers: {
      'content-type': 'application/json',
      'x-tenant-id': tenant.id,
      'x-actor-id': kasirId,
    },
  });
  assert.ok(res.statusCode !== 403 && res.statusCode !== 401, `jalur naik tertutup: ${res.statusCode}`);
});
