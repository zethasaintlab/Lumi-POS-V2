# Modul Katalog — Endpoint REST Inti Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the 28 REST operations covering FR-A1 (three-tier structure), FR-A2 (single-variation simplification), FR-A4 (category depth), FR-A6 (archive not delete), FR-A9 (unit columns) — the catalog module's core structure, on top of the `apps/server` scaffold (Fastify + `fastify-openapi-glue` + `withTenantTransaction`).

**Architecture:** Each resource group (Category, Item+ItemVariation, ModifierList+Modifier, Item↔ModifierList) gets its own handler file inside `apps/server/src/modules/catalog/`, all wired through `index.ts`'s single `createCatalogHandlers(pool)` export. Business-rule rejections throw a shared `HttpError` (statusCode + code + message), caught by a global Fastify error handler and serialized to a consistent `{"error": {"code", "message"}}` envelope. `X-Tenant-Id` is read per-handler via a shared `getTenantId(req)` helper (not a global hook — verified during planning that a global `preHandler` would incorrectly demand the header on `/health` too).

**Tech Stack:** Same as `apps/server` scaffold — Fastify 5, `fastify-openapi-glue`, `pg`, Node's native TypeScript execution, Node's built-in test runner.

## Global Constraints

- Module boundary: this plan touches only tables owned by `catalog` (`category`, `item`, `item_variation`, `modifier_list`, `modifier`, `item_modifier_list`) — never `price_history` (owned by `catalog` too, but FR-A7 is explicitly deferred) and never any other module's tables.
- Every write goes through `withTenantTransaction` — no direct `pool.query`/`pool.connect` anywhere in `modules/catalog/`.
- IDs are client-supplied in every `create*` request body — the server never generates an entity ID. ID format validation is **lenient**: non-empty string, 1–64 characters — no ULID/UUIDv7 regex enforced (verified: the DB schema has no format CHECK on any `id` column, and `tests/isolation/helpers/seed.js` already uses plain `crypto.randomUUID()` for tenant IDs — strict enforcement would break reuse of that seeding helper).
- `item.image_url` never appears in any request or response schema in this plan (column stays in the DB, untouched by application code).
- `item_variation.price` is settable only at creation (`createItem`, `createItemVariation`) — never via `updateItemVariation`. No bare `UPDATE` of a variation's price anywhere in this plan (FR-A7, deferred, will own the real price-change endpoint via `price_history`).
- `DELETE` in this plan's code means archive (`SET archived_at = now()`) for every resource except the `item_modifier_list` bridge table, where `detachModifierList` is a real `DELETE FROM item_modifier_list` (confirmed: no `archived_at` column exists on that table, and detaching a relation is not "deleting catalog" per invariant #4).
- Response conventions: `create*` → `201` + full resource; `update*`/`archive*`/`restore*`/`attach*` → `200` + full resource (`attachModifierList` returns the bridge row `{itemId, modifierListId, sortOrder}`); `list*` → `200` + `{"items": [...]}`; `detachModifierList` → `204` no body.

---

### Task 1: Shared infrastructure — `HttpError`, `getTenantId`, catalog module wiring

**Files:**
- Create: `apps/server/src/http-error.ts`
- Create: `apps/server/src/tenant-context.ts`
- Create: `apps/server/src/modules/catalog/index.ts`
- Modify: `apps/server/src/app.ts` (register global error handler, wire `createCatalogHandlers` into `serviceHandlers`)
- Modify: `packages/contracts/openapi.yaml` (add shared `components.schemas.Error`)
- Test: `tests/catalog/infra.test.js`

**Interfaces:**
- Produces: `HttpError` class (`statusCode: number`, `code: string`, `message: string`) from `http-error.ts`. `getTenantId(req: FastifyRequest): string` from `tenant-context.ts`, throwing `HttpError(400, 'MISSING_TENANT_ID', ...)` if the `X-Tenant-Id` header is missing or not a 1–64 character non-empty string. `createCatalogHandlers(pool: Pool): Record<string, Function>` from `modules/catalog/index.ts` — returns `{}` in this task (populated by Tasks 2–5).

- [ ] **Step 1: Create `apps/server/src/http-error.ts`**

  ```ts
  export class HttpError extends Error {
    constructor(
      public statusCode: number,
      public code: string,
      message: string
    ) {
      super(message);
      this.name = 'HttpError';
    }
  }
  ```

- [ ] **Step 2: Create `apps/server/src/tenant-context.ts`**

  ```ts
  import type { FastifyRequest } from 'fastify';
  import { HttpError } from './http-error.ts';

  const MAX_TENANT_ID_LENGTH = 64;

  /**
   * Placeholder for real auth (modul identity, F3). Reads X-Tenant-Id directly
   * from the request header -- NOT a security mechanism, RLS is. Every future
   * module reads tenantId this same way until identity replaces it with real
   * token/session extraction.
   */
  export function getTenantId(req: FastifyRequest): string {
    const header = req.headers['x-tenant-id'];
    const value = Array.isArray(header) ? header[0] : header;
    if (!value || value.length === 0 || value.length > MAX_TENANT_ID_LENGTH) {
      throw new HttpError(400, 'MISSING_TENANT_ID', 'Header X-Tenant-Id wajib diisi (1-64 karakter).');
    }
    return value;
  }
  ```

- [ ] **Step 3: Create `apps/server/src/modules/catalog/index.ts`**

  ```ts
  import type { Pool } from '../../db.ts';

  export function createCatalogHandlers(pool: Pool): Record<string, unknown> {
    return {
      // Tasks 2-5 spread their handler objects in here.
    };
  }
  ```

- [ ] **Step 4: Add the shared `Error` schema to `packages/contracts/openapi.yaml`**

  Add a `components` section (new top-level key, after `paths`):
  ```yaml
  components:
    schemas:
      Error:
        type: object
        required: [error]
        properties:
          error:
            type: object
            required: [code, message]
            properties:
              code:
                type: string
              message:
                type: string
  ```

- [ ] **Step 5: Modify `apps/server/src/app.ts`**

  Add the import, register a global error handler, and wire the (currently empty) catalog handlers into `serviceHandlers`:
  ```ts
  import Fastify, { type FastifyInstance } from 'fastify';
  import openapiGlue from 'fastify-openapi-glue';
  import { readFileSync } from 'node:fs';
  import { fileURLToPath } from 'node:url';
  import yaml from 'js-yaml';
  import { createPool, type Pool } from './db.ts';
  import { HttpError } from './http-error.ts';
  import { createCatalogHandlers } from './modules/catalog/index.ts';

  const OPENAPI_SPEC_PATH = fileURLToPath(import.meta.resolve('contracts/openapi.yaml'));

  declare module 'fastify' {
    interface FastifyInstance {
      pool: Pool;
    }
  }

  interface OpenApiOperation {
    operationId?: string;
  }

  interface OpenApiDocument {
    paths: Record<string, Record<string, OpenApiOperation>>;
  }

  function assertAllOperationsImplemented(specPath: string, serviceHandlers: Record<string, unknown>): void {
    const doc = yaml.load(readFileSync(specPath, 'utf8')) as OpenApiDocument;
    const missing: string[] = [];
    for (const pathItem of Object.values(doc.paths)) {
      for (const operation of Object.values(pathItem)) {
        const operationId = operation.operationId;
        if (operationId && typeof serviceHandlers[operationId] !== 'function') {
          missing.push(operationId);
        }
      }
    }
    if (missing.length > 0) {
      throw new Error(
        `serviceHandlers missing implementation for operationId(s): ${missing.join(', ')} ` +
        `(declared in ${specPath})`
      );
    }
  }

  export async function buildApp(): Promise<FastifyInstance> {
    const pool = createPool();

    const serviceHandlers = {
      async getHealth() {
        return { status: 'ok' };
      },
      ...createCatalogHandlers(pool),
    };

    assertAllOperationsImplemented(OPENAPI_SPEC_PATH, serviceHandlers);

    const app = Fastify();

    app.setErrorHandler((err, req, reply) => {
      if (err instanceof HttpError) {
        reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
        return;
      }
      req.log.error(err);
      reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan internal.' } });
    });

    await app.register(openapiGlue, {
      specification: OPENAPI_SPEC_PATH,
      serviceHandlers,
    });

    app.decorate('pool', pool);
    app.addHook('onClose', async () => {
      await pool.end();
    });

    return app;
  }
  ```

  Note: `createPool()` moved above `serviceHandlers` (was below `app.register` before) because `createCatalogHandlers(pool)` needs the pool constructed first — verified this doesn't change `db.ts` at all, only the order of statements already in `app.ts`.

