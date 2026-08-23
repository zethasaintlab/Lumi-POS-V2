import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from '../../../db.ts';
import { withTenantTransaction } from '../../../db.ts';
import { HttpError } from '../../../http-error.ts';
import { getTenantId, getActorId } from '../../../tenant-context.ts';
import { isPrimaryKeyViolation } from './pg-error.ts';
import { computeRequestHash } from './request-hash.ts';
import { assertApproverVisible, assertBoleh, assertDeviceVisible, assertUserVisible } from '../../identity/index.ts';
import { getOutletSettings } from '../../tenancy/index.ts';
import {
  ambangDari,
  nilaiDiskon,
  periksaAlasanDiskon,
  rencanaDiskon,
  type PermintaanDiskon,
} from '../../../../../../packages/domain/src/diskon.ts';
import { recordStockMovements, detectOversell } from '../../inventory/index.ts';
import { getVariationSnapshot, resolvePrice, wasPriceEverEffective } from '../../catalog/index.ts';
import type { VariationSnapshotRow } from '../../catalog/index.ts';
import { assertShiftOpen } from '../../cash/index.ts';
import { catatDriftJam, recordAuditEvent } from '../../audit/index.ts';
import { fetchEffectiveTaxRates } from '../../payment/index.ts';
import { formatScaledRate } from '../../../../../../packages/domain/src/numeric.ts';
import {
  findIdempotencyKey,
  claimIdempotencyKey,
  completeIdempotencyKey,
  insertOutboxEvent,
  IdempotencyKeyConflictError,
} from '../../sync/index.ts';
import { computeLineTotal, computeOrderTotals } from '../../../../../../packages/domain/src/money.ts';
import { calculateTax } from '../../../../../../packages/domain/src/tax.ts';
import type { TaxBreakdown } from '../../../../../../packages/domain/src/tax.ts';
import type { Hlc } from '../../../../../../packages/domain/src/hlc.ts';
import type { FastifyRequest, FastifyReply } from 'fastify';

// T3, T5, T6, T7, T9, T14 (docs/superpowers/plans/PLAN-ordering-fondasi.md).
// POST /orders menulis order + check + SELURUH order_line + SELURUH
// order_line_modifier dalam SATU withTenantTransaction (invariant #1,
// CLAUDE.md).
//
// T12 (PLAN-pembayaran-pajak.md) menyambungkan TaxCalculator: pajak kini
// SUNGGUHAN, bukan nol. Tapi tidak ada aritmetika pajak di berkas ini --
// invariant #7. Modul ini mengambil kandidat tarif lewat permukaan publik
// modul payment, memanggil calculateTax, dan menyimpan hasilnya apa adanya.
//
// T10-T13 menambah: idempotency (header Idempotency-Key + tabel
// idempotency_key) dan outbox, keduanya lewat modules/sync/index.ts
// (invariant #4 -- ordering tidak boleh query kedua tabel itu langsung).

// --- baris DB (snake_case, bigint datang sebagai string dari node-postgres) ---

interface OrderRow {
  id: string;
  has_calculation_variance: boolean;
  variance_amount: string | null;
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
  /**
   * FR-H6 — harga yang DIPAKAI KLIEN saat penjualan terjadi. Opsional, dan
   * tidak pernah dipercaya: ia hanya dibandingkan dengan hitungan server.
   * Klien versi N-1 tidak mengirimnya, dan tidak boleh patah karenanya.
   */
  unitPrice?: unknown;
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
  /**
   * FR-H6 — total yang DIHITUNG KLIEN. Opsional. Server tetap menghitung
   * sendiri dan menyimpan hitungannya; nilai ini hanya dibandingkan.
   */
  total?: unknown;
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

// FR-H6 -- angka dari klien. Divalidasi bentuknya walau TIDAK dipercaya
// nilainya: `total` yang berupa string atau pecahan bukan "selisih", melainkan
// klien yang rusak, dan menandainya sebagai selisih akan menyembunyikan bug
// klien di dalam laporan exception.
function assertClientTotalValid(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'total harus bilangan bulat rupiah >= 0.');
  }
}

function assertClientUnitPriceValid(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'unitPrice harus bilangan bulat rupiah >= 0.');
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

