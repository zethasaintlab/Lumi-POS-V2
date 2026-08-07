import { randomUUID } from 'node:crypto';
import type { Pool } from '../../../db.ts';
import { withTenantTransaction } from '../../../db.ts';
import { HttpError } from '../../../http-error.ts';
import { getTenantId, getActorId } from '../../../tenant-context.ts';
import { isPrimaryKeyViolation } from './pg-error.ts';
import { computeRequestHash } from './request-hash.ts';
import { assertUserVisible } from '../../identity/index.ts';
import { recordAuditEvent } from '../../audit/index.ts';
import { recordStockMovements } from '../../inventory/index.ts';
import type { StockMovementInput } from '../../inventory/index.ts';
import {
  findIdempotencyKey,
  claimIdempotencyKey,
  completeIdempotencyKey,
  insertOutboxEvent,
  IdempotencyKeyConflictError,
} from '../../sync/index.ts';
import {
  decideCancellation,
  assertCancellationReason,
} from '../../../../../../packages/domain/src/cancellation.ts';
import type { Hlc } from '../../../../../../packages/domain/src/hlc.ts';
import type { FastifyRequest, FastifyReply } from 'fastify';

// T6-T9 (docs/superpowers/plans/PLAN-void-refund-gateway.md) -- void lewat
// POST /orders/{orderId}/cancel.
//
// ## Satu endpoint, dua operasi
//
// spec-b:235 -- "Kasir tidak memilih 'void' atau 'refund' -- kasir menekan
// 'Batalkan transaksi', dan SISTEM menentukan operasi mana yang berlaku
// berdasarkan state." Karena itu `decideCancellation` (packages/domain) yang
// menjawabnya, bukan sebuah field di body. Responsnya menyebut operasi yang
// dilakukan supaya UI bisa menjelaskannya ke kasir.
//
// Aturannya hidup di domain, bukan di sini, karena AC FR-B7 kelima menuntut
// void dan refund berfungsi OFFLINE -- klien harus memutuskan hal yang sama
// tanpa server.
//
// ## Kenapa order asli tidak disentuh sama sekali
//
// AC FR-B7 pertama: "Tidak ada UPDATE pada `order` asli saat void maupun
// refund", dan invariant #2 mengatakan hal yang sama untuk seluruh transaksi
// selesai. Void karena itu MENAMBAH baris order berstatus `voided`, dan
// `voided_by_order_id` ada di baris PEMBATAL menunjuk order yang dibatalkan.
//
// Pembacaan sebaliknya -- kolom di order asli menunjuk pembatalnya -- menuntut
// UPDATE pada order asli, karena pembatalnya belum ada saat order asli
// ditulis. Namanya memang terbaca terbalik untuk pembacaan yang tersisa ini;
// itu dicatat sebagai temuan di HANDOFF.md, bukan dibetulkan diam-diam.
//
// ## Invariant #1
//
// Order pembatal + seluruh stock_movement + audit_event + outbox +
// idempotency_key ditulis dalam SATU withTenantTransaction. Restock dan audit
// bukan efek samping yang boleh menyusul: keputusan user 1 Agustus 2026
// menghapus PIN manajer dari void, jadi keduanya adalah kontrol yang tersisa.

interface CancelInput {
  id: string;
  receiptNumber: string;
  sequence: number;
  reasonCode: string;
  reasonNote?: string | null;
  hlc?: string;
  occurredAt?: string;
}

interface OrderRow {
  id: string;
  tenant_id: string;
  outlet_id: string;
  device_id: string;
  shift_id: string;
  receipt_number: string;
  business_date: string;
  sequence: number;
  status: string;
  channel: string;
  subtotal: string;
  order_discount: string;
  service_charge_amount: string;
  tax_amount: string;
  rounding_adjustment: string;
  total: string;
  amount_due: string;
  voided_by_order_id: string | null;
  created_by: string;
  occurred_at: Date;
  recorded_at: Date;
  hlc: string;
}

interface LineRow {
  id: string;
  variation_id: string;
  quantity: string;
  cost_at_sale: string;
}

