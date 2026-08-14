'use strict';

// FR-E5 — penandaan habis manual, di atas SQLite sungguhan.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const MOD = '../../apps/kasir/src/inventori/sold-out.ts';
const STOK = '../../apps/kasir/src/inventori/stok.ts';
const SKEMA = join(__dirname, '..', '..', 'db', 'local', '001-initial.sql');

const KONFIG = { tenantId: 't1', outletId: 'o1' };

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

const jam = (iso) => () => new Date(iso);

let n = 0;
const idBaru = () => `sf-${++n}`;

test('menandai habis berlaku seketika, tanpa jaringan (spec-e:226)', async () => {
  const { tandaiHabis, bacaHabis } = await import(MOD);
  const db = dbSungguhan();

  await tandaiHabis(db, KONFIG, {
    variationId: 'v1', habis: true, userId: 'u-sari',
    waktu: jam('2026-08-13T10:00:00Z'), idBaru, hlc: () => 5n,
  });

  assert.equal((await bacaHabis(db, KONFIG)).has('v1'), true);
});

test('⛔ pembatalan penandaan yang LEBIH BARU menang', async () => {
  // Kalau hanya baris bernilai 1 yang dibaca, produk yang sudah tersedia lagi
  // tetap terlihat habis selamanya — dan kasir menolak penjualan yang
  // sebenarnya bisa dilayani.
  const { tandaiHabis, bacaHabis } = await import(MOD);
  const db = dbSungguhan();

  await tandaiHabis(db, KONFIG, {
    variationId: 'v1', habis: true, userId: 'u-sari',
    waktu: jam('2026-08-13T10:00:00Z'), idBaru, hlc: () => 5n,
  });
  await tandaiHabis(db, KONFIG, {
    variationId: 'v1', habis: false, userId: 'u-sari',
    waktu: jam('2026-08-13T11:00:00Z'), idBaru, hlc: () => 9n,
  });

  assert.equal((await bacaHabis(db, KONFIG)).has('v1'), false);
});

test('⛔ HLC yang menentukan, bukan urutan penulisan', async () => {
  // Dua perangkat offline menandai produk yang sama. Barisnya sampai ke sini
  // dalam urutan mana pun, dan yang menang harus tetap yang HLC-nya lebih
  // besar — bukan yang kebetulan ditulis belakangan.
  const { tandaiHabis, bacaHabis } = await import(MOD);
  const db = dbSungguhan();

  // ⛔ Urutannya HARUS begini: HLC TERBESAR ditulis LEBIH DULU.
  //
  // Versi pertama test ini menulisnya terbalik (hlc 9 dulu, hlc 12
  // belakangan), dan ia tidak menguji apa pun: "baris terakhir menang"
  // kebetulan memberi jawaban yang sama dengan "HLC terbesar menang".
  // Sabotase yang mengganti perbandingan HLC dengan `if (true)` tetap hijau.
  //
  // Dengan urutan ini keduanya berbeda: HLC benar menjawab `true`, baris
  // terakhir menjawab `false`.
  await tandaiHabis(db, KONFIG, {
    variationId: 'v1', habis: true, userId: 'u-sari',
    waktu: jam('2026-08-13T10:00:00Z'), idBaru, hlc: () => 12n,
  });
  await tandaiHabis(db, KONFIG, {
    variationId: 'v1', habis: false, userId: 'u-budi',
    waktu: jam('2026-08-13T09:00:00Z'), idBaru, hlc: () => 9n,
  });

  assert.equal((await bacaHabis(db, KONFIG)).has('v1'), true, 'HLC terbesar harus menang');
});

test('⛔ HLC menang meski baris datang dalam urutan TERBALIK', async () => {
  // ⛔ Test di atas TIDAK dapat membuktikan ini, dan itu ditemukan lewat
  // sabotase: mengganti perbandingan HLC dengan "baris terakhir menang" tetap
  // hijau di SQLite sungguhan. Sebabnya struktural — index
  // `(outlet_id, variation_id, hlc)` membuat pemindaian terurut hlc MENAIK,
  // jadi "baris terakhir" kebetulan selalu sama dengan "HLC terbesar".
  //
  // Yang dijamin SQL tanpa `ORDER BY` adalah TIDAK ADA urutan. Sumber yang
  // mengembalikan baris menurun karena itu bukan penyederhanaan test — ia
  // satu-satunya cara menguji jaminan yang kodenya sendiri harus berikan.
  const { bacaHabis } = await import(MOD);
  const dbUrutTerbalik = {
    async getAll() {
      return [
        { variation_id: 'v1', is_sold_out: 0, hlc: 9 },
        { variation_id: 'v1', is_sold_out: 1, hlc: 12 },
      ].reverse();
    },
    async execute() {
      return { rowsAffected: 0 };
    },
    async transaction(fn) {
      return fn(this);
    },
  };

  assert.equal(
    (await bacaHabis(dbUrutTerbalik, KONFIG)).has('v1'),
    true,
    'hasilnya bergantung pada urutan baris, bukan pada HLC'
  );
});

