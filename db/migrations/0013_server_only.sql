-- module: sync (see apps/server/src/modules/README.md)
SET LOCAL lock_timeout = '5s';

-- Retensi 30 hari (bukan 24 jam — perangkat bisa offline lebih lama). Ditulis
-- dalam transaksi yang sama dengan entitas yang dilindungi (ERD §11).
CREATE TABLE idempotency_key (
  key              text PRIMARY KEY,
  tenant_id        text NOT NULL REFERENCES tenant(id),
  request_hash     text NOT NULL,
  response_status  int,
  response_body    jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL
);
SELECT apply_tenant_rls('idempotency_key');
CREATE INDEX ix_idempotency_expires ON idempotency_key(expires_at);

-- tenant_id ditambahkan di sini walau tidak ada di kolom ERD §11 — keputusan
-- eksplisit: outbox tetap kena RLS standar seperti tabel lain (tidak ada
-- pengecualian diam-diam). Worker relay lintas-tenant di luar scope F0.
CREATE TABLE outbox (
  id              text PRIMARY KEY,
  tenant_id       text NOT NULL REFERENCES tenant(id),
  aggregate_type  text NOT NULL,
  aggregate_id    text NOT NULL,
  event_type      text NOT NULL,
  payload         jsonb NOT NULL,
  published_at    timestamptz
);
SELECT apply_tenant_rls('outbox');

CREATE TABLE oversell_event (
  id                text PRIMARY KEY,
  tenant_id         text NOT NULL REFERENCES tenant(id),
  outlet_id         text NOT NULL REFERENCES outlet(id),
  variation_id      text NOT NULL,
  detected_at       timestamptz NOT NULL DEFAULT now(),
  devices_involved  jsonb,
  orders_involved   jsonb,
  quantity_over     bigint NOT NULL,
  resolved_by       text,
  resolved_at       timestamptz,
  resolution_note   text
);
SELECT apply_tenant_rls('oversell_event');
