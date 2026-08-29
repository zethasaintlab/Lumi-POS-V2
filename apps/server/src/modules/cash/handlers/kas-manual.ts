import { randomUUID } from 'node:crypto';
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
} from '../../sync/index.ts';
import {
  periksaKas,
  tipeMovement,
  type ArahKas,
} from '../../../../../../packages/domain/src/kas-manual.ts';
import type { Hlc } from '../../../../../../packages/domain/src/hlc.ts';
import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * `POST /shifts/{shiftId}/cash-movements` — FR-D5, kas masuk & kas keluar.
 *
 * ## ⛔ Ketiadaannya adalah cacat yang menghasilkan selisih palsu
 *
 * Saldo laci adalah `saldo_awal + SUM(cash_movement.delta)` (`spec-d:14`).
 * Owner yang mengambil Rp 500.000 dari laci untuk membayar pemasok tanpa cara
 * mencatatnya membuat tutup kas melaporkan **kekurangan Rp 500.000**, menuntut
 * otorisasi manajer untuk selisih yang sepenuhnya dapat dijelaskan, dan
 * laporan exception FR-G5 menandai kasirnya.
 *
 * Bentuk KEEMPAT dari cacat yang `CLAUDE.md` catat tiga kali — laci yang
 * angkanya berbeda dari uang yang benar-benar ada di dalamnya.
 *
 * ## ⛔ TANPA PIN manajer, ditiru dari keputusan void
 *
 * Keputusan 1 Agustus 2026 menetapkan void berjalan tanpa PIN manajer — cukup
 * alasan daftar tertutup + audit. Di sini alasannya lebih kuat: orang yang
 * mengambil uang dari laci sering satu-satunya orang yang ada, dan ia
 * pemiliknya. Penyetuju yang wajib berbeda dari aktor (`CHECK` di
 * `audit_event`) membuat fiturnya mustahil dipakai justru oleh yang paling
 * membutuhkannya — dan yang tidak dapat mencatat tetap mengambil uangnya.
 *
 * `[ASUMSI]` — `spec-d` hanya menyatakan alasannya wajib, bukan siapa yang
 * boleh.
 *
 * ## ⛔ Satu transaksi
 *
 * `cash_movement` + `audit_event` + outbox + idempotency key. Movement tanpa
 * auditnya adalah uang yang berpindah tanpa siapa pun bertanggung jawab;
 * audit tanpa movement-nya adalah tuduhan tanpa akibat.
 */

interface Badan {
  id?: unknown;
  arah?: unknown;
  jumlah?: unknown;
  reasonCode?: unknown;
  reasonNote?: unknown;
  hlc?: unknown;
  occurredAt?: unknown;
}

interface ShiftRow {
  id: string;
  outlet_id: string;
  device_id: string | null;
  status: string;
}

