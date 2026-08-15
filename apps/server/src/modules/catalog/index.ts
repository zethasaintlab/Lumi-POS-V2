import type { Pool } from '../../db.ts';
import { createCategoryHandlers } from './handlers/categories.ts';
import { createItemHandlers } from './handlers/items.ts';
import { createModifierListHandlers } from './handlers/modifier-lists.ts';
import { createItemModifierListHandlers } from './handlers/item-modifier-lists.ts';
import { createPriceHandlers } from './handlers/prices.ts';
import { createImportHandlers } from './handlers/import.ts';

// Permukaan publik FR-A7 untuk modul lain (invariant #4, CLAUDE.md).
// order_line.unit_price (Modul B) adalah SNAPSHOT hasil resolvePrice --
// Modul B WAJIB memanggil ini, bukan menghitung ulang tangga resolusi
// sendiri atau mengakses price_history/item_variation langsung.
export { wasPriceEverEffective, resolvePrice } from './handlers/prices.ts';
export type { ResolvedPrice } from './handlers/prices.ts';

// T5 (PLAN-ordering-fondasi.md) -- lihat komentar getVariationSnapshot di
// handlers/items.ts. order_line.item_name/variation_name/cost_at_sale
// (Modul B) adalah SNAPSHOT hasil fungsi ini.
export { getVariationSnapshot } from './handlers/items.ts';
export type { VariationSnapshotRow } from './handlers/items.ts';

// T8 (PLAN-pembayaran-pajak.md) -- modul payment menyimpan
// `tax_rate.applies_to_ids`, `text[]` TANPA FK. Validasinya harus lewat sini
// (invariant #4); lihat komentar di handlers/items.ts.
export { findInvisibleItemIds, findInvisibleCategoryIds } from './handlers/items.ts';

export function createCatalogHandlers(pool: Pool): Record<string, unknown> {
  return {
    ...createCategoryHandlers(pool),
    ...createItemHandlers(pool),
    ...createModifierListHandlers(pool),
    ...createItemModifierListHandlers(pool),
    ...createPriceHandlers(pool),
    ...createImportHandlers(pool),
  };
}
