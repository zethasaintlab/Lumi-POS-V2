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

// Locks two category ids together, in ONE statement, sorted by id -- before
// either row is read by any of the callers below. This is the single shared
// locking primitive for every "is parentId allowed to become X's parent"
// check in this file (createCategory's own guard, and updateCategory's
// assertCanReparent) -- deliberately not duplicated, so the two write paths
// can never drift into locking the same relationship two different ways.
//
// Two concurrent requests that both touch the same pair of ids (e.g.
// updateCategory A->B racing updateCategory B->A) will therefore always
// request their locks in the same order (sorted, not request/arrival order),
// so neither can wait on a lock the other already holds while holding one the
// other wants: no deadlock between two *pair* lockers. The second transaction
// to arrive simply blocks on this statement until the first COMMITs, then --
// under PostgreSQL's default READ COMMITTED, which withTenantTransaction runs
// at (see db.ts: a bare `BEGIN`, no explicit isolation level) -- a blocked FOR
// UPDATE that unblocks re-reads the row as of the most recently committed
// version, not the snapshot from when the statement was first issued. That's
// what makes this a real fix and not just a performance detail: without it,
// concurrent transactions read stale parent_id values, all pass, all commit,
// and invariants that depend on serialized reads (no cycles, no hidden third
// levels) silently break.
//
// createCategory calls this with (body.id, parentId) where body.id is the
// client-supplied id of a row that does not exist yet -- the INSERT hasn't
// run. `WHERE id = ANY(...)` can only lock rows that exist, so this call
// locks exactly one row (parentId), never two. A transaction that acquires at
// most one row lock, and never requests a second lock afterward in the same
// transaction, cannot be one side of a deadlock cycle: a cycle requires each
// participating transaction to be blocked waiting for a resource while
// holding a *different* resource the other transaction needs, and
// createCategory's transaction never holds anything else concurrently while
// it waits for this one lock. So createCategory's single-row lock is safe
// against updateCategory's sorted two-row lock regardless of arrival order.
async function lockCategoryPair(
  client: PoolClient,
  idA: string,
  idB: string
): Promise<Map<string, string | null>> {
  const { rows } = await client.query<{ id: string; parent_id: string | null }>(
    'SELECT id, parent_id FROM category WHERE id = ANY($1) ORDER BY id FOR UPDATE',
    [[idA, idB]]
  );
  return new Map(rows.map((row) => [row.id, row.parent_id]));
}

// Checks that `parentId` is allowed to become the parent of `childCandidateId`
// -- i.e. that parentId itself currently has no parent (max two levels).
// Shared by createCategory (childCandidateId = the not-yet-inserted body.id)
// and assertCanReparent/updateCategory (childCandidateId = the existing
// category being reparented) so both paths lock and read parentId's own
// parent_id identically. See lockCategoryPair's comment for why the lock
// (rather than a plain SELECT) is what makes this correct under concurrency.
async function assertParentAllowsChild(client: PoolClient, childCandidateId: string, parentId: string): Promise<void> {
  const locked = await lockCategoryPair(client, childCandidateId, parentId);
  const parentParentId = locked.get(parentId);
  if (parentParentId === undefined) {
    throw new HttpError(404, 'NOT_FOUND', `Category induk ${parentId} tidak ditemukan.`);
  }
  if (parentParentId !== null) {
    throw new HttpError(
      409,
      'CATEGORY_DEPTH_EXCEEDED',
      'Kategori yang sudah punya induk tidak boleh menjadi induk kategori lain (maksimal dua tingkat).'
    );
  }
}

// Guards the two-level cap for updateCategory specifically (createCategory can't
// violate either check it adds: a brand-new row can't equal its own not-yet-inserted
// id, and it can't already have children referencing an id that didn't exist before
// this call). assertParentAllowsChild alone -- checking only the proposed parent's
// own parent_id -- misses two ways to still blow the cap through PATCH:
//   1. self-parenting: parentId === the category being updated
//   2. reparenting a category that already has children under a new (even top-level)
//      parent, which would produce a third level below the new parent
//
// Known residual gap (not fixed here, out of scope for this round): the
// children-check below is still a plain, unlocked SELECT. It closes the
// two-party swap race and the create-vs-reparent race (both now go through
// assertParentAllowsChild's shared lock), but a race remains between this
// PATCH's children-check and a *third* concurrent createCategory inserting a
// brand-new child under `categoryId` after this check has already run but
// before this transaction commits. Flagged for the whole-branch review.
async function assertCanReparent(client: PoolClient, categoryId: string, parentId: string): Promise<void> {
  if (parentId === categoryId) {
    throw new HttpError(
      409,
      'CATEGORY_SELF_PARENT',
      'Kategori tidak boleh menjadi induk dirinya sendiri.'
    );
  }
  await assertParentAllowsChild(client, categoryId, parentId);
  const { rows } = await client.query('SELECT 1 FROM category WHERE parent_id = $1 LIMIT 1', [categoryId]);
  if (rows.length > 0) {
    throw new HttpError(
      409,
      'CATEGORY_DEPTH_EXCEEDED',
      'Kategori yang sudah punya anak tidak boleh dipindahkan menjadi anak kategori lain (maksimal dua tingkat).'
    );
  }
}

async function fetchCategoryOrThrow(client: PoolClient, categoryId: string): Promise<CategoryRow> {
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
        // Explicit presence-and-non-null test (not `if (body.parentId)`, which is
        // truthy and lets an empty string silently skip this guard and fall through
        // to an unhandled FK-violation 500 at the INSERT below) -- same shape as the
        // equivalent guard in updateCategory, for a consistent client-facing error.
        if (body.parentId !== null && body.parentId !== undefined) {
          if (body.parentId === '') {
            throw new HttpError(400, 'INVALID_PARENT_ID', 'parentId tidak boleh string kosong.');
          }
          await assertParentAllowsChild(client, body.id, body.parentId);
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
        fetchCategoryOrThrow(client, categoryId)
      );
      return toCategory(row);
    },

    async updateCategory(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const { categoryId } = req.params as { categoryId: string };
      const body = req.body as { name?: string; parentId?: string | null; sortOrder?: number; colorHint?: string | null };
      const row = await withTenantTransaction(pool, tenantId, async (client) => {
        await fetchCategoryOrThrow(client, categoryId);
        // Explicit presence-and-non-null test (not `if (body.parentId)`, which is
        // truthy and lets an empty string silently skip this guard and fall through
        // to an unhandled FK-violation 500 at the UPDATE below).
        if ('parentId' in body && body.parentId !== null && body.parentId !== undefined) {
          if (body.parentId === '') {
            throw new HttpError(400, 'INVALID_PARENT_ID', 'parentId tidak boleh string kosong.');
          }
          await assertCanReparent(client, categoryId, body.parentId);
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
        await fetchCategoryOrThrow(client, categoryId);
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
        await fetchCategoryOrThrow(client, categoryId);
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