- [ ] **Step 6: Write `tests/catalog/infra.test.js`**

  ```js
  'use strict';

  const { test } = require('node:test');
  const assert = require('node:assert/strict');

  test('getTenantId: header hilang melempar HttpError 400', async () => {
    const { getTenantId } = await import('../../apps/server/src/tenant-context.ts');
    const { HttpError } = await import('../../apps/server/src/http-error.ts');
    assert.throws(
      () => getTenantId({ headers: {} }),
      (err) => err instanceof HttpError && err.statusCode === 400 && err.code === 'MISSING_TENANT_ID'
    );
  });

  test('getTenantId: header valid dikembalikan apa adanya', async () => {
    const { getTenantId } = await import('../../apps/server/src/tenant-context.ts');
    const result = getTenantId({ headers: { 'x-tenant-id': 'tenant-abc-123' } });
    assert.equal(result, 'tenant-abc-123');
  });

  test('GET /health masih jalan tanpa X-Tenant-Id (bukan hook global)', async () => {
    const { buildApp } = await import('../../apps/server/src/app.ts');
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(res.statusCode, 200);
    await app.close();
  });
  ```

- [ ] **Step 7: Run tests and existing suite**

  ```bash
  node --env-file=.env --test "tests/catalog/*.test.js"
  npm run test:server
  cd apps/server && npx tsc --noEmit
  ```
  Expected: all pass, 0 errors. The `test:server` run proves this task didn't break the existing health/tenant-transaction tests.

- [ ] **Step 8: Commit**

  ```bash
  git add apps/server/src/http-error.ts apps/server/src/tenant-context.ts apps/server/src/modules/catalog/index.ts apps/server/src/app.ts packages/contracts/openapi.yaml tests/catalog/infra.test.js
  git commit -m "Tambah infrastruktur bersama modul: HttpError, getTenantId, wiring catalog kosong

HttpError dan getTenantId() sengaja diletakkan di level apps/server
(bukan di dalam modules/catalog/) karena keduanya lintas-modul --
setiap modul berikutnya akan memakai pola error envelope dan ekstraksi
X-Tenant-Id yang sama. getTenantId() dipanggil per-handler, bukan lewat
Fastify preHandler hook global -- hook global akan salah mewajibkan
header ini di GET /health juga.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
  ```

---

### Task 2: Category endpoints

**Files:**
- Create: `apps/server/src/modules/catalog/handlers/categories.ts`
- Modify: `apps/server/src/modules/catalog/index.ts` (spread in category handlers)
- Modify: `packages/contracts/openapi.yaml` (add `Category` schema + 6 paths)
- Test: `tests/catalog/categories.test.js`

**Interfaces:**
- Consumes: `withTenantTransaction`, `Pool`/`PoolClient` from `../../db.ts`; `HttpError` from `../../http-error.ts`; `getTenantId` from `../../tenant-context.ts` (all Task 1).
- Produces: `createCategoryHandlers(pool: Pool): Record<string, Function>` exported from `handlers/categories.ts`, spread into `index.ts`'s `createCatalogHandlers`.

- [ ] **Step 1: Add `Category` schema and 6 paths to `packages/contracts/openapi.yaml`**

  Add to `components.schemas`:
  ```yaml
      Category:
        type: object
        required: [id, name, sortOrder]
        properties:
          id: { type: string }
          name: { type: string }
          parentId: { type: string, nullable: true }
          sortOrder: { type: integer }
          colorHint: { type: string, nullable: true }
          archivedAt: { type: string, format: date-time, nullable: true }
  ```

  Add to `paths`:
  ```yaml
    /categories:
      post:
        operationId: createCategory
        requestBody:
          required: true
          content:
            application/json:
              schema:
                type: object
                required: [id, name]
                properties:
                  id: { type: string }
                  name: { type: string }
                  parentId: { type: string, nullable: true }
                  sortOrder: { type: integer }
                  colorHint: { type: string, nullable: true }
        responses:
          '201':
            description: Created
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/Category'
          '409':
            description: Kategori tingkat ketiga ditolak
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/Error'
      get:
        operationId: listCategories
        parameters:
          - name: includeArchived
            in: query
            schema: { type: boolean, default: false }
        responses:
          '200':
            description: OK
            content:
              application/json:
                schema:
                  type: object
                  required: [items]
                  properties:
                    items:
                      type: array
                      items:
                        $ref: '#/components/schemas/Category'
    /categories/{categoryId}:
      get:
        operationId: getCategory
        parameters:
          - name: categoryId
            in: path
            required: true
            schema: { type: string }
        responses:
          '200':
            description: OK
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/Category'
          '404':
            description: Not found
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/Error'
      patch:
        operationId: updateCategory
        parameters:
          - name: categoryId
            in: path
            required: true
            schema: { type: string }
        requestBody:
          required: true
          content:
            application/json:
              schema:
                type: object
                properties:
                  name: { type: string }
                  parentId: { type: string, nullable: true }
                  sortOrder: { type: integer }
                  colorHint: { type: string, nullable: true }
        responses:
          '200':
            description: OK
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/Category'
          '404':
            description: Not found
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/Error'
          '409':
            description: Kategori tingkat ketiga ditolak
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/Error'
    /categories/{categoryId}/archive:
      post:
        operationId: archiveCategory
        parameters:
          - name: categoryId
            in: path
            required: true
            schema: { type: string }
        responses:
          '200':
            description: OK
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/Category'
          '404':
            description: Not found
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/Error'
    /categories/{categoryId}/restore:
      post:
        operationId: restoreCategory
        parameters:
          - name: categoryId
            in: path
            required: true
            schema: { type: string }
        responses:
          '200':
            description: OK
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/Category'
          '404':
            description: Not found
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/Error'
  ```

  Note: `archiveCategory`/`restoreCategory` use `POST .../archive` and `.../restore` (not a bare `DELETE /categories/{id}`) — this matches the design doc's intent ("archive is the only removal mechanism") while giving `restore` a symmetric, equally explicit counterpart route, and avoids `fastify-openapi-glue` needing a request body on a `DELETE`.

- [ ] **Step 2: Create `apps/server/src/modules/catalog/handlers/categories.ts`**

  ```ts
  import type { Pool, PoolClient } from '../../../db.ts';
  import { withTenantTransaction } from '../../../db.ts';
  import { HttpError } from '../../../http-error.ts';
  import { getTenantId } from '../../../tenant-context.ts';
  import type { FastifyRequest } from 'fastify';

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
      async createCategory(req: FastifyRequest) {
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
  ```

  Note on `updateCategory`'s SQL: `CASE WHEN $3 THEN $4 ELSE parent_id END` with `'parentId' in body` as `$3` lets `parentId: null` (explicitly clearing a parent) be distinguished from "field not sent at all" (leave unchanged) — a plain `COALESCE($4, parent_id)` would incorrectly treat an explicit `null` the same as "not provided."

