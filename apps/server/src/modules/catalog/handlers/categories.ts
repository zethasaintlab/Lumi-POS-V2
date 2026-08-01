import type { Pool, PoolClient } from '../../../db.ts';
import { withTenantTransaction } from '../../../db.ts';
import { HttpError } from '../../../http-error.ts';
import { getTenantId } from '../../../tenant-context.ts';
import type { FastifyRequest, FastifyReply } from 'fastify';

interface CategoryRow {
  id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
  color_hint: string | null;
  archived_at: string | null;
}

function toCategory(row: CategoryRow) {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    sortOrder: row.sort_order,
    colorHint: row.color_hint,
    archivedAt: row.archived_at,
  };
}

async function assertParentAllowsChild(client: PoolClient, parentId: string): Promise<void> {
  const { rows } = await client.query<{ parent_id: string | null }>(
    'SELECT parent_id FROM category WHERE id = $1',
    [parentId]
  );
  if (rows.length === 0) {
    throw new HttpError(404, 'NOT_FOUND', `Category induk ${parentId} tidak ditemukan.`);
  }
  if (rows[0].parent_id !== null) {
    throw new HttpError(
      409,
      'CATEGORY_DEPTH_EXCEEDED',
      'Kategori yang sudah punya induk tidak boleh menjadi induk kategori lain (maksimal dua tingkat).'
    );
  }
}

async function fetchCategoryOrThrow(client: PoolClient, tenantId: string, categoryId: string): Promise<CategoryRow> {
  const { rows } = await client.query<CategoryRow>('SELECT * FROM category WHERE id = $1', [categoryId]);
  if (rows.length === 0) {
    throw new HttpError(404, 'NOT_FOUND', `Category ${categoryId} tidak ditemukan.`);
  }
  return rows[0];
}

export function createCategoryHandlers(pool: Pool) {
  return {
    async createCategory(req: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(req);
      const body = req.body as {
        id: string;
        name: string;
        parentId?: string | null;
        sortOrder?: number;
        colorHint?: string | null;
      };
      const row = await withTenantTransaction(pool, tenantId, async (client) => {
        if (body.parentId) {
          await assertParentAllowsChild(client, body.parentId);
        }
        const { rows } = await client.query<CategoryRow>(
          `INSERT INTO category (id, tenant_id, name, parent_id, sort_order, color_hint)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *`,
          [body.id, tenantId, body.name, body.parentId ?? null, body.sortOrder ?? 0, body.colorHint ?? null]
        );
        return rows[0];
      });
      reply.code(201);
      return toCategory(row);
    },

    async listCategories(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const query = req.query as { includeArchived?: boolean };
      const rows = await withTenantTransaction(pool, tenantId, async (client) => {
        const { rows } = await client.query<CategoryRow>(
          query.includeArchived
            ? 'SELECT * FROM category ORDER BY sort_order'
            : 'SELECT * FROM category WHERE archived_at IS NULL ORDER BY sort_order'
        );
        return rows;
      });
      return { items: rows.map(toCategory) };
    },

    async getCategory(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const { categoryId } = req.params as { categoryId: string };
      const row = await withTenantTransaction(pool, tenantId, (client) =>
        fetchCategoryOrThrow(client, tenantId, categoryId)
      );
      return toCategory(row);
    },

    async updateCategory(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const { categoryId } = req.params as { categoryId: string };
      const body = req.body as { name?: string; parentId?: string | null; sortOrder?: number; colorHint?: string | null };
      const row = await withTenantTransaction(pool, tenantId, async (client) => {
        await fetchCategoryOrThrow(client, tenantId, categoryId);
        if (body.parentId) {
          await assertParentAllowsChild(client, body.parentId);
        }
        const { rows } = await client.query<CategoryRow>(
          `UPDATE category SET
             name = COALESCE($2, name),
             parent_id = CASE WHEN $3 THEN $4 ELSE parent_id END,
             sort_order = COALESCE($5, sort_order),
             color_hint = CASE WHEN $6 THEN $7 ELSE color_hint END
           WHERE id = $1
           RETURNING *`,
          [
            categoryId,
            body.name ?? null,
            'parentId' in body,
            body.parentId ?? null,
            body.sortOrder ?? null,
            'colorHint' in body,
            body.colorHint ?? null,
          ]
        );
        return rows[0];
      });
      return toCategory(row);
    },

    async archiveCategory(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const { categoryId } = req.params as { categoryId: string };
      const row = await withTenantTransaction(pool, tenantId, async (client) => {
        await fetchCategoryOrThrow(client, tenantId, categoryId);
        const { rows } = await client.query<CategoryRow>(
          'UPDATE category SET archived_at = now() WHERE id = $1 RETURNING *',
          [categoryId]
        );
        return rows[0];
      });
      return toCategory(row);
    },

    async restoreCategory(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const { categoryId } = req.params as { categoryId: string };
      const row = await withTenantTransaction(pool, tenantId, async (client) => {
        await fetchCategoryOrThrow(client, tenantId, categoryId);
        const { rows } = await client.query<CategoryRow>(
          'UPDATE category SET archived_at = NULL WHERE id = $1 RETURNING *',
          [categoryId]
        );
        return rows[0];
      });
      return toCategory(row);
    },
  };
}
