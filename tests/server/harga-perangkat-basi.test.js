'use strict';

// FR-A7 AC keempat — "Dashboard menampilkan device mana yang belum menerima
// perubahan harga terakhir."
//
// ⛔ Yang paling penting diuji: arahnya SATU ARAH. `last_seen_at` adalah
// PROKSI, bukan bukti — checkpoint PowerSync hidup di perangkat dan server
// tidak dapat membacanya. Laporan yang mengaku tahu apa yang sudah mendarat
// akan membuat merchant menyimpulkan lebih dari yang datanya dukung.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');

let owner, db, app, base, tenant, outletId, variationId;

before(async () => {
  owner = await connectAsOwner();
  db = await connectAsApp();
});

after(async () => {
  await resetAll(owner);
  await owner.end();
  await db.end();
  if (app) await app.close();
});

const hdr = (ubah = {}) => ({
  'x-tenant-id': tenant.id,
  authorization: base.authHeader,
  'x-actor-id': base.user.id,
  'content-type': 'application/json',
  ...ubah,
});

beforeEach(async () => {
  await db.query('ROLLBACK').catch(() => {});
  await resetAll(owner);
  base = await seedTenantBase(db, { suffix: 'HargaBasi' });
  tenant = base.tenant;
  outletId = base.outlet.id;

  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();

  variationId = crypto.randomUUID();
  const res = await app.inject({
    method: 'POST',
    url: '/items',
    headers: { ...hdr(), 'idempotency-key': crypto.randomUUID() },
    payload: {
      id: crypto.randomUUID(),
      name: 'Kopi Susu',
      variations: [{ id: variationId, name: 'Regular', price: 25000 }],
    },
  });
  assert.equal(res.statusCode, 201, res.body);

  // ⛔ `POST /items` menulis baris `price_history` AWAL — harga pertama adalah
  // perubahan harga pertama. Itu benar dan bukan kejutan yang perlu
  // disembunyikan, tapi ia membuat setiap perangkat yang lama tidak terlihat
  // otomatis tertinggal olehnya. Ditua-kan ke masa lalu supaya test dapat
  // mengendalikan sendiri perubahan mana yang tertinggal.
  await kueri(`UPDATE price_history SET effective_from = now() - interval '30 days'`);
});

async function kueri(sql, params) {
  await db.query('BEGIN');
  await db.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  try {
    const { rows } = await db.query(sql, params);
    await db.query('COMMIT');
    return rows;
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  }
}

let n = 0;
/** Perangkat, dengan `last_seen_at` yang dapat diatur. */
async function perangkat({ terlihatJamLalu = null, outlet = null } = {}) {
  n += 1;
  const id = crypto.randomUUID();
  await kueri(
    `INSERT INTO device (id, tenant_id, outlet_id, code, name, platform, app_version, schema_version)
     VALUES ($1,$2,$3,$4,$4,'tauri','0','1')`,
    [id, tenant.id, outlet ?? outletId, `K${n}`]
  );
  if (terlihatJamLalu !== null) {
    await kueri(
      `UPDATE device SET last_seen_at = now() - ($1 || ' hours')::interval WHERE id = $2`,
      [String(terlihatJamLalu), id]
    );
  }
  return id;
}

/** Perubahan harga, `jamLalu` jam yang lalu. `jamLalu` negatif = masa depan. */
async function ubahHarga({ jamLalu = 1, harga = 28000, outlet = undefined } = {}) {
  const id = crypto.randomUUID();
  await kueri(
    `INSERT INTO price_history (id, tenant_id, variation_id, outlet_id, price, effective_from, changed_by)
     VALUES ($1,$2,$3,$4,$5, now() - ($6 || ' hours')::interval, $7)`,
    [
      id,
      tenant.id,
      variationId,
      outlet === undefined ? null : outlet,
      harga,
      String(jamLalu),
      base.user.id,
    ]
  );
  return id;
}

