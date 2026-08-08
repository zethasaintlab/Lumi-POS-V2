-- Skema SQLite lokal Lumi POS v1 — diturunkan dari /product/ERD-lumi-pos-v1.md
-- Uang: INTEGER rupiah utuh. Kuantitas: INTEGER x1000. ID: TEXT (ULID 26 char).

PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- ---------- KATALOG (direplikasi turun) ----------
CREATE TABLE category (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL,
  parent_id TEXT, sort_order INTEGER DEFAULT 0, color_hint TEXT, archived_at TEXT
);
CREATE TABLE item (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL,
  category_id TEXT, description TEXT, image_url TEXT,
  sort_order INTEGER DEFAULT 0, archived_at TEXT
);
CREATE TABLE item_variation (
  id TEXT PRIMARY KEY, item_id TEXT NOT NULL, name TEXT NOT NULL DEFAULT 'Regular',
  sku TEXT, barcode TEXT, price INTEGER NOT NULL, cost INTEGER NOT NULL DEFAULT 0,
  stocking_unit TEXT DEFAULT 'pcs', selling_unit TEXT DEFAULT 'pcs',
  conversion_factor INTEGER DEFAULT 1000,
  track_stock INTEGER NOT NULL DEFAULT 1, sort_order INTEGER DEFAULT 0, archived_at TEXT
);
CREATE TABLE modifier_list (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL,
  selection_type TEXT NOT NULL CHECK(selection_type IN ('single','multi')),
  min_selections INTEGER DEFAULT 0, max_selections INTEGER,
  allow_duplicate INTEGER DEFAULT 0, is_required INTEGER DEFAULT 0, archived_at TEXT
);
CREATE TABLE modifier (
  id TEXT PRIMARY KEY, modifier_list_id TEXT NOT NULL, name TEXT NOT NULL,
  price INTEGER NOT NULL DEFAULT 0, is_default INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0, archived_at TEXT
);
-- `id` ada karena PowerSync menolak raw table tanpanya ("Table X has no id
-- column"), bukan karena kunci alaminya berubah. Kunci alaminya tetap
-- pasangan (item_id, modifier_list_id), dan ux_item_modifier_list_pair yang
-- menjaganya sejak primary key pindah. Sejajar dengan migrasi PostgreSQL 0018;
-- bentuk lokal dan server HARUS sama, karena baris ini turun lewat sync.
-- `NOT NULL` ditulis eksplisit, dan itu BUKAN redundan: di tabel rowid,
-- SQLite mengizinkan NULL pada kolom PRIMARY KEY -- bug lama yang
-- dipertahankan demi kompatibilitas. Tanpa baris ini, baris ber-id NULL
-- diterima di perangkat sementara PostgreSQL menolaknya, dan selisih itu baru
-- terlihat saat sync. Ditemukan oleh test, bukan oleh review.
CREATE TABLE item_modifier_list (
  id TEXT PRIMARY KEY NOT NULL,
  item_id TEXT NOT NULL, modifier_list_id TEXT NOT NULL, sort_order INTEGER DEFAULT 0
);
CREATE UNIQUE INDEX ux_item_modifier_list_pair
  ON item_modifier_list(item_id, modifier_list_id);
CREATE TABLE tax_rate (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, outlet_id TEXT,
  name TEXT NOT NULL, type TEXT NOT NULL, rate INTEGER NOT NULL, -- rate x10000
  is_inclusive INTEGER DEFAULT 0, phase TEXT DEFAULT 'subtotal',
  jurisdiction TEXT, channel TEXT DEFAULT 'all',
  applies_to TEXT DEFAULT 'all_items', applies_to_ids TEXT,
  effective_from TEXT NOT NULL, effective_to TEXT
);

-- ---------- TRANSAKSI (dibuat lokal, naik) ----------
CREATE TABLE "order" (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, outlet_id TEXT NOT NULL,
  device_id TEXT NOT NULL, shift_id TEXT NOT NULL,
  receipt_number TEXT NOT NULL, business_date TEXT NOT NULL, sequence INTEGER NOT NULL,
  status TEXT NOT NULL, channel TEXT NOT NULL DEFAULT 'takeaway',
  owned_by_device_id TEXT,
  subtotal INTEGER NOT NULL, order_discount INTEGER NOT NULL DEFAULT 0,
  service_charge_amount INTEGER NOT NULL DEFAULT 0, tax_amount INTEGER NOT NULL DEFAULT 0,
  rounding_adjustment INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL, amount_due INTEGER NOT NULL,
  has_calculation_variance INTEGER DEFAULT 0, variance_amount INTEGER,
  created_by TEXT NOT NULL, occurred_at TEXT NOT NULL, recorded_at TEXT, hlc INTEGER NOT NULL
);
CREATE TABLE "check" (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL, label TEXT,
  subtotal INTEGER NOT NULL, total INTEGER NOT NULL
);
CREATE TABLE order_line (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL, check_id TEXT NOT NULL,
  variation_id TEXT NOT NULL,
  item_name TEXT NOT NULL, variation_name TEXT NOT NULL,
  unit_price INTEGER NOT NULL, quantity INTEGER NOT NULL,       -- x1000
  modifier_snapshot TEXT, discount_amount INTEGER DEFAULT 0,
  tax_rate_id TEXT, tax_rate INTEGER DEFAULT 0, tax_amount INTEGER DEFAULT 0,
  is_tax_inclusive INTEGER DEFAULT 0, cost_at_sale INTEGER NOT NULL DEFAULT 0,
  line_total INTEGER NOT NULL
);
CREATE TABLE order_line_modifier (
  id TEXT PRIMARY KEY, order_line_id TEXT NOT NULL, modifier_id TEXT,
  name TEXT NOT NULL, price INTEGER NOT NULL, quantity INTEGER NOT NULL DEFAULT 1000
);
CREATE TABLE payment (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL, check_id TEXT NOT NULL,
  method TEXT NOT NULL, amount INTEGER NOT NULL,
  tendered_amount INTEGER, change_amount INTEGER, status TEXT NOT NULL,
  provider TEXT, provider_reference TEXT, terminal_reference TEXT,
  approval_code TEXT, card_last4 TEXT CHECK(card_last4 IS NULL OR length(card_last4)<=4),
  card_brand TEXT, acquirer TEXT, confirmed_manually INTEGER DEFAULT 0,
  mdr_estimated INTEGER, tendered_at TEXT NOT NULL
);
CREATE TABLE refund (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL, amount INTEGER NOT NULL,
  reason_code TEXT NOT NULL, reason_note TEXT,
  created_by TEXT NOT NULL, approved_by TEXT NOT NULL,
  occurred_at TEXT NOT NULL, recorded_at TEXT, hlc INTEGER NOT NULL
);
CREATE TABLE stock_movement (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, outlet_id TEXT NOT NULL,
  device_id TEXT, variation_id TEXT NOT NULL, type TEXT NOT NULL,
  delta INTEGER NOT NULL,                                        -- x1000
  order_id TEXT, stocktake_id TEXT, reason_code TEXT, note TEXT, unit_cost INTEGER,
  created_by TEXT, occurred_at TEXT NOT NULL, recorded_at TEXT, hlc INTEGER NOT NULL
);

-- stock_snapshot: cache lokal hasil agregasi stock_movement, dibangun ulang
-- saat tutup shift (bukan direplikasi naik/turun) — bentuk dan alasan index
-- ix_mv_hlc di bawah sudah diukur, lihat prototypes/01-sqlite-sizing/FINDINGS.md §5.
CREATE TABLE stock_snapshot (
  tenant_id TEXT NOT NULL, outlet_id TEXT NOT NULL, variation_id TEXT NOT NULL,
  balance INTEGER NOT NULL, -- x1000
  checkpoint_hlc INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, outlet_id, variation_id)
) WITHOUT ROWID;

