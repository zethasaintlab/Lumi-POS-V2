import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from '../../../db.ts';
import { withTenantTransaction } from '../../../db.ts';
import { HttpError } from '../../../http-error.ts';
import { getTenantId, getActorId } from '../../../tenant-context.ts';
import { assertUserVisible, assertApproverVisible, assertBoleh } from '../../identity/index.ts';
import { recordAuditEvent } from '../../audit/index.ts';
import {
  findIdempotencyKey,
  claimIdempotencyKey,
  completeIdempotencyKey,
  insertOutboxEvent,
} from '../../sync/index.ts';
import {
  ALASAN_NO_SALE,
  AMBANG_NO_SALE,
  EVENT_NO_SALE,
  adalahAlasanNoSale,
  butuhPenyetujuNoSale,
} from '../../../../../../packages/domain/src/no-sale.ts';
import type { Hlc } from '../../../../../../packages/domain/src/hlc.ts';
import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * `POST /shifts/{shiftId}/no-sale` — FR-D7.
 *
 * `spec-d:229`: *"Membuka laci tanpa transaksi adalah pola fraud kasir paling
 * dasar."* Yang ditulis di sini adalah **kontrolnya**, bukan perintah ke
 * lacinya — perintah itu efek samping di perangkat, dan perangkat yang tidak
 * punya printer tetap mencatat pembukaannya.
 *
 * ## ⛔ Yang dicatat adalah PERINTAH, bukan bukti laci terbuka
 *
 * `spec-d:231`: sinyal ke laci **satu arah**. Sistem tidak dapat mengetahui
 * apakah laci benar-benar terbuka, dan tidak dapat mendeteksi laci yang
 * dibuka manual dengan kunci. AC FR-D7 ketiga menulisnya persis: *"setiap
 * pembukaan laci **yang diperintahkan sistem** tercatat"*.
 *
 * ## ⛔ Ambang dihitung dari `audit_event`, bukan dari kolom hitungan
 *
 * Tidak ada `cash_drawer_shift.no_sale_count`, dan sengaja: kolom hitungan
 * adalah angka kedua yang harus dijaga sepakat dengan jejak audit, dan yang
 * menyimpang di antaranya tidak dapat diputuskan mana yang benar. Jejaknya
 * sendiri yang dihitung — itu juga yang laporan exception FR-G5 baca.
 *
 * ## ⛔ TIDAK menulis `cash_movement`
 *
 * No-sale tidak memindahkan uang. Menuliskannya sebagai movement bernilai nol
 * akan membuat buku kas — satu-satunya definisi saldo laci (`spec-d:14`) —
 * memuat baris yang tidak menjelaskan apa pun, dan setiap laporan yang
 * menghitung "berapa kali laci bergerak" akan salah.
 *
 * ## Idempotensi
 *
 * Pola yang sama dengan penjualan: key di-*claim* lebih dulu, event ditulis,
 * lalu key di-*complete*. Perangkat offline yang mengirim ulang tidak
 * menghasilkan pembukaan kedua — dan kalau ia menghasilkan, ambang PIN akan
 * bergeser karena retry, bukan karena kasir.
 */

interface NoSaleInput {
  id: string;
  reasonCode?: unknown;
  reasonNote?: unknown;
  hlc?: unknown;
  occurredAt?: unknown;
}

interface ShiftRow {
  id: string;
  outlet_id: string;
  device_id: string;
  status: string;
}

/** Berapa kali laci sudah dibuka lewat no-sale dalam shift ini. */
export async function hitungNoSale(client: PoolClient, shiftId: string): Promise<number> {
  const { rows } = await client.query<{ n: string }>(
    `SELECT count(*)::text AS n
       FROM audit_event
      WHERE event_type = $1 AND entity_type = 'cash_drawer_shift' AND entity_id = $2`,
    [EVENT_NO_SALE, shiftId]
  );
  return Number(rows[0]?.n ?? '0');
}