- [ ] **Step 3: Wire into `apps/server/src/modules/catalog/index.ts`**

  ```ts
  import type { Pool } from '../../db.ts';
  import { createCategoryHandlers } from './handlers/categories.ts';

  export function createCatalogHandlers(pool: Pool): Record<string, unknown> {
    return {
      ...createCategoryHandlers(pool),
    };
  }
  ```

- [ ] **Step 4: Write `tests/catalog/categories.test.js`**

  ```js
  'use strict';

  const { test, before, after, beforeEach } = require('node:test');
  const assert = require('node:assert/strict');
  const crypto = require('node:crypto');
  const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
  const { resetAll } = require('../isolation/helpers/reset');
  const { seedTenantBase } = require('../isolation/helpers/seed');

  let owner, appSetup, app, tenant;

  before(async () => {
    owner = await connectAsOwner();
    appSetup = await connectAsApp();
  });

  after(async () => {
    await resetAll(owner);
    await owner.end();
    await appSetup.end();
    if (app) await app.close();
  });

  beforeEach(async () => {
    await resetAll(owner);
    const base = await seedTenantBase(appSetup, { suffix: 'CatTest' });
    tenant = base.tenant;
    const { buildApp } = await import('../../apps/server/src/app.ts');
    if (app) await app.close();
    app = await buildApp();
  });

  function post(url, payload) {
    return app.inject({ method: 'POST', url, payload, headers: { 'x-tenant-id': tenant.id } });
  }
  function get(url) {
    return app.inject({ method: 'GET', url, headers: { 'x-tenant-id': tenant.id } });
  }
  function patch(url, payload) {
    return app.inject({ method: 'PATCH', url, payload, headers: { 'x-tenant-id': tenant.id } });
  }

  test('createCategory: kategori top-level berhasil dibuat', async () => {
    const id = crypto.randomUUID();
    const res = await post('/categories', { id, name: 'Minuman' });
    assert.equal(res.statusCode, 201);
    const body = JSON.parse(res.body);
    assert.equal(body.name, 'Minuman');
    assert.equal(body.parentId, null);
  });

  test('createCategory: kategori tingkat kedua (child dari top-level) berhasil', async () => {
    const topId = crypto.randomUUID();
    await post('/categories', { id: topId, name: 'Minuman' });
    const childId = crypto.randomUUID();
    const res = await post('/categories', { id: childId, name: 'Kopi', parentId: topId });
    assert.equal(res.statusCode, 201);
  });

  test('createCategory: kategori tingkat ketiga ditolak dengan CATEGORY_DEPTH_EXCEEDED', async () => {
    const topId = crypto.randomUUID();
    await post('/categories', { id: topId, name: 'Minuman' });
    const childId = crypto.randomUUID();
    await post('/categories', { id: childId, name: 'Kopi', parentId: topId });
    const grandchildId = crypto.randomUUID();
    const res = await post('/categories', { id: grandchildId, name: 'Espresso', parentId: childId });
    assert.equal(res.statusCode, 409);
    const body = JSON.parse(res.body);
    assert.equal(body.error.code, 'CATEGORY_DEPTH_EXCEEDED');
  });

  test('archiveCategory lalu restoreCategory: archivedAt terisi lalu null lagi', async () => {
    const id = crypto.randomUUID();
    await post('/categories', { id, name: 'Snack' });
    const archived = await app.inject({ method: 'POST', url: `/categories/${id}/archive`, headers: { 'x-tenant-id': tenant.id } });
    assert.equal(archived.statusCode, 200);
    assert.notEqual(JSON.parse(archived.body).archivedAt, null);

    const restored = await app.inject({ method: 'POST', url: `/categories/${id}/restore`, headers: { 'x-tenant-id': tenant.id } });
    assert.equal(restored.statusCode, 200);
    assert.equal(JSON.parse(restored.body).archivedAt, null);
  });

  test('listCategories: default menyembunyikan yang diarsipkan, includeArchived=true menampilkannya', async () => {
    const id = crypto.randomUUID();
    await post('/categories', { id, name: 'Dessert' });
    await app.inject({ method: 'POST', url: `/categories/${id}/archive`, headers: { 'x-tenant-id': tenant.id } });

    const hidden = await get('/categories');
    assert.equal(JSON.parse(hidden.body).items.some((c) => c.id === id), false);

    const shown = await get('/categories?includeArchived=true');
    assert.equal(JSON.parse(shown.body).items.some((c) => c.id === id), true);
  });

  test('updateCategory: mengubah parentId ke kategori yang sudah punya induk ditolak', async () => {
    const topA = crypto.randomUUID();
    await post('/categories', { id: topA, name: 'A' });
    const childA = crypto.randomUUID();
    await post('/categories', { id: childA, name: 'A-child', parentId: topA });
    const topB = crypto.randomUUID();
    await post('/categories', { id: topB, name: 'B' });

    const res = await patch(`/categories/${topB}`, { parentId: childA });
    assert.equal(res.statusCode, 409);
  });

  test('getCategory: 404 untuk id yang tidak ada', async () => {
    const res = await get(`/categories/${crypto.randomUUID()}`);
    assert.equal(res.statusCode, 404);
  });
  ```

- [ ] **Step 5: Run tests**

  ```bash
  node --env-file=.env --test "tests/catalog/*.test.js"
  cd apps/server && npx tsc --noEmit
  ```
  Expected: all pass, 0 type errors.

- [ ] **Step 6: Commit**

  ```bash
  git add apps/server/src/modules/catalog packages/contracts/openapi.yaml tests/catalog/categories.test.js
  git commit -m "Tambah endpoint Category: create/list/get/update/archive/restore

FR-A4: kategori tingkat ketiga ditolak (parent yang sudah punya parent
tidak boleh jadi parent lagi) -- diverifikasi lewat test yang benar-benar
membangun rantai 3 tingkat dan memastikan tingkat ketiga ditolak.
FR-A6: archive/restore lewat POST .../archive dan .../restore, tidak
ada DELETE literal sama sekali.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
  ```

---

### Task 3: Item + ItemVariation endpoints

**Files:**
- Create: `apps/server/src/modules/catalog/handlers/items.ts`
- Modify: `apps/server/src/modules/catalog/index.ts` (spread in item handlers)
- Modify: `packages/contracts/openapi.yaml` (add `Item`/`ItemVariation` schemas + 10 paths)
- Test: `tests/catalog/items.test.js`

**Interfaces:**
- Consumes: same shared infra as Task 2 (`withTenantTransaction`, `HttpError`, `getTenantId`).
- Produces: `createItemHandlers(pool: Pool): Record<string, Function>`, spread into `index.ts`.

