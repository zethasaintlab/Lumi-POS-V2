import type { Pool, PoolClient } from '../../../db.ts';
import { withTenantTransaction } from '../../../db.ts';
import { HttpError } from '../../../http-error.ts';
import { getTenantId, getActorId } from '../../../tenant-context.ts';
import { isPrimaryKeyViolation } from './pg-error.ts';
import { assertDeviceVisible, assertUserVisible } from '../../identity/index.ts';
import { getOutletSettings } from '../../tenancy/index.ts';
import { getVariationSnapshot, resolvePrice } from '../../catalog/index.ts';
import type { VariationSnapshotRow } from '../../catalog/index.ts';
import { assertShiftOpen } from '../../cash/index.ts';
import { computeLineTotal, computeOrderTotals } from '../../../../../../packages/domain/src/money.ts';
import type { Hlc } from '../../../../../../packages/domain/src/hlc.ts';
import type { FastifyRequest, FastifyReply } from 'fastify';

// T3, T5, T6, T7, T9, T14 (docs/superpowers/plans/PLAN-ordering-fondasi.md).
// POST /orders menulis order + check + SELURUH order_line + SELURUH
// order_line_modifier dalam SATU withTenantTransaction (invariant #1,
// CLAUDE.md). Pajak nol di seluruh jalur ini -- invariant #7, TaxCalculator
// adalah Modul C dan belum ada (keputusan Q5, PLAN §8.0).

// --- baris DB (snake_case, bigint datang sebagai string dari node-postgres) ---

interface OrderRow {
  id: string;
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
  created_by: string;
  occurred_at: Date;
  recorded_at: string;
  hlc: string;
}

interface CheckRow {
  id: string;
  order_id: string;
  label: string | null;
  subtotal: string;
  total: string;
}

interface OrderLineRow {
  id: string;
  order_id: string;
  check_id: string;
  variation_id: string;
  item_name: string;
  variation_name: string;
  unit_price: string;
  quantity: string;
  modifier_snapshot: unknown;
  discount_amount: string;
  tax_rate_id: string | null;
  tax_rate: string;
  tax_amount: string;
  is_tax_inclusive: boolean;
  cost_at_sale: string;
  line_total: string;
  created_by: string;
  occurred_at: string;
  recorded_at: string;
  hlc: string;
}

interface OrderLineModifierRow {
  id: string;
  order_line_id: string;
  modifier_id: string | null;
  name: string;
  price: string;
  quantity: string;
}

// --- input (camelCase, dari body JSON) ---

interface OrderLineModifierInput {
  id: string;
  modifierId?: string | null;
  name: string;
  price: unknown;
  quantityMilli?: unknown;
}

interface OrderLineInput {
  id: string;
  variationId: string;
  quantityMilli: unknown;
  discountAmount?: unknown;
  modifiers?: OrderLineModifierInput[];
}

interface OrderInput {
  id: string;
  outletId: string;
  deviceId: string;
  shiftId: string;
  receiptNumber: string;
  businessDate: string;
  sequence: number;
  channel: string;
  hlc?: string;
  occurredAt?: string;
  checkId: string;
  lines: OrderLineInput[];
}

// --- validasi uang/kuantitas: sama pola dengan assertPriceValid (prices.ts)
// dan assertOpeningFloatValid (shifts.ts) -- typeof + Number.isInteger dicek
// eksplisit, bukan hanya `< 0`, supaya string, float pecahan, null, dan
// NaN/Infinity semuanya ditolak. Sengaja TIDAK dinyatakan lewat JSON Schema
// (lihat openapi.yaml: quantityMilli/discountAmount/price di sini tidak
// diberi `type`) -- fungsi-fungsi ini satu-satunya sumber kebenaran, pola
// yang sama dengan PriceInput.price. ---

function assertQuantityMilliValid(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'quantityMilli harus bilangan bulat > 0 (kuantitas x1000).');
  }
}

function assertDiscountAmountValid(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'discountAmount harus bilangan bulat rupiah >= 0.');
  }
}

function assertModifierPriceValid(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Harga modifier harus bilangan bulat rupiah >= 0.');
  }
}

function assertModifierQuantityMilliValid(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'quantityMilli modifier harus bilangan bulat > 0 (x1000).');
  }
}

