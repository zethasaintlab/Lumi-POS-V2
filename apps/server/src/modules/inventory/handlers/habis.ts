import { randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from '../../../db.ts';
import { withTenantTransaction } from '../../../db.ts';
import { HttpError } from '../../../http-error.ts';
import { getActorId, getTenantId } from '../../../tenant-context.ts';
import { catatPerubahanServer } from '../../audit/index.ts';
import type { Hlc } from '../../../../../../packages/domain/src/hlc.ts';
import { assertUserVisible } from '../../identity/index.ts';
import { assertOutletVisible } from '../../tenancy/index.ts';
import {
  findIdempotencyKey,
  claimIdempotencyKey,
  completeIdempotencyKey,
  IdempotencyKeyConflictError,
} from '../../sync/index.ts';

/**
 * `POST /inventory/sold-out` — FR-E5, penandaan habis MANUAL.
 *
 * `spec-e:203`: *"Barista tahu kopi habis sebelum sistem tahu. Alur ini lebih
 * andal daripada hitungan otomatis dan wajib ada."*
 *
 * ## ⛔ Kenapa endpoint ini akhirnya dibangun
 *
 * Penandaan sudah berjalan di perangkat sejak F3, tapi **lokal saja** —
 * `apps/kasir/src/inventori/sold-out.ts` mencatat alasannya: meng-enqueue item
 * yang tidak punya rute akan membakar hitungan percobaannya sampai `failed`
 * permanen. Akibatnya kasir di terminal 2 tetap menerima pesanan kopi yang
 * barista di terminal 1 sudah tandai habis lima menit lalu.
 *
 * Endpoint ini menutup jalur naiknya; jalur turunnya sudah ada
 * (`sold_out_flag` adalah raw table yang direplikasi PowerSync).
 *
 * ## ⛔ Jalur PERANGKAT, bukan back-office
 *
 * Ia dipanggil relay outbox, yang tidak mengirim `Authorization` sama sekali
 * (`sesi.ts`). Karena itu ia terdaftar di `RUTE_TERBUKA` bersama `/orders` dan
 * `/shifts` — melindunginya dengan sesi berarti setiap penandaan habis yang
 * menyusul dijawab 401.
 *
 * ## ⛔ Tabel LOG, dan servernya tidak boleh menyimpulkan apa pun
 *
 * Tidak ada satu baris per produk, dan tidak ada `UPDATE`. Dua perangkat yang
 * menandai produk yang sama saat offline sama-sama menulis, dan yang menang
 * ditentukan **HLC** — bukan baris yang kebetulan tiba belakangan. Server
 * karena itu hanya menyisipkan; siapa yang menang dijawab saat DIBACA, oleh
 * kode yang sama bentuknya di kedua sisi.
 *
 * ⛔ Penandaan habis TIDAK pernah menyimpulkan stok, dan stok tidak pernah
 * menyimpulkan penandaan (`spec-e:220`). Endpoint ini karena itu tidak
 * menyentuh `stock_movement` sama sekali.
 */

interface Badan {
  id?: string;
  outletId?: string;
  variationId?: string;
  isSoldOut?: boolean;
  /** HLC perangkat, string desimal. Klien yang tidak mengirimnya memakai jam server. */
  hlc?: string;
  /** Waktu perangkat. Klien yang tidak mengirimnya memakai jam database. */
  occurredAt?: string;
}

const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
function bacaIdempotencyKey(req: FastifyRequest): string {
  const header = req.headers['idempotency-key'];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value || value.length === 0 || value.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new HttpError(400, 'MISSING_IDEMPOTENCY_KEY', 'Header Idempotency-Key wajib diisi.');
  }
  return value;
}

/**
 * ⛔ `variation_id` TIDAK punya FK di `sold_out_flag` — `text NOT NULL` tanpa
 * referensi, sama seperti `stock_movement.variation_id`. Tidak ada apa pun di
 * database yang menolak id karangan, apalagi id milik tenant lain. SELECT yang
 * tunduk RLS ini satu-satunya yang berdiri di sana.
 */
async function assertVariationVisible(client: PoolClient, variationId: string): Promise<void> {
  const { rows } = await client.query('SELECT id FROM item_variation WHERE id = $1', [variationId]);
  if (rows.length === 0) {
    throw new HttpError(404, 'VARIATION_NOT_FOUND', `Variation ${variationId} tidak ditemukan.`);
  }
}

