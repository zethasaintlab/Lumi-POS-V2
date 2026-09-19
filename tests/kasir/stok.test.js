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

// ---------------------------------------------------------------------------
// Snapshot yang kehilangan dasarnya di ledger
//
// ⛔ Uji drift di atas TIDAK DAPAT menangkap kelas ini, dan itu bukan kelalaian
// melainkan bentuknya: ia menambah movement lalu membandingkan kedua jalur, jadi
// ia tidak pernah MENGOSONGKAN ledger sambil menyisakan snapshot. Justru itu
// keadaan yang terjadi saat raw table dibangun ulang — `stock_movement` raw dan
// terbuang, `stock_snapshot` murni lokal dan bertahan.
//
// Yang dijaga dinyatakan sebagai INVARIANT, bukan sebagai angka yang ditulis
// tangan: sesudah rebuild, tidak boleh ada baris `stock_snapshot` yang tidak
// punya satu pun movement pendukung di scope yang sama. Ekspektasi berupa angka
// akan tetap hijau untuk snapshot yatim yang kebetulan bernilai benar.

function snapshotYatim(db, { tenantId, outletId }) {
  return db.sqlite
    .prepare(
      `SELECT s.variation_id, s.balance FROM stock_snapshot s
        WHERE s.tenant_id = ? AND s.outlet_id = ?
          AND NOT EXISTS (
            SELECT 1 FROM stock_movement m
             WHERE m.tenant_id = s.tenant_id
               AND m.outlet_id = s.outlet_id
               AND m.variation_id = s.variation_id
          )`
    )
    .all(tenantId, outletId);
}

// ⛔ DUA baris tetangga, bukan satu, dan keduanya perlu.
//
// Penghapusan ber-scope punya DUA predikat, jadi ia dapat melebar ke dua arah
// yang berbeda — dan satu baris tetangga hanya melihat salah satunya. Terukur:
// dengan hanya baris outlet-lain (tenant SAMA), melepas predikat `tenant_id`
// sendirian membuat SELURUH test hijau. Penjaganya hampa untuk arah itu sampai
// baris tenant-lain ditambahkan.
//
// Keduanya sengaja berbagi satu koordinat dengan scope yang diuji: yang pertama
// tenant sama / outlet beda, yang kedua outlet sama / tenant beda. Baris yang
// berbeda di KEDUA koordinat tidak membuktikan apa pun — ia selamat dari
// pelebaran satu predikat mana pun.
function snapshotTetangga(db) {
  db.sqlite.exec(`
    INSERT INTO stock_snapshot (tenant_id, outlet_id, variation_id, balance, checkpoint_hlc)
    VALUES ('${TENANT}','outlet-lain','v-cabang',77000,9)
  `);
  db.sqlite.exec(`
    INSERT INTO stock_snapshot (tenant_id, outlet_id, variation_id, balance, checkpoint_hlc)
    VALUES ('tenant-lain','${OUTLET}','v-merchant-lain',88000,9)
  `);
}

function balanceTetangga(db, { tenantId, outletId, variationId }) {
  const baris = db.sqlite
    .prepare(
      `SELECT balance FROM stock_snapshot
        WHERE tenant_id = ? AND outlet_id = ? AND variation_id = ?`
    )
    .all(tenantId, outletId, variationId);
  return baris.length === 1 ? Number(baris[0].balance) : null;
}

const OUTLET_LAIN = { tenantId: TENANT, outletId: 'outlet-lain', variationId: 'v-cabang' };
const TENANT_LAIN = { tenantId: 'tenant-lain', outletId: OUTLET, variationId: 'v-merchant-lain' };

function assertTetanggaUtuh(db) {
  assert.equal(
    balanceTetangga(db, OUTLET_LAIN),
    77000,
    'penghapusan melebar melewati outlet: snapshot outlet lain ikut terhapus'
  );
  assert.equal(
    balanceTetangga(db, TENANT_LAIN),
    88000,
    'penghapusan melebar melewati tenant: snapshot merchant lain ikut terhapus'
  );
}

