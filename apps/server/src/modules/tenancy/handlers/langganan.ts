import { randomUUID } from 'node:crypto';
import type { Pool } from '../../../db.ts';
import { withTenantTransaction } from '../../../db.ts';
import { HttpError } from '../../../http-error.ts';
import { getTenantId, getActorId } from '../../../tenant-context.ts';
import { assertUserVisible } from '../../identity/index.ts';
import { recordAuditEvent } from '../../audit/index.ts';
import {
  findIdempotencyKey,
  claimIdempotencyKey,
  completeIdempotencyKey,
  IdempotencyKeyConflictError,
} from '../../sync/index.ts';
import {
  rujukanGatewayUntukTagihan,
  type InitiateSubscriptionResult,
  type SubscriptionProvider,
} from '../../payment/providers/langganan.ts';
import { hitungOutlet } from '../kuota.ts';
import {
  bacaPaketTenant,
  bacaTagihan,
  buatTagihan,
  catatRujukanGateway,
  daftarTagihan,
  terapkanStatusTagihan,
  toTagihan,
} from '../langganan.ts';
import {
  HARGA_PAKET,
  periksaKenaikanPaket,
  type NamaPaket,
} from '../../../../../../packages/domain/src/paket.ts';
import type { Hlc } from '../../../../../../packages/domain/src/hlc.ts';
import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * F5 — menaikkan paket sendiri (`ARCH:400`, epik pertama).
 *
 * Sampai sekarang tidak ada satu pun cara mengubah `tenant.plan`, sementara
 * pesan penolakan kuota berbunyi *"Naikkan paket atau kurangi … yang ada"* —
 * kalimat yang menunjuk ke jalan yang belum dibangun. Ini jalannya.
 *
 * ## ⛔ Scope: HANYA naik
 *
 * Keputusan user 21 Agustus 2026. Penurunan paket dan pembatalan langganan
 * tidak dibangun, dan itu bukan penundaan yang tidak berakibat: aturannya
 * ditegakkan `periksaKenaikanPaket`, dan konsekuensinya adalah tidak pernah
 * ada keadaan di mana merchant membayar lalu kenaikannya ditolak karena
 * kuotanya tidak muat (kuota naik monoton sepanjang `URUTAN_PAKET`).
 *
 * ## ⛔ Yang SENGAJA tidak ada: periode dan langganan berakhir
 *
 * Siklus tagihan belum diputuskan (S-2 di `PENYELIDIKAN-f5-langganan.md`).
 * Konsekuensi yang harus dibaca dan bukan dicari sendiri: **membayar satu
 * tagihan menaikkan paket secara permanen.** Tidak ada apa pun yang
 * menurunkannya kembali. Itu keadaan yang dinyatakan, bukan kelalaian —
 * `research/09:213` melarang menghentikan penjualan, jadi jalur "gagal bayar
 * lalu turun" tidak dapat ditebak sepotong.
 */

const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
function bacaIdempotencyKey(req: FastifyRequest): string {
  const header = req.headers['idempotency-key'];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value || value.length === 0 || value.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new HttpError(400, 'MISSING_IDEMPOTENCY_KEY', 'Header Idempotency-Key wajib diisi.');
  }
  return value;
}

/** Batas daftar riwayat. Bukan paginasi penuh — B-29 menampilkan riwayat pendek. */
const BATAS_RIWAYAT = 50;

interface BodyTagihan {
  id: string;
  plan: string;
}

