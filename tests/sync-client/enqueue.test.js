'use strict';

// T2-T3 (docs/superpowers/plans/PLAN-fr-h1-outbox-relay.md) -- penulis
// antrean.
//
// spec-h:39 -- "Setiap mutasi yang dibuat perangkat masuk ke tabel
// `outbox_local` DALAM TRANSAKSI YANG SAMA dengan mutasi itu sendiri."
//
// Karena itu `enqueue` menerima transaksi pemanggil dan TIDAK membuka
// transaksinya sendiri -- cerminan `apps/server/src/modules/sync/index.ts`,
// yang menolak `pool` dan hanya menerima `client` dari transaksi pemanggil.
// Membuka transaksi sendiri berarti ada jendela di mana entitas tercatat tapi
// item outbox belum, dan penjualan itu tidak akan pernah naik.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buatDb } = require('./helpers/db');

const ENQUEUE = '../../packages/sync-client/src/enqueue.ts';

const ITEM = {
  id: 'obx-1',
  entityType: 'order',
  entityId: 'ord-1',
  operation: 'create',
  payload: { total: 44400 },
  idempotencyKey: 'key-1',
  createdAt: '2026-08-08T10:00:00.000Z',
};

test('enqueue menulis satu baris outbox_local dengan seluruh field', async () => {
  const { enqueue } = await import(ENQUEUE);
  const db = buatDb();
  try {
    await db.transaction((tx) => enqueue(tx, ITEM));
    const [row] = await db.getAll('SELECT * FROM outbox_local');
    assert.equal(row.id, 'obx-1');
    assert.equal(row.entity_type, 'order');
    assert.equal(row.entity_id, 'ord-1');
    assert.equal(row.operation, 'create');
    assert.equal(row.payload, JSON.stringify({ total: 44400 }));
    assert.equal(row.idempotency_key, 'key-1');
    assert.equal(row.status, 'pending');
    assert.equal(row.attempts, 0);
    assert.equal(row.last_error, null);
    assert.equal(row.last_attempt_at, null);
    assert.equal(row.created_at, '2026-08-08T10:00:00.000Z');
    assert.equal(row.depends_on, null);
  } finally {
    db.tutup();
  }
});

// §2.3 rencana: server hanya mengekspos endpoint untuk empat jenis. Jenis
// lain (`stock_movement`, `audit_event`, `cash_movement`) ditulis server-side
// DI DALAM transaksi order/cancel -- ia ikut naik bersama order-nya dan tidak
// punya endpoint sendiri.
//
// Ditolak KERAS, bukan dilewati diam-diam: item yang tidak dapat dikirim dan
// tidak pernah mengeluh adalah penjualan yang hilang tanpa jejak.
test('enqueue MENOLAK entity_type yang tidak punya endpoint', async () => {
  const { enqueue } = await import(ENQUEUE);
  const db = buatDb();
  try {
    for (const jenis of ['stock_movement', 'audit_event', 'cash_movement', 'apa_saja']) {
      await assert.rejects(
        db.transaction((tx) => enqueue(tx, { ...ITEM, entityType: jenis })),
        /entity_type/i,
        `${jenis} seharusnya ditolak`
      );
    }
    const sisa = await db.getAll('SELECT * FROM outbox_local');
    assert.equal(sisa.length, 0, 'tidak boleh ada baris tersimpan untuk jenis yang ditolak');
  } finally {
    db.tutup();
  }
});

test('⛔ ENTITY_TYPES dan peta RUTE memuat jenis yang SAMA PERSIS', async () => {
  // Dulu daftar ini ditulis tangan di sini, dan itu memeriksa hal yang salah:
  // yang berbahaya bukan "daftarnya berubah" melainkan **kedua daftar
  // menyimpang**. Jenis yang ditambahkan ke `ENTITY_TYPES` tanpa rute akan
  // MELEMPAR saat relay mengirimnya — dan lemparan itu terjadi berjam-jam
  // setelah penjualan ditulis, di perangkat merchant, bukan di sini.
  //
  // Arah sebaliknya sama buruknya: rute tanpa jenis berarti endpoint yang
  // tidak pernah dapat dicapai antrean.
  const { ENTITY_TYPES } = await import(ENQUEUE);
  const { RUTE_DIDUKUNG } = await import('../../packages/sync-client/src/http.ts');
  assert.deepEqual([...ENTITY_TYPES].sort(), [...RUTE_DIDUKUNG].sort());
});

