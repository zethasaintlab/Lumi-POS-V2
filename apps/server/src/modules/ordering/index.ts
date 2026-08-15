import type { Pool } from '../../db.ts';
import type { Hlc } from '../../../../../packages/domain/src/hlc.ts';
import { createOrderHandlers } from './handlers/orders.ts';
import { createCancelHandlers } from './handlers/cancel.ts';
import { createReportHandlers } from './handlers/reports.ts';
import { createProductReportHandlers } from './handlers/reports-produk.ts';
import { createCashierReportHandlers } from './handlers/reports-kasir.ts';
import { createPaymentReportHandlers } from './handlers/reports-pembayaran.ts';
import { createExportHandlers } from './handlers/reports-ekspor.ts';
import { createExceptionReportHandlers } from './handlers/reports-exception.ts';

// Permukaan publik modul ordering (apps/server/src/modules/README.md --
// kepemilikan tabel DITEGAKKAN: order, check, order_line, order_line_modifier,
// refund). `hlc` adalah satu instance Hlc dibuat sekali di buildApp
// (apps/server/src/app.ts) dengan clock nyata di-inject di batas itu --
// bukan dibuat ulang di sini -- supaya monotonisitas server terjaga LINTAS
// request, bukan hanya di dalam satu request (packages/domain/src/hlc.ts).
export function createOrderingHandlers(pool: Pool, hlc: Hlc): Record<string, unknown> {
  return {
    ...createOrderHandlers(pool, hlc),
    ...createCancelHandlers(pool, hlc),
    // Laporan hidup di modul ini karena `order` dan `refund` MILIKNYA
    // (invariant #4). Ia tidak butuh `hlc` — ia hanya membaca.
    ...createReportHandlers(pool),
    ...createProductReportHandlers(pool),
    ...createCashierReportHandlers(pool),
    ...createPaymentReportHandlers(pool),
    ...createExportHandlers(pool),
    ...createExceptionReportHandlers(pool),
  };
}