export function createSubscriptionHandlers(
  pool: Pool,
  hlc: Hlc,
  provider: SubscriptionProvider
): Record<string, unknown> {
  return {
    /**
     * `POST /tenants/subscription/invoices` — minta tagihan untuk naik paket.
     *
     * ## ⛔ DUA transaksi, alasan yang sama persis dengan QRIS dinamis
     *
     * Tagihan `pending_confirmation` ditulis dan **di-commit sebelum** gateway
     * dipanggil. Kegagalan gateway di dalam transaksi akan me-rollback
     * satu-satunya jejak bahwa QR pernah diminta — sementara merchant mungkin
     * sudah membayar (FR-C14). Panggilan jaringan di dalam transaksi juga
     * menahan koneksi pool selama gateway berpikir.
     *
     * Ini tidak melanggar invariant #1: invariant itu tentang satu PENJUALAN,
     * dan tagihan langganan bukan penjualan sama sekali — ia tidak menyentuh
     * `order`, `payment`, `stock_movement`, maupun `cash_movement`.
     *
     * ## Idempotency
     *
     * Key diklaim di transaksi pertama dan DISELESAIKAN hanya bila gateway
     * menjawab. Diselesaikan juga saat gateway gagal, retry dengan key yang
     * sama akan menerima respons "tanpa QR" dari cache selamanya.
     */
    async createSubscriptionInvoice(req: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const idempotencyKey = bacaIdempotencyKey(req);
      const body = req.body as BodyTagihan;

      // --- transaksi 1: klaim key + tulis tagihan pending_confirmation ---
      const awal = await withTenantTransaction(pool, tenantId, async (client) => {
        const existing = await findIdempotencyKey(client, idempotencyKey);
        if (existing !== null && existing.completed) {
          return { kind: 'cached' as const, record: existing };
        }
        if (existing === null) {
          await claimIdempotencyKey(client, {
            key: idempotencyKey,
            tenantId,
            requestHash: `${body.id}:${body.plan}`,
          });
        }

        // FK `requested_by` tidak ada di skema (kolom `text`, seperti
        // `price_history.changed_by`), jadi tidak ada apa pun di database yang
        // menangkap id karangan. SELECT yang tunduk RLS ini satu-satunya yang
        // berdiri di sana — dan ia juga yang membuat audit di bawah tidak
        // melempar karena aktornya tidak ada.
        await assertUserVisible(client, actorId);

        const paket = await bacaPaketTenant(client, tenantId);
        const boleh = periksaKenaikanPaket(paket.plan, body.plan);
        if (!boleh.ok) {
          // 409, bukan 403: merchant BERHAK atas billing (RBAC sudah
          // meloloskannya) — yang salah adalah keadaan, bukan haknya.
          throw new HttpError(409, boleh.kode, boleh.pesan);
        }

        // ⛔ Jumlah outlet dihitung fungsi yang SAMA dengan penegakan kuota
        // dan `GET /tenants/usage`. Salinan query di sini akan menyimpang
        // pada aturan arsip, dan gejalanya adalah tagihan yang menyebut
        // jumlah outlet berbeda dari yang ditampilkan layar sebelahnya.
        const outletCount = await hitungOutlet(client);
        // Sudah dijamin bukan `null` oleh `periksaKenaikanPaket`
        // (`PLAN_NOT_SELF_SERVE`), dan dibaca di sini alih-alih dihitung ulang
        // supaya harga satuan yang DISIMPAN adalah harga yang sama dengan
        // yang dipakai mengalikan.
        const unitPrice = HARGA_PAKET[body.plan as NamaPaket] as bigint;
        const amount = unitPrice * BigInt(outletCount);

        const tagihan = await buatTagihan(client, {
          id: body.id,
          tenantId,
          plan: body.plan,
          outletCount,
          unitPrice,
          amount,
          requestedBy: actorId,
          provider: provider.name,
        });

        await recordAuditEvent(client, {
          id: randomUUID(),
          tenantId,
          outletId: null,
          deviceId: null,
          actorUserId: actorId,
          approverUserId: null,
          eventType: 'subscription_invoice_created',
          entityType: 'subscription_invoice',
          entityId: tagihan.id,
          reasonCode: null,
          reasonNote: null,
          after: { plan: body.plan, amount: amount.toString(), outletCount },
          hlc: hlc.tick(),
        });

        return { kind: 'fresh' as const, tagihan };
      }).catch((err) => {
        if (err instanceof IdempotencyKeyConflictError) {
          throw new HttpError(409, 'IDEMPOTENCY_KEY_CONFLICT', 'Permintaan dengan key ini sedang diproses. Coba lagi.');
        }
        throw err;
      });

      if (awal.kind === 'cached') {
        reply.code(awal.record.responseStatus);
        return awal.record.responseBody;
      }

      // --- panggilan gateway, DI LUAR transaksi ---
      let hasil: InitiateSubscriptionResult | null = null;
      try {
        hasil = await provider.initiate({
          invoiceId: awal.tagihan.id,
          tenantId,
          amount: BigInt(awal.tagihan.amount),
          idempotencyKey,
        });
      } catch {
        // TIDAK dilempar ke klien sebagai kegagalan. Tagihannya sudah
        // tersimpan dan dapat dicek ulang; pesan galat gateway tidak
        // diteruskan (FR-C5).
        hasil = null;
      }

      const responseBody = await withTenantTransaction(pool, tenantId, async (client) => {
        if (hasil !== null) {
          await catatRujukanGateway(client, awal.tagihan.id, hasil.providerReference);
        }
        const rb = {
          invoice: {
            ...toTagihan(awal.tagihan),
            providerReference: hasil === null ? null : hasil.providerReference,
          },
          qrString: hasil === null ? null : hasil.qrString,
          expiresAt: hasil === null || hasil.expiresAt === null ? null : hasil.expiresAt.toISOString(),
          gatewayReachable: hasil !== null,
        };
        if (hasil !== null) {
          await completeIdempotencyKey(client, { key: idempotencyKey, responseStatus: 201, responseBody: rb });
        }
        return rb;
      });

      reply.code(201);
      return responseBody;
    },

    /** `GET /tenants/subscription/invoices` — riwayat tagihan, terbaru dulu. */
    async listSubscriptionInvoices(req: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);

      const hasil = await withTenantTransaction(pool, tenantId, async (client) => {
        await assertUserVisible(client, actorId);
        const paket = await bacaPaketTenant(client, tenantId);
        const rows = await daftarTagihan(client, BATAS_RIWAYAT);
        return { plan: paket.plan, status: paket.status, invoices: rows.map(toTagihan) };
      });

      reply.code(200);
      return hasil;
    },

    /**
     * `POST /tenants/subscription/invoices/{invoiceId}/check-status`.
     *
     * POST, bukan GET: ia mengubah keadaan. Bersama webhook, ia satu dari dua
     * jalan sebuah tagihan menjadi `confirmed` — dan keduanya menuntut
     * konfirmasi dari gateway lebih dulu (`spec-c:320`).
     */
    async checkSubscriptionInvoiceStatus(req: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const { invoiceId } = req.params as { invoiceId: string };

      const awal = await withTenantTransaction(pool, tenantId, async (client) => {
        await assertUserVisible(client, actorId);
        const tagihan = await bacaTagihan(client, invoiceId);
        if (tagihan === null) {
          throw new HttpError(
            404,
            'SUBSCRIPTION_INVOICE_NOT_FOUND',
            `Tagihan langganan ${invoiceId} tidak ditemukan.`
          );
        }
        const paket = await bacaPaketTenant(client, tenantId);
        return { tagihan, plan: paket.plan };
      });

      // Tagihan yang sudah final tidak ditanyakan lagi ke gateway. Klien
      // mem-polling; tanpa penjagaan ini satu tagihan menghasilkan puluhan
      // panggilan yang tidak mengubah apa pun.
      if (awal.tagihan.status !== 'pending_confirmation') {
        reply.code(200);
        return { invoice: toTagihan(awal.tagihan), plan: awal.plan, gatewayStatus: null };
      }

      // ⛔ Fallback-nya rujukan ber-PREFIKS, bukan id tagihan mentah.
      // `provider_reference` kosong berarti initiate gagal sebelum sempat
      // mendapatkannya — dan justru keadaan itu yang paling butuh dicek,
      // karena merchant mungkin sudah membayar. Midtrans menerima `order_id`
      // di endpoint status yang sama, dan `order_id` yang kami kirim adalah
      // rujukan ber-prefiks.
      const referensi = awal.tagihan.provider_reference ?? rujukanGatewayUntukTagihan(invoiceId);
      let gatewayStatus;
      try {
        gatewayStatus = await provider.pollStatus(referensi);
      } catch {
        // Gateway tidak terhubung bukan berarti tagihan gagal.
        reply.code(200);
        return { invoice: toTagihan(awal.tagihan), plan: awal.plan, gatewayStatus: 'pending' };
      }

      const hasil = await withTenantTransaction(pool, tenantId, async (client) =>
        terapkanStatusTagihan(client, { tenantId, invoiceId, gatewayStatus, hlc: hlc.tick() })
      );

      reply.code(200);
      return { invoice: toTagihan(hasil.tagihan), plan: hasil.plan, gatewayStatus };
    },
  };
}
