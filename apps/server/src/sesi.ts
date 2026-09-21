import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool } from './db.ts';
import { withTenantTransaction } from './db.ts';
import { HttpError } from './http-error.ts';
import { operasiUntuk } from './rbac-rute.ts';
import { bolehkah } from '../../../packages/domain/src/rbac.ts';
import { bolehLewatSupport } from '../../../packages/domain/src/sesi-support.ts';
import { mulaiKonteks, setelSesiSupport } from './konteks-permintaan.ts';

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
  /**
   * F.5 — diisi HANYA bila permintaan ini datang lewat token akses support.
   *
   * ⛔ `userId` pada sesi support adalah OWNER YANG MENYETUJUI, bukan petugas
   * support: `audit_event.actor_user_id` `NOT NULL` ber-FK ke `"user"`, dan
   * staf kami tidak punya baris di sana (`"user"` ber-`tenant_id` dan tunduk
   * RLS). Owner itu memang orang yang bertanggung jawab atas akses ini.
   *
   * Field inilah PENANDA yang `spec-f:412` tuntut — yang mencegah pembaca
   * audit menyimpulkan bahwa owner sendiri yang melakukannya.
   */
  supportSessionId?: string;
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
  /**
   * Sesi TIDAK dituntut, tapi DITEGAKKAN bila pemanggil membawanya.
   *
   * ⛔ Ini untuk jalur perangkat kasir, dan ia menutup lubang yang nyata:
   * rute yang sepenuhnya terbuka membuat `X-Actor-Id` kembali dipercaya
   * SEKALIPUN pemanggilnya sebenarnya punya sesi. Akibatnya akuntan yang
   * login di back-office dapat memanggil rute perangkat atas nama siapa pun
   * — kontrol peran yang `spec-f:82` tuntut menguap tanpa satu pun error.
   *
   * Ditemukan saat `/shifts/{id}/no-sale` ditambahkan ke daftar ini:
   * test "AKUNTAN ditolak" berubah dari 403 menjadi 201.
   *
   * Relay outbox tidak mengirim `Authorization` sama sekali (lihat komentar
   * kepala berkas), jadi ia lewat apa adanya. Yang membawa Bearer diverifikasi
   * — dan Bearer yang tidak sah ditolak 401 alih-alih diabaikan.
   *
   * ⛔ TIDAK dipasang pada rute berkredensial PERANGKAT
   * (`sync-token`, `telemetry`, `update`): Bearer di sana adalah secret
   * perangkat, bukan token sesi, dan memverifikasinya sebagai sesi menolak
   * perangkat yang sah.
   */
  sesiOpsional?: true;
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
    metode: 'GET',
    pola: '/devices/:deviceId/features',
    alasan:
      'idem: diautentikasi SECRET PERANGKAT di Bearer. Kill switch harus sampai ke ' +
      'perangkat yang tidak ada orangnya — justru itu keadaan yang membuatnya dibutuhkan',
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
  { metode: 'POST', pola: '/shifts', alasan: 'jalur perangkat: relay outbox', sesiOpsional: true },
  { metode: 'POST', pola: '/orders', alasan: 'jalur perangkat: relay outbox', sesiOpsional: true },
  { metode: 'POST', pola: '/orders/:orderId/cancel', alasan: 'jalur perangkat: relay outbox', sesiOpsional: true },
  { metode: 'POST', pola: '/orders/:orderId/payments', alasan: 'jalur perangkat: relay outbox', sesiOpsional: true },
  {
    metode: 'POST',
    pola: '/inventory/sold-out',
    alasan:
      'jalur perangkat: relay outbox. FR-E5 — barista menandai kopi habis di terminal 1, ' +
      'dan kasir di terminal 2 harus berhenti menerimanya. Memblokirnya berarti penandaan ' +
      'itu tidak pernah sampai ke perangkat lain',
    sesiOpsional: true,
  },
  {
    metode: 'POST',
    pola: '/shifts/:shiftId/no-sale',
    alasan:
      'jalur perangkat: relay outbox. FR-D7 — kasir membuka laci DI KASIR, sering saat ' +
      'perangkat offline, dan `IA:66` menandai K-16 "Kasir + alasan". Sebelum baris ini ' +
      'ada, SETIAP no-sale yang dibuat offline dijawab 401 dan berhenti permanen di ' +
      'antrean: laci sudah terbuka dan servernya tidak pernah tahu. Yang menjaganya ' +
      'tetap `assertBoleh(shift_open_close)` di handler plus AMBANG FREKUENSI',
    sesiOpsional: true,
  },
  {
    metode: 'POST',
    pola: '/peripherals',
    alasan:
      'jalur perangkat: relay outbox. K-15 bertanda ✅ offline (`IA:65`) — kasir memilih ' +
      'profil printernya tanpa jaringan, dan barisnya di-relay belakangan. Rute jalur ' +
      'perangkat yang hanya `DIKECUALIKAN` dijawab 401 lalu berhenti permanen di antrean; ' +
      'ini kemunculan KEEMPAT bentuk cacat itu (refund offline 21 Agu, kas manual 24 Agu, ' +
      'abandon). Yang menjaganya tetap `assertBoleh(shift_open_close)` di handler',
    sesiOpsional: true,
  },
  {
    metode: 'POST',
    pola: '/orders/:orderId/abandon',
    alasan:
      'jalur perangkat: FR-C3. Kasir membatalkan draf QRIS dinamis DI KASIR, dan relay ' +
      'outbox tidak mengirim Bearer sama sekali. Tanpa baris ini pembatalan dijawab 401 ' +
      'dan stok tetap terkunci sampai pembersihan massal berumur 24 jam menyentuhnya. ' +
      'Yang menjaganya `assertBoleh(sale)` di handler plus penolakan 409 untuk order ' +
      'yang sudah dibayar',
    sesiOpsional: true,
  },
  {
    metode: 'POST',
    pola: '/shifts/:shiftId/count-attempts',
    alasan:
      'jalur perangkat: relay outbox. FR-D2 — percobaan hitungan terjadi DI KASIR saat ' +
      'tutup kas, dan tutup kas berjalan tanpa jaringan. Jejak yang dijawab 401 lalu ' +
      'berhenti di antrean adalah jejak yang tidak ada, dan yang paling perlu dijejaki ' +
      'justru percobaan yang gagal. Yang menjaganya `assertBoleh(shift_open_close)`',
    sesiOpsional: true,
  },
  {
    metode: 'POST',
    pola: '/shifts/:shiftId/cash-movements',
    alasan:
      'jalur perangkat: relay outbox. FR-D5 — uang keluar dari laci DI KONTER, saat shift ' +
      'berjalan, dan sering justru saat internet mati (itu saat orang membayar pemasok ' +
      'tunai). Tanpa baris ini, SETIAP kas masuk/keluar yang dicatat offline dijawab 401 ' +
      'dan berhenti permanen di antrean — bentuk cacat yang PERSIS sama dengan refund ' +
      'offline, dan akibatnya lebih buruk: server tetap menghitung uang yang sudah tidak ' +
      'ada di laci, lalu tutup kas berikutnya menuduh kasirnya atas selisih yang justru ' +
      'sudah dicatat. Yang menjaganya tetap `assertBoleh(shift_open_close)` di handler ' +
      '(menutup akuntan, `spec-f:82`) plus alasan daftar tertutup dan audit',
    sesiOpsional: true,
  },
  {
    metode: 'POST',
    pola: '/payments/:paymentId/check-status',
    alasan:
      'jalur perangkat: kasir menunggu konfirmasi QRIS (FR-C14). Memblokirnya menahan kasir ' +
      'menyelesaikan pembayaran yang pelanggannya sudah bayar',
    sesiOpsional: true,
  },
];

