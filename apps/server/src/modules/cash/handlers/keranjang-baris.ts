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
import { EVENT_BARIS_DIKURANGI } from '../../../../../../packages/domain/src/keranjang-baris.ts';
import type { Hlc } from '../../../../../../packages/domain/src/hlc.ts';
import { timestampSah } from './keranjang-batal.ts';
import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * `POST /shifts/{shiftId}/cart-line-reduced` — jejak audit penurunan qty /
 * penghapusan satu baris keranjang (Edit Item).
 *
 * Keputusan user 28 September 2026 (issue #76, Q2): kalau Batalkan tercatat
 * tapi menghapus baris satu per satu tidak, kecurangannya cuma pindah cara.
 *
 * ## Kenapa rute SAUDARA, bukan berbagi `cart-cleared`
 *
 * Muatannya berbeda bentuk (satu baris: item, qty sebelum/sesudah, harga;
 * bukan ringkasan keranjang). Satu rute untuk dua bentuk berarti validasi dan
 * hash bersyarat — tempat cacat idempotensi bersembunyi. Keduanya satu
 * KELUARGA: kelompok `transaksi`, pola handler identik (ikut `cart-cleared`).
 *
 * ## ⛔ Fakta lampau, bukan perintah
 *
 * Shift `closed` tetap diterima (pola `count_attempt`). Angka dicatat
 * SEBAGAIMANA DILAPORKAN perangkat (qty, harga) — server tidak pernah melihat keranjangnya.
 * Satu pengecualian: nilai berkurang DIHITUNG ULANG (bagian berikutnya).
 *
 * ## ⛔ `reducedValue` DIHITUNG ULANG (terima, tandai, laporkan)
 *
 * Server memegang seluruh masukannya: `unitPrice × (sebelum − sesudah) / 1000`
 * dalam bigint. Nilai server-lah yang disimpan sebagai `reduced_value`. Bila
 * nilai klien berbeda, peristiwa TETAP diterima (pola `calculation_variance`,
 * `spec-h:93`, `orders.ts`), `after` memuat `reduced_value_client` dan
 * `variance_amount`, dan satu audit `calculation_variance` terpisah ditulis.
 *
 * ## ⛔ TIDAK menulis `order`, `payment`, maupun `cash_movement`.
 */

interface Masukan {
  id?: unknown;
  variationId?: unknown;
  itemName?: unknown;
  variationName?: unknown;
  quantityBeforeMilli?: unknown;
  quantityAfterMilli?: unknown;
  unitPrice?: unknown;
  reducedValue?: unknown;
  occurredAt?: unknown;
  hlc?: unknown;
}

const bulat = (v: unknown, min: number): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= min;
const teksIsi = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const uangString = (v: unknown): v is string => typeof v === 'string' && /^\d+$/.test(v);

export function createCartLineReducedHandlers(pool: Pool, hlc: Hlc): Record<string, unknown> {
  return {
    async recordCartLineReduced(req: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const { shiftId } = req.params as { shiftId: string };
      const body = (req.body ?? {}) as Masukan;

      const idempotencyKey = req.headers['idempotency-key'];
      if (typeof idempotencyKey !== 'string' || idempotencyKey.trim() === '') {
        throw new HttpError(400, 'MISSING_IDEMPOTENCY_KEY', 'Header Idempotency-Key wajib.');
      }
      if (!teksIsi(body.id)) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'id wajib diisi klien (ULID/UUIDv7).');
      }
      if (!teksIsi(body.variationId)) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'variationId wajib diisi.');
      }
      if (!teksIsi(body.itemName) || !teksIsi(body.variationName)) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'itemName dan variationName wajib diisi.');
      }
      if (!bulat(body.quantityBeforeMilli, 1)) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'quantityBeforeMilli harus bilangan bulat >= 1.');
      }
      if (!bulat(body.quantityAfterMilli, 0)) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'quantityAfterMilli harus bilangan bulat >= 0.');
      }
      // ⛔ Peristiwa ini adalah PENURUNAN. `sesudah >= sebelum` bukan
      // pengurangan dan tidak boleh tampil sebagai satu di log audit.
      if (body.quantityAfterMilli >= body.quantityBeforeMilli) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'quantityAfterMilli harus lebih kecil dari quantityBeforeMilli.');
      }
      // ⛔ Uang sebagai STRING: number kehilangan presisi di atas 2^53.
      if (!uangString(body.unitPrice) || !uangString(body.reducedValue)) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'unitPrice dan reducedValue harus string bilangan bulat tanpa tanda.');
      }
      if (body.hlc !== undefined && body.hlc !== null && !(typeof body.hlc === 'string' && /^\d+$/.test(body.hlc))) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'hlc harus string bilangan bulat.');
      }
      if (body.occurredAt !== undefined && body.occurredAt !== null && !timestampSah(body.occurredAt)) {
        throw new HttpError(
          400,
          'VALIDATION_ERROR',
          'occurredAt harus timestamp ISO 8601 bertanggal nyata dan berzona (mis. 2026-09-28T03:00:00Z).'
        );
      }
      // ⛔ Hash SELURUH isi yang bermakna (pola `cart-cleared`): key yang sama
      // dengan isi berbeda adalah bug klien, dan menjawabnya dengan respons
      // pertama membuat penurunan kedua hilang tanpa error.
      const requestHash = createHash('sha256')
        .update(
          JSON.stringify([
            shiftId,
            body.id,
            body.variationId,
            body.itemName,
            body.variationName,
            body.quantityBeforeMilli,
            body.quantityAfterMilli,
            body.unitPrice,
            body.reducedValue,
            body.occurredAt ?? null,
          ])
        )
        .digest('hex');
      // Dihitung SEBELUM transaksi (narrowing tipe tidak melewati closure).
      const nilaiServer =
        (BigInt(body.unitPrice) * BigInt(body.quantityBeforeMilli - body.quantityAfterMilli)) / 1000n;
      const klienValue = body.reducedValue;
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
        await assertBoleh(client, actorId, 'shift_open_close', 'mencatat pengurangan baris keranjang');

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

        const selisih = BigInt(klienValue) - nilaiServer;
        const menyimpang = selisih !== 0n;

        await recordAuditEvent(client, {
          id: body.id as string,
          tenantId,
          outletId: rows[0].outlet_id,
          deviceId: rows[0].device_id,
          actorUserId: actorId,
          approverUserId: null,
          eventType: EVENT_BARIS_DIKURANGI,
          entityType: 'cash_drawer_shift',
          entityId: shiftId,
          reasonCode: null,
          reasonNote: null,
          // ⛔ Uang tetap STRING di jsonb.
          after: {
            variation_id: body.variationId,
            item_name: body.itemName,
            variation_name: body.variationName,
            quantity_before_milli: body.quantityBeforeMilli,
            quantity_after_milli: body.quantityAfterMilli,
            unit_price: body.unitPrice,
            reduced_value: nilaiServer.toString(),
            ...(menyimpang
              ? { reduced_value_client: body.reducedValue, variance_amount: selisih.toString() }
              : {}),
          },
          hlc: hlcValue,
          occurredAt: typeof body.occurredAt === 'string' ? body.occurredAt : null,
        });

        if (menyimpang) {
          await recordAuditEvent(client, {
            id: randomUUID(),
            tenantId,
            outletId: rows[0].outlet_id,
            deviceId: rows[0].device_id,
            actorUserId: actorId,
            approverUserId: null,
            eventType: 'calculation_variance',
            entityType: 'cash_drawer_shift',
            entityId: shiftId,
            reasonCode: null,
            reasonNote: null,
            after: {
              source_audit_id: body.id as string,
              client_reduced_value: body.reducedValue,
              server_reduced_value: nilaiServer.toString(),
              variance_amount: selisih.toString(),
            },
            hlc: hlcValue,
            occurredAt: typeof body.occurredAt === 'string' ? body.occurredAt : null,
          });
        }

        await insertOutboxEvent(client, {
          id: randomUUID(),
          tenantId,
          aggregateType: 'cash_drawer_shift',
          aggregateId: shiftId,
          eventType: 'cash_drawer.cart_line_reduced',
          payload: { shiftId, auditId: body.id, reducedValue: nilaiServer.toString() },
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
