/**
 * Port `PaymentProvider` (ARCH:197) dan dua adapter-nya.
 *
 * ## Kenapa port ini WAJIB, bukan pilihan gaya
 *
 * `ARCH:197` sudah mendefinisikannya, tapi ada alasan yang lebih memaksa:
 * `.github/workflows/test.yml` mengisi `MIDTRANS_SERVER_KEY` dan
 * `MIDTRANS_CLIENT_KEY` dengan **string kosong**. Test yang memanggil API
 * Midtrans sungguhan akan gagal di CI, lambat, dan bergantung pada layanan
 * pihak ketiga yang bisa down saat kita tidak sedang melihat.
 *
 * Konsekuensinya mutlak: **tidak ada satu pun test yang boleh menyentuh
 * jaringan.** Adapter Midtrans karena itu menerima `fetch` sebagai
 * dependensi, bukan memanggil `fetch` global langsung.
 *
 * ## Invariant #5
 *
 * Adapter dipilih di `buildApp` lewat environment variable. Tidak ada
 * `if (isProduction)` di kode aplikasi — itu bentuk yang dilarang
 * `CLAUDE.md`, dan alasannya sama dengan `if (isOnPrem)`: keputusan
 * lingkungan yang tersebar di kode akan menghasilkan jalur yang tidak pernah
 * dijalankan siapa pun sampai ia gagal di produksi.
 *
 * ## Rahasia
 *
 * `serverKey` dipakai di header `Authorization` — itu memang tempatnya. Yang
 * dilarang adalah ia muncul di **pesan error**, karena pesan error berakhir
 * di log, di respons API, dan di laporan bug yang ditempelkan orang ke
 * mana-mana. Seluruh `throw` di file ini menyebut status HTTP dan pesan
 * gateway, tidak pernah kredensial.
 */

/** Empat keadaan yang dimengerti domain. Sengaja lebih sedikit daripada yang dikirim gateway. */
export type GatewayStatus = 'pending' | 'confirmed' | 'failed' | 'expired';

export interface InitiateRequest {
  orderId: string;
  paymentId: string;
  /**
   * Dititipkan ke gateway lewat `custom_field1` dan dikembalikan apa adanya di
   * notifikasi webhook.
   *
   * Webhook adalah satu-satunya endpoint tanpa `X-Tenant-Id` -- Midtrans tidak
   * tahu apa-apa soal tenant kami. Tanpa titipan ini, notifikasi tidak dapat
   * dipetakan ke tenant mana pun tanpa query yang MELEWATI RLS, dan itu
   * melanggar invariant #8. Nilai ini tidak dipercaya begitu saja: ia dipakai
   * sebagai `app.tenant_id`, sehingga pencarian payment-nya tetap tunduk RLS
   * dan tenant yang dipalsukan tidak menemukan apa pun.
   */
  tenantId: string;
  /** Rupiah utuh. `bigint`, sama seperti seluruh jalur uang. */
  amount: bigint;
  /**
   * Diteruskan ke gateway. AC FR-C14 pertama: retry memakai key yang SAMA
   * tidak boleh membuat transaksi gateway baru.
   */
  idempotencyKey: string;
}

export interface InitiateResult {
  /** Disimpan di `payment.provider_reference`. */
  providerReference: string;
  /** Isi QR yang dirender klien. */
  qrString: string;
  expiresAt: Date | null;
}

export interface PaymentProvider {
  /** Disimpan di `payment.provider`. */
  readonly name: string;
  initiate(req: InitiateRequest): Promise<InitiateResult>;
  pollStatus(providerReference: string): Promise<GatewayStatus>;
}

// --- fake in-memory ---

export interface FakePaymentProvider extends PaymentProvider {
  initiateCalls(): number;
  /**
   * Berapa kali gateway ditanyai statusnya. Klien mem-polling tiap 2 detik
   * (spec-c:293-316), jadi "tidak menanyai gateway untuk payment yang sudah
   * final" bukan optimasi -- ia yang menjaga satu order tidak menghasilkan
   * puluhan panggilan yang tidak mengubah apa pun.
   */
  pollCalls(): number;
  gatewayTransactions(): number;
  setStatus(providerReference: string, status: GatewayStatus): void;
  failNextInitiate(err: Error): void;
  failNextPoll(err: Error): void;
  reset(): void;
}

/**
 * Kedaluwarsa TETAP, bukan `Date.now() + 5 menit`.
 *
 * Fake ini tidak boleh punya jam. Nilai tetap membuat setiap run menghasilkan
 * data yang sama persis — kegagalan dapat direproduksi — dan `expiresAt`
 * memang data yang datang DARI gateway, bukan dibaca dari jam kita. Nilainya
 * jauh di masa depan supaya tidak ada test yang tiba-tiba merah karena waktu
 * berjalan.
 */
const FAKE_EXPIRY = new Date('2099-12-31T23:59:59.000Z');

