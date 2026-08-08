'use strict';

// T4, T6, T7, T8 -- relay.
//
// Seluruh test di sini memakai jam dan pengirim yang DI-INJECT. Tidak satu
// pun menyentuh jaringan atau `Date.now()`, dan T10 menegakkan itu terhadap
// kodenya.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buatDb, buatDbBerkas } = require('./helpers/db');

const RELAY = '../../packages/sync-client/src/relay.ts';
const ENQUEUE = '../../packages/sync-client/src/enqueue.ts';

const T0 = Date.parse('2026-08-08T10:00:00.000Z');

function iso(ms) {
  return new Date(ms).toISOString();
}

async function isiAntrean(db, item) {
  const { enqueue } = await import(ENQUEUE);
  await db.transaction((tx) => enqueue(tx, item));
}

function itemDasar(n, extra = {}) {
  return {
    id: `obx-${String(n).padStart(4, '0')}`,
    entityType: 'order',
    entityId: `ord-${n}`,
    operation: 'create',
    payload: { n },
    idempotencyKey: `key-${n}`,
    createdAt: iso(T0 + n),
    ...extra,
  };
}

/** Pengirim yang mencatat apa yang diminta darinya. */
function pengirimPalsu(jawab) {
  const dikirim = [];
  return {
    dikirim,
    async kirim(baris) {
      dikirim.push(baris.id);
      return jawab(baris, dikirim.length);
    },
  };
}

// --- T4: pemilihan batch ---

test('T4 batch maksimum 50 item, urut created_at', async () => {
  const { kirimBatch } = await import(RELAY);
  const db = buatDb();
  try {
    for (let n = 1; n <= 60; n += 1) await isiAntrean(db, itemDasar(n));

    const p = pengirimPalsu(() => ({ status: 201 }));
    const hasil = await kirimBatch({ db, now: () => T0 + 1000, kirim: p.kirim });

    assert.equal(p.dikirim.length, 50, 'spec-h:60 -- batas 50 item per batch');
    assert.equal(p.dikirim[0], 'obx-0001', 'yang tertua duluan');
    assert.equal(p.dikirim[49], 'obx-0050');
    assert.equal(hasil.terkirim, 50);
  } finally {
    db.tutup();
  }
});

// Yang paling mudah salah dan tidak terlihat sampai antrean menumpuk.
//
// Kalau penyaringan jatuh-tempo dilakukan SETELAH `LIMIT 50`, lima puluh item
// lama yang sedang backoff 60 detik akan mengisi seluruh batch dan
// mengembalikan nol — sementara penjualan yang baru saja terjadi menunggu di
// belakangnya. Kasir tidak melihat apa pun; penjualannya hanya tidak naik.
test('T4b item lama yang sedang backoff TIDAK memblokir penjualan baru', async () => {
  const { kirimBatch } = await import(RELAY);
  const db = buatDb();
  try {
    // 50 item lama, sudah 6 kali gagal, baru saja dicoba -> backoff 60 detik.
    for (let n = 1; n <= 50; n += 1) {
      await isiAntrean(db, itemDasar(n));
      await db.execute(
        `UPDATE outbox_local SET attempts = 6, last_attempt_at = ? WHERE id = ?`,
        [iso(T0 + 1000), `obx-${String(n).padStart(4, '0')}`]
      );
    }
    // Satu penjualan baru, belum pernah dicoba.
    await isiAntrean(db, itemDasar(99));

    const p = pengirimPalsu(() => ({ status: 201 }));
    await kirimBatch({ db, now: () => T0 + 2000, kirim: p.kirim });

    assert.deepEqual(p.dikirim, ['obx-0099'], 'hanya item baru yang jatuh tempo yang boleh dikirim');
  } finally {
    db.tutup();
  }
});

test('T4c item failed tidak pernah dikirim lagi, dan tidak dihapus', async () => {
  const { kirimBatch } = await import(RELAY);
  const db = buatDb();
  try {
    await isiAntrean(db, itemDasar(1));
    await db.execute(`UPDATE outbox_local SET status = 'failed' WHERE id = 'obx-0001'`);

    const p = pengirimPalsu(() => ({ status: 201 }));
    await kirimBatch({ db, now: () => T0 + 1_000_000, kirim: p.kirim });

    assert.deepEqual(p.dikirim, []);
    const [row] = await db.getAll(`SELECT status FROM outbox_local WHERE id = 'obx-0001'`);
    assert.equal(row.status, 'failed', 'spec-h:63 -- item failed TIDAK dihapus');
  } finally {
    db.tutup();
  }
});

// --- T6: backoff dan batas percobaan ---

