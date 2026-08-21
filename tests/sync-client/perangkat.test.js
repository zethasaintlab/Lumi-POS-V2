'use strict';

// Identitas perangkat di sisi klien.
//
// Ia yang membuka tiga hal sekaligus: pengirim REST tahu ke mana dan atas
// nama tenant siapa, penjadwal relay boleh menyala, dan PowerSync punya
// sesuatu untuk ditukar jadi token.
//
// Modul murni: seluruh I/O lewat port `DbLokal`, jadi ia diuji di node
// terhadap skema lokal SUNGGUHAN.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buatDb, buatDbBerkas } = require('./helpers/db');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const PERANGKAT = '../../packages/sync-client/src/perangkat.ts';

const KONFIG = {
  deviceId: 'dev-1',
  deviceCode: 'K1',
  tenantId: 'ten-1',
  outletId: 'out-1',
  baseUrl: 'http://server.lokal',
  tokenSecret: 'rahasia-perangkat',
};

test('perangkat baru: belum ada konfigurasi', async () => {
  const { bacaKonfigPerangkat } = await import(PERANGKAT);
  const db = buatDb();
  try {
    assert.equal(await bacaKonfigPerangkat(db), null);
  } finally {
    db.tutup();
  }
});

test('konfigurasi disimpan lalu dibaca kembali utuh', async () => {
  const { bacaKonfigPerangkat, simpanKonfigPerangkat } = await import(PERANGKAT);
  const db = buatDb();
  try {
    await simpanKonfigPerangkat(db, KONFIG);
    assert.deepEqual(await bacaKonfigPerangkat(db), KONFIG);
  } finally {
    db.tutup();
  }
});

// Satu pemasangan aplikasi adalah satu perangkat. Baris kedua akan membuat
// "perangkat ini" jadi pertanyaan yang punya dua jawaban.
test('menyimpan ulang MENGGANTI, tidak menambah baris kedua', async () => {
  const { bacaKonfigPerangkat, simpanKonfigPerangkat } = await import(PERANGKAT);
  const db = buatDb();
  try {
    await simpanKonfigPerangkat(db, KONFIG);
    await simpanKonfigPerangkat(db, { ...KONFIG, deviceCode: 'K2', tokenSecret: 'baru' });

    const [{ n }] = await db.getAll('SELECT count(*) AS n FROM device_config');
    assert.equal(n, 1);
    const konfig = await bacaKonfigPerangkat(db);
    assert.equal(konfig.deviceCode, 'K2');
    assert.equal(konfig.tokenSecret, 'baru');
  } finally {
    db.tutup();
  }
});

// Counter nomor struk hidup di baris yang sama (`CLAUDE.md`: counter LOKAL,
// tidak pernah minta ke server). Menyimpan ulang identitas TIDAK BOLEH
// mengulang nomor struk dari nol -- itu langsung melanggar I4.
test('menyimpan ulang identitas tidak mereset counter nomor struk', async () => {
  const { simpanKonfigPerangkat } = await import(PERANGKAT);
  const db = buatDb();
  try {
    await simpanKonfigPerangkat(db, KONFIG);
    await db.execute(
      `UPDATE device_config SET receipt_sequence = 42, sequence_business_date = '20260808'`
    );
    await simpanKonfigPerangkat(db, { ...KONFIG, baseUrl: 'http://server.baru' });

    const [baris] = await db.getAll(
      'SELECT receipt_sequence, sequence_business_date, base_url FROM device_config'
    );
    assert.equal(baris.receipt_sequence, 42, 'counter nomor struk direset -- I4 langsung dilanggar');
    assert.equal(baris.sequence_business_date, '20260808');
    assert.equal(baris.base_url, 'http://server.baru');
  } finally {
    db.tutup();
  }
});

test('konfigurasi bertahan melewati restart aplikasi', async () => {
  const { bacaKonfigPerangkat, simpanKonfigPerangkat } = await import(PERANGKAT);
  const berkas = path.join(os.tmpdir(), `lumi-perangkat-${process.pid}-${Date.now()}.db`);
  try {
    const a = buatDbBerkas(berkas);
    await simpanKonfigPerangkat(a, KONFIG);
    a.tutup();

    const b = buatDbBerkas(berkas);
    assert.deepEqual(await bacaKonfigPerangkat(b), KONFIG);
    b.tutup();
  } finally {
    for (const s of ['', '-wal', '-shm']) fs.rmSync(berkas + s, { force: true });
  }
});

// Kredensial dicabut dari dashboard: perangkat kehilangan secret-nya tapi
// TETAP tahu siapa dirinya, supaya layar provisioning dapat menampilkan
// identitas yang benar alih-alih meminta semuanya diketik ulang.
test('secret dapat dihapus tanpa membuang identitas perangkat', async () => {
  const { bacaKonfigPerangkat, simpanKonfigPerangkat, hapusSecret } = await import(PERANGKAT);
  const db = buatDb();
  try {
    await simpanKonfigPerangkat(db, KONFIG);
    await hapusSecret(db);
    const konfig = await bacaKonfigPerangkat(db);
    assert.equal(konfig.tokenSecret, null);
    assert.equal(konfig.deviceId, KONFIG.deviceId);
  } finally {
    db.tutup();
  }
});

// --- kesiapan: apa yang boleh menyala, dan kapan --------------------------

test('siapKirim hanya benar bila identitas DAN secret lengkap', async () => {
  const { siapKirim } = await import(PERANGKAT);
  assert.equal(siapKirim(null), false);
  assert.equal(siapKirim({ ...KONFIG, tokenSecret: null }), false);
  assert.equal(siapKirim({ ...KONFIG, baseUrl: '' }), false);
  assert.equal(siapKirim({ ...KONFIG, tenantId: '' }), false);
  assert.equal(siapKirim(KONFIG), true);
});

