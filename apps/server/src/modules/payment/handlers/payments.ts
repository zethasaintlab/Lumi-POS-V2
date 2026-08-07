import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from '../../../db.ts';
import { withTenantTransaction } from '../../../db.ts';
import { HttpError } from '../../../http-error.ts';
import { getTenantId, getActorId } from '../../../tenant-context.ts';
import { isPrimaryKeyViolation } from './pg-error.ts';
import { getOutletSettings } from '../../tenancy/index.ts';
import {
  findIdempotencyKey,
  claimIdempotencyKey,
  completeIdempotencyKey,
  insertOutboxEvent,
  IdempotencyKeyConflictError,
} from '../../sync/index.ts';
import { computeCashRounding } from '../../../../../../packages/domain/src/money.ts';
import { assertTransition } from '../../../../../../packages/domain/src/order-state.ts';
import type { Hlc } from '../../../../../../packages/domain/src/hlc.ts';
import type { FastifyRequest, FastifyReply } from 'fastify';

// T13-T17 (docs/superpowers/plans/PLAN-pembayaran-pajak.md) -- pembayaran
// tunai, dan separuh state machine order yang selama ini menganggur:
// OPEN -> PAID -> CLOSED.
//
// SATU transaksi (invariant #1): payment + perubahan status order + outbox +
// idempotency_key. Memecahnya berarti ada jendela di mana uang tercatat tapi
// order masih OPEN, atau sebaliknya.

interface PaymentRow {
  id: string;
  order_id: string;
  check_id: string;
  method: string;
  amount: string;
  tendered_amount: string | null;
  change_amount: string | null;
  status: string;
  confirmed_manually: boolean;
  tendered_at: string;
  created_by: string;
  occurred_at: string;
  hlc: string;
}

interface OrderStateRow {
  id: string;
  check_id: string;
  status: string;
  total: string;
  tax_amount: string;
  outlet_id: string;
}

interface PaymentInput {
  id: string;
  method?: string;
  tenderedAmount: unknown;
  occurredAt?: string;
  hlc?: string;
}

function toPayment(row: PaymentRow) {
  return {
    id: row.id,
    orderId: row.order_id,
    checkId: row.check_id,
    method: row.method,
    amount: Number(row.amount),
    tenderedAmount: row.tendered_amount === null ? null : Number(row.tendered_amount),
    changeAmount: row.change_amount === null ? null : Number(row.change_amount),
    status: row.status,
    confirmedManually: row.confirmed_manually,
    tenderedAt: row.tendered_at,
    createdBy: row.created_by,
    occurredAt: row.occurred_at,
    hlc: row.hlc,
  };
}

// Sub-project C-1 hanya tunai. QRIS statis butuh kontrol anti-fraud wajib
// (FR-C2: field referensi, confirmed_manually, penanda di struk, laporan
// exception) dan QRIS dinamis butuh gateway -- keduanya C-2. Menerimanya
// sekarang berarti membangun separuh FR-C2 tanpa kontrol yang menyertainya.
const SUPPORTED_METHODS = new Set(['cash']);

function assertMethodSupported(method: string): void {
  if (!SUPPORTED_METHODS.has(method)) {
    throw new HttpError(
      400,
      'PAYMENT_METHOD_UNSUPPORTED',
      `Metode "${method}" belum didukung; baru pembayaran tunai (cash) yang tersedia.`
    );
  }
}

// Pola sama dengan assertOpeningFloatValid (cash/handlers/shifts.ts) dan
// assertPriceValid (catalog/handlers/prices.ts): typeof + Number.isInteger
// dicek eksplisit supaya string, float pecahan, null, NaN, dan Infinity
// semuanya ditolak. Uang = bigint rupiah utuh, tidak pernah float.
function assertTenderedAmountValid(value: unknown): asserts value is number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value <= 0 ||
    value > Number.MAX_SAFE_INTEGER
  ) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      'tenderedAmount harus bilangan bulat rupiah > 0 (uang yang diserahkan pelanggan).'
    );
  }
}

