import type { Pool, PoolClient } from '../../../db.ts';
import { withTenantTransaction } from '../../../db.ts';
import { HttpError } from '../../../http-error.ts';
import { getTenantId } from '../../../tenant-context.ts';
import { isPrimaryKeyViolation, isTenantForeignKeyViolation } from './pg-error.ts';
import { toModifierList, fetchModifierListsByIds, fetchModifiersForLists } from './modifier-lists.ts';
import { assertKuota } from '../../tenancy/index.ts';
import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Pemakaian kuota `max_products`, dihitung modul yang MEMILIKI tabelnya
 * (invariant #4 -- modul tenancy tidak boleh query `item`).
 *
 * Satu fungsi, dipakai `POST /items` maupun `POST /catalog/import`. Dua
 * salinan akan menyimpang tepat pada aturan arsip, dan yang menyimpang adalah
 * jalur impor -- jalur yang justru dirancang untuk volume.
 */
export async function hitungProduk(client: PoolClient): Promise<number> {
  const { rows } = await client.query<{ n: string }>(
    'SELECT count(*) AS n FROM item WHERE archived_at IS NULL'
  );
  return Number(rows[0].n);
}

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

// FIX 5 (whole-branch review): attachModifierList/detachModifierList existed
// and the bridge stored sort_order, but no endpoint ever returned an item's
// attached modifier lists back -- a client could write the relation and
// never read it back, and the sortOrder it wrote was unobservable. K-04
// "Pilih Modifier (modal)" (product/IA-lumi-pos-v1.md) needs to know which
// lists apply to the item being rung up -- and, to render the modal's
// choices, what THOSE lists' own modifiers are -- so `modifierLists` nests
// the full toModifierList() shape (including its own `modifiers`), not just
// ids. Same reasoning that already justified nesting `modifiers` into
// ModifierList one level down.
function toItem(row: ItemRow, variations: VariationRow[], modifierLists: ReturnType<typeof toModifierList>[]) {
  return {
    id: row.id,
    name: row.name,
    categoryId: row.category_id,
    description: row.description,
    sortOrder: row.sort_order,
    archivedAt: row.archived_at,
    variations: variations.map(toVariation),
    modifierLists,
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

// Whole-branch review FIX 8: conversion_factor sebelumnya tanpa validasi sama
// sekali -- 0, negatif, dan non-finite semuanya lolos apa adanya ke DB.
// conversion_factor = 0 adalah divide-by-zero laten untuk Module E (inventori,
// belum dibangun) saat menghitung kuantitas stocking-unit dari selling-unit.
// FR-A9 menyatakan tidak ada UI di v1 yang mengubah nilai ini setelah dibuat,
// jadi syarat ketat `> 0` aman dan tidak memblokir alur mana pun yang ada.
// Number.isFinite juga menolak Infinity, yang lolos AJV `type: number`
// (typeof Infinity === 'number') dan bisa dicapai lewat JSON literal 1e400.
function assertConversionFactorValid(value: number | undefined): void {
  if (value === undefined) return;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'conversionFactor harus angka lebih besar dari 0.');
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
  // FIX 2 (whole-branch review): item_variation has TWO unique constraints --
  // the PK on `id` and `ux_variation_barcode` -- and a bare `code === '23505'`
  // check can't tell them apart. Before this, a client retrying a variation
  // create with the SAME id (offline retry, no barcode involved at all) got
  // "Barcode sudah dipakai variation lain", sending a merchant hunting a
  // barcode conflict that never existed. isPrimaryKeyViolation checks
  // err.constraint (see pg-error.ts) to route the two cases to distinct
  // codes; this MUST be checked before the generic 23505 branch below, since
  // a PK violation is also `code === '23505'`.
  if (isPrimaryKeyViolation(err)) {
    throw new HttpError(409, 'ID_ALREADY_EXISTS', 'Variation dengan id ini sudah ada.');
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
  assertConversionFactorValid(input.conversionFactor);
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
  // FIX 6 (whole-branch review): `, id` tie-breaker -- insertVariation always
  // assigns a unique MAX(sort_order)+1 today, so a tie can't occur through
  // this handler, but this stays deterministic (rather than relying on
  // whatever order Postgres's scan happens to produce) if that ever changes,
  // same as every other ORDER BY in this module.
  const { rows } = await client.query<VariationRow>(
    'SELECT * FROM item_variation WHERE item_id = $1 ORDER BY sort_order, id',
    [itemId]
  );
  return rows;
}

interface ItemModifierListBridgeRow {
  item_id: string;
  modifier_list_id: string;
  sort_order: number;
}

// FIX 5 (whole-branch review) N+1 guard: listItems already issues one
// fetchVariations query per item (pre-existing, out of scope to fix here per
// brief). Adding modifierLists must NOT make that two queries per item -- so
// this fetches the item_modifier_list bridge rows for ALL given itemIds in
// ONE query, then the modifier_list rows and modifier rows for the union of
// attached list ids in one query each (fetchModifierListsByIds /
// fetchModifiersForLists, modifier-lists.ts). Total added cost for a
// listItems call is 3 queries FIXED, never per-item, regardless of how many
// items or attached lists there are. Used both here (batched, N items) and
// by fetchModifierListsForItem below (single item, itemIds = [itemId]) so
// getItem/updateItem/archiveItem/restoreItem share the exact same code path
// instead of a second, easier-to-drift implementation for the singular case.
//
// `, modifier_list_id` tie-breaker included from the start (this is a
// brand-new query, not one of the pre-existing ORDER BYs this whole-branch
// review's FIX 6 addresses).
async function fetchModifierListsForItems(
  client: PoolClient,
  itemIds: string[]
): Promise<Map<string, ReturnType<typeof toModifierList>[]>> {
  const result = new Map<string, ReturnType<typeof toModifierList>[]>();
  if (itemIds.length === 0) return result;

  const { rows: bridgeRows } = await client.query<ItemModifierListBridgeRow>(
    'SELECT item_id, modifier_list_id, sort_order FROM item_modifier_list WHERE item_id = ANY($1) ORDER BY sort_order, modifier_list_id',
    [itemIds]
  );
  if (bridgeRows.length === 0) return result;

  const listIds = [...new Set(bridgeRows.map((row) => row.modifier_list_id))];
  const listsById = await fetchModifierListsByIds(client, listIds);
  const modifiersByListId = await fetchModifiersForLists(client, listIds);

  for (const bridge of bridgeRows) {
    const listRow = listsById.get(bridge.modifier_list_id);
    // Defensive only: under FK + RLS this can't actually miss (the bridge
    // row's modifier_list_id can only reference a list visible to this same
    // tenant transaction) -- skip rather than crash the whole Item response
    // if it ever does.
    if (!listRow) continue;
    const nested = toModifierList(listRow, modifiersByListId.get(listRow.id) ?? []);
    const forItem = result.get(bridge.item_id) ?? [];
    forItem.push(nested);
    result.set(bridge.item_id, forItem);
  }
  return result;
}

async function fetchModifierListsForItem(client: PoolClient, itemId: string): Promise<ReturnType<typeof toModifierList>[]> {
  const byItem = await fetchModifierListsForItems(client, [itemId]);
  return byItem.get(itemId) ?? [];
}

// Exported so prices.ts (sub-project 2, FR-A7) can reuse the exact same
// RLS-scoped lookup instead of duplicating it -- a variation lintas tenant
// harus 404 di jalur harga persis seperti di jalur PATCH/archive di sini.
export async function fetchVariationOrThrow(client: PoolClient, itemId: string, variationId: string): Promise<VariationRow> {
  const { rows } = await client.query<VariationRow>(
    'SELECT * FROM item_variation WHERE id = $1 AND item_id = $2',
    [variationId, itemId]
  );
  if (rows.length === 0) {
    throw new HttpError(404, 'NOT_FOUND', `Variation ${variationId} tidak ditemukan untuk item ${itemId}.`);
  }
  return rows[0];
}

export interface VariationSnapshotRow {
  itemName: string;
  variationName: string;
  cost: string; // bigint comes back as string from node-postgres
  // T12 (PLAN-pembayaran-pajak.md) -- calculateTax meresolusi tarif per baris
  // lewat itemId dan categoryId (FR-C6: item > category > all_items). Modul
  // ordering tidak boleh query item/category langsung, jadi keduanya ikut di
  // sini alih-alih lewat SELECT kedua.
  itemId: string;
  categoryId: string | null;
  /** FR-E2 — `sale` hanya ditulis untuk variation yang stoknya dilacak. */
  trackStock: boolean;
}

// T5 (PLAN-ordering-fondasi.md §T5/T6) -- diekspor lewat catalog/index.ts
// (invariant #4, CLAUDE.md): modul ordering TIDAK BOLEH query item/
// item_variation langsung, jadi ia butuh SATU titik masuk terkontrol untuk
// mengambil nilai-nilai yang di-SALIN ke order_line sebagai snapshot
// (item_name, variation_name, cost_at_sale -- FR-B3). `client` WAJIB berasal
// dari transaksi pemanggil yang sudah men-SET LOCAL app.tenant_id, persis
// seperti resolvePrice di prices.ts -- baru begitu SELECT ini tunduk RLS.
//
// Mengembalikan `null`, BUKAN melempar 404, dengan sengaja: fungsi ini tidak
// tahu error code/pesan apa yang cocok untuk konteks pemanggil ("variation
// tidak ditemukan" berarti sesuatu yang berbeda buat createOrder dibanding
// buat endpoint katalog sendiri) -- sama seperti pemanggil resolvePrice yang
// memvalidasi variationId lebih dulu lewat guard miliknya sendiri, bukan
// mengandalkan bentuk error fungsi katalog.
//
// Sengaja TIDAK memfilter archived_at IS NULL -- sama seperti
// fetchVariationOrThrow di atas, "ada" dan "aktif" adalah dua pertanyaan
// berbeda, dan sub-project ini tidak diminta menjawab yang kedua (lihat
// brief §"Batasan keras": jangan memperluas scope).
export async function getVariationSnapshot(client: PoolClient, variationId: string): Promise<VariationSnapshotRow | null> {
  const { rows } = await client.query<{
    item_name: string; variation_name: string; cost: string;
    item_id: string; category_id: string | null; track_stock: boolean;
  }>(
    // ⛔ `item_id` dan `category_id` DISELEKSI. Versi sebelumnya
    // memetakannya ke hasil tanpa pernah memintanya, jadi keduanya
    // `undefined` — dan `calculateTax` mencocokkan tarif ber-`applies_to`
    // 'item'/'category' lewat kedua nilai itu. Akibatnya tarif ber-scope item
    // atau kategori TIDAK PERNAH berlaku di server (FR-C6), tanpa satu pun
    // error: `undefined` hanya tidak cocok dengan apa pun, lalu resolusinya
    // diam-diam jatuh ke `all_items`.
    //
    // `track_stock` untuk FR-E2 — `sale` hanya ditulis untuk variation yang
    // stoknya dilacak. Ia ikut di sini, bukan lewat SELECT kedua dari modul
    // ordering: invariant #4 melarang akses lintas modul ke tabel katalog.
    `SELECT i.name AS item_name, iv.name AS variation_name, iv.cost AS cost,
            iv.item_id AS item_id, i.category_id AS category_id,
            iv.track_stock AS track_stock
     FROM item_variation iv
     JOIN item i ON i.id = iv.item_id
     WHERE iv.id = $1`,
    [variationId]
  );
  if (rows.length === 0) {
    return null;
  }
  return {
    itemName: rows[0].item_name,
    variationName: rows[0].variation_name,
    cost: rows[0].cost,
    itemId: rows[0].item_id,
    categoryId: rows[0].category_id,
    trackStock: rows[0].track_stock,
  };
}

// T8 (PLAN-pembayaran-pajak.md) -- diekspor lewat catalog/index.ts untuk modul
// payment, yang menyimpan `tax_rate.applies_to_ids`.
//
// Kolom itu `text[]` **TANPA FK sama sekali**. Bukan sekadar FK yang tidak
// tunduk RLS (temuan F1) -- di sini tidak ada apa pun di database yang
// menolak id karangan, apalagi id milik tenant lain. Ia kelas yang sama
// dengan `price_history.changed_by`: kolom yang isinya tidak dijamin
// siapa-siapa, dan justru lebih berbahaya karena tidak ada yang TERLIHAT
// menjaganya.
//
// Memvalidasi SELURUH daftar dalam satu SELECT, bukan satu per satu:
// menerima sebagian akan menyimpan tarif yang separuh menunjuk data tenant
// lain -- terlihat berhasil, dan itu bentuk kegagalan yang lebih buruk
// daripada ditolak.
//
// Mengembalikan id yang TIDAK terlihat (bukan boolean) supaya pemanggil bisa
// menyebutkan mana yang gagal di pesan errornya.
async function findInvisibleIds(
  client: PoolClient,
  table: 'item' | 'category',
  ids: ReadonlyArray<string>
): Promise<string[]> {
  if (ids.length === 0) {
    return [];
  }
  // Nama tabel berasal dari union tipe di atas, bukan dari input pemanggil --
  // tidak ada jalur interpolasi string yang bisa disuplai klien.
  const { rows } = await client.query<{ id: string }>(
    `SELECT id FROM "${table}" WHERE id = ANY($1::text[])`,
    [[...ids]]
  );
  const terlihat = new Set(rows.map((r) => r.id));
  return [...new Set(ids)].filter((id) => !terlihat.has(id));
}

export async function findInvisibleItemIds(client: PoolClient, ids: ReadonlyArray<string>): Promise<string[]> {
  return findInvisibleIds(client, 'item', ids);
}

export async function findInvisibleCategoryIds(client: PoolClient, ids: ReadonlyArray<string>): Promise<string[]> {
  return findInvisibleIds(client, 'category', ids);
}

// Review finding (post-Task-3): item.category_id REFERENCES category(id) proves
// only that the category exists *somewhere* -- PostgreSQL's own foreign-key
// referential-integrity check runs as the referenced table's owner, NOT subject
// to RLS, so it cannot tell a category belonging to the calling tenant apart
// from one belonging to a different tenant. Confirmed empirically before this
// guard existed: an HTTP createItem with a categoryId seeded under a different
// tenant returned 201, and the FK happily accepted it.
//
// Same shape as categories.ts's assertParentAllowsChild (RLS-scoped SELECT
// before trusting a client-supplied id that crosses into another row), applied
// here to item -> category instead of category -> category. Deliberately a
// plain, unlocked SELECT -- no FOR UPDATE -- since row locking for this module
// is explicitly deferred to the whole-branch concurrency pass, and unlike
// categories.ts's pair-lock (which guards against a *concurrent write* to the
// same two rows), there is nothing here for two transactions to race over: a
// category's tenant_id is set once at creation and never reassigned.
async function assertCategoryVisible(client: PoolClient, categoryId: string): Promise<void> {
  const { rows } = await client.query('SELECT 1 FROM category WHERE id = $1', [categoryId]);
  if (rows.length === 0) {
    throw new HttpError(404, 'NOT_FOUND', `Category ${categoryId} tidak ditemukan.`);
  }
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
        if (body.categoryId !== null && body.categoryId !== undefined) {
          await assertCategoryVisible(client, body.categoryId);
        }

        // Titik penegakan `max_products` (`research/09` § 6).
        //
        // ⛔ Dihitung per ITEM, bukan per variation. `spec-a:370` menandai ini
        // sebagai pertanyaan terbuka ("dihitung per variation atau per
        // item?"); yang dipilih adalah satuan yang MERCHANT lihat di
        // katalognya. `[ASUMSI]` -- kalau kelak diputuskan per variation,
        // yang berubah hanya query ini dan pasangannya di `import.ts`.
        //
        // Item yang diarsipkan tidak dihitung: katalog tidak pernah di-DELETE
        // (invariant #2), jadi menghitungnya membuat kuota menjadi penghitung
        // seumur hidup yang tidak dapat dipulihkan dengan cara apa pun.
        await assertKuota(client, tenantId, 'produk', await hitungProduk(client), 1);

        let item: ItemRow;
        try {
          const { rows } = await client.query<ItemRow>(
            `INSERT INTO item (id, tenant_id, name, category_id, description, sort_order)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [body.id, tenantId, body.name, body.categoryId ?? null, body.description ?? null, body.sortOrder ?? 0]
          );
          item = rows[0];
        } catch (err) {
          // Offline retry (FIX 2): id is client-generated -- a client
          // re-sending the same createItem after a lost response must get a
          // clean 409 it can recognize, not a raw 500. Same isPrimaryKeyViolation
          // check as insertVariation's translateConstraintError below, kept
          // separate here because this INSERT (into `item`) has no unique
          // index of its own to disambiguate from -- only the PK can 23505.
          if (isPrimaryKeyViolation(err)) {
            throw new HttpError(409, 'ID_ALREADY_EXISTS', `Item dengan id ${body.id} sudah ada.`);
          }
          // Unknown tenant (FIX 3): reachable here specifically when
          // categoryId is absent -- there is no earlier tenant-scoped SELECT
          // to catch it first (compare: when categoryId IS given,
          // assertCategoryVisible's RLS-scoped SELECT already returns 0 rows
          // for an unknown tenant and throws 404 before this INSERT runs).
          // See pg-error.ts for why 400 (not 404) was chosen.
          if (isTenantForeignKeyViolation(err)) {
            throw new HttpError(400, 'UNKNOWN_TENANT', `Tenant ${tenantId} tidak dikenal.`);
          }
          throw err;
        }
        const variations: VariationRow[] = [];
        for (const v of body.variations) {
          variations.push(await insertVariation(client, tenantId, body.id, v));
        }
        return { item, variations };
      });
      reply.code(201);
      // Item baru dibuat tanpa modifierLists -- createItem tidak menerima
      // attachment bersarang di body (attach terjadi lewat operasi terpisah,
      // attachModifierList), jadi array kosong pasti benar tanpa perlu SELECT
      // tambahan (tidak ada bridge row yang bisa sudah menunjuk ke item yang
      // baru saja di-INSERT dalam transaksi yang sama). Pola identik dengan
      // createModifierList's `return toModifierList(row, [])`.
      return toItem(item, variations, []);
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
        // FIX 6 (whole-branch review): `, id` tie-breaker -- sort_order
        // DEFAULTs to 0, so a fresh catalog with no explicit ordering set
        // returns rows in arbitrary, run-to-run-unstable order without it.
        const { rows } = await client.query<ItemRow>(`SELECT * FROM item ${where} ORDER BY sort_order, id`, params);
        // FIX 5 N+1 guard: modifierLists for every row in this result set are
        // fetched with a FIXED number of extra queries (see
        // fetchModifierListsForItems), not one per item -- computed once
        // outside the loop below, which still does one fetchVariations call
        // per item (pre-existing N+1, out of scope to fix here per brief).
        const modifierListsByItemId = await fetchModifierListsForItems(client, rows.map((row) => row.id));
        const result = [];
        for (const row of rows) {
          result.push(toItem(row, await fetchVariations(client, row.id), modifierListsByItemId.get(row.id) ?? []));
        }
        return result;
      });
      return { items };
    },

    async getItem(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const { itemId } = req.params as { itemId: string };
      const { item, variations, modifierLists } = await withTenantTransaction(pool, tenantId, async (client) => {
        const item = await fetchItemOrThrow(client, itemId);
        const variations = await fetchVariations(client, itemId);
        const modifierLists = await fetchModifierListsForItem(client, itemId);
        return { item, variations, modifierLists };
      });
      return toItem(item, variations, modifierLists);
    },

    async updateItem(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const { itemId } = req.params as { itemId: string };
      const body = req.body as { name?: string; categoryId?: string | null; description?: string | null; sortOrder?: number };
      const { item, variations, modifierLists } = await withTenantTransaction(pool, tenantId, async (client) => {
        await fetchItemOrThrow(client, itemId);
        // Sama seperti createItem: hanya divalidasi kalau body benar-benar
        // mengirim categoryId non-null (clearing ke null lewat `categoryId:
        // null` tidak perlu divalidasi -- tidak ada apa pun untuk dicek
        // keberadaannya). Guard yang identik di kedua path (create & update)
        // supaya keduanya tidak bisa diam-diam berbeda perilaku.
        if ('categoryId' in body && body.categoryId !== null && body.categoryId !== undefined) {
          await assertCategoryVisible(client, body.categoryId);
        }
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
        return {
          item: rows[0],
          variations: await fetchVariations(client, itemId),
          modifierLists: await fetchModifierListsForItem(client, itemId),
        };
      });
      return toItem(item, variations, modifierLists);
    },

    async archiveItem(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const { itemId } = req.params as { itemId: string };
      const { item, variations, modifierLists } = await withTenantTransaction(pool, tenantId, async (client) => {
        await fetchItemOrThrow(client, itemId);
        const { rows } = await client.query<ItemRow>(
          'UPDATE item SET archived_at = now() WHERE id = $1 RETURNING *',
          [itemId]
        );
        return {
          item: rows[0],
          variations: await fetchVariations(client, itemId),
          modifierLists: await fetchModifierListsForItem(client, itemId),
        };
      });
      return toItem(item, variations, modifierLists);
    },

    async restoreItem(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const { itemId } = req.params as { itemId: string };
      const { item, variations, modifierLists } = await withTenantTransaction(pool, tenantId, async (client) => {
        await fetchItemOrThrow(client, itemId);
        const { rows } = await client.query<ItemRow>(
          'UPDATE item SET archived_at = NULL WHERE id = $1 RETURNING *',
          [itemId]
        );
        return {
          item: rows[0],
          variations: await fetchVariations(client, itemId),
          modifierLists: await fetchModifierListsForItem(client, itemId),
        };
      });
      return toItem(item, variations, modifierLists);
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
      // Validasi yang sama dengan jalur create -- perilaku yang berbeda antara
      // create dan update untuk input yang sama adalah cacat (pelajaran Task 2).
      assertConversionFactorValid(body.conversionFactor);
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
