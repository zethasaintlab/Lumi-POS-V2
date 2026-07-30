-- module: audit (see apps/server/src/modules/README.md)
SET LOCAL lock_timeout = '5s';

-- Retensi minimal 5 tahun, tidak ada UPDATE/DELETE (ERD §9) — ditegakkan
-- operasional (retention policy) + konvensi aplikasi, bukan oleh skema ini.
CREATE TABLE audit_event (
  id                text NOT NULL,
  tenant_id         text NOT NULL REFERENCES tenant(id),
  outlet_id         text REFERENCES outlet(id),
  device_id         text REFERENCES device(id),
  actor_user_id     text NOT NULL REFERENCES "user"(id),
  approver_user_id  text REFERENCES "user"(id),
  event_type        text NOT NULL,
  entity_type       text,
  entity_id         text,
  before             jsonb,
  after              jsonb,
  reason_code        text,
  reason_note        text,
  occurred_at        timestamptz NOT NULL,
  recorded_at        timestamptz NOT NULL DEFAULT now(),
  hlc                bigint NOT NULL,
  CHECK (approver_user_id IS NULL OR actor_user_id <> approver_user_id),
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);
SELECT apply_tenant_rls('audit_event');
CREATE INDEX ix_audit_outlet ON audit_event(tenant_id, outlet_id, occurred_at);
CREATE INDEX ix_audit_actor ON audit_event(actor_user_id, occurred_at);
CREATE INDEX ix_audit_event_type ON audit_event(event_type, occurred_at);