test('T6 kegagalan menaikkan attempts dan menunda percobaan berikutnya', async () => {
  const { kirimBatch } = await import(RELAY);
  const db = buatDb();
  try {
    await isiAntrean(db, itemDasar(1));
    const p = pengirimPalsu(() => ({ status: 503, pesan: 'server sibuk' }));

    await kirimBatch({ db, now: () => T0, kirim: p.kirim });
    let [row] = await db.getAll(`SELECT * FROM outbox_local`);
    assert.equal(row.status, 'pending');
    assert.equal(row.attempts, 1);
    assert.equal(row.last_error, 'server sibuk');
    assert.equal(row.last_attempt_at, iso(T0));

    // Belum jatuh tempo -> tidak dikirim lagi.
    await kirimBatch({ db, now: () => T0 + 1_999, kirim: p.kirim });
    assert.equal(p.dikirim.length, 1, 'tidak boleh dicoba sebelum 2 detik');

    await kirimBatch({ db, now: () => T0 + 2_000, kirim: p.kirim });
    assert.equal(p.dikirim.length, 2);
    [row] = await db.getAll(`SELECT * FROM outbox_local`);
    assert.equal(row.attempts, 2);
  } finally {
    db.tutup();
  }
});

test('T6b percobaan ke-20 menandai failed', async () => {
  const { kirimBatch } = await import(RELAY);
  const { BATAS_PERCOBAAN_GAGAL } = await import('../../packages/sync-client/src/backoff.ts');
  const db = buatDb();
  try {
    await isiAntrean(db, itemDasar(1));
    await db.execute(
      `UPDATE outbox_local SET attempts = ?, last_attempt_at = ? WHERE id = 'obx-0001'`,
      [BATAS_PERCOBAAN_GAGAL - 1, iso(T0)]
    );

    const p = pengirimPalsu(() => ({ status: 503, pesan: 'masih sibuk' }));
    await kirimBatch({ db, now: () => T0 + 60_000, kirim: p.kirim });

    const [row] = await db.getAll(`SELECT * FROM outbox_local`);
    assert.equal(row.attempts, BATAS_PERCOBAAN_GAGAL);
    assert.equal(row.status, 'failed');
    assert.equal(row.last_error, 'masih sibuk', 'alasan terakhir harus tersimpan untuk FR-H3');
  } finally {
    db.tutup();
  }
});

test('T6c gagal-permanen menandai failed SEKETIKA, tanpa 20 percobaan', async () => {
  const { kirimBatch } = await import(RELAY);
  const db = buatDb();
  try {
    await isiAntrean(db, itemDasar(1));
    const p = pengirimPalsu(() => ({ status: 400, code: 'VALIDATION_ERROR', pesan: 'total salah' }));
    await kirimBatch({ db, now: () => T0, kirim: p.kirim });

    const [row] = await db.getAll(`SELECT * FROM outbox_local`);
    assert.equal(row.status, 'failed');
    assert.equal(row.attempts, 1, 'sekali coba sudah cukup untuk payload yang cacat');
  } finally {
    db.tutup();
  }
});

test('T6d 409 ID_ALREADY_EXISTS menandai sent', async () => {
  const { kirimBatch } = await import(RELAY);
  const db = buatDb();
  try {
    await isiAntrean(db, itemDasar(1, { entityType: 'shift' }));
    const p = pengirimPalsu(() => ({ status: 409, code: 'ID_ALREADY_EXISTS' }));
    await kirimBatch({ db, now: () => T0, kirim: p.kirim });

    const [row] = await db.getAll(`SELECT * FROM outbox_local`);
    assert.equal(row.status, 'sent');
  } finally {
    db.tutup();
  }
});

// --- T7: dependensi ---

test('T7 item yang bergantung DILEWATI tanpa menambah attempts', async () => {
  const { kirimBatch } = await import(RELAY);
  const db = buatDb();
  try {
    await isiAntrean(db, itemDasar(1, { entityType: 'shift', id: 'obx-shift' }));
    await isiAntrean(db, itemDasar(2, { id: 'obx-order', dependsOn: 'obx-shift' }));

    // Shift gagal; order-nya belum boleh dikirim.
    const p = pengirimPalsu((baris) =>
      baris.id === 'obx-shift' ? { status: 503, pesan: 'sibuk' } : { status: 201 }
    );
    await kirimBatch({ db, now: () => T0, kirim: p.kirim });

    assert.deepEqual(p.dikirim, ['obx-shift'], 'order tidak boleh dikirim sebelum shift-nya');

    const rows = await db.getAll(`SELECT id, attempts, status FROM outbox_local ORDER BY id`);
    const order = rows.find((r) => r.id === 'obx-order');
    assert.equal(order.attempts, 0, 'menunggu dependensi TIDAK boleh membakar counter percobaan');
    assert.equal(order.status, 'pending');
  } finally {
    db.tutup();
  }
});

