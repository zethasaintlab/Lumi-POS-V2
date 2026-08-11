import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from '../../../db.ts';
import { withTenantTransaction } from '../../../db.ts';
import { HttpError } from '../../../http-error.ts';
import { getTenantId, getActorId, getApproverId } from '../../../tenant-context.ts';
import { isPrimaryKeyViolation } from './pg-error.ts';
import { computeRequestHash } from './request-hash.ts';
import { assertUserVisible, assertApproverVisible, assertBoleh } from '../../identity/index.ts';
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
  assertRefundWithinLimit,
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

interface RefundLineInput {
  lineId: string;
  quantityMilli: unknown;
}

// Satu bentuk body untuk dua operasi, karena endpoint-nya satu (spec-b:235 --
// kasir menekan satu tombol). Field mana yang wajib bergantung pada operasi
// yang DIPILIH SERVER, jadi kontrak OpenAPI hanya mewajibkan `id` dan
// `reasonCode`; sisanya divalidasi di sini. Pola yang sama dengan seluruh
// validasi uang/kuantitas di repo ini -- JSON Schema tidak bisa menyatakan
// "wajib bila server memutuskan X".
interface CancelInput {
  id: string;
  reasonCode: string;
  reasonNote?: string | null;
  /** Void saja: nomor struk dan urutan order pembatal. */
  receiptNumber?: string;
  sequence?: number;
  /** Refund saja: nominal yang dikembalikan, rupiah utuh. */
  amount?: unknown;
  /** Refund parsial: baris mana yang dikembalikan. Kosong = seluruh order. */
  lines?: RefundLineInput[];
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

interface RefundRow {
  id: string;
  order_id: string;
  amount: string;
  reason_code: string;
  reason_note: string | null;
  created_by: string;
  approved_by: string;
  occurred_at: Date;
  recorded_at: Date;
  hlc: string;
}

// Bentuk sama dengan assertHlcValid di handlers/orders.ts -- hlc adalah
// bilangan 57-bit yang melebihi presisi double JSON, jadi ia string dan
// bentuknya tidak bisa divalidasi lewat JSON Schema.
const HLC_PATTERN = /^\d+$/;

// Sama dengan pola receiptNumber di openapi.yaml untuk POST /orders. Diperiksa
// di sini karena field ini hanya wajib pada jalur void.
const RECEIPT_NUMBER_PATTERN = /^[A-Za-z0-9]+-\d{8}-\d+$/;

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

// Baris yang akan dikembalikan stoknya, sudah dipetakan ke variation.
interface RestockPlan {
  variationId: string;
  quantityMilli: bigint;
  unitCost: bigint;
}

function assertRefundAmountValid(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'amount harus bilangan bulat rupiah > 0.');
  }
}

function assertRefundQuantityValid(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'quantityMilli baris refund harus bilangan bulat > 0 (x1000).');
  }
}

/**
 * Menyusun rencana restock refund, dan menolak yang mengembalikan lebih banyak
 * daripada yang pernah terjual.
 *
 * ## Kenapa batasnya per VARIATION, bukan per baris
 *
 * `stock_movement` tidak punya kolom `line_id` (0010_inventory.sql) -- yang
 * ada hanya `order_id` dan `variation_id`. Kumulatif yang bisa dihitung dari
 * data yang tersimpan karena itu per (order, variation), dan kebetulan itu
 * juga batas yang lebih benar: stok adalah SUM(delta) per variation, bukan
 * per baris order. Dua baris order atas variation yang sama berbagi satu
 * jatah, dan memang seharusnya begitu.
 *
 * Tanpa batas ini, dua refund parsial yang masing-masing sah bisa
 * bersama-sama mengembalikan lebih banyak daripada yang terjual. Bentuk
 * kegagalannya sama dengan batas uang: stok mengembang diam-diam, dan baru
 * ketahuan saat stock opname.
 */
