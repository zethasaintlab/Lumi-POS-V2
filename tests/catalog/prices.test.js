'use strict';

// FR-A7 sub-project 2 -- harga per outlet dan riwayatnya
// (docs/superpowers/plans/PLAN-katalog-harga-riwayat.md, T2-T6).
//
// Pola test SAMA PERSIS dengan tests/catalog/items.test.js: seedTenantBase
// dua kali untuk skenario lintas tenant, appSetup dipakai untuk pembuktian
// langsung ke DB (BEGIN/set_config/COMMIT) supaya SELECT itu sendiri tunduk
// RLS -- bukan lumi_owner, yang MENURUT tests/isolation/helpers/reset.js
// juga tidak bisa bypass RLS untuk SELECT/INSERT/UPDATE/DELETE (hanya
// TRUNCATE yang bebas RLS). Membuktikan "tidak ada baris tersimpan" karena
// itu SELALU lewat client yang app.tenant_id-nya sudah di-SET LOCAL ke
// tenant PEMANGGIL (base.tenant.id) -- itulah tenant_id yang akan tersimpan
// di baris price_history kalau bug F1 (FK bukan RLS) muncul lagi di sini.

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
  base = await seedTenantBase(appSetup, { suffix: 'PriceTest' });
  tenant = base.tenant;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();
});

function pricesUrl(itemId, variationId) {
  return `/items/${itemId}/variations/${variationId}/prices`;
}

function priceUrl(itemId, variationId) {
  return `/items/${itemId}/variations/${variationId}/price`;
}

function outletPricesUrl(outletId) {
  return `/outlets/${outletId}/prices`;
}

function req(method, url, payload, headers = {}) {
  return app.inject({
    method,
    url,
    payload,
    headers: { 'x-tenant-id': tenant.id, 'x-actor-id': base.user.id, ...headers },
  });
}

// T7-T10 butuh item_variation "bersih" -- tanpa riwayat harga bawaan --
// supaya matriks tangga resolusi tidak bertabrakan dengan price_history yang
// sudah di-seed seedTenantBase untuk base.item_variation (outlet_id =
// base.outlet.id, price 20000). Dibuat lewat endpoint POST /items yang
// sudah ada (sub-project 1), bukan insert langsung, supaya jalur yang
// dites persis jalur yang dipakai klien nyata.
async function createVariation(price) {
  const itemId = crypto.randomUUID();
  const variationId = crypto.randomUUID();
  const res = await req('POST', '/items', {
    id: itemId,
    name: `Produk ${variationId.slice(0, 8)}`,
    variations: [{ id: variationId, price }],
  });
  assert.equal(res.statusCode, 201, `gagal membuat item/variation persiapan test: ${res.body}`);
  return { itemId, variationId };
}

// Outlet kedua dalam tenant yang sama, dibutuhkan untuk kasus "outlet A
// punya override, outlet B tidak". Tidak ada endpoint POST /outlets di
// modul tenancy (di luar scope FR-A7) -- insert langsung lewat appSetup,
// pola sama dengan seedTenantBase.outlet.
async function insertOutlet(suffix) {
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  const { rows } = await appSetup.query(
    `INSERT INTO outlet (id, tenant_id, name, timezone, vertical_profile_id)
     VALUES ($1, $2, $3, 'Asia/Jakarta', $4) RETURNING *`,
    [crypto.randomUUID(), tenant.id, `Outlet ${suffix}`, base.vertical_profile.id]
  );
  await appSetup.query('COMMIT');
  return rows[0];
}

async function seedPrice(itemId, variationId, { outletId, price, effectiveFrom }) {
  const res = await req('POST', pricesUrl(itemId, variationId), {
    id: crypto.randomUUID(),
    price,
    outletId: outletId ?? null,
    effectiveFrom,
  });
  assert.equal(res.statusCode, 201, `gagal seed price_history: ${res.body}`);
  return JSON.parse(res.body);
}

// Baris mentah langsung dari DB (bukan lewat JSON envelope endpoint) --
// dipakai T9 untuk membuktikan baris pertama byte-identik setelah
// perubahan kedua, termasuk kolom yang tidak diserialisasi toPrice().
async function fetchRawPriceRow(id) {
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  const { rows } = await appSetup.query('SELECT * FROM price_history WHERE id = $1', [id]);
  await appSetup.query('COMMIT');
  return rows[0];
}

// Membuktikan langsung ke DB bahwa TIDAK ADA baris price_history dengan id
// tertentu tersimpan untuk tenant pemanggil (`callerTenantId`). Dijalankan
// lewat appSetup (lumi_app, RLS-bound) dengan app.tenant_id di-SET LOCAL ke
// tenant pemanggil -- karena INSERT price_history SELALU menulis
// tenant_id = tenant pemanggil, terlepas dari variation/outlet/actor mana
// yang dirujuk di body. Status code 404 saja tidak cukup (bug F1: createItem
// pernah mengembalikan 201 SAMBIL menyimpan baris yang salah).
async function assertNoPriceRowSaved(callerTenantId, priceId) {
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [callerTenantId]);
  const { rows } = await appSetup.query('SELECT id FROM price_history WHERE id = $1', [priceId]);
  await appSetup.query('COMMIT');
  assert.equal(rows.length, 0, 'tidak boleh ada baris price_history tersimpan untuk request yang ditolak');
}