test('⛔ penandaan TIDAK menyentuh stok terhitung, dan sebaliknya', async () => {
  // `spec-e:220`: keduanya disimpan terpisah. Produk dapat ditandai habis
  // meski stok tercatat masih 10 — bahan habis, mesin rusak.
  const { tandaiHabis, bacaHabis } = await import(MOD);
  const { bacaStok } = await import(STOK);
  const db = dbSungguhan();

  db.sqlite.exec(
    `INSERT INTO stock_movement
       (id, tenant_id, outlet_id, device_id, variation_id, type, delta, created_by, occurred_at, hlc)
     VALUES ('mv-1','t1','o1','d1','v1','receipt',10000,'u-sari','2026-08-13T09:00:00Z',1)`
  );
  await tandaiHabis(db, KONFIG, {
    variationId: 'v1', habis: true, userId: 'u-sari',
    waktu: jam('2026-08-13T10:00:00Z'), idBaru, hlc: () => 5n,
  });

  assert.equal(await bacaStok(db, KONFIG, 'v1'), 10000, 'penandaan mengubah stok terhitung');
  assert.equal((await bacaHabis(db, KONFIG)).has('v1'), true);
});

test('penandaan terisolasi per OUTLET', async () => {
  const { tandaiHabis, bacaHabis } = await import(MOD);
  const db = dbSungguhan();
  await tandaiHabis(db, { tenantId: 't1', outletId: 'outlet-lain' }, {
    variationId: 'v1', habis: true, userId: 'u-sari',
    waktu: jam('2026-08-13T10:00:00Z'), idBaru, hlc: () => 5n,
  });

  assert.equal((await bacaHabis(db, KONFIG)).has('v1'), false);
});

test('⛔ reset TIDAK otomatis — ia mengembalikan daftar untuk dikonfirmasi', async () => {
  // `spec-e:229`: "Reset saat buka shift dengan konfirmasi, bukan otomatis
  // diam-diam." Kopi yang memang masih habis akan kembali terjual tanpa ada
  // yang tahu, dan kasir menerima pesanan yang tidak dapat dipenuhi.
  const { tandaiHabis, perluKonfirmasiReset, bacaHabis } = await import(MOD);
  const db = dbSungguhan();
  for (const v of ['v2', 'v1']) {
    await tandaiHabis(db, KONFIG, {
      variationId: v, habis: true, userId: 'u-sari',
      waktu: jam('2026-08-13T10:00:00Z'), idBaru, hlc: () => 5n,
    });
  }

  const daftar = await perluKonfirmasiReset(db, KONFIG);
  assert.deepEqual(daftar, ['v1', 'v2'], 'daftar harus terurut dan lengkap');
  // ⛔ Memanggilnya TIDAK mengubah apa pun.
  assert.equal((await bacaHabis(db, KONFIG)).size, 2, 'membaca daftar ikut mereset');
});

test('reset hanya membatalkan produk yang DIPILIH', async () => {
  // Konfirmasi ya/tidak memaksa kasir memilih antara mereset kopi yang memang
  // masih habis atau membiarkan roti yang sudah tersedia tetap tertandai.
  const { tandaiHabis, resetHabis, bacaHabis } = await import(MOD);
  const db = dbSungguhan();
  for (const v of ['v1', 'v2']) {
    await tandaiHabis(db, KONFIG, {
      variationId: v, habis: true, userId: 'u-sari',
      waktu: jam('2026-08-13T10:00:00Z'), idBaru, hlc: () => 5n,
    });
  }

  await resetHabis(db, KONFIG, {
    variationIds: ['v1'], userId: 'u-budi',
    waktu: jam('2026-08-14T07:00:00Z'), idBaru, hlc: () => 20n,
  });

  const habis = await bacaHabis(db, KONFIG);
  assert.equal(habis.has('v1'), false);
  assert.equal(habis.has('v2'), true, 'produk yang tidak dipilih ikut direset');
});

test('⛔ penandaan TIDAK dihapus, ia ditimpa baris baru', async () => {
  // Ledger, bukan kolom. Siapa yang menandai dan kapan tetap dapat ditelusuri.
  const { tandaiHabis, resetHabis } = await import(MOD);
  const db = dbSungguhan();
  await tandaiHabis(db, KONFIG, {
    variationId: 'v1', habis: true, userId: 'u-sari',
    waktu: jam('2026-08-13T10:00:00Z'), idBaru, hlc: () => 5n,
  });
  await resetHabis(db, KONFIG, {
    variationIds: ['v1'], userId: 'u-budi',
    waktu: jam('2026-08-14T07:00:00Z'), idBaru, hlc: () => 20n,
  });

  const baris = db.sqlite.prepare(`SELECT set_by, is_sold_out FROM sold_out_flag ORDER BY hlc`).all();
  assert.equal(baris.length, 2, 'baris lama harus tetap ada');
  assert.equal(baris[0].set_by, 'u-sari');
  assert.equal(baris[1].set_by, 'u-budi');
});
