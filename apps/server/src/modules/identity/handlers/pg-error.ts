// Salinan modul-scoped dari apps/server/src/modules/catalog/handlers/pg-error.ts
// (rule 3, apps/server/src/modules/README.md: "Lint rule melarang import
// dalam-dalam antar modul" -- catalog dan identity tidak boleh saling impor
// meskipun helper klasifikasi error PostgreSQL ini isinya identik).
//
// PostgreSQL's own naming convention for an unnamed PRIMARY KEY constraint is
// always `<table>_pkey` -- confirmed against device (db/migrations/0003_identity.sql),
// which does not override it with an explicit CONSTRAINT name. A 23505 whose
// `constraint` ends in `_pkey` is a PK collision (duplicate id, offline
// retry); anything else (e.g. the named unique index ux_device_outlet_code)
// is a different kind of conflict and must be translated separately by the
// caller.
export function isPrimaryKeyViolation(err: unknown): boolean {
  const pgErr = err as { code?: string; constraint?: string };
  return pgErr.code === '23505' && typeof pgErr.constraint === 'string' && pgErr.constraint.endsWith('_pkey');
}