- [ ] **Step 1: Add `Item`/`ItemVariation` schemas and 10 paths to `packages/contracts/openapi.yaml`**

  Add to `components.schemas`:
  ```yaml
      ItemVariation:
        type: object
        required: [id, itemId, name, price, sortOrder]
        properties:
          id: { type: string }
          itemId: { type: string }
          name: { type: string }
          sku: { type: string, nullable: true }
          barcode: { type: string, nullable: true }
          price: { type: integer }
          cost: { type: integer }
          stockingUnit: { type: string }
          sellingUnit: { type: string }
          conversionFactor: { type: number }
          trackStock: { type: boolean }
          sortOrder: { type: integer }
          archivedAt: { type: string, format: date-time, nullable: true }
      Item:
        type: object
        required: [id, name, variations]
        properties:
          id: { type: string }
          name: { type: string }
          categoryId: { type: string, nullable: true }
          description: { type: string, nullable: true }
          sortOrder: { type: integer }
          archivedAt: { type: string, format: date-time, nullable: true }
          variations:
            type: array
            items:
              $ref: '#/components/schemas/ItemVariation'
      ItemVariationInput:
        type: object
        required: [id, price]
        properties:
          id: { type: string }
          name: { type: string }
          sku: { type: string, nullable: true }
          barcode: { type: string, nullable: true }
          price: { type: integer }
          cost: { type: integer }
          stockingUnit: { type: string }
          sellingUnit: { type: string }
          conversionFactor: { type: number }
          trackStock: { type: boolean }
  ```

  Add to `paths`:
  ```yaml
    /items:
      post:
        operationId: createItem
        requestBody:
          required: true
          content:
            application/json:
              schema:
                type: object
                required: [id, name, variations]
                properties:
                  id: { type: string }
                  name: { type: string }
                  categoryId: { type: string, nullable: true }
                  description: { type: string, nullable: true }
                  sortOrder: { type: integer }
                  variations:
                    type: array
                    minItems: 1
                    items:
                      $ref: '#/components/schemas/ItemVariationInput'
        responses:
          '201':
            description: Created
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/Item'
          '400':
            description: Item tanpa variation ditolak
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/Error'
          '409':
            description: Barcode duplikat
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/Error'
      get:
        operationId: listItems
        parameters:
          - name: includeArchived
            in: query
            schema: { type: boolean, default: false }
          - name: categoryId
            in: query
            schema: { type: string }
        responses:
          '200':
            description: OK
            content:
              application/json:
                schema:
                  type: object
                  required: [items]
                  properties:
                    items:
                      type: array
                      items:
                        $ref: '#/components/schemas/Item'
    /items/{itemId}:
      get:
        operationId: getItem
        parameters:
          - name: itemId
            in: path
            required: true
            schema: { type: string }
        responses:
          '200':
            description: OK
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/Item'
          '404':
            description: Not found
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/Error'
      patch:
        operationId: updateItem
        parameters:
          - name: itemId
            in: path
            required: true
            schema: { type: string }
        requestBody:
          required: true
          content:
            application/json:
              schema:
                type: object
                properties:
                  name: { type: string }
                  categoryId: { type: string, nullable: true }
                  description: { type: string, nullable: true }
                  sortOrder: { type: integer }
        responses:
          '200':
            description: OK
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/Item'
          '404':
            description: Not found
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/Error'
    /items/{itemId}/archive:
      post:
        operationId: archiveItem
        parameters:
          - name: itemId
            in: path
            required: true
            schema: { type: string }
        responses:
          '200':
            description: OK
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/Item'
          '404':
            description: Not found
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/Error'
    /items/{itemId}/restore:
      post:
        operationId: restoreItem
        parameters:
          - name: itemId
            in: path
            required: true
            schema: { type: string }
        responses:
          '200':
            description: OK
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/Item'
          '404':
            description: Not found
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/Error'
    /items/{itemId}/variations:
      post:
        operationId: createItemVariation
        parameters:
          - name: itemId
            in: path
            required: true
            schema: { type: string }
        requestBody:
          required: true
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ItemVariationInput'
        responses:
          '201':
            description: Created
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/ItemVariation'
          '404':
            description: Item tidak ditemukan
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/Error'
          '409':
            description: Batas 250 variation tercapai, atau barcode duplikat
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/Error'
    /items/{itemId}/variations/{variationId}:
      patch:
        operationId: updateItemVariation
        parameters:
          - name: itemId
            in: path
            required: true
            schema: { type: string }
          - name: variationId
            in: path
            required: true
            schema: { type: string }
        requestBody:
          required: true
          content:
            application/json:
              schema:
                type: object
                properties:
                  name: { type: string }
                  sku: { type: string, nullable: true }
                  barcode: { type: string, nullable: true }
                  trackStock: { type: boolean }
                  stockingUnit: { type: string }
                  sellingUnit: { type: string }
                  conversionFactor: { type: number }
        responses:
          '200':
            description: OK
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/ItemVariation'
          '404':
            description: Not found
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/Error'
          '409':
            description: Barcode duplikat
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/Error'
    /items/{itemId}/variations/{variationId}/archive:
      post:
        operationId: archiveItemVariation
        parameters:
          - name: itemId
            in: path
            required: true
            schema: { type: string }
          - name: variationId
            in: path
            required: true
            schema: { type: string }
        responses:
          '200':
            description: OK
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/ItemVariation'
          '404':
            description: Not found
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/Error'
    /items/{itemId}/variations/{variationId}/restore:
      post:
        operationId: restoreItemVariation
        parameters:
          - name: itemId
            in: path
            required: true
            schema: { type: string }
          - name: variationId
            in: path
            required: true
            schema: { type: string }
        responses:
          '200':
            description: OK
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/ItemVariation'
          '404':
            description: Not found
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/Error'
  ```

- [ ] **Step 2: Create `apps/server/src/modules/catalog/handlers/items.ts`**

  ```ts
  import type { Pool, PoolClient } from '../../../db.ts';
  import { withTenantTransaction } from '../../../db.ts';
  import { HttpError } from '../../../http-error.ts';
  import { getTenantId } from '../../../tenant-context.ts';
  import type { FastifyRequest } from 'fastify';

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

  function translateConstraintError(err: unknown): never {
    const pgErr = err as { code?: string };
    if (pgErr.code === '23514') {
      throw new HttpError(409, 'VARIATION_LIMIT_EXCEEDED', 'Batas 250 variation per item sudah tercapai.');
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
      async createItem(req: FastifyRequest) {
        const tenantId = getTenantId(req);
        const body = req.body as {
          id: string;
          name: string;
          categoryId?: string | null;
          description?: string | null;
          sortOrder?: number;
          variations: VariationInput[];
        };
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

      async createItemVariation(req: FastifyRequest) {
        const tenantId = getTenantId(req);
        const { itemId } = req.params as { itemId: string };
        const body = req.body as VariationInput;
        const row = await withTenantTransaction(pool, tenantId, async (client) => {
          await fetchItemOrThrow(client, itemId);
          return insertVariation(client, tenantId, itemId, body);
        });
        return toVariation(row);
      },

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
  ```

  Note on the `sort_order` auto-assign subquery (`SELECT COALESCE(MAX(sort_order) + 1, 0) FROM item_variation WHERE item_id = $3`, run inside `INSERT ... VALUES (..., (subquery))`): this runs inside the same statement as the `INSERT`, inside the same transaction — verified directly against the real schema (two sequential variation creates for one item produced `sort_order` 0 then 1). Two *concurrent* `createItemVariation` calls for the *same* item could theoretically both read the same `MAX` before either commits and end up with a duplicate `sort_order` — there is no `UNIQUE` constraint on `(item_id, sort_order)` in the schema, so this is a low-consequence cosmetic race (display ordering only, no invariant violated), not something this plan adds locking for. Note it as a known, accepted characteristic — a `SELECT ... FOR UPDATE` on the parent `item` row would close it if it ever matters.

- [ ] **Step 3: Wire into `apps/server/src/modules/catalog/index.ts`**

  ```ts
  import type { Pool } from '../../db.ts';
  import { createCategoryHandlers } from './handlers/categories.ts';
  import { createItemHandlers } from './handlers/items.ts';

  export function createCatalogHandlers(pool: Pool): Record<string, unknown> {
    return {
      ...createCategoryHandlers(pool),
      ...createItemHandlers(pool),
    };
  }
  ```

