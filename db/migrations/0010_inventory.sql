-- module: inventory (see apps/server/src/modules/README.md)
SET LOCAL lock_timeout = '5s';

CREATE TABLE stocktake (
  id            text PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenant(id),
  outlet_id     text NOT NULL REFERENCES outlet(id),
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','counting','approved')),
  snapshot_at   timestamptz,
  started_by    text NOT NULL,
  approved_by   text
);
SELECT apply_tenant_rls('stocktake');

CREATE TABLE stocktake_line (
  id            text PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenant(id),
  stocktake_id  text NOT NULL REFERENCES stocktake(id),
  variation_id  text NOT NULL,
  expected_qty  bigint NOT NULL,  -- x1000
  counted_qty   bigint,           -- x1000
  reason_code   text
);
SELECT apply_tenant_rls('stocktake_line');

-- Tidak ada tabel `stock`/kolom quantity_on_hand — stok = SUM(delta) per
-- (outlet_id, variation_id) (ERD §8).
CREATE TABLE stock_movement (
  id            text NOT NULL,
  tenant_id     text NOT NULL REFERENCES tenant(id),
  outlet_id     text NOT NULL REFERENCES outlet(id),
  device_id     text REFERENCES device(id),
  variation_id  text NOT NULL,
  type          text NOT NULL CHECK (type IN ('sale','void','refund','receipt','adjustment','stocktake','transfer_in','transfer_out')),
  delta         bigint NOT NULL,  -- x1000, bertanda
  order_id      text REFERENCES "order"(id),
  stocktake_id  text REFERENCES stocktake(id),
  reason_code   text,
  note          text,
  unit_cost     bigint,
  created_by    text,
  occurred_at   timestamptz NOT NULL,
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  hlc           bigint NOT NULL,
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);
SELECT apply_tenant_rls('stock_movement');
CREATE INDEX ix_mv_stock ON stock_movement(tenant_id, outlet_id, variation_id, occurred_at);
-- wajib untuk pola snapshot delta (ERD §16) — tanpanya snapshot tidak berguna (117.7ms -> 111.6ms saja).
CREATE INDEX ix_mv_hlc ON stock_movement(tenant_id, outlet_id, hlc);

CREATE TABLE sold_out_flag (
  id            text PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenant(id),
  outlet_id     text NOT NULL REFERENCES outlet(id),
  variation_id  text NOT NULL,
  is_sold_out   boolean NOT NULL DEFAULT false,
  set_by        text NOT NULL,
  set_at        timestamptz NOT NULL DEFAULT now(),
  hlc           bigint NOT NULL
);
SELECT apply_tenant_rls('sold_out_flag');

-- Postgres tidak punya WITHOUT ROWID (khusus SQLite) — heap table biasa
-- dengan composite PK adalah padanan langsungnya (ERD §16).
CREATE TABLE stock_snapshot (
  tenant_id       text NOT NULL REFERENCES tenant(id),
  outlet_id       text NOT NULL REFERENCES outlet(id),
  variation_id    text NOT NULL,
  balance         bigint NOT NULL,  -- x1000
  checkpoint_hlc  bigint NOT NULL,
  PRIMARY KEY (tenant_id, outlet_id, variation_id)
);
SELECT apply_tenant_rls('stock_snapshot');