// T10 (spec-b:318-361) -- Idempotency-Key WAJIB untuk POST /orders. Sama
// pola dengan getTenantId/getActorId (tenant-context.ts): dibaca manual dari
// header, TIDAK dideklarasikan di openapi.yaml (T15 belum digarap sub-
// project ini) -- pola yang sama seperti X-Tenant-Id/X-Actor-Id, yang juga
// tidak pernah muncul di `parameters:` operasi mana pun.
const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
function getIdempotencyKeyHeader(req: FastifyRequest): string {
  const header = req.headers['idempotency-key'];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value || value.length === 0 || value.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new HttpError(400, 'MISSING_IDEMPOTENCY_KEY', 'Header Idempotency-Key wajib diisi.');
  }
  return value;
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
    // STRING, bukan Number(). `order_line.tax_rate` adalah numeric(6,4), dan
    // mengubahnya jadi number di batas API mengembalikan float ke permukaan
    // yang justru dibersihkan dari float -- klien akan menyalinnya apa adanya
    // ke perhitungan. Konsisten dengan TaxRate.rate di modul payment.
    taxRate: row.tax_rate,
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
    // FR-H6 -- klien perlu tahu bahwa hitungannya berbeda, supaya ia dapat
    // menampilkannya ke kasir alih-alih diam-diam menyimpan angka lain.
    hasCalculationVariance: order.has_calculation_variance,
    varianceAmount: order.variance_amount === null ? null : Number(order.variance_amount),
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
    rounding_adjustment, total, amount_due, has_calculation_variance, variance_amount,
    created_by, occurred_at, hlc
  ) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8,
    'open', $9, $10, $18, 0, $11,
    0, $12, $12, $16, $17,
    $13, COALESCE($14::timestamptz, now()), $15
  )
  RETURNING *
`;

const INSERT_CHECK_SQL = `
  INSERT INTO "check" (id, tenant_id, order_id, label, subtotal, total)
  VALUES ($1, $2, $3, NULL, $4, $5)
  RETURNING *