- [ ] **Step 4: Write `tests/catalog/items.test.js`**

  ```js
  'use strict';

  const { test, before, after, beforeEach } = require('node:test');
  const assert = require('node:assert/strict');
  const crypto = require('node:crypto');
  const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
  const { resetAll } = require('../isolation/helpers/reset');
  const { seedTenantBase } = require('../isolation/helpers/seed');

  let owner, appSetup, app, tenant;

  before(async () => {
    owner = await connectAsOwner();
    appSetup = await connectAsApp();
  });

  after(async () => {
    await resetAll(owner);
    await owner.end();
    await appSetup.end();
    if (app) await app.close();
  });

  beforeEach(async () => {
    await resetAll(owner);
    const base = await seedTenantBase(appSetup, { suffix: 'ItemTest' });
    tenant = base.tenant;
    const { buildApp } = await import('../../apps/server/src/app.ts');
    if (app) await app.close();
    app = await buildApp();
  });

  function req(method, url, payload) {
    return app.inject({ method, url, payload, headers: { 'x-tenant-id': tenant.id } });
  }

  test('createItem: item dengan 1 variation berhasil, image_url tidak muncul di response', async () => {
    const itemId = crypto.randomUUID();
    const varId = crypto.randomUUID();
    const res = await req('POST', '/items', {
      id: itemId,
      name: 'Kopi Susu',
      variations: [{ id: varId, price: 25000 }],
    });
    assert.equal(res.statusCode, 201);
    const body = JSON.parse(res.body);
    assert.equal(body.variations.length, 1);
    assert.equal(body.variations[0].name, 'Regular');
    assert.equal(body.variations[0].price, 25000);
    assert.equal(body.variations[0].sortOrder, 0);
    assert.equal('imageUrl' in body, false);
    assert.equal('image_url' in body, false);
  });

  test('createItem: tanpa variation ditolak dengan ITEM_NO_VARIATION', async () => {
    const res = await req('POST', '/items', { id: crypto.randomUUID(), name: 'Kosong', variations: [] });
    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(res.body).error.code, 'ITEM_NO_VARIATION');
  });

  test('createItemVariation: variation kedua mendapat sortOrder 1', async () => {
    const itemId = crypto.randomUUID();
    await req('POST', '/items', { id: itemId, name: 'Teh', variations: [{ id: crypto.randomUUID(), price: 10000 }] });
    const res = await req('POST', `/items/${itemId}/variations`, { id: crypto.randomUUID(), name: 'Large', price: 15000 });
    assert.equal(res.statusCode, 201);
    assert.equal(JSON.parse(res.body).sortOrder, 1);
  });

  test('createItemVariation: barcode duplikat ditolak dengan BARCODE_DUPLICATE', async () => {
    const itemId = crypto.randomUUID();
    await req('POST', '/items', {
      id: itemId,
      name: 'Roti',
      variations: [{ id: crypto.randomUUID(), price: 8000, barcode: 'BC-001' }],
    });
    const res = await req('POST', `/items/${itemId}/variations`, { id: crypto.randomUUID(), price: 9000, barcode: 'BC-001' });
    assert.equal(res.statusCode, 409);
    assert.equal(JSON.parse(res.body).error.code, 'BARCODE_DUPLICATE');
  });

  test('updateItemVariation: tidak menerima field price sama sekali (skema tidak mendeklarasikannya)', async () => {
    const itemId = crypto.randomUUID();
    const varId = crypto.randomUUID();
    await req('POST', '/items', { id: itemId, name: 'Kue', variations: [{ id: varId, price: 12000 }] });
    const res = await req('PATCH', `/items/${itemId}/variations/${varId}`, { name: 'Kue Renamed', price: 99999 });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.name, 'Kue Renamed');
    assert.equal(body.price, 12000, 'price tidak boleh berubah lewat PATCH ini, extra field price di body diabaikan');
  });

  test('archiveItem tidak ikut meng-archive variation-nya', async () => {
    const itemId = crypto.randomUUID();
    const varId = crypto.randomUUID();
    await req('POST', '/items', { id: itemId, name: 'Jus', variations: [{ id: varId, price: 15000 }] });
    await req('POST', `/items/${itemId}/archive`);
    const res = await req('GET', `/items/${itemId}`);
    const body = JSON.parse(res.body);
    assert.notEqual(body.archivedAt, null);
    assert.equal(body.variations[0].archivedAt, null);
  });

  test('archiveItemVariation: satu variation diarsipkan, item tetap aktif', async () => {
    const itemId = crypto.randomUUID();
    const var1 = crypto.randomUUID();
    await req('POST', '/items', { id: itemId, name: 'Es Krim', variations: [{ id: var1, price: 20000 }] });
    const var2Res = await req('POST', `/items/${itemId}/variations`, { id: crypto.randomUUID(), price: 25000 });
    const var2 = JSON.parse(var2Res.body).id;

    await req('POST', `/items/${itemId}/variations/${var2}/archive`);
    const itemRes = await req('GET', `/items/${itemId}`);
    const body = JSON.parse(itemRes.body);
    assert.equal(body.archivedAt, null);
    const archivedVar = body.variations.find((v) => v.id === var2);
    assert.notEqual(archivedVar.archivedAt, null);
  });
  ```

- [ ] **Step 5: Run tests**

  ```bash
  node --env-file=.env --test "tests/catalog/*.test.js"
  cd apps/server && npx tsc --noEmit
  ```
  Expected: all pass, 0 type errors.

- [ ] **Step 6: Commit**

  ```bash
  git add apps/server/src/modules/catalog packages/contracts/openapi.yaml tests/catalog/items.test.js
  git commit -m "Tambah endpoint Item + ItemVariation

FR-A1: createItem menolak body tanpa variation (ITEM_NO_VARIATION) --
Item dan variation pertamanya masuk satu transaksi, tidak pernah ada
state Item-tanpa-variation tersimpan sekalipun sesaat. FR-A2: nama
variation default 'Regular' kalau tidak diisi. sort_order di-auto-assign
server (MAX+1 dalam subquery yang sama dengan INSERT, sudah diverifikasi
terhadap skema asli sebelum plan ditulis). updateItemVariation sengaja
tidak menerima field price -- FR-A7 (harga+riwayat) akan membangun
endpoint ubah-harga yang benar nanti, bukan bare UPDATE di sini.
image_url tidak pernah muncul di request/response manapun.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
  ```

---

### Task 4: ModifierList + Modifier endpoints

**Files:**
- Create: `apps/server/src/modules/catalog/handlers/modifier-lists.ts`
- Modify: `apps/server/src/modules/catalog/index.ts` (spread in modifier-list handlers)
- Modify: `packages/contracts/openapi.yaml` (add `ModifierList`/`Modifier` schemas + 8 paths)
- Test: `tests/catalog/modifier-lists.test.js`

**Interfaces:**
- Consumes: same shared infra as Tasks 2-3.
- Produces: `createModifierListHandlers(pool: Pool): Record<string, Function>`, spread into `index.ts`.

