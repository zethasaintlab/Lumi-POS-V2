import type { Pool, PoolClient } from '../../../db.ts';
import { withTenantTransaction } from '../../../db.ts';
import { HttpError } from '../../../http-error.ts';
import { getTenantId } from '../../../tenant-context.ts';
import type { FastifyRequest, FastifyReply } from 'fastify';

interface BridgeRow {
  item_id: string;
  modifier_list_id: string;
  sort_order: number;
}

// L7 -- item_modifier_list.item_id REFERENCES item(id) and .modifier_list_id
// REFERENCES modifier_list(id) are BOTH not subject to RLS: Postgres runs FK
// referential-integrity checks with the referenced table's owner privileges,
// not the RLS-restricted role (confirmed empirically in Task 3 for
// item.category_id, and again in Task 4 for modifier.modifier_list_id --
// same shape here, just two FKs on one bridge row instead of one). Staged
// and verified empirically for THIS table too before adding these guards:
// with no guard at all, a cross-tenant attach (attacker's own item + a
// victim's modifierListId, or vice versa) returned 200 and the row was
// persisted -- see task-5-report.md for the exact command/output. These
// SELECTs run through `client`, which is bound to withTenantTransaction
// (app.tenant_id SET LOCAL for this transaction, FORCE ROW LEVEL SECURITY
// active), so a row belonging to another tenant never appears in the result
// -- itemId/modifierListId that don't resolve under the CALLING tenant's RLS
// view always fall through to NOT_FOUND 404 here, before any bridge row is
// ever INSERTed with a FK pointing there. Same pattern as
// assertCategoryVisible in items.ts and fetchModifierListOrThrow in
// modifier-lists.ts.
async function assertItemVisible(client: PoolClient, itemId: string): Promise<void> {
  const { rows } = await client.query('SELECT 1 FROM item WHERE id = $1', [itemId]);
  if (rows.length === 0) {
    throw new HttpError(404, 'NOT_FOUND', `Item ${itemId} tidak ditemukan.`);
  }
}

async function assertModifierListVisible(client: PoolClient, modifierListId: string): Promise<void> {
  const { rows } = await client.query('SELECT 1 FROM modifier_list WHERE id = $1', [modifierListId]);
  if (rows.length === 0) {
    throw new HttpError(404, 'NOT_FOUND', `ModifierList ${modifierListId} tidak ditemukan.`);
  }
}

export function createItemModifierListHandlers(pool: Pool) {
  return {
    async attachModifierList(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const { itemId, modifierListId } = req.params as { itemId: string; modifierListId: string };
      const body = (req.body as { sortOrder?: number } | undefined) ?? {};
      const row = await withTenantTransaction(pool, tenantId, async (client) => {
        await assertItemVisible(client, itemId);
        await assertModifierListVisible(client, modifierListId);
        // Idempotent by design: PRIMARY KEY (item_id, modifier_list_id) --
        // attaching an already-attached pair updates sort_order instead of
        // erroring, which is friendlier than forcing detach-then-reattach
        // just to reorder.
        const { rows } = await client.query<BridgeRow>(
          `INSERT INTO item_modifier_list (tenant_id, item_id, modifier_list_id, sort_order)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (item_id, modifier_list_id) DO UPDATE SET sort_order = EXCLUDED.sort_order
           RETURNING item_id, modifier_list_id, sort_order`,
          [tenantId, itemId, modifierListId, body.sortOrder ?? 0]
        );
        return rows[0];
      });
      return { itemId: row.item_id, modifierListId: row.modifier_list_id, sortOrder: row.sort_order };
    },

    // Deliberately does NOT call assertItemVisible/assertModifierListVisible
    // before the DELETE. Unlike attachModifierList (an INSERT with two
    // client-supplied FKs that Postgres won't scope to the calling tenant),
    // this is a DELETE ... WHERE, and the tenant_delete RLS policy
    // (db/migrations/0001_bootstrap_helpers.sql: `USING (tenant_id =
    // current_setting('app.tenant_id'))`) ANDs itself onto that WHERE
    // automatically. A caller can only ever delete rows whose tenant_id
    // matches their own SET LOCAL app.tenant_id -- there is no FK-shaped
    // bypass here because nothing is being trusted for a write, only used to
    // narrow a delete that's already tenant-scoped. Adding an existence
    // guard would not close any additional gap; it would instead turn the
    // response into a cross-tenant existence oracle (item/list found for
    // some OTHER tenant would 404 differently than "pair not attached").
    // detachModifierList therefore always returns 204 -- pair existed or
    // not, belonged to the caller or not -- deleting at most the caller's
    // own row and leaking no information either way.
    async detachModifierList(req: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(req);
      const { itemId, modifierListId } = req.params as { itemId: string; modifierListId: string };
      await withTenantTransaction(pool, tenantId, async (client) => {
        await client.query('DELETE FROM item_modifier_list WHERE item_id = $1 AND modifier_list_id = $2', [
          itemId,
          modifierListId,
        ]);
      });
      reply.code(204);
      return null;
    },
  };
}
