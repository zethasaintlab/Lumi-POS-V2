import type { DbLokal } from '../../../../packages/sync-client/src/ports.ts';
import {
  resolusiProfil,
  type ProfilTerresolusi,
  type ProfilVertikal,
} from '../../../../packages/domain/src/profil-vertikal.ts';

/**
 * Membaca `VerticalProfile` yang berlaku untuk outlet ini, dari data lokal.
 *
 * OQ-09: profil per outlet, mewarisi default tenant. Resolusinya
 * `COALESCE(profil_outlet, profil_default_tenant)` dan hidup di
 * `packages/domain/src/profil-vertikal.ts` — dibagi dengan server, karena
 * aturan stok yang berbeda antara offline dan online berarti merchant melihat
 * produk yang dapat dijual saat internet mati lalu ditolak saat menyala.
 *
 * ⛔ Kedua baris dibaca, bukan satu. Yang menjadi default tenant adalah baris
 * LAIN dari profil outlet, dan resolusi membutuhkan keduanya — outlet tanpa
 * profil sendiri harus tetap mendapat aturan yang pusat tetapkan.
 */
export async function bacaProfilVertikal(
  db: DbLokal,
  { tenantId, outletId }: { tenantId: string; outletId: string }
): Promise<ProfilTerresolusi> {
  const outlet = await db.getAll<{ vertical_profile_id: string | null }>(
    `SELECT vertical_profile_id FROM outlet WHERE id = ?`,
    [outletId]
  );
  const profilId = outlet[0]?.vertical_profile_id ?? null;

  const baris = await db.getAll<{
    id: string;
    name: string;
    allow_negative_stock: number;
    is_tenant_default: number;
  }>(
    `SELECT id, name, allow_negative_stock, is_tenant_default
       FROM vertical_profile WHERE tenant_id = ?`,
    [tenantId]
  );

  // `boolean` PostgreSQL mendarat sebagai INTEGER di SQLite lokal — kelas
  // divergensi yang terdaftar di `KOLOM_BELUM_DIUKUR`. Perbandingannya
  // eksplisit terhadap 1, bukan truthiness: `'0'` dari driver yang
  // mengembalikan string akan terbaca `true` kalau hanya di-cek truthy.
  const keProfil = (b: (typeof baris)[number]): ProfilVertikal => ({
    id: b.id,
    name: b.name,
    allowNegativeStock: Number(b.allow_negative_stock) === 1,
    isTenantDefault: Number(b.is_tenant_default) === 1,
  });

  const cocokOutlet = profilId ? baris.find((b) => b.id === profilId) : undefined;
  const cocokDefault = baris.find((b) => Number(b.is_tenant_default) === 1);

  return resolusiProfil({
    profilOutlet: cocokOutlet ? keProfil(cocokOutlet) : null,
    profilDefaultTenant: cocokDefault ? keProfil(cocokDefault) : null,
  });
}
