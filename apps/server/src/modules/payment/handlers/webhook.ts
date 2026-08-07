import { createHash, timingSafeEqual } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from '../../../db.ts';
import { withTenantTransaction } from '../../../db.ts';
import { HttpError } from '../../../http-error.ts';
import { insertOutboxEvent } from '../../sync/index.ts';
import { mapGatewayStatus } from '../providers/index.ts';
import { assertTransition } from '../../../../../../packages/domain/src/order-state.ts';
import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Webhook notifikasi Midtrans (FR-C14, keputusan Q4).
 *
 * ## Kenapa endpoint ini berbeda dari semua yang lain di repo ini
 *
 * Ia satu-satunya yang **tidak** membawa `X-Tenant-Id`. Midtrans tidak tahu
 * apa-apa soal tenant kami, dan tidak boleh tahu. Dua konsekuensi yang
 * menentukan bentuknya:
 *
 * 1. **Signature diverifikasi lebih dulu**, sebelum satu query pun
 *    dijalankan. Tanpa itu, siapa pun yang menemukan URL ini dapat menandai
 *    order mana pun lunas.
 * 2. **Tenant dibaca dari notifikasi** (`custom_field1`, yang kami titipkan
 *    sendiri saat charge) lalu dipakai `SET LOCAL app.tenant_id`. Pencarian
 *    payment karena itu tetap tunduk RLS: tenant yang dipalsukan tidak
 *    menemukan apa pun. Notifikasi bertanda tangan sah tapi bertenant salah
 *    dijawab 404, bukan diproses.
 *
 * ## Batas yang diketahui
 *
 * Jalur kodenya teruji penuh dengan payload buatan, tanpa jaringan. Jabat
 * tangan sungguhan dengan Midtrans butuh URL publik (tunnel) dan itu langkah
 * manual — dicatat di `HANDOFF.md` sebagai gap yang diketahui, bukan lupa.
 */

interface MidtransNotification {
  order_id?: unknown;
  status_code?: unknown;
  gross_amount?: unknown;
  signature_key?: unknown;
  transaction_status?: unknown;
  custom_field1?: unknown;
}

interface PaymentRow {
  id: string;
  order_id: string;
  status: string;
  method: string;
}

interface OrderRow {
  id: string;
  status: string;
  total: string;
}

/**
 * `SHA512(order_id + status_code + gross_amount + ServerKey)` — rumus
 * Midtrans.
 *
 * Perbandingannya `timingSafeEqual`, bukan `===`. Penyerang yang dapat
 * mengukur waktu jawaban dapat menebak signature byte demi byte lewat
 * perbandingan yang berhenti di ketidakcocokan pertama. Panjangnya diperiksa
 * lebih dulu karena `timingSafeEqual` melempar bila panjangnya berbeda.
 */
