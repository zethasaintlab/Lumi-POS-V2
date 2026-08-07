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
import type { PaymentProvider, InitiateResult, GatewayStatus } from '../providers/index.ts';
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
const SUPPORTED_METHODS = new Set(['cash', 'qris_dynamic', 'qris_static', 'card_edc']);

// QRIS dinamis tidak menerima `tenderedAmount` -- tidak ada uang yang
// diserahkan di tangan. Yang dikirim klien adalah `amount`, nominal yang
// diminta ke gateway.
const GATEWAY_METHODS = new Set(['qris_dynamic']);

// Metode yang dikonfirmasi MANUSIA, bukan sistem. Tidak ada gateway yang
// ditanyai -- kontrol wajibnya (referensi untuk QRIS statis, approval code
// untuk EDC) adalah satu-satunya yang berdiri di sana.
const MANUAL_METHODS = new Set(['qris_static', 'card_edc']);

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

function assertGatewayAmountValid(value: unknown): asserts value is number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value <= 0 ||
    value > Number.MAX_SAFE_INTEGER
  ) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'amount harus bilangan bulat rupiah > 0.');
  }
}


/**
 * Menolak apa pun yang berbentuk nomor kartu.
 *
 * AC FR-C5 keempat: "Tidak ada field bebas (`notes`, `reference`) yang
 * divalidasi menerima 13-19 digit berurutan tanpa peringatan."
 *
 * Pemisah (spasi dan tanda hubung) dibuang lebih dulu, karena `4111 1111 1111
 * 1111` adalah bentuk yang paling mungkin diketik orang -- memeriksa digit
 * berurutan saja akan meloloskannya.
 *
 * Ambangnya 13, bukan 12: referensi bank dan nominal rupiah rutin mencapai 12
 * digit, dan kontrol yang menolak referensi sah akan dimatikan orang pertama
 * yang terhalang olehnya. 13 adalah panjang PAN terpendek yang beredar.
 */
const KEMUNGKINAN_PAN = /\d{13,19}/;

function assertBukanNomorKartu(value: string, label: string): void {
  const tanpaPemisah = value.replace(/[\s-]/g, '');
  if (KEMUNGKINAN_PAN.test(tanpaPemisah)) {
    throw new HttpError(
      400,
      'POSSIBLE_CARD_NUMBER',
      `${label} tampak memuat nomor kartu. Data kartu tidak boleh masuk ke POS (FR-C5).`
    );
  }
}

const MIN_REFERENCE_LENGTH = 3;

function assertReferenceValid(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.trim().length < MIN_REFERENCE_LENGTH) {
    // Kontrol anti-fraud FR-C2, bukan formalitas: QRIS statis dikonfirmasi
    // kasir TANPA verifikasi sistem apa pun, dan berfungsi offline. Tanpa
    // referensi, "sudah dibayar" hanyalah pernyataan kasir tanpa jejak.
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      `reference wajib untuk QRIS statis (minimal ${MIN_REFERENCE_LENGTH} karakter): nominal + 4 digit terakhir nomor referensi, atau catatan.`
    );
  }
  assertBukanNomorKartu(value, 'reference');
}

function assertApprovalCodeValid(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'approvalCode wajib untuk pembayaran EDC (FR-C4).');
  }
  assertBukanNomorKartu(value, 'approvalCode');
}

/**
 * `card_last4` maksimal 4 DIGIT.
 *
 * Database sudah punya `CHECK (length(card_last4) <= 4)`, dan test menulis
 * langsung ke tabel untuk membuktikan ia sungguh menolak. Pemeriksaan di sini
 * lebih ketat: ia menuntut DIGIT, sehingga tidak ada jalan sepotong data lain
 * menyelinap ke kolom yang namanya menjanjikan empat digit terakhir kartu.
 */
function assertCardLast4Valid(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^\d{1,4}$/.test(value)) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'cardLast4 harus 1-4 digit angka (FR-C4: tidak pernah lebih).');
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



// --- G5: cek status pembayaran gateway (FR-C14) ---

interface GatewayPaymentRow extends PaymentRow {
  provider: string | null;
  provider_reference: string | null;
  order_id: string;
}

