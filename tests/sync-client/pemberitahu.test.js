'use strict';

// Pemberitahu perubahan antrean.
//
// ⛔ Ada karena angka: `watch()` PowerSync memberi tahu perubahan pada raw
// table kami dalam ~1.000 ms (diukur 8 Agustus 2026 di
// `apps/kasir/harness.html` -- 997/1013/1004/1004/998 ms lewat `execute`,
// 1014/1001/1013/999 ms lewat `writeTransaction`; `throttleMs` tidak
// mengubahnya). `spec-h:224` menuntut indikator diperbarui **< 1 detik**.
//
// Yang lewat sini hanya ISYARAT baca-ulang. Datanya tetap dibaca dari SQLite,
// jadi keputusan §3.3 (database lokal ADALAH state-nya) tidak dilanggar.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buatDb } = require('./helpers/db');

const PEMBERITAHU = '../../packages/sync-client/src/pemberitahu.ts';
const PENJADWAL = '../../packages/sync-client/src/penjadwal.ts';
const ENQUEUE = '../../packages/sync-client/src/enqueue.ts';

const T0 = Date.parse('2026-08-08T10:00:00.000Z');

test('pelanggan menerima pemberitahuan, dan berhenti setelah dilepas', async () => {
  const { buatPemberitahu } = await import(PEMBERITAHU);
  const p = buatPemberitahu();
  let a = 0;
  let b = 0;

  const lepasA = p.langgan(() => (a += 1));
  p.langgan(() => (b += 1));
  assert.equal(p.jumlahPelanggan, 2);

  p.beritahu();
  assert.deepEqual([a, b], [1, 1]);

  lepasA();
  p.beritahu();
  assert.deepEqual([a, b], [1, 2]);
  assert.equal(p.jumlahPelanggan, 1);
});

// Pola biasa di React: efek yang dilepas saat komponen unmount, dan unmount
// itu terjadi sebagai reaksi terhadap pemberitahuan. Tanpa penyalinan, Set
// yang sedang diiterasi berubah di tengah.
test('berhenti berlangganan DI DALAM callback tidak merusak iterasi', async () => {
  const { buatPemberitahu } = await import(PEMBERITAHU);
  const p = buatPemberitahu();
  const terpanggil = [];

  const lepas = p.langgan(() => {
    terpanggil.push('a');
    lepas();
  });
  p.langgan(() => terpanggil.push('b'));

  p.beritahu();
  assert.deepEqual(terpanggil, ['a', 'b']);

  p.beritahu();
  assert.deepEqual(terpanggil, ['a', 'b', 'b']);
});

// Yang di ujung sana adalah indikator sinkronisasi. Kegagalan menggambar
// indikator tidak boleh ikut menjatuhkan penjadwal yang memanggilnya --
// itu akan menghentikan pengiriman penjualan karena sebuah label.
test('pelanggan yang melempar tidak menghalangi pelanggan lain', async () => {
  const { buatPemberitahu } = await import(PEMBERITAHU);
  const p = buatPemberitahu();
  let sesudah = 0;

  p.langgan(() => {
    throw new Error('render gagal');
  });
  p.langgan(() => (sesudah += 1));

  p.beritahu();
  assert.equal(sesudah, 1);
});

test('penjadwal memberi tahu setiap putaran selesai', async () => {
  const { buatPemberitahu } = await import(PEMBERITAHU);
  const { buatPenjadwal } = await import(PENJADWAL);
  const { enqueue } = await import(ENQUEUE);
  const db = buatDb();

  try {
    await db.transaction(async (tx) => {
      await enqueue(tx, {
        id: 'obx-1',
        entityType: 'order',
        entityId: 'ent-1',
        operation: 'create',
        payload: {},
        idempotencyKey: 'key-1',
        createdAt: new Date(T0).toISOString(),
      });
    });

    const p = buatPemberitahu();
    let diberitahu = 0;
    p.langgan(() => (diberitahu += 1));

    const penjadwal = buatPenjadwal({
      db,
      now: () => T0 + 1000,
      kirim: async () => ({ status: 201 }),
      setTimer: () => 0,
      clearTimer: () => {},
      pemberitahu: p,
    });

    await penjadwal.mulai();
    assert.equal(diberitahu, 1, 'penjadwal tidak memberi tahu setelah putaran');
    penjadwal.berhenti();
  } finally {
    db.tutup();
  }
});

// Putaran yang gagal di tengah TETAP mungkin sudah memindahkan sebagian item.
// Indikator yang tidak diberi tahu akan menampilkan angka lama sampai putaran
// berikutnya -- dan pada antrean yang macet, itu bisa lama sekali.
test('penjadwal tetap memberi tahu meski putaran melempar', async () => {
  const { buatPemberitahu } = await import(PEMBERITAHU);
  const { buatPenjadwal } = await import(PENJADWAL);
  const { enqueue } = await import(ENQUEUE);
  const db = buatDb();

  try {
    await db.transaction(async (tx) => {
      await enqueue(tx, {
        id: 'obx-1',
        entityType: 'order',
        entityId: 'ent-1',
        operation: 'create',
        payload: {},
        idempotencyKey: 'key-1',
        createdAt: new Date(T0).toISOString(),
      });
    });

    const p = buatPemberitahu();
    let diberitahu = 0;
    p.langgan(() => (diberitahu += 1));

    const dbRapuh = {
      ...db,
      execute: async (sql, params) => {
        if (sql.includes(`status = 'sending'`)) throw new Error('database terkunci');
        return db.execute(sql, params);
      },
    };

    const penjadwal = buatPenjadwal({
      db: dbRapuh,
      now: () => T0 + 1000,
      kirim: async () => ({ status: 201 }),
      setTimer: () => 0,
      clearTimer: () => {},
      onGalat: () => {},
      pemberitahu: p,
    });

    await penjadwal.mulai();
    assert.equal(diberitahu, 1);
    penjadwal.berhenti();
  } finally {
    db.tutup();
  }
});

// Penjadwal tanpa pemberitahu harus tetap jalan -- ia opsional, dan test lama
// memanggilnya tanpa itu.
test('pemberitahu opsional: penjadwal tanpa itu tetap berjalan', async () => {
  const { buatPenjadwal } = await import(PENJADWAL);
  const db = buatDb();
  try {
    const penjadwal = buatPenjadwal({
      db,
      now: () => T0,
      kirim: async () => ({ status: 201 }),
      setTimer: () => 0,
      clearTimer: () => {},
    });
    await penjadwal.mulai();
    assert.equal(penjadwal.putaranSelesai, 1);
    penjadwal.berhenti();
  } finally {
    db.tutup();
  }
});