export function verifyMidtransSignature(input: {
  orderId: string;
  statusCode: string;
  grossAmount: string;
  signatureKey: string;
  serverKey: string;
}): boolean {
  const diharapkan = createHash('sha512')
    .update(`${input.orderId}${input.statusCode}${input.grossAmount}${input.serverKey}`)
    .digest('hex');
  const a = Buffer.from(diharapkan, 'utf8');
  const b = Buffer.from(input.signatureKey, 'utf8');
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

function bacaString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

const GATEWAY_TO_PAYMENT_STATUS: Readonly<Record<string, string>> = {
  pending: 'pending_confirmation',
  confirmed: 'confirmed',
  failed: 'failed',
  expired: 'failed',
};

export function createWebhookHandlers(pool: Pool, serverKey: string): Record<string, unknown> {
  return {
    async midtransNotification(req: FastifyRequest, reply: FastifyReply) {
      // Kunci kosong TIDAK berarti "terima apa adanya". CI mengisi
      // MIDTRANS_SERVER_KEY dengan string kosong, dan endpoint yang menerima
      // notifikasi tanpa verifikasi jauh lebih berbahaya daripada endpoint
      // yang mati.
      if (serverKey.trim().length === 0) {
        throw new HttpError(
          503,
          'WEBHOOK_NOT_CONFIGURED',
          'Webhook pembayaran tidak dikonfigurasi; notifikasi tidak dapat diverifikasi.'
        );
      }

      const body = (req.body ?? {}) as MidtransNotification;
      const orderId = bacaString(body.order_id);
      const statusCode = bacaString(body.status_code);
      const grossAmount = bacaString(body.gross_amount);
      const signatureKey = bacaString(body.signature_key);

      const sah = verifyMidtransSignature({ orderId, statusCode, grossAmount, signatureKey, serverKey });
      if (!sah) {
        // Pesan sengaja tidak menjelaskan APA yang salah. Notifikasi yang
        // ditolak datang dari pihak yang tidak punya kunci; menjelaskan
        // bagian mana yang tidak cocok adalah menolongnya.
        throw new HttpError(401, 'INVALID_SIGNATURE', 'Signature notifikasi tidak sah.');
      }

      const tenantId = bacaString(body.custom_field1);
      if (tenantId.length === 0) {
        // Kode TERSENDIRI, bukan PAYMENT_NOT_FOUND. Tanpa tenant, RLS memang
        // juga tidak akan menemukan apa pun -- tapi selama jawabannya sama
        // persis, guard ini tidak dapat dibedakan dari perilaku RLS dan tidak
        // ada test yang bisa membuktikannya bekerja. Pelajaran yang sama
        // dengan APPROVER_NOT_FOUND di modul ordering.
        throw new HttpError(
          400,
          'MISSING_TENANT_REFERENCE',
          'Notifikasi tidak memuat rujukan tenant (custom_field1).'
        );
      }

      // `order_id` Midtrans adalah id PAYMENT kami (lihat komentar di
      // providers/index.ts). Pencariannya tunduk RLS lewat tenant di atas.
      const gatewayStatus = mapGatewayStatus(body.transaction_status);
      const statusBaru = GATEWAY_TO_PAYMENT_STATUS[gatewayStatus] ?? 'pending_confirmation';

      await withTenantTransaction(pool, tenantId, async (client: PoolClient) => {
        const { rows } = await client.query<PaymentRow>(
          'SELECT id, order_id, status, method FROM payment WHERE id = $1 FOR UPDATE',
          [orderId]
        );
        if (rows.length === 0) {
          throw new HttpError(404, 'PAYMENT_NOT_FOUND', 'Pembayaran tidak ditemukan.');
        }
        const payment = rows[0];

        // Notifikasi susulan tidak boleh membalikkan pembayaran yang sudah
        // dikonfirmasi -- uangnya sudah masuk. Midtrans mengirim ulang
        // notifikasi yang tidak dijawab 200, jadi pengulangan adalah keadaan
        // NORMAL, bukan anomali.
        if (payment.status !== 'pending_confirmation') {
          return;
        }
        if (statusBaru === 'pending_confirmation') {
          // Termasuk `transaction_status` yang tidak kami kenal. spec-c:320 --
          // tidak ada kata asing yang boleh berarti lunas.
          return;
        }

        await client.query('UPDATE payment SET status = $2 WHERE id = $1', [payment.id, statusBaru]);

        if (statusBaru === 'confirmed') {
          const { rows: orderRows } = await client.query<OrderRow>(
            'SELECT id, status, total FROM "order" WHERE id = $1 FOR UPDATE',
            [payment.order_id]
          );
          const order = orderRows[0];
          const { rows: jumlah } = await client.query<{ total: string | null }>(
            `SELECT SUM(amount)::text AS total FROM payment
              WHERE order_id = $1 AND status = 'confirmed'`,
            [payment.order_id]
          );
          const sudahDibayar = jumlah[0].total === null ? 0n : BigInt(jumlah[0].total);
          if (sudahDibayar >= BigInt(order.total) && order.status === 'open') {
            assertTransition(order.status, 'paid');
            assertTransition('paid', 'closed');
            await client.query(
              `UPDATE "order" SET status = 'closed', amount_due = total WHERE id = $1`,
              [payment.order_id]
            );
          }
        }

        await insertOutboxEvent(client, {
          id: randomUUID(),
          tenantId,
          aggregateType: 'payment',
          aggregateId: payment.id,
          eventType: `payment.${statusBaru}`,
          payload: { orderId: payment.order_id, gatewayStatus, sumber: 'webhook' },
        });
      });

      // Midtrans mengirim ulang notifikasi yang tidak dijawab 200. Pengiriman
      // ulang yang tidak mengubah apa pun tetap dijawab 200 -- menjawab error
      // hanya membuat Midtrans mengulanginya lagi tanpa akhir.
      reply.code(200);
      return { received: true };
    },
  };
}
