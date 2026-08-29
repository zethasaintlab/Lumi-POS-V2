import { randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from '../../../db.ts';
import { withTenantTransaction } from '../../../db.ts';
import { HttpError } from '../../../http-error.ts';
import { getActorId, getTenantId } from '../../../tenant-context.ts';
import { catatPerubahanServer } from '../../audit/index.ts';
import type { Hlc } from '../../../../../../packages/domain/src/hlc.ts';
import { assertUserVisible, assertBoleh } from '../../identity/index.ts';
import { assertOutletVisible } from '../../tenancy/index.ts';
import { recordStockMovements, type StockMovementType } from './pergerakan.ts';

/**
 * `POST /inventory/movements` — B-13, satu-satunya jalan MEMASUKKAN stok.
 *
 * Sampai endpoint ini ada, server hanya pernah menulis `sale`, `void`, dan
 * `refund`: stok hanya dapat TURUN, dan setiap variation yang dilacak mulai
 * dari nol lalu langsung negatif pada penjualan pertama
 * (`PENYELIDIKAN-b12-b13.md` §3).
 *
 * ## Dua tipe, dan hanya dua
 *
 * | Tipe | Delta | Untuk |
 * |---|---|---|
 * | `receipt` | **wajib positif** | barang masuk dari pemasok |
 * | `adjustment` | bertanda | koreksi selisih, **wajib beralasan** |
 *
 * `sale`, `void`, dan `refund` sengaja **ditolak** di sini: ketiganya lahir
 * dari transaksi penjualan, di transaksi database yang sama dengannya
 * (invariant #1). Menerimanya lewat endpoint manual membuka jalan menulis
 * pergerakan penjualan tanpa penjualannya.
 *
 * `stocktake` juga ditolak — ia hasil opname (B-14), dan menulisnya tanpa
 * `stocktake_id` menghasilkan baris yang tidak dapat dilacak ke hitungan
 * fisik mana pun.
 *
 * ## ⛔ `receipt` tidak boleh negatif
 *
 * Tanpa aturan ini, `receipt` bernilai negatif menjadi cara mengurangi stok
 * **tanpa alasan** — persis yang `adjustment` diwajibkan menyertakannya.
 * Aturan alasan yang dapat dilewati dengan mengganti satu kata bukan aturan.
 */

const TIPE_DIIZINKAN: readonly StockMovementType[] = ['receipt', 'adjustment'];

interface Badan {
  id?: string;
  outletId?: string;
  variationId?: string;
  type?: string;
  /** Kuantitas ×1000, bertanda. STRING — kuantitas ikut aturan uang. */
  delta?: string | number;
  reasonCode?: string | null;
  note?: string | null;
  unitCost?: string | number | null;
}

function assertDelta(nilai: unknown): bigint {
  if (nilai === undefined || nilai === null || nilai === '') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'delta wajib diisi (kuantitas ×1000, bertanda).');
  }
  let d: bigint;
  try {
    // ⛔ Lewat `BigInt`, tidak pernah `Number`. Kuantitas ×1000 melampaui 2^53
    // pada nilai yang masih masuk akal untuk gudang, dan pembulatan diam-diam
    // di jalur stok punya akibat yang sama dengan di jalur uang.
    d = typeof nilai === 'bigint' ? nilai : BigInt(String(nilai).trim());
  } catch {
    throw new HttpError(400, 'VALIDATION_ERROR', 'delta harus bilangan bulat (kuantitas ×1000).');
  }
  if (d === 0n) {
    // Movement bernilai nol tidak mengubah apa pun dan hanya menambah baris
    // yang harus dibaca orang berikutnya.
    throw new HttpError(400, 'VALIDATION_ERROR', 'delta tidak boleh nol.');
  }
  return d;
}