const laporan = (q = '', ubah = {}) =>
  app.inject({ method: 'GET', url: `/reports/stale-price-devices${q}`, headers: hdr(ubah) });

// ---------------------------------------------------------------------------

test('perangkat yang belum terlihat SEJAK perubahan harga muncul di daftar', async () => {
  const basi = await perangkat({ terlihatJamLalu: 10 });
  await perangkat({ terlihatJamLalu: 0 });
  await ubahHarga({ jamLalu: 5 });

  const res = await laporan();
  assert.equal(res.statusCode, 200, res.body);
  const b = res.json();
  assert.equal(b.perangkat.length, 1, JSON.stringify(b.perangkat));
  assert.equal(b.perangkat[0].deviceId, basi);
  assert.equal(b.perangkat[0].perubahanTertinggal, 1);
});

test('⛔ perangkat yang BELUM PERNAH terlihat ikut, dan tertinggal SELURUHNYA', async () => {
  // Ia justru yang paling penting: perangkat yang baru didaftarkan dan tidak
  // pernah menyala tidak akan pernah memakai harga apa pun yang benar.
  const baru = await perangkat({ terlihatJamLalu: null });
  await ubahHarga({ jamLalu: 5 });
  await ubahHarga({ jamLalu: 3, harga: 30000 });

  const b = (await laporan()).json();
  const row = b.perangkat.find((p) => p.deviceId === baru);
  assert.ok(row, 'perangkat yang belum pernah terlihat hilang dari daftar');
  assert.equal(row.lastSeenAt, null);
  // ⛔ TIGA, bukan dua: harga AWAL item juga baris `price_history`, dan
  // perangkat yang belum pernah menyala tertinggal olehnya juga. Itu tepat
  // yang dimaksud "tertinggal seluruhnya" — ia tidak pernah memakai harga apa
  // pun yang benar.
  assert.equal(row.perubahanTertinggal, 3);
});

test('⛔ harga masa DEPAN tidak dihitung tertinggal', async () => {
  // Harga terjadwal memang belum berlaku untuk siapa pun, dan perangkat yang
  // belum menerimanya belum kehilangan apa pun. Menghitungnya membuat setiap
  // penjadwalan harga menandai SELURUH armada sebagai basi.
  await perangkat({ terlihatJamLalu: 1 });
  await ubahHarga({ jamLalu: -24, harga: 35000 });

  const b = (await laporan()).json();
  assert.deepEqual(b.perangkat, []);
});

test('⛔ jumlahDiperiksa ikut — daftar kosong dari NOL perangkat berarti lain', async () => {
  // Daftar kosong dari nol perangkat dan dari sepuluh perangkat terlihat sama
  // persis, dan berarti hal yang sangat berbeda.
  const kosong = (await laporan()).json();
  assert.equal(kosong.jumlahDiperiksa, 0);
  assert.deepEqual(kosong.perangkat, []);

  await perangkat({ terlihatJamLalu: 0 });
  await perangkat({ terlihatJamLalu: 0 });
  const adaTapiSemuaSegar = (await laporan()).json();
  assert.equal(adaTapiSemuaSegar.jumlahDiperiksa, 2);
  assert.deepEqual(adaTapiSemuaSegar.perangkat, []);
});

test('perangkat yang DICABUT tidak ikut', async () => {
  const dicabut = await perangkat({ terlihatJamLalu: 10 });
  await kueri('UPDATE device SET revoked_at = now() WHERE id = $1', [dicabut]);
  await ubahHarga({ jamLalu: 5 });

  const b = (await laporan()).json();
  assert.deepEqual(b.perangkat, []);
  assert.equal(b.jumlahDiperiksa, 0, 'perangkat dicabut tidak ikut dihitung juga');
});

