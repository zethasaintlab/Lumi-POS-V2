/**
 * Port `SubscriptionProvider` — gateway untuk tagihan LANGGANAN (F5).
 *
 * ## ⛔ Port KEDUA, bukan `PaymentProvider` yang dilonggarkan
 *
 * `InitiateRequest` mewajibkan `orderId` dan `paymentId`. Tagihan langganan
 * tidak punya keduanya — ia bukan penjualan di outlet mana pun, tidak
 * dilakukan perangkat mana pun, dan tidak menutup check mana pun (alasan yang
 * sama yang memaksa tabelnya sendiri, `0026_subscription_invoice.sql`).
 *
 * Menjadikan kedua field itu opsional berarti menyentuh jalur uang yang sudah
 * terbukti demi fitur yang bukan penjualan: setiap pemanggil `initiate` yang
 * ada hari ini akan berhenti memaksa TypeScript membuktikan ia mengirim id
 * order. Port kedua tidak membeli apa pun dari yang pertama dan tidak
 * mengambil apa pun darinya.
 *
 * Yang DIPAKAI ULANG adalah pipa HTTP-nya (`createMidtransHttp`) — base URL,
 * HTTP Basic, dan penulisan ulang pesan galat yang menjaga kredensial tidak
 * pernah masuk log. Termasuk `fetch` yang di-inject, sehingga aturan **nol
 * test menyentuh jaringan** tetap berlaku penuh: CI mengisi
 * `MIDTRANS_SERVER_KEY` dengan string kosong.
 *
 * ## ⛔ Prefiks, dan kenapa ia bagian dari port ini
 *
 * Midtrans mengirim SELURUH notifikasi ke satu URL. Sebelum berkas ini,
 * `webhooks/midtrans` memperlakukan `order_id` notifikasi sebagai id payment
 * kami dan menjawab `404 PAYMENT_NOT_FOUND` bila tidak ditemukan — sementara
 * komentar di berkas yang sama mencatat bahwa Midtrans **mengirim ulang
 * notifikasi yang tidak dijawab 200**. Notifikasi tagihan langganan pertama
 * karena itu akan dijawab 404 lalu diulang selamanya.
 *
 * Prefiks memutuskan rute **sebelum satu query pun jalan**, jadi notifikasi
 * asing tidak menghasilkan dua pencarian yang keduanya gagal, dan jenis
 * tagihan berikutnya tidak menambah pencarian ketiga.
 */

import {
  createMidtransHttp,
  mapGatewayStatus,
  parseExpiry,
  type GatewayStatus,
  type MidtransEnvironment,
  type MidtransOptions,
} from './index.ts';

export type { GatewayStatus } from './index.ts';

/**
 * ⛔ Karakter yang dipakai harus aman untuk `order_id` Midtrans: alfanumerik,
 * `-`, `_`, `.`, `~`. Tanda titik dua akan diterima sebagian jalur dan
 * ditolak di jalur lain, dan gejalanya muncul pertama kali di produksi.
 */
export const PREFIKS_LANGGANAN = 'sub-';

/** Id yang dititipkan ke gateway sebagai `order_id`. */
export function rujukanGatewayUntukTagihan(invoiceId: string): string {
  return `${PREFIKS_LANGGANAN}${invoiceId}`;
}

/**
 * Apakah notifikasi ini milik tagihan langganan.
 *
 * Dijawab dari STRING-nya saja — tidak ada query, tidak ada database. Itulah
 * seluruh gunanya (lihat kepala berkas).
 */
export function adalahRujukanLangganan(gatewayOrderId: string): boolean {
  return gatewayOrderId.startsWith(PREFIKS_LANGGANAN);
}

export function idTagihanDari(gatewayOrderId: string): string {
  return gatewayOrderId.slice(PREFIKS_LANGGANAN.length);
}

export interface InitiateSubscriptionRequest {
  invoiceId: string;
  /**
   * Dititipkan lewat `custom_field1` dan dikembalikan apa adanya di
   * notifikasi. Webhook tidak membawa `X-Tenant-Id`; nilai inilah yang
   * dipakai sebagai `app.tenant_id`, sehingga pencarian tagihannya tetap
   * tunduk RLS dan tenant yang dipalsukan tidak menemukan apa pun.
   */
  tenantId: string;
  /** Rupiah utuh. `bigint`, sama seperti seluruh jalur uang. */
  amount: bigint;
  idempotencyKey: string;
}

export interface InitiateSubscriptionResult {
  /** Disimpan di `subscription_invoice.provider_reference`. */
  providerReference: string;
  qrString: string;
  expiresAt: Date | null;
}

export interface SubscriptionProvider {
  /** Disimpan di `subscription_invoice.provider`. */
  readonly name: string;
  initiate(req: InitiateSubscriptionRequest): Promise<InitiateSubscriptionResult>;
  pollStatus(providerReference: string): Promise<GatewayStatus>;
}

// --- fake in-memory ---

export interface FakeSubscriptionProvider extends SubscriptionProvider {
  initiateCalls(): number;
  pollCalls(): number;
  gatewayTransactions(): number;
  setStatus(providerReference: string, status: GatewayStatus): void;
  failNextInitiate(err: Error): void;
  failNextPoll(err: Error): void;
  reset(): void;
}

/** Tetap, tanpa jam — alasan yang sama dengan `FAKE_EXPIRY` di `./index.ts`. */
const FAKE_EXPIRY = new Date('2099-12-31T23:59:59.000Z');

