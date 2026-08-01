import type { Pool } from '../../db.ts';
import { createCategoryHandlers } from './handlers/categories.ts';

export function createCatalogHandlers(pool: Pool): Record<string, unknown> {
  return {
    ...createCategoryHandlers(pool),
    // Tasks 3-5 spread their handler objects in here.
  };
}
