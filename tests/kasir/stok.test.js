'use strict';

// FR-E1 / E.4 — pembacaan stok di perangkat, di atas SQLite SUNGGUHAN.
//
// Alasannya sama seperti `tutup-kas-refund.test.js`: fake tidak menegakkan
// constraint, tidak menegakkan `ORDER BY`, dan `WITHOUT ROWID` + primary key
// komposit `stock_snapshot` adalah persis bentuk yang fake tidak akan pernah
// tolak. Yang diuji di sini adalah aritmetika snapshot + delta, dan ia hanya
// berarti bila barisnya benar-benar tersimpan.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const MOD = '../../apps/kasir/src/inventori/stok.ts';
const SKEMA = join(__dirname, '..', '..', 'db', 'local', '001-initial.sql');

const TENANT = 't1';
const OUTLET = 'o1';
const DEVICE = 'd1';

function dbSungguhan() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(SKEMA, 'utf8'));
  const db = {
    sqlite,
    async getAll(sql, params = []) {
      return sqlite.prepare(sql).all(...params);
    },
    async execute(sql, params = []) {
      sqlite.prepare(sql).run(...params);
      return { rowsAffected: 1 };
    },
    async transaction(fn) {
      return fn(db);
    },
  };
  return db;
}

let n = 0;
function gerak(db, { variationId, delta, hlc, type = 'sale' }) {
  n += 1;
  db.sqlite.exec(`
    INSERT INTO stock_movement
      (id, tenant_id, outlet_id, device_id, variation_id, type, delta, created_by, occurred_at, hlc)
    VALUES ('mv-${n}','${TENANT}','${OUTLET}','${DEVICE}','${variationId}','${type}',${delta},
            'u-sari','2026-08-13T10:00:00Z',${hlc})
  `);
}

function snapshot(db, { variationId, balance, checkpointHlc }) {
  db.sqlite.exec(`
    INSERT INTO stock_snapshot (tenant_id, outlet_id, variation_id, balance, checkpoint_hlc)
    VALUES ('${TENANT}','${OUTLET}','${variationId}',${balance},${checkpointHlc})
  `);
}

const KONFIG = { tenantId: TENANT, outletId: OUTLET, deviceId: DEVICE };

// ---------------------------------------------------------------------------

test('tanpa snapshot: stok = SUM(delta) (invariant Modul E nomor 1)', async () => {
  const { bacaStok } = await import(MOD);
  const db = dbSungguhan();
  gerak(db, { variationId: 'v1', delta: 10000, hlc: 1, type: 'receipt' });
  gerak(db, { variationId: 'v1', delta: -3000, hlc: 2 });

  assert.equal(await bacaStok(db, KONFIG, 'v1'), 7000);
});

test('⛔ dengan snapshot: hanya delta SETELAH checkpoint yang ditambahkan', async () => {
  // `spec-e:62`: `snapshot.balance + COALESCE(SUM(delta) WHERE hlc >
  // checkpoint_hlc, 0)`. Menjumlahkan seluruh movement DI ATAS snapshot
  // menghitung dua kali setiap pergerakan yang sudah masuk ke dalamnya —
  // dan itu tidak menghasilkan error, hanya angka yang salah.
  const { bacaStok } = await import(MOD);
  const db = dbSungguhan();
  gerak(db, { variationId: 'v1', delta: 10000, hlc: 1, type: 'receipt' });
  gerak(db, { variationId: 'v1', delta: -3000, hlc: 2 });
  snapshot(db, { variationId: 'v1', balance: 7000, checkpointHlc: 2 });
  gerak(db, { variationId: 'v1', delta: -2000, hlc: 3 });

  assert.equal(await bacaStok(db, KONFIG, 'v1'), 5000);
});

test('⛔ snapshot dan agregasi langsung menghasilkan angka IDENTIK (spec-e:331)', async () => {
  // Uji drift yang `spec-e:331` sebut wajib. Snapshot adalah cache; cache
  // yang menyimpang dari sumbernya lebih buruk daripada tidak ada cache.
  const { bacaStok, bacaStokLangsung } = await import(MOD);
  const db = dbSungguhan();

  let acak = 424242;
  const berikut = () => {
    acak = (acak * 1103515245 + 12345) % 2147483648;
    return acak;
  };

  let saldo = 0;
  for (let i = 1; i <= 40; i += 1) {
    const d = (berikut() % 5000) - 2500;
    if (d === 0) continue;
    gerak(db, { variationId: 'v1', delta: d, hlc: i, type: d > 0 ? 'receipt' : 'sale' });
    saldo += d;
    // Snapshot dibangun ulang di titik acak, seperti tutup shift.
    if (berikut() % 7 === 0) {
      db.sqlite.exec(`DELETE FROM stock_snapshot WHERE variation_id = 'v1'`);
      snapshot(db, { variationId: 'v1', balance: saldo, checkpointHlc: i });
    }
    assert.equal(
      await bacaStok(db, KONFIG, 'v1'),
      await bacaStokLangsung(db, KONFIG, 'v1'),
      `snapshot menyimpang dari agregasi langsung di iterasi ${i}`
    );
  }
});

