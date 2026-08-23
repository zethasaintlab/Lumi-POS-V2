import type { PoolClient } from '../../db.ts';
import {
  AMBANG_SKEW_DETIK,
  hitungSkew,
  layakDicatat,
  uraikanJamPerangkat,
  type Skew,
} from '../../../../../packages/domain/src/jam-perangkat.ts';
import { HttpError } from '../../http-error.ts';

/**
 * Permukaan publik modul `audit` — irisan minimal Modul F.
 *
 * Lahir dengan satu fungsi, dan itu disengaja. Keputusan user 1 Agustus 2026
 * menetapkan void berjalan **tanpa PIN manajer**, tapi **wajib** disertai
 * audit; `research/08` §3 semula menuntut PIN, dan baris void adalah override
 * eksplisit terhadapnya. Konsekuensinya audit bukan pelengkap — ia satu-satunya
 * kontrol yang tersisa untuk void, jadi ia harus ada sebelum void ada.
 *
 * Invariant #1 menuntutnya ditulis dalam transaksi yang SAMA dengan operasi
 * yang diaudit. Invariant #4 melarang modul `ordering` menyentuh `audit_event`
 * langsung. Karena itu fungsi ini.
 *
 * RBAC, PIN, sesi, dan seluruh permukaan query/laporan audit tetap Modul F
 * penuh.
 */

export interface AuditEventInput {
  id: string;
  tenantId: string;
  outletId: string | null;
  deviceId?: string | null;
  /** WAJIB. `audit_event.actor_user_id` punya FK ke `"user"` dan NOT NULL. */
  actorUserId: string;
  /** `null` untuk operasi yang tidak butuh persetujuan (mis. void). */
  approverUserId: string | null;
  eventType: string;
  entityType: string | null;
  entityId: string | null;
  reasonCode: string | null;
  reasonNote: string | null;
  before?: unknown;
  after?: unknown;
  hlc: bigint;
  occurredAt?: string | null;
}

/**
 * Menulis satu `audit_event`.
 *
 * ## Dua jaminan datang dari DATABASE, bukan dari sini
 *
 * 1. `CHECK (approver_user_id IS NULL OR actor_user_id <> approver_user_id)` —
 *    tidak ada yang bisa menyetujui tindakannya sendiri. Fungsi ini sengaja
 *    **tidak** mengulang pemeriksaan itu: kalau ia hidup di dua tempat, jalur
 *    yang lupa memanggil salah satunya akan meloloskannya. Database tidak
 *    pernah lupa.
 * 2. FK `actor_user_id`/`approver_user_id` ke `"user"`.
 *
 * Yang **tidak** dijamin database adalah kepemilikan tenant: FK PostgreSQL
 * tidak tunduk RLS (`CLAUDE.md` § Temuan F1, dibuktikan empat kali lewat
 * sabotase). Karena itu kedua id divalidasi lewat SELECT yang tunduk RLS di
 * bawah, sebelum INSERT.
 *
 * `client` WAJIB berasal dari transaksi pemanggil yang sudah men-`SET LOCAL
 * app.tenant_id`.
 */
export async function recordAuditEvent(client: PoolClient, event: AuditEventInput): Promise<void> {
  const ids = [event.actorUserId, ...(event.approverUserId === null ? [] : [event.approverUserId])];
  const { rows: visible } = await client.query<{ id: string }>(
    'SELECT id FROM "user" WHERE id = ANY($1::text[]) AND is_active = true',
    [ids]
  );
  const terlihat = new Set(visible.map((r) => r.id));
  const hilang = [...new Set(ids)].filter((id) => !terlihat.has(id));
  if (hilang.length > 0) {
    throw new HttpError(404, 'USER_NOT_FOUND', `User tidak ditemukan: ${hilang.join(', ')}.`);
  }

  await client.query(
    `INSERT INTO audit_event (
       id, tenant_id, outlet_id, device_id, actor_user_id, approver_user_id,
       event_type, entity_type, entity_id, before, after, reason_code, reason_note,
       occurred_at, hlc
     ) VALUES (
       $1, $2, $3, $4, $5, $6,
       $7, $8, $9, $10::jsonb, $11::jsonb, $12, $13,
       COALESCE($14::timestamptz, now()), $15
     )`,
    [
      event.id,
      event.tenantId,
      event.outletId,
      event.deviceId ?? null,
      event.actorUserId,
      event.approverUserId,
      event.eventType,
      event.entityType,
      event.entityId,
      event.before === undefined ? null : JSON.stringify(event.before),
      event.after === undefined ? null : JSON.stringify(event.after),
      event.reasonCode,
      event.reasonNote,
      event.occurredAt ?? null,
      event.hlc.toString(),
    ]
  );
}

