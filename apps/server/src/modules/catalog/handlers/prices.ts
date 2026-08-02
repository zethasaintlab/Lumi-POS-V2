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
  };
}
