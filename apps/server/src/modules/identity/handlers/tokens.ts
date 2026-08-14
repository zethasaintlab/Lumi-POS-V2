import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from '../../../db.ts';
import { withTenantTransaction } from '../../../db.ts';
import { HttpError } from '../../../http-error.ts';
import { getTenantId } from '../../../tenant-context.ts';
import { jwksDari, tandatanganiJwt } from '../jwt.ts';

// FR-F12 -- token perangkat.
//
// `spec-f:242`: "Perangkat kasir adalah kelas perangkat yang AKAN hilang."
// Segalanya di berkas ini mengikuti dari kalimat itu: kredensial dapat
// dicabut, berumur terbatas, terikat satu perangkat, dan tidak pernah
// tersimpan apa adanya.

/**
 * `[KEPUTUSAN]` SHA-256, bukan Argon2id.
 *
 * `CLAUDE.md` menetapkan Argon2id untuk **password dan PIN** -- rahasia
 * berentropi rendah yang dipilih manusia, tempat KDF lambat adalah
 * satu-satunya pertahanan terhadap tebakan. Secret ini 256 bit dari CSPRNG:
 * tidak ada kamus yang menjangkaunya, dan KDF lambat hanya akan menambah
 * biaya pada setiap permintaan token yang sah.
 *
 * Yang tetap berlaku dari aturan itu: rahasianya tidak pernah disimpan apa
 * adanya, dan perbandingannya timing-safe.
 */
function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

function samaAman(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  // `timingSafeEqual` melempar bila panjangnya berbeda -- itu sendiri
  // membocorkan panjang, tapi keduanya di sini selalu hash heksadesimal
  // 64 karakter, jadi panjangnya tidak membawa informasi.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** OQ-08, diputuskan 7 Agustus 2026: batas kredensial offline 30 hari. */
const UMUR_KREDENSIAL_HARI = 30;

/**
 * Umur token sinkronisasi.
 *
 * `spec-f:247` menuntut "umur pendek + refresh". Refresh-nya di sini adalah
 * secret perangkat itu sendiri: klien meminta token baru kapan pun yang lama
 * hampir habis, dan PowerSync memanggil `fetchCredentials` ulang otomatis.
 * Lapisan refresh-token terpisah tidak menambah apa pun sebelum ada sesi
 * orang yang perlu dicabut secara terpisah dari perangkatnya.
 */
const UMUR_TOKEN_DETIK = 3600;

interface BarisDevice {
  id: string;
  tenant_id: string;
  outlet_id: string;
  token_hash: string | null;
  credentials_expire_at: string | null;
  revoked_at: string | null;
}

/**
 * Pencarian device TUNDUK RLS, dan itu yang membuat `X-Tenant-Id` tetap
 * dituntut endpoint ini -- tidak seperti webhook Midtrans, yang satu-satunya
 * endpoint tanpa header itu.
 *
 * Perangkat tahu tenant-nya sendiri. Berbohong tentang tenant tidak memberi
 * apa pun: device id-nya tidak akan ditemukan di sana. Alternatifnya --
 * mencari device di SELURUH tenant lalu menetapkan tenant dari hasilnya --
 * akan menjadi satu-satunya query di repo ini yang berjalan di luar RLS,
 * dan itu harga yang tidak perlu dibayar untuk menghemat satu header.
 */
async function ambilDevice(client: PoolClient, deviceId: string): Promise<BarisDevice | null> {
  const { rows } = await client.query<BarisDevice>(
    'SELECT id, tenant_id, outlet_id, token_hash, credentials_expire_at, revoked_at FROM device WHERE id = $1',
    [deviceId]
  );
  return rows[0] ?? null;
}

/**
 * Satu pesan untuk SEMUA kegagalan otentikasi, dan itu disengaja.
 *
 * Membedakan "perangkat tidak ada" dari "secret salah" memberi tahu penyerang
 * bahwa id yang ditebaknya benar. Yang membedakannya hanya kode `EXPIRED`,
 * karena perangkat yang sah perlu tahu ia harus di-provisioning ulang alih-alih
 * mengira dirinya dicuri.
 */
function tolak(kode = 'DEVICE_UNAUTHORIZED'): never {
  throw new HttpError(401, kode, 'Kredensial perangkat tidak sah, sudah dicabut, atau kedaluwarsa.');
}

function ambilBearer(req: FastifyRequest): string {
  const header = req.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) tolak();
  const secret = header.slice('Bearer '.length).trim();
  if (secret.length === 0) tolak();
  return secret;
}

