-- module: ordering (see apps/server/src/modules/README.md)
SET LOCAL lock_timeout = '5s';

CREATE TABLE "order" (
  id                         text PRIMARY KEY,  -- client-generated
  tenant_id                  text NOT NULL REFERENCES tenant(id),
  outlet_id                  text NOT NULL REFERENCES outlet(id),
  device_id                  text NOT NULL REFERENCES device(id),
  shift_id                   text NOT NULL REFERENCES cash_drawer_shift(id),
  receipt_number             text NOT NULL,
  business_date              date NOT NULL,
  sequence                   int NOT NULL,
  status                     text NOT NULL DEFAULT 'open'
                               CHECK (status IN ('open','paid','closed','voided','refunded','abandoned')),
  channel                    text NOT NULL CHECK (channel IN ('dine_in','takeaway')),
  owned_by_device_id         text,
  subtotal                   bigint NOT NULL DEFAULT 0,
  order_discount              bigint NOT NULL DEFAULT 0,
  service_charge_amount      bigint NOT NULL DEFAULT 0,
  tax_amount                 bigint NOT NULL DEFAULT 0,
  rounding_adjustment        bigint NOT NULL DEFAULT 0,
  total                      bigint NOT NULL DEFAULT 0,
  amount_due                 bigint NOT NULL DEFAULT 0,
  has_calculation_variance   boolean NOT NULL DEFAULT false,
  variance_amount            bigint,
  voided_by_order_id         text REFERENCES "order"(id),
  created_by                 text NOT NULL,
  occurred_at                timestamptz NOT NULL DEFAULT now(),
  recorded_at                timestamptz NOT NULL DEFAULT now(),
  hlc                        bigint NOT NULL,
  UNIQUE (device_id, business_date, sequence)
);
SELECT apply_tenant_rls('"order"');
CREATE INDEX ix_order_outlet_date ON "order"(tenant_id, outlet_id, business_date);
CREATE INDEX ix_order_open ON "order"(status) WHERE status = 'open';

-- v1: constraint aplikasi 1:1 dengan order (ERD §6, KEP-06); UNIQUE(order_id)
-- menegakkannya juga di level DB karena tidak menambah biaya.
CREATE TABLE "check" (
  id         text PRIMARY KEY,
  tenant_id  text NOT NULL REFERENCES tenant(id),
  order_id   text NOT NULL REFERENCES "order"(id) UNIQUE,
  label      text,
  subtotal   bigint NOT NULL DEFAULT 0,
  total      bigint NOT NULL DEFAULT 0
);
SELECT apply_tenant_rls('"check"');

-- occurred_at/recorded_at/hlc/device_id/outlet_id/created_by ditambahkan di
-- sini walau tidak eksplisit di kolom §6 — dipaksa oleh aturan tabel
-- transaksional ERD §1.4 dan kebutuhan partition key.
CREATE TABLE order_line (
  id                  text NOT NULL,
  tenant_id           text NOT NULL REFERENCES tenant(id),
  outlet_id           text NOT NULL REFERENCES outlet(id),
  device_id           text NOT NULL REFERENCES device(id),
  order_id            text NOT NULL REFERENCES "order"(id),
  check_id            text NOT NULL REFERENCES "check"(id),
  variation_id        text NOT NULL,  -- referensi, untuk pelaporan
  item_name           text NOT NULL,  -- snapshot
  variation_name      text NOT NULL,  -- snapshot
  unit_price          bigint NOT NULL,  -- snapshot
  quantity            bigint NOT NULL,  -- x1000
  modifier_snapshot   jsonb NOT NULL DEFAULT '[]'::jsonb,
  discount_amount     bigint NOT NULL DEFAULT 0,
  tax_rate_id         text,
  tax_rate            numeric(6,4) NOT NULL DEFAULT 0,  -- snapshot
  tax_amount          bigint NOT NULL DEFAULT 0,  -- snapshot
  is_tax_inclusive    boolean NOT NULL DEFAULT false,  -- snapshot
  cost_at_sale        bigint NOT NULL DEFAULT 0,  -- snapshot
  line_total          bigint NOT NULL,
  created_by          text NOT NULL,
  occurred_at         timestamptz NOT NULL,
  recorded_at         timestamptz NOT NULL DEFAULT now(),
  hlc                 bigint NOT NULL,
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);
SELECT apply_tenant_rls('order_line');
CREATE INDEX ix_line_order ON order_line(order_id);
CREATE INDEX ix_line_variation ON order_line(variation_id, occurred_at);

-- soft FK: Postgres tidak bisa menegakkan FK ke tabel partitioned (order_line)
-- pada kolom non-partition-key tanpa mendenormalisasi occurred_at ke sini
-- juga. Ditegakkan invariant #1 (satu transaksi) + test aplikasi, bukan DB.
CREATE TABLE order_line_modifier (
  id             text PRIMARY KEY,
  tenant_id      text NOT NULL REFERENCES tenant(id),
  order_line_id  text NOT NULL,
  modifier_id    text,
  name           text NOT NULL,
  price          bigint NOT NULL,
  quantity       bigint NOT NULL DEFAULT 1000
);
SELECT apply_tenant_rls('order_line_modifier');
CREATE INDEX ix_line_modifier_line ON order_line_modifier(order_line_id);

-- SUM(refund.amount) per order <= order.total ditegakkan aplikasi + test (ERD §6).
CREATE TABLE refund (
  id            text PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenant(id),
  order_id      text NOT NULL REFERENCES "order"(id),
  amount        bigint NOT NULL,
  reason_code   text NOT NULL,
  reason_note   text,
  created_by    text NOT NULL,
  approved_by   text NOT NULL,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  hlc           bigint NOT NULL
);
SELECT apply_tenant_rls('refund');
