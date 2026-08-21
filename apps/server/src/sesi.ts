import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool } from './db.ts';
import { withTenantTransaction } from './db.ts';
import { HttpError } from './http-error.ts';
import { operasiUntuk } from './rbac-rute.ts';
import { bolehkah } from '../../../packages/domain/src/rbac.ts';

/**
 * Verifikasi sesi back-office (FR-F2b) — hook `onRequest` fail-closed.
 *
 * Sebelum ini, `X-Actor-Id` adalah satu-satunya "identitas" yang dipegang
 * server: header biasa berisi id pengguna, tanpa apa pun yang membuktikan
 * pengirimnya adalah orang itu. Siapa pun yang tahu sepasang tenant_id +
 * user_id dapat memanggil seluruh permukaan back-office.
 *
 * ## ⛔ Jalur kasir TIDAK ikut dilindungi, dan itu dipaksa kenyataan
 *
 * Relay outbox (`packages/sync-client/src/http.ts`) mengirim TEPAT empat
 * header: `Content-Type`, `X-Tenant-Id`, `X-Actor-Id`, `Idempotency-Key`.
 * **Tidak ada Bearer sama sekali.** Perangkat kasir tidak pernah melakukan
 * login back-office — `spec-f:183` melarangnya secara eksplisit: "sesi
 * back-office kedaluwarsa; sesi kasir TIDAK — shift yang menentukan."
 *
 * Menuntut sesi pada keempat rute relay berarti **setiap penjualan offline
 * yang menyusul dijawab 401**. Itu bukan pengetatan keamanan; itu
 * menghancurkan jalur naik, satu-satunya hal yang membuat produk ini ada.
 *
 * Jadi yang ditutup di sini adalah permukaan BACK-OFFICE. Jalur perangkat
 * tetap terbuka sampai kredensial perangkat (FR-F12) menjadi kredensial
 * PERMINTAAN — pekerjaan tersendiri yang menyentuh klien relay, kredensial
 * offline 30 hari (OQ-08), dan perangkat yang berhari-hari tanpa jaringan.
 * Dinyatakan, bukan didiamkan.
 *
 * ## ⛔ Kenapa `X-Tenant-Id` MASIH dikirim pada rute terlindungi
 *
 * `user_session` tunduk RLS. Membacanya menuntut `app.tenant_id` sudah
 * di-`SET LOCAL` — dan nilainya belum diketahui sebelum sesinya ditemukan.
 * Ayam dan telur.
 *
 * Yang dipakai adalah pola yang SUDAH ada di repo ini untuk
 * `POST /devices/{id}/sync-token` (`CLAUDE.md`): tenant dari klien dipakai
 * sebagai **petunjuk pencarian**, bukan sebagai otoritas. Berbohong tidak
 * membeli apa pun — token milik tenant A tidak akan ditemukan saat dicari di
 * tenant B, dan hasilnya 401. Setelah barisnya ketemu, yang berlaku adalah
 * `tenant_id` dan `user_id` DARI BARIS ITU.
 *
 * Alternatifnya adalah fungsi `SECURITY DEFINER` yang menyelesaikan
 * `token_hash → (tenant_id, user_id)` di luar RLS. Lebih rapi secara
 * konsep, tapi ia menambah satu permukaan berprivilese di database untuk
 * membeli properti yang sudah dipunyai jalur di atas.
 *
 * ## Yang TIDAK dibangun di sini
 *
 * `spec-f:176` menulis "kedaluwarsa setelah 12 jam **tidak aktif**". Yang ada
 * hari ini adalah 12 jam **absolut** sejak login — `expires_at` tidak pernah
 * digeser, dan `last_seen_at` tidak pernah diisi. Itu perilaku yang sudah ada
 * sebelum berkas ini, bukan yang diperkenalkannya; menggesernya berarti satu
 * penulisan pada SETIAP permintaan untuk kolom yang belum dibaca siapa pun.
 */

export interface SesiTerverifikasi {
  sesiId: string;
  tenantId: string;
  userId: string;
  /** Peran pengguna ini. Kosong berarti tidak berhak apa pun (fail-closed). */
  peran: string[];
}

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Diisi middleware pada rute terlindungi, dan HANYA di sana.
     *
     * `getTenantId`/`getActorId` mengutamakannya di atas header — itulah yang
     * membuat header klien tidak dapat dipalsukan pada rute ini.
     */
    sesi?: SesiTerverifikasi;
  }
}

/**
 * Rute yang berjalan TANPA sesi back-office. Fail-closed: apa pun yang tidak
 * ada di sini WAJIB membawa sesi, termasuk endpoint yang ditambahkan besok.
 *
 * Kuncinya adalah pola rute Fastify (`req.routeOptions.url`), bukan URL
 * mentah — `/orders/abc/cancel` dan `/orders/def/cancel` adalah satu pola.
 */
interface Terbuka {
  metode: string;
  pola: string;
  alasan: string;
}