// --- T2: jalur bahagia ---

test('createPrice: jalur bahagia, 201, baris tersimpan, changed_by terisi aktor', async () => {
  const priceId = crypto.randomUUID();
  const res = await req('POST', pricesUrl(base.item.id, base.item_variation.id), {
    id: priceId,
    price: 28000,
    outletId: base.outlet.id,
    reason: 'Kenaikan harga biji kopi',
  });
  assert.equal(res.statusCode, 201);
  const body = JSON.parse(res.body);
  assert.equal(body.id, priceId);
  assert.equal(body.variationId, base.item_variation.id);
  assert.equal(body.outletId, base.outlet.id);
  assert.equal(body.price, 28000);
  assert.equal(body.reason, 'Kenaikan harga biji kopi');
  assert.equal(body.changedBy, base.user.id, 'changed_by harus terisi dari X-Actor-Id yang tervalidasi');
});

// --- T2b: tanpa outletId -> outlet_id NULL (harga default tenant) ---

test('createPrice: tanpa outletId tersimpan dengan outletId null (harga default tenant)', async () => {
  const res = await req('POST', pricesUrl(base.item.id, base.item_variation.id), {
    id: crypto.randomUUID(),
    price: 30000,
  });
  assert.equal(res.statusCode, 201);
  assert.equal(JSON.parse(res.body).outletId, null);
});

// --- T2c: effectiveFrom masa depan diizinkan (keputusan Q4) ---

test('createPrice: effectiveFrom masa depan diterima dan tersimpan apa adanya', async () => {
  const future = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  const res = await req('POST', pricesUrl(base.item.id, base.item_variation.id), {
    id: crypto.randomUUID(),
    price: 32000,
    effectiveFrom: future,
  });
  assert.equal(res.statusCode, 201);
  const body = JSON.parse(res.body);
  assert.equal(new Date(body.effectiveFrom).toISOString(), future);
});

// Plan §3.3 mensyaratkan "effectiveFrom wajib timestamp valid bila dikirim".
// Yang diuji di sini BUKAN sekadar "ditolak", tapi ditolak sebagai 4xx dengan
// envelope error yang konsisten -- bukan 500 dari cast error PostgreSQL yang
// bocor lewat. Bentuk kegagalan itu yang membedakan validasi sungguhan dari
// kebetulan.
test('createPrice: effectiveFrom bukan timestamp ditolak 4xx bersih, bukan 500', async () => {
  const res = await req('POST', pricesUrl(base.item.id, base.item_variation.id), {
    id: crypto.randomUUID(),
    price: 25000,
    effectiveFrom: 'bukan-tanggal',
  });
  assert.ok(
    res.statusCode >= 400 && res.statusCode < 500,
    `harusnya 4xx, dapat ${res.statusCode}: ${res.body}`
  );
  const body = JSON.parse(res.body);
  assert.ok(body.error && body.error.code, `envelope error tidak konsisten: ${res.body}`);
});

// --- T3: validasi price ---

test('createPrice: price negatif ditolak 400 VALIDATION_ERROR', async () => {
  const res = await req('POST', pricesUrl(base.item.id, base.item_variation.id), {
    id: crypto.randomUUID(),
    price: -1,
  });
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error.code, 'VALIDATION_ERROR');
});

test('createPrice: price non-integer (1000.5) ditolak 400 VALIDATION_ERROR', async () => {
  const res = await req('POST', pricesUrl(base.item.id, base.item_variation.id), {
    id: crypto.randomUUID(),
    price: 1000.5,
  });
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error.code, 'VALIDATION_ERROR');
});

test('createPrice: price bukan angka (string) ditolak 400 VALIDATION_ERROR', async () => {
  const res = await req('POST', pricesUrl(base.item.id, base.item_variation.id), {
    id: crypto.randomUUID(),
    price: 'banyak',
  });
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error.code, 'VALIDATION_ERROR');
});

// JSON tidak punya literal NaN -- JSON.stringify(NaN) sendiri menghasilkan
// `null` (dibuktikan empiris, lihat catatan implementasi). `price: null`
// adalah bentuk yang SUNGGUH bisa dikirim klien nyata (mis. hasil komputasi
// klien yang jadi NaN lalu diserialisasi) dan menempuh cabang guard yang
// sama (typeof !== 'number') seperti nilai bukan-angka lainnya.
test('createPrice: price null (representasi nilai numerik rusak) ditolak 400 VALIDATION_ERROR', async () => {
  const res = await req('POST', pricesUrl(base.item.id, base.item_variation.id), {
    id: crypto.randomUUID(),
    price: null,
  });
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error.code, 'VALIDATION_ERROR');
});

test('createPrice: price di atas Number.MAX_SAFE_INTEGER ditolak 400 VALIDATION_ERROR', async () => {
  const res = await req('POST', pricesUrl(base.item.id, base.item_variation.id), {
    id: crypto.randomUUID(),
    price: Number.MAX_SAFE_INTEGER + 1,
  });
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error.code, 'VALIDATION_ERROR');
});

