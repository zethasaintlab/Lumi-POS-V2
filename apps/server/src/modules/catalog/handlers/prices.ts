import type { Pool, PoolClient } from '../../../db.ts';
import { withTenantTransaction } from '../../../db.ts';
import { HttpError } from '../../../http-error.ts';
import { getTenantId, getActorId } from '../../../tenant-context.ts';
import { isPrimaryKeyViolation } from './pg-error.ts';
import { fetchVariationOrThrow } from './items.ts';
import { assertOutletVisible } from '../../tenancy/index.ts';
import { assertUserVisible } from '../../identity/index.ts';
import type { FastifyRequest, FastifyReply } from 'fastify';

interface PriceHistoryRow {
  id: string;
  variation_id: string;
  outlet_id: string | null;
  price: string; // bigint comes back as string from node-postgres
  effective_from: string;
  changed_by: string;
  reason: string | null;
}

interface PriceInput {
  id: string;
  price: unknown;
  outletId?: string | null;
  effectiveFrom?: string;
  reason?: string | null;
}

function toPrice(row: PriceHistoryRow) {
  return {
    id: row.id,
    variationId: row.variation_id,
    outletId: row.outlet_id,
    price: Number(row.price),
    effectiveFrom: row.effective_from,
    changedBy: row.changed_by,
    reason: row.reason,
  };
}

// Sama seperti assertPriceValid di items.ts (typeof + Number.isInteger
// dicek eksplisit, bukan hanya `< 0`, supaya string, float pecahan, null,
// dan NaN/Infinity semuanya ditolak) -- ditambah batas atas
// Number.MAX_SAFE_INTEGER, yang tidak dinyatakan lewat JSON Schema apa pun
// di openapi.yaml (lihat komentar di PriceInput di sana). price = 0 legal
// (barang gratis/promo, konsisten dengan assertModifierPriceValid).
function assertPriceValid(price: unknown): asserts price is number {
  if (
    typeof price !== 'number' ||
    !Number.isInteger(price) ||
    price < 0 ||
    price > Number.MAX_SAFE_INTEGER
  ) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      'Harga harus bilangan bulat rupiah >= 0 dan tidak melebihi Number.MAX_SAFE_INTEGER.'
    );
  }
}

export interface ResolvedPrice {
  price: number;
  source: 'outlet' | 'tenant' | 'variation';
  outletId: string | null;
  at: string;
}

interface PriceLadderRow {
  outlet_price: string | null;
  tenant_price: string | null;
  variation_price: string | null;
}

// Query resolusi FR-A7 (spec-a-katalog.md:202-209), satu round-trip lewat
// tiga scalar subquery -- BUKAN tiga query terpisah, dan BUKAN satu predikat
// `outlet_id IS NOT DISTINCT FROM $2` (lihat komentar migrasi 0016: operator
// itu tidak indexable, EXPLAIN membuktikannya muncul sebagai Filter, bukan
// Index Cond). `$3::timestamptz` di-cast eksplisit -- temuan tertunda di repo
// ini soal inferensi tipe parameter PostgreSQL (COALESCE tanpa cast bisa
// menyimpulkan tipe salah secara diam-diam).
//
// `outlet_id = $2` dengan $2 = NULL secara semantik SQL tidak pernah match
// baris apa pun (NULL = apa pun selalu UNKNOWN, bukan TRUE) -- jadi anak
// tangga 1 otomatis terlewati kalau caller tidak memberi outletId, tanpa
// perlu bentuk SQL bercabang untuk kasus itu.
const PRICE_LADDER_SQL = `
  SELECT
    (SELECT price FROM price_history
       WHERE variation_id = $1 AND outlet_id = $2 AND effective_from <= $3::timestamptz
       ORDER BY effective_from DESC, id DESC LIMIT 1) AS outlet_price,
    (SELECT price FROM price_history
       WHERE variation_id = $1 AND outlet_id IS NULL AND effective_from <= $3::timestamptz
       ORDER BY effective_from DESC, id DESC LIMIT 1) AS tenant_price,
    (SELECT price FROM item_variation WHERE id = $1) AS variation_price
`;