// hlc adalah string desimal (bigint 57-bit melebihi Number.MAX_SAFE_INTEGER --
// packages/domain/src/hlc.ts, komentar "Pengemasan"), jadi TIDAK bisa
// divalidasi lewat JSON Schema `type: integer` (yang berbasis IEEE754 double
// dan akan diam-diam kehilangan presisi via AJV/JS number). Pemeriksaan
// bentuknya harus di sini.
const HLC_PATTERN = /^\d+$/;
function assertHlcValid(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !HLC_PATTERN.test(value)) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'hlc harus string berisi bilangan bulat desimal.');
  }
}

// --- error PostgreSQL -> HttpError bersih ---

// order_device_id_business_date_sequence_key: nama constraint default
// PostgreSQL untuk `UNIQUE (device_id, business_date, sequence)` inline di
// CREATE TABLE (dikonfirmasi lewat pg_constraint, bukan ditebak -- lihat
// migrasi 0007_ordering.sql). FR-B5: bentrok nomor struk untuk device+tanggal
// bisnis yang sama harus 409 yang bisa ditindaklanjuti klien, bukan 500.
const RECEIPT_SEQUENCE_CONSTRAINT = 'order_device_id_business_date_sequence_key';

function translateConstraintError(err: unknown): never {
  if (isPrimaryKeyViolation(err)) {
    // Mencakup order_pkey, check_pkey, order_line_pkey, dan
    // order_line_modifier_pkey sekaligus -- keempatnya id client-generated
    // (ULID/UUIDv7, CLAUDE.md), jadi retry offline (id yang sama dikirim
    // ulang) HARUS dibedakan dari error lain dengan kode yang sama persis
    // di semua tabel milik modul ini. Ini juga yang menutup T14: order kedua
    // yang memakai checkId sudah dipakai order lain menabrak check_pkey di
    // sini, bukan 500 mentah.
    throw new HttpError(409, 'ID_ALREADY_EXISTS', 'Baris dengan id ini sudah ada.');
  }
  const pgErr = err as { code?: string; constraint?: string };
  if (pgErr.code === '23505' && pgErr.constraint === RECEIPT_SEQUENCE_CONSTRAINT) {
    throw new HttpError(
      409,
      'RECEIPT_SEQUENCE_TAKEN',
      'Nomor struk ini sudah dipakai untuk device dan tanggal bisnis yang sama.'
    );
  }
  throw err;
}

// packages/domain/src/money.ts sengaja melempar RangeError/TypeError polos
// (modul murni, tanpa pengetahuan HTTP) untuk input yang secara matematis
// tidak masuk akal (mis. discountAmount melebihi subtotal baris) -- baru
// diterjemahkan ke HttpError di sini, di tepi HTTP.
function translateMoneyError(err: unknown): never {
  if (err instanceof RangeError || err instanceof TypeError) {
    throw new HttpError(400, 'VALIDATION_ERROR', err.message);
  }
  throw err;
}

// --- serialisasi respons ---

function toOrderLineModifier(row: OrderLineModifierRow) {
  return {
    id: row.id,
    modifierId: row.modifier_id,
    name: row.name,
    price: Number(row.price),
    quantityMilli: Number(row.quantity),
  };
}

function toOrderLine(row: OrderLineRow, modifiers: OrderLineModifierRow[]) {
  return {
    id: row.id,
    variationId: row.variation_id,
    itemName: row.item_name,
    variationName: row.variation_name,
    unitPrice: Number(row.unit_price),
    quantityMilli: Number(row.quantity),
    modifierSnapshot: row.modifier_snapshot,
    discountAmount: Number(row.discount_amount),
    taxRateId: row.tax_rate_id,
    taxRate: Number(row.tax_rate),
    taxAmount: Number(row.tax_amount),
    isTaxInclusive: row.is_tax_inclusive,
    costAtSale: Number(row.cost_at_sale),
    lineTotal: Number(row.line_total),
    createdBy: row.created_by,
    occurredAt: row.occurred_at,
    recordedAt: row.recorded_at,
    hlc: row.hlc,
    modifiers: modifiers.map(toOrderLineModifier),
  };
}

interface LineWithModifiers {
  line: OrderLineRow;
  modifiers: OrderLineModifierRow[];
}

function toOrder(order: OrderRow, check: CheckRow, lines: LineWithModifiers[]) {
  return {
    id: order.id,
    outletId: order.outlet_id,
    deviceId: order.device_id,
    shiftId: order.shift_id,
    receiptNumber: order.receipt_number,
    businessDate: order.business_date,
    sequence: order.sequence,
    status: order.status,
    channel: order.channel,
    subtotal: Number(order.subtotal),
    orderDiscount: Number(order.order_discount),
    serviceChargeAmount: Number(order.service_charge_amount),
    taxAmount: Number(order.tax_amount),
    roundingAdjustment: Number(order.rounding_adjustment),
    total: Number(order.total),
    amountDue: Number(order.amount_due),
    createdBy: order.created_by,
    occurredAt: order.occurred_at,
    recordedAt: order.recorded_at,
    hlc: order.hlc,
    checkId: check.id,
    lines: lines.map((l) => toOrderLine(l.line, l.modifiers)),
  };
}