// --- T3b: price = 0 diterima (barang gratis/promo, bukan error) ---

test('createPrice: price 0 diterima (barang gratis/promo bukan error)', async () => {
  const res = await req('POST', pricesUrl(base.item.id, base.item_variation.id), {
    id: crypto.randomUUID(),
    price: 0,
  });
  assert.equal(res.statusCode, 201);
  assert.equal(JSON.parse(res.body).price, 0);
});

// --- T4: variation lintas tenant -> 404, tidak ada baris tersimpan ---

test('createPrice: variation milik tenant lain ditolak 404, tidak ada baris tersimpan', async () => {
  const otherBase = await seedTenantBase(appSetup, { suffix: 'PriceTestOtherVar' });
  const priceId = crypto.randomUUID();

  const res = await req('POST', pricesUrl(otherBase.item.id, otherBase.item_variation.id), {
    id: priceId,
    price: 99000,
  });
  assert.equal(res.statusCode, 404);
  assert.equal(JSON.parse(res.body).error.code, 'NOT_FOUND');

  await assertNoPriceRowSaved(tenant.id, priceId);
});

// --- T5: outlet lintas tenant -> 404, tidak ada baris tersimpan ---

test('createPrice: outletId milik tenant lain ditolak 404, tidak ada baris tersimpan', async () => {
  const otherBase = await seedTenantBase(appSetup, { suffix: 'PriceTestOtherOutlet' });
  const priceId = crypto.randomUUID();

  const res = await req('POST', pricesUrl(base.item.id, base.item_variation.id), {
    id: priceId,
    price: 27000,
    outletId: otherBase.outlet.id,
  });
  assert.equal(res.statusCode, 404);
  assert.equal(JSON.parse(res.body).error.code, 'OUTLET_NOT_FOUND');

  await assertNoPriceRowSaved(tenant.id, priceId);
});

// --- T5b: actor (X-Actor-Id) lintas tenant -> 404, tidak ada baris tersimpan ---

test('createPrice: actor (X-Actor-Id) milik tenant lain ditolak 404, tidak ada baris tersimpan', async () => {
  const otherBase = await seedTenantBase(appSetup, { suffix: 'PriceTestOtherActor' });
  const priceId = crypto.randomUUID();

  const res = await req(
    'POST',
    pricesUrl(base.item.id, base.item_variation.id),
    { id: priceId, price: 26000 },
    { 'x-actor-id': otherBase.user.id }
  );
  assert.equal(res.statusCode, 404);
  assert.equal(JSON.parse(res.body).error.code, 'ACTOR_NOT_FOUND');

  await assertNoPriceRowSaved(tenant.id, priceId);
});

// Retry adalah keadaan NORMAL di POS offline-first, bukan kasus tepi:
// perangkat mengirim, jaringan putus sebelum respons sampai, perangkat
// mengirim ulang id yang sama. Yang harus TIDAK terjadi adalah dua baris
// riwayat harga untuk satu perubahan. Pola dan kode error sama dengan
// createItem/createCategory/createModifier ("id yang sama dikirim ulang").
test('createPrice: id yang sama dikirim ulang (retry offline) ditolak 409 ID_ALREADY_EXISTS, bukan 500', async () => {
  const priceId = crypto.randomUUID();
  const payload = { id: priceId, price: 25000, outletId: base.outlet.id };

  const first = await req('POST', pricesUrl(base.item.id, base.item_variation.id), payload);
  assert.equal(first.statusCode, 201, first.body);

  const retry = await req('POST', pricesUrl(base.item.id, base.item_variation.id), payload);
  assert.equal(retry.statusCode, 409, retry.body);
  assert.equal(JSON.parse(retry.body).error.code, 'ID_ALREADY_EXISTS');

  // Bukti yang sebenarnya penting: tepat SATU baris, bukan dua.
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  const { rows } = await appSetup.query('SELECT id FROM price_history WHERE id = $1', [priceId]);
  await appSetup.query('COMMIT');
  assert.equal(rows.length, 1, 'retry tidak boleh menghasilkan baris riwayat harga kedua');
});

// Retry dengan id sama tapi HARGA BERBEDA adalah hal yang berbeda: itu bukan
// retry, itu perubahan harga baru yang salah memakai id lama. Harus tetap
// ditolak, dan harga yang tersimpan harus tetap yang pertama -- kalau yang
// kedua menang, invariant #2 (record selesai tidak pernah di-UPDATE) bocor
// lewat pintu belakang.
test('createPrice: id sama dengan price berbeda ditolak 409, harga pertama tidak berubah', async () => {
  const priceId = crypto.randomUUID();
  const first = await req('POST', pricesUrl(base.item.id, base.item_variation.id), {
    id: priceId,
    price: 25000,
  });
  assert.equal(first.statusCode, 201, first.body);

  const second = await req('POST', pricesUrl(base.item.id, base.item_variation.id), {
    id: priceId,
    price: 99000,
  });
  assert.equal(second.statusCode, 409, second.body);

  const stored = await fetchRawPriceRow(priceId);
  assert.equal(Number(stored.price), 25000, 'harga pertama tidak boleh tertimpa lewat retry ber-id sama');
});