/**
 * Status gateway -> status kolom `payment.status`.
 *
 * `expired` dipetakan ke `failed`, bukan ke status tersendiri: kolomnya hanya
 * mengenal empat nilai (`0008_payment.sql`), dan `voided` di sana berarti
 * dibatalkan oleh TINDAKAN ORANG -- QR yang kedaluwarsa bukan itu. Sebab
 * aslinya tidak hilang: respons tetap memuat `gatewayStatus` apa adanya,
 * sehingga klien dapat mengatakan "QR kedaluwarsa" alih-alih "pembayaran
 * gagal". `[ASUMSI]` -- spec-c:293-316 hanya menulis "Batalkan payment" untuk
 * keduanya tanpa menyebut status simpanannya.
 */
const GATEWAY_TO_PAYMENT_STATUS: Readonly<Record<string, string>> = {
  pending: 'pending_confirmation',
  confirmed: 'confirmed',
  failed: 'failed',
  expired: 'failed',
};

export function createPaymentStatusHandlers(pool: Pool, provider: PaymentProvider) {
  return {
    /**
     * `POST /payments/{paymentId}/check-status`.
     *
     * POST, bukan GET: ia mengubah keadaan. Konfirmasi gateway di sini adalah
     * SATU-SATUNYA jalan sebuah payment QRIS menjadi `confirmed` -- spec-c:320
     * melarang sistem menandai lunas tanpa konfirmasi, dan tidak ada jalur
     * lain yang boleh melakukannya.
     *
     * Penjadwalan polling (tiap 2 detik, maksimal 5 menit) adalah perilaku
     * KLIEN. Server hanya menyediakan pintunya; menaruh penjadwal di sini
     * berarti server menebak kapan kasir masih menunggu di depan layar.
     */
    async checkPaymentStatus(req: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(req);
      const { paymentId } = req.params as { paymentId: string };

      // --- baca payment lewat SELECT yang tunduk RLS ---
      const awal = await withTenantTransaction(pool, tenantId, async (client) => {
        const { rows } = await client.query<GatewayPaymentRow>(
          'SELECT * FROM payment WHERE id = $1',
          [paymentId]
        );
        if (rows.length === 0) {
          throw new HttpError(404, 'PAYMENT_NOT_FOUND', `Payment ${paymentId} tidak ditemukan.`);
        }
        const payment = rows[0];
        if (!GATEWAY_METHODS.has(payment.method)) {
          // Pembayaran tunai tidak punya gateway untuk ditanyai. Menjawabnya
          // dengan memanggil provider berarti mengirim referensi kosong ke
          // Midtrans.
          throw new HttpError(
            409,
            'PAYMENT_NOT_GATEWAY',
            `Payment ${paymentId} bermetode ${payment.method}; tidak ada gateway untuk dicek.`
          );
        }
        const { rows: orderRows } = await client.query<OrderStateRow>(
          `SELECT o.id, o.status, o.total, o.tax_amount, o.outlet_id, c.id AS check_id
             FROM "order" o JOIN "check" c ON c.order_id = o.id
            WHERE o.id = $1`,
          [payment.order_id]
        );
        return { payment, order: orderRows[0] };
      });

      // Payment yang sudah final tidak ditanyakan lagi. Klien mem-polling tiap
      // 2 detik; tanpa penjagaan ini satu order menghasilkan puluhan panggilan
      // yang tidak mengubah apa pun -- boros kuota, dan menaikkan peluang kena
      // rate limit justru saat pembayaran LAIN sedang berlangsung.
      if (awal.payment.status !== 'pending_confirmation') {
        reply.code(200);
        return await ringkasan(pool, tenantId, awal.payment, awal.order.id, null);
      }

      // --- tanya gateway, DI LUAR transaksi ---
      //
      // Referensi bisa NULL bila initiate gagal sebelum sempat mendapatkannya
      // -- dan justru keadaan itu yang paling butuh dicek (FR-C14: pelanggan
      // mungkin sudah membayar). Midtrans menerima `order_id` di endpoint yang
      // sama, dan `order_id` yang kita kirim saat charge adalah id payment.
      const referensi = awal.payment.provider_reference ?? paymentId;
      let gatewayStatus: GatewayStatus;
      try {
        gatewayStatus = await provider.pollStatus(referensi);
      } catch {
        // Gateway tidak dapat dihubungi bukan berarti pembayaran gagal.
        // Statusnya tetap pending_confirmation dan klien dapat mencoba lagi.
        reply.code(200);
        return await ringkasan(pool, tenantId, awal.payment, awal.order.id, 'pending');
      }

      const statusBaru = GATEWAY_TO_PAYMENT_STATUS[gatewayStatus] ?? 'pending_confirmation';

      const hasil = await withTenantTransaction(pool, tenantId, async (client) => {
        // Dikunci ulang: dua polling bersamaan tidak boleh sama-sama menutup
        // order.
        const { rows } = await client.query<GatewayPaymentRow>(
          'SELECT * FROM payment WHERE id = $1 FOR UPDATE',
          [paymentId]
        );
        const payment = rows[0];
        if (payment.status !== 'pending_confirmation') {
          return payment;
        }

        await client.query(
          `UPDATE payment
              SET status = $2,
                  provider_reference = COALESCE(provider_reference, $3)
            WHERE id = $1`,
          [paymentId, statusBaru, awal.payment.provider_reference ?? referensi]
        );

        if (statusBaru === 'confirmed') {
          const { rows: orderRows } = await client.query<OrderStateRow>(
            `SELECT o.id, o.status, o.total, o.tax_amount, o.outlet_id, c.id AS check_id
               FROM "order" o JOIN "check" c ON c.order_id = o.id
              WHERE o.id = $1 FOR UPDATE OF o`,
            [payment.order_id]
          );
          const order = orderRows[0];
          const total = BigInt(order.total);
          const sudahDibayar = await sumConfirmed(client, payment.order_id);

          if (sudahDibayar >= total && order.status === 'open') {
            // Perpindahan status ditegakkan state machine domain, sama
            // seperti jalur tunai -- bukan `if` di sini.
            assertTransition(order.status, 'paid');
            assertTransition('paid', 'closed');
            // rounding_adjustment TIDAK disentuh: pembulatan FR-C9 hanya
            // berlaku bila ada pembayaran TUNAI, dan order ini dilunasi QRIS.
            await client.query(
              `UPDATE "order" SET status = 'closed', amount_due = total WHERE id = $1`,
              [payment.order_id]
            );
          }
        }

        await insertOutboxEvent(client, {
          id: randomUUID(),
          tenantId,
          aggregateType: 'payment',
          aggregateId: paymentId,
          eventType: `payment.${statusBaru}`,
          payload: { orderId: payment.order_id, gatewayStatus },
        });

        const { rows: setelah } = await client.query<GatewayPaymentRow>(
          'SELECT * FROM payment WHERE id = $1',
          [paymentId]
        );
        return setelah[0];
      });

      reply.code(200);
      return await ringkasan(pool, tenantId, hasil, awal.order.id, gatewayStatus);
    },
  };
}

