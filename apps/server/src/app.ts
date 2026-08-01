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
    // Whole-branch review FIX 1: this branch used to be unconditionally 500,
    // which swallowed every framework-generated 4xx (AJV schema-validation
    // failures via fastify-openapi-glue, 413 body-too-large, 415 unsupported
    // media type, malformed/empty JSON) -- err.statusCode and err.validation
    // were both ignored. AJV validation errors always carry `err.validation`
    // (see node_modules/fastify/lib/validation.js: wrapValidationError sets
    // statusCode 400 + code FST_ERR_VALIDATION + `validation` unconditionally),
    // so they're normalized to the same VALIDATION_ERROR code the handlers
    // already use for application-layer checks (assertPriceValid,
    // assertSelectionTypeValid) -- one code for "the request body is invalid"
    // regardless of which layer caught it. Other framework 4xx errors (413,
    // 415, malformed JSON) keep their own statusCode/code as-is: they aren't
    // shaped like a validation failure, and forcing them to 400 would discard
    // information the client can act on differently (e.g. retry with a
    // smaller body vs. fix the payload).
    //
    // `err`'s static type is `unknown` (Fastify's setErrorHandler signature),
    // and TypeScript can't narrow `unknown` on the false branch of an
    // `instanceof` check the way it narrows a union -- so the shape below is
    // asserted explicitly rather than inferred, same as the `pgErr` cast
    // pattern in handlers/items.ts's translateConstraintError.
    const frameworkErr = err as { statusCode?: number; code?: string; validation?: unknown; message?: string };
    if (frameworkErr.validation) {
      reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: frameworkErr.message ?? 'Validasi gagal.' } });
      return;
    }
    if (typeof frameworkErr.statusCode === 'number' && frameworkErr.statusCode >= 400 && frameworkErr.statusCode < 500) {
      reply.code(frameworkErr.statusCode).send({
        error: { code: frameworkErr.code ?? 'BAD_REQUEST', message: frameworkErr.message ?? 'Permintaan tidak valid.' },
      });
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