CREATE TABLE cash_drawer_shift (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, outlet_id TEXT NOT NULL,
  device_id TEXT NOT NULL, business_date TEXT NOT NULL, status TEXT NOT NULL,
  opening_float INTEGER NOT NULL, opened_by TEXT, opened_at TEXT,
  counted_amount INTEGER, expected_amount INTEGER, difference INTEGER,
  count_attempts TEXT, variance_reason_code TEXT, variance_note TEXT,
  closed_by TEXT, approved_by TEXT, closed_at TEXT
);
CREATE TABLE cash_movement (
  id TEXT PRIMARY KEY, shift_id TEXT NOT NULL, type TEXT NOT NULL,
  delta INTEGER NOT NULL, order_id TEXT, counterpart_type TEXT NOT NULL,
  reason_code TEXT, note TEXT, created_by TEXT,
  occurred_at TEXT NOT NULL, recorded_at TEXT, hlc INTEGER NOT NULL
);
CREATE TABLE audit_event (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, outlet_id TEXT, device_id TEXT,
  actor_user_id TEXT NOT NULL, approver_user_id TEXT,
  event_type TEXT NOT NULL, entity_type TEXT, entity_id TEXT,
  before TEXT, after TEXT, reason_code TEXT, reason_note TEXT,
  occurred_at TEXT NOT NULL, recorded_at TEXT, hlc INTEGER NOT NULL
);

