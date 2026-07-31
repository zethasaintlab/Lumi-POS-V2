# Scaffold `apps/server` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the first working slice of `apps/server` — Fastify wired to an OpenAPI spec-first contract via `fastify-openapi-glue`, plus a `withTenantTransaction` helper proven safe against real PostgreSQL connection pooling — with a single `GET /health` endpoint proving the whole pipeline is wired correctly, so the next sub-project (Katalog module endpoints) has a real foundation to build on.

**Architecture:** `packages/contracts` holds the hand-authored OpenAPI YAML (the contract) and generates TypeScript types from it. `apps/server` registers `fastify-openapi-glue` against that YAML — routes are dispatched by `operationId`, so there is no independent route definition in code that could drift from the contract. All future DB access goes through `withTenantTransaction`, which wraps `BEGIN` → `SELECT set_config('app.tenant_id', $1, true)` → work → `COMMIT`/`ROLLBACK`, mirroring the pattern already proven correct in `tests/isolation/helpers/seed.js`.

**Tech Stack:** Node.js 22+ (native TypeScript execution, no build step, no ts-node/tsx), Fastify 5, `fastify-openapi-glue` 4.11.3, `pg` 8.x + `@types/pg`, `openapi-typescript` 7.x, `js-yaml` (for a startup handler-coverage check), Node's built-in test runner.

## Global Constraints

