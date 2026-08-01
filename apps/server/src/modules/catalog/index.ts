import type { Pool } from '../../db.ts';
import { createCategoryHandlers } from './handlers/categories.ts';
import { createItemHandlers } from './handlers/items.ts';
import { createModifierListHandlers } from './handlers/modifier-lists.ts';
import { createItemModifierListHandlers } from './handlers/item-modifier-lists.ts';

export function createCatalogHandlers(pool: Pool): Record<string, unknown> {
  return {
    ...createCategoryHandlers(pool),
    ...createItemHandlers(pool),
    ...createModifierListHandlers(pool),
    ...createItemModifierListHandlers(pool),
  };
}