- [ ] **Step 1: Add `ModifierList`/`Modifier` schemas and 8 paths to `packages/contracts/openapi.yaml`**

  Add to `components.schemas`:
  ```yaml
      ModifierList:
        type: object
        required: [id, name, selectionType]
        properties:
          id: { type: string }
          name: { type: string }
          selectionType: { type: string, enum: [single, multi] }
          minSelections: { type: integer }
          maxSelections: { type: integer, nullable: true }
          allowDuplicate: { type: boolean }
          isRequired: { type: boolean }
          archivedAt: { type: string, format: date-time, nullable: true }
      Modifier:
        type: object
        required: [id, modifierListId, name, price]
        properties:
          id: { type: string }
          modifierListId: { type: string }
          name: { type: string }
          price: { type: integer }
          isDefault: { type: boolean }
          sortOrder: { type: integer }
          archivedAt: { type: string, format: date-time, nullable: true }
  ```

  Add to `paths`:
  ```yaml
    /modifier-lists:
      post:
        operationId: createModifierList
        requestBody:
          required: true
          content:
            application/json:
              schema:
                type: object
                required: [id, name, selectionType]
                properties:
                  id: { type: string }
                  name: { type: string }
                  selectionType: { type: string, enum: [single, multi] }
                  minSelections: { type: integer }
                  maxSelections: { type: integer, nullable: true }
                  allowDuplicate: { type: boolean }
                  isRequired: { type: boolean }
        responses:
          '201':
            description: Created
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/ModifierList'
      get:
        operationId: listModifierLists
        parameters:
          - name: includeArchived
            in: query
            schema: { type: boolean, default: false }
        responses:
          '200':
            description: OK
            content:
              application/json:
                schema:
                  type: object
                  required: [items]
                  properties:
                    items:
                      type: array
                      items:
                        $ref: '#/components/schemas/ModifierList'
    /modifier-lists/{modifierListId}:
      get:
        operationId: getModifierList
        parameters:
          - name: modifierListId
            in: path
            required: true
            schema: { type: string }
        responses:
          '200':
            description: OK
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/ModifierList'
          '404':
            description: Not found
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/Error'
      patch:
        operationId: updateModifierList
        parameters:
          - name: modifierListId
            in: path
            required: true
            schema: { type: string }
        requestBody:
          required: true
          content:
            application/json:
              schema:
                type: object
                properties:
                  name: { type: string }
                  selectionType: { type: string, enum: [single, multi] }
                  minSelections: { type: integer }
                  maxSelections: { type: integer, nullable: true }
                  allowDuplicate: { type: boolean }
                  isRequired: { type: boolean }
        responses:
          '200':
            description: OK
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/ModifierList'
          '404':
            description: Not found
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/Error'
    /modifier-lists/{modifierListId}/archive:
      post:
        operationId: archiveModifierList
        parameters:
          - name: modifierListId
            in: path
            required: true
            schema: { type: string }
        responses:
          '200':
            description: OK
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/ModifierList'
          '404':
            description: Not found
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/Error'
    /modifier-lists/{modifierListId}/restore:
      post:
        operationId: restoreModifierList
        parameters:
          - name: modifierListId
            in: path
            required: true
            schema: { type: string }
        responses:
          '200':
            description: OK
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/ModifierList'
          '404':
            description: Not found
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/Error'
    /modifier-lists/{modifierListId}/modifiers:
      post:
        operationId: createModifier
        parameters:
          - name: modifierListId
            in: path
            required: true
            schema: { type: string }
        requestBody:
          required: true
          content:
            application/json:
              schema:
                type: object
                required: [id, name]
                properties:
                  id: { type: string }
                  name: { type: string }
                  price: { type: integer }
                  isDefault: { type: boolean }
        responses:
          '201':
            description: Created
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/Modifier'
          '404':
            description: ModifierList tidak ditemukan
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/Error'
    /modifier-lists/{modifierListId}/modifiers/{modifierId}:
      patch:
        operationId: updateModifier
        parameters:
          - name: modifierListId
            in: path
            required: true
            schema: { type: string }
          - name: modifierId
            in: path
            required: true
            schema: { type: string }
        requestBody:
          required: true
          content:
            application/json:
              schema:
                type: object
                properties:
                  name: { type: string }
                  price: { type: integer }
                  isDefault: { type: boolean }
                  sortOrder: { type: integer }
        responses:
          '200':
            description: OK
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/Modifier'
          '404':
            description: Not found
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/Error'
  ```

  Note: `archiveModifier`/`restoreModifier` follow the identical `POST .../archive` and `.../restore` pattern established in Tasks 2-3 — their exact YAML is given in Step 3 below (kept as a separate step only so this step's YAML block doesn't grow past a comfortable single read).

- [ ] **Step 2: Create `apps/server/src/modules/catalog/handlers/modifier-lists.ts`**

  ```ts
  import type { Pool, PoolClient } from '../../../db.ts';
  import { withTenantTransaction } from '../../../db.ts';
  import { HttpError } from '../../../http-error.ts';
  import { getTenantId } from '../../../tenant-context.ts';
  import type { FastifyRequest } from 'fastify';

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
    price: string;
    is_default: boolean;
    sort_order: number;
    archived_at: string | null;
  }

  function toModifierList(row: ModifierListRow) {
    return {
      id: row.id,
      name: row.name,
      selectionType: row.selection_type,
      minSelections: row.min_selections,
      maxSelections: row.max_selections,
      allowDuplicate: row.allow_duplicate,
      isRequired: row.is_required,
      archivedAt: row.archived_at,
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

  async function fetchModifierListOrThrow(client: PoolClient, modifierListId: string): Promise<ModifierListRow> {
    const { rows } = await client.query<ModifierListRow>('SELECT * FROM modifier_list WHERE id = $1', [modifierListId]);
    if (rows.length === 0) {
      throw new HttpError(404, 'NOT_FOUND', `ModifierList ${modifierListId} tidak ditemukan.`);
    }
    return rows[0];
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
      async createModifierList(req: FastifyRequest) {
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
        const row = await withTenantTransaction(pool, tenantId, async (client) => {
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
        });
        return toModifierList(row);
      },

      async listModifierLists(req: FastifyRequest) {
        const tenantId = getTenantId(req);
        const query = req.query as { includeArchived?: boolean };
        const rows = await withTenantTransaction(pool, tenantId, async (client) => {
          const { rows } = await client.query<ModifierListRow>(
            query.includeArchived
              ? 'SELECT * FROM modifier_list ORDER BY name'
              : 'SELECT * FROM modifier_list WHERE archived_at IS NULL ORDER BY name'
          );
          return rows;
        });
        return { items: rows.map(toModifierList) };
      },

      async getModifierList(req: FastifyRequest) {
        const tenantId = getTenantId(req);
        const { modifierListId } = req.params as { modifierListId: string };
        const row = await withTenantTransaction(pool, tenantId, (client) => fetchModifierListOrThrow(client, modifierListId));
        return toModifierList(row);
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
        const row = await withTenantTransaction(pool, tenantId, async (client) => {
          await fetchModifierListOrThrow(client, modifierListId);
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
          return rows[0];
        });
        return toModifierList(row);
      },

      async archiveModifierList(req: FastifyRequest) {
        const tenantId = getTenantId(req);
        const { modifierListId } = req.params as { modifierListId: string };
        const row = await withTenantTransaction(pool, tenantId, async (client) => {
          await fetchModifierListOrThrow(client, modifierListId);
          const { rows } = await client.query<ModifierListRow>(
            'UPDATE modifier_list SET archived_at = now() WHERE id = $1 RETURNING *',
            [modifierListId]
          );
          return rows[0];
        });
        return toModifierList(row);
      },

      async restoreModifierList(req: FastifyRequest) {
        const tenantId = getTenantId(req);
        const { modifierListId } = req.params as { modifierListId: string };
        const row = await withTenantTransaction(pool, tenantId, async (client) => {
          await fetchModifierListOrThrow(client, modifierListId);
          const { rows } = await client.query<ModifierListRow>(
            'UPDATE modifier_list SET archived_at = NULL WHERE id = $1 RETURNING *',
            [modifierListId]
          );
          return rows[0];
        });
        return toModifierList(row);
      },

      async createModifier(req: FastifyRequest) {
        const tenantId = getTenantId(req);
        const { modifierListId } = req.params as { modifierListId: string };
        const body = req.body as { id: string; name: string; price?: number; isDefault?: boolean };
        const row = await withTenantTransaction(pool, tenantId, async (client) => {
          await fetchModifierListOrThrow(client, modifierListId);
          const { rows } = await client.query<ModifierRow>(
            `INSERT INTO modifier (id, tenant_id, modifier_list_id, name, price, is_default, sort_order)
             VALUES ($1, $2, $3, $4, $5, $6,
               (SELECT COALESCE(MAX(sort_order) + 1, 0) FROM modifier WHERE modifier_list_id = $3))
             RETURNING *`,
            [body.id, tenantId, modifierListId, body.name, body.price ?? 0, body.isDefault ?? false]
          );
          return rows[0];
        });
        return toModifier(row);
      },

      async updateModifier(req: FastifyRequest) {
        const tenantId = getTenantId(req);
        const { modifierListId, modifierId } = req.params as { modifierListId: string; modifierId: string };
        const body = req.body as { name?: string; price?: number; isDefault?: boolean; sortOrder?: number };
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
  ```

  Note: `price` on `modifier` **is** directly updatable via `updateModifier` (unlike `item_variation`) — `modifier.price` has no `price_history` requirement anywhere in the spec (FR-A7 is specifically about `ItemVariation`/`PriceHistory`), so there's no equivalent restriction here.