const RUTE_TERBUKA: readonly Terbuka[] = [
  { metode: 'GET', pola: '/health', alasan: 'probe kesehatan; tidak menyentuh data' },
  {
    metode: 'GET',
    pola: '/metrics',
    alasan:
      'metrik PROSES saja — nol data merchant (F6, `metrik.ts`). Scraper tidak punya sesi ' +
      'back-office, dan memberinya satu berarti kredensial manusia dipakai mesin. Dibatasi ' +
      'di lapisan jaringan',
  },
  {
    metode: 'POST',
    pola: '/tenants',
    alasan: 'pendaftaran mandiri — tenantnya belum ada. Dijaga rate limit, bukan sesi',
  },
  { metode: 'POST', pola: '/auth/login', alasan: 'inilah yang menerbitkan sesi' },
  {
    metode: 'POST',
    pola: '/webhooks/midtrans',
    alasan: 'diautentikasi TANDA TANGAN HMAC gateway, bukan sesi. Midtrans tidak punya akun di sini',
  },
  {
    metode: 'GET',
    pola: '/.well-known/jwks.json',
    alasan: 'kunci PUBLIK; menyembunyikannya membuat PowerSync tidak dapat memverifikasi token',
  },
  {
    metode: 'POST',
    pola: '/devices/:deviceId/sync-token',
    alasan: 'diautentikasi SECRET PERANGKAT di Bearer — kredensial berbeda, bukan sesi orang',
  },
  {
    metode: 'GET',
    pola: '/devices/:deviceId/update',
    alasan:
      'idem: diautentikasi SECRET PERANGKAT di Bearer. Perangkat menanyakan versinya ' +
      'sendiri, dan jendela update bawaan 03:00-06:00 adalah jam tidak ada orang yang login',
  },
  {
    metode: 'POST',
    pola: '/devices/:deviceId/update/defer',
    alasan:
      'idem: diautentikasi SECRET PERANGKAT di Bearer. "Nanti saja" ditekan di layar ' +
      'kasir, dan perangkat yang belum ada yang login tetap harus dapat menundanya',
  },
  {
    metode: 'POST',
    pola: '/devices/:deviceId/telemetry',
    alasan:
      'idem: diautentikasi SECRET PERANGKAT di Bearer. Telemetri dikirim penjadwal latar, ' +
      'sering saat tidak ada orang yang login — menuntut sesi berarti metrik hanya ada ' +
      'untuk perangkat yang kebetulan sedang dipakai, dan yang hilang justru perangkat ' +
      'yang bermasalah',
  },

  // --- jalur perangkat kasir ------------------------------------------------
  //
  // ⛔ Keempat rute ini dipanggil relay outbox, yang tidak mengirim Bearer
  // sama sekali. Melindunginya = setiap penjualan offline yang menyusul
  // dijawab 401. Lihat komentar kepala berkas.
  { metode: 'POST', pola: '/shifts', alasan: 'jalur perangkat: relay outbox' },
  { metode: 'POST', pola: '/orders', alasan: 'jalur perangkat: relay outbox' },
  { metode: 'POST', pola: '/orders/:orderId/cancel', alasan: 'jalur perangkat: relay outbox' },
  { metode: 'POST', pola: '/orders/:orderId/payments', alasan: 'jalur perangkat: relay outbox' },
  {
    metode: 'POST',
    pola: '/inventory/sold-out',
    alasan:
      'jalur perangkat: relay outbox. FR-E5 — barista menandai kopi habis di terminal 1, ' +
      'dan kasir di terminal 2 harus berhenti menerimanya. Memblokirnya berarti penandaan ' +
      'itu tidak pernah sampai ke perangkat lain',
  },
  {
    metode: 'POST',
    pola: '/payments/:paymentId/check-status',
    alasan:
      'jalur perangkat: kasir menunggu konfirmasi QRIS (FR-C14). Memblokirnya menahan kasir ' +
      'menyelesaikan pembayaran yang pelanggannya sudah bayar',
  },
];

const PETA_TERBUKA = new Set(RUTE_TERBUKA.map((r) => `${r.metode} ${r.pola}`));

/** Dipakai test untuk membandingkan daftar ini dengan rute yang benar-benar terdaftar. */
export const DAFTAR_RUTE_TERBUKA = RUTE_TERBUKA;

