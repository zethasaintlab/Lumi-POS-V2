import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Pool, PoolClient } from '../../../db.ts';
import { withTenantTransaction } from '../../../db.ts';
import { HttpError } from '../../../http-error.ts';
import { getTenantId } from '../../../tenant-context.ts';
import type { PinHasher } from '../../../../../../packages/domain/src/pin.ts';
import { periksaPassword } from '../../../../../../packages/domain/src/password.ts';

// §9 PLAN-modul-f-identitas.md -- FR-F2b, login back-office.
//
// ⛔ Permukaan ini belum punya konsumen UI: layar B-01 menunggu F5
// (`ARCH:§14`). Dibangun sekarang karena FR-F2b adalah P0 dan seluruh
// aturannya dapat diuji lewat API. Dinyatakan, tidak didiamkan.

/** `spec-f:176` — "sesi back-office kedaluwarsa setelah 12 jam tidak aktif". */
const UMUR_SESI_JAM = 12;

// Aturan panjang dan daftar password bocor DULU tinggal di berkas ini sebagai
// konstanta privat. Keduanya pindah ke `packages/domain/src/password.ts` saat
// pendaftaran merchant (F5) menjadi jalur KEDUA yang menetapkan password —
// dua salinan aturan yang sama adalah dua salinan yang akan menyimpang, dan
// tidak ada apa pun yang gagal pada saat penyimpangan itu terjadi.

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
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

        const periksa = periksaPassword(password);
        if (!periksa.ok) {
          throw new HttpError(400, periksa.kode, periksa.pesan);
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
      const { email, password } = req.body as { email?: string | null; password?: string };

      // Bentuk diperiksa lebih dulu, tapi jawabannya tetap 401 yang sama.
      if (typeof email !== 'string' || email.length === 0 || typeof password !== 'string') {
        tolakLogin();
      }

      // ## ⛔ `X-Tenant-Id` menjadi OPSIONAL di sini, dan hanya di sini
      //
      // Merchant tidak menghafal UUID tenantnya. Layar masuk yang menuntutnya
      // adalah layar yang tidak dapat dipakai siapa pun yang baru mendaftar.
      //
      // Kalau header tidak dikirim, tenant diresolusi dari email lewat
      // `resolve_login_tenant` (migrasi 0023) — fungsi `SECURITY DEFINER`
      // sesempit mungkin, karena `"user"` tunduk RLS dan tenant yang dicari
      // justru yang belum diketahui.
      //
      // ⛔ Resolusinya TIDAK diekspos sebagai endpoint. Endpoint "cari tenant
      // dari email" adalah oracle enumerasi, dan email back-office adalah
      // email owner merchant (`spec-f:148`). Di sini ia hidup di dalam jalur
      // yang sudah menuntut password dan sudah menjawab SATU pesan untuk
      // setiap kegagalan — penyerang tidak mendapat apa pun yang tidak sudah
      // dapat ia coba.
      //
      // Header tetap DIHORMATI bila dikirim: merchant yang emailnya terdaftar
      // di dua tenant harus dapat menyebut yang mana, dan aplikasi kasir sudah
      // mengirimnya.
      const headerTenant = req.headers['x-tenant-id'];
      const dariHeader = Array.isArray(headerTenant) ? headerTenant[0] : headerTenant;

      let tenantId: string;
      if (typeof dariHeader === 'string' && dariHeader.length > 0) {
        tenantId = dariHeader;
      } else {
        const { rows } = await pool.query<{ resolve_login_tenant: string | null }>(
          'SELECT resolve_login_tenant($1)',
          [email]
        );
        const hasil = rows[0]?.resolve_login_tenant ?? null;
        // ⛔ Penolakan yang SAMA dengan password salah. Membedakannya berarti
        // memberi tahu penebak bahwa emailnya ada — persis yang
        // `tolakLogin` dibuat untuk tutup.
        if (hasil === null) tolakLogin();
        tenantId = hasil;
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
      // ⛔ Tokennya TIDAK dibaca lagi di sini.
      //
      // Berkas ini dulu memverifikasi Bearer sendiri — membaca header, meng-
      // hash, mencocokkan. Sejak `pasangPenjagaSesi` ada, verifikasi itu
      // sudah terjadi di `preHandler`, dan permintaan yang sampai ke sini
      // PASTI membawa sesi yang sah.
      //
      // Memeriksanya dua kali bukan sekadar mubazir: kedua pemeriksaan
      // menjawab dengan status dan kode yang sama persis, jadi salah satunya
      // dapat dimatikan sepenuhnya tanpa satu test pun merah. Itu bentuk yang
      // sama dengan temuan 7 Agustus di penyetuju refund (`CLAUDE.md`) —
      // "guard yang tidak dapat DIBEDAKAN dari luar adalah guard yang tidak
      // teruji".
      const sesi = req.sesi;
      if (!sesi) {
        // Tidak dapat terjadi: `/auth/logout` tidak ada di `RUTE_TERBUKA`.
        // Ditulis fail-closed supaya rute ini tidak diam-diam menjadi terbuka
        // kalau daftar itu disunting keliru.
        throw new HttpError(401, 'SESSION_INVALID', 'Sesi tidak sah atau sudah berakhir.');
      }

      await withTenantTransaction(pool, sesi.tenantId, async (client) => {
        // Baris benar-benar DIHAPUS, bukan ditandai. Sesi yang hanya ditandai
        // tetap dapat dihidupkan lagi oleh siapa pun yang dapat menulis ke
        // tabel, dan tidak ada yang membutuhkan riwayat sesi back-office.
        //
        // Dihapus lewat `id` dari sesi terverifikasi, bukan lewat hash token
        // yang dibaca ulang dari header.
        await client.query('DELETE FROM user_session WHERE id = $1', [sesi.sesiId]);
      });

      reply.code(204);
      return null;
    },
  };
}