async function ringkasan(
  pool: Pool,
  tenantId: string,
  payment: GatewayPaymentRow,
  orderId: string,
  gatewayStatus: GatewayStatus | null
) {
  return await withTenantTransaction(pool, tenantId, async (client) => {
    const { rows } = await client.query<OrderStateRow>(
      'SELECT id, status, total, tax_amount, outlet_id, id AS check_id FROM "order" WHERE id = $1',
      [orderId]
    );
    const order = rows[0];
    const total = BigInt(order.total);
    const sudahDibayar = await sumConfirmed(client, orderId);
    return {
      payment: {
        ...toPayment(payment),
        provider: payment.provider,
        providerReference: payment.provider_reference,
      },
      // Status gateway apa adanya, terpisah dari status payment. `expired`
      // dan `failed` sama-sama tersimpan sebagai `failed`, tapi klien tetap
      // dapat mengatakan "QR kedaluwarsa" alih-alih "pembayaran gagal".
      gatewayStatus,
      order: { id: orderId, status: order.status, total: Number(total) },
      outstanding: Number(total - sudahDibayar),
    };
  });
}


// --- G8-G9: QRIS statis dan EDC ---

interface ManualDeps {
  pool: Pool;
  hlc: Hlc;
}

const INSERT_MANUAL_PAYMENT_SQL = `
  INSERT INTO payment (
    id, tenant_id, outlet_id, device_id, order_id, check_id, method, amount,
    status, confirmed_manually, provider_reference, approval_code, card_last4,
    acquirer, terminal_reference, tendered_at, created_by, occurred_at, hlc
  )
  SELECT $1, $2, o.outlet_id, o.device_id, o.id, $3, $4, $5,
         'confirmed', $6, $7, $8, $9,
         $10, $11, now(), $12, COALESCE($13::timestamptz, now()), $14
    FROM "order" o WHERE o.id = $15
  RETURNING *
`;

