'use strict';

// Task 5B — G-BATAL-AUDIT sisi perangkat. `batalkanKeranjang` menulis
// `audit_event` lokal + outbox + hapus `keranjang_lokal` dalam SATU transaksi.
//
// ⛔ Di atas SQLite sungguhan (`node:sqlite`): "perangkat mati di tengah"
// hanya bermakna bila ROLLBACK-nya sungguhan — fake tidak me-rollback apa pun.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const MOD = '../../apps/kasir/src/kasir/keranjang-batal.ts';

const DDL = `
CREATE TABLE keranjang_lokal (
  id TEXT PRIMARY KEY NOT NULL, shift_id TEXT NOT NULL, isi TEXT NOT NULL, diperbarui_pada TEXT NOT NULL
);
CREATE TABLE cash_drawer_shift (
  id TEXT PRIMARY KEY, outlet_id TEXT, device_id TEXT, status TEXT
);
CREATE TABLE audit_event (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, outlet_id TEXT, device_id TEXT,
  actor_user_id TEXT NOT NULL, approver_user_id TEXT,
  event_type TEXT NOT NULL, entity_type TEXT, entity_id TEXT,
  before TEXT, after TEXT, reason_code TEXT, reason_note TEXT,
  occurred_at TEXT NOT NULL, recorded_at TEXT, hlc INTEGER NOT NULL
);
CREATE TABLE outbox_local (
  id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  operation TEXT NOT NULL, payload TEXT NOT NULL, idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER DEFAULT 0,
  last_error TEXT, last_attempt_at TEXT, created_at TEXT NOT NULL,
  depends_on TEXT, actor_id TEXT, approver_id TEXT
);
CREATE TABLE device_config (id INTEGER PRIMARY KEY, hlc_teks TEXT, hlc_state INTEGER);
CREATE TABLE "order" (id TEXT PRIMARY KEY);
CREATE TABLE payment (id TEXT PRIMARY KEY);
CREATE TABLE cash_movement (id TEXT PRIMARY KEY);
INSERT INTO device_config (id, hlc_teks, hlc_state) VALUES (1, '0', 0);
`;

const KONFIG = {
  deviceId: 'd1', deviceCode: 'K1', tenantId: 't1', outletId: 'o1',
  baseUrl: 'http://server', tokenSecret: 'rahasia',
};
const SESI = { userId: 'u-sari', nama: 'Sari', peran: ['cashier'], masukPada: '', wajibGantiPin: false };

function buatDb({ gagalSetelAudit = false, shiftStatus = 'open', denganKeranjang = true } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(DDL);
  sqlite.prepare(`INSERT INTO cash_drawer_shift VALUES ('s1','o1','d1',?)`).run(shiftStatus);
  if (denganKeranjang) {
    sqlite
      .prepare(`INSERT INTO keranjang_lokal VALUES ('kini','s1','{}','2026-09-28T00:00:00Z')`)
      .run();
  }
  const api = {
    sqlite,
    async getAll(sql, params = []) {
      return sqlite.prepare(sql).all(...params);
    },
    async execute(sql, params = []) {
      sqlite.prepare(sql).run(...params);
      // Perangkat "mati" tepat sesudah audit tertulis, sebelum langkah lain.
      if (gagalSetelAudit && /INSERT INTO audit_event/.test(sql)) {
        throw new Error('perangkat mati di tengah transaksi');
      }
    },
    async transaction(fn) {
      sqlite.exec('BEGIN');
      try {
        const hasil = await fn(api);
        sqlite.exec('COMMIT');
        return hasil;
      } catch (e) {
        sqlite.exec('ROLLBACK');
        throw e;
      }
    },
  };
  return api;
}

const n = (d, t) => d.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
const KERANJANG = {
  baris: [
    { id: 'b1', quantityMilli: 2000 },
    { id: 'b2', quantityMilli: 1000 },
  ],
  diskon: null,
};

function args(d, over = {}) {
  let i = 0;
  return {
    db: d,
    konfig: KONFIG,
    sesi: SESI,
    shiftId: 's1',
    keranjang: KERANJANG,
    total: 61050n,
    waktu: () => new Date('2026-09-28T03:00:00Z'),
    idBaru: () => `id-${++i}`,
    hlc: () => 77n,
    ...over,
  };
}