// Bentuk sama dengan assertHlcValid di handlers/orders.ts -- hlc adalah
// bilangan 57-bit yang melebihi presisi double JSON, jadi ia string dan
// bentuknya tidak bisa divalidasi lewat JSON Schema.
const HLC_PATTERN = /^\d+$/;

const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
function getIdempotencyKeyHeader(req: FastifyRequest): string {
  const header = req.headers['idempotency-key'];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value || value.length === 0 || value.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new HttpError(400, 'MISSING_IDEMPOTENCY_KEY', 'Header Idempotency-Key wajib diisi.');
  }
  return value;
}

const RECEIPT_SEQUENCE_CONSTRAINT = 'order_device_id_business_date_sequence_key';
const VOIDED_BY_UNIQUE_CONSTRAINT = 'ux_order_voided_by';

function translateConstraintError(err: unknown): never {
  const pgErr = err as { code?: string; constraint?: string };
  if (pgErr.code === '23505' && pgErr.constraint === VOIDED_BY_UNIQUE_CONSTRAINT) {
    // Balapan: dua pembatalan bersamaan atas order yang sama, dengan
    // Idempotency-Key berbeda. SELECT di bawah menangkap kasus normal; index
    // unik menangkap yang ini, dan pesannya harus sama supaya klien tidak
    // perlu membedakan keduanya.
    throw new HttpError(409, 'ORDER_ALREADY_VOIDED', 'Order ini sudah dibatalkan.');
  }
  if (pgErr.code === '23505' && pgErr.constraint === RECEIPT_SEQUENCE_CONSTRAINT) {
    throw new HttpError(
      409,
      'RECEIPT_SEQUENCE_TAKEN',
      'Nomor struk ini sudah dipakai untuk device dan tanggal bisnis yang sama.'
    );
  }
  if (isPrimaryKeyViolation(err)) {
    throw new HttpError(409, 'ID_ALREADY_EXISTS', 'Baris dengan id ini sudah ada.');
  }
  throw err;
}

// Order pembatal menyalin outlet/device/shift/channel/tanggal bisnis dari
// order yang dibatalkan -- ia bukan penjualan baru, ia catatan pembatalan yang
// harus bisa dibaca sendirian. Nilai uangnya juga disalin, bukan nol: baris
// ini menyatakan "penjualan sebesar sekian dibatalkan". Laporan penjualan
// mengecualikannya lewat `status = 'voided'` (AC FR-B7 keenam), bukan lewat
// nilai nol -- nol akan membuat void mustahil dibedakan dari order kosong.
//
// `occurred_at` memakai jam DATABASE bila klien tidak mengirimnya. Bukan
// new Date() di Node: dua jam yang berbeda sudah pernah menyebabkan bug nyata
// di repo ini (CLAUDE.md § Keputusan yang mengikat kode ordering).
const INSERT_VOID_ORDER_SQL = `
  INSERT INTO "order" (
    id, tenant_id, outlet_id, device_id, shift_id, receipt_number, business_date, sequence,
    status, channel, subtotal, order_discount, service_charge_amount, tax_amount,
    rounding_adjustment, total, amount_due, voided_by_order_id, created_by, occurred_at, hlc
  )
  SELECT
    $1, tenant_id, outlet_id, device_id, shift_id, $2, business_date, $3,
    'voided', channel, subtotal, order_discount, service_charge_amount, tax_amount,
    rounding_adjustment, total, amount_due, id, $4, COALESCE($5::timestamptz, now()), $6
  FROM "order" WHERE id = $7
  RETURNING *
`;