// --- SQL ---

// `$14::timestamptz` dicast eksplisit -- temuan tertunda di repo ini
// (komentar AT_EXPR, catalog/handlers/prices.ts) menunjukkan COALESCE tanpa
// cast bisa membuat PostgreSQL menyimpulkan tipe parameter yang salah secara
// diam-diam. `now()` di sini adalah transaction_timestamp(), TETAP sepanjang
// satu transaksi -- order_line di bawah memakai NILAI YANG SAMA (dibaca balik
// dari RETURNING occurred_at), bukan memanggil now()/COALESCE lagi, supaya
// order dan seluruh baris order_line-nya berbagi satu jam yang identik.
const INSERT_ORDER_SQL = `
  INSERT INTO "order" (
    id, tenant_id, outlet_id, device_id, shift_id, receipt_number, business_date, sequence,
    status, channel, subtotal, order_discount, service_charge_amount, tax_amount,
    rounding_adjustment, total, amount_due, created_by, occurred_at, hlc
  ) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8,
    'open', $9, $10, 0, 0, 0,
    $11, $12, $12, $13, COALESCE($14::timestamptz, now()), $15
  )
  RETURNING *
`;

const INSERT_CHECK_SQL = `
  INSERT INTO "check" (id, tenant_id, order_id, label, subtotal, total)
  VALUES ($1, $2, $3, NULL, $4, $5)
  RETURNING *
`;

// tax_rate_id NULL, tax_rate 0, tax_amount 0, is_tax_inclusive false --
// invariant #7 (CLAUDE.md): tidak ada angka pajak di luar TaxCalculator
// (Modul C, belum ada), jadi kolom pajak literal nol/false/NULL di sini,
// bukan dihitung.
const INSERT_LINE_SQL = `
  INSERT INTO order_line (
    id, tenant_id, outlet_id, device_id, order_id, check_id, variation_id,
    item_name, variation_name, unit_price, quantity, modifier_snapshot, discount_amount,
    tax_rate_id, tax_rate, tax_amount, is_tax_inclusive, cost_at_sale, line_total,
    created_by, occurred_at, hlc
  ) VALUES (
    $1, $2, $3, $4, $5, $6, $7,
    $8, $9, $10, $11, $12, $13,
    NULL, 0, 0, false, $14, $15,
    $16, $17, $18
  )
  RETURNING *
`;

const INSERT_LINE_MODIFIER_SQL = `
  INSERT INTO order_line_modifier (id, tenant_id, order_line_id, modifier_id, name, price, quantity)
  VALUES ($1, $2, $3, $4, $5, $6, $7)
  RETURNING *
`;

interface LineComputation {
  input: OrderLineInput;
  snapshot: VariationSnapshotRow;
  unitPrice: bigint;
  lineTotal: bigint;
}