/**
 * Pembayaran yang dikonfirmasi MANUSIA (FR-C2 QRIS statis, FR-C4 EDC).
 *
 * Satu transaksi, sama seperti tunai: tidak ada panggilan jaringan yang perlu
 * dijaga di luarnya, jadi tidak ada alasan memecahnya seperti jalur gateway.
 *
 * ## `confirmed` langsung -- dan kenapa itu BUKAN pelanggaran spec-c:320
 *
 * Aturan mutlak itu berbunyi "tidak pernah menandai lunas tanpa konfirmasi
 * dari GATEWAY", dan berlaku untuk pembayaran yang punya gateway. QRIS statis
 * dan EDC tidak punya: yang mengonfirmasi adalah orang yang melihat notifikasi
 * bank atau struk terminal. Karena itu `confirmed_manually` ada -- ia menandai
 * bahwa tidak ada sistem yang memverifikasi, dan FR-G5 memakainya untuk
 * laporan exception per kasir.
 *
 * `provider` sengaja dibiarkan NULL: tidak ada penyedia yang terlibat.
 * Mengisinya akan membuat laporan mengira transaksi ini pernah diverifikasi.
 */
async function recordManualPayment(deps: ManualDeps, ctx: GatewayCtx) {
  const { pool, hlc } = deps;
  const { req, reply, tenantId, actorId, idempotencyKey, orderId, method } = ctx;
  const body = req.body as PaymentInput & {
    amount?: unknown;
    reference?: unknown;
    approvalCode?: unknown;
    cardLast4?: unknown;
    acquirer?: unknown;
    terminalReference?: unknown;
  };

  assertGatewayAmountValid(body.amount);

  let reference: string | null = null;
  let approvalCode: string | null = null;
  let cardLast4: string | null = null;

  if (method === 'qris_static') {
    assertReferenceValid(body.reference);
    reference = body.reference.trim();
  } else {
    assertApprovalCodeValid(body.approvalCode);
    approvalCode = body.approvalCode.trim();
    if (body.cardLast4 !== undefined && body.cardLast4 !== null) {
      assertCardLast4Valid(body.cardLast4);
      cardLast4 = body.cardLast4;
    }
  }

  const acquirer = typeof body.acquirer === 'string' ? body.acquirer : null;
  const terminalReference = typeof body.terminalReference === 'string' ? body.terminalReference : null;
  if (terminalReference !== null) {
    assertBukanNomorKartu(terminalReference, 'terminalReference');
  }

  const amount = BigInt(body.amount);
  const hlcValue = body.hlc === undefined ? hlc.tick() : hlc.update(BigInt(body.hlc));

  const hasil = await withTenantTransaction(pool, tenantId, async (client) => {
    const existing = await findIdempotencyKey(client, idempotencyKey);
    if (existing !== null && existing.completed) {
      return { kind: 'cached' as const, record: existing };
    }
    await claimIdempotencyKey(client, { key: idempotencyKey, tenantId, requestHash: `${orderId}:${body.id}` });

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
    try {
      assertTransition(order.status, 'paid');
    } catch (err) {
      throw new HttpError(409, 'ORDER_NOT_PAYABLE', (err as Error).message);
    }

    let paymentRow: PaymentRow;
    try {
      const { rows } = await client.query<PaymentRow>(INSERT_MANUAL_PAYMENT_SQL, [
        body.id, tenantId, order.check_id, method, amount.toString(),
        method === 'qris_static', reference, approvalCode, cardLast4,
        acquirer, terminalReference, actorId, body.occurredAt ?? null, hlcValue.toString(), orderId,
      ]);
      paymentRow = rows[0];
    } catch (err) {
      if (isPrimaryKeyViolation(err)) {
        throw new HttpError(409, 'ID_ALREADY_EXISTS', `Payment dengan id ${body.id} sudah ada.`);
      }
      throw err;
    }

    const total = BigInt(order.total);
    const sudahDibayar = await sumConfirmed(client, orderId);
    let statusBaru = order.status;
    if (sudahDibayar >= total) {
      assertTransition(order.status, 'paid');
      assertTransition('paid', 'closed');
      // rounding_adjustment TIDAK disentuh: pembulatan FR-C9 hanya berlaku
      // pada sisa yang dibayar TUNAI, dan tidak ada tunai di sini.
      await client.query(`UPDATE "order" SET status = 'closed', amount_due = total WHERE id = $1`, [orderId]);
      statusBaru = 'closed';
    }

    await insertOutboxEvent(client, {
      id: randomUUID(),
      tenantId,
      aggregateType: 'payment',
      aggregateId: paymentRow.id,
      eventType: 'payment.recorded',
      payload: { orderId, amount: amount.toString(), method },
    });

    const responseBody = {
      payment: {
        ...toPayment(paymentRow),
        provider: null,
        providerReference: reference,
      },
      order: {
        id: orderId,
        status: statusBaru,
        total: Number(total),
        taxAmount: Number(order.tax_amount),
        roundingAdjustment: 0,
        amountDue: Number(total),
      },
      outstanding: Number(sudahDibayar >= total ? 0n : total - sudahDibayar),
    };
    await completeIdempotencyKey(client, { key: idempotencyKey, responseStatus: 201, responseBody });
    return { kind: 'fresh' as const, body: responseBody };
  }).catch((err) => {
    if (err instanceof IdempotencyKeyConflictError) {
      throw new HttpError(409, 'IDEMPOTENCY_KEY_CONFLICT', 'Permintaan dengan key ini sedang diproses. Coba lagi.');
    }
    throw err;
  });

  if (hasil.kind === 'cached') {
    reply.code(hasil.record.responseStatus);
    return hasil.record.responseBody;
  }
  reply.code(201);
  return hasil.body;
}