`;

// T12 (PLAN-pembayaran-pajak.md) -- kolom pajak kini SNAPSHOT dari hasil
// calculateTax (FR-B3), bukan literal nol. Nilainya dihitung TaxCalculator
// dan diteruskan apa adanya ke sini; tidak ada aritmetika pajak di berkas ini
// (invariant #7). Baris yang tidak kena tarif apa pun tetap menyimpan
// tax_rate_id NULL dan nol -- itu "tidak ada pajak", berbeda dari tarif 0%
// yang punya tax_rate_id.
const INSERT_LINE_SQL = `
  INSERT INTO order_line (
    id, tenant_id, outlet_id, device_id, order_id, check_id, variation_id,
    item_name, variation_name, unit_price, quantity, modifier_snapshot, discount_amount,
    tax_rate_id, tax_rate, tax_amount, is_tax_inclusive, cost_at_sale, line_total,
    created_by, occurred_at, hlc, tax_rate_name, tax_jurisdiction
  ) VALUES (
    $1, $2, $3, $4, $5, $6, $7,
    $8, $9, $10, $11, $12, $13,
    $14, $15::numeric, $16, $17, $18, $19,
    $20, $21, $22, $23, $24
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
  totals: { subtotal: bigint; total: bigint },
  breakdown: TaxBreakdown,
  variance: { flagged: boolean; amount: bigint | null },
  /** FR-B8. Nol bila order ini tidak berdiskon. */
  orderDiscount: bigint
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
      // order.tax_amount = totalTax (SELURUH pajak, inklusif maupun
      // eksklusif) -- itu yang dicetak di struk dan dilaporkan. Yang MENAMBAH
      // total hanya totalTaxExclusive, dan itu sudah masuk lewat
      // computeOrderTotals di pemanggil. Menukar keduanya akan menggandakan
      // pajak inklusif di total.
      breakdown.totalTax.toString(),
      // rounding_adjustment ditulis 0 langsung di SQL, bukan lewat parameter:
      // pembulatan bergantung pada METODE PEMBAYARAN (FR-C9 -- hanya berlaku
      // bila ada pembayaran tunai), dan order yang baru dibuat belum punya
      // pembayaran apa pun. amount_due karena itu sama dengan total, dan
      // keduanya memakai $12 yang sama.
      totals.total.toString(),
      actorId,
      body.occurredAt ?? null,
      hlcValue.toString(),
      variance.flagged,
      variance.amount === null ? null : variance.amount.toString(),
      orderDiscount.toString(),
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
    // Indeks perLine sekali di luar loop -- lookup per baris, bukan pencarian
    // linear berulang.
    const taxByLineId = new Map(breakdown.perLine.map((p) => [p.lineId, p]));

    for (const calc of lineCalcs) {
      const taxForLine = taxByLineId.get(calc.input.id);
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
        // Snapshot pajak per baris (FR-B3), diambil dari breakdown -- BUKAN
        // dihitung ulang di sini (invariant #7). Baris yang tidak kena tarif
        // apa pun tidak muncul di perLine, dan menyimpan NULL/0/false: itu
        // "tidak ada pajak", berbeda dari tarif 0% yang punya tax_rate_id.
        taxForLine?.taxRateId ?? null,
        formatScaledRate(taxForLine?.rateScaled ?? 0n),
        (taxForLine?.amount ?? 0n).toString(),
        taxForLine?.isInclusive ?? false,
        calc.snapshot.cost,
        calc.lineTotal.toString(),
        actorId,
        orderRow.occurred_at,
        hlcValue.toString(),
        // F5 — nama tarif sebagai SNAPSHOT, diambil dari `TaxBreakdown` yang
        // sudah dihitung. BUKAN query kedua ke `tax_rate`: nilainya sudah ada
        // di tangan, dan invariant #7 melarang jalur perhitungan pajak punya
        // sumber kedua.
        //
        // `null` bila baris ini tidak kena tarif apa pun — string kosong akan
        // tercetak sebagai baris pajak tanpa nama di struk.
        taxForLine?.name ?? null,
        // FR-C13 — yurisdiksi sebagai SNAPSHOT, dari `TaxBreakdown` yang sama.
        // Rekapitulasi memisahkan pajak per jenis DAN per yurisdiksi; tarif
        // yang dipindah yurisdiksi setelah transaksi tidak boleh mengubah
        // rekapitulasi periode yang sudah dilaporkan.
        taxForLine?.jurisdiction ?? null,
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

    // FR-E3 — stock cutting, di TRANSAKSI YANG SAMA dengan penjualannya
    // (`spec-e:112`: "kegagalan menulis movement me-rollback seluruh
    // penjualan"). Sampai 14 Agustus 2026 server tidak menulis satu pun
    // movement `sale`, jadi stok hanya pernah NAIK: void dan refund
    // mengembalikan barang yang tidak pernah dikurangi.
    //
    // ⛔ Hanya variation ber-`track_stock = true` (FR-E2, `spec-e:88`).
    // Nilainya datang dari snapshot katalog, bukan dari SELECT langsung ke
    // `item_variation` — invariant #4.
    //
    // ⛔ Modifier TIDAK menghasilkan movement (KEP-04): ia tidak punya SKU.
    // Karena itu daftarnya dibangun dari `lineCalcs`, bukan dari modifier.
    await recordStockMovements(
      client,
      lineCalcs
        .filter((calc) => calc.snapshot.trackStock)
        .map((calc) => ({
          id: randomUUID(),
          tenantId,
          outletId: orderRow.outlet_id,
          deviceId: orderRow.device_id,
          variationId: calc.input.variationId as string,
          type: 'sale' as const,
          // NEGATIF: barang keluar dari rak. Kuantitas x1000, dan tidak ada
          // kolom `quantity` di mana pun — stok adalah SUM(delta).
          delta: -BigInt(calc.input.quantityMilli as number),
          orderId: orderRow.id,
          // `sale` tidak butuh alasan — ia penyebabnya sendiri. Yang wajib
          // ber-`reason_code` adalah `adjustment` (FR-E2).
          reasonCode: null,
          createdBy: actorId,
          occurredAt: orderRow.occurred_at.toISOString(),
          hlc: hlcValue,
        }))
    );

    // FR-E6 — deteksi oversell, SETELAH movement ditulis dan di transaksi yang
    // sama. Ia tidak menolak apa pun: `spec-e:177` menuntut kedua penjualan
    // diterima, dan menolak yang kedua berarti menolak uang yang sudah
    // diterima merchant.
    //
    // Di dalam transaksi supaya event dan penjualan yang menyebabkannya
    // tidak pernah terpisah — penjualan yang tersimpan tanpa eventnya adalah
    // oversell yang hilang diam-diam, dan itu persis yang FR-E6 cegah.
    await detectOversell(client, {
      tenantId,
      outletId: orderRow.outlet_id,
      variationIds: lineCalcs
        .filter((calc) => calc.snapshot.trackStock)
        .map((calc) => calc.input.variationId as string),
    });

    return { order: orderRow, check: checkRow, lines };
  } catch (err) {
    translateConstraintError(err);
  }
}


/**
 * Menghitung ulang total order memakai harga yang DIPAKAI KLIEN.
 *
 * Bukan untuk disimpan — hasilnya tidak pernah menyentuh database. Ia menjawab
 * satu pertanyaan saja: apakah total yang dikirim klien konsisten dengan
 * harga-harga yang klien itu sendiri pakai?
 *
 * Kalau ya, selisihnya murni karena harga usang, dan itu bukan anomali
 * (`spec-h:97`). Kalau tidak, aritmetika kliennya yang salah — dan itu justru
 * hal yang FR-H6 ada untuk ditangkap.
 *
 * Pajak ikut dihitung ulang: dasar pajak berubah ketika harga baris berubah,
 * jadi memakai `taxAmount` dari hitungan server akan membandingkan dua hal
 * yang tidak sebanding.
 */