- [ ] **Step 3: Add the two omitted archive/restore paths for Modifier to `packages/contracts/openapi.yaml`**

  ```yaml
    /modifier-lists/{modifierListId}/modifiers/{modifierId}/archive:
      post:
        operationId: archiveModifier
        parameters:
          - name: modifierListId
            in: path
            required: true
            schema: { type: string }
          - name: modifierId
            in: path
            required: true
            schema: { type: string }
        responses:
          '200':
            description: OK
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/Modifier'
          '404':
            description: Not found
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/Error'
    /modifier-lists/{modifierListId}/modifiers/{modifierId}/restore:
      post:
        operationId: restoreModifier
        parameters:
          - name: modifierListId
            in: path
            required: true
            schema: { type: string }
          - name: modifierId
            in: path
            required: true
            schema: { type: string }
        responses:
          '200':
            description: OK
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/Modifier'
          '404':
            description: Not found
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/Error'
  ```

- [ ] **Step 4: Wire into `apps/server/src/modules/catalog/index.ts`**

  ```ts
  import type { Pool } from '../../db.ts';
  import { createCategoryHandlers } from './handlers/categories.ts';
  import { createItemHandlers } from './handlers/items.ts';
  import { createModifierListHandlers } from './handlers/modifier-lists.ts';

  export function createCatalogHandlers(pool: Pool): Record<string, unknown> {
    return {
      ...createCategoryHandlers(pool),
      ...createItemHandlers(pool),
      ...createModifierListHandlers(pool),
    };
  }
  ```

- [ ] **Step 5: Write `tests/catalog/modifier-lists.test.js`**

  ```js
  'use strict';

  const { test, before, after, beforeEach } = require('node:test');
  const assert = require('node:assert/strict');
  const crypto = require('node:crypto');
  const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
  const { resetAll } = require('../isolation/helpers/reset');
  const { seedTenantBase } = require('../isolation/helpers/seed');

  let owner, appSetup, app, tenant;

  before(async () => {
    owner = await connectAsOwner();
    appSetup = await connectAsApp();
  });

  after(async () => {
    await resetAll(owner);
    await owner.end();
    await appSetup.end();
    if (app) await app.close();
  });

  beforeEach(async () => {
    await resetAll(owner);
    const base = await seedTenantBase(appSetup, { suffix: 'ModTest' });
    tenant = base.tenant;
    const { buildApp } = await import('../../apps/server/src/app.ts');
    if (app) await app.close();
    app = await buildApp();
  });

  function req(method, url, payload) {
    return app.inject({ method, url, payload, headers: { 'x-tenant-id': tenant.id } });
  }

  test('createModifierList + createModifier: modifier bertaut ke list yang benar', async () => {
    const listId = crypto.randomUUID();
    await req('POST', '/modifier-lists', { id: listId, name: 'Extra', selectionType: 'multi', maxSelections: 3 });
    const modId = crypto.randomUUID();
    const res = await req('POST', `/modifier-lists/${listId}/modifiers`, { id: modId, name: 'Extra Shot', price: 5000 });
    assert.equal(res.statusCode, 201);
    const body = JSON.parse(res.body);
    assert.equal(body.modifierListId, listId);
    assert.equal(body.sortOrder, 0);
  });

  test('updateModifier: price bisa diubah langsung (beda dari item_variation)', async () => {
    const listId = crypto.randomUUID();
    await req('POST', '/modifier-lists', { id: listId, name: 'Extra', selectionType: 'single' });
    const modId = crypto.randomUUID();
    await req('POST', `/modifier-lists/${listId}/modifiers`, { id: modId, name: 'Oat Milk', price: 8000 });
    const res = await req('PATCH', `/modifier-lists/${listId}/modifiers/${modId}`, { price: 10000 });
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).price, 10000);
  });

  test('archiveModifierList lalu restoreModifierList', async () => {
    const listId = crypto.randomUUID();
    await req('POST', '/modifier-lists', { id: listId, name: 'Temp', selectionType: 'single' });
    const archived = await req('POST', `/modifier-lists/${listId}/archive`);
    assert.notEqual(JSON.parse(archived.body).archivedAt, null);
    const restored = await req('POST', `/modifier-lists/${listId}/restore`);
    assert.equal(JSON.parse(restored.body).archivedAt, null);
  });

  test('createModifier: 404 kalau modifierListId tidak ada', async () => {
    const res = await req('POST', `/modifier-lists/${crypto.randomUUID()}/modifiers`, { id: crypto.randomUUID(), name: 'X' });
    assert.equal(res.statusCode, 404);
  });
  ```

- [ ] **Step 6: Run tests**

  ```bash
  node --env-file=.env --test "tests/catalog/*.test.js"
  cd apps/server && npx tsc --noEmit
  ```
  Expected: all pass, 0 type errors.

- [ ] **Step 7: Commit**

  ```bash
  git add apps/server/src/modules/catalog packages/contracts/openapi.yaml tests/catalog/modifier-lists.test.js
  git commit -m "Tambah endpoint ModifierList + Modifier

CRUD standar mengikuti pola archive/restore yang sama dengan Category
dan Item. modifier.price BISA diubah langsung lewat updateModifier --
beda dari item_variation.price, karena FR-A7 (price_history) cuma
menyebut ItemVariation/PriceHistory, tidak menyertakan Modifier.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
  ```

---

### Task 5: Item↔ModifierList attach/detach

**Files:**
- Create: `apps/server/src/modules/catalog/handlers/item-modifier-lists.ts`
- Modify: `apps/server/src/modules/catalog/index.ts` (spread in attach/detach handlers)
- Modify: `packages/contracts/openapi.yaml` (add 2 paths)
- Test: `tests/catalog/item-modifier-lists.test.js`

**Interfaces:**
- Consumes: same shared infra as Tasks 2-4.
- Produces: `createItemModifierListHandlers(pool: Pool): Record<string, Function>`, spread into `index.ts` — this is the plan's final task, nothing downstream depends on it.

- [ ] **Step 1: Add 2 paths to `packages/contracts/openapi.yaml`**

  ```yaml
    /items/{itemId}/modifier-lists/{modifierListId}:
      post:
        operationId: attachModifierList
        parameters:
          - name: itemId
            in: path
            required: true
            schema: { type: string }
          - name: modifierListId
            in: path
            required: true
            schema: { type: string }
        requestBody:
          required: false
          content:
            application/json:
              schema:
                type: object
                properties:
                  sortOrder: { type: integer }
        responses:
          '200':
            description: OK
            content:
              application/json:
                schema:
                  type: object
                  required: [itemId, modifierListId, sortOrder]
                  properties:
                    itemId: { type: string }
                    modifierListId: { type: string }
                    sortOrder: { type: integer }
          '404':
            description: Item atau ModifierList tidak ditemukan
            content:
              application/json:
                schema:
                  $ref: '#/components/schemas/Error'
      delete:
        operationId: detachModifierList
        parameters:
          - name: itemId
            in: path
            required: true
            schema: { type: string }
          - name: modifierListId
            in: path
            required: true
            schema: { type: string }
        responses:
          '204':
            description: No content
  ```