test('T7b setelah dependensi terkirim, item yang menunggu ikut jalan', async () => {
  const { kirimBatch } = await import(RELAY);
  const db = buatDb();
  try {
    await isiAntrean(db, itemDasar(1, { entityType: 'shift', id: 'obx-shift' }));
    await isiAntrean(db, itemDasar(2, { id: 'obx-order', dependsOn: 'obx-shift' }));

    const p = pengirimPalsu(() => ({ status: 201 }));
    await kirimBatch({ db, now: () => T0, kirim: p.kirim });

    assert.deepEqual(p.dikirim, ['obx-shift', 'obx-order'], 'keduanya dalam satu batch, urut');
    const rows = await db.getAll(`SELECT status FROM outbox_local`);
    assert.ok(rows.every((r) => r.status === 'sent'));
  } finally {
    db.tutup();
  }
});

// AC keempat FR-H1: "Item gagal tidak memblokir item independen."
test('T7c item gagal tidak memblokir item yang TIDAK bergantung padanya', async () => {
  const { kirimBatch } = await import(RELAY);
  const db = buatDb();
  try {
    await isiAntrean(db, itemDasar(1, { id: 'obx-gagal' }));
    await isiAntrean(db, itemDasar(2, { id: 'obx-bebas' }));

    const p = pengirimPalsu((baris) =>
      baris.id === 'obx-gagal' ? { status: 503, pesan: 'sibuk' } : { status: 201 }
    );
    await kirimBatch({ db, now: () => T0, kirim: p.kirim });

    assert.deepEqual(p.dikirim, ['obx-gagal', 'obx-bebas']);
    const rows = await db.getAll(`SELECT id, status FROM outbox_local ORDER BY id`);
    assert.equal(rows.find((r) => r.id === 'obx-bebas').status, 'sent');
  } finally {
    db.tutup();
  }
});

// Dependensi yang sudah dipangkas (baris `sent` lama dihapus kelak) tidak
// boleh mengunci turunannya selamanya.
test('T7d dependensi yang tidak ditemukan dianggap sudah selesai', async () => {
  const { kirimBatch } = await import(RELAY);
  const db = buatDb();
  try {
    await isiAntrean(db, itemDasar(1, { id: 'obx-yatim', dependsOn: 'obx-sudah-dipangkas' }));
    const p = pengirimPalsu(() => ({ status: 201 }));
    await kirimBatch({ db, now: () => T0, kirim: p.kirim });
    assert.deepEqual(p.dikirim, ['obx-yatim']);
  } finally {
    db.tutup();
  }
});

// Dependensi yang GAGAL PERMANEN tidak boleh menahan turunannya sebagai
// `pending` selamanya -- itu antrean yang diam tanpa pernah selesai. Ia
// dikirim, dan server yang memutuskan (kemungkinan besar menolak, lalu item
// itu pun jadi `failed` dengan alasannya sendiri).
test('T7e dependensi yang failed melepas turunannya untuk dicoba', async () => {
  const { kirimBatch } = await import(RELAY);
  const db = buatDb();
  try {
    await isiAntrean(db, itemDasar(1, { entityType: 'shift', id: 'obx-shift' }));
    await isiAntrean(db, itemDasar(2, { id: 'obx-order', dependsOn: 'obx-shift' }));
    await db.execute(`UPDATE outbox_local SET status = 'failed' WHERE id = 'obx-shift'`);

    const p = pengirimPalsu(() => ({ status: 201 }));
    await kirimBatch({ db, now: () => T0, kirim: p.kirim });

    assert.deepEqual(p.dikirim, ['obx-order']);
  } finally {
    db.tutup();
  }
});

// --- T8: bertahan melewati restart ---

test('T8 item yang tertinggal `sending` dipulihkan saat mulai', async () => {
  const { pulihkanSetelahMati, kirimBatch } = await import(RELAY);
  const berkas = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lumi-h1-')), 'antrean.db');
  try {
    // Sesi pertama: item ditandai `sending` lalu aplikasi "mati".
    let db = buatDbBerkas(berkas);
    await isiAntrean(db, itemDasar(1));
    await db.execute(`UPDATE outbox_local SET status = 'sending' WHERE id = 'obx-0001'`);
    db.tutup();

    // Sesi kedua: antrean harus masih ada, dan item itu harus dapat jalan lagi.
    db = buatDbBerkas(berkas);
    const dipulihkan = await pulihkanSetelahMati(db);
    assert.equal(dipulihkan, 1);

    const [row] = await db.getAll(`SELECT status, attempts, idempotency_key FROM outbox_local`);
    assert.equal(row.status, 'pending');
    assert.equal(row.attempts, 0, 'pemulihan bukan kegagalan -- attempts tidak boleh naik');
    assert.equal(
      row.idempotency_key,
      'key-1',
      'key HARUS sama dengan sebelum mati -- itu yang membuat pemulihan ini tidak menghasilkan duplikat'
    );

    const p = pengirimPalsu(() => ({ status: 409, code: 'ID_ALREADY_EXISTS' }));
    await kirimBatch({ db, now: () => T0, kirim: p.kirim });
    const [sesudah] = await db.getAll(`SELECT status FROM outbox_local`);
    assert.equal(sesudah.status, 'sent');
    db.tutup();
  } finally {
    fs.rmSync(path.dirname(berkas), { recursive: true, force: true });
  }
});