export function createMovementHandlers(pool: Pool, hlc: Hlc): Record<string, unknown> {
  return {
    async createStockMovement(req: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const body = (req.body ?? {}) as Badan;

      const tipe = body.type as StockMovementType;
      if (!TIPE_DIIZINKAN.includes(tipe)) {
        throw new HttpError(
          400,
          'VALIDATION_ERROR',
          `type harus salah satu dari: ${TIPE_DIIZINKAN.join(', ')}. ` +
            'Pergerakan sale/void/refund hanya lahir dari transaksi penjualan.'
        );
      }
      if (typeof body.outletId !== 'string' || body.outletId === '') {
        throw new HttpError(400, 'VALIDATION_ERROR', 'outletId wajib diisi.');
      }
      if (typeof body.variationId !== 'string' || body.variationId === '') {
        throw new HttpError(400, 'VALIDATION_ERROR', 'variationId wajib diisi.');
      }

      const delta = assertDelta(body.delta);

      // ⛔ AC FR-E2: "`adjustment` tanpa `reason_code` ditolak."
      const reasonCode = typeof body.reasonCode === 'string' ? body.reasonCode.trim() : '';
      if (tipe === 'adjustment' && reasonCode === '') {
        throw new HttpError(
          400,
          'VALIDATION_ERROR',
          'adjustment wajib menyertakan reasonCode — koreksi tanpa alasan tidak dapat diaudit.'
        );
      }
      if (tipe === 'receipt' && delta < 0n) {
        throw new HttpError(
          400,
          'VALIDATION_ERROR',
          'receipt harus positif. Untuk mengurangi stok pakai adjustment, yang wajib beralasan.'
        );
      }

      return withTenantTransaction(pool, tenantId, async (client) => {
        await assertUserVisible(client, actorId);
        await assertBoleh(client, actorId, 'stock_adjust', 'mencatat pergerakan stok');
        // FK klien-suplai: outlet divalidasi lewat SELECT yang tunduk RLS
        // (temuan F1). `variationId` divalidasi di dalam `recordStockMovements`,
        // yang memang lahir untuk itu — kolomnya tidak punya FK sama sekali.
        await assertOutletVisible(client, body.outletId as string);

        const id = typeof body.id === 'string' && body.id !== '' ? body.id : randomUUID();
        await recordStockMovements(client, [
          {
            id,
            tenantId,
            outletId: body.outletId as string,
            // Penyesuaian dari back-office tidak berasal dari perangkat kasir.
            deviceId: null,
            variationId: body.variationId as string,
            type: tipe,
            delta,
            orderId: null,
            reasonCode: reasonCode === '' ? null : reasonCode,
            note: typeof body.note === 'string' && body.note.trim() !== '' ? body.note.trim() : null,
            unitCost:
              body.unitCost === undefined || body.unitCost === null || body.unitCost === ''
                ? null
                : BigInt(String(body.unitCost)),
            createdBy: actorId,
            hlc: hlc.tick(),
          },
        ]);

        // FR-F6 + `spec-f:296` (`stock_adjusted`). Di dalam transaksi yang
        // sama (AC ketiga).
        //
        // ⛔ `delta` DAN alasannya, bukan stok akhirnya. Stok adalah
        // `SUM(stock_movement.delta)` dan tidak punya kolom (`CLAUDE.md`);
        // menuliskan "stok akhir" ke audit berarti angka kedua yang harus
        // dijaga sepakat dengan ledger-nya, dan yang menyimpang di antaranya
        // tidak dapat diputuskan mana yang benar.
        await catatPerubahanServer(client, {
          tenantId,
          actorUserId: actorId,
          eventType: 'stock_adjusted',
          entityType: 'item_variation',
          entityId: body.variationId as string,
          outletId: body.outletId as string,
          after: {
            movementId: id,
            type: tipe,
            delta: delta.toString(),
            reasonCode: reasonCode === '' ? null : reasonCode,
          },
        });

        // 201: sumber daya baru dibuat. Tanpa ini Fastify menjawab 200, dan
        // klien yang membedakan keduanya tidak dapat tahu barisnya tertulis.
        reply.code(201);
        return {
          id,
          outletId: body.outletId,
          variationId: body.variationId,
          type: tipe,
          delta: delta.toString(),
          reasonCode: reasonCode === '' ? null : reasonCode,
        };
      });
    },
  };
}