test('⛔ G-BATAL-AUDIT: satu transaksi — audit_event, outbox, dan hapus keranjang_lokal', async () => {
  const { batalkanKeranjang } = await import(MOD);
  const d = buatDb();
  assert.equal(n(d, 'keranjang_lokal'), 1);
  assert.equal(n(d, 'audit_event'), 0);
  assert.equal(n(d, 'outbox_local'), 0);

  const hasil = await batalkanKeranjang(args(d));
  assert.equal(hasil.status, 'tercatat');
  assert.equal(n(d, 'keranjang_lokal'), 0, 'keranjang_lokal tidak terhapus');
  assert.equal(n(d, 'audit_event'), 1, 'audit_event tidak tertulis');
  assert.equal(n(d, 'outbox_local'), 1, 'outbox tidak tertulis');

  const ob = d.sqlite.prepare('SELECT * FROM outbox_local').get();
  assert.equal(ob.entity_type, 'cart_cleared');
  assert.equal(ob.entity_id, 's1');
  assert.equal(ob.actor_id, 'u-sari');
  assert.equal(ob.idempotency_key, hasil.id, 'kunci idempotensi harus sama dengan id audit');
});

test('⛔ audit membawa aktor, line_count, quantity_milli, total = total yang diberikan, occurred_at, hlc', async () => {
  const { batalkanKeranjang } = await import(MOD);
  const d = buatDb();
  const hasil = await batalkanKeranjang(args(d));
  const a = d.sqlite.prepare('SELECT * FROM audit_event').get();
  assert.equal(a.id, hasil.id);
  assert.equal(a.event_type, 'cart_cleared');
  assert.equal(a.entity_type, 'cash_drawer_shift');
  assert.equal(a.entity_id, 's1');
  assert.equal(a.actor_user_id, 'u-sari');
  assert.equal(a.approver_user_id, null);
  assert.equal(a.tenant_id, 't1');
  assert.equal(a.outlet_id, 'o1');
  assert.equal(a.device_id, 'd1');
  assert.equal(a.occurred_at, '2026-09-28T03:00:00.000Z');
  assert.equal(a.hlc, 77);
  assert.deepEqual(JSON.parse(a.after), { line_count: 2, quantity_milli: 3000, total: '61050' });

  const p = JSON.parse(d.sqlite.prepare('SELECT payload FROM outbox_local').get().payload);
  assert.equal(p.id, hasil.id);
  assert.equal(p.lineCount, 2);
  assert.equal(p.quantityMilli, 3000);
  assert.equal(p.total, '61050');
  assert.equal(p.occurredAt, '2026-09-28T03:00:00.000Z');
  assert.equal(p.hlc, '77');
});

test('⛔ perangkat mati di tengah: transaksi gagal → keranjang_lokal UTUH dan nol audit', async () => {
  const { batalkanKeranjang } = await import(MOD);
  const d = buatDb({ gagalSetelAudit: true });
  await assert.rejects(() => batalkanKeranjang(args(d)), /perangkat mati/);
  assert.equal(n(d, 'keranjang_lokal'), 1, 'keranjang hilang tanpa jejak');
  assert.equal(n(d, 'audit_event'), 0, 'audit tertinggal padahal transaksi gagal');
  assert.equal(n(d, 'outbox_local'), 0);
});

test('keranjang kosong → keranjang_kosong, nol baris', async () => {
  const { batalkanKeranjang } = await import(MOD);
  const d = buatDb();
  const hasil = await batalkanKeranjang(args(d, { keranjang: { baris: [], diskon: null }, total: 0n }));
  assert.equal(hasil.status, 'keranjang_kosong');
  assert.equal(n(d, 'audit_event'), 0);
  assert.equal(n(d, 'outbox_local'), 0);
  assert.equal(n(d, 'keranjang_lokal'), 1, 'tidak boleh menyentuh keranjang_lokal');
});

test('shift tertutup → shift_tidak_terbuka, nol baris', async () => {
  const { batalkanKeranjang } = await import(MOD);
  const d = buatDb({ shiftStatus: 'closed' });
  const hasil = await batalkanKeranjang(args(d));
  assert.equal(hasil.status, 'shift_tidak_terbuka');
  assert.equal(n(d, 'audit_event'), 0);
  assert.equal(n(d, 'outbox_local'), 0);
  assert.equal(n(d, 'keranjang_lokal'), 1);
});

test('⛔ TIDAK menulis order, payment, cash_movement', async () => {
  const { batalkanKeranjang } = await import(MOD);
  const d = buatDb();
  await batalkanKeranjang(args(d));
  assert.equal(n(d, '"order"'), 0);
  assert.equal(n(d, 'payment'), 0);
  assert.equal(n(d, 'cash_movement'), 0);
});