async function insertOrderTree(
  client: PoolClient,
  tenantId: string,
  actorId: string,
  body: OrderInput,
  hlcValue: bigint,
  lineCalcs: LineComputation[],
  totals: { subtotal: bigint; roundingAdjustment: bigint; total: bigint }
): Promise<{ order: OrderRow; check: CheckRow; lines: LineWithModifiers[] }> {
  try {
    const { rows: orderRows } = await client.query<OrderRow>(INSERT_ORDER_SQL, [
      body.id,
      tenantId,
      body.outletId,
      body.deviceId,
      body.shiftId,
      body.receiptNumber,
      body.businessDate,
      body.sequence,
      body.channel,
      totals.subtotal.toString(),
      totals.roundingAdjustment.toString(),
      totals.total.toString(),
      actorId,
      body.occurredAt ?? null,
      hlcValue.toString(),
    ]);
    const orderRow = orderRows[0];

    const { rows: checkRows } = await client.query<CheckRow>(INSERT_CHECK_SQL, [
      body.checkId,
      tenantId,
      orderRow.id,
      totals.subtotal.toString(),
      totals.total.toString(),
    ]);
    const checkRow = checkRows[0];

    const lines: LineWithModifiers[] = [];
    for (const calc of lineCalcs) {
      const modifiersInput = calc.input.modifiers ?? [];
      // modifier_snapshot (jsonb) -- SALINAN NILAI redundan di kolom
      // order_line, terpisah dari baris order_line_modifier anaknya (FR-B3).
      // JSON.stringify eksplisit, BUKAN mengoper array JS mentah: node-postgres
      // menyerialisasi array lewat encoding literal-array PostgreSQL
      // (`{a,b,c}`), bukan JSON, untuk parameter bertipe Array -- yang salah
      // bentuk untuk kolom jsonb begitu Postgres meng-cast teksnya.
      const modifierSnapshot = modifiersInput.map((m) => ({
        id: m.id,
        modifierId: m.modifierId ?? null,
        name: m.name,
        price: Number(m.price),
        quantityMilli: Number(m.quantityMilli ?? 1000),
      }));

      const { rows: lineRows } = await client.query<OrderLineRow>(INSERT_LINE_SQL, [
        calc.input.id,
        tenantId,
        body.outletId,
        body.deviceId,
        orderRow.id,
        checkRow.id,
        calc.input.variationId,
        calc.snapshot.itemName,
        calc.snapshot.variationName,
        calc.unitPrice.toString(),
        String(BigInt(calc.input.quantityMilli as number)),
        JSON.stringify(modifierSnapshot),
        String(BigInt((calc.input.discountAmount as number | undefined) ?? 0)),
        calc.snapshot.cost,
        calc.lineTotal.toString(),
        actorId,
        orderRow.occurred_at,
        hlcValue.toString(),
      ]);
      const lineRow = lineRows[0];

      const modifierRows: OrderLineModifierRow[] = [];
      for (const m of modifiersInput) {
        const { rows: modRows } = await client.query<OrderLineModifierRow>(INSERT_LINE_MODIFIER_SQL, [
          m.id,
          tenantId,
          lineRow.id,
          m.modifierId ?? null,
          m.name,
          String(BigInt(m.price as number)),
          String(BigInt((m.quantityMilli as number | undefined) ?? 1000)),
        ]);
        modifierRows.push(modRows[0]);
      }
      lines.push({ line: lineRow, modifiers: modifierRows });
    }

    return { order: orderRow, check: checkRow, lines };
  } catch (err) {
    translateConstraintError(err);
  }
}