// --- T5c: header X-Actor-Id hilang -> 400 MISSING_ACTOR_ID ---

test('createPrice: header X-Actor-Id hilang ditolak 400 MISSING_ACTOR_ID', async () => {
  const res = await app.inject({
    method: 'POST',
    url: pricesUrl(base.item.id, base.item_variation.id),
    payload: { id: crypto.randomUUID(), price: 25000 },
    headers: { 'x-tenant-id': tenant.id },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error.code, 'MISSING_ACTOR_ID');
});

// --- T6: GET riwayat -- urutan dan isolasi tenant ---

test('listPrices: riwayat terurut effectiveFrom DESC, lalu id DESC untuk tie', async () => {
  const varId = base.item_variation.id;
  const tEarly = new Date('2026-01-01T00:00:00.000Z').toISOString();
  const tTie = new Date('2026-06-01T00:00:00.000Z').toISOString();

  const candidateA = crypto.randomUUID();
  const candidateB = crypto.randomUUID();
  const [lower, higher] = [candidateA, candidateB].sort();

  await req('POST', pricesUrl(base.item.id, varId), { id: lower, price: 21000, effectiveFrom: tTie });
  await req('POST', pricesUrl(base.item.id, varId), { id: higher, price: 22000, effectiveFrom: tTie });
  const idEarly = crypto.randomUUID();
  await req('POST', pricesUrl(base.item.id, varId), { id: idEarly, price: 19000, effectiveFrom: tEarly });

  const res = await req('GET', pricesUrl(base.item.id, varId));
  assert.equal(res.statusCode, 200);
  const relevant = [higher, lower, idEarly];
  const returnedOrder = JSON.parse(res.body).items.map((p) => p.id).filter((id) => relevant.includes(id));
  assert.deepEqual(
    returnedOrder,
    [higher, lower, idEarly],
    'urutan harus effectiveFrom DESC, dengan id DESC sebagai tie-breaker'
  );
});

test('listPrices: variation tidak ditemukan (mis. lintas tenant) ditolak 404, bukan riwayat kosong', async () => {
  const otherBase = await seedTenantBase(appSetup, { suffix: 'PriceTestOtherList' });
  const res = await req('GET', pricesUrl(otherBase.item.id, otherBase.item_variation.id));
  assert.equal(res.statusCode, 404);
  assert.equal(JSON.parse(res.body).error.code, 'NOT_FOUND');
});

// --- T7 + T8: resolvePrice (tangga tiga tingkat) + GET .../price ---
//
// Referensi waktu TUNGGAL untuk seluruh matriks (bukan Date.now() dipanggil
// berulang) -- kasus "effective_from == at tepat" butuh kesamaan string ISO
// persis antara nilai yang di-seed dan nilai yang dikirim query, dan dua
// panggilan Date.now() terpisah bisa berbeda beberapa milidetik.
const NOW = Date.now();
function iso(offsetDays) {
  return new Date(NOW + offsetDays * 24 * 60 * 60 * 1000).toISOString();
}

// Matriks kasus PLAN §"T7" -- setiap baris murni data, loop di bawah tidak
// punya percabangan khusus per kasus. `outlet: 'none' | 'A' | 'B'` menunjuk
// anak tangga mana yang dipakai ('A' selalu base.outlet, 'B' dibuat lazy
// lewat needsOutletB). `leak` (hanya kasus terakhir) menyuntik baris
// price_history milik TENANT LAIN yang menunjuk variation kita lewat INSERT
// langsung (bukan lewat endpoint createPrice, yang sudah menolaknya) --
// membuktikan RLS pada SELECT resolvePrice sendiri, bukan hanya guard tulis.
const PRICE_LADDER_CASES = [
  {
    label: 'tidak ada riwayat sama sekali -> item_variation.price (rung 3, empty state)',
    variationPrice: 15000,
    seedPrices: [],
    queries: [
      { outlet: 'none', at: iso(0), expectedPrice: 15000, expectedSource: 'variation' },
      { outlet: 'A', at: iso(0), expectedPrice: 15000, expectedSource: 'variation' },
    ],
  },
  {
    label: 'override outlet + default tenant ada, default lebih tua -> override menang',
    variationPrice: 10000,
    seedPrices: [
      { outlet: 'none', price: 18000, at: iso(-10) },
      { outlet: 'A', price: 19000, at: iso(-5) },
    ],
    queries: [{ outlet: 'A', at: iso(0), expectedPrice: 19000, expectedSource: 'outlet' }],
  },
  {
    label: 'override outlet + default tenant ada, override LEBIH TUA dari default -> override tetap menang',
    variationPrice: 10000,
    seedPrices: [
      { outlet: 'A', price: 22000, at: iso(-20) },
      { outlet: 'none', price: 21000, at: iso(-2) },
    ],
    queries: [{ outlet: 'A', at: iso(0), expectedPrice: 22000, expectedSource: 'outlet' }],
  },
  {
    label: 'override outlet terjadwal masa depan -> jatuh ke default tenant, bukan memungut harga belum berlaku',
    variationPrice: 10000,
    seedPrices: [
      { outlet: 'none', price: 17000, at: iso(-10) },
      { outlet: 'A', price: 99000, at: iso(30) },
    ],
    queries: [{ outlet: 'A', at: iso(0), expectedPrice: 17000, expectedSource: 'tenant' }],
  },
  {
    label: 'effective_from == at tepat -> batas inklusif, berlaku',
    variationPrice: 10000,
    seedPrices: [{ outlet: 'none', price: 23000, at: iso(-7) }],
    queries: [{ outlet: 'none', at: iso(-7), expectedPrice: 23000, expectedSource: 'tenant' }],
  },
  {
    label: 'beberapa perubahan berurutan -> yang terakhir SEBELUM at menang, bukan yang paling baru absolut',
    variationPrice: 10000,
    seedPrices: [
      { outlet: 'none', price: 11000, at: iso(-30) },
      { outlet: 'none', price: 12000, at: iso(-10) },
      { outlet: 'none', price: 13000, at: iso(10) },
    ],
    queries: [{ outlet: 'none', at: iso(0), expectedPrice: 12000, expectedSource: 'tenant' }],
  },
  {
    label: 'outlet A punya override, outlet B tidak -> B jatuh ke default tenant, A tidak',
    variationPrice: 10000,
    needsOutletB: true,
    seedPrices: [
      { outlet: 'none', price: 14000, at: iso(-10) },
      { outlet: 'A', price: 16000, at: iso(-5) },
    ],
    queries: [
      { outlet: 'A', at: iso(0), expectedPrice: 16000, expectedSource: 'outlet' },
      { outlet: 'B', at: iso(0), expectedPrice: 14000, expectedSource: 'tenant' },
    ],
  },
  {
    label: 'satu-satunya riwayat ada tapi effective_from di masa depan relatif at -> tetap jatuh ke variation',
    variationPrice: 25000,
    seedPrices: [{ outlet: 'none', price: 30000, at: iso(5) }],
    queries: [{ outlet: 'none', at: iso(0), expectedPrice: 25000, expectedSource: 'variation' }],
  },
  {
    label: 'isolasi tenant: riwayat harga tenant lain (disuntik langsung, bukan lewat endpoint) tidak memengaruhi resolusi',
    variationPrice: 10000,
    seedPrices: [{ outlet: 'none', price: 12000, at: iso(-10) }],
    leak: { price: 999999999, at: iso(-1) },
    queries: [{ outlet: 'none', at: iso(0), expectedPrice: 12000, expectedSource: 'tenant' }],
  },
];

test('resolvePrice (lewat GET .../price): tangga resolusi tiga tingkat -- matriks kasus lengkap', async () => {
  let outletB;
  let queriesRun = 0;
  let assertionsRun = 0;

  function outletIdFor(label) {
    if (label === 'none') return null;
    if (label === 'A') return base.outlet.id;
    if (label === 'B') {
      if (!outletB) throw new Error(`kasus butuh outlet B tapi needsOutletB tidak di-set`);
      return outletB.id;
    }
    throw new Error(`label outlet tidak dikenal: ${label}`);
  }

  for (const c of PRICE_LADDER_CASES) {
    const { itemId, variationId } = await createVariation(c.variationPrice);
    outletB = c.needsOutletB ? await insertOutlet(`Prop-${variationId.slice(0, 8)}`) : undefined;

    for (const p of c.seedPrices) {
      await seedPrice(itemId, variationId, { outletId: outletIdFor(p.outlet), price: p.price, effectiveFrom: p.at });
    }

    if (c.leak) {
      const otherBase = await seedTenantBase(appSetup, { suffix: `PriceLeak-${variationId.slice(0, 8)}` });
      await appSetup.query('BEGIN');
      await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [otherBase.tenant.id]);
      await appSetup.query(
        `INSERT INTO price_history (id, tenant_id, variation_id, outlet_id, price, effective_from, changed_by, reason)
         VALUES ($1, $2, $3, NULL, $4, $5, $6, 'leak-test-tenant-lain')`,
        [crypto.randomUUID(), otherBase.tenant.id, variationId, c.leak.price, c.leak.at, otherBase.user.id]
      );
      await appSetup.query('COMMIT');
    }

    for (const q of c.queries) {
      const outletId = outletIdFor(q.outlet);
      const qs = new URLSearchParams({ at: q.at });
      if (outletId) qs.set('outletId', outletId);
      const res = await req('GET', `${priceUrl(itemId, variationId)}?${qs.toString()}`);
      queriesRun += 1;

      assert.equal(res.statusCode, 200, `[${c.label}] status: ${res.body}`);
      assertionsRun += 1;
      const body = JSON.parse(res.body);
      assert.equal(body.price, q.expectedPrice, `[${c.label}] price salah: dapat ${JSON.stringify(body)}`);
      assertionsRun += 1;
      assert.equal(body.source, q.expectedSource, `[${c.label}] source salah: dapat ${JSON.stringify(body)}`);
      assertionsRun += 1;
      assert.equal(body.outletId, outletId ?? null, `[${c.label}] outletId pada respons tidak sesuai yang diminta`);
      assertionsRun += 1;
    }
  }

  const expectedQueries = PRICE_LADDER_CASES.reduce((sum, c) => sum + c.queries.length, 0);
  assert.equal(
    queriesRun,
    expectedQueries,
    'loop property test tidak menyentuh semua kasus query yang diklaim ada di matriks'
  );
  assert.equal(assertionsRun, expectedQueries * 4, 'jumlah assertion yang berjalan tidak sesuai jumlah query * 4');
});

