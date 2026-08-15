import Fastify, { type FastifyInstance } from 'fastify';
import openapiGlue from 'fastify-openapi-glue';
import rateLimit from '@fastify/rate-limit';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { createPool, type Pool } from './db.ts';
import { HttpError } from './http-error.ts';
import { createCatalogHandlers } from './modules/catalog/index.ts';
import { createIdentityHandlers } from './modules/identity/index.ts';
import type { KonfigToken } from './modules/identity/handlers/tokens.ts';
import { createCashHandlers } from './modules/cash/index.ts';
import { createOrderingHandlers } from './modules/ordering/index.ts';
import { createPaymentHandlers } from './modules/payment/index.ts';
import { createTenancyHandlers } from './modules/tenancy/index.ts';
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
    /** FR-F12: PEM kunci privat RSA. String kosong = fitur tidak dikonfigurasi. */
    syncJwtPrivateKey?: string;
    /** Origin yang boleh memanggil server dari browser. Kosong = tidak ada. */
    corsOrigins?: string[];
    /**
     * Batas laju `POST /tenants` — satu-satunya endpoint tanpa autentikasi.
     * Seam TEST: default-nya membaca environment variable, persis seperti
     * panggilan produksi.
     */
    batasPendaftaran?: { max: number; jendela: string };
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
    // FR-F12. Kunci KOSONG diperbolehkan dan berarti "fitur tidak
    // dikonfigurasi" -- endpoint token menjawab 503. Gagal saat boot (pola
    // adapter pembayaran) akan menuntut setiap test dan setiap lingkungan
    // pengembangan menyediakan kunci RSA hanya untuk menjalankan endpoint
    // yang tidak dipakainya.
    const konfigToken = {
      pemPrivat: overrides.syncJwtPrivateKey ?? process.env.POWERSYNC_JWT_PRIVATE_KEY ?? '',
      powersyncUrl: process.env.POWERSYNC_URL ?? '',
      sekarang: () => Date.now(),
    };
    const corsOrigins =
      overrides.corsOrigins ??
      (process.env.CORS_ORIGINS ?? '')
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean);
    // Invariant #5: angkanya dari environment variable, bukan dari `if`
    // tentang lingkungan. Bawaan 5 per 15 menit — pendaftaran adalah operasi
    // yang seorang merchant lakukan SEKALI, jadi batas yang longgar pun sudah
    // jauh di atas pemakaian yang sah.
    const batasPendaftaran = overrides.batasPendaftaran ?? {
      max: Number(process.env.TENANT_REGISTRATION_RATE_MAX ?? 5),
      jendela: process.env.TENANT_REGISTRATION_RATE_WINDOW ?? '15 minutes',
    };
    return await buildAppInner(
      pool,
      specPath,
      paymentProvider,
      overrides.logger,
      webhookSecret,
      konfigToken,
      corsOrigins,
      batasPendaftaran
    );
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
  webhookSecret: string,
  konfigToken: KonfigToken,
  corsOrigins: string[],
  batasPendaftaran: { max: number; jendela: string }
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
    ...createIdentityHandlers(pool, konfigToken, hlc),
    ...createCashHandlers(pool),
    ...createOrderingHandlers(pool, hlc),
    ...createPaymentHandlers(pool, hlc, paymentProvider, webhookSecret),
    ...createTenancyHandlers(pool, hlc),
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


  /* CORS untuk aplikasi kasir.

     ⛔ Ditemukan dengan menjalankan aplikasi: klien di `http://localhost:1420`
     tidak dapat mencapai server sama sekali — *"Response to preflight request
     doesn't pass access control check"* — meskipun seluruh test server hijau.
     Aplikasi kasir adalah SPA di origin yang berbeda dari API, jadi ini bukan
     kenyamanan pengembangan melainkan prasyarat agar ia berfungsi.

     Ditulis tangan, bukan `@fastify/cors`: aturannya sempit (satu daftar
     origin, tanpa kredensial cookie) dan menambah dependensi untuk sembilan
     baris tidak sepadan.

     Daftar origin datang dari `CORS_ORIGINS`, bukan dari kode (invariant #5).
     Kosong = tidak ada yang diizinkan, dan `*` tidak pernah dijawab. */
  const asalDiizinkan = new Set(corsOrigins);
  const HEADER_DIIZINKAN = 'content-type, authorization, x-tenant-id, x-actor-id, x-approver-id, idempotency-key';

  app.addHook('onRequest', async (req, reply) => {
    const asal = req.headers.origin;
    if (typeof asal !== 'string' || !asalDiizinkan.has(asal)) {
      // Preflight dari origin asing tetap dijawab, tapi TANPA izin apa pun.
      // Browser yang menolaknya -- itu memang pembagian kerjanya.
      if (req.method === 'OPTIONS') reply.code(204).send();
      return;
    }
    reply.header('Access-Control-Allow-Origin', asal);
    reply.header('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      reply.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      reply.header('Access-Control-Allow-Headers', HEADER_DIIZINKAN);
      reply.header('Access-Control-Max-Age', '600');
      reply.code(204).send();
    }
  });

  /* ## Rate limit — HANYA `POST /tenants`
   *
   * Ia satu-satunya endpoint yang membuat baris database tanpa
   * autentikasi apa pun. Tanpa batas, siapa pun dapat membuat tenant, outlet,
   * dan pengguna sebanyak yang mau; tabel `tenant` dikecualikan RLS, jadi
   * tidak ada lapisan lain yang menahannya.
   *
   * ⛔ `global: false`. Setiap endpoint lain sudah dijaga `X-Tenant-Id` +
   * RLS, dan membatasi jalur kasir berarti membangun kemampuan MENGHENTIKAN
   * PENJUALAN dari sisi server — hal yang sama yang `research/09` § 6 larang
   * untuk kuota. Perangkat di balik satu NAT outlet berbagi alamat IP; batas
   * global akan mengunci kasir kedua pada jam sibuk.
   *
   * Store-nya IN-MEMORY, dan itu keputusan yang dinyatakan, bukan bawaan yang
   * kebetulan: `research/03` mengunci "tanpa Redis di v1". Konsekuensinya
   * jujur — hitungannya per-proses dan hilang saat restart, jadi ia menahan
   * penyalahgunaan kasar, bukan penyerang terdistribusi. Yang menahan sisanya
   * belum ada, dan itu tetap tercatat sebagai utang.
   *
   * Angkanya dari environment variable (invariant #5), bukan `if
   * (isProduction)`.
   *
   * ## Kenapa lewat `onRoute`, bukan opsi rute
   *
   * Rute didaftarkan `fastify-openapi-glue` dari spesifikasi OpenAPI — tidak
   * ada tempat untuk menaruh `config.rateLimit` per rute. Hook ini menempelkan
   * config itu sebelum plugin membacanya, dan ia ditambahkan SEBELUM
   * `register` supaya urutannya benar.
   */
  app.addHook('onRoute', (routeOptions) => {
    if (routeOptions.method !== 'POST' || routeOptions.url !== '/tenants') return;
    routeOptions.config = {
      ...routeOptions.config,
      rateLimit: {
        max: batasPendaftaran.max,
        timeWindow: batasPendaftaran.jendela,
      },
    };
  });

  await app.register(rateLimit, {
    global: false,
    // Pesan penolakan menyebut berapa lama harus menunggu. "Terlalu banyak
    // permintaan" tanpa angka membuat merchant yang sah — yang salah ketik
    // password tiga kali — menebak apakah ia diblokir selamanya.
    // ⛔ Mengembalikan `HttpError`, BUKAN objek biasa berbentuk respons.
    // Yang dikembalikan di sini DILEMPAR sebagai error dan melewati
    // `setErrorHandler` di atas; objek `{ error: { … } }` tanpa `statusCode`
    // tidak dikenali cabang mana pun di sana dan keluar sebagai **500**.
    // Ditemukan dengan menjalankannya: penolakan batas laju terbaca sebagai
    // kesalahan server, dan tidak ada satu pun tipe yang mengeluh.
    errorResponseBuilder: (_req, konteks) =>
      new HttpError(
        429,
        'RATE_LIMITED',
        `Terlalu banyak percobaan pendaftaran. Maksimal ${konteks.max} dalam ` +
          `${konteks.after}. Coba lagi setelah itu.`
      ),
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
