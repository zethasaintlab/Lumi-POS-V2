import type { Pool, PoolClient } from '../../../db.ts';
import { withTenantTransaction } from '../../../db.ts';
import { HttpError } from '../../../http-error.ts';
import { getActorId, getTenantId } from '../../../tenant-context.ts';
import { catatPerubahanServer } from '../../audit/index.ts';
import { isPrimaryKeyViolation } from './pg-error.ts';
import { assertOutletVisible } from '../../tenancy/index.ts';
import { findInvisibleItemIds, findInvisibleCategoryIds } from '../../catalog/index.ts';
import { parseRateToScaled, formatScaledRate } from '../../../../../../packages/domain/src/numeric.ts';
import type { TaxRateSpec } from '../../../../../../packages/domain/src/tax.ts';
import type { FastifyRequest, FastifyReply } from 'fastify';

// T8-T10 (docs/superpowers/plans/PLAN-pembayaran-pajak.md) -- REST tax_rate.
//
// FR-C6: tarif pajak adalah ENTITAS BERDATA, bukan konstanta. Ketika perda
// mengubah tarif, tarif lama TIDAK dihapus -- `effective_to` diisi dan record
// baru dibuat (invariant #2). Transaksi historis tetap benar lewat snapshot
// di order_line, bukan lewat tarif yang masih hidup.
//
// Tidak ada aritmetika pajak di berkas ini. Perhitungannya milik
// packages/domain/src/tax.ts (invariant #7); di sini hanya penyimpanan,
// validasi, dan pengambilan kandidat.

interface TaxRateRow {
  id: string;
  outlet_id: string | null;
  name: string;
  type: string;
  rate: string;
  is_inclusive: boolean;
  phase: string;
  jurisdiction: string | null;
  channel: string;
  applies_to: string;
  applies_to_ids: string[];
  effective_from: string;
  effective_to: string | null;
}

interface TaxRateInput {
  id: string;
  outletId?: string | null;
  name: string;
  type: string;
  rate: unknown;
  isInclusive?: boolean;
  phase?: string;
  jurisdiction?: string | null;
  channel?: string;
  appliesTo?: string;
  appliesToIds?: string[];
  effectiveFrom?: string;
}

function toTaxRate(row: TaxRateRow) {
  return {
    id: row.id,
    outletId: row.outlet_id,
    name: row.name,
    type: row.type,
    // Dikembalikan sebagai STRING, bukan number. Mengubahnya jadi number di
    // batas API akan mengembalikan float ke jalur yang justru dibersihkan
    // dari float -- dan klien akan menyalinnya apa adanya ke perhitungan.
    rate: row.rate,
    isInclusive: row.is_inclusive,
    phase: row.phase,
    jurisdiction: row.jurisdiction,
    channel: row.channel,
    appliesTo: row.applies_to,
    appliesToIds: row.applies_to_ids,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
  };
}

const VALID_TYPES = new Set(['pbjt', 'ppn', 'service_charge', 'none']);
const VALID_PHASES = new Set(['subtotal', 'total']);
const VALID_CHANNELS = new Set(['all', 'dine_in', 'takeaway']);
const VALID_APPLIES_TO = new Set(['all_items', 'category', 'item']);

function assertEnum(value: string, allowed: Set<string>, field: string): void {
  if (!allowed.has(value)) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      `${field} harus salah satu dari: ${[...allowed].join(', ')}.`
    );
  }
}

// parseRateToScaled melempar TypeError/RangeError (fungsi domain murni, tidak
// tahu apa-apa soal HTTP). Diterjemahkan di sini supaya klien menerima 400
// dengan envelope yang konsisten, bukan 500 mentah.
function assertRateValid(rate: unknown): void {
  try {
    parseRateToScaled(rate);
  } catch (err) {
    throw new HttpError(400, 'VALIDATION_ERROR', (err as Error).message);
  }
}

function assertAppliesToConsistent(appliesTo: string, ids: ReadonlyArray<string>): void {
  if (appliesTo === 'all_items' && ids.length > 0) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      'appliesToIds harus kosong bila appliesTo = all_items.'
    );
  }
  if (appliesTo !== 'all_items' && ids.length === 0) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      `appliesToIds wajib diisi bila appliesTo = ${appliesTo}.`
    );
  }
}

