// Whole-branch review FIX 2: id is client-generated (ULID/UUIDv7, CLAUDE.md
// konvensi data), and offline retry -- re-sending the exact same create*
// request after a lost response -- is a first-class scenario for this
// system, not an edge case. Every create* handler in this module needs to
// tell "the client retried a create with an id it already sent" (PK
// collision on `id`, 23505) apart from any OTHER unique-constraint violation
// that also raises 23505 (e.g. item_variation's ux_variation_barcode) --
// those mean something completely different to the merchant and must not
// share an error code or message.
//
// PostgreSQL's own naming convention for an unnamed PRIMARY KEY constraint is
// always `<table>_pkey` -- confirmed against every catalog table in
// db/migrations/0004_catalog.sql, none of which override it with an explicit
// CONSTRAINT name. That naming is what this check relies on: a 23505 whose
// `constraint` ends in `_pkey` is a PK collision (duplicate id); anything
// else (a named unique index like `ux_variation_barcode`) is a different
// kind of conflict entirely and must be translated separately by the caller.
export function isPrimaryKeyViolation(err: unknown): boolean {
  const pgErr = err as { code?: string; constraint?: string };
  return pgErr.code === '23505' && typeof pgErr.constraint === 'string' && pgErr.constraint.endsWith('_pkey');
}

// Whole-branch review FIX 3: tenant_id is taken verbatim from X-Tenant-Id
// (tenant-context.ts -- an explicit placeholder for real auth, not a
// security mechanism) and inserted into every row. An unknown tenant id
// raises 23503 (FK violation on tenant(id)) on any create* whose INSERT
// isn't already gated by a preceding tenant-scoped SELECT (createCategory
// without parentId, createItem without categoryId, createModifierList) --
// untranslated, this fell through to a raw 500, while a *read* with the same
// unknown header returns a clean empty 200 (RLS just matches 0 rows, with no
// way to distinguish "tenant doesn't exist" from "tenant exists but has no
// data yet" -- and that's fine for reads). Same naming-convention approach as
// isPrimaryKeyViolation: Postgres names an unnamed FK constraint
// `<table>_<column>_fkey` by default, and none of the tenant_id FKs in
// db/migrations/0004_catalog.sql override that.
export function isTenantForeignKeyViolation(err: unknown): boolean {
  const pgErr = err as { code?: string; constraint?: string };
  return pgErr.code === '23503' && typeof pgErr.constraint === 'string' && pgErr.constraint.endsWith('_tenant_id_fkey');
}
