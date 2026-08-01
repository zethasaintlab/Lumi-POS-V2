import type { Pool, PoolClient } from '../../../db.ts';
import { withTenantTransaction } from '../../../db.ts';
import { HttpError } from '../../../http-error.ts';
import { getTenantId } from '../../../tenant-context.ts';
import type { FastifyRequest, FastifyReply } from 'fastify';

interface ItemRow {
  id: string;
  name: string;
  category_id: string | null;
  description: string | null;
  sort_order: number;
  archived_at: string | null;
}

interface VariationRow {
  id: string;
  item_id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  price: string; // bigint comes back as string from node-postgres
  cost: string;
  stocking_unit: string;
  selling_unit: string;
  conversion_factor: string;
  track_stock: boolean;
  sort_order: number;
  archived_at: string | null;
}

interface VariationInput {
  id: string;
  name?: string;
  sku?: string | null;
  barcode?: string | null;
  price: number;
  cost?: number;
  stockingUnit?: string;
  sellingUnit?: string;
  conversionFactor?: number;
  trackStock?: boolean;
}

function toVariation(row: VariationRow) {
  return {
    id: row.id,
    itemId: row.item_id,
    name: row.name,
    sku: row.sku,
    barcode: row.barcode,
    price: Number(row.price),
    cost: Number(row.cost),
    stockingUnit: row.stocking_unit,
    sellingUnit: row.selling_unit,
    conversionFactor: Number(row.conversion_factor),
    trackStock: row.track_stock,
    sortOrder: row.sort_order,
    archivedAt: row.archived_at,
  };
}

function toItem(row: ItemRow, variations: VariationRow[]) {
  return {
    id: row.id,
    name: row.name,
    categoryId: row.category_id,
    description: row.description,
    sortOrder: row.sort_order,
    archivedAt: row.archived_at,
    variations: variations.map(toVariation),
  };
}

const MAX_VARIATIONS_PER_ITEM = 250;

// K2 -- harga negatif ditolak di application layer (skema DB tidak punya
// CHECK-nya). typeof/Number.isInteger dicek eksplisit, bukan hanya `< 0`,
// supaya string, float pecahan (mis. 100.5), NaN, dan Infinity juga ditolak
// -- semuanya nilai yang lolos begitu saja lewat bare `price < 0`.
function assertPriceValid(input: VariationInput): void {
  if (typeof input.price !== 'number' || !Number.isInteger(input.price) || input.price < 0) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Harga harus bilangan bulat rupiah >= 0.');
  }
  if (input.cost !== undefined && (!Number.isInteger(input.cost) || input.cost < 0)) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Cost harus bilangan bulat rupiah >= 0.');
  }
}

// K1 -- batas 250 ditegakkan dengan COUNT di transaksi yang sama, BUKAN
// mengandalkan CHECK (sort_order <= 250): sort_order mulai dari 0, jadi CHECK
// itu baru menolak variation ke-252 (sort_order 251). spec-a-katalog.md § A.7
// menuntut yang ke-251 ditolak, jadi guard ini menghitung baris yang sudah
// ada dan menolak SEBELUM INSERT begitu hitungannya sudah mencapai batas.
//
// Known concurrency gap (dicatat, sengaja tidak diperbaiki di task ini --
// lihat instruksi "jangan tambah row locking" di brief): dua panggilan
// createItemVariation konkuren untuk item yang sama masing-masing bisa
// membaca COUNT yang sama sebelum salah satu commit, sehingga keduanya lolos
// guard ini dan total variation bisa melampaui 250 untuk sesaat/permanen.
// Sama seperti gap sort_order MAX+1 di bawah, ini masuk daftar untuk review
// whole-branch, bukan diperbaiki di sini.
async function assertVariationSlotAvailable(client: PoolClient, itemId: string): Promise<void> {
  const { rows } = await client.query<{ count: string }>(
    'SELECT COUNT(*) AS count FROM item_variation WHERE item_id = $1',
    [itemId]
  );
  if (Number(rows[0].count) >= MAX_VARIATIONS_PER_ITEM) {
    throw new HttpError(
      409,
      'VARIATION_LIMIT_EXCEEDED',
      `Batas ${MAX_VARIATIONS_PER_ITEM} variation per item sudah tercapai.`
    );
  }
}