export function createOrderHandlers(pool: Pool, hlc: Hlc): Record<string, unknown> {
  return {
    async createOrder(req: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const body = req.body as OrderInput;

      // Validasi fail-fast SEBELUM transaksi dibuka -- pola sama dengan
      // createItem (body.variations kosong) dan createPrice (assertPriceValid).
      for (const line of body.lines) {
        assertQuantityMilliValid(line.quantityMilli);
        if (line.discountAmount !== undefined) {
          assertDiscountAmountValid(line.discountAmount);
        }
        for (const m of line.modifiers ?? []) {
          assertModifierPriceValid(m.price);
          if (m.quantityMilli !== undefined) {
            assertModifierQuantityMilliValid(m.quantityMilli);
          }
        }
      }
      if (body.hlc !== undefined) {
        assertHlcValid(body.hlc);
      }

      // HLC -- keputusan desain PLAN §"HLC": klien kirim -> update() (menghormati
      // kausalitas klien SEKALIGUS menjaga monotonisitas server); klien tidak
      // kirim -> tick(). Dipanggil SEKALI di sini, di luar transaksi -- hlc
      // adalah jam server, bukan bagian data yang boleh diulang kalau
      // transaksi retry/rollback.
      const hlcValue = body.hlc !== undefined ? hlc.update(BigInt(body.hlc)) : hlc.tick();

      const result = await withTenantTransaction(pool, tenantId, async (client) => {
        // T7: empat FK klien-suplai, semua divalidasi lewat SELECT yang
        // tunduk RLS SEBELUM INSERT apa pun (FK PostgreSQL tidak tunduk RLS,
        // temuan F1 CLAUDE.md). Urutan: outlet (dan rounding_increment-nya
        // sekaligus) -> device -> aktor -> shift (butuh device sudah valid
        // untuk pengecekan kecocokan device di dalamnya).
        const outletSettings = await getOutletSettings(client, body.outletId);
        await assertDeviceVisible(client, body.deviceId);
        await assertUserVisible(client, actorId);
        await assertShiftOpen(client, body.shiftId, body.deviceId);

        const lineCalcs: LineComputation[] = [];
        for (const line of body.lines) {
          const snapshot = await getVariationSnapshot(client, line.variationId);
          if (snapshot === null) {
            throw new HttpError(404, 'VARIATION_NOT_FOUND', `Variation ${line.variationId} tidak ditemukan.`);
          }
          // unit_price = resolvePrice(..., null) -- null berarti "sekarang
          // menurut jam DATABASE" (catalog/handlers/prices.ts, komentar
          // AT_EXPR). BUKAN new Date() di Node: itu menghidupkan lagi jam
          // kedua yang sudah terbukti menyebabkan bug (skew ±2ms menggagalkan
          // resolusi harga yang baru saja ditulis).
          const resolved = await resolvePrice(client, line.variationId, body.outletId, null);
          const unitPrice = BigInt(resolved.price);
          const modifiers = (line.modifiers ?? []).map((m) => ({
            price: BigInt(m.price as number),
            quantityMilli: BigInt((m.quantityMilli as number | undefined) ?? 1000),
          }));
          let lineTotal: bigint;
          try {
            lineTotal = computeLineTotal({
              unitPrice,
              quantityMilli: BigInt(line.quantityMilli as number),
              modifiers,
              discountAmount: BigInt((line.discountAmount as number | undefined) ?? 0),
            });
          } catch (err) {
            translateMoneyError(err);
          }
          lineCalcs.push({ input: line, snapshot, unitPrice, lineTotal });
        }

        let totals: { subtotal: bigint; roundingAdjustment: bigint; total: bigint };
        try {
          totals = computeOrderTotals({
            lineTotals: lineCalcs.map((l) => l.lineTotal),
            // order_discount dan service_charge_amount = 0 di sub-project
            // ini (PLAN §3.6) -- diskon order dan biaya layanan bukan scope
            // fondasi order, dan taxAmount = 0 (invariant #7).
            orderDiscount: 0n,
            serviceChargeAmount: 0n,
            taxAmount: 0n,
            roundingIncrement: outletSettings.roundingIncrement,
          });
        } catch (err) {
          translateMoneyError(err);
        }

        return insertOrderTree(client, tenantId, actorId, body, hlcValue, lineCalcs, totals);
      });

      reply.code(201);
      return toOrder(result.order, result.check, result.lines);
    },

    // T5/T14: dibutuhkan untuk membaca kembali snapshot order_line utuh
    // (item_name/variation_name/unit_price/cost_at_sale) terlepas dari
    // perubahan katalog setelahnya.
    async getOrder(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const { orderId } = req.params as { orderId: string };
      const result = await withTenantTransaction(pool, tenantId, async (client) => {
        const { rows: orderRows } = await client.query<OrderRow>('SELECT * FROM "order" WHERE id = $1', [orderId]);
        if (orderRows.length === 0) {
          throw new HttpError(404, 'NOT_FOUND', `Order ${orderId} tidak ditemukan.`);
        }
        const order = orderRows[0];

        const { rows: checkRows } = await client.query<CheckRow>('SELECT * FROM "check" WHERE order_id = $1', [orderId]);
        const check = checkRows[0];

        // `, id` tie-breaker -- dua baris order_line dari INSERT berurutan
        // dalam satu transaksi BISA berbagi occurred_at yang identik persis
        // (transaction_timestamp() tetap sepanjang transaksi), jadi urutan
        // tanpa tie-breaker tidak deterministik. Pola sama dengan
        // ORDER BY effective_from DESC, id DESC di catalog/handlers/prices.ts.
        const { rows: lineRows } = await client.query<OrderLineRow>(
          'SELECT * FROM order_line WHERE order_id = $1 ORDER BY occurred_at, id',
          [orderId]
        );

        const lineIds = lineRows.map((l) => l.id);
        const modifiersByLine = new Map<string, OrderLineModifierRow[]>();
        if (lineIds.length > 0) {
          const { rows: modRows } = await client.query<OrderLineModifierRow>(
            'SELECT * FROM order_line_modifier WHERE order_line_id = ANY($1) ORDER BY id',
            [lineIds]
          );
          for (const m of modRows) {
            const forLine = modifiersByLine.get(m.order_line_id) ?? [];
            forLine.push(m);
            modifiersByLine.set(m.order_line_id, forLine);
          }
        }

        const lines: LineWithModifiers[] = lineRows.map((line) => ({
          line,
          modifiers: modifiersByLine.get(line.id) ?? [],
        }));
        return { order, check, lines };
      });
      return toOrder(result.order, result.check, result.lines);
    },
  };
}