test('⛔ rebuild MENGHAPUS snapshot yang ledgernya kosong — ledger kosong SEBAGIAN', async () => {
  // Jalur pertama: sebagian variation masih punya movement, jadi `saldo.size`
  // BUKAN nol dan keluar-lebih-awal tidak diambil sama sekali. Ini yang
  // membuktikan penyebabnya ada di loop, bukan di cabang itu.
  const { bacaStok, bangunUlangSnapshot } = await import(MOD);
  const db = dbSungguhan();

  // `varA`: snapshot basi, ledgernya kosong — bentuk sesudah raw table dibangun
  // ulang dan penjualan lama hilang bersamanya.
  snapshot(db, { variationId: 'varA', balance: 100000, checkpointHlc: 4 });
  // `varB`: punya movement, jadi rebuild tetap punya pekerjaan yang sah.
  gerak(db, { variationId: 'varB', delta: 3000, hlc: 7, type: 'receipt' });
  snapshotTetangga(db);

  assert.equal(await bacaStok(db, KONFIG, 'varA'), 100000, 'prasyarat: snapshot basi memang terbaca');

  await bangunUlangSnapshot(db, KONFIG);

  assert.deepEqual(
    snapshotYatim(db, { tenantId: TENANT, outletId: OUTLET }),
    [],
    'snapshot tanpa dasar di ledger masih ada sesudah rebuild'
  );
  assert.equal(await bacaStok(db, KONFIG, 'varA'), 0, 'varA tanpa ledger harus nol, bukan angka basi');
  assert.equal(await bacaStok(db, KONFIG, 'varB'), 3000, 'varB yang sah ikut terhapus');
  assertTetanggaUtuh(db);
});

test('⛔ rebuild MENGHAPUS snapshot yang ledgernya kosong — ledger kosong SELURUHNYA', async () => {
  // Jalur kedua, dan jalur yang berbeda kodenya: `saldo.size === 0`, jadi
  // fungsinya sampai ke cabang keluar-lebih-awal. Cabang itu tetap ada — yang
  // diuji di sini adalah bahwa ia keluar hanya saat benar-benar tidak ada yang
  // perlu ditulis.
  const { bacaStok, bangunUlangSnapshot } = await import(MOD);
  const db = dbSungguhan();

  snapshot(db, { variationId: 'varA', balance: 100000, checkpointHlc: 4 });
  snapshot(db, { variationId: 'varB', balance: 25000, checkpointHlc: 6 });
  snapshotTetangga(db);

  assert.equal(await bacaStok(db, KONFIG, 'varA'), 100000, 'prasyarat: snapshot basi memang terbaca');

  await bangunUlangSnapshot(db, KONFIG);

  assert.deepEqual(
    snapshotYatim(db, { tenantId: TENANT, outletId: OUTLET }),
    [],
    'snapshot tanpa dasar di ledger masih ada sesudah rebuild'
  );
  assert.equal(await bacaStok(db, KONFIG, 'varA'), 0);
  assert.equal(await bacaStok(db, KONFIG, 'varB'), 0);
  assertTetanggaUtuh(db);
});

test('⛔ movement baru TIDAK menumpuk di atas saldo basi', async () => {
  // Gejala yang terukur, dan yang membuat cacatnya lebih buruk daripada sekadar
  // angka kedaluwarsa: movement berikutnya ditambahkan di ATAS snapshot yang
  // sudah kehilangan dasarnya, jadi hasilnya bukan angka lama melainkan angka
  // yang tidak pernah benar — sempat terukur −5 untuk stok yang sebenarnya
  // positif.
  const { bacaStok, bangunUlangSnapshot } = await import(MOD);
  const db = dbSungguhan();

  snapshot(db, { variationId: 'varA', balance: 100000, checkpointHlc: 4 });
  await bangunUlangSnapshot(db, KONFIG);
  gerak(db, { variationId: 'varA', delta: -5000, hlc: 9 });

  assert.equal(
    await bacaStok(db, KONFIG, 'varA'),
    -5000,
    'stok dibaca dari saldo basi, bukan dari ledger yang sekarang'
  );
  assert.equal(await bacaStok(db, KONFIG, 'varA'), await bacaStokLangsungDi(db, 'varA'));
});

async function bacaStokLangsungDi(db, variationId) {
  const { bacaStokLangsung } = await import(MOD);
  return bacaStokLangsung(db, KONFIG, variationId);
}