function translateConstraintError(err: unknown): never {
  const pgErr = err as { code?: string };
  // Jaring pengaman: dipertahankan meskipun assertVariationSlotAvailable sudah
  // menegakkan batas 250 di application layer sebelum INSERT (K1). CHECK di
  // DB (sort_order <= 250) tetap ada di skema sebagai lapisan kedua -- kalau
  // race concurrency (lihat catatan di assertVariationSlotAvailable) suatu
  // saat mendorong lewat batas app-layer, CHECK ini yang menangkapnya di
  // sort_order 252 dan seterusnya, dan tetap harus dipetakan ke kode yang
  // sama, bukan 500 mentah.
  if (pgErr.code === '23514') {
    throw new HttpError(409, 'VARIATION_LIMIT_EXCEEDED', `Batas ${MAX_VARIATIONS_PER_ITEM} variation per item sudah tercapai.`);
  }
  if (pgErr.code === '23505') {
    throw new HttpError(409, 'BARCODE_DUPLICATE', 'Barcode sudah dipakai variation lain.');
  }
  throw err;
}

async function insertVariation(
  client: PoolClient,
  tenantId: string,
  itemId: string,
  input: VariationInput
): Promise<VariationRow> {
  assertPriceValid(input);
  await assertVariationSlotAvailable(client, itemId);
  try {
    const { rows } = await client.query<VariationRow>(
      `INSERT INTO item_variation
         (id, tenant_id, item_id, name, sku, barcode, price, cost, stocking_unit, selling_unit, conversion_factor, track_stock, sort_order)
       VALUES ($1, $2, $3, COALESCE($4, 'Regular'), $5, $6, $7, $8, COALESCE($9, 'pcs'), COALESCE($10, 'pcs'), COALESCE($11, 1), COALESCE($12, true),
         (SELECT COALESCE(MAX(sort_order) + 1, 0) FROM item_variation WHERE item_id = $3))
       RETURNING *`,
      [
        input.id,
        tenantId,
        itemId,
        input.name ?? null,
        input.sku ?? null,
        input.barcode ?? null,
        input.price,
        input.cost ?? 0,
        input.stockingUnit ?? null,
        input.sellingUnit ?? null,
        input.conversionFactor ?? null,
        input.trackStock ?? null,
      ]
    );
    return rows[0];
  } catch (err) {
    translateConstraintError(err);
  }
}

async function fetchItemOrThrow(client: PoolClient, itemId: string): Promise<ItemRow> {
  const { rows } = await client.query<ItemRow>('SELECT * FROM item WHERE id = $1', [itemId]);
  if (rows.length === 0) {
    throw new HttpError(404, 'NOT_FOUND', `Item ${itemId} tidak ditemukan.`);
  }
  return rows[0];
}

async function fetchVariations(client: PoolClient, itemId: string): Promise<VariationRow[]> {
  const { rows } = await client.query<VariationRow>(
    'SELECT * FROM item_variation WHERE item_id = $1 ORDER BY sort_order',
    [itemId]
  );
  return rows;
}

async function fetchVariationOrThrow(client: PoolClient, itemId: string, variationId: string): Promise<VariationRow> {
  const { rows } = await client.query<VariationRow>(
    'SELECT * FROM item_variation WHERE id = $1 AND item_id = $2',
    [variationId, itemId]
  );
  if (rows.length === 0) {
    throw new HttpError(404, 'NOT_FOUND', `Variation ${variationId} tidak ditemukan untuk item ${itemId}.`);
  }
  return rows[0];
}

