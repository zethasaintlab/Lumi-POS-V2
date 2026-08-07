import Fastify, { type FastifyInstance } from 'fastify';
import openapiGlue from 'fastify-openapi-glue';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { createPool, type Pool } from './db.ts';
import { HttpError } from './http-error.ts';
import { createCatalogHandlers } from './modules/catalog/index.ts';
import { createIdentityHandlers } from './modules/identity/index.ts';
import { createCashHandlers } from './modules/cash/index.ts';
import { createOrderingHandlers } from './modules/ordering/index.ts';
import { createPaymentHandlers } from './modules/payment/index.ts';
import { selectPaymentProvider } from './modules/payment/providers/index.ts';
import { createRedactingLogMethod, redactSensitive, registerSecretValues } from './log-redaction.ts';
import type { PaymentProvider } from './modules/payment/providers/index.ts';
import { createHlc } from '../../../packages/domain/src/hlc.ts';

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

// `overrides` is a test-only seam (defaults reproduce the real production
// call `buildApp()` with no arguments exactly). specPath lets a test force
// assertAllOperationsImplemented to throw deterministically (a spec path
// that doesn't exist) without needing a real broken serviceHandlers set;
// pool lets a test hold a reference to the exact Pool instance buildApp
// creates internally, to assert on `pool.ended` after a forced failure --
// see tests/server/build-app-lifecycle.test.js (whole-branch review FIX 8).
export async function buildApp(
  overrides: {
    pool?: Pool;
    specPath?: string;
    paymentProvider?: PaymentProvider;
    logger?: { level: string; stream: NodeJS.WritableStream };
    webhookSecret?: string;
  } = {}
): Promise<FastifyInstance> {
  const pool = overrides.pool ?? createPool();
  const specPath = overrides.specPath ?? OPENAPI_SPEC_PATH;

  // Invariant #5: perbedaan lingkungan HANYA lewat environment variable.
  // Adapter gateway dipilih SEKALI di sini, di tepi aplikasi -- sama seperti
  // createPool() dan clock yang di-inject ke Hlc di bawah. Tidak ada satu pun
  // `if` tentang lingkungan di dalam handler.
  //
  // `paymentProvider` di overrides adalah seam TEST: default-nya
  // mereproduksi persis panggilan produksi `buildApp()` tanpa argumen. Test
  // gateway memakai fake yang menghitung panggilan, karena CI mengisi kunci
  // Midtrans dengan string kosong dan tidak ada test yang boleh menyentuh
  // jaringan.
  const paymentProvider = overrides.paymentProvider ?? selectPaymentProvider(process.env);

  // Whole-branch review FIX 8: `pool` above is a real pg Pool -- if anything
  // between here and `app.addHook('onClose', ...)` below throws (the
  // originally-flagged case: assertAllOperationsImplemented finding a
  // missing operationId; but the same leak shape applies to any other throw
  // in this range, e.g. a bad openapi-glue registration), buildApp used to
  // return/reject without ever calling pool.end(), leaking the Pool's
  // connections/handles. The `onClose` hook below only exists to close the
  // pool once the app itself is closed -- it can't help if the app is never
  // successfully built in the first place.
  try {
    // Kunci webhook dibaca terpisah dari pemilihan adapter: webhook harus
    // dapat memverifikasi notifikasi walau PAYMENT_PROVIDER=fake (mis. saat
    // menguji integrasi di staging dengan adapter palsu).
    const webhookSecret = overrides.webhookSecret ?? process.env.MIDTRANS_SERVER_KEY ?? '';
    return await buildAppInner(pool, specPath, paymentProvider, overrides.logger, webhookSecret);
  } catch (err) {
    await pool.end();
    throw err;
  }
}

async function buildAppInner(
  pool: Pool,
  specPath: string,
  paymentProvider: PaymentProvider,
  loggerOverride: { level: string; stream: NodeJS.WritableStream } | undefined,
  webhookSecret: string
): Promise<FastifyInstance> {
  // Satu instance Hlc per proses server (keputusan Q3, PLAN-ordering-fondasi.md
  // §8.0), dibuat di sini -- BUKAN di dalam modul ordering -- dengan clock
  // nyata (Date.now) di-inject di batas ini persis. packages/domain tetap
  // murni; ketidakmurnian (waktu nyata) hanya hidup di tepi aplikasi, sama
  // seperti createPool() di atas. Prasyarat harness DST F2
  // (packages/domain/src/hlc.ts, komentar "Kenapa clock di-inject").
  const hlc = createHlc({ now: () => Date.now() });

  const serviceHandlers = {
    async getHealth() {
      return { status: 'ok' };
    },
    ...createCatalogHandlers(pool),
    ...createIdentityHandlers(pool),
    ...createCashHandlers(pool),
    ...createOrderingHandlers(pool, hlc),
    ...createPaymentHandlers(pool, hlc, paymentProvider, webhookSecret),
  };

  assertAllOperationsImplemented(specPath, serviceHandlers);

  // ## Logger, dan kenapa redaksinya ada DI SINI
  //
  // AC FR-C5 ketiga menuntut "LAPISAN LOGGING meredaksi payload pembayaran
  // secara otomatis". Kata itu menentukan tempatnya: `logMethod` menyaring
  // setiap baris log yang lewat, siapa pun penulisnya -- termasuk modul yang
  // belum ditulis hari ini. Redaksi yang bergantung pada pemanggil mengingat
  // untuk memakainya akan bocor lewat jalur yang lupa.
  //
  // Level dibaca dari environment variable, bukan dari `if (isProduction)`
  // (invariant #5). Default `silent` menjaga perilaku yang sudah ada -- sampai
  // sekarang aplikasi ini memang tidak menulis log sama sekali, dan itu utang
  // tersendiri yang dicatat di HANDOFF.md, bukan sesuatu yang diam-diam
  // kuubah di sub-project pembayaran.
  //
  // `loggerOverride` adalah seam TEST: ia memberi test sebuah stream untuk
  // diperiksa, dan tanpa itu AC di atas tidak dapat diverifikasi sama sekali.
  // Nilai rahasia didaftarkan SEBELUM logger dibuat. Penyaringan berbasis nama
  // field tidak menangkap kunci yang menyelinap ke dalam pesan error -- di sana
  // ia teks bebas tanpa nama apa pun.
  registerSecretValues([process.env.MIDTRANS_SERVER_KEY, process.env.MIDTRANS_CLIENT_KEY]);

  const logConfig = {
    level: loggerOverride?.level ?? process.env.LOG_LEVEL ?? 'silent',
    hooks: { logMethod: createRedactingLogMethod() },
    ...(loggerOverride ? { stream: loggerOverride.stream } : {}),
  };
  const app = Fastify({ logger: logConfig });

  // Payload pembayaran dicatat -- SUDAH tersaring lapisan logger di atas.
  // Tanpa baris ini, "log tidak memuat nomor kartu" akan hijau hanya karena
  // tidak ada payload yang pernah di-log sama sekali: benar, tapi tidak
  // membuktikan apa pun.
  app.addHook('preHandler', async (req) => {
    if (req.method === 'POST' && req.url.includes('/payments')) {
      req.log.info({ body: req.body, url: req.url }, 'pembayaran diterima');
    }
  });

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
    req.log.error({ err, body: redactSensitive(req.body), url: req.url }, 'permintaan gagal');
    reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Terjadi kesalahan internal.' } });
  });

  await app.register(openapiGlue, {
    specification: specPath,
    serviceHandlers,
  });

  app.decorate('pool', pool);
  app.addHook('onClose', async () => {
    await pool.end();
  });

  return app;
}
