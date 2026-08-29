import type { Pool, PoolClient } from '../../../db.ts';
import { withTenantTransaction } from '../../../db.ts';
import { HttpError } from '../../../http-error.ts';
import { getTenantId, getActorId } from '../../../tenant-context.ts';
import { catatPerubahanServer } from '../../audit/index.ts';
import { isPrimaryKeyViolation } from './pg-error.ts';
import { fetchVariationOrThrow } from './items.ts';
import { assertOutletVisible } from '../../tenancy/index.ts';
import { assertUserVisible } from '../../identity/index.ts';
import type { FastifyRequest, FastifyReply } from 'fastify';

interface PriceHistoryRow {
  id: string;
  variation_id: string;
  outlet_id: string | null;
  price: string; // bigint comes back as string from node-postgres
  effective_from: string;
  changed_by: string;
  reason: string | null;
}

interface PriceInput {
  id: string;
  price: unknown;
  outletId?: string | null;
  effectiveFrom?: string;
  reason?: string | null;
}

function toPrice(row: PriceHistoryRow) {
  return {
    id: row.id,
    variationId: row.variation_id,
    outletId: row.outlet_id,
    price: Number(row.price),
    effectiveFrom: row.effective_from,
    changedBy: row.changed_by,
    reason: row.reason,
  };
}

// Sama seperti assertPriceValid di items.ts (typeof + Number.isInteger
// dicek eksplisit, bukan hanya `< 0`, supaya string, float pecahan, null,
// dan NaN/Infinity semuanya ditolak) -- ditambah batas atas
// Number.MAX_SAFE_INTEGER, yang tidak dinyatakan lewat JSON Schema apa pun
// di openapi.yaml (lihat komentar di PriceInput di sana). price = 0 legal
// (barang gratis/promo, konsisten dengan assertModifierPriceValid).
function assertPriceValid(price: unknown): asserts price is number {
  if (
    typeof price !== 'number' ||
    !Number.isInteger(price) ||
    price < 0 ||
    price > Number.MAX_SAFE_INTEGER
  ) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      'Harga harus bilangan bulat rupiah >= 0 dan tidak melebihi Number.MAX_SAFE_INTEGER.'
    );
  }
}

export interface ResolvedPrice {
  price: number;
  source: 'outlet' | 'tenant' | 'variation';
  outletId: string | null;
  at: string;
}

interface PriceLadderRow {
  outlet_price: string | null;
  tenant_price: string | null;
  variation_price: string | null;
  at_used: string;
}

// Query resolusi FR-A7 (spec-a-katalog.md:202-209), satu round-trip lewat
// tiga scalar subquery -- BUKAN tiga query terpisah, dan BUKAN satu predikat
// `outlet_id IS NOT DISTINCT FROM $2` (lihat komentar migrasi 0016: operator
// itu tidak indexable, EXPLAIN membuktikannya muncul sebagai Filter, bukan
// Index Cond).
//
// `outlet_id = $2` dengan $2 = NULL secara semantik SQL tidak pernah match
// baris apa pun (NULL = apa pun selalu UNKNOWN, bukan TRUE) -- jadi anak
// tangga 1 otomatis terlewati kalau caller tidak memberi outletId, tanpa
// perlu bentuk SQL bercabang untuk kasus itu.
//
// `at` default diambil dari jam DATABASE (`now()`), BUKAN dari `new Date()` di
// Node. Ini bukan detail gaya -- ia memperbaiki bug nyata.
//
// Jalur tulis menstempel `effective_from` dengan `now()` PostgreSQL. Kalau
// jalur baca memakai jam Node, dua jam berbeda mengatur satu instan yang sama,
// dan setiap skew di antaranya membuat harga yang BARU SAJA ditulis dianggap
// belum berlaku -- resolusi diam-diam jatuh ke anak tangga di bawahnya.
// Terukur 2 Agu 2026: skew ±2 ms cukup untuk menggagalkan 4 dari 12 run test.
// Di produksi app server dan database adalah mesin terpisah; skew puluhan
// milidetik itu normal, dan akibatnya adalah harga lama tercetak di struk
// setelah merchant menaikkan harga.
//
// `now()` adalah `transaction_timestamp()` -- TETAP sepanjang satu transaksi.
// Jadi ketiga anak tangga di bawah melihat nilai `at` yang sama persis, bukan
// tiga pembacaan jam yang berbeda. Itu jaminan PostgreSQL, bukan kebetulan.
//
// `$3::timestamptz` di-cast eksplisit: temuan tertunda di repo ini
// menunjukkan `COALESCE` tanpa cast bisa membuat PostgreSQL menyimpulkan tipe
// parameter yang salah secara diam-diam.
const AT_EXPR = 'COALESCE($3::timestamptz, now())';