const PETA_TERBUKA = new Map(RUTE_TERBUKA.map((r) => [`${r.metode} ${r.pola}`, r]));

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

/**
 * F.5 — menyelesaikan token akses support menjadi sesi.
 *
 * ⛔ `now()` DATABASE, bukan jam Node, dan ia dibaca di transaksi yang sama
 * dengan barisnya. Sesi support berbatas waktu; dua mesin yang jamnya
 * berselisih beberapa detik memutuskan berbeda tepat di batas — dan batas itu
 * adalah momen akses ke data merchant seharusnya berhenti.
 *
 * ⛔ Kedaluwarsa TIDAK disaring di SQL. Ia dihitung `bolehLewatSupport` di
 * domain, supaya sesi yang kedaluwarsa dapat dibedakan dari token yang tidak
 * pernah ada: yang pertama menjawab `SUPPORT_SESSION_EXPIRED` ("mintalah
 * persetujuan baru"), yang kedua menjawab 401 seperti token asing mana pun.
 * Petugas support yang menerima 401 untuk sesi yang baru saja kedaluwarsa
 * akan menyimpulkan tokennya salah dan meminta merchant mengulang seluruh
 * prosesnya.
 */
async function resolusiSupport(
  pool: Pool,
  tenantPetunjuk: string,
  hash: string
): Promise<{
  id: string;
  tenantId: string;
  grantedBy: string;
  peran: string[];
  sesi: { expiresAt: Date; endedAt: Date | null; isWriteEnabled: boolean };
  sekarang: Date;
} | null> {
  return withTenantTransaction(pool, tenantPetunjuk, async (client) => {
    const { rows } = await client.query<{
      id: string;
      tenant_id: string;
      granted_by: string;
      token_hash: string;
      expires_at: Date;
      ended_at: Date | null;
      is_write_enabled: boolean;
      sekarang: Date;
      peran: string[] | null;
    }>(
      `SELECT s.id, s.tenant_id, s.granted_by, s.token_hash,
              s.expires_at, s.ended_at, s.is_write_enabled,
              now() AS sekarang,
              array_agg(ur.role) FILTER (WHERE ur.role IS NOT NULL) AS peran
         FROM support_session s
         JOIN "user" u ON u.id = s.granted_by
         LEFT JOIN user_role ur ON ur.user_id = s.granted_by
        WHERE s.token_hash = $1
          -- ⛔ Owner yang DINONAKTIFKAN mencabut sesi support yang ia beri.
          -- Persetujuan itu miliknya; orang yang sudah tidak ada di merchant
          -- tidak dapat terus mengizinkan akses atas namanya.
          AND u.is_active = true
        GROUP BY s.id, s.tenant_id, s.granted_by, s.token_hash,
                 s.expires_at, s.ended_at, s.is_write_enabled`,
      [hash]
    );
    const baris = rows[0];
    if (!baris || !samaAman(baris.token_hash, hash)) return null;
    return {
      id: baris.id,
      tenantId: baris.tenant_id,
      grantedBy: baris.granted_by,
      peran: baris.peran ?? [],
      sesi: {
        expiresAt: baris.expires_at,
        endedAt: baris.ended_at,
        isWriteEnabled: baris.is_write_enabled,
      },
      sekarang: baris.sekarang,
    };
  });
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
  // ⛔ Hook TERSENDIRI, dan ia SINKRON. `enterWith` harus berjalan sebelum satu
  // `await` pun di rantai permintaan ini; dipanggil dari dalam hook async di
  // bawah (yang menunggu query verifikasi token lebih dulu), storenya hanya
  // mencakup kelanjutan hook itu dan hilang sebelum handler. Terukur, bukan
  // dugaan: penandanya mendarat `null`.
  app.addHook('onRequest', (_req, _reply, selesai) => {
    mulaiKonteks();
    selesai();
  });

  app.addHook('onRequest', async (req) => {
    // ⛔ HEAD dinormalkan ke GET, sama seperti `ruteTerbuka`. Tanpa itu
    // `HEAD /health` tidak cocok entri mana pun lalu dituntut sesi — probe
    // kesehatan dijawab 401, dan yang membacanya menyimpulkan server mati.
    const metode = req.method === 'HEAD' ? 'GET' : req.method;
    const terbuka = req.routeOptions?.url
      ? PETA_TERBUKA.get(`${metode} ${req.routeOptions.url}`)
      : undefined;
    // Pola yang tidak dikenal (404) dibiarkan router yang menjawab, sama
    // seperti `ruteTerbuka`.
    if (req.routeOptions?.url === undefined) return;
    if (terbuka !== undefined && terbuka.sesiOpsional !== true) return;

    const token = bacaBearer(req);
    // ⛔ Jalur perangkat tanpa Bearer lewat apa adanya — relay outbox memang
    // tidak mengirimnya, dan menuntutnya berarti setiap penjualan offline
    // yang menyusul dijawab 401. Yang MEMBAWA Bearer tetap diverifikasi.
    if (token === null) {
      if (terbuka !== undefined) return;
      tolak();
    }

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

    if (!baris) {
      // ⛔ Token support dicoba SESUDAH sesi pengguna, bukan sebelumnya.
      // Permintaan back-office biasa — yang jumlahnya ribuan kali lebih
      // banyak — karena itu tidak pernah membayar query kedua.
      const support = await resolusiSupport(pool, tenantPetunjuk, hash);
      if (support === null) tolak();

      // ⛔ Mutasi diputuskan dari METODE HTTP, bukan dari peta operasi RBAC.
      // Peta itu tidak mencakup setiap rute, dan rute yang tidak ada di sana
      // akan lolos gerbang tulis diam-diam. Metode mencakup semuanya,
      // termasuk endpoint yang lahir bulan depan — fail-closed by default.
      const mutasi = metode !== 'GET';
      const izin = bolehLewatSupport(support.sesi, support.sekarang, mutasi);
      if (!izin.boleh) throw new HttpError(403, izin.kode, izin.pesan);

      // ⛔ TIDAK `return` di sini. Penjaga peran di bawah harus tetap
      // berjalan: sesi support meminjam peran owner yang menyetujui, dan
      // melewatinya berarti akses support adalah satu-satunya jalan di sistem
      // ini yang tidak tunduk RBAC sama sekali.
      req.sesi = {
        sesiId: support.id,
        tenantId: support.tenantId,
        userId: support.grantedBy,
        peran: support.peran,
        supportSessionId: support.id,
      };
      // ⛔ Penanda dipasang SEKALI di sini, bukan diteruskan ke setiap
      // pemanggil `recordAuditEvent`. Lihat `konteks-permintaan.ts`: penanda
      // yang harus diingat di setiap pemanggil (25 hari ini) akan terlupa di yang
      // berikutnya, dan yang terlupa
      // menisbatkan tindakan support kepada owner merchant secara pribadi.
      setelSesiSupport(support.id);
    } else {
      if (!samaAman(baris.token_hash, hash)) tolak();

      req.sesi = {
        sesiId: baris.id,
        tenantId: baris.tenant_id,
        userId: baris.user_id,
        peran: baris.peran ?? [],
      };
    }

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