- App connects to PostgreSQL as `lumi_app` (via `DATABASE_URL`, already in `.env.example`) — never as superuser or table owner (invariant #8, CLAUDE.md).
- `app.tenant_id` is `SET LOCAL` **per transaction**, never per connection — every DB access in this plan and everything built on top of it goes through `withTenantTransaction`.
- Frontend and backend code is TypeScript, not plain JS (KEP-08, CLAUDE.md).
- REST + OpenAPI spec-first (CLAUDE.md stack table, locked) — routes are driven BY the OpenAPI document via `fastify-openapi-glue`, not hand-written and separately documented.
- Every new `apps/*`/`packages/*` workspace needs its own `package.json` with `"type": "module"` for native `.ts` + ESM execution to work (verified: `.ts` files default to CommonJS without this, causing `SyntaxError: Cannot use import statement outside a module`).
- No Catalog (or any other module's) business endpoints in this plan — this is the foundation only, verified in the design doc's own Global Constraints/Out-of-scope section.

---

### Task 1: `packages/contracts` — OpenAPI spec-first contract + TypeScript codegen

**Files:**
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/openapi.yaml`
- Modify: `.gitignore` (add generated types file)

**Interfaces:**
- Produces: `packages/contracts/openapi.yaml` (the file path Task 2's `fastify-openapi-glue` registration points at) and an npm script `generate` that produces `packages/contracts/types.d.ts` (git-ignored, regenerated on demand — not consumed by Task 2, but proves the codegen half of "spec-first + generated types" works end-to-end per the design doc's verification section).

- [ ] **Step 1: Create `packages/contracts/package.json`**

  ```json
  {
    "name": "contracts",
    "private": true,
    "version": "0.0.0",
    "type": "module",
    "scripts": {
      "generate": "openapi-typescript openapi.yaml -o types.d.ts"
    },
    "devDependencies": {
      "openapi-typescript": "^7.13.0"
    }
  }
  ```

- [ ] **Step 2: Create `packages/contracts/openapi.yaml`**

  This exact content — verified directly: registered with real `fastify-openapi-glue` 4.11.3 and dispatched correctly, and successfully fed through real `openapi-typescript` 7.13.0 producing valid types.

  ```yaml
  openapi: 3.0.0
  info:
    title: Lumi POS API
    version: 0.0.1
  paths:
    /health:
      get:
        operationId: getHealth
        responses:
          '200':
            description: OK
            content:
              application/json:
                schema:
                  type: object
                  required: [status]
                  properties:
                    status:
                      type: string
  ```

- [ ] **Step 3: Install dependencies**

  From repo root:
  ```bash
  npm install
  ```
  Expected: exits 0. `packages/contracts` resolves as a new npm workspace (root `package.json`'s `"workspaces": ["apps/*", "packages/*"]` already covers it).

- [ ] **Step 4: Add the generated types file to `.gitignore`**

  Add this line to `.gitignore` (group with the other generated-artifact entries like `.oxlintrc.generated.json`):
  ```
  packages/contracts/types.d.ts
  ```

- [ ] **Step 5: Run the codegen and verify the output**

  ```bash
  cd packages/contracts
  npm run generate
  cat types.d.ts
  ```
  Expected: prints `✨ openapi-typescript ... openapi.yaml → types.d.ts`, and `types.d.ts` contains (structurally, exact generated names may vary slightly by openapi-typescript patch version, but this shape must hold): a `paths` interface with a `/health` key whose `get` references `operations["getHealth"]`, and an `operations` interface with a `getHealth` member whose `responses[200].content["application/json"]` has a `status: string` field. Verified directly with this exact YAML: this is the actual output produced, not a guess.

- [ ] **Step 6: Commit**

  ```bash
  git add packages/contracts/package.json packages/contracts/openapi.yaml package-lock.json .gitignore
  git commit -m "Scaffold packages/contracts: OpenAPI spec-first kontrak + codegen tipe TS

Kontrak baru cuma GET /health untuk sub-project ini -- endpoint Katalog
sungguhan ditambahkan ke openapi.yaml ini di sub-project berikutnya.
types.d.ts git-ignored, dibuat ulang lewat npm run generate.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
  ```

---

### Task 2: `apps/server` — Fastify + `withTenantTransaction`, wired to the contract, with tests

**Files:**
- Create: `apps/server/package.json`
- Create: `apps/server/src/db.ts`
- Create: `apps/server/src/app.ts`
- Create: `apps/server/src/index.ts`
- Create: `tests/server/health.test.js`
- Create: `tests/server/tenant-transaction.test.js`
- Modify: `package.json` (root — add `test:server` script)

**Interfaces:**
- Consumes: `packages/contracts/openapi.yaml` (Task 1) as the `specification` option for `fastify-openapi-glue`.
- Produces: `createPool(): Pool` and `withTenantTransaction<T>(pool: Pool, tenantId: string, fn: (client: PoolClient) => Promise<T>): Promise<T>` exported from `src/db.ts`. `buildApp(): Promise<FastifyInstance>` exported from `src/app.ts` (used by both `index.ts` to `.listen()` and by the tests to `.inject()` — no real network socket needed for tests).

- [ ] **Step 1: Create `apps/server/package.json`**

  ```json
  {
    "name": "server",
    "private": true,
    "version": "0.0.0",
    "type": "module",
    "scripts": {
      "start": "node src/index.ts",
      "typecheck": "tsc --noEmit"
    },
    "dependencies": {
      "fastify": "^5.11.0",
      "fastify-openapi-glue": "^4.11.3",
      "pg": "^8.22.0",
      "js-yaml": "^4.1.0",
      "contracts": "*"
    },
    "devDependencies": {
      "typescript": "^5.9.3",
      "@types/pg": "^8.20.0",
      "@types/node": "^22.0.0",
      "@types/js-yaml": "^4.0.9"
    }
  }
  ```

  `"contracts": "*"` links to `packages/contracts` as an npm workspace dependency (same pattern already used for `"ds": "*"` in `apps/kasir/package.json` from the prior sub-project) — `apps/server` doesn't currently import anything FROM `contracts` at runtime (the generated `types.d.ts` is git-ignored and would need its own wiring to actually be imported, which is out of scope here), but declaring the workspace dependency now documents the real relationship and makes `packages/contracts/openapi.yaml`'s path resolvable via `require.resolve`/relative import in Step 3 without a fragile `../../` reach-across.

- [ ] **Step 2: Create `apps/server/tsconfig.json`**

  ```json
  {
    "compilerOptions": {
      "target": "ES2022",
      "module": "NodeNext",
      "moduleResolution": "NodeNext",
      "strict": true,
      "skipLibCheck": true,
      "noEmit": true,
      "types": ["node"]
    },
    "include": ["src"]
  }
  ```

- [ ] **Step 3: Create `apps/server/src/db.ts`**

  This exact content — the `withTenantTransaction` logic was verified directly against real PostgreSQL using a `max: 1` pool (forcing physical-connection reuse across separate `pool.connect()` calls, the exact scenario this function must handle safely): tenant A's transaction correctly isolated from a subsequent tenant B transaction on the same physical connection, and a deliberate mid-transaction throw correctly rolled back without leaking `app.tenant_id` into the next pooled use.

  ```ts
  import pg from 'pg';

  const { Pool } = pg;
  export type { Pool, PoolClient } from 'pg';

  export function createPool(): InstanceType<typeof Pool> {
    return new Pool({ connectionString: process.env.DATABASE_URL });
  }

  export async function withTenantTransaction<T>(
    pool: InstanceType<typeof Pool>,
    tenantId: string,
    fn: (client: import('pg').PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
  ```

- [ ] **Step 4: Create `apps/server/src/app.ts`**

  `fastify-openapi-glue` dispatches routes correctly by `operationId`, but a `serviceHandlers` object missing a method for a declared `operationId` only fails at **request** time (a 500 with `"Operation <name> not implemented"`) — verified directly. `assertAllOperationsImplemented` below turns that into a **startup**-time failure instead, consistent with this project's established fail-loud pattern (see `tools/oxlint-plugins/ds-adherence.mjs` from the previous sub-project).

  ```ts
  import Fastify, { type FastifyInstance } from 'fastify';
  import openapiGlue from 'fastify-openapi-glue';
  import { readFileSync } from 'node:fs';
  import { fileURLToPath } from 'node:url';
  import path from 'node:path';
  import yaml from 'js-yaml';

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const OPENAPI_SPEC_PATH = path.join(__dirname, '..', '..', '..', 'packages', 'contracts', 'openapi.yaml');

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

  const serviceHandlers = {
    async getHealth() {
      return { status: 'ok' };
    },
  };

  export async function buildApp(): Promise<FastifyInstance> {
    assertAllOperationsImplemented(OPENAPI_SPEC_PATH, serviceHandlers);

    const app = Fastify();
    await app.register(openapiGlue, {
      specification: OPENAPI_SPEC_PATH,
      serviceHandlers,
    });
    return app;
  }
  ```

- [ ] **Step 5: Create `apps/server/src/index.ts`**

  ```ts
  import { buildApp } from './app.ts';

  const PORT = Number(process.env.PORT ?? 3000);

  const app = await buildApp();
  await app.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`server listening on port ${PORT}`);
  ```

  Note the `.ts` extension in the relative import (`'./app.ts'`, not `'./app'`) — Node's native TypeScript execution requires explicit extensions for relative specifiers, same as it does for `.js` under `NodeNext` module resolution.

- [ ] **Step 6: Write `tests/server/health.test.js`**

  ```js
  'use strict';

  const { test } = require('node:test');
  const assert = require('node:assert/strict');

  test('GET /health mengembalikan status ok, lewat pipa OpenAPI spec-first penuh', async () => {
    const { buildApp } = await import('../../apps/server/src/app.ts');
    const app = await buildApp();

    const res = await app.inject({ method: 'GET', url: '/health' });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body), { status: 'ok' });

    await app.close();
  });
  ```

- [ ] **Step 7: Write `tests/server/tenant-transaction.test.js`**

  Mirrors the existing negative-control pattern from `tests/isolation/set-local-per-transaction.test.js`, but exercises the real `withTenantTransaction` helper (not raw queries) and forces physical-connection reuse with a `max: 1` pool — the exact scenario the helper must handle safely. Requires PostgreSQL running locally with the schema and roles already set up (same prerequisite as `tests/isolation/`).

  ```js
  'use strict';

  const { test, before, after } = require('node:test');
  const assert = require('node:assert/strict');
  const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
  const { resetAll } = require('../isolation/helpers/reset');
  const { seedTenantBase } = require('../isolation/helpers/seed');

  let owner, appSetup, pool, tenantA, tenantB;

  before(async () => {
    owner = await connectAsOwner();
    appSetup = await connectAsApp();
    await resetAll(owner);

    const baseA = await seedTenantBase(appSetup, { suffix: 'ServerTxA' });
    tenantA = baseA.tenant;
    const baseB = await seedTenantBase(appSetup, { suffix: 'ServerTxB' });
    tenantB = baseB.tenant;

    const { createPool } = await import('../../apps/server/src/db.ts');
    // max: 1 forces every pool.connect() below to reuse the SAME physical
    // connection -- this is the exact connection-pooling scenario that must
    // not leak tenant context between calls.
    pool = createPool();
    pool.options.max = 1;
  });

  after(async () => {
    await pool.end();
    await resetAll(owner);
    await owner.end();
    await appSetup.end();
  });

  test('withTenantTransaction: tenant A melihat hanya datanya sendiri', async () => {
    const { withTenantTransaction } = await import('../../apps/server/src/db.ts');
    const rows = await withTenantTransaction(pool, tenantA.id, async (client) => {
      const { rows } = await client.query('SELECT id FROM outlet WHERE tenant_id = $1', [tenantA.id]);
      return rows;
    });
    assert.equal(rows.length, 1);
  });

  test('withTenantTransaction: koneksi fisik dipakai ulang, tenant B tidak melihat data tenant A', async () => {
    const { withTenantTransaction } = await import('../../apps/server/src/db.ts');
    const rows = await withTenantTransaction(pool, tenantB.id, async (client) => {
      const { rows } = await client.query('SELECT id FROM outlet WHERE tenant_id = $1', [tenantA.id]);
      return rows;
    });
    assert.deepEqual(rows, [], 'konteks tenant B tidak boleh melihat baris tenant A meski koneksi fisik sama');
  });

  test('withTenantTransaction: error di tengah transaksi di-ROLLBACK, tidak bocor ke pemanggilan pool berikutnya', async () => {
    const { withTenantTransaction } = await import('../../apps/server/src/db.ts');

    await assert.rejects(
      withTenantTransaction(pool, tenantA.id, async () => {
        throw new Error('kegagalan sengaja di tengah transaksi');
      }),
      /kegagalan sengaja/
    );

    const rows = await withTenantTransaction(pool, tenantB.id, async (client) => {
      const { rows } = await client.query('SELECT id FROM outlet WHERE tenant_id = $1', [tenantA.id]);
      return rows;
    });
    assert.deepEqual(rows, [], 'setelah ROLLBACK, pemanggilan pool berikutnya tidak boleh melihat sisa konteks tenant A');
  });
  ```

- [ ] **Step 8: Install dependencies and run typecheck**

  From repo root:
  ```bash
  npm install
  cd apps/server && npx tsc --noEmit
  ```
  Expected: `npm install` exits 0 (`apps/server` and its new dependencies resolve as a workspace). `tsc --noEmit` exits 0, no errors — verified directly: this exact combination of `pg`'s default-export-then-destructure pattern, `@types/pg`, and the generic `withTenantTransaction<T>` signature type-checks cleanly under `strict: true`.

- [ ] **Step 9: Run the new tests**

  From repo root, add this script to `package.json` (alongside `test:isolation`, `test:sqlite-local`, `test:oxlint-ds-adherence`):
  ```json
      "test:server": "node --env-file=.env --test \"tests/server/*.test.js\"",
  ```
  Then run:
  ```bash
  npm run test:server
  ```
  Expected: 4 tests total (1 from `health.test.js`, 3 from `tenant-transaction.test.js`), all pass. Needs PostgreSQL running locally with the F0 schema applied (`npm run db:migrate` already run) — same prerequisite `tests/isolation/` already has.

- [ ] **Step 10: Manual smoke test of the real server process**

  From repo root:
  ```bash
  node --env-file=.env apps/server/src/index.ts &
  sleep 1
  curl -s http://localhost:3000/health
  ```
  Expected: prints `server listening on port 3000` then `{"status":"ok"}`. Stop the background process afterward (find its PID and terminate it — on Windows/git-bash, a plain `kill` on an npx/node-spawned background process is not always reliable; use `netstat -ano | grep ":3000" | grep LISTENING` to find the real PID, then `taskkill //PID <pid> //F //T` if a plain `kill` doesn't stop it, matching the pattern already used in the Tauri kasir shell sub-project).

- [ ] **Step 11: Commit**

  ```bash
  git add apps/server tests/server package.json package-lock.json
  git commit -m "Scaffold apps/server: Fastify + fastify-openapi-glue + withTenantTransaction

GET /health membuktikan seluruh pipa OpenAPI spec-first tersambung:
packages/contracts/openapi.yaml -> fastify-openapi-glue -> serviceHandlers
-> respons tervalidasi skema. withTenantTransaction() diverifikasi aman
terhadap PostgreSQL asli dengan pool max:1 yang memaksa koneksi fisik
dipakai ulang -- termasuk kasus error di tengah transaksi yang harus
ROLLBACK tanpa membocorkan app.tenant_id ke pemanggilan pool berikutnya.
assertAllOperationsImplemented() mengubah operationId tanpa handler dari
kegagalan saat request (500) jadi kegagalan saat startup.

Modul Katalog (endpoint sungguhan) adalah sub-project F1 berikutnya,
dibangun di atas fondasi ini.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
  ```

---

## Manual verification (outside this plan)

None — unlike the prior two sub-projects (Rust/Tauri, GitHub Actions CI), everything in this plan is fully verifiable in this environment: PostgreSQL is running locally, `fastify-openapi-glue` and `openapi-typescript` are real installable packages with no external-service dependency, and the server itself runs as a plain Node process. `npm run test:server` plus the manual smoke test in Task 2 Step 10 are the complete, real gate for this sub-project — nothing is deferred to "after you push" or "after you install X."
