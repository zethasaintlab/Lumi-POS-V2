-- Bootstrap role-level objects for a fresh PostgreSQL cluster.
-- Run once per cluster via db/bootstrap.js (needs real superuser privileges).
-- Idempotent: safe to re-run against a cluster that already has these roles.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'lumi_owner') THEN
    CREATE ROLE lumi_owner LOGIN PASSWORD :'lumi_owner_password'
      NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS;
  END IF;

  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'lumi_app') THEN
    -- NOBYPASSRLS stated explicitly even though it is the default: Gate F0 hinges on
    -- this exact flag, so leaving it implicit here would be a foot-gun.
    CREATE ROLE lumi_app LOGIN PASSWORD :'lumi_app_password'
      NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS;
  END IF;
END
$$;