test('enqueue menerima SETIAP jenis yang punya endpoint', async () => {
  const { enqueue, ENTITY_TYPES } = await import(ENQUEUE);

  const db = buatDb();
  try {
    let n = 0;
    for (const jenis of ENTITY_TYPES) {
      n += 1;
      await db.transaction((tx) =>
        enqueue(tx, { ...ITEM, id: `obx-${n}`, entityType: jenis, idempotencyKey: `key-${n}` })
      );
    }
    const rows = await db.getAll('SELECT entity_type FROM outbox_local ORDER BY id');
    assert.equal(rows.length, ENTITY_TYPES.length);
  } finally {
    db.tutup();
  }
});

// `idempotency_key` WAJIB ada saat item dibuat, bukan di-generate saat
// dikirim. Itulah yang membuat pemulihan `sending` -> `pending` setelah
// aplikasi mati aman: retry memakai key yang sama dan server mengenalinya.
// Kalau key lahir saat pengiriman, pemulihan itu justru MENGHASILKAN
// duplikat.
test('enqueue menolak item tanpa idempotencyKey', async () => {
  const { enqueue } = await import(ENQUEUE);
  const db = buatDb();
  try {
    await assert.rejects(
      db.transaction((tx) => enqueue(tx, { ...ITEM, idempotencyKey: undefined })),
      /idempotency/i
    );
  } finally {
    db.tutup();
  }
});

test('enqueue menyimpan depends_on saat diberikan', async () => {
  const { enqueue } = await import(ENQUEUE);
  const db = buatDb();
  try {
    await db.transaction(async (tx) => {
      await enqueue(tx, { ...ITEM, id: 'obx-shift', entityType: 'shift', idempotencyKey: 'k-s' });
      await enqueue(tx, { ...ITEM, id: 'obx-order', dependsOn: 'obx-shift' });
    });
    // `node:sqlite` mengembalikan baris ber-prototype null, dan
    // `assert.deepEqual` yang strict membedakan prototype. Disalin ke objek
    // biasa supaya yang dibandingkan isinya, bukan asal-usulnya.
    const rows = (await db.getAll('SELECT id, depends_on FROM outbox_local ORDER BY id')).map(
      (r) => ({ ...r })
    );
    assert.deepEqual(rows, [
      { id: 'obx-order', depends_on: 'obx-shift' },
      { id: 'obx-shift', depends_on: null },
    ]);
  } finally {
    db.tutup();
  }
});

// --- T3: AC pertama FR-H1 ---
//
// "Item outbox ditulis dalam transaksi yang sama dengan entitasnya -- injeksi
// kegagalan tidak pernah menghasilkan entitas tanpa item outbox."
//
// Yang membuktikannya bukan penulisan yang berhasil. Sepuluh INSERT
// berurutan tanpa transaksi apa pun akan memberi hasil yang sama. Yang
// membuktikannya adalah kegagalan SETELAH entitas ditulis.
test('T3 kegagalan setelah entitas ditulis TIDAK menyisakan entitas tanpa outbox', async () => {
  const { enqueue } = await import(ENQUEUE);
  const db = buatDb();
  try {
    await assert.rejects(
      db.transaction(async (tx) => {
        await tx.execute(
          `INSERT INTO "order" (id,tenant_id,outlet_id,device_id,shift_id,receipt_number,
             business_date,sequence,status,channel,subtotal,total,amount_due,created_by,
             occurred_at,hlc)
           VALUES ('ord-1','t1','o1','d1','s1','K1-20260808-0001','2026-08-08',1,'closed',
             'takeaway',40000,44400,44400,'u1','2026-08-08T10:00:00Z',1)`
        );
        await enqueue(tx, ITEM);
        throw new Error('perangkat mati di sini');
      }),
      /perangkat mati/
    );

    const order = await db.getAll(`SELECT id FROM "order"`);
    const outbox = await db.getAll('SELECT id FROM outbox_local');
    assert.equal(order.length, 0, 'order bertahan tanpa item outbox -- penjualan yang tidak akan pernah naik');
    assert.equal(outbox.length, 0);
  } finally {
    db.tutup();
  }
});
