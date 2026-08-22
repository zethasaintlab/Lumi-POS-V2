import { randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool } from '../../../db.ts';
import { withTenantTransaction } from '../../../db.ts';
import { HttpError } from '../../../http-error.ts';
import { getTenantId } from '../../../tenant-context.ts';
import { jwksDari, tandatanganiJwt } from '../jwt.ts';
// Aturan kredensial perangkat tinggal di satu tempat sejak endpoint kedua
// (telemetri klien, F6) membutuhkannya. Lihat `../kredensial-perangkat.ts`.
import { ambilBearer, ambilDevice, hashSecret, verifikasiPerangkat } from '../kredensial-perangkat.ts';

// FR-F12 -- token perangkat.
//
// `spec-f:242`: "Perangkat kasir adalah kelas perangkat yang AKAN hilang."
// Segalanya di berkas ini mengikuti dari kalimat itu: kredensial dapat
// dicabut, berumur terbatas, terikat satu perangkat, dan tidak pernah
// tersimpan apa adanya.

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

      const device = await withTenantTransaction(pool, tenantId, (client) =>
        verifikasiPerangkat(client, deviceId, secret)
      );

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