/**
 * Fake yang dipakai SELURUH test langganan.
 *
 * Ia meniru dua perilaku gateway yang menentukan benar-tidaknya test di
 * atasnya, keduanya sama dengan fake pembayaran:
 *
 * 1. Idempotency key yang sama mengembalikan transaksi yang SAMA.
 * 2. **Status awal selalu `pending`.** Fake yang langsung menjawab
 *    `confirmed` akan membuat "paket tidak naik tanpa konfirmasi gateway"
 *    hijau karena alasan yang salah.
 */
export function createFakeSubscriptionProvider(): FakeSubscriptionProvider {
  let calls = 0;
  let polls = 0;
  let gagalBerikutnya: Error | null = null;
  let gagalPollBerikutnya: Error | null = null;
  const byKey = new Map<string, string>();
  const status = new Map<string, GatewayStatus>();
  let urutan = 0;

  return {
    name: 'fake',

    async initiate(req: InitiateSubscriptionRequest): Promise<InitiateSubscriptionResult> {
      calls += 1;
      if (gagalBerikutnya !== null) {
        const err = gagalBerikutnya;
        gagalBerikutnya = null;
        throw err;
      }
      const sudahAda = byKey.get(req.idempotencyKey);
      if (sudahAda !== undefined) {
        return { providerReference: sudahAda, qrString: `FAKE-QR-${sudahAda}`, expiresAt: FAKE_EXPIRY };
      }
      urutan += 1;
      const ref = `fake-sub-${urutan}`;
      byKey.set(req.idempotencyKey, ref);
      status.set(ref, 'pending');
      return { providerReference: ref, qrString: `FAKE-QR-${ref}`, expiresAt: FAKE_EXPIRY };
    },

    async pollStatus(providerReference: string): Promise<GatewayStatus> {
      polls += 1;
      if (gagalPollBerikutnya !== null) {
        const err = gagalPollBerikutnya;
        gagalPollBerikutnya = null;
        throw err;
      }
      return status.get(providerReference) ?? 'pending';
    },

    initiateCalls: () => calls,
    pollCalls: () => polls,
    gatewayTransactions: () => byKey.size,
    setStatus: (ref, s) => { status.set(ref, s); },
    failNextInitiate: (err) => { gagalBerikutnya = err; },
    failNextPoll: (err) => { gagalPollBerikutnya = err; },
    reset: () => {
      calls = 0;
      polls = 0;
      urutan = 0;
      gagalBerikutnya = null;
      gagalPollBerikutnya = null;
      byKey.clear();
      status.clear();
    },
  };
}

// --- adapter Midtrans ---

interface ChargeResponse {
  transaction_id?: string;
  actions?: Array<{ name?: string; url?: string }>;
  expiry_time?: string | null;
}

export function createMidtransSubscriptionProvider(options: MidtransOptions): SubscriptionProvider {
  const { panggil } = createMidtransHttp(options);

  return {
    name: 'midtrans',

    async initiate(req: InitiateSubscriptionRequest): Promise<InitiateSubscriptionResult> {
      const rujukan = rujukanGatewayUntukTagihan(req.invoiceId);
      const body = await panggil('/v2/charge', {
        method: 'POST',
        headers: { 'X-Idempotency-Key': req.idempotencyKey },
        body: JSON.stringify({
          payment_type: 'qris',
          transaction_details: {
            // ⛔ Ber-PREFIKS. Inilah nilai yang dikembalikan Midtrans di
            // `order_id` notifikasi, dan satu-satunya yang membuat webhook
            // dapat merutekan tanpa query.
            order_id: rujukan,
            gross_amount: Number(req.amount),
          },
          qris: { acquirer: 'gopay' },
          custom_field1: req.tenantId,
        }),
      }) as ChargeResponse;

      const qr = (body.actions ?? []).find((a) => a.name === 'generate-qr-code');
      return {
        providerReference: body.transaction_id ?? rujukan,
        qrString: qr?.url ?? '',
        expiresAt: parseExpiry(body.expiry_time),
      };
    },

    async pollStatus(providerReference: string): Promise<GatewayStatus> {
      const body = await panggil(`/v2/${encodeURIComponent(providerReference)}/status`, {
        method: 'GET',
      }) as { transaction_status?: string };
      return mapGatewayStatus(body.transaction_status);
    },
  };
}

// --- pemilihan lewat environment variable (invariant #5) ---

/**
 * ⛔ Membaca `PAYMENT_PROVIDER` yang SAMA, bukan variabel tersendiri.
 *
 * Dua variabel berarti sebuah lingkungan dapat berakhir dengan langganan
 * memakai fake sementara penjualan memakai Midtrans — dan yang gagal di sana
 * bukan test melainkan tagihan sungguhan yang tidak pernah lahir di gateway.
 * Gatewaynya satu; pilihannya karena itu juga satu.
 */
export function selectSubscriptionProvider(
  env: Record<string, string | undefined>
): SubscriptionProvider {
  const pilihan = env.PAYMENT_PROVIDER ?? 'fake';

  if (pilihan === 'fake') {
    return createFakeSubscriptionProvider();
  }
  if (pilihan === 'midtrans') {
    const serverKey = (env.MIDTRANS_SERVER_KEY ?? '').trim();
    if (serverKey.length === 0) {
      throw new Error('MIDTRANS_SERVER_KEY kosong sementara PAYMENT_PROVIDER=midtrans.');
    }
    const environment: MidtransEnvironment = env.MIDTRANS_ENV === 'production' ? 'production' : 'sandbox';
    return createMidtransSubscriptionProvider({ serverKey, environment });
  }

  throw new Error(`PAYMENT_PROVIDER tidak dikenal: "${pilihan}". Pilihan: fake, midtrans.`);
}
