import type { PoolClient } from '../../db.ts';

// Permukaan publik modul sync (apps/server/src/modules/README.md --
// kepemilikan tabel DITEGAKKAN: idempotency_key, outbox). Modul ordering
// DILARANG query kedua tabel ini langsung (invariant #4, CLAUDE.md) -- T10-
// T13 (docs/superpowers/plans/PLAN-ordering-fondasi.md) adalah pemakai
// pertama.
//
// Semua fungsi di sini menerima `client` dari TRANSAKSI PEMANGGIL
// (withTenantTransaction) -- BUKAN `pool` -- karena baris idempotency_key
// dan outbox harus ditulis DALAM transaksi yang sama dengan penjualan
// (spec-b:350, invariant #1 CLAUDE.md). Terpisah = ada jendela di mana
// penjualan tercatat tapi key/outbox belum, dan retry menghasilkan duplikat.

export interface IdempotencyRecord {
  requestHash: string;
  responseStatus: number;
  responseBody: unknown;
}

interface IdempotencyKeyRow {
  request_hash: string;
  response_status: number | null;
  response_body: unknown;
}

// T10 (spec-b:333-348) -- SELECT tunduk RLS lewat `client` transaksi
// pemanggil. Dipakai SEBAGAI PENENTU cache-hit/hash-mismatch, TAPI BUKAN
// satu-satunya penjaga duplikasi konkuren -- itu tugas unique constraint PK
// `idempotency_key.key`, ditegakkan lewat insertIdempotencyKey di bawah.
// Pre-check SELECT di sini murni untuk jalur cepat "request identik yang
// SUDAH commit sebelumnya" (retry sekuensial); dua transaksi yang BENAR-BENAR
// bersamaan sama-sama bisa melihat "tidak ada" di sini (READ COMMITTED) --
// itu ditangani, bukan diabaikan, lewat unique violation di INSERT (T11).
export async function findIdempotencyKey(client: PoolClient, key: string): Promise<IdempotencyRecord | null> {
  const { rows } = await client.query<IdempotencyKeyRow>(
    'SELECT request_hash, response_status, response_body FROM idempotency_key WHERE key = $1',
    [key]
  );
  if (rows.length === 0) {
    return null;
  }
  return {
    requestHash: rows[0].request_hash,
    responseStatus: rows[0].response_status ?? 200,
    responseBody: rows[0].response_body,
  };
}

// Dilempar saat dua transaksi bersamaan mencoba menulis idempotency_key
// dengan `key` yang sama (T11): transaksi kedua memblokir di unique index
// PRIMARY KEY sampai transaksi pertama commit, lalu kena unique violation di
// sini. Nama constraint Postgres ('idempotency_key_pkey') SENGAJA tidak
// bocor keluar modul ini -- modul ordering (pemanggil) tidak berwenang tahu
// detail tabel yang bukan miliknya (invariant #4); ia hanya menerjemahkan
// error bertipe ini jadi HttpError 409 dengan instruksi retry.
export class IdempotencyKeyConflictError extends Error {
  constructor(key: string) {
    super(`Idempotency-Key ${key} sedang diproses oleh request lain.`);
    this.name = 'IdempotencyKeyConflictError';
  }
}

function isIdempotencyKeyPkeyViolation(err: unknown): boolean {
  const pgErr = err as { code?: string; constraint?: string };
  return pgErr.code === '23505' && pgErr.constraint === 'idempotency_key_pkey';
}

export interface ClaimIdempotencyKeyParams {
  key: string;
  tenantId: string;
  requestHash: string;
}