const PRICE_LADDER_SQL = `
  SELECT
    (SELECT price FROM price_history
       WHERE variation_id = $1 AND outlet_id = $2 AND effective_from <= ${AT_EXPR}
       ORDER BY effective_from DESC, id DESC LIMIT 1) AS outlet_price,
    (SELECT price FROM price_history
       WHERE variation_id = $1 AND outlet_id IS NULL AND effective_from <= ${AT_EXPR}
       ORDER BY effective_from DESC, id DESC LIMIT 1) AS tenant_price,
    (SELECT price FROM item_variation WHERE id = $1) AS variation_price,
    ${AT_EXPR} AS at_used
`;

// Diekspor lewat catalog/index.ts (invariant #4 CLAUDE.md) supaya Modul B
// (order_line.unit_price adalah SNAPSHOT hasil fungsi ini) memakai fungsi
// ini langsung, bukan mengakses price_history/item_variation sendiri di
// luar modul katalog. `client` WAJIB berasal dari transaksi pemanggil yang
// sudah men-SET LOCAL app.tenant_id -- baru begitu SELECT ini tunduk RLS.
//
// Pemanggil (endpoint di modul ini) bertanggung jawab memvalidasi
// variationId (fetchVariationOrThrow) dan outletId (assertOutletVisible)
// SEBELUM memanggil resolvePrice -- fungsi ini sendiri tidak mengulang
// validasi itu, hanya menjaga diri lewat guard variation_price null di bawah
// untuk pemanggil yang lalai.
// `at === null` berarti "sekarang menurut database". Sengaja BUKAN
// `at = new Date()` sebagai default parameter: itu justru menghidupkan lagi
// jam kedua yang baru saja dihapus. Modul B nanti memanggil fungsi ini untuk
// menghasilkan snapshot `order_line.unit_price`, dan ia harus mewarisi
// jaminan satu-jam yang sama.
export async function resolvePrice(
  client: PoolClient,
  variationId: string,
  outletId: string | null,
  at: Date | null
): Promise<ResolvedPrice> {
  const atParam = at === null ? null : at.toISOString();
  const { rows } = await client.query<PriceLadderRow>(PRICE_LADDER_SQL, [variationId, outletId, atParam]);
  const row = rows[0];
  // `at` yang dilaporkan adalah yang BENAR-BENAR dipakai query, dibaca balik
  // dari database -- bukan tebakan sisi aplikasi. Tanpa ini, respons bisa
  // menyebut waktu yang berbeda dari waktu yang menentukan hasilnya.
  const atUsed = new Date(row.at_used).toISOString();
  if (row.outlet_price !== null) {
    return { price: Number(row.outlet_price), source: 'outlet', outletId, at: atUsed };
  }
  if (row.tenant_price !== null) {
    return { price: Number(row.tenant_price), source: 'tenant', outletId, at: atUsed };
  }
  if (row.variation_price === null) {
    // Hanya tercapai kalau pemanggil TIDAK memvalidasi variationId lebih
    // dulu -- bentuk error sama dengan fetchVariationOrThrow supaya
    // konsisten, bukan celah baru.
    throw new HttpError(404, 'NOT_FOUND', `Variation ${variationId} tidak ditemukan.`);
  }
  return { price: Number(row.variation_price), source: 'variation', outletId, at: atUsed };
}