export interface KonfigToken {
  /** PEM kunci privat RSA. String kosong = fitur tidak dikonfigurasi. */
  pemPrivat: string;
  /** URL layanan PowerSync yang dikembalikan bersama token. */
  powersyncUrl: string;
  /** Waktu di-inject, sejajar `Hlc` di `buildApp`. */
  sekarang: () => number;
}

export function createTokenHandlers(pool: Pool, konfig: KonfigToken): Record<string, unknown> {
  function wajibAdaKunci(): string {
    if (konfig.pemPrivat.trim().length === 0) {
      // 503, bukan gagal-saat-boot seperti adapter pembayaran: gagal boot
      // akan membuat setiap test dan setiap lingkungan pengembangan menuntut
      // kunci RSA hanya untuk menjalankan endpoint yang tidak dipakainya.
      // Preseden yang diikuti adalah webhook Midtrans dengan kunci kosong.
      throw new HttpError(
        503,
        'SYNC_TOKEN_NOT_CONFIGURED',
        'Kunci penandatangan token sinkronisasi belum diatur di server.'
      );
    }
    return konfig.pemPrivat;
  }

  return {
    async issueDeviceCredentials(req: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(req);
      const { deviceId } = req.params as { deviceId: string };

      const hasil = await withTenantTransaction(pool, tenantId, async (client) => {
        const device = await ambilDevice(client, deviceId);
        if (device === null || device.revoked_at !== null) {
          throw new HttpError(404, 'DEVICE_NOT_FOUND', `Device ${deviceId} tidak ditemukan atau sudah dicabut.`);
        }

        const secret = randomBytes(32).toString('base64url');
        // Batas waktu dihitung jam DATABASE, bukan jam Node. Pelajaran yang
        // sudah dicatat di CLAUDE.md: dua jam berbeda di dua mesin membuat
        // "belum kedaluwarsa" dan "sudah kedaluwarsa" berselisih milidetik.
        const { rows } = await client.query<{ credentials_expire_at: string }>(
          `UPDATE device
              SET token_hash = $2,
                  credentials_expire_at = now() + ($3 || ' days')::interval
            WHERE id = $1
        RETURNING credentials_expire_at`,
          [deviceId, hashSecret(secret), String(UMUR_KREDENSIAL_HARI)]
        );
        return { secret, expiresAt: rows[0].credentials_expire_at };
      });

      // Secret dikembalikan SEKALI. Ia tidak dapat dibaca lagi dari mana pun
      // -- yang tersimpan hanya hash-nya.
      reply.code(201);
      return { deviceId, secret: hasil.secret, expiresAt: hasil.expiresAt };
    },

    async issueSyncToken(req: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(req);
      const { deviceId } = req.params as { deviceId: string };
      const secret = ambilBearer(req);

      const device = await withTenantTransaction(pool, tenantId, async (client) => {
        const baris = await ambilDevice(client, deviceId);
        if (baris === null || baris.revoked_at !== null) tolak();
        if (baris.token_hash === null) tolak();
        if (!samaAman(baris.token_hash, hashSecret(secret))) tolak();

        // Kedaluwarsa diperiksa TERHADAP JAM DATABASE, di query yang sama
        // yang memperbarui `last_seen_at` -- bukan dengan membandingkan
        // string tanggal di Node.
        const { rows } = await client.query<{ kedaluwarsa: boolean }>(
          `UPDATE device
              SET last_seen_at = now()
            WHERE id = $1
        RETURNING (credentials_expire_at IS NOT NULL AND credentials_expire_at <= now()) AS kedaluwarsa`,
          [deviceId]
        );
        if (rows[0].kedaluwarsa) tolak('DEVICE_CREDENTIALS_EXPIRED');
        return baris;
      });

      const pem = wajibAdaKunci();
      const token = tandatanganiJwt({
        pemPrivat: pem,
        klaim: {
          sub: device.id,
          aud: 'powersync',
          // ⛔ TOP-LEVEL, bukan di dalam objek `parameters`. Diukur di
          // prototipe 05: `auth.parameter('x')` membaca `payload.x`. Salah
          // tempat berarti sync rules mencocokkan `tenant_id` dengan
          // `undefined`, dan yang turun bukan error melainkan NOL BARIS --
          // katalog kosong permanen tanpa satu pun keluhan.
          tenant_id: device.tenant_id,
          outlet_id: device.outlet_id,
        },
        berlakuDetik: UMUR_TOKEN_DETIK,
        sekarangMs: konfig.sekarang(),
      });

      reply.code(200);
      return { endpoint: konfig.powersyncUrl, token };
    },

    async getJwks(_req: FastifyRequest, reply: FastifyReply) {
      const pem = wajibAdaKunci();
      reply.code(200);
      return jwksDari(pem);
    },
  };
}