/**
 * ⛔ Diskon dioper sebagai PERMINTAAN, bukan sebagai nominal yang sudah
 * diresolusi — dan perbedaannya menentukan.
 *
 * Fungsi ini menghitung ulang total memakai HARGA KLIEN untuk memutuskan
 * apakah selisih FR-H6 dapat dijelaskan. Pertanyaannya adalah "apakah total
 * klien konsisten dengan harga-harganya sendiri", dan diskon PERSEN klien
 * juga diturunkan dari subtotal klien: perangkat yang harganya basi
 * menghitung 10% dari 10.000, bukan 10% dari 25.000.
 *
 * Memakai nominal server di sini menghasilkan selisih sebesar beda kedua
 * diskon, dan setiap order berdiskon dari perangkat yang harganya basi
 * ditandai `has_calculation_variance` lalu masuk laporan exception. Laporan
 * yang penuh hal normal tidak akan dibaca siapa pun.
 *
 * ⛔ Otorisasi TIDAK ikut dihitung ulang di sini. Ambang selalu diputuskan
 * dari subtotal SERVER; membiarkan klien memilih basisnya berarti membiarkan
 * penyerang memilih ambangnya sendiri.
 */
function hitungTotalVersiKlien(
  lineCalcs: LineComputation[],
  breakdownInput: { channel: string; outletId: string },
  taxRates: Parameters<typeof calculateTax>[0]['taxRates'],
  body: OrderInput,
  mintaDiskon: PermintaanDiskon | null
): bigint {
  const lines = lineCalcs.map((l) => {
    const unitPrice = BigInt(l.input.unitPrice as number);
    return {
      lineId: l.input.id,
      itemId: l.snapshot.itemId,
      categoryId: l.snapshot.categoryId,
      amount: computeLineTotal({
        unitPrice,
        quantityMilli: BigInt(l.input.quantityMilli as number),
        modifiers: (l.input.modifiers ?? []).map((m) => ({
          price: BigInt(m.price as number),
          quantityMilli: BigInt((m.quantityMilli as number | undefined) ?? 1000),
        })),
        discountAmount: BigInt((l.input.discountAmount as number | undefined) ?? 0),
      }),
    };
  });

  const subtotalKlien = lines.reduce((n, l) => n + l.amount, 0n);
  const orderDiscount = mintaDiskon === null ? 0n : nilaiDiskon(subtotalKlien, mintaDiskon);

  const breakdown = calculateTax({
    lines,
    serviceChargeAmount: 0n,
    orderDiscount,
    taxRates,
    channel: body.channel as 'dine_in' | 'takeaway',
    outletId: body.outletId,
  });

  return computeOrderTotals({
    lineTotals: lines.map((l) => l.amount),
    orderDiscount,
    serviceChargeAmount: 0n,
    taxAmount: breakdown.totalTaxExclusive,
  }).total;
}

/**
 * Diskon tingkat order dari body. `null` bila tidak ada.
 *
 * ⛔ Divalidasi SEBELUM transaksi dibuka, sejajar `assertQuantityMilliValid`.
 * Body cacat tidak boleh membuka transaksi database.
 */
function bacaPermintaanDiskon(body: OrderInput): PermintaanDiskon | null {
  const d = (body as { discount?: unknown }).discount;
  if (d === undefined || d === null) return null;
  const obj = d as { tipe?: unknown; nilai?: unknown };
  if (obj.tipe !== 'persen' && obj.tipe !== 'nominal') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'discount.tipe harus "persen" atau "nominal".');
  }
  if (typeof obj.nilai !== 'number' || !Number.isInteger(obj.nilai) || obj.nilai < 0) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      'discount.nilai harus bilangan bulat >= 0 (persen berskala 10.000, atau rupiah utuh).'
    );
  }
  return { tipe: obj.tipe, nilai: BigInt(obj.nilai) };
}

