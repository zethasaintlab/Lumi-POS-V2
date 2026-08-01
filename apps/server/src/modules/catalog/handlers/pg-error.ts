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