test('⛔ harga milik outlet LAIN tidak menandai perangkat outlet ini', async () => {
  // Tangga tiga tingkat: harga ber-outlet_id menyentuh outlet itu saja.
  // Menandai seluruh armada untuk perubahan yang tidak berlaku baginya membuat
  // laporan ini berhenti dipercaya.
  const outletLain = crypto.randomUUID();
  await kueri(
    `INSERT INTO outlet (id, tenant_id, name, timezone, business_day_ends_at)
     VALUES ($1,$2,'Cabang Dua','Asia/Jakarta','04:00')`,
    [outletLain, tenant.id]
  );
  await perangkat({ terlihatJamLalu: 10 });
  await ubahHarga({ jamLalu: 5, outlet: outletLain });

  const b = (await laporan()).json();
  assert.deepEqual(b.perangkat, [], 'harga outlet lain tidak boleh menandai perangkat ini');
});

test('harga ber-outlet_id NULL menandai SELURUH perangkat yang tertinggal', async () => {
  await perangkat({ terlihatJamLalu: 10 });
  await perangkat({ terlihatJamLalu: 20 });
  await ubahHarga({ jamLalu: 5 });

  const b = (await laporan()).json();
  assert.equal(b.perangkat.length, 2);
  // ⛔ Terurut dari yang PALING LAMA tidak terlihat. Yang paling lama basi
  // adalah yang paling lama menjual dengan harga yang salah.
  assert.ok(
    new Date(b.perangkat[0].lastSeenAt) < new Date(b.perangkat[1].lastSeenAt),
    'urutannya harus dari yang paling lama tidak terlihat'
  );
});

test('saringan outlet menyempitkan daftar', async () => {
  const outletLain = crypto.randomUUID();
  await kueri(
    `INSERT INTO outlet (id, tenant_id, name, timezone, business_day_ends_at)
     VALUES ($1,$2,'Cabang Dua','Asia/Jakarta','04:00')`,
    [outletLain, tenant.id]
  );
  await perangkat({ terlihatJamLalu: 10 });
  await perangkat({ terlihatJamLalu: 10, outlet: outletLain });
  await ubahHarga({ jamLalu: 5 });

  assert.equal((await laporan()).json().perangkat.length, 2);
  const disaring = (await laporan(`?outlet_id=${outletId}`)).json();
  assert.equal(disaring.perangkat.length, 1);
  assert.equal(disaring.outletId, outletId);
});

test('perubahanTerakhir menyebut perubahan TERBARU, bukan yang pertama', async () => {
  await perangkat({ terlihatJamLalu: 10 });
  await ubahHarga({ jamLalu: 5 });
  await ubahHarga({ jamLalu: 1, harga: 30000 });

  const b = (await laporan()).json();
  const terakhir = new Date(b.perubahanTerakhir).getTime();
  const sekarang = Date.now();
  // Perubahan terbaru berumur ~1 jam, bukan ~5 jam maupun 30 hari.
  assert.ok(sekarang - terakhir < 2 * 3600_000, `perubahanTerakhir: ${b.perubahanTerakhir}`);
});

test('⛔ kasir dan akuntan DITOLAK — RBAC price_edit', async () => {
  await perangkat({ terlihatJamLalu: 10 });
  await ubahHarga({ jamLalu: 5 });

  for (const peran of ['cashier', 'accountant', 'outlet_manager']) {
    await kueri('DELETE FROM user_role WHERE user_id = $1', [base.user.id]);
    const tenantWide = peran === 'accountant';
    await kueri(
      `INSERT INTO user_role (id, tenant_id, user_id, role, scope_type, scope_id)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        crypto.randomUUID(),
        tenant.id,
        base.user.id,
        peran,
        tenantWide ? 'tenant' : 'outlet',
        tenantWide ? tenant.id : outletId,
      ]
    );
    const res = await laporan();
    assert.equal(res.statusCode, 403, `${peran}: ${res.body}`);
  }
});

test('outlet milik tenant lain dijawab 404', async () => {
  const lain = await seedTenantBase(db, { suffix: 'HargaBasiLain' });
  const res = await laporan(`?outlet_id=${lain.outlet.id}`);
  assert.equal(res.statusCode, 404, res.body);
});