// Guard untuk kolom `text[]` TANPA FK. Lihat komentar findInvisibleItemIds di
// catalog/handlers/items.ts: di sini tidak ada apa pun di database yang
// menolak id karangan, apalagi id milik tenant lain.
async function assertAppliesToIdsVisible(
  client: PoolClient,
  appliesTo: string,
  ids: ReadonlyArray<string>
): Promise<void> {
  if (appliesTo === 'all_items') return;
  const invisible =
    appliesTo === 'item'
      ? await findInvisibleItemIds(client, ids)
      : await findInvisibleCategoryIds(client, ids);
  if (invisible.length > 0) {
    // Menyebut id mana yang gagal: tanpa itu, klien dengan daftar panjang
    // hanya tahu "ada yang salah" dan harus menebak.
    throw new HttpError(
      404,
      appliesTo === 'item' ? 'ITEM_NOT_FOUND' : 'CATEGORY_NOT_FOUND',
      `${appliesTo === 'item' ? 'Item' : 'Kategori'} tidak ditemukan: ${invisible.join(', ')}.`
    );
  }
}

const INSERT_SQL = `
  INSERT INTO tax_rate (
    id, tenant_id, outlet_id, name, type, rate, is_inclusive, phase,
    jurisdiction, channel, applies_to, applies_to_ids, effective_from, effective_to
  ) VALUES (
    $1, $2, $3, $4, $5, $6::numeric, $7, $8,
    $9, $10, $11, $12::text[], COALESCE($13::timestamptz, now()), NULL
  )
  RETURNING *
`;

/**
 * Kandidat tarif yang berlaku untuk satu outlet pada saat ini.
 *
 * Penyaringan waktu dilakukan **di SQL dengan `now()`**, bukan `new Date()`
 * di Node. Bug dua-jam yang diperbaiki di `catalog/handlers/prices.ts` lahir
 * persis dari mencampur jam aplikasi dan jam database untuk satu instan yang
 * sama — baca komentar `AT_EXPR` di sana.
 *
 * Resolusi spesifisitas (item > category > all_items, outlet > null, channel
 * > all) **tidak** dilakukan di sini. Itu milik `calculateTax` di
 * `packages/domain`, karena klien offline harus menerapkan aturan yang sama
 * persis. Fungsi ini hanya mengambil kandidatnya.
 */
export async function fetchEffectiveTaxRates(
  client: PoolClient,
  outletId: string
): Promise<TaxRateSpec[]> {
  const { rows } = await client.query<TaxRateRow>(
    `SELECT * FROM tax_rate
      WHERE (outlet_id IS NULL OR outlet_id = $1)
        AND effective_from <= now()
        AND (effective_to IS NULL OR effective_to > now())
      ORDER BY id`,
    [outletId]
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    rateScaled: parseRateToScaled(row.rate),
    isInclusive: row.is_inclusive,
    // FR-C13 — ikut ke domain supaya rekapitulasi dapat memisahkan pajak per
    // yurisdiksi tanpa JOIN kedua ke `tax_rate` saat laporan dibuat.
    jurisdiction: row.jurisdiction,
    outletId: row.outlet_id,
    channel: row.channel as TaxRateSpec['channel'],
    appliesTo: row.applies_to as TaxRateSpec['appliesTo'],
    appliesToIds: row.applies_to_ids,
  }));
}

/**
 * Bentuk tarif untuk `before`/`after` audit.
 *
 * ⛔ `rate` dikirim sebagai STRING apa adanya dari kolom `numeric(6,4)`.
 * Melewatkannya lewat `Number` adalah persis yang `packages/domain/src/numeric.ts`
 * ada untuk mencegah — dan audit trail pajak yang angkanya bergeser adalah
 * bukti yang lebih buruk daripada tidak ada bukti.
 */
function ringkasTarif(row: TaxRateRow) {
  return {
    name: row.name,
    type: row.type,
    rate: String(row.rate),
    isInclusive: row.is_inclusive,
    phase: row.phase,
    channel: row.channel,
    appliesTo: row.applies_to,
    jurisdiction: row.jurisdiction,
    effectiveFrom: row.effective_from === null ? null : String(row.effective_from),
    effectiveTo: row.effective_to === null ? null : String(row.effective_to),
  };
}

