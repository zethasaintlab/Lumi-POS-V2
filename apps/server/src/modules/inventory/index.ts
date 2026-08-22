import type { Pool } from '../../db.ts';
import type { Hlc } from '../../../../../packages/domain/src/hlc.ts';
import { createMovementHandlers } from './handlers/movements.ts';
import { createOpnameHandlers } from './handlers/opname.ts';
import { createSoldOutHandlers } from './handlers/habis.ts';

/**
 * Permukaan publik modul `inventory` — Modul E.
 *
 * Sampai 16 Agustus 2026 modul ini hanya berisi dua fungsi dan **nol
 * endpoint**: ia lahir sebagai irisan minimal untuk melayani void dan refund.
 * Akibatnya stok hanya dapat TURUN — tidak ada jalan memasukkan barang ke rak
 * (`PENYELIDIKAN-b12-b13.md` §3). B-13 menutup itu.
 *
 * ## Isi berkas ini dipindahkan ke `handlers/pergerakan.ts`
 *
 * Bukan kosmetik. `handlers/movements.ts` memakai `recordStockMovements`, dan
 * selama fungsi itu tinggal di `index.ts` sementara `index.ts` mengimpor
 * handler-nya, keduanya membentuk **lingkaran impor**. ESM memaafkannya
 * selama pemakaiannya di dalam badan fungsi, tapi itu ketergantungan pada
 * urutan evaluasi yang tidak seorang pun sengaja pilih.
 *
 * Polanya kini sama dengan `catalog`: `index.ts` adalah permukaan publik yang
 * me-re-export, dan isinya hidup di `handlers/`.
 *
 * Perhitungan stok (`SUM(delta)`) TIDAK ada di sini — ia dibaca modul
 * `reporting`, yang boleh menggabungkan `stock_movement` dengan katalog.
 */

export {
  recordStockMovements,
  detectOversell,
  reverseSaleMovements,
} from './handlers/pergerakan.ts';
export type { StockMovementType, StockMovementInput } from './handlers/pergerakan.ts';

export function createInventoryHandlers(pool: Pool, hlc: Hlc): Record<string, unknown> {
  return {
    ...createMovementHandlers(pool, hlc),
    ...createOpnameHandlers(pool, hlc),
    ...createSoldOutHandlers(pool, hlc),
  };
}
