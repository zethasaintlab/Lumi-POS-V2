import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from '../../../db.ts';
import { withTenantTransaction } from '../../../db.ts';
import { HttpError } from '../../../http-error.ts';
import { getTenantId } from '../../../tenant-context.ts';
import type { PinHasher } from '../../../../../../packages/domain/src/pin.ts';

// §9 PLAN-modul-f-identitas.md -- FR-F2b, login back-office.
//
// ⛔ Permukaan ini belum punya konsumen UI: layar B-01 menunggu F5
// (`ARCH:§14`). Dibangun sekarang karena FR-F2b adalah P0 dan seluruh
// aturannya dapat diuji lewat API. Dinyatakan, tidak didiamkan.

/** `spec-f:174`. */
const PANJANG_MINIMUM = 10;
/** `spec-f:176` — "sesi back-office kedaluwarsa setelah 12 jam tidak aktif". */
const UMUR_SESI_JAM = 12;

/**
 * Daftar password bocor yang di-bundle (`spec-f:174`).
 *
 * ⛔ Daftar ini SENGAJA kecil, dan itu bukan penyelesaian setengah. Daftar
 * sungguhan (rockyou, HIBP) berukuran ratusan megabita dan tidak dapat
 * di-bundle; memakainya menuntut layanan eksternal — yang berarti pendaftaran
 * password gagal saat internet mati, di produk yang seluruh nilainya adalah
 * berfungsi tanpa internet.
 *
 * Yang ada di sini adalah pola yang benar-benar muncul di merchant Indonesia
 * ditambah yang universal. Ia menangkap tebakan pertama, bukan serangan
 * kamus — dan yang menahan serangan kamus adalah Argon2id, bukan daftar ini.
 *
 * Batas ini dicatat supaya tidak dibaca sebagai perlindungan yang lebih besar
 * daripada adanya.
 */
