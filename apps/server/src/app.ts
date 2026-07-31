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
