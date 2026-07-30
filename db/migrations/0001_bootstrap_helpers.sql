-- Shared helpers every later migration depends on: lock_timeout, the RLS macro
-- (ERD §14, applied verbatim per table instead of copy-pasted 33 times), and
-- default privileges so lumi_app can read/write tables lumi_owner creates.
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION apply_tenant_rls(target_table regclass) RETURNS void
LANGUAGE plpgsql AS $fn$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', target_table);
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', target_table);
  EXECUTE format($p$CREATE POLICY tenant_select ON %s FOR SELECT
      USING (tenant_id = current_setting('app.tenant_id')::text)$p$, target_table);
  EXECUTE format($p$CREATE POLICY tenant_insert ON %s FOR INSERT
      WITH CHECK (tenant_id = current_setting('app.tenant_id')::text)$p$, target_table);
  EXECUTE format($p$CREATE POLICY tenant_update ON %s FOR UPDATE
      USING (tenant_id = current_setting('app.tenant_id')::text)
      WITH CHECK (tenant_id = current_setting('app.tenant_id')::text)$p$, target_table);
  EXECUTE format($p$CREATE POLICY tenant_delete ON %s FOR DELETE
      USING (tenant_id = current_setting('app.tenant_id')::text)$p$, target_table);
END;
$fn$;

GRANT USAGE ON SCHEMA public TO lumi_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lumi_app;
