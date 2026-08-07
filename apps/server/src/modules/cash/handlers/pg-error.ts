// Salinan modul-scoped dari apps/server/src/modules/catalog/handlers/pg-error.ts
// (rule 3, apps/server/src/modules/README.md -- lint rule melarang import
// dalam-dalam antar modul, jadi tiap modul yang butuh helper ini punya
// salinannya sendiri).
//
// PostgreSQL's own naming convention for an unnamed PRIMARY KEY constraint is
// always `<table>_pkey` -- confirmed against cash_drawer_shift
// (db/migrations/0006_cash_shift_open.sql), which does not override it with
// an explicit CONSTRAINT name.
export function isPrimaryKeyViolation(err: unknown): boolean {
  const pgErr = err as { code?: string; constraint?: string };
  return pgErr.code === '23505' && typeof pgErr.constraint === 'string' && pgErr.constraint.endsWith('_pkey');
}
