'use strict';

// OQ-09 terjawab (1 Agu 2026): VerticalProfile hidup di level OUTLET, mewarisi
// default dari TENANT. Skema F0 sudah menyiapkan separuhnya --
// `outlet.vertical_profile_id` (nullable) dan `vertical_profile.allow_negative_stock`
// sudah ada sejak 0002_tenancy.sql, dengan komentar yang mencatatnya sebagai asumsi.
//
// Yang TIDAK bisa dinyatakan skema lama: profil mana milik tenant yang menjadi
// default. `vertical_profile.tenant_id` mengizinkan satu tenant punya banyak profil,
// dan `outlet.vertical_profile_id` boleh NULL -- tapi tidak ada apa pun yang
// menyatakan ke profil mana outlet ber-NULL itu jatuh kembali. Aturan pewarisan
// "pusat menetapkan standar, cabang boleh override" karena itu tidak dapat
// ditegakkan, hanya bisa disepakati lewat konvensi.
//
// 0015 menutupnya dengan `is_tenant_default` + partial unique index per tenant,
// sehingga "tepat satu default per tenant" ditegakkan database, bukan aplikasi.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');

let owner, app;

before(async () => {
  owner = await connectAsOwner();
  app = await connectAsApp();
});

after(async () => {
  await resetAll(owner);
  await owner.end();
  await app.end();
});

beforeEach(async () => {
  await resetAll(owner);
});

async function asTenant(tenantId, fn) {
  await app.query('BEGIN');
  await app.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
  try {
    const result = await fn();
    await app.query('COMMIT');
    return result;
  } catch (err) {
    await app.query('ROLLBACK');
    throw err;
  }
}

function profileValues(tenantId, isDefault) {
  return [
    crypto.randomUUID(),
    tenantId,
    'fnb',
    JSON.stringify([]),
    'takeaway',
    true,
    false,
    'pbjt',
    isDefault,
  ];
}

const INSERT_PROFILE = `
  INSERT INTO vertical_profile
    (id, tenant_id, name, modules_enabled, default_channel,
     allow_negative_stock, requires_barcode_flow, default_tax_type, is_tenant_default)
  VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9)
  RETURNING *`;

test('kolom is_tenant_default ada, boolean NOT NULL, default false', async () => {
  const { rows } = await owner.query(
    `SELECT data_type, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_name = 'vertical_profile' AND column_name = 'is_tenant_default'`
  );
  assert.equal(rows.length, 1, 'kolom is_tenant_default harus ada di vertical_profile');
  assert.equal(rows[0].data_type, 'boolean');
  assert.equal(rows[0].is_nullable, 'NO');
  assert.match(rows[0].column_default, /false/);
});

// FR-E4: "stok boleh negatif" adalah setting per profil vertikal, bukan asumsi
// yang di-hardcode. Kolomnya sudah ada sejak F0; test ini mengunci keberadaannya
// supaya migrasi berikutnya tidak menghapusnya tanpa sengaja.
test('FR-E4: allow_negative_stock ada di profil, default true (default F&B per spec-e)', async () => {
  const { rows } = await owner.query(
    `SELECT data_type, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_name = 'vertical_profile' AND column_name = 'allow_negative_stock'`
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].data_type, 'boolean');
  assert.equal(rows[0].is_nullable, 'NO');
  assert.match(rows[0].column_default, /true/);
});

test('satu tenant tidak boleh punya dua profil default sekaligus', async () => {
  const base = await seedTenantBase(app, { suffix: 'VPDefaultA' });
  const tenantId = base.tenant.id;

  await asTenant(tenantId, () => app.query(INSERT_PROFILE, profileValues(tenantId, true)));

  await assert.rejects(
    asTenant(tenantId, () => app.query(INSERT_PROFILE, profileValues(tenantId, true))),
    (err) => err.code === '23505',
    'profil default kedua untuk tenant yang sama harus ditolak unique index'
  );
});

test('profil non-default boleh banyak dalam satu tenant (yang dibatasi hanya yang default)', async () => {
  const base = await seedTenantBase(app, { suffix: 'VPNonDefault' });
  const tenantId = base.tenant.id;

  await asTenant(tenantId, async () => {
    await app.query(INSERT_PROFILE, profileValues(tenantId, false));
    await app.query(INSERT_PROFILE, profileValues(tenantId, false));
  });

  const { rows } = await asTenant(tenantId, () =>
    app.query('SELECT count(*)::int AS n FROM vertical_profile WHERE is_tenant_default = false')
  );
  assert.ok(rows[0].n >= 2, 'beberapa profil non-default dalam satu tenant harus diizinkan');
});

