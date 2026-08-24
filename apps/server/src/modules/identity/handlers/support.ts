import { randomUUID, randomBytes, createHash } from 'node:crypto';
import type { Pool } from '../../../db.ts';
import { withTenantTransaction } from '../../../db.ts';
import { HttpError } from '../../../http-error.ts';
import { getTenantId, getActorId } from '../../../tenant-context.ts';
import { assertUserVisible, assertBoleh } from '../index.ts';
import { recordAuditEvent } from '../../audit/index.ts';
import {
  periksaPermintaanSupport,
  keadaanSesi,
  sisaMenit,
  DURASI_BAWAAN_MENIT,
} from '../../../../../../packages/domain/src/sesi-support.ts';
import type { Hlc } from '../../../../../../packages/domain/src/hlc.ts';
import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * F.5 — akses support (`spec-f:391`).
 *
 * *"Untuk mendukung ratusan merchant, akses support diperlukan — tetapi harus
 * menjadi fitur SISTEM, bukan akses database langsung."*
 *
 * ## ⛔ Yang membuat AC pertama benar
 *
 * *"Akses support tanpa persetujuan merchant tidak mungkin"* (`spec-f:409`).
 * Itu bukan sesuatu yang dijaga pemeriksaan; ia sifat bentuknya. Token akses
 * **hanya ada** sebagai keluaran dari permintaan yang owner sendiri kirim, dan
 * ia tidak dapat dibaca kembali sesudahnya — tidak ada endpoint, di mana pun,
 * yang menerbitkan token support tanpa owner menekan tombolnya.
 *
 * ## ⛔ Token dikembalikan SEKALI dan tidak pernah lagi
 *
 * Yang tersimpan `token_hash` (SHA-256), sejajar `user_session` dan
 * `device.token_hash`. Konsekuensinya dinyatakan di layar: owner yang
 * kehilangan tokennya mengakhiri sesi ini dan memberi persetujuan baru — ia
 * tidak dapat "melihatnya lagi", dan itu justru yang membuat baris tabel ini
 * tidak dapat dipakai menyamar.
 *
 * ## ⛔ Read-only adalah BAWAAN, dan menulis memerlukan pilihan terpisah
 *
 * `spec-f:403`. `bolehMenulis` adalah field tersendiri yang harus dikirim
 * `true` dengan sengaja; layar meminta konfirmasi keduanya terpisah.
 */

interface Badan {
  adminLabel?: unknown;
  reasonCode?: unknown;
  reasonNote?: unknown;
  durationMinutes?: unknown;
  writeEnabled?: unknown;
}