export function createTaxRateHandlers(pool: Pool) {
  return {
    async createTaxRate(req: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const body = req.body as TaxRateInput;

      assertEnum(body.type, VALID_TYPES, 'type');
      assertRateValid(body.rate);
      const phase = body.phase ?? 'subtotal';
      assertEnum(phase, VALID_PHASES, 'phase');
      // AC FR-C7 pertama: channel default `all` saat tidak disebutkan.
      const channel = body.channel ?? 'all';
      assertEnum(channel, VALID_CHANNELS, 'channel');
      const appliesTo = body.appliesTo ?? 'all_items';
      assertEnum(appliesTo, VALID_APPLIES_TO, 'appliesTo');
      const appliesToIds = body.appliesToIds ?? [];
      assertAppliesToConsistent(appliesTo, appliesToIds);

      const row = await withTenantTransaction(pool, tenantId, async (client) => {
        // Kedua guard SEBELUM INSERT, di transaksi yang sama: FK PostgreSQL
        // tidak tunduk RLS (temuan F1, dibuktikan empat kali lewat sabotase),
        // dan applies_to_ids bahkan tidak punya FK sama sekali.
        if (body.outletId !== null && body.outletId !== undefined) {
          await assertOutletVisible(client, body.outletId);
        }
        await assertAppliesToIdsVisible(client, appliesTo, appliesToIds);

        try {
          const { rows } = await client.query<TaxRateRow>(INSERT_SQL, [
            body.id,
            tenantId,
            body.outletId ?? null,
            body.name,
            body.type,
            // Dikirim sebagai string ke `$6::numeric` -- PostgreSQL yang
            // mem-parse-nya, tanpa pernah melewati double di sisi JS.
            body.rate,
            body.isInclusive ?? false,
            phase,
            body.jurisdiction ?? null,
            channel,
            appliesTo,
            appliesToIds,
            body.effectiveFrom ?? null,
          ]);
          // FR-F6 + `spec-f:297` (`tax_rate_changed`). ⛔ Invariant #7 tidak
          // dilanggar: yang ditulis di sini SALINAN nilai yang `TaxCalculator`
          // hitung, bukan aritmetika pajak. Tidak ada satu pun angka tarif
          // yang dikarang di berkas audit.
          await catatPerubahanServer(client, {
            tenantId,
            actorUserId: actorId,
            eventType: 'tax_rate_changed',
            entityType: 'tax_rate',
            entityId: rows[0].id,
            outletId: rows[0].outlet_id,
            after: ringkasTarif(rows[0]),
          });
          return rows[0];
        } catch (err) {
          if (isPrimaryKeyViolation(err)) {
            throw new HttpError(409, 'ID_ALREADY_EXISTS', `Tarif pajak dengan id ${body.id} sudah ada.`);
          }
          throw err;
        }
      });

      reply.code(201);
      return toTaxRate(row);
    },

    async listTaxRates(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const rows = await withTenantTransaction(pool, tenantId, async (client) => {
        const { rows } = await client.query<TaxRateRow>('SELECT * FROM tax_rate ORDER BY id');
        return rows;
      });
      return { items: rows.map(toTaxRate) };
    },

    // FR-C6: mengakhiri tarif, BUKAN menghapusnya. Invariant #2 -- katalog dan
    // data finansial tidak pernah di-DELETE.
    async endTaxRate(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const { taxRateId } = req.params as { taxRateId: string };
      const row = await withTenantTransaction(pool, tenantId, async (client) => {
        // ⛔ Baris LAMA lebih dulu. `COALESCE(effective_to, now())` membuat
        // pengakhiran kedua tidak mengubah apa pun; tanpa `before`, audit
        // tidak dapat membedakan tarif yang baru saja diakhiri dari tarif yang
        // sudah lama berakhir dan diklik lagi.
        const { rows: lama } = await client.query<TaxRateRow>(
          'SELECT * FROM tax_rate WHERE id = $1',
          [taxRateId]
        );
        // now() dari jam database, sama seperti penyaringan di
        // fetchEffectiveTaxRates -- kalau keduanya memakai jam berbeda, tarif
        // bisa tampak masih berlaku sesaat setelah diakhiri.
        const { rows } = await client.query<TaxRateRow>(
          `UPDATE tax_rate SET effective_to = COALESCE(effective_to, now())
            WHERE id = $1 RETURNING *`,
          [taxRateId]
        );
        if (rows.length === 0) {
          throw new HttpError(404, 'NOT_FOUND', `Tarif pajak ${taxRateId} tidak ditemukan.`);
        }
        await catatPerubahanServer(client, {
          tenantId,
          actorUserId: actorId,
          eventType: 'tax_rate_changed',
          entityType: 'tax_rate',
          entityId: taxRateId,
          outletId: rows[0].outlet_id,
          before: lama.length === 0 ? null : ringkasTarif(lama[0]),
          after: ringkasTarif(rows[0]),
        });
        return rows[0];
      });
      return toTaxRate(row);
    },
  };
}

export { formatScaledRate };