function toCancelledOrder(row: OrderRow) {
  return {
    id: row.id,
    outletId: row.outlet_id,
    deviceId: row.device_id,
    shiftId: row.shift_id,
    receiptNumber: row.receipt_number,
    businessDate: row.business_date,
    sequence: row.sequence,
    status: row.status,
    channel: row.channel,
    subtotal: Number(row.subtotal),
    orderDiscount: Number(row.order_discount),
    serviceChargeAmount: Number(row.service_charge_amount),
    taxAmount: Number(row.tax_amount),
    roundingAdjustment: Number(row.rounding_adjustment),
    total: Number(row.total),
    amountDue: Number(row.amount_due),
    voidedByOrderId: row.voided_by_order_id,
    createdBy: row.created_by,
    occurredAt: row.occurred_at,
    recordedAt: row.recorded_at,
    hlc: row.hlc,
  };
}

export function createCancelHandlers(pool: Pool, hlc: Hlc): Record<string, unknown> {
  return {
    async cancelOrder(req: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const idempotencyKey = getIdempotencyKeyHeader(req);
      const { orderId } = req.params as { orderId: string };
      const body = req.body as CancelInput;
      const requestHash = computeRequestHash(body);

      if (body.hlc !== undefined && (typeof body.hlc !== 'string' || !HLC_PATTERN.test(body.hlc))) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'hlc harus string berisi bilangan bulat desimal.');
      }

      const hlcValue = body.hlc !== undefined ? hlc.update(BigInt(body.hlc)) : hlc.tick();

      const result = await withTenantTransaction(pool, tenantId, async (client) => {
        // Idempotency dicek DAN diklaim di dalam transaksi yang sama dengan
        // penulisan -- alasan urutannya persis sama dengan createOrder
        // (handlers/orders.ts): kalau key ditulis paling akhir, PK order
        // pembatal yang memenangkan balapan dan klien menerima
        // ID_ALREADY_EXISTS alih-alih 409 idempotency dengan instruksi retry.
        const existing = await findIdempotencyKey(client, idempotencyKey);
        if (existing !== null) {
          if (existing.requestHash !== requestHash) {
            throw new HttpError(
              422,
              'IDEMPOTENCY_KEY_HASH_MISMATCH',
              `Idempotency-Key ${idempotencyKey} sudah dipakai untuk request dengan body yang berbeda.`
            );
          }
          return { status: existing.responseStatus, body: existing.responseBody };
        }
        try {
          await claimIdempotencyKey(client, { key: idempotencyKey, tenantId, requestHash });
        } catch (err) {
          if (err instanceof IdempotencyKeyConflictError) {
            throw new HttpError(
              409,
              'IDEMPOTENCY_KEY_CONFLICT',
              `Request dengan Idempotency-Key ${idempotencyKey} sedang diproses request lain, coba lagi.`
            );
          }
          throw err;
        }

        // SELECT yang tunduk RLS -- satu-satunya yang membuktikan order ini
        // milik tenant pemanggil. FK tidak membuktikannya (temuan F1,
        // CLAUDE.md), dan di sini bahkan tidak ada FK: orderId datang dari
        // path.
        const { rows } = await client.query<OrderRow>('SELECT * FROM "order" WHERE id = $1', [orderId]);
        if (rows.length === 0) {
          throw new HttpError(404, 'NOT_FOUND', `Order ${orderId} tidak ditemukan.`);
        }
        const asli = rows[0];

        // Sistem yang memilih, bukan klien (AC FR-B7 kedua). Aturannya di
        // domain supaya klien offline memutuskan hal yang sama.
        let operation: 'void' | 'refund';
        try {
          operation = decideCancellation(asli.status);
        } catch (err) {
          throw new HttpError(409, 'ORDER_NOT_CANCELLABLE', (err as Error).message);
        }
        if (operation === 'refund') {
          // T10-T13 -- belum digarap. Menolak dengan jelas lebih baik daripada
          // diam-diam mem-void order yang sudah CLOSED, yang akan mengeluarkan
          // penjualan sah dari omzet.
          throw new HttpError(501, 'NOT_IMPLEMENTED', 'Refund belum tersedia; order ini sudah CLOSED.');
        }

        try {
          assertCancellationReason(operation, body.reasonCode, body.reasonNote);
        } catch (err) {
          throw new HttpError(400, 'VALIDATION_ERROR', (err as Error).message);
        }

        await assertUserVisible(client, actorId);

        // Order asli TETAP `open` setelah di-void (tidak ada UPDATE), jadi
        // tidak ada apa pun di statusnya yang menolak void kedua. Yang
        // menolaknya adalah pemeriksaan ini -- dan, saat dua permintaan
        // berbarengan lolos bersama di READ COMMITTED, index unik
        // ux_order_voided_by (migrasi 0017).
        const { rows: sudah } = await client.query<{ id: string }>(
          'SELECT id FROM "order" WHERE voided_by_order_id = $1',
          [orderId]
        );
        if (sudah.length > 0) {
          throw new HttpError(409, 'ORDER_ALREADY_VOIDED', `Order ${orderId} sudah dibatalkan.`);
        }

        let voidOrder: OrderRow;
        try {
          const { rows: inserted } = await client.query<OrderRow>(INSERT_VOID_ORDER_SQL, [
            body.id,
            body.receiptNumber,
            body.sequence,
            actorId,
            body.occurredAt ?? null,
            hlcValue.toString(),
            orderId,
          ]);
          voidOrder = inserted[0];
        } catch (err) {
          translateConstraintError(err);
        }

        // Restock (keputusan user 1 Agu 2026: void WAJIB mengembalikan stok
        // otomatis). Satu pergerakan per baris, delta POSITIF sebesar
        // kuantitas yang terjual -- stok adalah SUM(delta), tidak ada kolom
        // quantity yang di-UPDATE (CLAUDE.md § Konvensi data).
        const { rows: lines } = await client.query<LineRow>(
          'SELECT id, variation_id, quantity, cost_at_sale FROM order_line WHERE order_id = $1 ORDER BY occurred_at, id',
          [orderId]
        );
        const movements: StockMovementInput[] = lines.map((line) => ({
          id: randomUUID(),
          tenantId,
          outletId: asli.outlet_id,
          deviceId: asli.device_id,
          variationId: line.variation_id,
          type: 'void',
          delta: BigInt(line.quantity),
          // Menunjuk order yang DIBATALKAN, bukan pembatalnya: pergerakan ini
          // membalik penjualan itu, dan laporan stok mencarinya dari sana.
          orderId,
          reasonCode: body.reasonCode,
          note: body.reasonNote ?? null,
          unitCost: BigInt(line.cost_at_sale),
          createdBy: actorId,
          hlc: hlcValue,
          occurredAt: voidOrder.occurred_at.toISOString(),
        }));
        await recordStockMovements(client, movements);

        // Audit. Untuk void ini bukan pelengkap -- keputusan 1 Agu 2026
        // menghapus PIN manajer, jadi alasan daftar tertutup + audit adalah
        // kontrol yang tersisa. `approver_user_id` NULL, dan header
        // X-Approver-Id sengaja TIDAK dibaca di jalur ini.
        await recordAuditEvent(client, {
          id: randomUUID(),
          tenantId,
          outletId: asli.outlet_id,
          deviceId: asli.device_id,
          actorUserId: actorId,
          approverUserId: null,
          eventType: 'order.voided',
          entityType: 'order',
          entityId: orderId,
          reasonCode: body.reasonCode,
          reasonNote: body.reasonNote ?? null,
          before: { status: asli.status, total: Number(asli.total) },
          after: { voidOrderId: voidOrder.id, status: 'voided' },
          hlc: hlcValue,
          occurredAt: voidOrder.occurred_at.toISOString(),
        });

        const responseBody = {
          operation,
          cancelledOrderId: orderId,
          order: toCancelledOrder(voidOrder),
        };

        await insertOutboxEvent(client, {
          id: randomUUID(),
          tenantId,
          aggregateType: 'order',
          aggregateId: voidOrder.id,
          eventType: 'order.voided',
          payload: responseBody,
        });

        await completeIdempotencyKey(client, { key: idempotencyKey, responseStatus: 201, responseBody });

        return { status: 201, body: responseBody as unknown };
      });

      reply.code(result.status);
      return result.body;
    },
  };
}