export function ruteTerbuka(metode: string, pola: string | undefined): boolean {
  if (pola === undefined) return true; // 404 — biarkan router yang menjawab
  // HEAD mengikuti GET-nya; Fastify mendaftarkan keduanya bersamaan.
  const m = metode === 'HEAD' ? 'GET' : metode;
  return PETA_TERBUKA.has(`${m} ${pola}`);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function samaAman(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function bacaBearer(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  const nilai = Array.isArray(header) ? header[0] : header;
  if (typeof nilai !== 'string' || !nilai.startsWith('Bearer ')) return null;
  const token = nilai.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}

/**
 * SATU penolakan untuk setiap sebab.
 *
 * Membedakan "token tidak ada" dari "token kedaluwarsa" dari "tenant salah"
 * memberi penebak peta untuk memperbaiki tebakannya. Sama seperti `tolakLogin`
 * di `handlers/auth.ts` (`spec-f:148`).
 */
function tolak(): never {
  throw new HttpError(401, 'SESSION_INVALID', 'Sesi tidak sah atau sudah berakhir.');
}

/**
 * ## ⛔ `onRequest`, bukan `preHandler`
 *
 * Urutan hook Fastify: `onRequest` → `preParsing` → `preValidation` →
 * **validasi skema** → `preHandler` → handler.
 *
 * Dipasang di `preHandler`, validasi OpenAPI berjalan LEBIH DULU — dan itu
 * terukur, bukan dugaan: `POST /items` dengan body `{}` tanpa Bearer menjawab
 * **400** (field wajib hilang), sementara body yang SAH menjawab 401. Artinya
 * pemanggil tanpa kredensial dapat memetakan bentuk request setiap endpoint
 * hanya dengan membaca selisih 400 versus 401.
 *
 * Tidak ada penulisan yang lolos di kedua kasus, jadi ini kebocoran informasi,
 * bukan lubang otorisasi. Tetap saja tidak ada alasan membayarnya: penjaga ini
 * hanya membutuhkan header, dan header sudah ada di `onRequest`. Memutuskan
 * lebih awal juga berarti permintaan tanpa kredensial tidak pernah membayar
 * biaya parsing body sama sekali.
 */
export function pasangPenjagaSesi(app: FastifyInstance, pool: Pool): void {
  app.addHook('onRequest', async (req) => {
    if (ruteTerbuka(req.method, req.routeOptions?.url)) return;

    const token = bacaBearer(req);
    if (token === null) tolak();

    // Petunjuk pencarian, BUKAN otoritas. Lihat komentar kepala berkas.
    const header = req.headers['x-tenant-id'];
    const tenantPetunjuk = Array.isArray(header) ? header[0] : header;
    if (typeof tenantPetunjuk !== 'string' || tenantPetunjuk.length === 0) tolak();

    const hash = hashToken(token);
    const baris = await withTenantTransaction(pool, tenantPetunjuk, async (client) => {
      // `expires_at > now()` memakai jam DATABASE, bukan jam Node. Aturan repo
      // ini ("waktu selalu dari jam database") lahir dari bug nyata di
      // resolusi harga; di sini konsekuensinya sama bentuknya — skew beberapa
      // milidetik menentukan sesi yang tepat di batas diterima atau ditolak.
      const { rows } = await client.query<{
        id: string;
        tenant_id: string;
        user_id: string;
        token_hash: string;
        peran: string[] | null;
      }>(
        `SELECT s.id, s.tenant_id, s.user_id, s.token_hash,
                -- ⛔ Peran diambil di query yang SAMA, bukan lewat SELECT
                -- kedua. Penjaga peran berjalan pada SETIAP permintaan ke
                -- permukaan back-office; satu round trip tambahan per
                -- permintaan adalah biaya yang tidak perlu dibayar.
                --
                -- array_agg menghasilkan {NULL} untuk pengguna tanpa
                -- peran, bukan array kosong; FILTER yang membuatnya
                -- benar-benar kosong. Pengguna tanpa peran harus ditolak
                -- fail-closed, dan array berisi satu NULL akan lolos setiap
                -- pemeriksaan panjang.
                array_agg(ur.role) FILTER (WHERE ur.role IS NOT NULL) AS peran
           FROM user_session s
           JOIN "user" u ON u.id = s.user_id
           LEFT JOIN user_role ur ON ur.user_id = s.user_id
          WHERE s.token_hash = $1
            AND s.expires_at > now()
            -- ⛔ Pengguna yang DINONAKTIFKAN kehilangan sesinya seketika.
            -- Tanpa baris ini, memecat kasir tidak mencabut apa pun sampai
            -- sesinya kedaluwarsa sendiri — sampai 12 jam kemudian.
            AND u.is_active = true
          GROUP BY s.id, s.tenant_id, s.user_id, s.token_hash`,
        [hash]
      );
      return rows[0] ?? null;
    });

    if (!baris || !samaAman(baris.token_hash, hash)) tolak();

    req.sesi = {
      sesiId: baris.id,
      tenantId: baris.tenant_id,
      userId: baris.user_id,
      peran: baris.peran ?? [],
    };

    // ## ⛔ Penjaga peran, di sini dan bukan di 30 handler
    //
    // Audit menemukan 34 endpoint mutasi tanpa penjaga peran sama sekali.
    // Menambalnya satu per satu memperbaiki ke-34 itu dan TIDAK memperbaiki
    // yang ke-35 — endpoint bulan depan lahir tanpa penjaga persis seperti
    // ke-34 ini lahir.
    //
    // `bolehkah` sendiri fail-closed: operasi tak dikenal ditolak untuk
    // SEMUA orang, termasuk owner. Jadi peta yang salah ketik menutup rute,
    // bukan membukanya.
    const operasi = operasiUntuk(req.method, req.routeOptions?.url);
    if (operasi !== null && !bolehkah(req.sesi.peran, operasi)) {
      throw new HttpError(
        403,
        'FORBIDDEN',
        `Pengguna ${req.sesi.userId} tidak berhak melakukan operasi ini.`
      );
    }
  });
}