test('getResolvedPrice: parameter at default now() kalau tidak dikirim', async () => {
  const { itemId, variationId } = await createVariation(8000);
  const res = await req('GET', priceUrl(itemId, variationId));
  assert.equal(res.statusCode, 200, res.body);
  const body = JSON.parse(res.body);
  assert.equal(body.price, 8000);
  assert.equal(body.source, 'variation');
  assert.ok(body.at, 'field at harus terisi meski tidak dikirim di query');
  const atMs = new Date(body.at).getTime();
  assert.ok(Math.abs(Date.now() - atMs) < 5000, 'at default harus mendekati waktu request, bukan nilai statis/masa lalu');
});

test('getResolvedPrice: parameter at bukan timestamp valid ditolak 400 VALIDATION_ERROR, bukan 500', async () => {
  const { itemId, variationId } = await createVariation(8000);
  const res = await req('GET', `${priceUrl(itemId, variationId)}?at=bukan-tanggal`);
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error.code, 'VALIDATION_ERROR');
});

test('getResolvedPrice: variation tidak ditemukan (lintas tenant) ditolak 404 NOT_FOUND', async () => {
  const otherBase = await seedTenantBase(appSetup, { suffix: 'PriceTestResolveOtherVar' });
  const res = await req('GET', priceUrl(otherBase.item.id, otherBase.item_variation.id));
  assert.equal(res.statusCode, 404);
  assert.equal(JSON.parse(res.body).error.code, 'NOT_FOUND');
});

