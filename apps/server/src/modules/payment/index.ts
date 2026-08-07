import type { Pool } from '../../db.ts';
import { createTaxRateHandlers } from './handlers/tax-rates.ts';

// Permukaan publik modul payment (apps/server/src/modules/README.md --
// kepemilikan tabel DITEGAKKAN). Modul ini memiliki `payment` dan `tax_rate`.
//
// Modul ordering memanggil fetchEffectiveTaxRates untuk mendapatkan KANDIDAT
// tarif; resolusinya sendiri (item > category > all_items, outlet > null,
// channel > all) milik calculateTax di packages/domain, supaya klien offline
// menerapkan aturan yang sama persis. Invariant #4 dan #7 sekaligus:
// ordering tidak menyentuh tabel tax_rate, dan tidak ada modul selain
// packages/domain/src/tax.ts yang menghitung pajak.
export { fetchEffectiveTaxRates } from './handlers/tax-rates.ts';

export function createPaymentHandlers(pool: Pool): Record<string, unknown> {
  return {
    ...createTaxRateHandlers(pool),
  };
}