// Query T10 (GET /outlets/{outletId}/prices) -- bentuk LATERAL yang sama
// persis dengan PRICE_LADDER_SQL, tapi dijalankan sekali per outlet untuk
// SELURUH item_variation aktif tenant, bukan per variation (satu query,
// bukan N+1). `iv.archived_at IS NULL` menegakkan "seluruh item_variation
// aktif" (PLAN §T10); RLS pada item_variation dan price_history menegakkan
// isolasi tenant tanpa predikat tenant_id eksplisit di sini.
// `$2` di sini memakai AT_EXPR yang sama dengan PRICE_LADDER_SQL (jam
// database saat `at` tidak dikirim). Dua salinan tangga resolusi ini sudah
// pernah menyimpang diam-diam sekali -- urutan COALESCE-nya terbalik dan
// seluruh suite tetap hijau. Sejak itu keduanya diikat test konsistensi;
// jaminan satu-jam ini juga harus berlaku di kedua salinan.
const OUTLET_AT_EXPR = 'COALESCE($2::timestamptz, now())';

const OUTLET_PRICES_SQL = `
  SELECT
    iv.id AS variation_id,
    COALESCE(op.price, tp.price, iv.price) AS price,
    CASE
      WHEN op.price IS NOT NULL THEN 'outlet'
      WHEN tp.price IS NOT NULL THEN 'tenant'
      ELSE 'variation'
    END AS source,
    ${OUTLET_AT_EXPR} AS at_used
  FROM item_variation iv
  LEFT JOIN LATERAL (
    SELECT price FROM price_history
     WHERE variation_id = iv.id AND outlet_id = $1 AND effective_from <= ${OUTLET_AT_EXPR}
     ORDER BY effective_from DESC, id DESC LIMIT 1
  ) op ON true
  LEFT JOIN LATERAL (
    SELECT price FROM price_history
     WHERE variation_id = iv.id AND outlet_id IS NULL AND effective_from <= ${OUTLET_AT_EXPR}
     ORDER BY effective_from DESC, id DESC LIMIT 1
  ) tp ON true
  WHERE iv.archived_at IS NULL
  ORDER BY iv.id
`;

interface OutletPriceRow {
  variation_id: string;
  price: string;
  source: 'outlet' | 'tenant' | 'variation';
  at_used: string;
}

// null = "sekarang menurut database". Lihat komentar AT_EXPR di atas: memakai
// `new Date()` di sini akan menghidupkan lagi jam kedua yang jadi sumber bug.
function parseAtQuery(at: string | undefined): Date | null {
  if (at === undefined) {
    return null;
  }
  const parsed = new Date(at);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Parameter at harus timestamp ISO 8601 yang valid.');
  }
  return parsed;
}

function translateConstraintError(err: unknown): never {
  if (isPrimaryKeyViolation(err)) {
    throw new HttpError(409, 'ID_ALREADY_EXISTS', 'Baris riwayat harga dengan id ini sudah ada.');
  }
  throw err;
}

async function insertPrice(
  client: PoolClient,
  tenantId: string,
  variationId: string,
  actorId: string,
  input: PriceInput
): Promise<PriceHistoryRow> {
  try {
    const { rows } = await client.query<PriceHistoryRow>(
      `INSERT INTO price_history (id, tenant_id, variation_id, outlet_id, price, effective_from, changed_by, reason)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, now()), $7, $8)
       RETURNING *`,
      [
        input.id,
        tenantId,
        variationId,
        input.outletId ?? null,
        input.price,
        input.effectiveFrom ?? null,
        actorId,
        input.reason ?? null,
      ]
    );
    return rows[0];
  } catch (err) {
    translateConstraintError(err);
  }
}