- [ ] **Step 2: Create `apps/server/src/modules/catalog/handlers/item-modifier-lists.ts`**

  ```ts
  import type { Pool, PoolClient } from '../../../db.ts';
  import { withTenantTransaction } from '../../../db.ts';
  import { HttpError } from '../../../http-error.ts';
  import { getTenantId } from '../../../tenant-context.ts';
  import type { FastifyRequest, FastifyReply } from 'fastify';

  async function assertItemExists(client: PoolClient, itemId: string): Promise<void> {
    const { rows } = await client.query('SELECT id FROM item WHERE id = $1', [itemId]);
    if (rows.length === 0) {
      throw new HttpError(404, 'NOT_FOUND', `Item ${itemId} tidak ditemukan.`);
    }
  }

  async function assertModifierListExists(client: PoolClient, modifierListId: string): Promise<void> {
    const { rows } = await client.query('SELECT id FROM modifier_list WHERE id = $1', [modifierListId]);
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
          await assertItemExists(client, itemId);
          await assertModifierListExists(client, modifierListId);
          const { rows } = await client.query(
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

      async detachModifierList(req: FastifyRequest, reply: FastifyReply) {
        const tenantId = getTenantId(req);
        const { itemId, modifierListId } = req.params as { itemId: string; modifierListId: string };
        await withTenantTransaction(pool, tenantId, async (client) => {
          await client.query(
            'DELETE FROM item_modifier_list WHERE item_id = $1 AND modifier_list_id = $2',
            [itemId, modifierListId]
          );
        });
        reply.code(204);
        return null;
      },
    };
  }
  ```

  Note: `attachModifierList` uses `ON CONFLICT (item_id, modifier_list_id) DO UPDATE` — the bridge table's `PRIMARY KEY (item_id, modifier_list_id)` (confirmed in `db/migrations/0004_catalog.sql`) makes attaching an already-attached pair idempotent (updates `sort_order` instead of erroring), which is friendlier than forcing the caller to detach-then-reattach to change ordering.

- [ ] **Step 3: Wire into `apps/server/src/modules/catalog/index.ts`**

  ```ts
  import type { Pool } from '../../db.ts';
  import { createCategoryHandlers } from './handlers/categories.ts';
  import { createItemHandlers } from './handlers/items.ts';
  import { createModifierListHandlers } from './handlers/modifier-lists.ts';
  import { createItemModifierListHandlers } from './handlers/item-modifier-lists.ts';

  export function createCatalogHandlers(pool: Pool): Record<string, unknown> {
    return {
      ...createCategoryHandlers(pool),
      ...createItemHandlers(pool),
      ...createModifierListHandlers(pool),
      ...createItemModifierListHandlers(pool),
    };
  }
  ```

- [ ] **Step 4: Write `tests/catalog/item-modifier-lists.test.js`**

  ```js
  'use strict';

  const { test, before, after, beforeEach } = require('node:test');
  const assert = require('node:assert/strict');
  const crypto = require('node:crypto');
  const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
  const { resetAll } = require('../isolation/helpers/reset');
  const { seedTenantBase } = require('../isolation/helpers/seed');

  let owner, appSetup, app, tenant;

  before(async () => {
    owner = await connectAsOwner();
    appSetup = await connectAsApp();
  });

  after(async () => {
    await resetAll(owner);
    await owner.end();
    await appSetup.end();
    if (app) await app.close();
  });

  beforeEach(async () => {
    await resetAll(owner);
    const base = await seedTenantBase(appSetup, { suffix: 'AttachTest' });
    tenant = base.tenant;
    const { buildApp } = await import('../../apps/server/src/app.ts');
    if (app) await app.close();
    app = await buildApp();
  });

  function req(method, url, payload) {
    return app.inject({ method, url, payload, headers: { 'x-tenant-id': tenant.id } });
  }

  test('attachModifierList lalu detachModifierList', async () => {
    const itemId = crypto.randomUUID();
    await req('POST', '/items', { id: itemId, name: 'Kopi', variations: [{ id: crypto.randomUUID(), price: 20000 }] });
    const listId = crypto.randomUUID();
    await req('POST', '/modifier-lists', { id: listId, name: 'Extra', selectionType: 'multi' });

    const attached = await req('POST', `/items/${itemId}/modifier-lists/${listId}`, {});
    assert.equal(attached.statusCode, 200);
    const body = JSON.parse(attached.body);
    assert.equal(body.itemId, itemId);
    assert.equal(body.modifierListId, listId);

    const detached = await req('DELETE', `/items/${itemId}/modifier-lists/${listId}`);
    assert.equal(detached.statusCode, 204);
  });

  test('satu ModifierList bisa dipakai banyak Item (FR-A1 acceptance criteria)', async () => {
    const listId = crypto.randomUUID();
    await req('POST', '/modifier-lists', { id: listId, name: 'Shared', selectionType: 'single' });

    const item1 = crypto.randomUUID();
    await req('POST', '/items', { id: item1, name: 'A', variations: [{ id: crypto.randomUUID(), price: 1000 }] });
    const item2 = crypto.randomUUID();
    await req('POST', '/items', { id: item2, name: 'B', variations: [{ id: crypto.randomUUID(), price: 2000 }] });

    const res1 = await req('POST', `/items/${item1}/modifier-lists/${listId}`, {});
    const res2 = await req('POST', `/items/${item2}/modifier-lists/${listId}`, {});
    assert.equal(res1.statusCode, 200);
    assert.equal(res2.statusCode, 200);
  });

  test('attachModifierList: 404 kalau Item tidak ada', async () => {
    const listId = crypto.randomUUID();
    await req('POST', '/modifier-lists', { id: listId, name: 'X', selectionType: 'single' });
    const res = await req('POST', `/items/${crypto.randomUUID()}/modifier-lists/${listId}`, {});
    assert.equal(res.statusCode, 404);
  });
  ```

- [ ] **Step 5: Run the full catalog test suite one final time**

  ```bash
  node --env-file=.env --test "tests/catalog/*.test.js"
  npm run test:server
  npm run lint:ds
  cd apps/server && npx tsc --noEmit
  ```
  Expected: all pass. `test:server` confirms Tasks 1-5 didn't regress the `apps/server` scaffold's own tests. `lint:ds` confirms the new TypeScript files pass design-system adherence linting (no JSX/CSS in this module, so nothing should trip, but confirming avoids a surprise).

- [ ] **Step 6: Commit**

  ```bash
  git add apps/server/src/modules/catalog packages/contracts/openapi.yaml tests/catalog/item-modifier-lists.test.js
  git commit -m "Tambah endpoint Item<->ModifierList attach/detach

detachModifierList DELETE baris bridge sungguhan (bukan arsip) --
item_modifier_list tidak punya archived_at, dan invariant #4 bicara
soal entitas katalog, bukan relasi N:M di antaranya. attachModifierList
idempotent lewat ON CONFLICT pada primary key komposit (item_id,
modifier_list_id) yang sudah ada di skema.

Ini menutup seluruh 28 operationId dari sub-project modul Katalog
inti (FR-A1/A2/A4/A6/A9). FR-A7 (harga+riwayat), FR-A3/A5 (aturan UI
kasir), dan FR-A8 (impor, P1) tetap sub-project terpisah berikutnya.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
  ```

---

## Manual verification (outside this plan)

None — everything in this plan (PostgreSQL, `fastify-openapi-glue`, all endpoint logic) is fully verifiable in this environment, same as the `apps/server` scaffold plan. `npm run test:server`, `npm run lint:ds`, `tsc --noEmit`, and the new `tests/catalog/*.test.js` suite are the complete gate.