interface GatewayDeps {
  pool: Pool;
  hlc: Hlc;
  provider: PaymentProvider;
}

interface GatewayCtx {
  req: FastifyRequest;
  reply: FastifyReply;
  tenantId: string;
  actorId: string;
  idempotencyKey: string;
  orderId: string;
  method: string;
}

const INSERT_GATEWAY_PAYMENT_SQL = `
  INSERT INTO payment (
    id, tenant_id, outlet_id, device_id, order_id, check_id, method, amount,
    status, provider, confirmed_manually, tendered_at, created_by, occurred_at, hlc
  )
  SELECT $1, $2, o.outlet_id, o.device_id, o.id, $3, $4, $5,
         'pending_confirmation', $6, false,
         now(), $7, COALESCE($8::timestamptz, now()), $9
    FROM "order" o WHERE o.id = $10
  RETURNING *
`;

/**
 * QRIS dinamis (FR-C2, FR-C14).
 *
 * ## Kenapa DUA transaksi, bukan satu
 *
 * Ini satu-satunya jalur di repo ini yang sengaja memecah penulisannya, dan
 * alasannya adalah FR-C14 sendiri:
 *
 * > "Kelas bug yang paling sering menghasilkan uang hilang di POS: POS
 * > meminta QR, gateway timeout, pelanggan **sudah membayar**, POS tidak
 * > tahu."
 *
 * Kalau panggilan gateway ada di DALAM transaksi, kegagalannya me-rollback
 * baris `payment` -- dan POS kehilangan satu-satunya catatan bahwa QR pernah
 * diminta. Pelanggan yang terlanjur membayar tidak akan punya jejak apa pun
 * di sistem.
 *
 * Karena itu urutannya: **tulis payment `pending_confirmation` dan commit
 * lebih dulu**, baru panggil gateway. Gateway gagal berarti payment tetap
 * ada, tetap `pending_confirmation`, dan dapat dicek ulang -- persis cabang
 * "Timeout/error" di diagram `spec-c:293-316`.
 *
 * Alasan kedua yang berdiri sendiri: panggilan jaringan di dalam transaksi
 * database menahan koneksi pool selama gateway berpikir.
 *
 * Ini **tidak** melanggar invariant #1. Yang dituntut invariant itu adalah
 * satu PENJUALAN = satu transaksi; inisiasi QRIS bukan penjualan yang
 * selesai -- order belum berpindah status, dan `sumConfirmed` mengabaikan
 * payment `pending_confirmation` sepenuhnya.
 *
 * ## Idempotency
 *
 * Key diklaim di transaksi pertama dan baru DISELESAIKAN setelah gateway
 * menjawab. Retry yang datang di tengah menemukan key terklaim tapi
 * `completed === false`, lalu menjalankan ulang panggilan gateway dengan key
 * yang SAMA. Gateway yang mendedup key itu (AC FR-C14 pertama) mengembalikan
 * transaksi yang sama, bukan membuat yang baru.
 */