// Sengaja diperiksa dari konteks masing-masing tenant, BUKAN sebagai owner:
// `FORCE ROW LEVEL SECURITY` berlaku juga untuk owner tabel (invariant #8), jadi
// SELECT tanpa app.tenant_id gagal 42704 -- itu perilaku yang benar, dan
// memeriksa lewat owner justru akan melewati jalur yang dipakai aplikasi.
// Bentuk ini sekalian membuktikan default satu tenant tidak terlihat tenant lain.
test('dua tenant boleh punya default masing-masing -- batasnya per tenant, bukan global', async () => {
  const a = await seedTenantBase(app, { suffix: 'VPTenantA' });
  const b = await seedTenantBase(app, { suffix: 'VPTenantB' });

  const { rows: defA } = await asTenant(a.tenant.id, () =>
    app.query(INSERT_PROFILE, profileValues(a.tenant.id, true))
  );
  const { rows: defB } = await asTenant(b.tenant.id, () =>
    app.query(INSERT_PROFILE, profileValues(b.tenant.id, true))
  );
  assert.notEqual(defA[0].id, defB[0].id);

  for (const [tenantId, expectedId] of [
    [a.tenant.id, defA[0].id],
    [b.tenant.id, defB[0].id],
  ]) {
    const { rows } = await asTenant(tenantId, () =>
      app.query('SELECT id FROM vertical_profile WHERE is_tenant_default')
    );
    assert.equal(rows.length, 1, 'setiap tenant melihat tepat satu profil default');
    assert.equal(rows[0].id, expectedId, 'dan itu miliknya sendiri, bukan milik tenant lain');
  }
});

// Inti OQ-09: pewarisan harus bisa dinyatakan sebagai query, bukan konvensi.
// Outlet yang menunjuk profilnya sendiri = override; outlet ber-NULL = warisi
// default tenant. Satu COALESCE, tanpa cabang di kode aplikasi.
test('pewarisan: outlet tanpa profil sendiri jatuh ke default tenant, yang punya tetap menang', async () => {
  const base = await seedTenantBase(app, { suffix: 'VPInherit' });
  const tenantId = base.tenant.id;

  const resolved = await asTenant(tenantId, async () => {
    const { rows: def } = await app.query(INSERT_PROFILE, profileValues(tenantId, true));
    const { rows: own } = await app.query(INSERT_PROFILE, [
      ...profileValues(tenantId, false).slice(0, 5),
      false, // allow_negative_stock DIOVERRIDE jadi false di cabang ini
      false,
      'pbjt',
      false,
    ]);

    // outlet dari seedTenantBase menunjuk profilnya sendiri -> override menang
    await app.query('UPDATE outlet SET vertical_profile_id = $1 WHERE id = $2', [
      own[0].id,
      base.outlet.id,
    ]);

    const outletMewarisi = crypto.randomUUID();
    await app.query(
      `INSERT INTO outlet (id, tenant_id, name, timezone, vertical_profile_id)
       VALUES ($1, $2, 'Cabang Mewarisi', 'Asia/Jakarta', NULL)`,
      [outletMewarisi, tenantId]
    );

    const { rows } = await app.query(
      `SELECT o.id,
              COALESCE(vp_own.allow_negative_stock, vp_def.allow_negative_stock) AS allow_negative_stock
         FROM outlet o
         LEFT JOIN vertical_profile vp_own ON vp_own.id = o.vertical_profile_id
         LEFT JOIN vertical_profile vp_def
                ON vp_def.tenant_id = o.tenant_id AND vp_def.is_tenant_default
        WHERE o.id = ANY($1)`,
      [[base.outlet.id, outletMewarisi]]
    );
    return new Map(rows.map((r) => [r.id, r.allow_negative_stock]));
  });

  assert.equal(resolved.get(base.outlet.id), false, 'outlet dengan profil sendiri harus memakai nilainya sendiri');
  assert.equal(resolved.get(defaultOutletKey(resolved, base.outlet.id)), true, 'outlet tanpa profil harus mewarisi default tenant');
});

function defaultOutletKey(resolved, ownOutletId) {
  for (const key of resolved.keys()) {
    if (key !== ownOutletId) return key;
  }
  throw new Error('outlet pewaris tidak ditemukan di hasil query');
}
