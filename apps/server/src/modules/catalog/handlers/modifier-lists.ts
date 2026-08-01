import type { Pool, PoolClient } from '../../../db.ts';
import { withTenantTransaction } from '../../../db.ts';
import { HttpError } from '../../../http-error.ts';
import { getTenantId } from '../../../tenant-context.ts';
import { isPrimaryKeyViolation } from './pg-error.ts';
import type { FastifyRequest, FastifyReply } from 'fastify';

interface ModifierListRow {
  id: string;
  name: string;
  selection_type: string;
  min_selections: number;
  max_selections: number | null;
  allow_duplicate: boolean;
  is_required: boolean;
  archived_at: string | null;
}

interface ModifierRow {
  id: string;
  modifier_list_id: string;
  name: string;
  price: string; // bigint comes back as string from node-postgres
  is_default: boolean;
  sort_order: number;
  archived_at: string | null;
}

// Review finding (post-Task-4): sebelumnya ModifierList tidak bisa dibaca
// balik modifier-nya sama sekali -- tidak ada listModifiers/getModifier, dan
// fungsi ini tidak menyarangkan apa pun. K-04 "Pilih Modifier (modal)" (P0,
// offline-replicated) dan B-09 "Modifier List" di product/IA-lumi-pos-v1.md
// sama-sama butuh enumerasi modifier milik satu list. Perbaikannya BUKAN
// operasi ke-11 (listModifiers/getModifier) -- brief tetap membatasi modul
// ini pada 10 operasi -- tapi menyarangkan `modifiers` ke response
// ModifierList, pola yang SAMA PERSIS dengan toItem(row, variations) di
// items.ts untuk relasi 1:N yang identik bentuknya (Item -> ItemVariation).
function toModifierList(row: ModifierListRow, modifiers: ModifierRow[]) {
  return {
    id: row.id,
    name: row.name,
    selectionType: row.selection_type,
    minSelections: row.min_selections,
    maxSelections: row.max_selections,
    allowDuplicate: row.allow_duplicate,
    isRequired: row.is_required,
    archivedAt: row.archived_at,
    modifiers: modifiers.map(toModifier),
  };
}

function toModifier(row: ModifierRow) {
  return {
    id: row.id,
    modifierListId: row.modifier_list_id,
    name: row.name,
    price: Number(row.price),
    isDefault: row.is_default,
    sortOrder: row.sort_order,
    archivedAt: row.archived_at,
  };
}

const VALID_SELECTION_TYPES = ['single', 'multi'];

// FR-A1: modifier_list.selection_type punya CHECK (selection_type IN
// ('single','multi')) di DB (db/migrations/0004_catalog.sql). Divalidasi di
// sini SEBELUM INSERT/UPDATE supaya nilai tidak valid pulang sebagai 400
// VALIDATION_ERROR yang bersih, bukan 23514 mentah dari Postgres yang jatuh
// ke error handler generik (500) -- sama seperti K2 (assertPriceValid) di
// items.ts. openapi.yaml SENGAJA tidak mendeklarasikan `enum` pada
// requestBody-nya (hanya `type: string`) supaya AJV/fastify-openapi-glue
// tidak diam-diam menolak nilai salah lebih dulu lewat jalur validasi
// framework yang tidak menghasilkan envelope {error:{code,message}} --
// fungsi inilah yang harus jadi satu-satunya sumber kebenaran untuk kode
// error ini, persis seperti items.ts sengaja tidak mendeklarasikan
// `minimum: 0` pada price di request schema-nya.
//
// Dipanggil TANPA syarat di createModifierList (selectionType wajib ada di
// body -- undefined pun harus ditolak) dan BERSYARAT (hanya kalau field-nya
// benar-benar dikirim) di updateModifierList, supaya validasi yang sama
// berlaku identik di kedua jalur tanpa berbeda diam-diam.
function assertSelectionTypeValid(selectionType: unknown): void {
  if (typeof selectionType !== 'string' || !VALID_SELECTION_TYPES.includes(selectionType)) {
    throw new HttpError(400, 'VALIDATION_ERROR', "selectionType harus 'single' atau 'multi'.");
  }
}

// K2 dari items.ts (assertPriceValid) -- bentuknya dipakai ulang, bukan
// ditulis ulang dengan cara yang berbeda: typeof dan Number.isInteger dicek
// eksplisit (bukan hanya `< 0`) supaya string, float pecahan (mis. 100.5),
// NaN, dan Infinity juga ditolak, bukan cuma angka negatif. Rp 0 legal
// (spec-a-katalog.md § FR-A3 AC -- "Less Sugar" harus tetap bisa dibuat
// dengan harga 0 dan tetap tercetak di struk), jadi syaratnya >= 0. `price`
// opsional baik di create (default 0) maupun update ("tidak dikirim" berarti
// "jangan diubah"), jadi undefined selalu lolos di sini -- beda dari
// assertSelectionTypeValid yang wajib pada create.
function assertModifierPriceValid(price: unknown): void {
  if (price === undefined) return;
  if (typeof price !== 'number' || !Number.isInteger(price) || price < 0) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Harga modifier harus bilangan bulat rupiah >= 0.');
  }
}