/**
 * Pernahkah `price` benar-benar berlaku untuk variation ini pada-atau-sebelum
 * `at`?
 *
 * FR-H6, AC kedua: "Selisih akibat harga yang berubah setelah sinkronisasi
 * terakhir **tidak** ditandai."
 *
 * Perangkat yang seminggu offline memakai harga seminggu lalu. Itu bukan
 * anomali — itu justru cara kerja produk ini. Menandainya berarti setiap order
 * dari perangkat itu masuk laporan exception, dan laporan yang penuh hal
 * normal tidak akan dibaca siapa pun.
 *
 * Yang diperiksa adalah SELURUH tangga harga, sama seperti `resolvePrice`:
 * riwayat per outlet, riwayat default tenant, dan `item_variation.price` yang
 * beku. Sebuah harga dianggap dapat menjelaskan selisih bila ia pernah muncul
 * di salah satunya dengan `effective_from <= at`.
 *
 * `effective_from > at` sengaja TIDAK dihitung: harga terjadwal masa depan
 * belum pernah berlaku, jadi tidak ada perangkat yang bisa memakainya secara
 * sah. Klien yang mengirimnya sedang melakukan sesuatu yang lain.
 *
 * Cast `$4::timestamptz` ditulis eksplisit dengan alasan yang sama dengan
 * `AT_EXPR` di atas — `COALESCE` tanpa cast bisa membuat PostgreSQL
 * menyimpulkan tipe parameter yang salah secara diam-diam. Ia tidak memakai
 * `AT_EXPR` itu sendiri karena posisi parameternya berbeda di sini.
 */