interface SesiRow {
  id: string;
  admin_label: string;
  granted_by: string;
  reason: string;
  started_at: Date;
  expires_at: Date;
  ended_at: Date | null;
  is_write_enabled: boolean;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function toSesi(row: SesiRow, sekarang: Date) {
  const bentuk = {
    expiresAt: row.expires_at,
    endedAt: row.ended_at,
    isWriteEnabled: row.is_write_enabled,
  };
  return {
    id: row.id,
    adminLabel: row.admin_label,
    grantedBy: row.granted_by,
    reasonCode: row.reason,
    startedAt: row.started_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    endedAt: row.ended_at === null ? null : row.ended_at.toISOString(),
    writeEnabled: row.is_write_enabled,
    // ⛔ Keadaan DITURUNKAN di server lewat fungsi domain yang sama dengan
    // yang menjaga aksesnya. Layar yang menghitungnya sendiri dari
    // `expiresAt` akan menampilkan "aktif" untuk sesi yang setiap
    // permintaannya sudah ditolak — jam browser merchant bukan jam database.
    state: keadaanSesi(bentuk, sekarang),
    remainingMinutes: sisaMenit(bentuk, sekarang),
  };
}

export function createSupportHandlers(pool: Pool, hlc: Hlc): Record<string, unknown> {
  return {
    async grantSupportSession(req: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const body = (req.body ?? {}) as Badan;

      const periksa = periksaPermintaanSupport({
        adminLabel: typeof body.adminLabel === 'string' ? body.adminLabel : '',
        alasan: String(body.reasonCode ?? ''),
        catatan: typeof body.reasonNote === 'string' ? body.reasonNote : null,
        durasiMenit:
          body.durationMinutes === undefined || body.durationMinutes === null
            ? null
            : Number(body.durationMinutes),
        bolehMenulis: body.writeEnabled === true,
      });
      if (!periksa.ok) throw new HttpError(400, periksa.kode, periksa.pesan);

      // ⛔ 256 bit dari CSPRNG. Ia satu-satunya hal yang berdiri antara
      // seseorang dan seluruh data merchant ini selama jendela yang berlaku.
      const token = randomBytes(32).toString('base64url');
      const id = randomUUID();

      const hasil = await withTenantTransaction(pool, tenantId, async (client) => {
        await assertUserVisible(client, actorId);
        // ⛔ Owner saja. Bukan Area Manager, bukan Manajer Outlet: yang
        // diberikan bukan akses ke satu outlet melainkan ke SELURUH data
        // merchant, dan `spec-f:400` menulis "Owner menyetujui dari
        // dashboard" sebagai aturannya, bukan sebagai contoh.
        await assertBoleh(client, actorId, 'support_grant', 'memberi akses support');

        // ⛔ Sesi aktif yang SUDAH ADA menolak yang baru. Dua token hidup
        // untuk satu merchant berarti mengakhiri "sesi support" di layar
        // tidak benar-benar memutus akses — dan owner tidak punya cara
        // mengetahui bahwa ada yang kedua.
        const { rows: adaAktif } = await client.query<{ id: string }>(
          `SELECT id FROM support_session
            WHERE ended_at IS NULL AND expires_at > now()`
        );
        if (adaAktif.length > 0) {
          throw new HttpError(
            409,
            'SUPPORT_SESSION_ACTIVE',
            'Sudah ada sesi support yang aktif. Akhiri sesi itu sebelum memberi akses baru.'
          );
        }

        // ⛔ `now()` dan kedaluwarsanya dihitung DATABASE, bukan Node. Sesi
        // berbatas waktu; dua mesin yang jamnya berselisih memberikan jendela
        // yang berbeda dari yang owner setujui.
        const { rows } = await client.query<SesiRow & { sekarang: Date }>(
          `INSERT INTO support_session
             (id, tenant_id, admin_label, granted_by, reason, token_hash,
              expires_at, is_write_enabled)
           VALUES ($1,$2,$3,$4,$5,$6, now() + ($7 || ' minutes')::interval, $8)
           RETURNING id, admin_label, granted_by, reason, started_at, expires_at,
                     ended_at, is_write_enabled, now() AS sekarang`,
          [
            id,
            tenantId,
            (body.adminLabel as string).trim(),
            actorId,
            String(body.reasonCode),
            hashToken(token),
            String(periksa.durasiMenit),
            body.writeEnabled === true,
          ]
        );
        const row = rows[0];

        await recordAuditEvent(client, {
          id: randomUUID(),
          tenantId,
          // Akses support bersifat tenant-wide, bukan milik satu outlet.
          outletId: null,
          deviceId: null,
          actorUserId: actorId,
          approverUserId: null,
          eventType: 'support_session_started',
          entityType: 'support_session',
          entityId: id,
          reasonCode: String(body.reasonCode),
          reasonNote: typeof body.reasonNote === 'string' ? body.reasonNote.trim() : null,
          // ⛔ Tokennya TIDAK masuk audit. Jejak audit bertahan lima tahun;
          // kredensial di dalamnya bertahan lima tahun juga.
          after: {
            adminLabel: row.admin_label,
            expiresAt: row.expires_at.toISOString(),
            writeEnabled: row.is_write_enabled,
            durationMinutes: periksa.durasiMenit,
          },
          hlc: hlc.tick(),
          // ⛔ Penanda sengaja TIDAK diisi dari konteks: pemberian akses
          // adalah tindakan OWNER, bukan tindakan support. Sesi support tidak
          // dapat memperpanjang dirinya sendiri.
          supportSessionId: null,
        });

        return toSesi(row, row.sekarang);
      });

      reply.code(201);
      // ⛔ Satu-satunya tempat token muncul, selamanya.
      return { ...hasil, token };
    },

    async listSupportSessions(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      return withTenantTransaction(pool, tenantId, async (client) => {
        const { rows } = await client.query<SesiRow & { sekarang: Date }>(
          `SELECT id, admin_label, granted_by, reason, started_at, expires_at,
                  ended_at, is_write_enabled, now() AS sekarang
             FROM support_session
            ORDER BY started_at DESC
            LIMIT 50`
        );
        // ⛔ Riwayat ikut, bukan hanya yang aktif. "Berapa kali support masuk
        // ke data kami, kapan, dan untuk apa" adalah pertanyaan yang merchant
        // berhak jawab tanpa meminta siapa pun — dan daftar yang hanya
        // menampilkan sesi aktif menjawabnya dengan "tidak pernah".
        return { sessions: rows.map((r) => toSesi(r, r.sekarang)) };
      });
    },

    async endSupportSession(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const { sessionId } = req.params as { sessionId: string };

      return withTenantTransaction(pool, tenantId, async (client) => {
        await assertUserVisible(client, actorId);
        await assertBoleh(client, actorId, 'support_grant', 'mengakhiri akses support');

        // ⛔ `UPDATE ... WHERE ended_at IS NULL` — bukan SELECT lalu UPDATE.
        // Dua permintaan "akhiri" yang beriringan akan sama-sama melihat sesi
        // terbuka, dan yang kedua menulis `ended_at` yang lebih baru: waktu
        // pemutusan yang tercatat menjadi lebih lambat daripada yang
        // sebenarnya terjadi.
        const { rows } = await client.query<SesiRow & { sekarang: Date }>(
          `UPDATE support_session
              SET ended_at = now()
            WHERE id = $1 AND ended_at IS NULL
          RETURNING id, admin_label, granted_by, reason, started_at, expires_at,
                    ended_at, is_write_enabled, now() AS sekarang`,
          [sessionId]
        );

        if (rows.length === 0) {
          // Dibedakan: sesi yang tidak ada versus sesi yang sudah berakhir.
          const { rows: ada } = await client.query<{ id: string }>(
            'SELECT id FROM support_session WHERE id = $1',
            [sessionId]
          );
          if (ada.length === 0) {
            throw new HttpError(
              404,
              'SUPPORT_SESSION_NOT_FOUND',
              `Sesi support ${sessionId} tidak ditemukan.`
            );
          }
          throw new HttpError(
            409,
            'SUPPORT_SESSION_ENDED',
            'Sesi support ini sudah berakhir.'
          );
        }

        const row = rows[0];
        await recordAuditEvent(client, {
          id: randomUUID(),
          tenantId,
          outletId: null,
          deviceId: null,
          actorUserId: actorId,
          approverUserId: null,
          eventType: 'support_session_ended',
          entityType: 'support_session',
          entityId: sessionId,
          reasonCode: null,
          reasonNote: null,
          before: { expiresAt: row.expires_at.toISOString() },
          // ⛔ "Diakhiri lebih awal" DIBEDAKAN dari "habis waktunya", dan
          // perbedaannya dicatat: yang pertama berarti merchant merasa perlu
          // memutus akses, dan menyamakannya menghapus satu-satunya sinyal itu.
          after: {
            endedAt: row.ended_at?.toISOString() ?? null,
            endedEarly: row.ended_at !== null && row.ended_at < row.expires_at,
          },
          hlc: hlc.tick(),
          supportSessionId: null,
        });

        return toSesi(row, row.sekarang);
      });
    },
  };
}

export { DURASI_BAWAAN_MENIT };