const PASSWORD_BOCOR: ReadonlySet<string> = new Set([
  'password', 'password1', 'password12', 'password123', 'password1234',
  'qwerty12345', '1234567890', '12345678901', 'admin12345', 'administrator',
  'iloveyou12', 'letmein1234', 'welcome1234', 'abcd123456', 'passw0rd123',
  'indonesia1', 'indonesia123', 'jakarta1234', 'bismillah123', 'rahasia123',
]);

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function samaAman(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Satu penolakan untuk SEMUA kegagalan login.
 *
 * AC `spec-f:148`: "Pesan kegagalan tidak membocorkan keberadaan pengguna."
 * Selisih apa pun antara "email tidak ada" dan "password salah" adalah oracle
 * enumerasi email — dan email back-office adalah email owner merchant.
 */
function tolakLogin(): never {
  throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email atau password salah.');
}

interface BarisLogin {
  id: string;
  password_hash: string | null;
}

export function createAuthHandlers(pool: Pool, hasher: PinHasher): Record<string, unknown> {
  return {
    async setUserPassword(req: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(req);
      const { userId } = req.params as { userId: string };
      const { password } = req.body as { password: string };

      await withTenantTransaction(pool, tenantId, async (client: PoolClient) => {
        const { rows } = await client.query('SELECT id, email FROM "user" WHERE id = $1', [userId]);
        if (rows.length === 0) {
          throw new HttpError(404, 'USER_NOT_FOUND', `Pengguna ${userId} tidak ditemukan.`);
        }

        if (typeof password !== 'string' || password.length < PANJANG_MINIMUM) {
          throw new HttpError(
            400,
            'PASSWORD_TOO_SHORT',
            `Password minimal ${PANJANG_MINIMUM} karakter.`
          );
        }
        if (PASSWORD_BOCOR.has(password.toLowerCase())) {
          throw new HttpError(
            400,
            'PASSWORD_BREACHED',
            'Password ini termasuk yang paling sering dipakai dan sudah pernah bocor. Pilih yang lain.'
          );
        }

        // Argon2id yang SAMA dengan PIN. `spec-f:173` menuntutnya, dan
        // memakai hasher yang sama berarti parameternya tidak dapat menyimpang
        // di antara keduanya.
        const phc = await hasher.hash(password);
        await client.query('UPDATE "user" SET password_hash = $2 WHERE id = $1', [userId, phc]);
      });

      reply.code(204);
      return null;
    },

    async login(req: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(req);
      const { email, password } = req.body as { email?: string | null; password?: string };

      // Bentuk diperiksa lebih dulu, tapi jawabannya tetap 401 yang sama.
      if (typeof email !== 'string' || email.length === 0 || typeof password !== 'string') {
        tolakLogin();
      }

      const hasil = await withTenantTransaction(pool, tenantId, async (client) => {
        // ⛔ `password_hash IS NOT NULL`, dan itu yang menegakkan
        // `spec-f:150`: "kasir tidak menerima login password" — dan
        // sebaliknya, PIN tidak dapat dipakai di sini. Kalau `pin_hash` ikut
        // dicoba, permukaan laptop mewarisi kekuatan enam digit.
        //
        // `email IS NOT NULL` mengikuti dari kolomnya sendiri, tapi ditulis
        // eksplisit: `spec-f:184` menyatakan pengguna tanpa email memang tidak
        // boleh masuk, dan itu perilaku yang disengaja, bukan efek samping.
        const { rows } = await client.query<BarisLogin>(
          `SELECT id, password_hash FROM "user"
            WHERE email = $1 AND email IS NOT NULL
              AND password_hash IS NOT NULL AND is_active = true`,
          [email]
        );
        const pengguna = rows[0];

        // Verifikasi dijalankan MESKI penggunanya tidak ada, terhadap hash
        // buangan. Tanpa itu, "email tidak ada" menjawab dalam mikrodetik
        // sementara "password salah" butuh 23 ms — dan selisih itu adalah
        // oracle yang sama yang pesan seragam di atas berusaha tutup.
        const hashUji =
          pengguna?.password_hash ??
          '$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
        const cocok = await hasher.verifikasi(password, hashUji);
        if (!pengguna || !cocok) tolakLogin();

        const token = randomBytes(32).toString('base64url');
        const { rows: sesi } = await client.query<{ expires_at: string }>(
          `INSERT INTO user_session (id, tenant_id, user_id, token_hash, expires_at)
           VALUES ($1, $2, $3, $4, now() + ($5 || ' hours')::interval)
           RETURNING expires_at`,
          [randomUUID(), tenantId, pengguna.id, hashToken(token), String(UMUR_SESI_JAM)]
        );

        const { rows: peran } = await client.query<{ role: string }>(
          'SELECT role FROM user_role WHERE user_id = $1 ORDER BY role',
          [pengguna.id]
        );

        return {
          token,
          expiresAt: sesi[0].expires_at,
          userId: pengguna.id,
          roles: peran.map((p) => p.role),
        };
      });

      reply.code(200);
      return hasil;
    },

    async logout(req: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(req);
      const header = req.headers.authorization;
      const nilai = Array.isArray(header) ? header[0] : header;
      if (typeof nilai !== 'string' || !nilai.startsWith('Bearer ')) {
        throw new HttpError(401, 'SESSION_INVALID', 'Sesi tidak sah atau sudah berakhir.');
      }
      const token = nilai.slice('Bearer '.length).trim();

      await withTenantTransaction(pool, tenantId, async (client) => {
        // Baris benar-benar DIHAPUS, bukan ditandai. Sesi yang hanya ditandai
        // tetap dapat dihidupkan lagi oleh siapa pun yang dapat menulis ke
        // tabel, dan tidak ada yang membutuhkan riwayat sesi back-office.
        const { rows } = await client.query<{ token_hash: string }>(
          'DELETE FROM user_session WHERE token_hash = $1 RETURNING token_hash',
          [hashToken(token)]
        );
        if (rows.length === 0 || !samaAman(rows[0].token_hash, hashToken(token))) {
          throw new HttpError(401, 'SESSION_INVALID', 'Sesi tidak sah atau sudah berakhir.');
        }
      });

      reply.code(204);
      return null;
    },
  };
}