-- ---------- LOKAL-ONLY ----------
-- FR-H1. `depends_on` menunjuk `outbox_local.id` lain, dan ia bukan
-- kenyamanan: spec menuntut urutan dependensi dihormati (shift sebelum order)
-- SEKALIGUS item gagal tidak memblokir item independen. Tanpa penanda ini,
-- satu-satunya cara memenuhi keduanya adalah membiarkan item yang bergantung
-- gagal sendiri di server -- yang MEMBAKAR counter percobaannya, dan menandai
-- order yang sempurna sebagai `failed` permanen hanya karena shift-nya lambat.
--
-- Sengaja TANPA foreign key. Item yang sudah terkirim boleh dipangkas kelak,
-- dan FK akan menahan pemangkasan itu justru saat antrean paling perlu
-- diringankan. Relay memperlakukan dependensi yang tidak ditemukan sebagai
-- sudah selesai.
CREATE TABLE outbox_local (
  id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  operation TEXT NOT NULL, payload TEXT NOT NULL, idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER DEFAULT 0,
  last_error TEXT, last_attempt_at TEXT, created_at TEXT NOT NULL,
  depends_on TEXT
);
CREATE TABLE device_config (
  device_code TEXT PRIMARY KEY, outlet_id TEXT NOT NULL,
  receipt_sequence INTEGER DEFAULT 0, sequence_business_date TEXT,
  hlc_state INTEGER DEFAULT 0, last_sync_at TEXT
);

-- ---------- INDEX (dari ERD §15) ----------
CREATE INDEX ix_order_outlet_date   ON "order"(tenant_id, outlet_id, business_date);
CREATE UNIQUE INDEX ux_order_receipt ON "order"(device_id, business_date, sequence);
CREATE INDEX ix_order_open          ON "order"(status) WHERE status='open';
CREATE INDEX ix_line_order          ON order_line(order_id);
CREATE INDEX ix_line_variation      ON order_line(variation_id, id);
CREATE INDEX ix_payment_order       ON payment(order_id);
CREATE INDEX ix_payment_pending     ON payment(status) WHERE status='pending_confirmation';
CREATE INDEX ix_mv_stock            ON stock_movement(tenant_id, outlet_id, variation_id, occurred_at);
CREATE INDEX ix_mv_hlc              ON stock_movement(tenant_id, outlet_id, hlc);
CREATE INDEX ix_audit_outlet        ON audit_event(tenant_id, outlet_id, occurred_at);
CREATE INDEX ix_audit_actor         ON audit_event(actor_user_id, occurred_at);
CREATE INDEX ix_cash_shift          ON cash_movement(shift_id);
CREATE INDEX ix_var_barcode         ON item_variation(barcode);
CREATE INDEX ix_item_name           ON item(name);
CREATE INDEX ix_outbox_status       ON outbox_local(status, created_at);
