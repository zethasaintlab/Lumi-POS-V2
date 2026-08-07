import type { PoolClient } from '../../db.ts';
import { HttpError } from '../../http-error.ts';

/**
 * Permukaan publik modul `inventory` — irisan minimal Modul E.
 *
 * Lahir dengan satu fungsi. Keputusan user 1 Agustus 2026 menetapkan void
 * **wajib** mengembalikan stok otomatis, dan invariant #1 menuntutnya ditulis
 * dalam transaksi yang SAMA dengan void — bukan sebagai event asinkron.
 * Invariant #4 melarang modul `ordering` menyentuh `stock_movement` langsung.
 *
 * Perhitungan stok (`SUM(stock_movement.delta)` — `CLAUDE.md` menegaskan
 * **tidak ada kolom `quantity`**), stocktake, deteksi oversell, dan sold-out
 * tetap Modul E penuh.
 */

export type StockMovementType =
  | 'sale'
  | 'void'
  | 'refund'
  | 'receipt'
  | 'adjustment'
  | 'stocktake'
  | 'transfer_in'
  | 'transfer_out';

export interface StockMovementInput {
  id: string;
  tenantId: string;
  outletId: string;
  deviceId: string | null;
  variationId: string;
  type: StockMovementType;
  /**
   * Kuantitas ×1000, **bertanda** (`CLAUDE.md` § Konvensi data).
   *
   * Void dan refund MENGEMBALIKAN stok, jadi positif. Penjualan negatif.
   * `bigint`, bukan `number`: kuantitas ikut aturan yang sama dengan uang.
   */
  delta: bigint;
  orderId: string | null;
  reasonCode: string | null;
  note?: string | null;
  unitCost?: bigint | null;
  createdBy: string;
  hlc: bigint;
  occurredAt?: string | null;
}

/**
 * Menulis pergerakan stok, seluruhnya atau tidak sama sekali.
 *
 * ## `variation_id` TIDAK punya FK
 *
 * Lihat `db/migrations/0010_inventory.sql`: `variation_id` adalah `text NOT
 * NULL` tanpa referensi. Bukan sekadar FK yang tidak tunduk RLS (temuan F1) —
 * di sini tidak ada apa pun di database yang menolak id karangan, apalagi id
 * milik tenant lain. Kelas yang sama dengan `price_history.changed_by` dan
 * `tax_rate.applies_to_ids`, dan sama berbahayanya karena tidak ada yang
 * TERLIHAT menjaganya.
 *
 * Validasinya karena itu memeriksa SELURUH daftar dalam satu SELECT yang
 * tunduk RLS, dan menolak seluruhnya bila ada satu yang tidak sah. Menerima
 * sebagian akan mencatat pergerakan stok yang separuh menunjuk data tenant
 * lain — terlihat berhasil, dan itu bentuk kegagalan yang lebih buruk
 * daripada ditolak.
 */
export async function recordStockMovements(
  client: PoolClient,
  movements: ReadonlyArray<StockMovementInput>
): Promise<void> {
  if (movements.length === 0) {
    return;
  }

  const variationIds = [...new Set(movements.map((m) => m.variationId))];
  const { rows: visible } = await client.query<{ id: string }>(
    'SELECT id FROM item_variation WHERE id = ANY($1::text[])',
    [variationIds]
  );
  const terlihat = new Set(visible.map((r) => r.id));
  const hilang = variationIds.filter((id) => !terlihat.has(id));
  if (hilang.length > 0) {
    throw new HttpError(404, 'VARIATION_NOT_FOUND', `Variation tidak ditemukan: ${hilang.join(', ')}.`);
  }

  for (const m of movements) {
    if (typeof m.delta !== 'bigint') {
      throw new TypeError(`delta harus bigint, bukan ${typeof m.delta}. Kuantitas x1000, bertanda.`);
    }
    await client.query(
      `INSERT INTO stock_movement (
         id, tenant_id, outlet_id, device_id, variation_id, type, delta,
         order_id, reason_code, note, unit_cost, created_by, occurred_at, hlc
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7,
         $8, $9, $10, $11, $12, COALESCE($13::timestamptz, now()), $14
       )`,
      [
        m.id, m.tenantId, m.outletId, m.deviceId, m.variationId, m.type, m.delta.toString(),
        m.orderId, m.reasonCode, m.note ?? null,
        m.unitCost === undefined || m.unitCost === null ? null : m.unitCost.toString(),
        m.createdBy, m.occurredAt ?? null, m.hlc.toString(),
      ]
    );
  }
}