export async function wasPriceEverEffective(
  client: PoolClient,
  variationId: string,
  outletId: string,
  price: bigint,
  at: Date | null
): Promise<boolean> {
  const { rows } = await client.query<{ ada: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM price_history
        WHERE variation_id = $1
          AND (outlet_id = $2 OR outlet_id IS NULL)
          AND price = $3
          AND effective_from <= COALESCE($4::timestamptz, now())
     ) OR EXISTS (
       SELECT 1 FROM item_variation WHERE id = $1 AND price = $3
     ) AS ada`,
    [variationId, outletId, price.toString(), at]
  );
  return rows[0].ada;
}

export function createPriceHandlers(pool: Pool) {
  return {
    // Invariant #2 -- SELALU INSERT, tidak pernah UPDATE. Urutan guard di
    // dalam satu withTenantTransaction (PLAN-katalog-harga-riwayat.md §
    // "Endpoint 1"): variation dulu (paling murah untuk gagal cepat kalau
    // itemId/variationId sudah salah), lalu actor, lalu outlet (kalau
    // dikirim) -- baru INSERT setelah ketiganya lolos SELECT yang tunduk
    // RLS. price divalidasi SEBELUM transaksi dibuka (fail fast, sama
    // seperti createItem menolak body.variations kosong sebelum transaksi).
    async createPrice(req: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const { itemId, variationId } = req.params as { itemId: string; variationId: string };
      const body = req.body as PriceInput;
      assertPriceValid(body.price);
      const row = await withTenantTransaction(pool, tenantId, async (client) => {
        await fetchVariationOrThrow(client, itemId, variationId);
        await assertUserVisible(client, actorId);
        // Guard ini BUKAN formalitas. Dibuktikan lewat sabotase (2 Agu 2026):
        // dinonaktifkan, request yang menunjuk outlet tenant lain lolos dengan
        // 201 dan barisnya BENAR-BENAR tersimpan -- bentuk bug FK-bukan-RLS
        // yang sama dengan temuan F1 di CLAUDE.md. FK ke outlet(id) tidak
        // menghentikannya karena FK dicek dengan privilese owner tabel yang
        // direferensikan, di luar FORCE ROW LEVEL SECURITY.
        if (body.outletId !== null && body.outletId !== undefined) {
          await assertOutletVisible(client, body.outletId);
        }
        // ⛔ Harga yang BERLAKU diresolusi SEBELUM baris baru ditulis.
        //
        // Sesudahnya, baris baru itu sendiri yang menang di tangga resolusi —
        // `before` akan sama dengan `after`, dan audit yang menjawab "harganya
        // diubah dari berapa" dengan angka barunya sendiri lebih buruk
        // daripada audit yang tidak menjawab.
        //
        // ⛔ Yang diresolusi harga pada `effective_from` baris BARU, di outlet
        // yang sama — bukan baris `price_history` sebelumnya. Tangga tiga
        // tingkat berarti baris terakhir yang ditulis belum tentu yang sedang
        // berlaku, dan menyebut baris yang salah menghasilkan angka yang tidak
        // pernah dibayar siapa pun.
        //
        // `null` berarti tidak ada harga yang berlaku sebelumnya — sah, dan
        // berbeda dari nol.
        const sebelum = await resolvePrice(
          client,
          variationId,
          body.outletId ?? null,
          body.effectiveFrom === undefined ? null : new Date(body.effectiveFrom)
        ).catch(() => null);

        const baru = await insertPrice(client, tenantId, variationId, actorId, body);
        await catatPerubahanServer(client, {
          tenantId,
          actorUserId: actorId,
          eventType: 'price_changed',
          entityType: 'item_variation',
          entityId: variationId,
          outletId: body.outletId ?? null,
          before: sebelum === null ? null : { price: String(sebelum.price), asal: sebelum.source },
          after: {
            price: String(baru.price),
            effectiveFrom: String(baru.effective_from),
            outletId: baru.outlet_id,
          },
        });
        return baru;
      });
      reply.code(201);
      return toPrice(row);
    },

    async listPrices(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const { itemId, variationId } = req.params as { itemId: string; variationId: string };
      const rows = await withTenantTransaction(pool, tenantId, async (client) => {
        await fetchVariationOrThrow(client, itemId, variationId);
        // `, id DESC` tie-breaker wajib (pelajaran review F1, dicatat di
        // CLAUDE.md): dua baris riwayat harga bisa berbagi effective_from
        // yang sama persis (mis. dua override yang dijadwalkan bersamaan),
        // dan tanpa tie-breaker urutannya arbitrary, tidak stabil antar run.
        const { rows } = await client.query<PriceHistoryRow>(
          'SELECT * FROM price_history WHERE variation_id = $1 ORDER BY effective_from DESC, id DESC',
          [variationId]
        );
        return rows;
      });
      return { items: rows.map(toPrice) };
    },

    // T7+T8: endpoint resolusi. variationId divalidasi lewat
    // fetchVariationOrThrow, outletId (kalau dikirim) lewat
    // assertOutletVisible -- SEBELUM resolvePrice dipanggil, sama seperti
    // createPrice. `at` opsional, default now() lewat parseAtQuery.
    async getResolvedPrice(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const { itemId, variationId } = req.params as { itemId: string; variationId: string };
      const query = req.query as { outletId?: string; at?: string };
      const at = parseAtQuery(query.at);
      const outletId = query.outletId ?? null;
      return withTenantTransaction(pool, tenantId, async (client) => {
        await fetchVariationOrThrow(client, itemId, variationId);
        if (outletId !== null) {
          await assertOutletVisible(client, outletId);
        }
        return resolvePrice(client, variationId, outletId, at);
      });
    },

    // T10: harga efektif seluruh item_variation aktif tenant, diselesaikan
    // untuk SATU outlet, dalam satu query (OUTLET_PRICES_SQL, LEFT JOIN
    // LATERAL) -- bukan N+1 per variation. Dibutuhkan klien POS saat sinkron
    // turun (PLAN §"Yang dibangun" T10).
    async listOutletPrices(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const { outletId } = req.params as { outletId: string };
      const query = req.query as { at?: string };
      const at = parseAtQuery(query.at);
      const atParam = at === null ? null : at.toISOString();
      const rows = await withTenantTransaction(pool, tenantId, async (client) => {
        await assertOutletVisible(client, outletId);
        const { rows } = await client.query<OutletPriceRow>(OUTLET_PRICES_SQL, [outletId, atParam]);
        return rows;
      });
      // Katalog kosong tetap harus melaporkan `at` yang dipakai, dan nilainya
      // tidak bisa dibaca dari baris yang tidak ada. Fallback ke parameter
      // klien; kalau klien juga tidak mengirimnya, `at` null dan itu jujur --
      // lebih baik daripada mengarang stempel waktu dari jam aplikasi.
      const atUsed = rows.length > 0 ? new Date(rows[0].at_used).toISOString() : atParam;
      return {
        items: rows.map((row) => ({
          variationId: row.variation_id,
          price: Number(row.price),
          source: row.source,
          outletId,
          at: atUsed,
        })),
      };
    },
  };
}
