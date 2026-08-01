import type { Pool } from '../../db.ts';
import { createCategoryHandlers } from './handlers/categories.ts';
import { createItemHandlers } from './handlers/items.ts';

export function createCatalogHandlers(pool: Pool): Record<string, unknown> {
  return {
    ...createCategoryHandlers(pool),
    ...createItemHandlers(pool),
    // Tasks 4-5 spread their handler objects in here.
  };
}
