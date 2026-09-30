/**
 * ⛔ ISO 8601 BERZONA dan tanggal NYATA. `Date.parse` menggulirkan
 * `2026-02-30` ke 2 Maret dan menafsirkan timestamp tanpa zona sebagai zona
 * server — keduanya mengubah `occurred_at` audit tanpa error.
 */
export function timestampSah(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.exec(v);
  if (!m) return false;
  const [y, mo, d, h, mi] = [m[1], m[2], m[3], m[4], m[5]].map(Number);
  if (h > 23 || mi > 59 || (m[6] !== undefined && Number(m[6]) > 59)) return false;
  const hari = new Date(Date.UTC(y, mo - 1, d));
  if (hari.getUTCFullYear() !== y || hari.getUTCMonth() !== mo - 1 || hari.getUTCDate() !== d) return false;
  return !Number.isNaN(Date.parse(v));
}