const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
function getIdempotencyKeyHeader(req: FastifyRequest): string {
  const header = req.headers['idempotency-key'];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value || value.length === 0 || value.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new HttpError(400, 'MISSING_IDEMPOTENCY_KEY', 'Header Idempotency-Key wajib diisi.');
  }
  return value;
}

// SUM hanya atas payment `confirmed` -- spec-c:223. Payment yang masih
// pending_confirmation (QRIS dinamis, C-2) belum boleh melunasi order.
async function sumConfirmed(client: PoolClient, orderId: string): Promise<bigint> {
  const { rows } = await client.query<{ total: string | null }>(
    `SELECT SUM(amount)::text AS total FROM payment
      WHERE order_id = $1 AND status = 'confirmed'`,
    [orderId]
  );
  return rows[0].total === null ? 0n : BigInt(rows[0].total);
}

export function createPaymentEntryHandlers(pool: Pool, hlc: Hlc) {
  return {
    async createPayment(req: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const idempotencyKey = getIdempotencyKeyHeader(req);
      const { orderId } = req.params as { orderId: string };
      const body = req.body as PaymentInput;

      const method = body.method ?? 'cash';
      assertMethodSupported(method);
      assertTenderedAmountValid(body.tenderedAmount);

      const hlcValue = body.hlc === undefined ? hlc.tick() : hlc.update(BigInt(body.hlc));

      const result = await withTenantTransaction(pool, tenantId, async (client) => {
        // Idempotency di-CLAIM lebih dulu, sama alasannya dengan createOrder
        // (lihat sync/index.ts): kalau key ditulis terakhir, PK milik payment
        // sendiri yang memenangkan balapan dan klien menerima
        // ID_ALREADY_EXISTS alih-alih respons asli.
        const existing = await findIdempotencyKey(client, idempotencyKey);
        if (existing !== null) {
          return { kind: 'cached' as const, record: existing };
        }

        // FOR UPDATE: dua pembayaran bersamaan untuk order yang sama harus
        // diserialkan, kalau tidak keduanya membaca outstanding yang sama dan
        // order bisa terbayar dua kali. READ COMMITTED tidak cukup di sini.
        const { rows: orderRows } = await client.query<OrderStateRow>(
          `SELECT o.id, o.status, o.total, o.tax_amount, o.outlet_id, c.id AS check_id
             FROM "order" o JOIN "check" c ON c.order_id = o.id
            WHERE o.id = $1 FOR UPDATE OF o`,
          [orderId]
        );
        if (orderRows.length === 0) {
          throw new HttpError(404, 'ORDER_NOT_FOUND', `Order ${orderId} tidak ditemukan.`);
        }
        const order = orderRows[0];

        const total = BigInt(order.total);
        const sudahDibayar = await sumConfirmed(client, orderId);
        const outstanding = total - sudahDibayar;

        // Order yang sudah lunas tidak menerima pembayaran lagi. Ditegakkan
        // lewat state machine domain (assertTransition), BUKAN if di sini --
        // AC FR-B1 pertama: "ditolak di lapisan domain, bukan hanya UI", dan
        // klien offline harus menerapkan aturan yang sama persis.
        try {
          assertTransition(order.status, 'paid');
        } catch (err) {
          throw new HttpError(409, 'ORDER_NOT_PAYABLE', (err as Error).message);
        }

        const settings = await getOutletSettings(client, order.outlet_id);
        const { roundedOutstanding, roundingAdjustment } = computeCashRounding({
          outstanding,
          roundingIncrement: settings.roundingIncrement,
          roundingMode: settings.roundingMode,
        });

        const tendered = BigInt(body.tenderedAmount as number);
        const melunasi = tendered >= roundedOutstanding;
        // Kelebihan tunai adalah KEMBALIAN, bukan payment negatif
        // (spec-c:224). Kurang bayar memakai seluruh yang diserahkan dan
        // menyisakan tagihan.
        const amount = melunasi ? roundedOutstanding : tendered;
        const change = melunasi ? tendered - roundedOutstanding : 0n;

        await claimIdempotencyKey(client, { key: idempotencyKey, tenantId, requestHash: `${orderId}:${body.id}` });

        let paymentRow: PaymentRow;
        try {
          const { rows } = await client.query<PaymentRow>(
            `INSERT INTO payment (
               id, tenant_id, outlet_id, device_id, order_id, check_id, method, amount,
               tendered_amount, change_amount, status, confirmed_manually,
               tendered_at, created_by, occurred_at, hlc
             )
             SELECT $1, $2, o.outlet_id, o.device_id, o.id, $3, $4, $5,
                    $6, $7, 'confirmed', false,
                    now(), $8, COALESCE($9::timestamptz, now()), $10
               FROM "order" o WHERE o.id = $11
             RETURNING *`,
            [
              body.id, tenantId, order.check_id, method, amount.toString(),
              tendered.toString(), change.toString(), actorId,
              body.occurredAt ?? null, hlcValue.toString(), orderId,
            ]
          );
          paymentRow = rows[0];
        } catch (err) {
          if (isPrimaryKeyViolation(err)) {
            throw new HttpError(409, 'ID_ALREADY_EXISTS', `Payment dengan id ${body.id} sudah ada.`);
          }
          throw err;
        }

        // Hanya order yang LUNAS berpindah status. Pembulatan pun hanya
        // dicatat saat itu -- FR-C9: pembulatan berlaku pada sisa yang
        // dibayar tunai, dan sisa itu baru final ketika order tertutup.
        let statusBaru = order.status;
        if (melunasi) {
          assertTransition('paid', 'closed');
          statusBaru = 'closed';
          await client.query(
            `UPDATE "order"
                SET status = 'closed',
                    rounding_adjustment = $2,
                    amount_due = total + $2
              WHERE id = $1`,
            [orderId, roundingAdjustment.toString()]
          );
        }

        await insertOutboxEvent(client, {
          id: randomUUID(),
          tenantId,
          aggregateType: 'payment',
          aggregateId: paymentRow.id,
          eventType: 'payment.recorded',
          payload: { orderId, amount: amount.toString(), method },
        });

        const sisaAkhir = melunasi ? 0n : outstanding - amount;
        const responseBody = {
          payment: toPayment(paymentRow),
          order: {
            id: orderId,
            status: statusBaru,
            total: Number(total),
            // Disertakan supaya kasir bisa memverifikasi AC FR-C9: pembulatan
            // TIDAK mengubah pajak. Dibaca dari baris order, bukan dihitung.
            taxAmount: Number(order.tax_amount),
            roundingAdjustment: melunasi ? Number(roundingAdjustment) : 0,
            amountDue: melunasi ? Number(total + roundingAdjustment) : Number(total),
          },
          outstanding: Number(sisaAkhir),
        };

        await completeIdempotencyKey(client, { key: idempotencyKey, responseStatus: 201, responseBody });
        return { kind: 'fresh' as const, body: responseBody };
      }).catch((err) => {
        if (err instanceof IdempotencyKeyConflictError) {
          throw new HttpError(409, 'IDEMPOTENCY_KEY_CONFLICT', 'Permintaan dengan key ini sedang diproses. Coba lagi.');
        }
        throw err;
      });

      if (result.kind === 'cached') {
        // Mengembalikan response_status YANG TERSIMPAN (jadi 201), bukan 200 --
        // interpretasi yang sama dengan createOrder, dicatat di HANDOFF.md
        // sebagai [ASUMSI] yang belum diputuskan user.
        reply.code(result.record.responseStatus);
        return result.record.responseBody;
      }
      reply.code(201);
      return result.body;
    },
  };
}
