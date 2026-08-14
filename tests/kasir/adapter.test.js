'use strict';

// Adapter PowerSync -> port `DbLokal`.
//
// `HANDOFF.md` mencatat klaim yang belum terbukti: "Port `DbLokal` dirancang
// agar keduanya cocok tanpa adaptor tebal, tapi kecocokan itu belum dibuktikan
// dengan menjalankan kode -- hanya `node:sqlite` yang pernah mengisinya."
//
// Klaim itu sebenarnya dua klaim, dan mencampurnya membuat keduanya tidak
// pernah selesai:
//
//   1. BENTUK pemakaiannya benar -- `transaction` memetakan ke
//      `writeTransaction`, parameter diteruskan apa adanya, transaksi
//      bersarang ditolak. Itu diuji di sini, di node.
//   2. `PowerSyncDatabase` sungguhan berperilaku seperti yang diasumsikan.
//      Itu hanya browser yang dapat membuktikannya (harness T8).

const { test } = require('node:test');
const assert = require('node:assert/strict');

const ADAPTER = '../../apps/kasir/src/lokal/adapter.ts';

function psPalsu({ gagalDiTengah = false } = {}) {
  const jejak = [];
  const ps = {
    async getAll(sql, params) {
      jejak.push(['getAll', sql, params]);
      return [{ n: 1 }];
    },
    async execute(sql, params) {
      jejak.push(['execute', sql, params]);
      return { rowsAffected: 1 };
    },
    async writeTransaction(fn) {
      jejak.push(['writeTransaction']);
      const tx = {
        async getAll(sql, params) {
          jejak.push(['tx.getAll', sql, params]);
          return [];
        },
        async execute(sql, params) {
          jejak.push(['tx.execute', sql, params]);
          if (gagalDiTengah) throw new Error('disk penuh');
          return { rowsAffected: 1 };
        },
      };
      try {
        const hasil = await fn(tx);
        jejak.push(['COMMIT']);
        return hasil;
      } catch (e) {
        jejak.push(['ROLLBACK']);
        throw e;
      }
    },
  };
  return { ps, jejak };
}

test('transaction dipetakan ke writeTransaction, bukan ke execute("BEGIN")', async () => {
  const { adaptDbLokal } = await import(ADAPTER);
  const { ps, jejak } = psPalsu();
  const db = adaptDbLokal(ps);

  await db.transaction(async (tx) => {
    await tx.execute('INSERT INTO "order" (id) VALUES (?)', ['ord-1']);
  });

  assert.deepEqual(jejak, [
    ['writeTransaction'],
    ['tx.execute', 'INSERT INTO "order" (id) VALUES (?)', ['ord-1']],
    ['COMMIT'],
  ]);
  assert.ok(
    !jejak.some(([, sql]) => typeof sql === 'string' && /^BEGIN/i.test(sql)),
    'transaksi dimulai lewat SQL mentah, bukan writeTransaction'
  );
});

test('nilai kembalian transaksi diteruskan', async () => {
  const { adaptDbLokal } = await import(ADAPTER);
  const { ps } = psPalsu();
  const db = adaptDbLokal(ps);
  assert.equal(await db.transaction(async () => 'nomor-struk'), 'nomor-struk');
});

// Invariant #1: satu penjualan = satu transaksi. Kegagalan di tengah harus
// membatalkan SELURUHNYA, dan adapter tidak boleh menelan lemparannya --
// pemanggil yang tidak melihat error akan mengira penjualan tersimpan.
test('kegagalan di tengah transaksi meneruskan error, bukan menelannya', async () => {
  const { adaptDbLokal } = await import(ADAPTER);
  const { ps, jejak } = psPalsu({ gagalDiTengah: true });
  const db = adaptDbLokal(ps);

  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.execute('INSERT INTO "order" (id) VALUES (?)', ['ord-1']);
    }),
    /disk penuh/
  );
  assert.ok(jejak.some(([j]) => j === 'ROLLBACK'));
  assert.ok(!jejak.some(([j]) => j === 'COMMIT'));
});

// SQLite tidak punya transaksi bersarang. `writeTransaction` di dalam
// `writeTransaction` menunggu kunci yang dipegang dirinya sendiri -- aplikasi
// kasir membeku di tengah penjualan, tanpa error apa pun.
test('transaksi bersarang ditolak dengan pesan yang menunjuk penyebabnya', async () => {
  const { adaptDbLokal } = await import(ADAPTER);
  const { ps } = psPalsu();
  const db = adaptDbLokal(ps);

  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.transaction(async () => {});
    }),
    /bersarang/i
  );
});

test('parameter kosong diteruskan sebagai larik, bukan undefined', async () => {
  const { adaptDbLokal } = await import(ADAPTER);
  const { ps, jejak } = psPalsu();
  const db = adaptDbLokal(ps);

  await db.getAll('SELECT 1');
  await db.execute('PRAGMA foreign_keys=ON');

  assert.deepEqual(jejak[0], ['getAll', 'SELECT 1', []]);
  assert.deepEqual(jejak[1], ['execute', 'PRAGMA foreign_keys=ON', []]);
});

// Bukti bahwa adapter ini benar-benar memenuhi port -- relay sungguhan
// berjalan di atasnya, bukan hanya bentuknya yang cocok secara tipe.
test('relay sungguhan berjalan di atas adapter ini', async () => {
  const { adaptDbLokal } = await import(ADAPTER);
  const { buatDb } = require('../sync-client/helpers/db');
  const { enqueue } = await import('../../packages/sync-client/src/enqueue.ts');
  const { kirimBatch } = await import('../../packages/sync-client/src/relay.ts');

  const nyata = buatDb();
  try {
    // `node:sqlite` dibungkus supaya BENTUKNYA seperti PowerSync
    // (`writeTransaction`), lalu dikembalikan ke `DbLokal` lewat adapter yang
    // sama yang dipakai aplikasi.
    const psMirip = {
      getAll: (sql, params) => nyata.getAll(sql, params),
      execute: (sql, params) => nyata.execute(sql, params),
      writeTransaction: (fn) => nyata.transaction((tx) => fn(tx)),
    };
    const db = adaptDbLokal(psMirip);

    await db.transaction(async (tx) => {
      await enqueue(tx, {
        id: 'obx-1',
        entityType: 'order',
        entityId: 'ord-1',
        operation: 'create',
        payload: { total: 44400 },
        idempotencyKey: 'key-1',
        createdAt: '2026-08-08T10:00:00.000Z',
      });
    });

    const hasil = await kirimBatch({
      db,
      now: () => Date.parse('2026-08-08T10:00:01.000Z'),
      kirim: async () => ({ status: 201 }),
    });

    assert.equal(hasil.terkirim, 1);
    const [{ status }] = await db.getAll(`SELECT status FROM outbox_local`);
    assert.equal(status, 'sent');
  } finally {
    nyata.tutup();
  }
});