/**
 * Fake yang dipakai SELURUH test.
 *
 * Ia meniru dua perilaku gateway sungguhan yang menentukan benar-tidaknya
 * test di atasnya:
 *
 * 1. **Idempotency key yang sama mengembalikan transaksi yang SAMA**, tidak
 *    membuat yang baru. Fake yang tidak menirunya akan membuat test
 *    idempotensi hijau karena alasan yang salah.
 * 2. **Status awal selalu `pending`.** `spec-c:320` melarang sistem menandai
 *    lunas tanpa konfirmasi gateway; fake yang langsung menjawab `confirmed`
 *    akan menyembunyikan pelanggaran aturan itu.
 *
 * `initiateCalls()` dan `gatewayTransactions()` sengaja dua angka berbeda:
 * yang pertama menghitung berapa kali port dipanggil, yang kedua berapa
 * transaksi gateway yang benar-benar lahir. Tanpa keduanya, "retry tidak
 * membuat transaksi baru" hanya bisa diperiksa lewat efeknya di database —
 * dan efek itu bisa saja sama walau gateway dipanggil dua kali.
 */
export function createFakeProvider(): FakePaymentProvider {
  let calls = 0;
  let polls = 0;
  let gagalBerikutnya: Error | null = null;
  let gagalPollBerikutnya: Error | null = null;
  const byKey = new Map<string, string>();
  const status = new Map<string, GatewayStatus>();
  let urutan = 0;

  return {
    name: 'fake',

    async initiate(req: InitiateRequest): Promise<InitiateResult> {
      calls += 1;
      if (gagalBerikutnya !== null) {
        const err = gagalBerikutnya;
        gagalBerikutnya = null;
        throw err;
      }
      const sudahAda = byKey.get(req.idempotencyKey);
      if (sudahAda !== undefined) {
        return {
          providerReference: sudahAda,
          qrString: `FAKE-QR-${sudahAda}`,
          expiresAt: FAKE_EXPIRY,
        };
      }
      urutan += 1;
      const ref = `fake-trx-${urutan}`;
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

const MIDTRANS_SANDBOX = 'https://api.sandbox.midtrans.com';
const MIDTRANS_PRODUCTION = 'https://api.midtrans.com';

export type MidtransEnvironment = 'sandbox' | 'production';

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export interface MidtransOptions {
  serverKey: string;
  environment: MidtransEnvironment;
  /**
   * `fetch` global tersedia di Node 22 — tidak ada dependency baru. Ia
   * di-INJECT dan bukan dipanggil langsung supaya test dapat memeriksa bentuk
   * request tanpa jaringan.
   */
  fetchFn?: FetchLike;
}

/**
 * Pemetaan `transaction_status` Midtrans ke empat keadaan domain.
 *
 * Daftar TERTUTUP, dan default-nya `pending` — **bukan** `confirmed`.
 * `spec-c:320`: sistem tidak pernah menandai lunas tanpa konfirmasi gateway.
 * Status baru yang kelak ditambahkan Midtrans karena itu berarti "belum
 * dikonfirmasi", bukan "lunas". Menebak ke arah lain berarti menandai lunas
 * berdasarkan kata yang tidak kita mengerti.
 */
const STATUS_MAP: Readonly<Record<string, GatewayStatus>> = {
  settlement: 'confirmed',
  capture: 'confirmed',
  pending: 'pending',
  deny: 'failed',
  cancel: 'failed',
  failure: 'failed',
  expire: 'expired',
};

export function mapGatewayStatus(transactionStatus: unknown): GatewayStatus {
  if (typeof transactionStatus !== 'string') {
    return 'pending';
  }
  return STATUS_MAP[transactionStatus] ?? 'pending';
}

interface ChargeResponse {
  transaction_id?: string;
  actions?: Array<{ name?: string; url?: string }>;
  expiry_time?: string | null;
  status_message?: string;
}

/**
 * `expiry_time` Midtrans berformat `YYYY-MM-DD HH:mm:ss +0700` — bukan ISO
 * 8601, jadi `new Date()` menolaknya di sebagian runtime. Dikonversi ke
 * bentuk yang dapat diurai; bila tetap gagal, `null` (kedaluwarsa tidak
 * diketahui) lebih benar daripada `Invalid Date` yang akan tersimpan sebagai
 * NULL berisik atau melempar jauh dari sini.
 */
export function parseExpiry(raw: string | null | undefined): Date | null {
  if (typeof raw !== 'string' || raw.length === 0) {
    return null;
  }
  const iso = raw.replace(' ', 'T').replace(/ \+(\d{2})(\d{2})$/, '+$1:$2');
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface MidtransHttp {
  panggil(
    path: string,
    init: { method: string; headers?: Record<string, string>; body?: string }
  ): Promise<unknown>;
}

/**
 * Pipa HTTP Midtrans — base URL, HTTP Basic, dan penulisan ULANG pesan galat.
 *
 * ## ⛔ Dipisah supaya port KEDUA memakai pipa yang sama, bukan salinannya
 *
 * `SubscriptionProvider` (`./langganan.ts`) berbicara ke gateway yang sama
 * dengan kredensial yang sama. Menyalin fungsi ini ke sana berarti dua tempat
 * yang memutuskan apakah kredensial boleh muncul di pesan error — dan yang
 * kedua akan menyimpang tepat saat seseorang menambahkan `err.message` "biar
 * lebih mudah didiagnosis".
 *
 * Yang dijaga di sini dan tidak boleh hilang: pesan galat menyebut **status
 * HTTP dan nama error saja**. Error jaringan Node kadang memuat URL lengkap
 * beserta kredensial yang tertanam di dalamnya, dan pesan ini berakhir di log.
 */
export function createMidtransHttp(options: MidtransOptions): MidtransHttp {
  const { serverKey, environment } = options;
  const fetchFn: FetchLike = options.fetchFn ?? (globalThis.fetch as unknown as FetchLike);
  const baseUrl = environment === 'production' ? MIDTRANS_PRODUCTION : MIDTRANS_SANDBOX;

  // HTTP Basic: server key sebagai username, password kosong. Dihitung sekali
  // dan tidak pernah masuk ke pesan mana pun.
  const authorization = `Basic ${Buffer.from(`${serverKey}:`).toString('base64')}`;

  async function panggil(
    path: string,
    init: { method: string; headers?: Record<string, string>; body?: string }
  ): Promise<unknown> {
    let res;
    try {
      res = await fetchFn(`${baseUrl}${path}`, {
        method: init.method,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: authorization,
          ...(init.headers ?? {}),
        },
        body: init.body,
      });
    } catch (err) {
      // Pesan ditulis ULANG, bukan diteruskan. Error jaringan Node kadang
      // memuat URL lengkap beserta kredensial yang tertanam di dalamnya, dan
      // pesan ini akan berakhir di log.
      throw new Error(`Gateway pembayaran tidak dapat dihubungi: ${(err as Error).name}.`);
    }
    if (!res.ok) {
      // Status HTTP disebut supaya bisa didiagnosis; kredensial tidak.
      throw new Error(`Gateway pembayaran menolak permintaan (HTTP ${res.status}).`);
    }
    return res.json();
  }

  return { panggil };
}

export function createMidtransProvider(options: MidtransOptions): PaymentProvider {
  const { panggil } = createMidtransHttp(options);

  return {
    name: 'midtrans',

    async initiate(req: InitiateRequest): Promise<InitiateResult> {
      const body = await panggil('/v2/charge', {
        method: 'POST',
        headers: { 'X-Idempotency-Key': req.idempotencyKey },
        body: JSON.stringify({
          payment_type: 'qris',
          transaction_details: {
            // `order_id` di Midtrans harus unik per transaksi gateway. Yang
            // dipakai adalah id PAYMENT, bukan id order: satu order bisa
            // dibayar beberapa kali (bayar sebagian, lalu sisanya), dan
            // memakai id order akan membuat pembayaran kedua ditolak sebagai
            // duplikat.
            order_id: req.paymentId,
            gross_amount: Number(req.amount),
          },
          qris: { acquirer: 'gopay' },
          custom_field1: req.tenantId,
        }),
      }) as ChargeResponse;

      const qr = (body.actions ?? []).find((a) => a.name === 'generate-qr-code');
      return {
        providerReference: body.transaction_id ?? req.paymentId,
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
 * Menerima `env` sebagai argumen, bukan membaca `process.env` langsung.
 *
 * Bukan sekadar demi test: ia membuat "lingkungan mana yang dipakai" jadi
 * satu nilai yang dioper di satu titik (`buildApp`), bukan pembacaan global
 * yang bisa muncul di mana saja dan diam-diam berbeda antar modul.
 */
export function selectPaymentProvider(env: Record<string, string | undefined>): PaymentProvider {
  const pilihan = env.PAYMENT_PROVIDER ?? 'fake';

  if (pilihan === 'fake') {
    return createFakeProvider();
  }
  if (pilihan === 'midtrans') {
    const serverKey = (env.MIDTRANS_SERVER_KEY ?? '').trim();
    if (serverKey.length === 0) {
      // Gagal saat BOOT, bukan saat pelanggan pertama membayar. CI mengisi
      // kunci dengan string kosong, jadi keadaan ini bukan hipotetis — dan
      // gagal di tengah pembayaran adalah bentuk kegagalan yang jauh lebih
      // mahal daripada server yang menolak menyala.
      throw new Error('MIDTRANS_SERVER_KEY kosong sementara PAYMENT_PROVIDER=midtrans.');
    }
    const environment: MidtransEnvironment = env.MIDTRANS_ENV === 'production' ? 'production' : 'sandbox';
    return createMidtransProvider({ serverKey, environment });
  }

  // Default tertutup, pola yang sama dengan isTransitionAllowed: nilai yang
  // tidak dikenal ditolak, bukan diam-diam jatuh ke salah satu adapter.
  throw new Error(`PAYMENT_PROVIDER tidak dikenal: "${pilihan}". Pilihan: fake, midtrans.`);
}
