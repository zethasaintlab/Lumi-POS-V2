import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { PoolClient } from '../../db.ts';
import { HttpError } from '../../http-error.ts';

/**
 * Verifikasi kredensial perangkat — dipakai setiap endpoint yang dipanggil
 * oleh perangkat kasir, bukan oleh orang.
 *
 * Aturannya lahir bersama FR-F12 di `handlers/tokens.ts` dan tinggal di sini
 * sejak endpoint kedua membutuhkannya (telemetri klien, F6). Menyalinnya
 * adalah cara paling mudah membuat dua endpoint menolak dengan aturan yang
 * berbeda — dan yang berbeda diam-diam adalah yang lebih longgar.
 */

/**
 * `[KEPUTUSAN]` SHA-256, bukan Argon2id.
 *
 * `CLAUDE.md` menetapkan Argon2id untuk **password dan PIN** — rahasia
 * berentropi rendah yang dipilih manusia. Secret perangkat 256 bit dari
 * CSPRNG: tidak ada kamus yang menjangkaunya, dan KDF lambat hanya menambah
 * biaya pada setiap permintaan yang sah.
 *
 * Yang tetap berlaku: tidak pernah disimpan apa adanya, dan dibandingkan
 * timing-safe.
 */
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export function samaAman(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  // `timingSafeEqual` melempar bila panjangnya berbeda — itu sendiri
  // membocorkan panjang, tapi keduanya di sini selalu hash heksadesimal
  // 64 karakter, jadi panjangnya tidak membawa informasi.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export interface BarisDevice {
  id: string;
  tenant_id: string;
  outlet_id: string;
  token_hash: string | null;
  credentials_expire_at: string | null;
  revoked_at: string | null;
  /** Versi aplikasi yang terakhir dilaporkan perangkat. */
  app_version: string | null;
  /** F6 — penundaan update, dihitung PER VERSI. Lihat migrasi 0030. */
  update_deferrals: number;
  update_deferred_version: string | null;
}

/**
 * Pencarian device TUNDUK RLS, dan itu yang membuat `X-Tenant-Id` tetap
 * dituntut endpoint perangkat — tidak seperti webhook Midtrans, yang
 * satu-satunya endpoint tanpa header itu.
 *
 * Perangkat tahu tenant-nya sendiri. Berbohong tentang tenant tidak memberi
 * apa pun: device id-nya tidak akan ditemukan di sana. Alternatifnya —
 * mencari device di SELURUH tenant lalu menetapkan tenant dari hasilnya —
 * akan menjadi satu-satunya query di repo ini yang berjalan di luar RLS.
 */
export async function ambilDevice(client: PoolClient, deviceId: string): Promise<BarisDevice | null> {
  const { rows } = await client.query<BarisDevice>(
    `SELECT id, tenant_id, outlet_id, token_hash, credentials_expire_at, revoked_at,
            app_version, update_deferrals, update_deferred_version
       FROM device WHERE id = $1`,
    [deviceId]
  );
  return rows[0] ?? null;
}

/**
 * Satu pesan untuk SEMUA kegagalan otentikasi, dan itu disengaja.
 *
 * Membedakan "perangkat tidak ada" dari "secret salah" memberi tahu penyerang
 * bahwa id yang ditebaknya benar. Yang membedakannya hanya kode `EXPIRED`,
 * karena perangkat yang sah perlu tahu ia harus di-provisioning ulang
 * alih-alih mengira dirinya dicuri.
 */
export function tolak(kode = 'DEVICE_UNAUTHORIZED'): never {
  throw new HttpError(401, kode, 'Kredensial perangkat tidak sah, sudah dicabut, atau kedaluwarsa.');
}

/**
 * Bearer dari header `Authorization`.
 *
 * ⛔ Kredensial yang hilang dijawab 401, bukan 400 — karena itu header ini
 * tidak pernah ditandai `required` di OpenAPI. Validator akan menjawab 400,
 * dan 400 berarti "permintaan cacat" sementara yang dimaksud adalah
 * "buktikan siapa kamu".
 */
export function ambilBearer(req: FastifyRequest): string {
  const header = req.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) tolak();
  const secret = header.slice('Bearer '.length).trim();
  if (secret.length === 0) tolak();
  return secret;
}

/**
 * Memverifikasi perangkat dan memperbarui `last_seen_at` dalam satu langkah.
 *
 * ⛔ Kedaluwarsa diperiksa TERHADAP JAM DATABASE, di query yang sama yang
 * memperbarui `last_seen_at` — bukan dengan membandingkan string tanggal di
 * Node. Dua jam di dua mesin membuat "belum kedaluwarsa" dan "sudah"
 * berselisih milidetik, dan itu bug yang sudah pernah terjadi di repo ini.
 */
export async function verifikasiPerangkat(
  client: PoolClient,
  deviceId: string,
  secret: string
): Promise<BarisDevice> {
  const baris = await ambilDevice(client, deviceId);
  if (baris === null || baris.revoked_at !== null) tolak();
  if (baris.token_hash === null) tolak();
  if (!samaAman(baris.token_hash, hashSecret(secret))) tolak();

  const { rows } = await client.query<{ kedaluwarsa: boolean }>(
    `UPDATE device
        SET last_seen_at = now()
      WHERE id = $1
  RETURNING (credentials_expire_at IS NOT NULL AND credentials_expire_at <= now()) AS kedaluwarsa`,
    [deviceId]
  );
  if (rows[0].kedaluwarsa) tolak('DEVICE_CREDENTIALS_EXPIRED');
  return baris;
}