// --- aktor per-baris -------------------------------------------------------
//
// ⛔ Antrean yang terkuras berjam-jam kemudian harus menisbatkan tiap item ke
// kasir yang MEMBUATNYA, bukan ke siapa pun yang sedang masuk saat relay
// jalan. `buatPengirimHttp` sebelumnya menerima satu `actorId` saat dibuat --
// artinya penjualan Sari yang naik saat Budi sedang bertugas akan tercatat
// atas nama Budi di `X-Actor-Id`.

test('pengirim memakai actor_id BARIS, bukan aktor saat pengiriman', async () => {
  const { buatPengirimHttp } = await import('../../packages/sync-client/src/http.ts');
  const panggilan = [];
  const kirim = buatPengirimHttp({
    baseUrl: 'http://server.lokal',
    tenantId: 'ten-1',
    actorId: 'usr-budi',
    fetchFn: async (url, opsi) => {
      panggilan.push(opsi.headers['X-Actor-Id']);
      return { status: 201, json: async () => ({}) };
    },
  });

  await kirim({
    id: 'obx-1',
    entity_type: 'order',
    entity_id: 'ord-1',
    operation: 'create',
    payload: '{}',
    idempotency_key: 'k1',
    status: 'pending',
    attempts: 0,
    last_error: null,
    last_attempt_at: null,
    created_at: '2026-08-08T10:00:00.000Z',
    depends_on: null,
    actor_id: 'usr-sari',
  });

  assert.deepEqual(panggilan, ['usr-sari'], 'penjualan tercatat atas nama aktor yang salah');
});

test('baris tanpa actor_id jatuh ke aktor konfigurasi', async () => {
  const { buatPengirimHttp } = await import('../../packages/sync-client/src/http.ts');
  const panggilan = [];
  const kirim = buatPengirimHttp({
    baseUrl: 'http://server.lokal',
    tenantId: 'ten-1',
    actorId: 'usr-cadangan',
    fetchFn: async (url, opsi) => {
      panggilan.push(opsi.headers['X-Actor-Id']);
      return { status: 201, json: async () => ({}) };
    },
  });

  await kirim({
    id: 'obx-2',
    entity_type: 'order',
    entity_id: 'ord-2',
    operation: 'create',
    payload: '{}',
    idempotency_key: 'k2',
    status: 'pending',
    attempts: 0,
    last_error: null,
    last_attempt_at: null,
    created_at: '2026-08-08T10:00:00.000Z',
    depends_on: null,
    actor_id: null,
  });

  assert.deepEqual(panggilan, ['usr-cadangan']);
});

test('enqueue menyimpan actor_id saat item DIBUAT', async () => {
  const { enqueue } = await import('../../packages/sync-client/src/enqueue.ts');
  const db = buatDb();
  try {
    await db.transaction(async (tx) => {
      await enqueue(tx, {
        id: 'obx-1',
        entityType: 'order',
        entityId: 'ord-1',
        operation: 'create',
        payload: {},
        idempotencyKey: 'k1',
        createdAt: '2026-08-08T10:00:00.000Z',
        actorId: 'usr-sari',
      });
    });
    const [baris] = await db.getAll('SELECT actor_id FROM outbox_local');
    assert.equal(baris.actor_id, 'usr-sari');
  } finally {
    db.tutup();
  }
});

test('⛔ enqueue menyimpan approver_id — tanpanya refund offline berhenti permanen', async () => {
  const { enqueue } = await import('../../packages/sync-client/src/enqueue.ts');
  const db = buatDb();
  try {
    await db.transaction(async (tx) => {
      await enqueue(tx, {
        id: 'obx-2',
        entityType: 'order_cancel',
        entityId: 'ord-2',
        operation: 'cancel',
        payload: {},
        idempotencyKey: 'k2',
        createdAt: '2026-08-21T10:00:00.000Z',
        actorId: 'usr-sari',
        approverId: 'usr-budi',
      });
    });
    // Dibekukan bersama itemnya, alasan yang sama dengan `actor_id`: antrean
    // dapat terkuras setelah pergantian shift, dan manajer yang menyetujui
    // refund sore ini bukan manajer yang sedang masuk besok pagi.
    const [baris] = await db.getAll('SELECT actor_id, approver_id FROM outbox_local');
    assert.equal(baris.approver_id, 'usr-budi');
    assert.notEqual(baris.approver_id, baris.actor_id);
  } finally {
    db.tutup();
  }
});

test('item tanpa penyetuju menyimpan NULL, bukan string kosong', async () => {
  const { enqueue } = await import('../../packages/sync-client/src/enqueue.ts');
  const db = buatDb();
  try {
    await db.transaction(async (tx) => {
      await enqueue(tx, {
        id: 'obx-3',
        entityType: 'order',
        entityId: 'ord-3',
        operation: 'create',
        payload: {},
        idempotencyKey: 'k3',
        createdAt: '2026-08-21T10:00:00.000Z',
        actorId: 'usr-sari',
      });
    });
    // String kosong akan membuat relay MENGIRIM header kosong, dan
    // `getApproverId` menolaknya dengan pesan yang sama persis dengan header
    // yang hilang — kegagalan yang berpindah tempat tanpa berubah.
    const [baris] = await db.getAll('SELECT approver_id FROM outbox_local');
    assert.equal(baris.approver_id, null);
  } finally {
    db.tutup();
  }
});
