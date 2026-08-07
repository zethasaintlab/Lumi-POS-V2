import { createHash } from 'node:crypto';

// T10 (docs/superpowers/plans/PLAN-ordering-fondasi.md §3.5, spec-b:333-348)
// -- request_hash = SHA-256 hex dari body request YANG DIKANONIKALISASI: key
// objek diurutkan REKURSIF (termasuk objek bersarang di dalam array) supaya
// urutan properti yang berbeda pada body yang SECARA SEMANTIK identik
// menghasilkan hash yang SAMA -- retry offline yang menyusun ulang JSON
// (mis. serializer klien berbeda) tidak boleh dianggap request berbeda.
//
// Ditulis sendiri, TANPA dependency baru (batasan keras PLAN-ordering-
// fondasi.md). `node:crypto` sudah dipakai project ini (packages/domain
// belum, tapi ini server-only, bukan packages/domain).
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = canonicalize(obj[key]);
    }
    return sorted;
  }
  return value;
}

export function computeRequestHash(body: unknown): string {
  const canonicalJson = JSON.stringify(canonicalize(body));
  return createHash('sha256').update(canonicalJson, 'utf8').digest('hex');
}
