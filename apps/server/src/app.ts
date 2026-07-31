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