test('getResolvedPrice: outletId lintas tenant ditolak 404 OUTLET_NOT_FOUND', async () => {
  const otherBase = await seedTenantBase(appSetup, { suffix: 'PriceTestResolveOtherOutlet' });
  const { itemId, variationId } = await createVariation(8000);
  const res = await req('GET', `${priceUrl(itemId, variationId)}?outletId=${otherBase.outlet.id}`);
  assert.equal(res.statusCode, 404);
  assert.equal(JSON.parse(res.body).error.code, 'OUTLET_NOT_FOUND');
});

// --- T9: append-only -- ubah harga dua kali, dua baris, baris lama beku ---

test('createPrice: append-only -- ubah harga dua kali menghasilkan dua baris; baris pertama tidak berubah sedikit pun', async () => {
  const { itemId, variationId } = await createVariation(10000);

  const first = await seedPrice(itemId, variationId, { outletId: null, price: 12000, effectiveFrom: undefined });
  const rawBefore = await fetchRawPriceRow(first.id);
  assert.ok(rawBefore, 'baris pertama harus tersimpan di DB sebelum perubahan kedua terjadi');

  const second = await seedPrice(itemId, variationId, { outletId: null, price: 15000, effectiveFrom: undefined });
  assert.notEqual(second.id, first.id, 'perubahan kedua harus jadi baris baru, bukan id yang sama dengan yang pertama');

  const rawAfter = await fetchRawPriceRow(first.id);
  assert.deepEqual(
    rawAfter,
    rawBefore,
    'baris pertama harus byte-identik (seluruh kolom) setelah perubahan kedua -- invariant #2, tidak pernah UPDATE'
  );

  const listRes = await req('GET', pricesUrl(itemId, variationId));
  assert.equal(listRes.statusCode, 200);
  const ids = JSON.parse(listRes.body).items.map((p) => p.id);
  assert.equal(ids.length, 2, 'harus ada tepat dua baris riwayat, bukan satu baris yang di-UPDATE dua kali');
  assert.ok(ids.includes(first.id) && ids.includes(second.id), 'GET .../prices harus menampilkan kedua baris');
});

// --- T10: GET /outlets/{outletId}/prices ---

