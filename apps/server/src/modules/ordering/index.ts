import type { Pool } from '../../db.ts';
import type { Hlc } from '../../../../../packages/domain/src/hlc.ts';
import { createOrderHandlers } from './handlers/orders.ts';

// Permukaan publik modul ordering (apps/server/src/modules/README.md --
// kepemilikan tabel DITEGAKKAN: order, check, order_line, order_line_modifier,
// refund). `hlc` adalah satu instance Hlc dibuat sekali di buildApp
// (apps/server/src/app.ts) dengan clock nyata di-inject di batas itu --
// bukan dibuat ulang di sini -- supaya monotonisitas server terjaga LINTAS
// request, bukan hanya di dalam satu request (packages/domain/src/hlc.ts).
export function createOrderingHandlers(pool: Pool, hlc: Hlc): Record<string, unknown> {
  return {
    ...createOrderHandlers(pool, hlc),
  };
}
