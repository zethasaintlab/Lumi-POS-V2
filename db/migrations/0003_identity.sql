-- module: identity (see apps/server/src/modules/README.md)
SET LOCAL lock_timeout = '5s';

CREATE TABLE role (
  id         text PRIMARY KEY,
  tenant_id  text NOT NULL REFERENCES tenant(id),
  code       text NOT NULL CHECK (code IN ('owner','area_manager','outlet_manager','cashier','accountant')),
  name       text NOT NULL,
  UNIQUE (tenant_id, code)
);
SELECT apply_tenant_rls('role');

CREATE TABLE "user" (
  id                   text PRIMARY KEY,
  tenant_id            text NOT NULL REFERENCES tenant(id),
  name                 text NOT NULL,
  email                text,
  password_hash        text,
  pin_hash             text,
  pin_failed_attempts  int NOT NULL DEFAULT 0,
  pin_locked_until     timestamptz,
  pin_rotated_at       timestamptz,
  mfa_secret           text,
  is_active            boolean NOT NULL DEFAULT true,
  deactivated_at       timestamptz
  -- TODO(F1): UNIQUE(outlet_id, pin_hash) lewat tabel jembatan (ERD §3) — bridge
  -- table itu tidak pernah didefinisikan di ERD, tidak dibangun di F0.
);
SELECT apply_tenant_rls('"user"');

-- ERD §3 tidak mencantumkan kolom `id` untuk user_role secara eksplisit (hanya
-- user_id/role/scope_type/scope_id), tapi setiap tabel lain di skema ini
-- memakai surrogate ulid PK — dipertahankan konsisten di sini juga, sebagai
-- resolusi pragmatis, bukan relasi baru yang diciptakan.
CREATE TABLE user_role (
  id          text PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenant(id),
  user_id     text NOT NULL REFERENCES "user"(id),
  role        text NOT NULL CHECK (role IN ('owner','area_manager','outlet_manager','cashier','accountant')),
  scope_type  text NOT NULL CHECK (scope_type IN ('tenant','outlet')),
  scope_id    text NOT NULL
);
SELECT apply_tenant_rls('user_role');
CREATE INDEX ix_user_role_user ON user_role(user_id);

CREATE TABLE device (
  id                     text PRIMARY KEY,
  tenant_id              text NOT NULL REFERENCES tenant(id),
  outlet_id              text NOT NULL REFERENCES outlet(id),
  code                   text NOT NULL,
  name                   text,
  platform               text,
  app_version            text,
  schema_version         text,
  token_hash             text,
  credentials_expire_at  timestamptz,
  last_seen_at           timestamptz,
  revoked_at             timestamptz
);
SELECT apply_tenant_rls('device');
CREATE UNIQUE INDEX ux_device_outlet_code ON device(outlet_id, code) WHERE revoked_at IS NULL;
