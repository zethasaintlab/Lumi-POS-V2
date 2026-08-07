'use strict';

// T2-T3 (docs/superpowers/plans/PLAN-void-refund-gateway.md) -- irisan
// minimal Modul E (inventory) dan Modul F (audit).
//
// Keduanya lahir kecil dan disengaja demikian. Keputusan user 1 Agu 2026
// menuntut void disertai restock otomatis dan audit; invariant #1 menuntut
// keduanya ditulis dalam transaksi yang SAMA dengan void. Modul `ordering`
// tidak boleh menyentuh `stock_movement` maupun `audit_event` langsung
// (invariant #4), jadi masing-masing dapat satu fungsi.
//
// Perhitungan stok (SUM(delta)), stocktake, oversell, RBAC, PIN, dan laporan
// audit semuanya TETAP di modul penuhnya nanti.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');

let owner, appc, base, tenant;

before(async () => {
  owner = await connectAsOwner();
  appc = await connectAsApp();
});

after(async () => {
  await resetAll(owner);
  await owner.end();
  await appc.end();
});

beforeEach(async () => {
  await resetAll(owner);
  base = await seedTenantBase(appc, { suffix: 'AuditInvTest' });
  tenant = base.tenant;
});

// Menjalankan fn di dalam transaksi yang sudah men-SET LOCAL app.tenant_id --
// prasyarat mutlak: SELECT di dalam guard baru tunduk RLS lewat client ini.
async function dalamTransaksi(tenantId, fn) {
  await appc.query('BEGIN');
  await appc.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
  try {
    const hasil = await fn(appc);
    await appc.query('COMMIT');
    return hasil;
  } catch (err) {
    await appc.query('ROLLBACK');
    throw err;
  }
}

// --- T2: audit ---

test('recordAuditEvent: menulis satu baris dengan aktor dan alasan', async () => {
  const { recordAuditEvent } = await import('../../apps/server/src/modules/audit/index.ts');
  const id = crypto.randomUUID();
  await dalamTransaksi(tenant.id, (c) =>
    recordAuditEvent(c, {
      id,
      tenantId: tenant.id,
      outletId: base.outlet.id,
      actorUserId: base.user.id,
      approverUserId: null,
      eventType: 'order.voided',
      entityType: 'order',
      entityId: 'order-1',
      reasonCode: 'salah_input',
      reasonNote: null,
      hlc: 1n,
    })
  );

  const { rows } = await dalamTransaksi(tenant.id, (c) =>
    c.query('SELECT * FROM audit_event WHERE id = $1', [id])
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].actor_user_id, base.user.id);
  assert.equal(rows[0].approver_user_id, null);
  assert.equal(rows[0].reason_code, 'salah_input');
});

// INI yang membuat audit bisa dipercaya: database sendiri menolak orang
// menyetujui tindakannya sendiri, lewat CHECK di 0011_audit.sql:23. Kalau
// hanya aplikasi yang memeriksanya, satu jalur yang lupa akan meloloskannya.
test('audit_event: penyetuju yang sama dengan aktor ditolak DATABASE, bukan aplikasi', async () => {
  const { recordAuditEvent } = await import('../../apps/server/src/modules/audit/index.ts');
  await assert.rejects(
    () => dalamTransaksi(tenant.id, (c) =>
      recordAuditEvent(c, {
        id: crypto.randomUUID(),
        tenantId: tenant.id,
        outletId: base.outlet.id,
        actorUserId: base.user.id,
        approverUserId: base.user.id, // sama dengan aktor
        eventType: 'order.refunded',
        entityType: 'order',
        entityId: 'order-1',
        reasonCode: 'barang_rusak',
        reasonNote: null,
        hlc: 1n,
      })
    ),
    (err) => err.code === '23514',
    'harus melanggar CHECK constraint, bukan lolos'
  );
});

test('recordAuditEvent: aktor lintas tenant ditolak, tidak ada baris tersimpan', async () => {
  const { recordAuditEvent } = await import('../../apps/server/src/modules/audit/index.ts');
  const lain = await seedTenantBase(appc, { suffix: 'AuditOther' });
  const id = crypto.randomUUID();

  await assert.rejects(() =>
    dalamTransaksi(tenant.id, (c) =>
      recordAuditEvent(c, {
        id,
        tenantId: tenant.id,
        outletId: base.outlet.id,
        actorUserId: lain.user.id, // milik tenant lain
        approverUserId: null,
        eventType: 'order.voided',
        entityType: 'order',
        entityId: 'order-1',
        reasonCode: 'salah_input',
        reasonNote: null,
        hlc: 1n,
      })
    )
  );

  const { rows } = await dalamTransaksi(tenant.id, (c) =>
    c.query('SELECT id FROM audit_event WHERE id = $1', [id])
  );
  assert.equal(rows.length, 0, 'tidak boleh ada baris tersimpan');
});

