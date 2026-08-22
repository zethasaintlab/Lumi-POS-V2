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

// ---------------------------------------------------------------------------
// Jalur naik — `POST /inventory/sold-out` (FR-E5, `spec-e:211`)
// ---------------------------------------------------------------------------

test('⛔ penandaan masuk outbox DI TRANSAKSI YANG SAMA', async () => {
  // Sebelum endpointnya ada, penandaan lokal saja — barista menandai kopi
  // habis di terminal 1 dan kasir di terminal 2 tetap menerima pesanannya.
  // Penanda yang ter-commit TANPA item outbox-nya tidak akan pernah naik, dan
  // tidak ada apa pun yang memperbaikinya sendiri.
  const { tandaiHabis } = await import(MOD);
  const db = dbSungguhan();

  await tandaiHabis(db, KONFIG, {
    variationId: 'v1',
    habis: true,
    userId: 'u1',
    waktu: jam('2026-08-21T03:00:00.000Z'),
    idBaru,
    hlc: () => 700n,
  });

  const flag = await db.getAll('SELECT id FROM sold_out_flag');
  const outbox = await db.getAll('SELECT * FROM outbox_local');
  assert.equal(flag.length, 1);
  assert.equal(outbox.length, 1, 'penanda tanpa item outbox tidak akan pernah naik');

  const b = outbox[0];
  assert.equal(b.entity_type, 'sold_out');
  assert.equal(b.entity_id, flag[0].id, 'id BARIS penandaan, bukan variation');
  assert.equal(b.idempotency_key, flag[0].id, 'retry memakai kunci yang sama');
  assert.equal(b.actor_id, 'u1', 'aktor dibekukan saat item dibuat');

  // ⛔ Payload diperiksa NILAI-nya, bukan sekadar bahwa tabelnya disentuh.
  // Bentuk yang tidak cocok dengan `required` endpoint baru ketahuan saat
  // relay mengirimnya — dan item itu membakar percobaannya sampai `failed`
  // permanen, di perangkat merchant.
  assert.deepEqual(JSON.parse(b.payload), {
    id: flag[0].id,
    outletId: 'o1',
    variationId: 'v1',
    isSoldOut: true,
    hlc: '700',
    occurredAt: '2026-08-21T03:00:00.000Z',
  });
});

test('⛔ membatalkan penandaan juga naik, sebagai baris `isSoldOut: false`', async () => {
  // Kalau hanya penandaan yang naik, produk yang sudah tersedia lagi tetap
  // terlihat habis di perangkat lain selamanya.
  const { tandaiHabis, resetHabis } = await import(MOD);
  const db = dbSungguhan();

  await tandaiHabis(db, KONFIG, {
    variationId: 'v1', habis: true, userId: 'u1',
    waktu: jam('2026-08-21T03:00:00.000Z'), idBaru, hlc: () => 700n,
  });
  await resetHabis(db, KONFIG, {
    variationIds: ['v1'], userId: 'u1',
    waktu: jam('2026-08-21T04:00:00.000Z'), idBaru, hlc: () => 900n,
  });

  const outbox = await db.getAll('SELECT payload FROM outbox_local ORDER BY created_at, id');
  assert.equal(outbox.length, 2);
  assert.deepEqual(
    outbox.map((b) => JSON.parse(b.payload).isSoldOut),
    [true, false]
  );
});

test('⛔ keadaan HLC ikut tersimpan, di transaksi yang sama', async () => {
  // Di luar transaksi ada jendela tempat perangkat dapat mati setelah penanda
  // ter-commit tapi sebelum HLC tersimpan; boot berikutnya memuat nilai lama,
  // dan tick berikutnya dapat menghasilkan HLC yang SUDAH DIPAKAI. Dua penanda
  // ber-HLC sama adalah pelanggaran I10 yang tidak menghasilkan error — ia
  // hanya membuat "mana yang lebih baru" tidak terjawab, di tempat yang justru
  // memutuskannya.
  const { tandaiHabis } = await import(MOD);
  const db = dbSungguhan();
  // `simpanHlc` melakukan UPDATE, dan barisnya lahir saat perangkat dipasang
  // (`simpanKonfigPerangkat`). Tanpa baris itu UPDATE-nya mengenai nol baris
  // TANPA error — jadi fixture ini harus meniru perangkat yang sudah dipasang,
  // bukan database kosong yang tidak pernah ada di produksi.
  await db.execute(
    `INSERT INTO device_config (id, device_id, device_code, tenant_id, outlet_id, base_url)
     VALUES (1, 'd1', 'K1', 't1', 'o1', 'http://x')`
  );

  await tandaiHabis(db, KONFIG, {
    variationId: 'v1', habis: true, userId: 'u1',
    waktu: jam('2026-08-21T03:00:00.000Z'), idBaru, hlc: () => 12345678901234n,
  });

  const [cfg] = await db.getAll('SELECT hlc_teks FROM device_config WHERE id = 1');
  assert.equal(cfg.hlc_teks, '12345678901234', 'TEXT, bukan kolom INTEGER — HLC 57-bit melampaui 2^53');
});

test('⛔ jenisnya PUNYA rute; item tanpa rute melempar saat dikirim, bukan saat dibuat', async () => {
  const { RUTE_DIDUKUNG } = await import('../../packages/sync-client/src/http.ts');
  assert.ok(RUTE_DIDUKUNG.includes('sold_out'), 'sold_out harus punya endpoint');
});