// Diekspor lewat catalog/index.ts (invariant #4 CLAUDE.md) supaya Modul B
// (order_line.unit_price adalah SNAPSHOT hasil fungsi ini) memakai fungsi
// ini langsung, bukan mengakses price_history/item_variation sendiri di
// luar modul katalog. `client` WAJIB berasal dari transaksi pemanggil yang
// sudah men-SET LOCAL app.tenant_id -- baru begitu SELECT ini tunduk RLS.
//
// Pemanggil (endpoint di modul ini) bertanggung jawab memvalidasi
// variationId (fetchVariationOrThrow) dan outletId (assertOutletVisible)
// SEBELUM memanggil resolvePrice -- fungsi ini sendiri tidak mengulang
// validasi itu, hanya menjaga diri lewat guard variation_price null di bawah
// untuk pemanggil yang lalai.
export async function resolvePrice(
  client: PoolClient,
  variationId: string,
  outletId: string | null,
  at: Date
): Promise<ResolvedPrice> {
  const atIso = at.toISOString();
  const { rows } = await client.query<PriceLadderRow>(PRICE_LADDER_SQL, [variationId, outletId, atIso]);
  const row = rows[0];
  if (row.outlet_price !== null) {
    return { price: Number(row.outlet_price), source: 'outlet', outletId, at: atIso };
  }
  if (row.tenant_price !== null) {
    return { price: Number(row.tenant_price), source: 'tenant', outletId, at: atIso };
  }
  if (row.variation_price === null) {
    // Hanya tercapai kalau pemanggil TIDAK memvalidasi variationId lebih
    // dulu -- bentuk error sama dengan fetchVariationOrThrow supaya
    // konsisten, bukan celah baru.
    throw new HttpError(404, 'NOT_FOUND', `Variation ${variationId} tidak ditemukan.`);
  }
  return { price: Number(row.variation_price), source: 'variation', outletId, at: atIso };
}

// Query T10 (GET /outlets/{outletId}/prices) -- bentuk LATERAL yang sama
// persis dengan PRICE_LADDER_SQL, tapi dijalankan sekali per outlet untuk
// SELURUH item_variation aktif tenant, bukan per variation (satu query,
// bukan N+1). `iv.archived_at IS NULL` menegakkan "seluruh item_variation
// aktif" (PLAN §T10); RLS pada item_variation dan price_history menegakkan
// isolasi tenant tanpa predikat tenant_id eksplisit di sini.
const OUTLET_PRICES_SQL = `
  SELECT
    iv.id AS variation_id,
    COALESCE(op.price, tp.price, iv.price) AS price,
    CASE
      WHEN op.price IS NOT NULL THEN 'outlet'
      WHEN tp.price IS NOT NULL THEN 'tenant'
      ELSE 'variation'
    END AS source
  FROM item_variation iv
  LEFT JOIN LATERAL (
    SELECT price FROM price_history
     WHERE variation_id = iv.id AND outlet_id = $1 AND effective_from <= $2::timestamptz
     ORDER BY effective_from DESC, id DESC LIMIT 1
  ) op ON true
  LEFT JOIN LATERAL (
    SELECT price FROM price_history
     WHERE variation_id = iv.id AND outlet_id IS NULL AND effective_from <= $2::timestamptz
     ORDER BY effective_from DESC, id DESC LIMIT 1
  ) tp ON true
  WHERE iv.archived_at IS NULL
  ORDER BY iv.id
`;

interface OutletPriceRow {
  variation_id: string;
  price: string;
  source: 'outlet' | 'tenant' | 'variation';
}

function parseAtQuery(at: string | undefined): Date {
  if (at === undefined) {
    return new Date();
  }
  const parsed = new Date(at);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Parameter at harus timestamp ISO 8601 yang valid.');
  }
  return parsed;
}

function translateConstraintError(err: unknown): never {
  if (isPrimaryKeyViolation(err)) {
    throw new HttpError(409, 'ID_ALREADY_EXISTS', 'Baris riwayat harga dengan id ini sudah ada.');
  }
  throw err;
}

async function insertPrice(
  client: PoolClient,
  tenantId: string,
  variationId: string,
  actorId: string,
  input: PriceInput
): Promise<PriceHistoryRow> {
  try {
    const { rows } = await client.query<PriceHistoryRow>(
      `INSERT INTO price_history (id, tenant_id, variation_id, outlet_id, price, effective_from, changed_by, reason)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, now()), $7, $8)
       RETURNING *`,
      [
        input.id,
        tenantId,
        variationId,
        input.outletId ?? null,
        input.price,
        input.effectiveFrom ?? null,
        actorId,
        input.reason ?? null,
      ]
    );
    return rows[0];
  } catch (err) {
    translateConstraintError(err);
  }
}

