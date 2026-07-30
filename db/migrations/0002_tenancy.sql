-- module: tenancy (see apps/server/src/modules/README.md)
SET LOCAL lock_timeout = '5s';

-- tenant is the root of the multi-tenant model — it has no parent tenant_id
-- and is therefore exempt from RLS (there is no "other tenant" to scope by
-- inside this table; the row itself IS the boundary).
CREATE TABLE tenant (
  id               text PRIMARY KEY,
  name             text NOT NULL,
  plan             text NOT NULL CHECK (plan IN ('free','standard','pro','enterprise')),
  status           text NOT NULL CHECK (status IN ('active','suspended','cancelled')),
  deployment_mode  text NOT NULL CHECK (deployment_mode IN ('cloud','self_hosted')),
  max_outlets      int,
  max_devices      int,
  max_users        int,
  max_products     int,
  features         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  suspended_at     timestamptz
);
-- exempt from RLS: root of tenancy, see comment above.

CREATE TABLE vertical_profile (
  id                     text PRIMARY KEY,
  tenant_id              text NOT NULL REFERENCES tenant(id),
  name                   text NOT NULL CHECK (name IN ('fnb','retail')),
  modules_enabled        jsonb NOT NULL DEFAULT '[]'::jsonb,
  default_channel        text NOT NULL CHECK (default_channel IN ('dine_in','takeaway')),
  allow_negative_stock   boolean NOT NULL DEFAULT true,
  requires_barcode_flow  boolean NOT NULL DEFAULT false,
  default_tax_type       text NOT NULL CHECK (default_tax_type IN ('pbjt','ppn'))
);
SELECT apply_tenant_rls('vertical_profile');

-- OQ-09 [ASUMSI, per ERD §19]: VerticalProfile per outlet dengan default tenant.
CREATE TABLE outlet (
  id                    text PRIMARY KEY,
  tenant_id             text NOT NULL REFERENCES tenant(id),
  name                  text NOT NULL,
  address               text,
  timezone              text NOT NULL CHECK (timezone IN ('Asia/Jakarta','Asia/Makassar','Asia/Jayapura')),
  business_day_ends_at  time NOT NULL DEFAULT '04:00',
  rounding_increment    int NOT NULL DEFAULT 100,
  rounding_mode         text NOT NULL DEFAULT 'half_up' CHECK (rounding_mode IN ('half_up','up','down')),
  service_charge_rate   numeric(6,4) NOT NULL DEFAULT 0,
  vertical_profile_id   text REFERENCES vertical_profile(id),
  archived_at           timestamptz
);
SELECT apply_tenant_rls('outlet');
CREATE INDEX ix_outlet_tenant ON outlet(tenant_id);