export function createNoSaleHandlers(pool: Pool, hlc: Hlc): Record<string, unknown> {
  return {
    async recordNoSale(req: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const { shiftId } = req.params as { shiftId: string };
      const body = req.body as NoSaleInput;
      const approverId = req.headers['x-approver-id'];

      const idempotencyKey = req.headers['idempotency-key'];
      if (typeof idempotencyKey !== 'string' || idempotencyKey.trim() === '') {
        throw new HttpError(400, 'MISSING_IDEMPOTENCY_KEY', 'Header Idempotency-Key wajib.');
      }

      // ⛔ Daftar TERTUTUP, dan pesannya MENYEBUT pilihannya. Free text tidak
      // dapat diagregasi jadi laporan fraud, dan itu seluruh gunanya
      // (`spec-f:378`).
      if (!adalahAlasanNoSale(body.reasonCode)) {
        throw new HttpError(
          400,
          'VALIDATION_ERROR',
          `reasonCode harus salah satu dari: ${ALASAN_NO_SALE.join(', ')}.`
        );
      }
      const reasonNote = typeof body.reasonNote === 'string' ? body.reasonNote : null;
      if (typeof body.id !== 'string' || body.id.trim() === '') {
        throw new HttpError(400, 'VALIDATION_ERROR', 'id wajib diisi klien (ULID/UUIDv7).');
      }

      const hlcValue = body.hlc === undefined ? hlc.tick() : hlc.update(BigInt(body.hlc as string));

      const hasil = await withTenantTransaction(pool, tenantId, async (client) => {
        const cached = await findIdempotencyKey(client, idempotencyKey);
        if (cached !== null && cached.completed) {
          return { kind: 'cached' as const, record: cached };
        }
        await assertUserVisible(client, actorId);
        // ⛔ Dijaga DI SINI, bukan lewat `PETA_PERAN` — lihat alasannya di
        // `DIKECUALIKAN` (`apps/server/src/rbac-rute.ts`). Yang ditutup di
        // sini adalah akuntan (`spec-f:82`: "tidak dapat melakukan mutasi apa
        // pun"); kasir memang boleh, dan yang menjaganya adalah ambang
        // frekuensi di bawah.
        await assertBoleh(client, actorId, 'shift_open_close', 'membuka laci tanpa transaksi');

        // FK klien-suplai ke tabel ber-`tenant_id` (temuan F1): `shiftId`
        // datang dari body/params dan FK tidak tunduk RLS.
        const { rows } = await client.query<ShiftRow>(
          'SELECT id, outlet_id, device_id, status FROM cash_drawer_shift WHERE id = $1',
          [shiftId]
        );
        if (rows.length === 0) {
          throw new HttpError(404, 'SHIFT_NOT_FOUND', `Shift ${shiftId} tidak ditemukan.`);
        }
        const shift = rows[0];
        // ⛔ Shift yang sudah ditutup tidak menerima no-sale. Membukanya
        // setelah kas dihitung berarti selisih yang sudah disetujui manajer
        // tidak lagi menjelaskan isi laci.
        if (shift.status !== 'open') {
          throw new HttpError(
            409,
            'SHIFT_NOT_OPEN',
            `Shift ${shiftId} sudah ${shift.status}; laci tidak dapat dibuka lewat no-sale.`
          );
        }

        const sudah = await hitungNoSale(client, shiftId);
        const butuh = butuhPenyetujuNoSale(sudah);
        if (butuh && (typeof approverId !== 'string' || approverId.trim() === '')) {
          throw new HttpError(
            403,
            'APPROVAL_REQUIRED',
            `Pembukaan ke-${sudah + 1} dalam shift ini menuntut otorisasi manajer ` +
              `(ambang ${AMBANG_NO_SALE}× per shift).`
          );
        }
        const penyetuju = butuh ? (approverId as string) : null;
        if (penyetuju !== null) {
          // Pesannya dibedakan dari `USER_NOT_FOUND` milik aktor — manajer
          // yang penyetujuannya ditolak tidak boleh diberi tahu bahwa
          // KASIR-nya yang tidak ditemukan (pelajaran refund, 7 Agu 2026).
          await assertApproverVisible(client, penyetuju);
        }

        await claimIdempotencyKey(client, {
          key: idempotencyKey,
          tenantId,
          requestHash: `${shiftId}:${body.id}`,
        });

        await recordAuditEvent(client, {
          id: body.id,
          tenantId,
          outletId: shift.outlet_id,
          deviceId: shift.device_id,
          actorUserId: actorId,
          approverUserId: penyetuju,
          eventType: EVENT_NO_SALE,
          entityType: 'cash_drawer_shift',
          entityId: shiftId,
          reasonCode: body.reasonCode as string,
          reasonNote,
          // `after` membawa urutannya supaya laporan exception dapat
          // menampilkan "ke-4 dari shift" tanpa menghitung ulang.
          after: { urutan: sudah + 1, ambang: AMBANG_NO_SALE },
          hlc: hlcValue,
          occurredAt: typeof body.occurredAt === 'string' ? body.occurredAt : null,
        });

        await insertOutboxEvent(client, {
          id: randomUUID(),
          tenantId,
          aggregateType: 'cash_drawer_shift',
          aggregateId: shiftId,
          eventType: 'cash_drawer.no_sale',
          payload: { shiftId, reasonCode: body.reasonCode, urutan: sudah + 1 },
        });

        const jawab = { id: body.id, shiftId, urutan: sudah + 1, butuhPenyetuju: butuh };
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
