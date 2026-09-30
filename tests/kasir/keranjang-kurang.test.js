'use strict';

// Task 5C — G-KURANG-AUDIT sisi perangkat. `kurangiBarisKeranjang` menulis
// `audit_event` lokal + outbox + keranjang_lokal hasil edit dalam SATU
// transaksi (keputusan user 28 Sep 2026, issue #76, Q2).
//
// ⛔ SQLite sungguhan (`node:sqlite`) dan `tx` OBJEK TERPISAH dari `db`:
// penulisan yang bocor keluar transaksi tercatat di `bocor` (pelajaran
// sabotase 5B: S1/S9 hijau karena `tx === db`).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const MOD = '../../apps/kasir/src/kasir/keranjang-kurang.ts';

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

const BARIS = {
  id: 'b1', variationId: 'v1', itemName: 'Kopi Susu', variationName: 'Regular',
  variationCount: 1, unitPrice: 25000, quantityMilli: 3000,
  modifier: [{ id: 'm1', nama: 'Extra shot', harga: 5000, qtyMilli: 1000 }],
};
const KERANJANG_LAMA = { baris: [BARIS], diskon: null };
const isiLama = JSON.stringify(KERANJANG_LAMA);

function buatDb({ gagalSetelAudit = false, gagalCommit = false, shiftStatus = 'open' } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(DDL);
  sqlite.prepare(`INSERT INTO cash_drawer_shift VALUES ('s1','o1','d1',?)`).run(shiftStatus);
  sqlite
    .prepare(`INSERT INTO keranjang_lokal VALUES ('kini','s1',?,'2026-09-28T00:00:00Z')`)
    .run(isiLama);
  const bocor = [];
  const baca = async (sql, params = []) => sqlite.prepare(sql).all(...params);
  const tx = {
    getAll: baca,
    async execute(sql, params = []) {
      sqlite.prepare(sql).run(...params);
      if (gagalSetelAudit && /INSERT INTO audit_event/.test(sql)) {
        throw new Error('perangkat mati di tengah transaksi');
      }
    },
    async transaction() {
      throw new Error('transaksi bersarang tidak didukung');
    },
  };
  return {
    sqlite,
    bocor,
    getAll: baca,
    async execute(sql, params = []) {
      bocor.push(sql.replace(/\s+/g, ' ').trim());
      sqlite.prepare(sql).run(...params);
    },
    async transaction(fn) {
      sqlite.exec('BEGIN');
      try {
        const hasil = await fn(tx);
        if (gagalCommit) throw new Error('perangkat mati saat COMMIT');
        sqlite.exec('COMMIT');
        return hasil;
      } catch (e) {
        sqlite.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

const n = (d, t) => d.sqlite.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
const isiKeranjang = (d) => d.sqlite.prepare(`SELECT isi FROM keranjang_lokal WHERE id = 'kini'`).get()?.isi;
const keranjangSesudah = (qty) =>
  qty === 0 ? { baris: [], diskon: null } : { baris: [{ ...BARIS, quantityMilli: qty }], diskon: null };

function args(d, over = {}) {
  let i = 0;
  const qty = over.qtySesudahMilli ?? 1000;
  return {
    db: d,
    konfig: KONFIG,
    sesi: SESI,
    shiftId: 's1',
    baris: BARIS,
    qtySesudahMilli: qty,
    keranjangBaru: keranjangSesudah(qty),
    waktu: () => new Date('2026-09-28T03:00:00Z'),
    idBaru: () => `id-${++i}`,
    hlc: () => 77n,
    ...over,
  };
}

test('⛔ G-KURANG-AUDIT: qty turun → SATU audit_event + SATU outbox + keranjang_lokal berisi hasil edit', async () => {
  const { kurangiBarisKeranjang } = await import(MOD);
  const d = buatDb();
  const hasil = await kurangiBarisKeranjang(args(d, { qtySesudahMilli: 1000 }));
  assert.equal(hasil.status, 'tercatat');
  assert.equal(n(d, 'audit_event'), 1, 'audit_event tidak tertulis untuk penurunan qty');
  assert.equal(n(d, 'outbox_local'), 1, 'outbox tidak tertulis untuk penurunan qty');
  assert.deepEqual(
    JSON.parse(isiKeranjang(d)),
    keranjangSesudah(1000),
    'keranjang_lokal tidak berisi hasil edit'
  );

  const a = d.sqlite.prepare('SELECT * FROM audit_event').get();
  assert.equal(a.id, hasil.id);
  assert.equal(a.event_type, 'cart_line_reduced');
  assert.equal(a.entity_type, 'cash_drawer_shift');
  assert.equal(a.entity_id, 's1');
  assert.equal(a.actor_user_id, 'u-sari');
  assert.equal(a.approver_user_id, null);
  assert.equal(a.tenant_id, 't1');
  assert.equal(a.outlet_id, 'o1');
  assert.equal(a.device_id, 'd1');
  assert.equal(a.occurred_at, '2026-09-28T03:00:00.000Z');
  assert.equal(a.hlc, 77);
  // Satuan = 25000 + 5000×1 (modifier ikut, `satuanKeranjang`); berkurang 2 × 30000.
  assert.deepEqual(JSON.parse(a.after), {
    variation_id: 'v1', item_name: 'Kopi Susu', variation_name: 'Regular',
    quantity_before_milli: 3000, quantity_after_milli: 1000,
    unit_price: '30000', reduced_value: '60000',
  });

  const ob = d.sqlite.prepare('SELECT * FROM outbox_local').get();
  assert.equal(ob.entity_type, 'cart_line_reduced');
  assert.equal(ob.entity_id, 's1');
  assert.equal(ob.operation, 'create');
  assert.equal(ob.actor_id, 'u-sari');
  assert.equal(ob.idempotency_key, hasil.id, 'kunci idempotensi harus sama dengan id audit');
  const p = JSON.parse(ob.payload);
  assert.deepEqual(p, {
    id: hasil.id, variationId: 'v1', itemName: 'Kopi Susu', variationName: 'Regular',
    quantityBeforeMilli: 3000, quantityAfterMilli: 1000,
    unitPrice: '30000', reducedValue: '60000',
    hlc: '77', occurredAt: '2026-09-28T03:00:00.000Z',
  });
});

test('⛔ baris dihapus (sesudah 0) → jejak dengan quantity_after_milli 0 dan keranjang_lokal dihapus', async () => {
  const { kurangiBarisKeranjang } = await import(MOD);
  const d = buatDb();
  const hasil = await kurangiBarisKeranjang(args(d, { qtySesudahMilli: 0 }));
  assert.equal(hasil.status, 'tercatat');
  const a = d.sqlite.prepare('SELECT after FROM audit_event').get();
  const after = JSON.parse(a.after);
  assert.equal(after.quantity_after_milli, 0);
  assert.equal(after.reduced_value, '90000');
  assert.equal(n(d, 'outbox_local'), 1);
  assert.equal(n(d, 'keranjang_lokal'), 0, 'keranjang kosong tetapi keranjang_lokal tertinggal');
});

test('⛔ PROPERTY: jejak ada ⇔ sesudah < sebelum; nilai = satuan × (sebelum − sesudah) / 1000', async () => {
  const { kurangiBarisKeranjang } = await import(MOD);
  for (const sebelum of [1000, 2000, 5000]) {
    for (const sesudah of [0, 1000, 2000, 5000]) {
      const d = buatDb();
      const baris = { ...BARIS, quantityMilli: sebelum };
      const hasil = await kurangiBarisKeranjang(
        args(d, { baris, qtySesudahMilli: sesudah, keranjangBaru: keranjangSesudah(sesudah) })
      );
      const label = `${sebelum} → ${sesudah}`;
      if (sesudah < sebelum) {
        assert.equal(hasil.status, 'tercatat', `${label}: turun tetapi tidak dicatat`);
        assert.equal(n(d, 'audit_event'), 1, `${label}: audit`);
        assert.equal(n(d, 'outbox_local'), 1, `${label}: outbox`);
        const after = JSON.parse(d.sqlite.prepare('SELECT after FROM audit_event').get().after);
        assert.equal(after.reduced_value, ((30000n * BigInt(sebelum - sesudah)) / 1000n).toString(), label);
      } else {
        assert.equal(hasil.status, 'tanpa_pengurangan', `${label}: tidak turun tetapi dicatat`);
        assert.equal(n(d, 'audit_event'), 0, `${label}: audit tertulis padahal qty tidak turun`);
        assert.equal(n(d, 'outbox_local'), 0, `${label}: outbox tertulis padahal qty tidak turun`);
        assert.equal(isiKeranjang(d), isiLama, `${label}: tanpa pengurangan tidak boleh menyentuh keranjang_lokal`);
      }
    }
  }
});

test('⛔ naik qty / ganti modifier tanpa penurunan → nol jejak, nol outbox, tidak menulis apa pun', async () => {
  const { kurangiBarisKeranjang } = await import(MOD);
  const d = buatDb();
  // Naik.
  assert.equal((await kurangiBarisKeranjang(args(d, { qtySesudahMilli: 4000 }))).status, 'tanpa_pengurangan');
  // Sama (hanya modifier berubah, atau penggabungan `gantiModifier`).
  assert.equal((await kurangiBarisKeranjang(args(d, { qtySesudahMilli: 3000 }))).status, 'tanpa_pengurangan');
  assert.equal(n(d, 'audit_event'), 0);
  assert.equal(n(d, 'outbox_local'), 0);
  assert.deepEqual(d.bocor, [], 'menulis sesuatu padahal tidak ada penurunan');
});

test('⛔ perangkat mati di tengah: transaksi gagal → nol jejak, nol outbox, keranjang_lokal UTUH', async () => {
  const { kurangiBarisKeranjang } = await import(MOD);
  const d = buatDb({ gagalSetelAudit: true });
  await assert.rejects(() => kurangiBarisKeranjang(args(d)), /perangkat mati/);
  assert.equal(n(d, 'audit_event'), 0, 'audit tertinggal padahal transaksi gagal');
  assert.equal(n(d, 'outbox_local'), 0);
  assert.equal(isiKeranjang(d), isiLama, 'keranjang_lokal berubah padahal transaksi gagal');
});

test('⛔ perangkat mati SAAT COMMIT: nol audit, nol outbox, keranjang_lokal utuh, HLC tidak maju, nol penulisan bocor', async () => {
  const { kurangiBarisKeranjang } = await import(MOD);
  const d = buatDb({ gagalCommit: true });
  await assert.rejects(() => kurangiBarisKeranjang(args(d, { hlc: () => 4242n })), /saat COMMIT/);
  assert.equal(n(d, 'audit_event'), 0, 'audit tertinggal padahal COMMIT gagal');
  assert.equal(n(d, 'outbox_local'), 0, 'outbox tertinggal padahal COMMIT gagal');
  assert.equal(isiKeranjang(d), isiLama, 'keranjang_lokal berubah padahal COMMIT gagal — penulisan bocor keluar transaksi');
  assert.equal(
    d.sqlite.prepare('SELECT hlc_teks FROM device_config WHERE id = 1').get().hlc_teks,
    '0',
    'HLC maju padahal COMMIT gagal — simpanHlc bocor keluar transaksi'
  );
  assert.deepEqual(d.bocor, [], `penulisan bocor keluar transaksi: ${JSON.stringify(d.bocor)}`);
});

test('⛔ SEMUA penulisan lewat tx: nol penulisan di luar transaksi (keranjang_lokal, simpanHlc, audit, outbox)', async () => {
  const { kurangiBarisKeranjang } = await import(MOD);
  const d = buatDb();
  await kurangiBarisKeranjang(args(d));
  assert.deepEqual(
    d.bocor,
    [],
    `penulisan bocor KELUAR transaksi lewat db (bukan tx): ${JSON.stringify(d.bocor)} — keranjang/HLC tidak lagi atomik dengan jejaknya`
  );
  assert.equal(
    d.sqlite.prepare('SELECT hlc_teks FROM device_config WHERE id = 1').get().hlc_teks,
    '77',
    'HLC perangkat tidak ditulis di transaksi'
  );
});

test('shift tidak terbuka → shift_tidak_terbuka, nol baris, keranjang_lokal utuh', async () => {
  const { kurangiBarisKeranjang } = await import(MOD);
  for (const status of ['closed']) {
    const d = buatDb({ shiftStatus: status });
    const hasil = await kurangiBarisKeranjang(args(d));
    assert.equal(hasil.status, 'shift_tidak_terbuka');
    assert.equal(n(d, 'audit_event'), 0);
    assert.equal(n(d, 'outbox_local'), 0);
    assert.equal(isiKeranjang(d), isiLama);
  }
  // Shift yang tidak ada sama sekali.
  const d = buatDb();
  const hasil = await kurangiBarisKeranjang(args(d, { shiftId: 'tidak-ada' }));
  assert.equal(hasil.status, 'shift_tidak_terbuka');
  assert.equal(n(d, 'audit_event'), 0);
});

test('⛔ TIDAK menulis order, payment, cash_movement', async () => {
  const { kurangiBarisKeranjang } = await import(MOD);
  const d = buatDb();
  await kurangiBarisKeranjang(args(d));
  assert.equal(n(d, '"order"'), 0);
  assert.equal(n(d, 'payment'), 0);
  assert.equal(n(d, 'cash_movement'), 0);
});

test('⛔ keranjang berdiskon (bigint) tetap tersimpan di transaksi yang sama — tidak melempar', async () => {
  const { kurangiBarisKeranjang } = await import(MOD);
  const d = buatDb();
  const diskon = {
    minta: { tipe: 'nominal', nilai: 10000n }, alasanKode: 'x', alasanCatatan: null,
    approverId: null, nominalDisetujui: null,
  };
  const baru = { ...keranjangSesudah(1000), diskon };
  const hasil = await kurangiBarisKeranjang(args(d, { keranjangBaru: baru }));
  assert.equal(hasil.status, 'tercatat');
  assert.equal(JSON.parse(isiKeranjang(d)).diskon.minta.nilai, '10000');
});