async function initiateGatewayPayment(deps: GatewayDeps, ctx: GatewayCtx) {
  const { pool, hlc, provider } = deps;
  const { req, reply, tenantId, actorId, idempotencyKey, orderId, method } = ctx;
  const body = req.body as PaymentInput & { amount?: unknown };

  assertGatewayAmountValid(body.amount);
  const amount = BigInt(body.amount);
  const hlcValue = body.hlc === undefined ? hlc.tick() : hlc.update(BigInt(body.hlc));

  // --- transaksi 1: klaim key + tulis payment pending_confirmation ---
  const awal = await withTenantTransaction(pool, tenantId, async (client) => {
    const existing = await findIdempotencyKey(client, idempotencyKey);
    if (existing !== null && existing.completed) {
      return { kind: 'cached' as const, record: existing };
    }
    if (existing === null) {
      await claimIdempotencyKey(client, { key: idempotencyKey, tenantId, requestHash: `${orderId}:${body.id}` });
    }

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

    // Order yang sudah lunas tidak menerima pembayaran lagi. Sama seperti
    // jalur tunai, ini ditegakkan state machine domain, bukan `if` di sini.
    try {
      assertTransition(order.status, 'paid');
    } catch (err) {
      throw new HttpError(409, 'ORDER_NOT_PAYABLE', (err as Error).message);
    }

    // Baris dari percobaan sebelumnya dipakai ulang -- retry TIDAK boleh
    // menghasilkan payment kedua.
    const { rows: sudahAda } = await client.query<PaymentRow>(
      'SELECT * FROM payment WHERE id = $1',
      [body.id]
    );
    if (sudahAda.length > 0) {
      return { kind: 'fresh' as const, payment: sudahAda[0], order };
    }

    let paymentRow: PaymentRow;
    try {
      const { rows } = await client.query<PaymentRow>(INSERT_GATEWAY_PAYMENT_SQL, [
        body.id, tenantId, order.check_id, method, amount.toString(),
        provider.name, actorId, body.occurredAt ?? null, hlcValue.toString(), orderId,
      ]);
      paymentRow = rows[0];
    } catch (err) {
      if (isPrimaryKeyViolation(err)) {
        throw new HttpError(409, 'ID_ALREADY_EXISTS', `Payment dengan id ${body.id} sudah ada.`);
      }
      throw err;
    }

    await insertOutboxEvent(client, {
      id: randomUUID(),
      tenantId,
      aggregateType: 'payment',
      aggregateId: paymentRow.id,
      eventType: 'payment.initiated',
      payload: { orderId, amount: amount.toString(), method },
    });

    return { kind: 'fresh' as const, payment: paymentRow, order };
  }).catch((err) => {
    if (err instanceof IdempotencyKeyConflictError) {
      throw new HttpError(409, 'IDEMPOTENCY_KEY_CONFLICT', 'Permintaan dengan key ini sedang diproses. Coba lagi.');
    }
    throw err;
  });

  if (awal.kind === 'cached') {
    reply.code(awal.record.responseStatus);
    return awal.record.responseBody;
  }

  // --- panggilan gateway, DI LUAR transaksi ---
  let hasil: InitiateResult | null = null;
  let gatewayReachable = true;
  try {
    hasil = await provider.initiate({ orderId, paymentId: body.id, amount, idempotencyKey });
  } catch {
    // TIDAK dilempar ke klien sebagai kegagalan. Payment sudah tersimpan
    // `pending_confirmation`, dan itu memang jawaban yang benar menurut
    // FR-C14: pelanggan mungkin sudah membayar. Klien menampilkan tombol
    // "Cek status", bukan pesan "pembayaran gagal".
    //
    // Pesan galat sengaja TIDAK diteruskan ke respons: ia bisa memuat detail
    // gateway yang tidak berguna bagi kasir, dan permukaan respons API bukan
    // tempat untuk isi error pihak ketiga (FR-C5).
    gatewayReachable = false;
  }

  // --- transaksi 2: catat referensi gateway, selesaikan idempotency key ---
  const responseBody = await withTenantTransaction(pool, tenantId, async (client) => {
    if (hasil !== null) {
      await client.query(
        'UPDATE payment SET provider_reference = $2 WHERE id = $1 AND provider_reference IS NULL',
        [body.id, hasil.providerReference]
      );
    }

    // Sisa tagihan dihitung dari payment `confirmed` SAJA. QRIS yang baru
    // diinisiasi tidak menguranginya sedikit pun -- spec-c:320, sistem tidak
    // pernah menganggap lunas tanpa konfirmasi gateway.
    const total = BigInt(awal.order.total);
    const sudahDibayar = await sumConfirmed(client, orderId);

    const rb = {
      payment: {
        ...toPayment(awal.payment),
        status: 'pending_confirmation',
        provider: provider.name,
        providerReference: hasil === null ? null : hasil.providerReference,
      },
      // Kosong saat gateway tidak menjawab -- klien tidak dapat menampilkan
      // QR, tapi payment-nya ada dan dapat dicek ulang.
      qrString: hasil === null ? null : hasil.qrString,
      expiresAt: hasil === null || hasil.expiresAt === null ? null : hasil.expiresAt.toISOString(),
      gatewayReachable,
      order: {
        id: orderId,
        status: awal.order.status,
        total: Number(total),
        taxAmount: Number(awal.order.tax_amount),
        // Pembulatan tunai (FR-C9) tidak berlaku di sini: ia hanya muncul
        // saat ada pembayaran TUNAI, dan order ini belum tentu punya.
        roundingAdjustment: 0,
        amountDue: Number(total),
      },
      outstanding: Number(total - sudahDibayar),
    };
    // Key diselesaikan HANYA bila gateway menjawab.
    //
    // Kalau ia diselesaikan juga saat gateway gagal, retry dengan key yang
    // sama akan menerima respons "tanpa QR" dari cache SELAMANYA -- kasir
    // tidak akan pernah mendapat QR-nya, padahal FR-C14 justru menyuruh
    // klien memakai key yang sama ("JANGAN buat request baru"). Dibiarkan
    // terklaim-belum-selesai, retry berikutnya menjalankan ulang panggilan
    // gateway dengan key yang SAMA, dan gateway yang mendedup key itu
    // mengembalikan transaksi yang sama alih-alih membuat yang baru.
    if (hasil !== null) {
      await completeIdempotencyKey(client, { key: idempotencyKey, responseStatus: 201, responseBody: rb });
    }
    return rb;
  });

  reply.code(201);
  return responseBody;
}

export function createPaymentEntryHandlers(pool: Pool, hlc: Hlc, provider: PaymentProvider) {
  return {
    async createPayment(req: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const idempotencyKey = getIdempotencyKeyHeader(req);
      const { orderId } = req.params as { orderId: string };
      const body = req.body as PaymentInput;

      const method = body.method ?? 'cash';
      assertMethodSupported(method);

      if (GATEWAY_METHODS.has(method)) {
        return await initiateGatewayPayment(
          { pool, hlc, provider },
          { req, reply, tenantId, actorId, idempotencyKey, orderId, method }
        );
      }

      if (MANUAL_METHODS.has(method)) {
        return await recordManualPayment(
          { pool, hlc },
          { req, reply, tenantId, actorId, idempotencyKey, orderId, method }
        );
      }

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