async function planRestock(
  client: PoolClient,
  orderId: string,
  requested: RefundLineInput[] | undefined
): Promise<RestockPlan[]> {
  const { rows: lines } = await client.query<LineRow>(
    'SELECT id, variation_id, quantity, cost_at_sale FROM order_line WHERE order_id = $1 ORDER BY occurred_at, id',
    [orderId]
  );

  let rencana: RestockPlan[];
  if (requested === undefined) {
    // Daftar baris dikosongkan = seluruh order kembali. Pemanggil sudah
    // dipastikan meminta refund PENUH sebelum sampai ke sini (lihat
    // tulisRefund) -- refund uang parsial tanpa daftar baris akan
    // mengembalikan seluruh stok padahal pelanggan hanya menerima sebagian
    // uangnya, dan barang yang tidak pernah kembali akan tercatat ada.
    rencana = lines.map((l) => ({
      variationId: l.variation_id,
      quantityMilli: BigInt(l.quantity),
      unitCost: BigInt(l.cost_at_sale),
    }));
  } else {
    const byId = new Map(lines.map((l) => [l.id, l]));
    rencana = requested.map((r) => {
      const line = byId.get(r.lineId);
      if (line === undefined) {
        // Termasuk baris milik order LAIN: `order_line.id` unik global, jadi
        // id yang sah pun tidak ditemukan di sini bila ia bukan milik order
        // ini. FK tidak menjaga ini -- lineId datang dari body.
        throw new HttpError(404, 'ORDER_LINE_NOT_FOUND', `Baris ${r.lineId} bukan milik order ${orderId}.`);
      }
      assertRefundQuantityValid(r.quantityMilli);
      return {
        variationId: line.variation_id,
        quantityMilli: BigInt(r.quantityMilli),
        unitCost: BigInt(line.cost_at_sale),
      };
    });
  }

  // Terjual per variation, dari order ini.
  const terjual = new Map<string, bigint>();
  for (const l of lines) {
    terjual.set(l.variation_id, (terjual.get(l.variation_id) ?? 0n) + BigInt(l.quantity));
  }

  // Sudah dikembalikan sebelumnya (refund parsial berulang, atau void).
  const { rows: sebelumnya } = await client.query<{ variation_id: string; total: string }>(
    `SELECT variation_id, SUM(delta)::text AS total
       FROM stock_movement
      WHERE order_id = $1 AND type IN ('refund','void')
      GROUP BY variation_id`,
    [orderId]
  );
  const dikembalikan = new Map(sebelumnya.map((r) => [r.variation_id, BigInt(r.total)]));

  const diminta = new Map<string, bigint>();
  for (const r of rencana) {
    diminta.set(r.variationId, (diminta.get(r.variationId) ?? 0n) + r.quantityMilli);
  }
  for (const [variationId, jumlah] of diminta) {
    const batas = terjual.get(variationId) ?? 0n;
    const sudah = dikembalikan.get(variationId) ?? 0n;
    if (sudah + jumlah > batas) {
      throw new HttpError(
        409,
        'RESTOCK_EXCEEDS_SOLD',
        `Kuantitas yang dikembalikan melebihi yang terjual. Terjual ${batas}, sudah dikembalikan ${sudah}, diminta ${jumlah} (x1000).`
      );
    }
  }
  return rencana;
}

const INSERT_REFUND_SQL = `
  INSERT INTO refund (
    id, tenant_id, order_id, amount, reason_code, reason_note,
    created_by, approved_by, occurred_at, hlc
  ) VALUES (
    $1, $2, $3, $4, $5, $6,
    $7, $8, COALESCE($9::timestamptz, now()), $10
  )
  RETURNING *
`;

function toRefund(row: RefundRow) {
  return {
    id: row.id,
    orderId: row.order_id,
    amount: Number(row.amount),
    reasonCode: row.reason_code,
    reasonNote: row.reason_note,
    createdBy: row.created_by,
    approvedBy: row.approved_by,
    occurredAt: row.occurred_at,
    recordedAt: row.recorded_at,
    hlc: row.hlc,
  };
}

interface RefundContext {
  tenantId: string;
  actorId: string;
  approverId: string;
  orderId: string;
  asli: OrderRow;
  body: CancelInput;
  hlcValue: bigint;
}