test('listOutletPrices: harga efektif seluruh variation aktif diselesaikan untuk outlet, satu query', async () => {
  // base.item_variation sudah punya override untuk base.outlet dari
  // seedTenantBase (price 20000) -- dipakai apa adanya sebagai salah satu
  // baris yang diharapkan, tanpa seed tambahan.
  const { variationId: variationNoHistoryId } = await createVariation(9000);
  const { itemId: itemOverrideId, variationId: variationOverrideId } = await createVariation(5000);
  await seedPrice(itemOverrideId, variationOverrideId, { outletId: base.outlet.id, price: 7000 });

  const res = await req('GET', outletPricesUrl(base.outlet.id));
  assert.equal(res.statusCode, 200, res.body);
  const items = JSON.parse(res.body).items;

  const byVariation = new Map(items.map((it) => [it.variationId, it]));
  assert.equal(byVariation.get(base.item_variation.id).price, 20000);
  assert.equal(byVariation.get(base.item_variation.id).source, 'outlet');
  assert.equal(byVariation.get(variationNoHistoryId).price, 9000);
  assert.equal(byVariation.get(variationNoHistoryId).source, 'variation');
  assert.equal(byVariation.get(variationOverrideId).price, 7000);
  assert.equal(byVariation.get(variationOverrideId).source, 'outlet');

  const sortedIds = [...items.map((it) => it.variationId)].sort();
  assert.deepEqual(items.map((it) => it.variationId), sortedIds, 'urutan harus deterministik berdasar id (tie-breaker)');
});

test('listOutletPrices: variation yang sudah diarsipkan tidak muncul', async () => {
  const { itemId, variationId } = await createVariation(4000);
  const archiveRes = await req('POST', `/items/${itemId}/variations/${variationId}/archive`);
  assert.equal(archiveRes.statusCode, 200, archiveRes.body);

  const res = await req('GET', outletPricesUrl(base.outlet.id));
  assert.equal(res.statusCode, 200);
  const ids = JSON.parse(res.body).items.map((it) => it.variationId);
  assert.ok(!ids.includes(variationId), 'variation yang diarsipkan tidak boleh muncul di daftar harga outlet');
});

test('listOutletPrices: outlet milik tenant lain ditolak 404 OUTLET_NOT_FOUND', async () => {
  const otherBase = await seedTenantBase(appSetup, { suffix: 'PriceTestOutletList' });
  const res = await req('GET', outletPricesUrl(otherBase.outlet.id));
  assert.equal(res.statusCode, 404);
  assert.equal(JSON.parse(res.body).error.code, 'OUTLET_NOT_FOUND');
});

// --- Tangga resolusi di listOutletPrices: SALINAN KEDUA, harus diuji sendiri ---
//
// OUTLET_PRICES_SQL memuat tangga FR-A7 untuk kedua kalinya, dalam bentuk
// COALESCE(op, tp, iv) + CASE untuk `source`. Dua implementasi aturan yang
// sama bisa menyimpang tanpa ada yang menyadarinya.
//
// Dibuktikan lewat sabotase (2 Agu 2026): membalik COALESCE jadi
// (tp, op, iv) -- sehingga daftar mengembalikan harga default tenant di
// tempat yang seharusnya override outlet, SAMBIL tetap melaporkan
// source: 'outlet' -- membuat 133 test lolos semua. Tidak ada satu pun kasus
// yang punya override outlet DAN default tenant sekaligus, yaitu satu-satunya
// kombinasi yang membedakan anak tangga 1 dari anak tangga 2.

test('listOutletPrices: override outlet menang atas default tenant untuk variation yang sama', async () => {
  const { itemId, variationId } = await createVariation(5000);
  await seedPrice(itemId, variationId, { outletId: null, price: 12000 });
  await seedPrice(itemId, variationId, { outletId: base.outlet.id, price: 15000 });

  const res = await req('GET', outletPricesUrl(base.outlet.id));
  assert.equal(res.statusCode, 200, res.body);
  const row = JSON.parse(res.body).items.find((it) => it.variationId === variationId);
  assert.equal(row.price, 15000, 'override outlet harus menang atas default tenant');
  assert.equal(row.source, 'outlet');
});

test('listOutletPrices: override outlet terjadwal masa depan tidak dipungut, jatuh ke default tenant', async () => {
  const { itemId, variationId } = await createVariation(5000);
  const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await seedPrice(itemId, variationId, { outletId: null, price: 11000 });
  await seedPrice(itemId, variationId, { outletId: base.outlet.id, price: 99000, effectiveFrom: future });

  const res = await req('GET', outletPricesUrl(base.outlet.id));
  const row = JSON.parse(res.body).items.find((it) => it.variationId === variationId);
  assert.equal(row.price, 11000, 'harga terjadwal yang belum berlaku tidak boleh dipungut');
  assert.equal(row.source, 'tenant');
});

test('listOutletPrices: outlet B tanpa override jatuh ke default tenant, outlet A tidak terpengaruh', async () => {
  const outletB = await insertOutlet('PriceTestB');
  const { itemId, variationId } = await createVariation(5000);
  await seedPrice(itemId, variationId, { outletId: null, price: 13000 });
  await seedPrice(itemId, variationId, { outletId: base.outlet.id, price: 16000 });

  const resA = await req('GET', outletPricesUrl(base.outlet.id));
  const rowA = JSON.parse(resA.body).items.find((it) => it.variationId === variationId);
  assert.equal(rowA.price, 16000);
  assert.equal(rowA.source, 'outlet');

  const resB = await req('GET', outletPricesUrl(outletB.id));
  const rowB = JSON.parse(resB.body).items.find((it) => it.variationId === variationId);
  assert.equal(rowB.price, 13000, 'outlet tanpa override harus jatuh ke default tenant');
  assert.equal(rowB.source, 'tenant');
});

