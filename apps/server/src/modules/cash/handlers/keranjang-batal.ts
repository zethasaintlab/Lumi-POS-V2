import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from '../../../db.ts';
import { withTenantTransaction } from '../../../db.ts';
import { HttpError } from '../../../http-error.ts';
import { getTenantId, getActorId } from '../../../tenant-context.ts';
import { assertUserVisible, assertBoleh } from '../../identity/index.ts';
import { recordAuditEvent } from '../../audit/index.ts';
import {
  findIdempotencyKey,
  claimIdempotencyKey,
  completeIdempotencyKey,
  insertOutboxEvent,
  IdempotencyKeyConflictError,
} from '../../sync/index.ts';
import { EVENT_KERANJANG_DIBATALKAN } from '../../../../../../packages/domain/src/keranjang-batal.ts';
import type { Hlc } from '../../../../../../packages/domain/src/hlc.ts';
import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * `POST /shifts/{shiftId}/cart-cleared` — jejak audit Batalkan keranjang.
 *
 * Keputusan user 28 September 2026 (issue #76): pembatalan keranjang sesudah
 * barang di-scan adalah pola kecurangan kasir — pelanggan membayar tunai,
 * keranjang dibatalkan, uangnya tidak tercatat. Keranjang bukan `order`; yang
 * ditulis di sini hanya PERISTIWA-nya.
 *
 * ## ⛔ Fakta lampau, bukan perintah
 *
 * Shift yang sudah `closed` tetap diterima (pola `count_attempt`): relay yang
 * antreannya baru terkuras tidak boleh membuang jejak justru pada perangkat
 * yang paling lama offline. `total` dicatat SEBAGAIMANA DILAPORKAN perangkat —
 * server tidak pernah melihat keranjangnya, jadi tidak ada yang dapat
 * dihitung ulang.
 *
 * ## ⛔ TIDAK menulis `order`, `payment`, maupun `cash_movement`
 *
 * Tidak ada uang yang berpindah. Jejak yang dijaga: satu `audit_event`.
 *
 * ## Idempotensi
 *
 * Pola no-sale: key di-claim, event ditulis, key di-complete. Respons yang
 * hilang lalu dikirim ulang mengembalikan respons asli, bukan baris kedua.
 */

interface Masukan {
  id?: unknown;
  lineCount?: unknown;
  quantityMilli?: unknown;
  total?: unknown;
  occurredAt?: unknown;
  hlc?: unknown;
}

/**
 * ⛔ ISO 8601 BERZONA dan tanggal NYATA. `Date.parse` menggulirkan
 * `2026-02-30` ke 2 Maret dan menafsirkan timestamp tanpa zona sebagai zona
 * server — keduanya mengubah `occurred_at` audit tanpa error.
 */
export function timestampSah(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.exec(v);
  if (!m) return false;
  const [y, mo, d, h, mi] = [m[1], m[2], m[3], m[4], m[5]].map(Number);
  if (h > 23 || mi > 59 || (m[6] !== undefined && Number(m[6]) > 59)) return false;
  const hari = new Date(Date.UTC(y, mo - 1, d));
  if (hari.getUTCFullYear() !== y || hari.getUTCMonth() !== mo - 1 || hari.getUTCDate() !== d) return false;
  return !Number.isNaN(Date.parse(v));
}

const bulatPositif = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 1;

export function createCartClearedHandlers(pool: Pool, hlc: Hlc): Record<string, unknown> {
  return {
    async recordCartCleared(req: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const { shiftId } = req.params as { shiftId: string };
      const body = (req.body ?? {}) as Masukan;

      const idempotencyKey = req.headers['idempotency-key'];
      if (typeof idempotencyKey !== 'string' || idempotencyKey.trim() === '') {
        throw new HttpError(400, 'MISSING_IDEMPOTENCY_KEY', 'Header Idempotency-Key wajib.');
      }
      if (typeof body.id !== 'string' || body.id.trim() === '') {
        throw new HttpError(400, 'VALIDATION_ERROR', 'id wajib diisi klien (ULID/UUIDv7).');
      }
      if (!bulatPositif(body.lineCount)) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'lineCount harus bilangan bulat >= 1.');
      }
      if (!bulatPositif(body.quantityMilli)) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'quantityMilli harus bilangan bulat >= 1.');
      }
      // ⛔ Uang sebagai STRING, konvensi yang sama dengan kas manual: number
      // kehilangan presisi di atas 2^53 sebelum sampai ke sini.
      if (typeof body.total !== 'string' || !/^\d+$/.test(body.total)) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'total harus string bilangan bulat tanpa tanda.');
      }
      if (body.hlc !== undefined && body.hlc !== null && !(typeof body.hlc === 'string' && /^\d+$/.test(body.hlc))) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'hlc harus string bilangan bulat.');
      }
      // ⛔ `occurredAt` rusak dijawab 400, bukan 500 dari `timestamptz`.
      if (body.occurredAt !== undefined && body.occurredAt !== null && !timestampSah(body.occurredAt)) {
        throw new HttpError(
          400,
          'VALIDATION_ERROR',
          'occurredAt harus timestamp ISO 8601 bertanggal nyata dan berzona (mis. 2026-09-28T03:00:00Z).'
        );
      }
      // ⛔ Hash SELURUH isi yang bermakna, bukan hanya id: key yang sama dengan
      // isi berbeda adalah bug klien, dan menjawabnya dengan respons pertama
      // membuat pembatalan kedua hilang tanpa error (pola `orders.ts`).
      const requestHash = createHash('sha256')
        .update(
          JSON.stringify([
            shiftId,
            body.id,
            body.lineCount,
            body.quantityMilli,
            body.total,
            body.occurredAt ?? null,
          ])
        )
        .digest('hex');
      const hlcValue =
        typeof body.hlc === 'string' ? hlc.update(BigInt(body.hlc)) : hlc.tick();

      const hasil = await withTenantTransaction(pool, tenantId, async (client) => {
        const cached = await findIdempotencyKey(client, idempotencyKey);
        if (cached !== null) {
          if (cached.requestHash !== requestHash) {
            throw new HttpError(
              422,
              'IDEMPOTENCY_KEY_HASH_MISMATCH',
              `Idempotency-Key ${idempotencyKey} sudah dipakai untuk request dengan body yang berbeda.`
            );
          }
          if (cached.completed) return { kind: 'cached' as const, record: cached };
        }
        await assertUserVisible(client, actorId);
        // ⛔ Dijaga di sini, bukan lewat `PETA_PERAN` (lihat `DIKECUALIKAN`):
        // kasir memang boleh, akuntan tidak (`spec-f:82`).
        await assertBoleh(client, actorId, 'shift_open_close', 'mencatat pembatalan keranjang');

        // FK klien-suplai ke tabel ber-`tenant_id` (temuan F1): `shiftId`
        // datang dari path dan FK tidak tunduk RLS.
        const { rows } = await client.query<{ outlet_id: string; device_id: string | null }>(
          'SELECT outlet_id, device_id FROM cash_drawer_shift WHERE id = $1',
          [shiftId]
        );
        if (rows.length === 0) {
          throw new HttpError(404, 'SHIFT_NOT_FOUND', `Shift ${shiftId} tidak ditemukan.`);
        }

        try {
          await claimIdempotencyKey(client, { key: idempotencyKey, tenantId, requestHash });
        } catch (err) {
          if (err instanceof IdempotencyKeyConflictError) {
            throw new HttpError(
              409,
              'IDEMPOTENCY_KEY_CONFLICT',
              `Request dengan Idempotency-Key ${idempotencyKey} sedang diproses request lain, coba lagi.`
            );
          }
          throw err;
        }

        await recordAuditEvent(client, {
          id: body.id as string,
          tenantId,
          outletId: rows[0].outlet_id,
          deviceId: rows[0].device_id,
          actorUserId: actorId,
          approverUserId: null,
          eventType: EVENT_KERANJANG_DIBATALKAN,
          entityType: 'cash_drawer_shift',
          entityId: shiftId,
          reasonCode: null,
          reasonNote: null,
          // ⛔ `total` tetap STRING di jsonb.
          after: {
            line_count: body.lineCount,
            quantity_milli: body.quantityMilli,
            total: body.total,
          },
          hlc: hlcValue,
          occurredAt: typeof body.occurredAt === 'string' ? body.occurredAt : null,
        });

        await insertOutboxEvent(client, {
          id: randomUUID(),
          tenantId,
          aggregateType: 'cash_drawer_shift',
          aggregateId: shiftId,
          eventType: 'cash_drawer.cart_cleared',
          payload: { shiftId, auditId: body.id, total: body.total },
        });

        const jawab = { id: body.id as string, shiftId };
        await completeIdempotencyKey(client, {
          key: idempotencyKey,
          responseStatus: 201,
          responseBody: jawab,
        });
        return { kind: 'fresh' as const, jawab };
      });

      if (hasil.kind === 'cached') {
        reply.code(hasil.record.responseStatus ?? 200);
        return hasil.record.responseBody;
      }
      reply.code(201);
      return hasil.jawab;
    },
  };
}