/**
 * Menulis refund: baris `refund` + `stock_movement` balik + `audit_event`.
 *
 * ## Tidak ada payment negatif — keputusan user 7 Agustus 2026
 *
 * `spec-b:230` menulis refund membuat "payment negatif", tapi
 * `payment.amount` punya `CHECK (amount > 0)` (`0008_payment.sql:17`) dan
 * `refund.amount` tidak punya CHECK sama sekali. Keduanya tidak dapat benar
 * bersamaan. Keputusan user: pakai baris `refund`, jangan sentuh skema
 * payment — tabel `refund` memang dibuat untuk aliran data ini, dan
 * mempertahankan `amount > 0` menjaga konsistensi laporan keuangan.
 */
async function tulisRefund(client: PoolClient, ctx: RefundContext): Promise<Record<string, unknown>> {
  const { tenantId, actorId, approverId, orderId, asli, body, hlcValue } = ctx;

  assertRefundAmountValid(body.amount);

  // Penyetuju divalidasi lewat SELECT yang tunduk RLS. `refund.approved_by`
  // adalah `text NOT NULL` TANPA FK (0007_ordering.sql:106) -- kolom otorisasi
  // finansial yang isinya tidak dijamin siapa-siapa, kelas yang sama dengan
  // `price_history.changed_by`. Ini satu-satunya yang berdiri di sana.
  await assertApproverVisible(client, approverId);

  // §5 PLAN-modul-f-identitas.md. `assertApproverVisible` di atas hanya
  // membuktikan penyetujunya ADA dan AKTIF -- sebelum baris ini, kasir mana
  // pun lolos sebagai penyetuju refund, sementara `spec-f:42` menulis
  // "Menyetujui void/refund/diskon: Kasir ❌" dan `spec-b:278` menandai
  // refund sebagai PIN manajer yang tidak dapat diubah.
  //
  // Diperiksa DI SINI, bukan di awal handler: void mengabaikan
  // `X-Approver-Id` sepenuhnya (keputusan user 1 Agustus 2026), jadi
  // pemeriksaan yang berjalan sebelum server memilih operasinya akan menolak
  // void yang sah hanya karena perangkat menyertakan header nyasar.
  //
  // Labelnya menyebut PENYETUJU. Manajer yang berdiri di kasir dengan
  // pelanggan menunggu akan mencari masalah di tempat yang keliru kalau
  // pesannya menyebut kasirnya -- pelajaran yang sama yang melahirkan
  // APPROVER_NOT_FOUND (CLAUDE.md, temuan F1 bentuk kelima).
  await assertBoleh(client, approverId, 'approve_authorization', 'menyetujui refund');

  const { rows: sebelumnya } = await client.query<{ total: string }>(
    'SELECT COALESCE(SUM(amount), 0)::text AS total FROM refund WHERE order_id = $1',
    [orderId]
  );
  const alreadyRefunded = BigInt(sebelumnya[0].total);
  const orderTotal = BigInt(asli.total);
  const requested = BigInt(body.amount);
  try {
    // AC FR-B7 ketiga. Batasnya di domain supaya klien offline menegakkan
    // angka yang sama; server tetap memeriksanya ulang karena klien tidak
    // dipercaya.
    assertRefundWithinLimit({ orderTotal, alreadyRefunded, requested });
  } catch (err) {
    // Pesan domain sudah memuat sisa yang tersedia (spec-b:271: "ditolak;
    // maksimum yang tersisa Rp 33.600") -- kasir perlu angkanya tanpa
    // menebak, jadi ia diteruskan apa adanya, bukan diganti pesan umum.
    throw new HttpError(409, 'REFUND_EXCEEDS_TOTAL', (err as Error).message);
  }

  // Daftar baris boleh dikosongkan HANYA untuk refund penuh atas order yang
  // belum pernah direfund. Di luar itu pemanggil harus menyebutkan barang mana
  // yang kembali -- termasuk menyebut daftar KOSONG bila uangnya dikembalikan
  // tanpa barang kembali (kompensasi keluhan, kelebihan bayar). Menebak di
  // sini berarti menebak apakah barang fisik kembali ke rak, dan tebakannya
  // hanya ketahuan saat stock opname.
  if (body.lines === undefined && !(alreadyRefunded === 0n && requested === orderTotal)) {
    throw new HttpError(
      400,
      'REFUND_LINES_REQUIRED',
      'Refund sebagian harus menyebutkan `lines` — daftar baris yang barangnya kembali. Kirim `lines: []` bila tidak ada barang yang kembali.'
    );
  }

  const rencana = await planRestock(client, orderId, body.lines);

  let refundRow: RefundRow;
  try {
    const { rows } = await client.query<RefundRow>(INSERT_REFUND_SQL, [
      body.id,
      tenantId,
      orderId,
      requested.toString(),
      body.reasonCode,
      body.reasonNote ?? null,
      actorId,
      approverId,
      body.occurredAt ?? null,
      hlcValue.toString(),
    ]);
    refundRow = rows[0];
  } catch (err) {
    if (isPrimaryKeyViolation(err)) {
      throw new HttpError(409, 'ID_ALREADY_EXISTS', `Refund dengan id ${body.id} sudah ada.`);
    }
    throw err;
  }

  await recordStockMovements(
    client,
    rencana.map((r) => ({
      id: randomUUID(),
      tenantId,
      outletId: asli.outlet_id,
      deviceId: asli.device_id,
      variationId: r.variationId,
      type: 'refund' as const,
      delta: r.quantityMilli,
      orderId,
      reasonCode: body.reasonCode,
      note: body.reasonNote ?? null,
      unitCost: r.unitCost,
      createdBy: actorId,
      hlc: hlcValue,
      occurredAt: refundRow.occurred_at.toISOString(),
    }))
  );

  // Aktor DAN penyetuju. Bahwa keduanya berbeda ditegakkan CHECK di
  // audit_event, bukan sebuah if di sini -- database tidak pernah lupa.
  await recordAuditEvent(client, {
    id: randomUUID(),
    tenantId,
    outletId: asli.outlet_id,
    deviceId: asli.device_id,
    actorUserId: actorId,
    approverUserId: approverId,
    eventType: 'order.refunded',
    entityType: 'order',
    entityId: orderId,
    reasonCode: body.reasonCode,
    reasonNote: body.reasonNote ?? null,
    before: { total: Number(asli.total), alreadyRefunded: Number(alreadyRefunded) },
    after: { refundId: refundRow.id, amount: Number(requested) },
    hlc: hlcValue,
    occurredAt: refundRow.occurred_at.toISOString(),
  });

  return { operation: 'refund', cancelledOrderId: orderId, refund: toRefund(refundRow) };
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
        try {
          assertCancellationReason(operation, body.reasonCode, body.reasonNote);
        } catch (err) {
          throw new HttpError(400, 'VALIDATION_ERROR', (err as Error).message);
        }

        await assertUserVisible(client, actorId);

        if (operation === 'refund') {
          const responseBody = await tulisRefund(client, {
            tenantId, actorId, orderId, asli, body, hlcValue,
            // Dibaca DI SINI, bukan di awal handler: void harus berjalan tanpa
            // header ini (keputusan user 1 Agu 2026), dan operasinya baru
            // diketahui setelah status order dibaca.
            approverId: getApproverId(req),
          });
          await insertOutboxEvent(client, {
            id: randomUUID(),
            tenantId,
            aggregateType: 'order',
            aggregateId: orderId,
            eventType: 'order.refunded',
            payload: responseBody,
          });
          await completeIdempotencyKey(client, { key: idempotencyKey, responseStatus: 201, responseBody });
          return { status: 201, body: responseBody as unknown };
        }

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

        // Wajib untuk void, tidak berlaku untuk refund -- karena itu diperiksa
        // di sini, bukan di JSON Schema. Kontrak tidak bisa menyatakan "wajib
        // bila server memutuskan operasinya void".
        if (typeof body.receiptNumber !== 'string' || !RECEIPT_NUMBER_PATTERN.test(body.receiptNumber)) {
          throw new HttpError(400, 'VALIDATION_ERROR', 'receiptNumber wajib untuk void, format PREFIX-YYYYMMDD-URUTAN.');
        }
        if (typeof body.sequence !== 'number' || !Number.isInteger(body.sequence) || body.sequence < 1) {
          throw new HttpError(400, 'VALIDATION_ERROR', 'sequence wajib untuk void, bilangan bulat >= 1.');
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
