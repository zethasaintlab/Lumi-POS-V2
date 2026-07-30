-- module: payment (part 2/2 — must follow "order"; tax_rate is 0005)
-- (see apps/server/src/modules/README.md)
SET LOCAL lock_timeout = '5s';

-- outlet_id/device_id/occurred_at/recorded_at/hlc/created_by ditambahkan di
-- sini walau tidak eksplisit di kolom §6 — dipaksa oleh aturan tabel
-- transaksional ERD §1.4 dan kebutuhan partition key.
-- Larangan eksplisit (ERD §6): tidak ada card_number, cvv, pin_block, track_data.
CREATE TABLE payment (
  id                    text NOT NULL,
  tenant_id             text NOT NULL REFERENCES tenant(id),
  outlet_id             text NOT NULL REFERENCES outlet(id),
  device_id             text NOT NULL REFERENCES device(id),
  order_id              text NOT NULL REFERENCES "order"(id),
  check_id              text NOT NULL REFERENCES "check"(id),
  method                text NOT NULL CHECK (method IN ('cash','qris_dynamic','qris_static','card_edc','other')),
  amount                bigint NOT NULL CHECK (amount > 0),
  tendered_amount       bigint,
  change_amount         bigint,
  status                text NOT NULL DEFAULT 'pending_confirmation'
                          CHECK (status IN ('pending_confirmation','confirmed','failed','voided')),
  provider              text,
  provider_reference    text,
  terminal_reference    text,
  approval_code         text,
  card_last4            text CHECK (card_last4 IS NULL OR length(card_last4) <= 4),
  card_brand             text,
  acquirer               text,
  confirmed_manually    boolean NOT NULL DEFAULT false,
  mdr_estimated          bigint,
  tendered_at            timestamptz NOT NULL,
  created_by             text NOT NULL,
  occurred_at             timestamptz NOT NULL,
  recorded_at            timestamptz NOT NULL DEFAULT now(),
  hlc                    bigint NOT NULL,
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);
SELECT apply_tenant_rls('payment');
CREATE INDEX ix_payment_order ON payment(order_id);
CREATE INDEX ix_payment_pending ON payment(status) WHERE status = 'pending_confirmation';