/**
 * FR-F8 — mencatat jam perangkat yang menyimpang. `spec-f:354`.
 *
 * *"Saat perangkat tersinkron, sistem membandingkan jam perangkat dengan jam
 * server. Selisih > 5 menit menghasilkan `audit_event` type
 * `clock_drift_detected`."*
 *
 * ## ⛔ Ia TIDAK PERNAH menolak apa pun
 *
 * Jam yang meleset bukan alasan menolak penjualan — uangnya sudah diterima
 * merchant, dan menolaknya berarti kehilangan penjualan karena baterai jam
 * sebuah tablet habis. Aturan yang sama dengan selisih hitungan
 * (`spec-h:95`): ditandai, tidak ditolak.
 *
 * ## ⛔ Ia juga tidak pernah MELEMPAR
 *
 * Pemanggilnya jalur penjualan. Deteksi fraud yang menjatuhkan penulisan
 * penjualan adalah pertukaran yang tidak pernah benar — dan kegagalan
 * menulisnya sudah cukup terlihat lewat ketiadaan barisnya.
 *
 * `null` bila header tidak ada, jamnya wajar, atau baru saja dicatat.
 */
export async function catatDriftJam(
  client: PoolClient,
  opsi: {
    tenantId: string;
    outletId: string | null;
    deviceId: string;
    actorUserId: string;
    /** Isi header `X-Device-Time`, apa adanya. */
    headerJam: unknown;
    hlc: bigint;
    idBaru: () => string;
  }
): Promise<Skew | null> {
  const perangkatMs = uraikanJamPerangkat(opsi.headerJam);
  if (perangkatMs === null) return null;

  try {
    // ⛔ Jam SERVER dibaca dari DATABASE, bukan `Date.now()` di Node. Dua
    // mesin yang jamnya berselisih beberapa detik akan menandai armada yang
    // sehat; aturan yang sama dengan resolusi harga (`CLAUDE.md`).
    const { rows: jam } = await client.query<{ ms: string }>(
      `SELECT (EXTRACT(epoch FROM now()) * 1000)::bigint AS ms`
    );
    const serverMs = Number(jam[0].ms);
    const skew = hitungSkew(perangkatMs, serverMs);
    if (!skew.menyimpang) return null;

    // ⛔ Dibatasi satu per perangkat per jam, dan batasnya diturunkan dari
    // `audit_event` yang sudah ada — bukan dari kolom hitungan di `device`.
    // Pola yang sama dengan ambang no-sale: kolom hitungan adalah angka kedua
    // yang harus dijaga sepakat dengan jejaknya.
    const { rows: terakhir } = await client.query<{ ms: string }>(
      `SELECT (EXTRACT(epoch FROM max(occurred_at)) * 1000)::bigint AS ms
         FROM audit_event
        WHERE event_type = 'clock_drift_detected' AND device_id = $1`,
      [opsi.deviceId]
    );
    const terakhirMs = terakhir[0]?.ms == null ? null : Number(terakhir[0].ms);
    if (!layakDicatat(terakhirMs, serverMs)) return skew;

    await recordAuditEvent(client, {
      id: opsi.idBaru(),
      tenantId: opsi.tenantId,
      outletId: opsi.outletId,
      deviceId: opsi.deviceId,
      actorUserId: opsi.actorUserId,
      approverUserId: null,
      eventType: 'clock_drift_detected',
      entityType: 'device',
      entityId: opsi.deviceId,
      reasonCode: null,
      reasonNote: null,
      // ⛔ Angkanya masuk `after`, bukan ke pesan teks. Laporan X8 membacanya
      // untuk mengurutkan; kalimat harus diurai ulang oleh siapa pun yang
      // ingin membandingkan dua perangkat.
      after: { skewDetik: skew.detik, ambangDetik: AMBANG_SKEW_DETIK },
      hlc: opsi.hlc,
    });
    return skew;
  } catch {
    // Lihat catatan kepala: jalur penjualan tidak boleh jatuh karena deteksi.
    return null;
  }
}