// --- T3: inventory ---

test('recordStockMovements: menulis satu baris per pergerakan, delta bertanda', async () => {
  const { recordStockMovements } = await import('../../apps/server/src/modules/inventory/index.ts');
  const idA = crypto.randomUUID();
  const idB = crypto.randomUUID();
  await dalamTransaksi(tenant.id, (c) =>
    recordStockMovements(c, [
      {
        id: idA, tenantId: tenant.id, outletId: base.outlet.id, deviceId: null,
        variationId: base.item_variation.id, type: 'void', delta: 2000n,
        orderId: null, reasonCode: 'salah_input', createdBy: base.user.id, hlc: 1n,
      },
      {
        id: idB, tenantId: tenant.id, outletId: base.outlet.id, deviceId: null,
        variationId: base.item_variation.id, type: 'refund', delta: 1500n,
        orderId: null, reasonCode: 'barang_rusak', createdBy: base.user.id, hlc: 2n,
      },
    ])
  );

  const { rows } = await dalamTransaksi(tenant.id, (c) =>
    c.query('SELECT id, type, delta FROM stock_movement WHERE id = ANY($1) ORDER BY delta', [[idA, idB]])
  );
  assert.equal(rows.length, 2);
  // delta x1000 bertanda (CLAUDE.md konvensi kuantitas). Void mengembalikan
  // stok, jadi POSITIF.
  assert.equal(rows[0].delta, '1500');
  assert.equal(rows[1].delta, '2000');
  assert.deepEqual(rows.map((r) => r.type).sort(), ['refund', 'void']);
});

test('recordStockMovements: variation lintas tenant ditolak, tidak ada baris tersimpan', async () => {
  const { recordStockMovements } = await import('../../apps/server/src/modules/inventory/index.ts');
  const lain = await seedTenantBase(appc, { suffix: 'InvOther' });
  const id = crypto.randomUUID();

  await assert.rejects(() =>
    dalamTransaksi(tenant.id, (c) =>
      recordStockMovements(c, [{
        id, tenantId: tenant.id, outletId: base.outlet.id, deviceId: null,
        variationId: lain.item_variation.id, // milik tenant lain
        type: 'void', delta: 1000n,
        orderId: null, reasonCode: 'salah_input', createdBy: base.user.id, hlc: 1n,
      }])
    )
  );

  const { rows } = await dalamTransaksi(tenant.id, (c) =>
    c.query('SELECT id FROM stock_movement WHERE id = $1', [id])
  );
  assert.equal(rows.length, 0);
});

// Menerima sebagian akan mencatat pergerakan stok yang separuh menunjuk data
// tenant lain -- terlihat berhasil, dan itu bentuk kegagalan yang lebih buruk
// daripada ditolak. Pola sama dengan applies_to_ids di tax_rate.
test('recordStockMovements: satu variation sah dan satu tenant lain ditolak SELURUHNYA', async () => {
  const { recordStockMovements } = await import('../../apps/server/src/modules/inventory/index.ts');
  const lain = await seedTenantBase(appc, { suffix: 'InvMixed' });
  const idSah = crypto.randomUUID();

  await assert.rejects(() =>
    dalamTransaksi(tenant.id, (c) =>
      recordStockMovements(c, [
        {
          id: idSah, tenantId: tenant.id, outletId: base.outlet.id, deviceId: null,
          variationId: base.item_variation.id, type: 'void', delta: 1000n,
          orderId: null, reasonCode: 'salah_input', createdBy: base.user.id, hlc: 1n,
        },
        {
          id: crypto.randomUUID(), tenantId: tenant.id, outletId: base.outlet.id, deviceId: null,
          variationId: lain.item_variation.id, type: 'void', delta: 1000n,
          orderId: null, reasonCode: 'salah_input', createdBy: base.user.id, hlc: 2n,
        },
      ])
    )
  );

  const { rows } = await dalamTransaksi(tenant.id, (c) =>
    c.query('SELECT id FROM stock_movement WHERE id = $1', [idSah])
  );
  assert.equal(rows.length, 0, 'yang sah pun tidak boleh tersimpan');
});

test('recordStockMovements: daftar kosong tidak melakukan apa-apa, bukan error', async () => {
  const { recordStockMovements } = await import('../../apps/server/src/modules/inventory/index.ts');
  await dalamTransaksi(tenant.id, (c) => recordStockMovements(c, []));
});
