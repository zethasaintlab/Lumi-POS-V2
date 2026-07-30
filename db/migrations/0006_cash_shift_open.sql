-- module: cash (part 1/2 — cash_drawer_shift must precede order.shift_id;
-- cash_movement is 0009, after order exists) (see apps/server/src/modules/README.md)
SET LOCAL lock_timeout = '5s';

CREATE TABLE cash_drawer_shift (
  id                    text PRIMARY KEY,
  tenant_id             text NOT NULL REFERENCES tenant(id),
  outlet_id             text NOT NULL REFERENCES outlet(id),
  device_id             text NOT NULL REFERENCES device(id),
  business_date         date NOT NULL,
  status                text NOT NULL DEFAULT 'open' CHECK (status IN ('open','counting','closed')),
  opening_float         bigint NOT NULL,
  opened_by             text NOT NULL,
  opened_at             timestamptz NOT NULL DEFAULT now(),
  counted_amount        bigint,
  expected_amount       bigint,
  difference            bigint,
  count_attempts        jsonb NOT NULL DEFAULT '[]'::jsonb,
  variance_reason_code  text,
  variance_note         text,
  closed_by             text,
  approved_by           text,
  closed_at             timestamptz
);
SELECT apply_tenant_rls('cash_drawer_shift');
-- maksimal satu shift `open` per device (ERD §7)
CREATE UNIQUE INDEX ux_shift_one_open_per_device ON cash_drawer_shift(device_id) WHERE status = 'open';