export function createPriceHandlers(pool: Pool) {
  return {
    // Invariant #2 -- SELALU INSERT, tidak pernah UPDATE. Urutan guard di
    // dalam satu withTenantTransaction (PLAN-katalog-harga-riwayat.md §
    // "Endpoint 1"): variation dulu (paling murah untuk gagal cepat kalau
    // itemId/variationId sudah salah), lalu actor, lalu outlet (kalau
    // dikirim) -- baru INSERT setelah ketiganya lolos SELECT yang tunduk
    // RLS. price divalidasi SEBELUM transaksi dibuka (fail fast, sama
    // seperti createItem menolak body.variations kosong sebelum transaksi).
    async createPrice(req: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const { itemId, variationId } = req.params as { itemId: string; variationId: string };
      const body = req.body as PriceInput;
      assertPriceValid(body.price);
      const row = await withTenantTransaction(pool, tenantId, async (client) => {
        await fetchVariationOrThrow(client, itemId, variationId);
        await assertUserVisible(client, actorId);
        // Guard ini BUKAN formalitas. Dibuktikan lewat sabotase (2 Agu 2026):
        // dinonaktifkan, request yang menunjuk outlet tenant lain lolos dengan
        // 201 dan barisnya BENAR-BENAR tersimpan -- bentuk bug FK-bukan-RLS
        // yang sama dengan temuan F1 di CLAUDE.md. FK ke outlet(id) tidak
        // menghentikannya karena FK dicek dengan privilese owner tabel yang
        // direferensikan, di luar FORCE ROW LEVEL SECURITY.
        if (body.outletId !== null && body.outletId !== undefined) {
          await assertOutletVisible(client, body.outletId);
        }
        return insertPrice(client, tenantId, variationId, actorId, body);
      });
      reply.code(201);
      return toPrice(row);
    },

    async listPrices(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const { itemId, variationId } = req.params as { itemId: string; variationId: string };
      const rows = await withTenantTransaction(pool, tenantId, async (client) => {
        await fetchVariationOrThrow(client, itemId, variationId);
        // `, id DESC` tie-breaker wajib (pelajaran review F1, dicatat di
        // CLAUDE.md): dua baris riwayat harga bisa berbagi effective_from
        // yang sama persis (mis. dua override yang dijadwalkan bersamaan),
        // dan tanpa tie-breaker urutannya arbitrary, tidak stabil antar run.
        const { rows } = await client.query<PriceHistoryRow>(
          'SELECT * FROM price_history WHERE variation_id = $1 ORDER BY effective_from DESC, id DESC',
          [variationId]
        );
        return rows;
      });
      return { items: rows.map(toPrice) };
    },

    // T7+T8: endpoint resolusi. variationId divalidasi lewat
    // fetchVariationOrThrow, outletId (kalau dikirim) lewat
    // assertOutletVisible -- SEBELUM resolvePrice dipanggil, sama seperti
    // createPrice. `at` opsional, default now() lewat parseAtQuery.
    async getResolvedPrice(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const { itemId, variationId } = req.params as { itemId: string; variationId: string };
      const query = req.query as { outletId?: string; at?: string };
      const at = parseAtQuery(query.at);
      const outletId = query.outletId ?? null;
      return withTenantTransaction(pool, tenantId, async (client) => {
        await fetchVariationOrThrow(client, itemId, variationId);
        if (outletId !== null) {
          await assertOutletVisible(client, outletId);
        }
        return resolvePrice(client, variationId, outletId, at);
      });
    },

    // T10: harga efektif seluruh item_variation aktif tenant, diselesaikan
    // untuk SATU outlet, dalam satu query (OUTLET_PRICES_SQL, LEFT JOIN
    // LATERAL) -- bukan N+1 per variation. Dibutuhkan klien POS saat sinkron
    // turun (PLAN §"Yang dibangun" T10).
    async listOutletPrices(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const { outletId } = req.params as { outletId: string };
      const query = req.query as { at?: string };
      const at = parseAtQuery(query.at);
      const atIso = at.toISOString();
      const rows = await withTenantTransaction(pool, tenantId, async (client) => {
        await assertOutletVisible(client, outletId);
        const { rows } = await client.query<OutletPriceRow>(OUTLET_PRICES_SQL, [outletId, atIso]);
        return rows;
      });
      return {
        items: rows.map((row) => ({
          variationId: row.variation_id,
          price: Number(row.price),
          source: row.source,
          outletId,
          at: atIso,
        })),
      };
    },
  };
}
