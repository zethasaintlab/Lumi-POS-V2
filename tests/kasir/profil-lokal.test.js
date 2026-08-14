'use strict';

// FR-E4 / OQ-09 — resolusi VerticalProfile dari data LOKAL, di atas SQLite
// sungguhan. Aritmetikanya milik `packages/domain`; yang diuji di sini adalah
// pembacaannya, termasuk `boolean` PostgreSQL yang mendarat sebagai INTEGER.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const MOD = '../../apps/kasir/src/inventori/profil.ts';
const SKEMA = join(__dirname, '..', '..', 'db', 'local', '001-initial.sql');

const TENANT = 't1';
const OUTLET = 'o1';

function dbSungguhan() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(SKEMA, 'utf8'));
  return {
    sqlite,
    async getAll(sql, params = []) {
      return sqlite.prepare(sql).all(...params);
    },
    async execute(sql, params = []) {
      sqlite.prepare(sql).run(...params);
      return { rowsAffected: 1 };
    },
    async transaction(fn) {
      return fn(this);
    },
  };
}

function outlet(db, { profilId = null } = {}) {
  db.sqlite.exec(`
    INSERT INTO outlet (id, tenant_id, name, timezone, business_day_ends_at, vertical_profile_id)
    VALUES ('${OUTLET}','${TENANT}','Cabang Dago','Asia/Jakarta','04:00',
            ${profilId ? `'${profilId}'` : 'NULL'})
  `);
}

function profil(db, { id, allowNegative, isDefault }) {
  db.sqlite.exec(`
    INSERT INTO vertical_profile (id, tenant_id, name, allow_negative_stock, is_tenant_default)
    VALUES ('${id}','${TENANT}','fnb',${allowNegative ? 1 : 0},${isDefault ? 1 : 0})
  `);
}

test('profil OUTLET menang atas default tenant', async () => {
  const { bacaProfilVertikal } = await import(MOD);
  const db = dbSungguhan();
  outlet(db, { profilId: 'p-outlet' });
  profil(db, { id: 'p-outlet', allowNegative: false, isDefault: false });
  profil(db, { id: 'p-tenant', allowNegative: true, isDefault: true });

  const p = await bacaProfilVertikal(db, { tenantId: TENANT, outletId: OUTLET });
  assert.equal(p.id, 'p-outlet');
  assert.equal(p.allowNegativeStock, false);
  assert.equal(p.dariBawaan, false);
});

test('outlet tanpa profil sendiri mewarisi default tenant', async () => {
  const { bacaProfilVertikal } = await import(MOD);
  const db = dbSungguhan();
  outlet(db);
  profil(db, { id: 'p-tenant', allowNegative: false, isDefault: true });

  const p = await bacaProfilVertikal(db, { tenantId: TENANT, outletId: OUTLET });
  assert.equal(p.id, 'p-tenant');
  assert.equal(p.allowNegativeStock, false);
});

test('⛔ perangkat yang profilnya belum turun tetap dapat menjual', async () => {
  // Katalog dan profil turun lewat stream yang sama tapi tidak harus tiba
  // bersamaan. Perangkat yang profilnya belum ada tidak boleh kehilangan
  // kemampuan menjual — ia jatuh ke bawaan, dan menyatakannya.
  const { bacaProfilVertikal } = await import(MOD);
  const db = dbSungguhan();
  outlet(db);

  const p = await bacaProfilVertikal(db, { tenantId: TENANT, outletId: OUTLET });
  assert.equal(p.allowNegativeStock, true);
  assert.equal(p.dariBawaan, true);
});

test('⛔ INTEGER 0 terbaca sebagai false, bukan truthy', async () => {
  // `boolean` PostgreSQL mendarat sebagai INTEGER lokal. Kalau dibaca lewat
  // truthiness, nilai dari driver yang mengembalikan string ('0') akan
  // terbaca `true` — dan blokir stok diam-diam mati.
  const { bacaProfilVertikal } = await import(MOD);
  const db = dbSungguhan();
  outlet(db, { profilId: 'p1' });
  profil(db, { id: 'p1', allowNegative: false, isDefault: false });

  const p = await bacaProfilVertikal(db, { tenantId: TENANT, outletId: OUTLET });
  assert.equal(p.allowNegativeStock, false);
  assert.equal(typeof p.allowNegativeStock, 'boolean');
});

test('profil tenant LAIN tidak ikut terbaca', async () => {
  const { bacaProfilVertikal } = await import(MOD);
  const db = dbSungguhan();
  outlet(db);
  db.sqlite.exec(`
    INSERT INTO vertical_profile (id, tenant_id, name, allow_negative_stock, is_tenant_default)
    VALUES ('p-lain','tenant-lain','fnb',0,1)
  `);

  const p = await bacaProfilVertikal(db, { tenantId: TENANT, outletId: OUTLET });
  assert.equal(p.dariBawaan, true, 'profil tenant lain dipakai sebagai default');
  assert.equal(p.allowNegativeStock, true);
});
