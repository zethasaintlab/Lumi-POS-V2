'use strict';

// Single source of truth for the 33 RLS-protected tables (ERD §3–§13) driving
// the data-driven cross-tenant CRUD test, plus the 2 tables intentionally
// exempt from RLS (proven exempt-on-purpose, not missed, by roles-and-force-rls.test.js).
//
// whereForRow(row)        -> { clause, params } identifying exactly one row (default: by `id`).
// buildImpersonationRow   -> given tenant A's real row (+ its whole fixture set, for tables that
//                             need a spare FK target), returns column values for a *new* row that
//                             still declares tenant_id = tenant A, but has a fresh primary key so
//                             an INSERT attempt fails because of RLS, not an incidental PK collision.

const byId = (row) => ({ clause: 'id = $1', params: [row.id] });
const cloneWithFreshId = (row, freshId) => ({ ...row, id: freshId() });

const TABLES = [
  { name: 'outlet', module: 'tenancy', partitioned: false },
  { name: 'vertical_profile', module: 'tenancy', partitioned: false },
  { name: 'role', module: 'identity', partitioned: false },
  { name: 'user', module: 'identity', partitioned: false },
  { name: 'user_role', module: 'identity', partitioned: false },
  // Migrasi 0019. Ia memikul batas yang `spec-f:81` tuntut ditegakkan "di
  // lapisan query bukan UI", dan ia yang menentukan hash PIN siapa yang turun
  // ke perangkat outlet mana — kebocoran di sini mengirim kredensial staf
  // merchant lain ke perangkat yang salah.
  { name: 'user_outlet', module: 'identity', partitioned: false },
  { name: 'device', module: 'identity', partitioned: false },
  { name: 'category', module: 'catalog', partitioned: false },
  { name: 'item', module: 'catalog', partitioned: false },
  { name: 'item_variation', module: 'catalog', partitioned: false },
  { name: 'modifier_list', module: 'catalog', partitioned: false },
  { name: 'modifier', module: 'catalog', partitioned: false },
  {
    name: 'item_modifier_list',
    module: 'catalog',
    partitioned: false,
    // `whereForRow` kembali ke jalur generik (`id = $1`) sejak migrasi 0018:
    // tabel ini kini punya surrogate id, dituntut PowerSync untuk raw table.
    //
    // `buildImpersonationRow` TETAP khusus, dan alasannya berubah. Dulu:
    // "tidak ada surrogate id, jadi PK komposit akan bentrok". Sekarang id
    // barunya memang segar, tapi 0018 memindahkan jaminan pasangan unik ke
    // `ux_item_modifier_list_pair` -- dan baris kloningan membawa pasangan
    // (item_id, modifier_list_id) YANG SAMA.
    //
    // Diuji langsung sebelum baris ini ditulis: pada PostgreSQL 17, kebijakan
    // RLS menolak LEBIH DULU ("new row violates row-level security policy"),
    // bukan constraint uniknya -- jadi jalur generik pun tidak akan membuat
    // test ini hampa hari ini. `item2` dipertahankan karena urutan itu bukan
    // jaminan yang didokumentasikan PostgreSQL; menggantungkan uji isolasi
    // padanya berarti uji ini bisa berubah jadi hampa tanpa satu baris pun
    // diubah. Pasangan yang berbeda membuat RLS satu-satunya yang mungkin
    // menolak.
    buildImpersonationRow: (row, seededRows, freshId) => ({
      ...row,
      id: freshId(),
      item_id: seededRows.item2.id,
    }),
  },
  { name: 'price_history', module: 'catalog', partitioned: false },
  { name: 'tax_rate', module: 'payment', partitioned: false },
  { name: 'cash_drawer_shift', module: 'cash', partitioned: false },
  { name: 'order', module: 'ordering', partitioned: false },
  { name: 'check', module: 'ordering', partitioned: false },
  { name: 'order_line', module: 'ordering', partitioned: true },
  { name: 'order_line_modifier', module: 'ordering', partitioned: false },
  { name: 'refund', module: 'ordering', partitioned: false },
  { name: 'payment', module: 'payment', partitioned: true },
  { name: 'cash_movement', module: 'cash', partitioned: false },
  { name: 'stocktake', module: 'inventory', partitioned: false },
  { name: 'stocktake_line', module: 'inventory', partitioned: false },
  { name: 'stock_movement', module: 'inventory', partitioned: true },
  { name: 'sold_out_flag', module: 'inventory', partitioned: false },
  {
    name: 'stock_snapshot',
    module: 'inventory',
    partitioned: false,
    whereForRow: (row) => ({
      clause: 'tenant_id = $1 AND outlet_id = $2 AND variation_id = $3',
      params: [row.tenant_id, row.outlet_id, row.variation_id],
    }),
    buildImpersonationRow: (row, _seededRows, freshId) => ({ ...row, variation_id: freshId() }),
  },
  { name: 'audit_event', module: 'audit', partitioned: true },
  { name: 'peripheral', module: 'peripheral', partitioned: false },
  { name: 'print_job', module: 'peripheral', partitioned: false },
  {
    name: 'idempotency_key',
    module: 'sync',
    partitioned: false,
    whereForRow: (row) => ({ clause: 'key = $1', params: [row.key] }),
    buildImpersonationRow: (row, _seededRows, freshId) => ({ ...row, key: freshId() }),
  },
  { name: 'outbox', module: 'sync', partitioned: false },
  { name: 'oversell_event', module: 'sync', partitioned: false },
].map((t) => ({
  whereForRow: byId,
  buildImpersonationRow: (row, _seededRows, freshId) => cloneWithFreshId(row, freshId),
  ...t,
}));

// Exempt from RLS entirely — root of tenancy, and global hardware reference
// data respectively. Asserted absent-on-purpose, never fed into the CRUD loop.
const EXEMPT = ['tenant', 'printer_profile'];

module.exports = { TABLES, EXEMPT };