// --- Satu jam, bukan dua ---
//
// Bug nyata, ditemukan 2 Agu 2026 lewat kegagalan intermiten 4 dari 12 run:
//
//   tulis  -> effective_from = now() ....... jam PostgreSQL
//   baca   -> at default     = new Date() .. jam Node
//
// Jeda antara keduanya di test hanya ~2 ms (app.inject in-process, DB lokal),
// sementara skew PG-vs-Node terukur ±2 ms. Ketika PG kebetulan di depan,
// `effective_from > at`, harga yang BARU SAJA ditulis dianggap belum berlaku,
// dan resolusi jatuh ke anak tangga di bawahnya.
//
// Di produksi keduanya mesin terpisah dan skew puluhan milidetik itu normal.
// Akibatnya bukan test yang rewel: merchant menaikkan harga, order berikutnya
// masih memungut harga lama. Untuk POS itu uang yang salah dicetak di struk.
//
// Perbaikannya bukan menambah toleransi, tapi menghapus jam keduanya: `at`
// default diambil dari jam DATABASE, sama dengan yang menstempel
// effective_from. `now()` adalah transaction_timestamp() -- tetap sepanjang
// satu transaksi -- jadi ketiga anak tangga melihat nilai yang sama persis.
//
// Diulang 20x: dengan bug, peluang lolos semua ~0,03%.
test('harga yang baru ditulis langsung terselesaikan -- at default memakai jam database, bukan jam aplikasi', async () => {
  const ITERASI = 20;
  for (let i = 0; i < ITERASI; i++) {
    const { itemId, variationId } = await createVariation(5000);
    await seedPrice(itemId, variationId, { outletId: null, price: 13000 });
    await seedPrice(itemId, variationId, { outletId: base.outlet.id, price: 16000 });

    const res = await req('GET', outletPricesUrl(base.outlet.id));
    const row = JSON.parse(res.body).items.find((it) => it.variationId === variationId);
    assert.equal(
      row.price,
      16000,
      `iterasi ${i}: override outlet yang baru ditulis tidak terlihat (source=${row.source}) -- ` +
      'gejala dua jam berbeda antara penulisan effective_from dan pembacaan at'
    );

    const single = await req('GET', `${priceUrl(itemId, variationId)}?outletId=${base.outlet.id}`);
    assert.equal(JSON.parse(single.body).price, 16000, `iterasi ${i}: jalur resolvePrice juga harus konsisten`);
  }
});

// Pengikat: apa pun isi katalog, listOutletPrices WAJIB setuju dengan
// resolvePrice untuk setiap variation. Ini yang mencegah kedua salinan tangga
// menyimpang di kemudian hari -- test presedensi di atas menutup lubang yang
// SUDAH ada, test ini menutup lubang yang belum dibuat.
test('listOutletPrices konsisten dengan GET .../price untuk setiap variation', async () => {
  const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const past = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const a = await createVariation(5000); // tanpa riwayat -> anak tangga 3
  const b = await createVariation(5000); // default tenant saja -> anak tangga 2
  await seedPrice(b.itemId, b.variationId, { outletId: null, price: 8000, effectiveFrom: past });
  const c = await createVariation(5000); // keduanya -> anak tangga 1
  await seedPrice(c.itemId, c.variationId, { outletId: null, price: 8000, effectiveFrom: past });
  await seedPrice(c.itemId, c.variationId, { outletId: base.outlet.id, price: 9500, effectiveFrom: past });
  const d = await createVariation(5000); // override terjadwal -> anak tangga 2 untuk sekarang
  await seedPrice(d.itemId, d.variationId, { outletId: null, price: 8800, effectiveFrom: past });
  await seedPrice(d.itemId, d.variationId, { outletId: base.outlet.id, price: 99000, effectiveFrom: future });

  const at = new Date().toISOString();
  const listRes = await req('GET', `${outletPricesUrl(base.outlet.id)}?at=${encodeURIComponent(at)}`);
  assert.equal(listRes.statusCode, 200, listRes.body);
  const items = JSON.parse(listRes.body).items;

  const cases = [a, b, c, d];
  let checked = 0;
  for (const { itemId, variationId } of cases) {
    const single = await req(
      'GET',
      `${priceUrl(itemId, variationId)}?outletId=${base.outlet.id}&at=${encodeURIComponent(at)}`
    );
    assert.equal(single.statusCode, 200, single.body);
    const expected = JSON.parse(single.body);
    const fromList = items.find((it) => it.variationId === variationId);
    assert.ok(fromList, `variation ${variationId} hilang dari listOutletPrices`);
    assert.equal(fromList.price, expected.price, `harga tidak konsisten untuk ${variationId}`);
    assert.equal(fromList.source, expected.source, `source tidak konsisten untuk ${variationId}`);
    checked += 1;
  }
  // Loop yang tidak pernah berjalan adalah test yang tidak menguji apa pun --
  // pelajaran dari property test T6 di sub-project 1.
  assert.equal(checked, 4, 'keempat kasus tangga harus benar-benar diperiksa');
});