export function createOrderHandlers(pool: Pool, hlc: Hlc): Record<string, unknown> {
  return {
    async createOrder(req: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const idempotencyKey = getIdempotencyKeyHeader(req);
      const body = req.body as OrderInput;
      // T10 -- SHA-256 hex dari body request YANG DIKANONIKALISASI (key
      // objek diurutkan rekursif). Dihitung SEKALI di sini, dari body MENTAH
      // -- terlepas dari apakah body-nya lolos validasi di bawah, supaya
      // retry dengan body persis sama (termasuk yang gagal validasi) tetap
      // menghasilkan hash yang sama.
      const requestHash = computeRequestHash(body);
      // FR-B8 -- penyetuju datang dari header, sejajar refund dan no-sale.
      // Kosong berarti "tidak ada", bukan string kosong: `assertApproverVisible`
      // atas string kosong akan menjawab 404 alih-alih 403 APPROVAL_REQUIRED,
      // dan kasir melihat pesan yang menyalahkan orang yang tidak ada.
      const approverHeader = req.headers['x-approver-id'];
      const approverId =
        typeof approverHeader === 'string' && approverHeader.trim() !== ''
          ? approverHeader.trim()
          : null;
      const mintaDiskon = bacaPermintaanDiskon(body);
      if (mintaDiskon !== null) {
        const pesan = periksaAlasanDiskon(
          (body as { discountReasonCode?: unknown }).discountReasonCode,
          (body as { discountReasonNote?: string | null }).discountReasonNote
        );
        // ⛔ Alasan dituntut untuk SETIAP diskon, bukan hanya yang melewati
        // ambang. Diskon di bawah ambang tetap masuk laporan exception FR-G5,
        // dan baris tanpa alasan di sana tidak dapat diagregasi jadi apa pun.
        if (pesan !== null) throw new HttpError(400, 'VALIDATION_ERROR', pesan);
      }

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
        // T10-T12 (spec-b:333-348, modules/sync/index.ts): idempotency
        // dicek DAN diklaim DI DALAM transaksi yang sama dengan penulisan
        // order (spec-b:350) -- bukan pre-check di luar transaksi lalu
        // INSERT terpisah, itu balapan di READ COMMITTED (lihat komentar
        // claimIdempotencyKey).
        const existing = await findIdempotencyKey(client, idempotencyKey);
        if (existing !== null) {
          if (existing.requestHash !== requestHash) {
            // spec-b:333-348 -- key dipakai ulang dengan body BERBEDA
            // adalah bug klien, bukan cache hit. JANGAN kembalikan respons
            // order lain.
            throw new HttpError(
              422,
              'IDEMPOTENCY_KEY_HASH_MISMATCH',
              `Idempotency-Key ${idempotencyKey} sudah dipakai untuk request dengan body yang berbeda.`
            );
          }
          // Cache hit -- request identik (key+hash sama) sudah pernah
          // sukses. JANGAN diproses ulang: kembalikan response_body/
          // response_status yang TERSIMPAN, tidak ada order kedua.
          //
          // KETEGANGAN SPEC (dilaporkan, bukan diputuskan sendiri):
          // spec-b:336 menulis "status 200" untuk kasus ini, tapi deskripsi
          // FR-B10 (spec-b:325) menulis server "mengembalikan respons
          // asli", dan skema menyediakan kolom response_status justru untuk
          // menyimpannya. Keduanya tidak sepenuhnya sejalan. Diimplementasi-
          // kan di sini: kembalikan response_status TERSIMPAN (201 untuk
          // order yang sukses dibuat) -- konsisten dengan "respons asli" dan
          // dengan alasan kolom itu ada. Ini interpretasi, bukan fakta.
          return { status: existing.responseStatus, body: existing.responseBody };
        }

        // Klaim key SEBELUM menulis order/check/line apa pun (T11) -- lihat
        // komentar claimIdempotencyKey (modules/sync/index.ts) untuk alasan
        // urutan ini: order/check/line punya PK client-generated sendiri
        // yang sama persis pada retry, jadi kalau idempotency_key baru
        // ditulis PALING AKHIR, dua request bersamaan akan lebih dulu
        // balapan di order_pkey dan menghasilkan 409 ID_ALREADY_EXISTS,
        // BUKAN 409 idempotency dengan instruksi retry yang diminta AC.
        try {
          await claimIdempotencyKey(client, { key: idempotencyKey, tenantId, requestHash });
        } catch (err) {
          if (err instanceof IdempotencyKeyConflictError) {
            // T11: dua request bersamaan, key sama -- transaksi kedua
            // memblokir di unique index idempotency_key sampai yang
            // pertama commit, lalu kena unique violation di sini, SEBELUM
            // pernah menyentuh order/check/line/modifier sama sekali.
            throw new HttpError(
              409,
              'IDEMPOTENCY_KEY_CONFLICT',
              `Request dengan Idempotency-Key ${idempotencyKey} sedang diproses request lain, coba lagi.`
            );
          }
          throw err;
        }

        // T7: empat FK klien-suplai, semua divalidasi lewat SELECT yang
        // tunduk RLS SEBELUM INSERT apa pun (FK PostgreSQL tidak tunduk RLS,
        // temuan F1 CLAUDE.md). Urutan: outlet -> device -> aktor -> shift
        // (yang terakhir butuh device sudah valid untuk pengecekan kecocokan
        // device di dalamnya).
        //
        // `rounding_increment` dan `service_charge_rate` masih belum dipakai
        // di sini -- keduanya milik jalur pembayaran (Modul C, FR-C9), dan
        // order yang baru dibuat belum punya pembayaran apa pun. Yang dipakai
        // sejak FR-B8 adalah AMBANG DISKON, ditambah efek samping yang sudah
        // menjadi alasan panggilan ini sejak awal: SELECT yang tunduk RLS,
        // satu-satunya yang membuktikan outlet ini milik tenant pemanggil.
        const pengaturanOutlet = await getOutletSettings(client, body.outletId);
        await assertDeviceVisible(client, body.deviceId);
        await assertUserVisible(client, actorId);
        await assertShiftOpen(client, body.shiftId, body.deviceId);

        const lineCalcs: LineComputation[] = [];
        for (const line of body.lines) {
          const snapshot = await getVariationSnapshot(client, line.variationId);
          if (snapshot === null) {
            throw new HttpError(404, 'VARIATION_NOT_FOUND', `Variation ${line.variationId} tidak ditemukan.`);
          }
          // FR-H6 (spec-h:77) -- harga dihitung pada `occurred_at`, WAKTU
          // PENJUALAN TERJADI, bukan waktu paketnya sampai di server. Order
          // yang antre offline berjam-jam harus memakai harga saat kasir
          // menerima uangnya; memakai harga sekarang berarti merchant yang
          // menaikkan harga sore hari mendapati penjualan pagi ikut naik, dan
          // struk yang sudah dipegang pelanggan tidak lagi cocok dengan yang
          // tersimpan.
          //
          // `null` (klien tidak mengirim occurredAt) tetap berarti "sekarang
          // menurut jam DATABASE" -- BUKAN new Date() di Node, yang sudah
          // terbukti menyebabkan bug nyata di repo ini (skew ±2ms).
          //
          // Ini memperkenalkan jam KETIGA: jam perangkat klien. Perangkat yang
          // jamnya salah sehari akan memilih harga yang salah. Dicatat di
          // HANDOFF.md; spec menuntut occurred_at, dan harga saat penjualan
          // terjadi memang yang benar.
          const at = body.occurredAt === undefined ? null : new Date(body.occurredAt);
          const resolved = await resolvePrice(client, line.variationId, body.outletId, at);
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

        // ------------------------------------------------------------
        // FR-B8 -- diskon tingkat order dan otorisasi step-up.
        //
        // ⛔ Dihitung dari SUBTOTAL SERVER, bukan dari angka klien. Perangkat
        // yang di-root dapat mengirim subtotal apa pun; ambang yang dihitung
        // atasnya adalah ambang yang dapat dipilih penyerang sendiri.
        // ------------------------------------------------------------
        let orderDiscount = 0n;
        let butuhPenyetujuDiskon = false;
        if (mintaDiskon !== null) {
          const subtotalServer = lineCalcs.reduce((n, l) => n + l.lineTotal, 0n);
          const ambang = ambangDari(
            pengaturanOutlet.discountThresholdPercentScaled,
            pengaturanOutlet.discountThresholdAmount
          );
          let rencana;
          try {
            rencana = rencanaDiskon(subtotalServer, mintaDiskon, ambang);
          } catch (err) {
            translateMoneyError(err);
          }
          orderDiscount = rencana.nominal;
          butuhPenyetujuDiskon = rencana.butuhPenyetuju;

          if (rencana.butuhPenyetuju) {
            if (approverId === null) {
              // ⛔ 403, bukan 400: permintaannya tidak cacat, ia hanya belum
              // disetujui. Kasir yang menerima 400 akan mengira ia salah
              // memasukkan angka.
              throw new HttpError(
                403,
                'APPROVAL_REQUIRED',
                `Diskon ${orderDiscount} melewati ambang outlet ini; otorisasi manajer dituntut.`
              );
            }
            // Pesannya dibedakan dari `ACTOR_NOT_FOUND` -- manajer yang
            // penyetujuannya ditolak tidak boleh diberi tahu bahwa KASIR-nya
            // yang tidak ditemukan (pelajaran refund, 7 Agu 2026).
            await assertApproverVisible(client, approverId);
            await assertBoleh(client, approverId, 'approve_authorization', 'menyetujui diskon');
          }
        }

        // T12 (PLAN-pembayaran-pajak.md) -- pajak dihitung TaxCalculator,
        // tidak pernah di sini (invariant #7). Modul ini hanya mengambil
        // kandidat tarif lewat permukaan publik modul payment (invariant #4)
        // dan meneruskannya; resolusi mana yang menang ada di calculateTax,
        // supaya klien offline menerapkan aturan yang sama persis.
        const taxRates = await fetchEffectiveTaxRates(client, body.outletId);
        const breakdownInput = { channel: body.channel, outletId: body.outletId };
        const breakdown = calculateTax({
          lines: lineCalcs.map((l) => ({
            lineId: l.input.id,
            itemId: l.snapshot.itemId,
            categoryId: l.snapshot.categoryId,
            amount: l.lineTotal,
          })),
          // Biaya layanan masih 0 -- ia belum punya jalur masuk. Diskon
          // order TIDAK lagi 0 sejak FR-B8.
          serviceChargeAmount: 0n,
          orderDiscount,
          taxRates,
          channel: body.channel as 'dine_in' | 'takeaway',
          outletId: body.outletId,
        });

        let totals: { subtotal: bigint; total: bigint };
        try {
          totals = computeOrderTotals({
            lineTotals: lineCalcs.map((l) => l.lineTotal),
            orderDiscount,
            serviceChargeAmount: 0n,
            // totalTaxExclusive, BUKAN totalTax. Pajak inklusif sudah ada di
            // dalam harga baris; memakai totalTax di sini akan menggandakannya
            // (lihat komentar TaxBreakdown di packages/domain/src/tax.ts).
            taxAmount: breakdown.totalTaxExclusive,
          });
        } catch (err) {
          translateMoneyError(err);
        }

        // ------------------------------------------------------------
        // FR-H6 -- validasi ulang. Klien tidak dipercaya.
        //
        // Aturan intinya berlawanan dengan naluri, dan itu yang membuatnya
        // layak ditulis eksplisit (spec-h:95): transaksi yang selisih TETAP
        // DITERIMA. Menolaknya berarti kehilangan penjualan yang sudah terjadi
        // dan uangnya sudah diterima merchant. Yang benar adalah menerima,
        // menandai, dan melaporkan.
        //
        // Yang TERSIMPAN selalu hitungan server -- `totals` di atas, bukan
        // angka klien. Angka klien hanya menghasilkan penanda.
        // ------------------------------------------------------------
        const at = body.occurredAt === undefined ? null : new Date(body.occurredAt);
        let variance: { flagged: boolean; amount: bigint | null } = { flagged: false, amount: null };

        if (body.total !== undefined && body.total !== null) {
          assertClientTotalValid(body.total);
          const clientTotal = BigInt(body.total);
          if (clientTotal !== totals.total) {
            // Selisih ADA. Sekarang pertanyaannya: dapatkah ia dijelaskan?
            //
            // spec-h:97 -- "Sumber selisih yang wajar: harga berubah setelah
            // perangkat terakhir tersinkron. Ini bukan anomali dan tidak boleh
            // membanjiri laporan." Perangkat yang seminggu offline memakai
            // harga seminggu lalu; menandainya berarti setiap order dari
            // perangkat itu masuk laporan exception, dan laporan yang penuh
            // hal normal tidak akan dibaca siapa pun.
            // Dua syarat, dan KEDUANYA harus terpenuhi. Memeriksa yang
            // pertama saja adalah lubang yang ditemukan sabotase: klien yang
            // mengirim harga per baris BENAR tapi total salah akan lolos
            // tanpa penanda — padahal itu persis "selisih yang tidak dapat
            // dijelaskan" yang FR-H6 ada untuk menangkapnya.
            //
            //   1. Setiap harga yang dipakai klien pernah benar-benar
            //      berlaku pada-atau-sebelum `occurred_at`.
            //   2. Total klien = total yang DIHITUNG ULANG dengan harga-harga
            //      klien itu. Kalau tidak, aritmetika klienlah yang salah,
            //      bukan harganya yang usang.
            let semuaTerjelaskan = true;
            for (const calc of lineCalcs) {
              const hargaKlien = calc.input.unitPrice;
              if (hargaKlien === undefined || hargaKlien === null) {
                // Klien tidak menyebut harga per baris, jadi tidak ada yang
                // bisa dicocokkan ke riwayat. Selisihnya tidak terjelaskan.
                semuaTerjelaskan = false;
                break;
              }
              assertClientUnitPriceValid(hargaKlien);
              if (BigInt(hargaKlien) === calc.unitPrice) {
                continue;
              }
              const pernahBerlaku = await wasPriceEverEffective(
                client, calc.input.variationId, body.outletId, BigInt(hargaKlien), at
              );
              if (!pernahBerlaku) {
                semuaTerjelaskan = false;
                break;
              }
            }

            if (semuaTerjelaskan) {
              // Syarat kedua: hitung ULANG dengan harga klien. Ini "server
              // menghitung ulang dari order_line yang dikirim" (spec-h:77)
              // dijalankan apa adanya — hanya saja dengan harga versi klien,
              // untuk menjawab satu pertanyaan: apakah angka klien konsisten
              // dengan harganya sendiri?
              const totalVersiKlien = hitungTotalVersiKlien(lineCalcs, breakdownInput, taxRates, body, mintaDiskon);
              semuaTerjelaskan = totalVersiKlien === clientTotal;
            }

            variance = semuaTerjelaskan
              ? { flagged: false, amount: null }
              : { flagged: true, amount: clientTotal - totals.total };
          }
        }

        const written = await insertOrderTree(
          client, tenantId, actorId, body, hlcValue, lineCalcs, totals, breakdown, variance, orderDiscount
        );

        // ⛔ FR-F8 — jam perangkat dibandingkan dengan jam server SAAT
        // TERSINKRON. Ia dipanggil SESUDAH ordernya ditulis, dan itu bukan
        // urutan sembarang: deteksi jam tidak boleh berada di antara
        // pemeriksaan dan penulisan penjualan, tempat kegagalannya dapat
        // menahan uang yang sudah diterima merchant.
        //
        // ⛔ Yang dibandingkan `X-Device-Time` (jam perangkat SEKARANG), bukan
        // `occurredAt`. Order yang antre offline berjam-jam memang lebih tua
        // daripada `recorded_at`, dan `spec-f:346` menyebut itu WAJAR.
        await catatDriftJam(client, {
          tenantId,
          outletId: body.outletId,
          deviceId: body.deviceId,
          actorUserId: actorId,
          headerJam: req.headers['x-device-time'],
          hlc: hlcValue,
          idBaru: randomUUID,
        });

        // ⛔ FR-B8 AC kedua: `audit_event` menyimpan DUA identitas terpisah.
        //
        // Dicatat untuk SETIAP diskon, bukan hanya yang menuntut PIN. Diskon
        // di bawah ambang tetap masuk laporan exception FR-G5 -- pola diskon
        // kecil yang berulang adalah persis yang laporan itu ada untuk
        // menemukannya, dan baris tanpa jejak tidak dapat ditemukan siapa pun.
        //
        // `approverUserId` null bila ambangnya tidak terlewati. `CHECK` di
        // `audit_event` menuntut penyetuju BERBEDA dari aktor -- database yang
        // menegakkannya, bukan aplikasi.
        if (orderDiscount > 0n) {
          await recordAuditEvent(client, {
            id: randomUUID(),
            tenantId,
            outletId: body.outletId,
            deviceId: body.deviceId,
            actorUserId: actorId,
            approverUserId: butuhPenyetujuDiskon ? approverId : null,
            eventType: 'discount_applied',
            entityType: 'order',
            entityId: written.order.id,
            reasonCode: (body as { discountReasonCode?: string }).discountReasonCode ?? null,
            reasonNote: (body as { discountReasonNote?: string | null }).discountReasonNote ?? null,
            after: {
              orderDiscount: Number(orderDiscount),
              subtotal: Number(totals.subtotal),
              butuhPenyetuju: butuhPenyetujuDiskon,
            },
            hlc: hlcValue,
            occurredAt: written.order.occurred_at.toISOString(),
          });
        }

        // Audit hanya untuk selisih yang TIDAK terjelaskan. AC keempat
        // menuntut laporan menampilkan device, waktu, dan selisih -- Modul G
        // membacanya dari sini, jadi ketiganya harus ada.
        if (variance.flagged) {
          await recordAuditEvent(client, {
            id: randomUUID(),
            tenantId,
            outletId: body.outletId,
            deviceId: body.deviceId,
            actorUserId: actorId,
            // Bukan tindakan orang: tidak ada yang menyetujui selisih.
            approverUserId: null,
            eventType: 'calculation_variance',
            entityType: 'order',
            entityId: written.order.id,
            reasonCode: null,
            reasonNote: null,
            after: {
              clientTotal: Number(body.total),
              serverTotal: Number(totals.total),
              varianceAmount: Number(variance.amount),
            },
            hlc: hlcValue,
            occurredAt: written.order.occurred_at.toISOString(),
          });
        }
        const responseBody = toOrder(written.order, written.check, written.lines);

        // T13 (FR-B2, invariant #1): satu baris outbox DALAM transaksi yang
        // sama. Kegagalan apa pun setelah titik ini me-rollback baris ini
        // juga -- termasuk klaim idempotency_key di atas.
        await insertOutboxEvent(client, {
          id: randomUUID(),
          tenantId,
          aggregateType: 'order',
          aggregateId: written.order.id,
          eventType: 'order.created',
          payload: responseBody,
        });

        await completeIdempotencyKey(client, { key: idempotencyKey, responseStatus: 201, responseBody });

        return { status: 201, body: responseBody as unknown };
      });

      reply.code(result.status);
      return result.body;
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