// T11 -- KENAPA "klaim lalu lengkapi" (INSERT placeholder duluan, UPDATE
// belakangan) dan BUKAN satu INSERT di akhir setelah order/check/line/
// modifier ditulis: order/check/order_line/order_line_modifier PUNYA id
// client-generated sendiri (ULID/UUIDv7, CLAUDE.md) yang SAMA PERSIS pada
// setiap retry -- kalau idempotency_key baru di-INSERT PALING AKHIR, dua
// transaksi bersamaan dengan body identik akan lebih dulu BALAPAN di
// order_pkey (keduanya mencoba menulis order dengan id yang sama) dan yang
// kalah akan menerima 409 ID_ALREADY_EXISTS -- BUKAN 409 idempotency dengan
// instruksi retry yang diminta AC (spec-b:341-343). Dengan mengklaim
// idempotency_key LEBIH DULU, transaksi kedua diblokir DI SINI, SEBELUM
// pernah menyentuh order/check/line sama sekali -- order_pkey tidak pernah
// jadi titik balapan untuk retry yang identik.
//
// `response_status`/`response_body` NULL di klaim ini -- diisi
// completeIdempotencyKey di bawah SETELAH order berhasil ditulis, MASIH di
// transaksi yang sama. Baris yang bisa dibaca transaksi LAIN hanya baris
// yang sudah COMMIT, dan commit hanya terjadi setelah completeIdempotencyKey
// dipanggil -- jadi tidak ada pengamat luar yang pernah melihat baris
// dengan response_status/response_body NULL.
//
// Retensi 30 hari (bukan 24 jam norma industri) -- keputusan sadar
// (spec-b:329, db/migrations/0013_server_only.sql komentar retensi):
// perangkat kasir offline-first bisa mati lebih lama dari 24 jam. Dihitung
// DI SQL (`now() + interval`), BUKAN `new Date()` di Node -- pola sama
// dengan AT_EXPR di catalog/handlers/prices.ts.
export async function claimIdempotencyKey(client: PoolClient, params: ClaimIdempotencyKeyParams): Promise<void> {
  try {
    await client.query(
      `INSERT INTO idempotency_key (key, tenant_id, request_hash, response_status, response_body, expires_at)
       VALUES ($1, $2, $3, NULL, NULL, now() + interval '30 days')`,
      [params.key, params.tenantId, params.requestHash]
    );
  } catch (err) {
    if (isIdempotencyKeyPkeyViolation(err)) {
      throw new IdempotencyKeyConflictError(params.key);
    }
    throw err;
  }
}

export interface CompleteIdempotencyKeyParams {
  key: string;
  responseStatus: number;
  responseBody: unknown;
}

// `responseBody` dioper lewat JSON.stringify ke kolom jsonb -- pola sama
// dengan modifier_snapshot di ordering/handlers/orders.ts (node-postgres
// menyerialisasi array/objek JS lewat encoding literal Postgres untuk
// parameter Array/Object, bukan JSON; JSON.stringify eksplisit menghindari
// itu).
export async function completeIdempotencyKey(client: PoolClient, params: CompleteIdempotencyKeyParams): Promise<void> {
  await client.query(
    'UPDATE idempotency_key SET response_status = $2, response_body = $3 WHERE key = $1',
    [params.key, params.responseStatus, JSON.stringify(params.responseBody)]
  );
}

export interface InsertOutboxEventParams {
  id: string;
  tenantId: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: unknown;
}

// T13 (FR-B2) -- satu baris ditulis DALAM transaksi yang sama dengan
// penjualan (transactional outbox). `published_at` NULL sengaja: worker
// pengirim adalah F2 (§4 non-scope PLAN-ordering-fondasi.md), TIDAK
// dibangun di sub-project ini.
export async function insertOutboxEvent(client: PoolClient, params: InsertOutboxEventParams): Promise<void> {
  await client.query(
    `INSERT INTO outbox (id, tenant_id, aggregate_type, aggregate_id, event_type, payload, published_at)
     VALUES ($1, $2, $3, $4, $5, $6, NULL)`,
    [params.id, params.tenantId, params.aggregateType, params.aggregateId, params.eventType, JSON.stringify(params.payload)]
  );
}
