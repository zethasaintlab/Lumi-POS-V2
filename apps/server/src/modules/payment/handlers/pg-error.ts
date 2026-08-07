// Salinan modul-scoped, sama seperti di catalog/ordering/cash/identity:
// aturan 3 di modules/README.md melarang import dalam-dalam antar modul, dan
// helper sekecil ini tidak layak jadi permukaan publik modul mana pun.
export function isPrimaryKeyViolation(err: unknown): boolean {
  const pgErr = err as { code?: string; constraint?: string };
  return pgErr.code === '23505' && typeof pgErr.constraint === 'string' && pgErr.constraint.endsWith('_pkey');
}