test('variation tanpa satu pun movement: nol, bukan null', async () => {
  const { bacaStok } = await import(MOD);
  const db = dbSungguhan();
  assert.equal(await bacaStok(db, KONFIG, 'belum-pernah'), 0);
});

test('⛔ stok terisolasi per OUTLET', async () => {
  // Perangkat hanya mereplikasi movement outletnya, tapi agregasinya tetap
  // harus menyaring — perangkat yang pernah berpindah outlet menyimpan
  // movement lama, dan menjumlahkannya membuat stok cabang lain bocor ke
  // angka cabang ini.
  const { bacaStok } = await import(MOD);
  const db = dbSungguhan();
  gerak(db, { variationId: 'v1', delta: 5000, hlc: 1, type: 'receipt' });
  db.sqlite.exec(`
    INSERT INTO stock_movement
      (id, tenant_id, outlet_id, device_id, variation_id, type, delta, created_by, occurred_at, hlc)
    VALUES ('mv-lain','${TENANT}','outlet-lain','${DEVICE}','v1','receipt',99000,
            'u-sari','2026-08-13T10:00:00Z',2)
  `);

  assert.equal(await bacaStok(db, KONFIG, 'v1'), 5000);
});

test('stok banyak variation sekaligus, untuk grid kasir', async () => {
  const { bacaStokBanyak } = await import(MOD);
  const db = dbSungguhan();
  gerak(db, { variationId: 'v1', delta: 5000, hlc: 1, type: 'receipt' });
  gerak(db, { variationId: 'v2', delta: 2000, hlc: 2, type: 'receipt' });
  gerak(db, { variationId: 'v2', delta: -500, hlc: 3 });
  snapshot(db, { variationId: 'v1', balance: 5000, checkpointHlc: 1 });

  const peta = await bacaStokBanyak(db, KONFIG, ['v1', 'v2', 'v3']);
  assert.equal(peta.get('v1'), 5000);
  assert.equal(peta.get('v2'), 1500);
  assert.equal(peta.get('v3'), 0, 'variation tanpa movement harus tetap punya entri');
});

test('⛔ rebuild snapshot menghasilkan angka yang sama, dan checkpoint naik', async () => {
  // `spec-e:63`: rebuild saat tutup shift. Yang berbahaya bukan rebuildnya,
  // melainkan checkpoint yang tidak ikut naik — delta lama akan dijumlahkan
  // lagi di atas saldo yang sudah memuatnya.
  const { bacaStok, bangunUlangSnapshot } = await import(MOD);
  const db = dbSungguhan();
  gerak(db, { variationId: 'v1', delta: 10000, hlc: 1, type: 'receipt' });
  gerak(db, { variationId: 'v1', delta: -4000, hlc: 5 });

  const sebelum = await bacaStok(db, KONFIG, 'v1');
  await bangunUlangSnapshot(db, KONFIG);
  const sesudah = await bacaStok(db, KONFIG, 'v1');

  assert.equal(sesudah, sebelum, 'rebuild mengubah angka stok');
  const baris = db.sqlite
    .prepare(`SELECT balance, checkpoint_hlc FROM stock_snapshot WHERE variation_id = 'v1'`)
    .all();
  assert.equal(baris.length, 1);
  assert.equal(Number(baris[0].balance), 6000);
  assert.equal(Number(baris[0].checkpoint_hlc), 5, 'checkpoint tidak naik ke hlc tertinggi');
});

test('⛔ rebuild yang dijalankan DUA KALI tidak menggandakan apa pun', async () => {
  const { bacaStok, bangunUlangSnapshot } = await import(MOD);
  const db = dbSungguhan();
  gerak(db, { variationId: 'v1', delta: 8000, hlc: 1, type: 'receipt' });

  await bangunUlangSnapshot(db, KONFIG);
  await bangunUlangSnapshot(db, KONFIG);
  assert.equal(await bacaStok(db, KONFIG, 'v1'), 8000);
});