export function createItemHandlers(pool: Pool) {
  return {
    async createItem(req: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(req);
      const body = req.body as {
        id: string;
        name: string;
        categoryId?: string | null;
        description?: string | null;
        sortOrder?: number;
        variations: VariationInput[];
      };
      // FR-A1: setiap Item harus punya >=1 variation, dan tidak boleh pernah
      // ada state Item-tanpa-variation tersimpan sekalipun sesaat -- makanya
      // ini dicek SEBELUM transaksi dibuka sama sekali (fail fast) dan, kalau
      // lolos di sini, item + variation pertamanya tetap masuk satu transaksi
      // yang sama di bawah.
      if (!body.variations || body.variations.length === 0) {
        throw new HttpError(400, 'ITEM_NO_VARIATION', 'Item harus punya minimal satu variation.');
      }
      const { item, variations } = await withTenantTransaction(pool, tenantId, async (client) => {
        const { rows } = await client.query<ItemRow>(
          `INSERT INTO item (id, tenant_id, name, category_id, description, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *`,
          [body.id, tenantId, body.name, body.categoryId ?? null, body.description ?? null, body.sortOrder ?? 0]
        );
        const item = rows[0];
        const variations: VariationRow[] = [];
        for (const v of body.variations) {
          variations.push(await insertVariation(client, tenantId, body.id, v));
        }
        return { item, variations };
      });
      reply.code(201);
      return toItem(item, variations);
    },

    async listItems(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const query = req.query as { includeArchived?: boolean; categoryId?: string };
      const items = await withTenantTransaction(pool, tenantId, async (client) => {
        const conditions: string[] = [];
        const params: unknown[] = [];
        if (!query.includeArchived) {
          conditions.push('archived_at IS NULL');
        }
        if (query.categoryId) {
          params.push(query.categoryId);
          conditions.push(`category_id = $${params.length}`);
        }
        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const { rows } = await client.query<ItemRow>(`SELECT * FROM item ${where} ORDER BY sort_order`, params);
        const result = [];
        for (const row of rows) {
          result.push(toItem(row, await fetchVariations(client, row.id)));
        }
        return result;
      });
      return { items };
    },

    async getItem(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const { itemId } = req.params as { itemId: string };
      const { item, variations } = await withTenantTransaction(pool, tenantId, async (client) => {
        const item = await fetchItemOrThrow(client, itemId);
        const variations = await fetchVariations(client, itemId);
        return { item, variations };
      });
      return toItem(item, variations);
    },

    async updateItem(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const { itemId } = req.params as { itemId: string };
      const body = req.body as { name?: string; categoryId?: string | null; description?: string | null; sortOrder?: number };
      const { item, variations } = await withTenantTransaction(pool, tenantId, async (client) => {
        await fetchItemOrThrow(client, itemId);
        const { rows } = await client.query<ItemRow>(
          `UPDATE item SET
             name = COALESCE($2, name),
             category_id = CASE WHEN $3 THEN $4 ELSE category_id END,
             description = CASE WHEN $5 THEN $6 ELSE description END,
             sort_order = COALESCE($7, sort_order)
           WHERE id = $1
           RETURNING *`,
          [
            itemId,
            body.name ?? null,
            'categoryId' in body,
            body.categoryId ?? null,
            'description' in body,
            body.description ?? null,
            body.sortOrder ?? null,
          ]
        );
        return { item: rows[0], variations: await fetchVariations(client, itemId) };
      });
      return toItem(item, variations);
    },

    async archiveItem(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const { itemId } = req.params as { itemId: string };
      const { item, variations } = await withTenantTransaction(pool, tenantId, async (client) => {
        await fetchItemOrThrow(client, itemId);
        const { rows } = await client.query<ItemRow>(
          'UPDATE item SET archived_at = now() WHERE id = $1 RETURNING *',
          [itemId]
        );
        return { item: rows[0], variations: await fetchVariations(client, itemId) };
      });
      return toItem(item, variations);
    },

    async restoreItem(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const { itemId } = req.params as { itemId: string };
      const { item, variations } = await withTenantTransaction(pool, tenantId, async (client) => {
        await fetchItemOrThrow(client, itemId);
        const { rows } = await client.query<ItemRow>(
          'UPDATE item SET archived_at = NULL WHERE id = $1 RETURNING *',
          [itemId]
        );
        return { item: rows[0], variations: await fetchVariations(client, itemId) };
      });
      return toItem(item, variations);
    },

    async createItemVariation(req: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(req);
      const { itemId } = req.params as { itemId: string };
      const body = req.body as VariationInput;
      const row = await withTenantTransaction(pool, tenantId, async (client) => {
        await fetchItemOrThrow(client, itemId);
        return insertVariation(client, tenantId, itemId, body);
      });
      reply.code(201);
      return toVariation(row);
    },

    // FR-A7 (harga + riwayat via price_history) belum dibangun -- endpoint ini
    // sengaja TIDAK menerima field `price` sama sekali, baik lewat skema
    // OpenAPI (tidak dideklarasikan) maupun di sini (tidak pernah dibaca dari
    // body). Extra field `price` yang dikirim client diam-diam diabaikan.
    async updateItemVariation(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const { itemId, variationId } = req.params as { itemId: string; variationId: string };
      const body = req.body as {
        name?: string;
        sku?: string | null;
        barcode?: string | null;
        trackStock?: boolean;
        stockingUnit?: string;
        sellingUnit?: string;
        conversionFactor?: number;
      };
      const row = await withTenantTransaction(pool, tenantId, async (client) => {
        await fetchVariationOrThrow(client, itemId, variationId);
        try {
          const { rows } = await client.query<VariationRow>(
            `UPDATE item_variation SET
               name = COALESCE($3, name),
               sku = CASE WHEN $4 THEN $5 ELSE sku END,
               barcode = CASE WHEN $6 THEN $7 ELSE barcode END,
               track_stock = COALESCE($8, track_stock),
               stocking_unit = COALESCE($9, stocking_unit),
               selling_unit = COALESCE($10, selling_unit),
               conversion_factor = COALESCE($11, conversion_factor)
             WHERE id = $1 AND item_id = $2
             RETURNING *`,
            [
              variationId,
              itemId,
              body.name ?? null,
              'sku' in body,
              body.sku ?? null,
              'barcode' in body,
              body.barcode ?? null,
              body.trackStock ?? null,
              body.stockingUnit ?? null,
              body.sellingUnit ?? null,
              body.conversionFactor ?? null,
            ]
          );
          return rows[0];
        } catch (err) {
          translateConstraintError(err);
        }
      });
      return toVariation(row);
    },

    async archiveItemVariation(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const { itemId, variationId } = req.params as { itemId: string; variationId: string };
      const row = await withTenantTransaction(pool, tenantId, async (client) => {
        await fetchVariationOrThrow(client, itemId, variationId);
        const { rows } = await client.query<VariationRow>(
          'UPDATE item_variation SET archived_at = now() WHERE id = $1 AND item_id = $2 RETURNING *',
          [variationId, itemId]
        );
        return rows[0];
      });
      return toVariation(row);
    },

    async restoreItemVariation(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const { itemId, variationId } = req.params as { itemId: string; variationId: string };
      const row = await withTenantTransaction(pool, tenantId, async (client) => {
        await fetchVariationOrThrow(client, itemId, variationId);
        const { rows } = await client.query<VariationRow>(
          'UPDATE item_variation SET archived_at = NULL WHERE id = $1 AND item_id = $2 RETURNING *',
          [variationId, itemId]
        );
        return rows[0];
      });
      return toVariation(row);
    },
  };
}