export function createSoldOutHandlers(pool: Pool, hlc: Hlc): Record<string, unknown> {
  return {
    async markSoldOut(req: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const idempotencyKey = bacaIdempotencyKey(req);
      const body = (req.body ?? {}) as Badan;

      if (typeof body.outletId !== 'string' || body.outletId === '') {
        throw new HttpError(400, 'VALIDATION_ERROR', 'outletId wajib diisi.');
      }
      if (typeof body.variationId !== 'string' || body.variationId === '') {
        throw new HttpError(400, 'VALIDATION_ERROR', 'variationId wajib diisi.');
      }
      if (typeof body.isSoldOut !== 'boolean') {
        throw new HttpError(
          400,
          'VALIDATION_ERROR',
          'isSoldOut wajib boolean. Membatalkan penandaan adalah baris tersendiri bernilai false, ' +
            'bukan penghapusan — penanda terbaru yang menang.'
        );
      }

      // ⛔ HLC dari PERANGKAT, di-`update` bukan di-`tick`. Klien mengirim
      // jamnya sendiri, dan `update` menjaga monotonisitas per perangkat
      // (I10) sekaligus menyerap jam yang lebih maju. Klien yang tidak
      // mengirimnya memakai jam kita — pola yang sama dengan `createOrder`.
      let hlcValue: bigint;
      if (body.hlc === undefined) {
        hlcValue = hlc.tick();
      } else {
        try {
          hlcValue = hlc.update(BigInt(body.hlc));
        } catch {
          throw new HttpError(400, 'VALIDATION_ERROR', 'hlc harus string bilangan bulat desimal.');
        }
      }

      const id = typeof body.id === 'string' && body.id !== '' ? body.id : randomUUID();

      const hasil = await withTenantTransaction(pool, tenantId, async (client) => {
        const existing = await findIdempotencyKey(client, idempotencyKey);
        if (existing !== null && existing.completed) {
          return { kind: 'cached' as const, record: existing };
        }
        if (existing === null) {
          await claimIdempotencyKey(client, {
            key: idempotencyKey,
            tenantId,
            requestHash: `${id}:${body.variationId}:${String(body.isSoldOut)}`,
          });
        }

        // `set_by` adalah `text NOT NULL` tanpa FK — kelas yang sama dengan
        // `price_history.changed_by`. Divalidasi lewat SELECT yang tunduk RLS.
        await assertUserVisible(client, actorId);
        await assertOutletVisible(client, body.outletId as string);
        await assertVariationVisible(client, body.variationId as string);

        // ⛔ `ON CONFLICT DO NOTHING` pada PK, bukan `UPDATE`. Retry mengirim
        // baris yang SAMA dengan id yang sama; menimpanya berarti server
        // menulis ulang penanda yang mungkin sudah kalah dari penanda
        // perangkat lain yang tiba di antaranya.
        await client.query(
          `INSERT INTO sold_out_flag
             (id, tenant_id, outlet_id, variation_id, is_sold_out, set_by, set_at, hlc)
           VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, now()), $8)
           ON CONFLICT (id) DO NOTHING`,
          [
            id,
            tenantId,
            body.outletId,
            body.variationId,
            body.isSoldOut,
            actorId,
            body.occurredAt ?? null,
            hlcValue.toString(),
          ]
        );

        // FR-F6 + `spec-f:296` (`sold_out_toggled`).
        //
        // ⛔ Ditulis di dalam transaksi yang sama, SESUDAH INSERT — dan tetap
        // ditulis meski `ON CONFLICT DO NOTHING` tidak menyisipkan apa pun.
        // Barisnya tidak disisipkan hanya pada RETRY dengan id yang sama, dan
        // retry sudah dijaga kunci idempotensi di atas: jalur ini hanya
        // tercapai untuk klaim yang belum selesai.
        //
        // ⛔ `isSoldOut` DAN arahnya. Penandaan habis terpisah dari stok
        // terhitung dan keduanya tidak pernah saling menyimpulkan
        // (`spec-e:220`); audit yang hanya mencatat "ditandai" tidak dapat
        // membedakan menandai habis dari membatalkannya.
        await catatPerubahanServer(client, {
          tenantId,
          actorUserId: actorId,
          eventType: 'sold_out_toggled',
          entityType: 'item_variation',
          entityId: body.variationId as string,
          outletId: body.outletId as string,
          after: { flagId: id, isSoldOut: body.isSoldOut, hlc: hlcValue.toString() },
        });

        const responseBody = {
          id,
          outletId: body.outletId,
          variationId: body.variationId,
          isSoldOut: body.isSoldOut,
          hlc: hlcValue.toString(),
        };
        await completeIdempotencyKey(client, {
          key: idempotencyKey,
          responseStatus: 201,
          responseBody,
        });
        return { kind: 'fresh' as const, responseBody };
      }).catch((err) => {
        if (err instanceof IdempotencyKeyConflictError) {
          throw new HttpError(
            409,
            'IDEMPOTENCY_KEY_CONFLICT',
            'Permintaan dengan key ini sedang diproses. Coba lagi.'
          );
        }
        throw err;
      });

      if (hasil.kind === 'cached') {
        reply.code(hasil.record.responseStatus);
        return hasil.record.responseBody;
      }
      reply.code(201);
      return hasil.responseBody;
    },
  };
}