// Jaring pengaman: dipertahankan meskipun assertSelectionTypeValid sudah
// menegakkan nilai yang sah di application layer sebelum INSERT/UPDATE.
// CHECK di DB (selection_type IN ('single','multi')) tetap ada di skema
// sebagai lapisan kedua -- kalau suatu saat ada jalur lain yang lolos dari
// assertSelectionTypeValid, ini menangkapnya dan tetap memetakan ke kode
// yang sama, bukan 500 mentah. Pola identik dengan translateConstraintError
// di items.ts.
function translateConstraintError(err: unknown): never {
  const pgErr = err as { code?: string };
  if (pgErr.code === '23514') {
    throw new HttpError(400, 'VALIDATION_ERROR', "selectionType harus 'single' atau 'multi'.");
  }
  // FIX 2 (whole-branch review, offline retry): id is client-generated --
  // a client re-sending the same createModifierList/createModifier after a
  // lost response must get a clean 409 it can recognize, not a raw 500.
  // Checked here (this function is shared by both createModifierList's and
  // updateModifierList's catch blocks) via err.constraint (see pg-error.ts)
  // rather than a bare `code === '23505'`, even though neither
  // modifier_list nor modifier has a second unique constraint today --
  // written the same defensive way as items.ts so the two files can't
  // silently diverge if one gains a unique index later.
  if (isPrimaryKeyViolation(err)) {
    throw new HttpError(409, 'ID_ALREADY_EXISTS', 'Baris dengan id ini sudah ada.');
  }
  throw err;
}

async function fetchModifierListOrThrow(client: PoolClient, modifierListId: string): Promise<ModifierListRow> {
  const { rows } = await client.query<ModifierListRow>('SELECT * FROM modifier_list WHERE id = $1', [modifierListId]);
  if (rows.length === 0) {
    throw new HttpError(404, 'NOT_FOUND', `ModifierList ${modifierListId} tidak ditemukan.`);
  }
  return rows[0];
}

// Sengaja TIDAK memfilter archived_at -- konsisten dengan fetchVariations di
// items.ts, yang juga tidak pernah menyaring variation yang diarsipkan dari
// Item induknya. archiveItemVariation membuktikan pola itu: variation yang
// diarsipkan tetap muncul di body.variations, statusnya terlihat lewat
// archivedAt-nya sendiri, bukan disembunyikan dari daftar induk. Modifier
// mengikuti bentuk yang sama persis -- includeArchived hanya mengontrol
// apakah ModifierList itu SENDIRI muncul di listModifierLists, sama seperti
// includeArchived pada listItems hanya mengontrol Item, bukan variation di
// dalamnya.
async function fetchModifiers(client: PoolClient, modifierListId: string): Promise<ModifierRow[]> {
  const { rows } = await client.query<ModifierRow>(
    'SELECT * FROM modifier WHERE modifier_list_id = $1 ORDER BY sort_order',
    [modifierListId]
  );
  return rows;
}

async function fetchModifierOrThrow(client: PoolClient, modifierListId: string, modifierId: string): Promise<ModifierRow> {
  const { rows } = await client.query<ModifierRow>(
    'SELECT * FROM modifier WHERE id = $1 AND modifier_list_id = $2',
    [modifierId, modifierListId]
  );
  if (rows.length === 0) {
    throw new HttpError(404, 'NOT_FOUND', `Modifier ${modifierId} tidak ditemukan untuk list ${modifierListId}.`);
  }
  return rows[0];
}