export function createCashMovementHandlers(pool: Pool, hlc: Hlc): Record<string, unknown> {
  return {
    async recordCashMovement(req: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const { shiftId } = req.params as { shiftId: string };
      const body = (req.body ?? {}) as Badan;

      const idempotencyKey = req.headers['idempotency-key'];
      if (typeof idempotencyKey !== 'string' || idempotencyKey.trim() === '') {
        throw new HttpError(400, 'MISSING_IDEMPOTENCY_KEY', 'Header Idempotency-Key wajib.');
      }
      if (typeof body.id !== 'string' || body.id.trim() === '') {
        throw new HttpError(400, 'VALIDATION_ERROR', 'id wajib diisi klien (ULID/UUIDv7).');
      }
      if (body.arah !== 'masuk' && body.arah !== 'keluar') {
        throw new HttpError(400, 'VALIDATION_ERROR', 'arah harus "masuk" atau "keluar".');
      }
      const arah = body.arah as ArahKas;

      // ⛔ Jumlah sebagai STRING. Rupiah utuh melampaui 2^53 pada nilai yang
      // masih mungkin di gudang uang, dan `number` di jalur kas adalah
      // pembulatan diam-diam yang baru terlihat sebagai selisih saat tutup.
      if (typeof body.jumlah !== 'string' || !/^\d+$/.test(body.jumlah)) {
        throw new HttpError(
          400,
          'VALIDATION_ERROR',
          'jumlah harus string bilangan bulat positif tanpa tanda.'
        );
      }
      const reasonNote =
        typeof body.reasonNote === 'string' && body.reasonNote.trim() !== ''
          ? body.reasonNote.trim()
          : null;

      // ⛔ Aturannya di DOMAIN, dan klien memakai fungsi yang sama. Perangkat
      // mencatat kas keluar saat offline; aturan yang hanya hidup di server
      // berarti kasir mengetik jumlah nol, barisnya tersimpan lokal, lalu
      // berhenti `gagal-permanen` di antrean berjam-jam kemudian — bentuk
      // cacat yang sama persis dengan refund offline (`CLAUDE.md`).
      const periksa = periksaKas({
        arah,
        jumlah: BigInt(body.jumlah),
        alasan: String(body.reasonCode ?? ''),
        catatan: reasonNote,
      });
      if (!periksa.ok) throw new HttpError(400, periksa.kode, periksa.pesan);

      const hlcValue =
        body.hlc === undefined ? hlc.tick() : hlc.update(BigInt(String(body.hlc)));

      const hasil = await withTenantTransaction(pool, tenantId, async (client) => {
        const cached = await findIdempotencyKey(client, idempotencyKey);
        if (cached !== null && cached.completed) {
          return { kind: 'cached' as const, record: cached };
        }
        await assertUserVisible(client, actorId);
        // ⛔ Penjaganya `shift_open_close`, pola yang sama dengan no-sale:
        // yang ditutup adalah akuntan (`spec-f:82` — "tidak dapat melakukan
        // mutasi apa pun"), sementara kasir memang boleh. Lihat catatan kepala
        // untuk kenapa tidak ada PIN manajer.
        await assertBoleh(client, actorId, 'shift_open_close', 'mencatat kas masuk/keluar');

        // FK klien-suplai ke tabel ber-`tenant_id` (temuan F1): FK PostgreSQL
        // tidak tunduk RLS dan hanya membuktikan shift itu ada di SUATU
        // tenant.
        const { rows } = await client.query<ShiftRow>(
          'SELECT id, outlet_id, device_id, status FROM cash_drawer_shift WHERE id = $1',
          [shiftId]
        );
        if (rows.length === 0) {
          throw new HttpError(404, 'SHIFT_NOT_FOUND', `Shift ${shiftId} tidak ditemukan.`);
        }
        const shift = rows[0];
        // ⛔ Shift yang sudah tertutup TIDAK dapat menerima movement baru.
        // Saldo dan selisihnya sudah dihitung dan disetujui; menambahkan baris
        // sesudahnya mengubah angka yang seseorang sudah tanda tangani, dan
        // laporan yang dicetak kemarin berhenti cocok dengan yang hari ini.
        if (shift.status !== 'open') {
          throw new HttpError(
            409,
            'SHIFT_NOT_OPEN',
            `Shift ${shiftId} sudah ${shift.status}; kas tidak dapat dicatat lagi.`
          );
        }

        await claimIdempotencyKey(client, {
          key: idempotencyKey,
          tenantId,
          requestHash: `${shiftId}:${body.id}`,
        });

        await client.query(
          `INSERT INTO cash_movement
             (id, tenant_id, shift_id, type, delta, order_id, counterpart_type,
              reason_code, note, created_by, occurred_at, hlc)
           VALUES ($1,$2,$3,$4,$5::bigint,NULL,$6,$7,$8,$9,COALESCE($10::timestamptz, now()),$11)`,
          [
            body.id,
            tenantId,
            shiftId,
            tipeMovement(arah),
            periksa.delta.toString(),
            periksa.counterpart,
            String(body.reasonCode),
            reasonNote,
            actorId,
            typeof body.occurredAt === 'string' ? body.occurredAt : null,
            hlcValue.toString(),
          ]
        );

        await recordAuditEvent(client, {
          id: randomUUID(),
          tenantId,
          outletId: shift.outlet_id,
          deviceId: shift.device_id,
          actorUserId: actorId,
          // Lihat catatan kepala: tanpa PIN manajer.
          approverUserId: null,
          eventType: periksa.eventType as 'cash_paid_in' | 'cash_paid_out',
          entityType: 'cash_movement',
          entityId: body.id as string,
          reasonCode: String(body.reasonCode),
          reasonNote,
          // ⛔ Uang sebagai STRING di jsonb, dan `delta` BERTANDA — yang
          // membaca audit harus dapat melihat arahnya tanpa membaca
          // `event_type`nya lagi.
          after: {
            shiftId,
            delta: periksa.delta.toString(),
            counterpartType: periksa.counterpart,
          },
          hlc: hlcValue,
          occurredAt: typeof body.occurredAt === 'string' ? body.occurredAt : null,
        });

        await insertOutboxEvent(client, {
          id: randomUUID(),
          tenantId,
          aggregateType: 'cash_drawer_shift',
          aggregateId: shiftId,
          eventType: arah === 'masuk' ? 'cash.paid_in' : 'cash.paid_out',
          payload: { shiftId, movementId: body.id, delta: periksa.delta.toString() },
        });

        const jawab = {
          id: body.id,
          shiftId,
          arah,
          delta: periksa.delta.toString(),
          counterpartType: periksa.counterpart,
        };
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
