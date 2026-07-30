-- module: cash (part 2/2 — must follow "order") (see apps/server/src/modules/README.md)
SET LOCAL lock_timeout = '5s';

-- Invariant (ERD §7): expected_amount = opening_float + SUM(delta) — ditegakkan aplikasi + test.
CREATE TABLE cash_movement (
  id               text PRIMARY KEY,
  tenant_id        text NOT NULL REFERENCES tenant(id),
  shift_id         text NOT NULL REFERENCES cash_drawer_shift(id),
  type             text NOT NULL CHECK (type IN ('opening_float','sale','refund','paid_in','paid_out','bank_deposit','adjustment')),
  delta            bigint NOT NULL,
  order_id         text REFERENCES "order"(id),
  counterpart_type text NOT NULL CHECK (counterpart_type IN ('sales_revenue','refund','owner_draw','expense','bank','unidentified')),
  reason_code      text,
  note             text,
  created_by       text NOT NULL,
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  hlc              bigint NOT NULL
);
SELECT apply_tenant_rls('cash_movement');
CREATE INDEX ix_cash_shift ON cash_movement(shift_id);