export function createModifierListHandlers(pool: Pool) {
  return {
    async createModifierList(req: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(req);
      const body = req.body as {
        id: string;
        name: string;
        selectionType: string;
        minSelections?: number;
        maxSelections?: number | null;
        allowDuplicate?: boolean;
        isRequired?: boolean;
      };
      assertSelectionTypeValid(body.selectionType);
      const row = await withTenantTransaction(pool, tenantId, async (client) => {
        try {
          const { rows } = await client.query<ModifierListRow>(
            `INSERT INTO modifier_list (id, tenant_id, name, selection_type, min_selections, max_selections, allow_duplicate, is_required)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING *`,
            [
              body.id,
              tenantId,
              body.name,
              body.selectionType,
              body.minSelections ?? 0,
              body.maxSelections ?? null,
              body.allowDuplicate ?? false,
              body.isRequired ?? false,
            ]
          );
          return rows[0];
        } catch (err) {
          translateConstraintError(err);
        }
      });
      reply.code(201);
      // List baru dibuat tanpa modifiers -- API createModifierList tidak
      // menerima modifier bersarang di body, jadi array kosong pasti benar
      // tanpa perlu SELECT tambahan (tidak ada apa pun yang bisa sudah
      // menunjuk ke list yang baru saja di-INSERT dalam transaksi yang sama).
      return toModifierList(row, []);
    },

    async listModifierLists(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const query = req.query as { includeArchived?: boolean };
      const items = await withTenantTransaction(pool, tenantId, async (client) => {
        const { rows } = await client.query<ModifierListRow>(
          query.includeArchived
            ? 'SELECT * FROM modifier_list ORDER BY name'
            : 'SELECT * FROM modifier_list WHERE archived_at IS NULL ORDER BY name'
        );
        const result = [];
        for (const row of rows) {
          result.push(toModifierList(row, await fetchModifiers(client, row.id)));
        }
        return result;
      });
      return { items };
    },

    async getModifierList(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const { modifierListId } = req.params as { modifierListId: string };
      const { list, modifiers } = await withTenantTransaction(pool, tenantId, async (client) => {
        const list = await fetchModifierListOrThrow(client, modifierListId);
        const modifiers = await fetchModifiers(client, modifierListId);
        return { list, modifiers };
      });
      return toModifierList(list, modifiers);
    },

    async updateModifierList(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const { modifierListId } = req.params as { modifierListId: string };
      const body = req.body as {
        name?: string;
        selectionType?: string;
        minSelections?: number;
        maxSelections?: number | null;
        allowDuplicate?: boolean;
        isRequired?: boolean;
      };
      // Sama seperti createModifierList: validasi identik di kedua jalur.
      // Bersyarat di sini (bukan tanpa syarat seperti create) karena
      // selectionType opsional pada PATCH -- "tidak dikirim" berarti
      // "jangan diubah", bukan "kosongkan".
      if ('selectionType' in body) {
        assertSelectionTypeValid(body.selectionType);
      }
      const { list, modifiers } = await withTenantTransaction(pool, tenantId, async (client) => {
        await fetchModifierListOrThrow(client, modifierListId);
        try {
          const { rows } = await client.query<ModifierListRow>(
            `UPDATE modifier_list SET
               name = COALESCE($2, name),
               selection_type = COALESCE($3, selection_type),
               min_selections = COALESCE($4, min_selections),
               max_selections = CASE WHEN $5 THEN $6 ELSE max_selections END,
               allow_duplicate = COALESCE($7, allow_duplicate),
               is_required = COALESCE($8, is_required)
             WHERE id = $1
             RETURNING *`,
            [
              modifierListId,
              body.name ?? null,
              body.selectionType ?? null,
              body.minSelections ?? null,
              'maxSelections' in body,
              body.maxSelections ?? null,
              body.allowDuplicate ?? null,
              body.isRequired ?? null,
            ]
          );
          return { list: rows[0], modifiers: await fetchModifiers(client, modifierListId) };
        } catch (err) {
          translateConstraintError(err);
        }
      });
      return toModifierList(list, modifiers);
    },

    async archiveModifierList(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const { modifierListId } = req.params as { modifierListId: string };
      const { list, modifiers } = await withTenantTransaction(pool, tenantId, async (client) => {
        await fetchModifierListOrThrow(client, modifierListId);
        const { rows } = await client.query<ModifierListRow>(
          'UPDATE modifier_list SET archived_at = now() WHERE id = $1 RETURNING *',
          [modifierListId]
        );
        return { list: rows[0], modifiers: await fetchModifiers(client, modifierListId) };
      });
      return toModifierList(list, modifiers);
    },

    async restoreModifierList(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const { modifierListId } = req.params as { modifierListId: string };
      const { list, modifiers } = await withTenantTransaction(pool, tenantId, async (client) => {
        await fetchModifierListOrThrow(client, modifierListId);
        const { rows } = await client.query<ModifierListRow>(
          'UPDATE modifier_list SET archived_at = NULL WHERE id = $1 RETURNING *',
          [modifierListId]
        );
        return { list: rows[0], modifiers: await fetchModifiers(client, modifierListId) };
      });
      return toModifierList(list, modifiers);
    },

    async createModifier(req: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(req);
      const { modifierListId } = req.params as { modifierListId: string };
      const body = req.body as { id: string; name: string; price?: number; isDefault?: boolean };
      assertModifierPriceValid(body.price);
      const row = await withTenantTransaction(pool, tenantId, async (client) => {
        // L7 -- modifier.modifier_list_id REFERENCES modifier_list(id) TIDAK
        // tunduk RLS: pengecekan referential integrity Postgres berjalan
        // dengan hak pemilik tabel, bukan peran yang dibatasi RLS
        // (dikonfirmasi empiris di Task 3 untuk item.category_id -- bentuknya
        // identik di sini). fetchModifierListOrThrow menutup celah ini karena
        // SELECT-nya berjalan lewat `client` yang sudah terikat ke
        // withTenantTransaction (app.tenant_id di-SET LOCAL untuk transaksi
        // ini, RLS aktif dengan FORCE ROW LEVEL SECURITY) -- baris
        // modifier_list milik tenant lain tidak akan pernah muncul di hasil
        // SELECT ini, sehingga modifierListId lintas tenant SELALU jatuh ke
        // NOT_FOUND 404 di sini, SEBELUM baris modifier mana pun sempat
        // di-INSERT dengan FK yang menunjuk ke situ. Pola identik dengan
        // assertCategoryVisible di items.ts.
        await fetchModifierListOrThrow(client, modifierListId);
        try {
          const { rows } = await client.query<ModifierRow>(
            `INSERT INTO modifier (id, tenant_id, modifier_list_id, name, price, is_default, sort_order)
             VALUES ($1, $2, $3, $4, $5, $6,
               (SELECT COALESCE(MAX(sort_order) + 1, 0) FROM modifier WHERE modifier_list_id = $3))
             RETURNING *`,
            [body.id, tenantId, modifierListId, body.name, body.price ?? 0, body.isDefault ?? false]
          );
          return rows[0];
        } catch (err) {
          // FIX 2 (whole-branch review, offline retry): this INSERT previously
          // had no try/catch at all -- a retried createModifier with the same
          // id fell straight through to a raw 500. Handled directly here
          // (rather than reusing translateConstraintError above) because that
          // function's 23514 branch is specific to modifier_list.selection_type
          // and would produce a misleading message if ever reached from this
          // table, which has no CHECK constraint of its own.
          if (isPrimaryKeyViolation(err)) {
            throw new HttpError(409, 'ID_ALREADY_EXISTS', `Modifier dengan id ${body.id} sudah ada.`);
          }
          throw err;
        }
      });
      reply.code(201);
      return toModifier(row);
    },

    async updateModifier(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const { modifierListId, modifierId } = req.params as { modifierListId: string; modifierId: string };
      const body = req.body as { name?: string; price?: number; isDefault?: boolean; sortOrder?: number };
      // Validasi harga identik dengan createModifier (lihat komentar di
      // assertModifierPriceValid) -- create dan update tidak boleh diam-diam
      // berbeda perilaku untuk field yang sama.
      assertModifierPriceValid(body.price);
      const row = await withTenantTransaction(pool, tenantId, async (client) => {
        await fetchModifierOrThrow(client, modifierListId, modifierId);
        const { rows } = await client.query<ModifierRow>(
          `UPDATE modifier SET
             name = COALESCE($3, name),
             price = COALESCE($4, price),
             is_default = COALESCE($5, is_default),
             sort_order = COALESCE($6, sort_order)
           WHERE id = $1 AND modifier_list_id = $2
           RETURNING *`,
          [modifierId, modifierListId, body.name ?? null, body.price ?? null, body.isDefault ?? null, body.sortOrder ?? null]
        );
        return rows[0];
      });
      return toModifier(row);
    },

    async archiveModifier(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const { modifierListId, modifierId } = req.params as { modifierListId: string; modifierId: string };
      const row = await withTenantTransaction(pool, tenantId, async (client) => {
        await fetchModifierOrThrow(client, modifierListId, modifierId);
        const { rows } = await client.query<ModifierRow>(
          'UPDATE modifier SET archived_at = now() WHERE id = $1 AND modifier_list_id = $2 RETURNING *',
          [modifierId, modifierListId]
        );
        return rows[0];
      });
      return toModifier(row);
    },

    async restoreModifier(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const { modifierListId, modifierId } = req.params as { modifierListId: string; modifierId: string };
      const row = await withTenantTransaction(pool, tenantId, async (client) => {
        await fetchModifierOrThrow(client, modifierListId, modifierId);
        const { rows } = await client.query<ModifierRow>(
          'UPDATE modifier SET archived_at = NULL WHERE id = $1 AND modifier_list_id = $2 RETURNING *',
          [modifierId, modifierListId]
        );
        return rows[0];
      });
      return toModifier(row);
    },
  };
}
