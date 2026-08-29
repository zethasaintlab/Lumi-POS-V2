import type { PoolClient } from '../../../db.ts';
import { HttpError } from '../../../http-error.ts';
import {
  adalahPeristiwaAudit,
  kelompokPeristiwa,
  KUNCI_PERISTIWA,
  type KelompokPeristiwa,
} from '../../../../../../packages/domain/src/audit-peristiwa.ts';

/**
 * B-22 — Audit & Aktivitas (`IA:201`). FR-F6, FR-F7.
 *
 * ## ⛔ Kenapa di `reporting`
 *
 * Satu baris audit yang dapat dibaca manusia menggabungkan `audit_event`
 * (milik `audit`), `"user"` untuk kedua identitas (milik `identity`), `outlet`
 * (milik `tenancy`), dan `device` (milik `identity`) — empat modul dalam satu
 * pertanyaan. `reporting` adalah satu-satunya yang boleh (invariant #4), dan
 * ia aman karena dua sifat yang diuji: tidak memiliki tabel, dan tidak pernah
 * menulis.
 *
 * ## ⛔ Paginasi KEYSET, bukan offset
 *
 * Aturan yang sama dengan riwayat transaksi (`CLAUDE.md`), dan di sini
 * alasannya lebih kuat: perangkat yang antreannya terkuras menyisipkan baris
 * ber-`occurred_at` historis **di tengah** urutan. Offset akan melewatkan atau
 * menggandakan baris tepat saat antrean bergerak — dan baris audit yang
 * terlewat tidak meninggalkan lubang yang terlihat.
 *
 * Kursornya `(occurred_at, id)`, pasangan yang sama dengan primary key tabel.
 *
 * ## ⛔ Tidak ada cara MENYEMBUNYIKAN baris
 *
 * `spec-f:369`: tidak ada setting, feature flag, maupun endpoint yang
 * menonaktifkan audit trail. Saringan di sini menyempitkan **pandangan**, dan
 * setiap saringan yang dipakai ikut dikembalikan di respons supaya layar dapat
 * menyatakan apa yang sedang tidak terlihat. Daftar yang tidak menyebut
 * saringannya terbaca seperti daftar lengkap.
 */

export interface BarisAudit {
  id: string;
  occurredAt: string;
  recordedAt: string;
  eventType: string;
  kelompok: KelompokPeristiwa | null;
  entityType: string | null;
  entityId: string | null;
  aktorId: string;
  aktorNama: string;
  /** ⛔ `null` bermakna: operasi ini memang tidak butuh persetujuan. */
  penyetujuId: string | null;
  penyetujuNama: string | null;
  outletId: string | null;
  outletNama: string | null;
  deviceId: string | null;
  deviceKode: string | null;
  reasonCode: string | null;
  reasonNote: string | null;
  /** F.5 — `null` berarti dilakukan langsung oleh orang merchant. */
  supportSessionId: string | null;
  supportAdmin: string | null;
}

export interface HalamanAudit {
  peristiwa: BarisAudit[];
  /** Kursor halaman berikutnya, atau `null` bila ini halaman terakhir. */
  kursorBerikut: string | null;
}

export interface SaringanAudit {
  from: string;
  to: string;
  outletId: string | null;
  eventType: string | null;
  actorUserId: string | null;
  entityId: string | null;
  kursor: string | null;
  batas: number;
  /**
   * F.5 — hanya tindakan yang dilakukan selama sesi support.
   *
   * ⛔ Tidak ada kebalikannya. "Sembunyikan tindakan support" adalah saringan
   * yang membuat audit dapat menyembunyikan sebagian dirinya, dan yang paling
   * ingin memakainya adalah pihak yang tindakannya sedang diperiksa.
   */
  hanyaSupport: boolean;
}

export const BATAS_BAWAAN = 50;
export const BATAS_MAKS = 200;

/**
 * Kursor sebagai satu string, bukan dua parameter.
 *
 * ⛔ Dua parameter yang boleh diisi terpisah menghasilkan permintaan setengah
 * jadi — `cursor_at` tanpa `cursor_id` mengulang seluruh baris pada detik yang
 * sama, dan pengulangannya tidak terlihat sebagai kesalahan di mana pun.
 * Klien memperlakukan kursor sebagai nilai buram: ia hanya mengembalikan apa
 * yang server berikan.
 */
export function uraikanKursor(kursor: string): { at: string; id: string } {
  const pisah = kursor.indexOf('|');
  if (pisah <= 0 || pisah === kursor.length - 1) {
    throw new HttpError(400, 'INVALID_CURSOR', 'Kursor tidak dapat dibaca.');
  }
  const at = kursor.slice(0, pisah);
  if (Number.isNaN(Date.parse(at))) {
    throw new HttpError(400, 'INVALID_CURSOR', 'Kursor tidak dapat dibaca.');
  }
  return { at, id: kursor.slice(pisah + 1) };
}

export function susunKursor(at: string, id: string): string {
  return `${at}|${id}`;
}

/** Batas halaman yang diminta klien, dijepit — bukan ditolak. */
export function bacaBatas(mentah: string | undefined): number {
  if (mentah === undefined || mentah === '') return BATAS_BAWAAN;
  const n = Number(mentah);
  if (!Number.isInteger(n) || n < 1) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Batas halaman harus bilangan bulat positif.');
  }
  return Math.min(n, BATAS_MAKS);
}

/**
 * Jenis peristiwa yang diminta klien.
 *
 * ⛔ Jenis yang TIDAK dikenal ditolak, bukan diterima lalu mengembalikan nol
 * baris. Nol baris terlihat persis seperti "tidak ada yang melakukannya", dan
 * salah ketik pada saringan audit adalah cara paling mudah untuk menyimpulkan
 * hal yang salah tentang seseorang.
 */
export function bacaJenis(mentah: string | undefined): string | null {
  if (mentah === undefined || mentah === '') return null;
  if (!adalahPeristiwaAudit(mentah)) {
    throw new HttpError(
      400,
      'UNKNOWN_EVENT_TYPE',
      `Jenis peristiwa "${mentah}" tidak dikenal. Yang dikenal: ${KUNCI_PERISTIWA.join(', ')}.`
    );
  }
  return mentah;
}

interface Baris {
  support_session_id: string | null;
  support_admin: string | null;
  id: string;
  occurred_at: Date | string;
  recorded_at: Date | string;
  event_type: string;
  entity_type: string | null;
  entity_id: string | null;
  actor_user_id: string;
  aktor_nama: string | null;
  approver_user_id: string | null;
  penyetuju_nama: string | null;
  outlet_id: string | null;
  outlet_nama: string | null;
  device_id: string | null;
  device_kode: string | null;
  reason_code: string | null;
  reason_note: string | null;
}

const keIso = (v: Date | string) => (typeof v === 'string' ? v : v.toISOString());

/**
 * Satu halaman audit trail, terbaru lebih dulu.
 *
 * ⛔ Rentangnya memakai `occurred_at`, bukan `business_date` sebuah order.
 * Sebagian besar peristiwa di sini tidak menempel pada order mana pun — dan
 * yang menempel pun tidak boleh menghilang dari trail hanya karena ordernya
 * bertanggal bisnis lain.
 *
 * ⛔ `before`/`after` TIDAK dikembalikan. Keduanya memuat muatan bebas yang
 * pada `item_updated` akan memuat `cost` — dan FR-F5 melarang HPP sampai ke
 * mata yang tidak berhak. Peran yang boleh membuka layar ini kebetulan sama
 * persis dengan yang boleh melihat margin hari ini, jadi tidak ada kebocoran
 * hari ini; "kebetulan sama persis" bukan penjaga. Detail perubahan punya
 * layarnya sendiri (B-03 untuk transaksi, B-13 untuk stok), dan di sana
 * batasnya sudah ditegakkan.
 */
export async function ambilAudit(
  client: PoolClient,
  s: SaringanAudit
): Promise<HalamanAudit> {
  const kursor = s.kursor === null ? null : uraikanKursor(s.kursor);

  const { rows } = await client.query<Baris>(
    `SELECT a.id,
            a.occurred_at,
            a.recorded_at,
            a.event_type,
            a.entity_type,
            a.entity_id,
            a.actor_user_id,
            ua.name        AS aktor_nama,
            a.approver_user_id,
            up.name        AS penyetuju_nama,
            a.outlet_id,
            o.name         AS outlet_nama,
            a.device_id,
            d.code         AS device_kode,
            a.reason_code,
            a.reason_note,
            -- ⛔ F.5 — PENANDA sesi support ikut di SETIAP baris, bukan hanya
            -- saat disaring. Baris yang dilakukan support terlihat sama persis
            -- dengan baris yang owner lakukan sendiri kalau penandanya tidak
            -- dibawa, dan layar audit yang dibaca saat sengketa akan
            -- menisbatkannya kepada orangnya.
            a.support_session_id,
            ss.admin_label AS support_admin
       FROM audit_event a
       LEFT JOIN "user" ua ON ua.id = a.actor_user_id
       LEFT JOIN "user" up ON up.id = a.approver_user_id
       LEFT JOIN outlet o  ON o.id = a.outlet_id
       LEFT JOIN device d  ON d.id = a.device_id
       LEFT JOIN support_session ss ON ss.id = a.support_session_id
      WHERE a.occurred_at >= $1::date
        AND a.occurred_at < ($2::date + 1)
        AND ($3::text IS NULL OR a.outlet_id = $3)
        AND ($4::text IS NULL OR a.event_type = $4)
        AND ($5::text IS NULL OR a.actor_user_id = $5)
        AND ($6::text IS NULL OR a.entity_id = $6)
        -- ⛔ Saringan "hanya tindakan support". $10 = true menyaring baris
        -- BERTANDA; NULL tidak menyaring apa pun. Tidak ada nilai yang berarti
        -- "sembunyikan tindakan support" — audit yang dapat menyembunyikan
        -- sebagian dirinya bukan audit.
        AND ($10::boolean IS NOT TRUE OR a.support_session_id IS NOT NULL)
        -- ⛔ Keyset, bukan OFFSET. Perbandingan baris utuh supaya beberapa
        -- peristiwa pada timestamp yang SAMA tidak saling melewati: id
        -- memutuskan urutannya, dan pasangannya sama dengan primary key.
        AND ($7::timestamptz IS NULL OR (a.occurred_at, a.id) < ($7::timestamptz, $8::text))
      ORDER BY a.occurred_at DESC, a.id DESC
      LIMIT $9`,
    [
      s.from,
      s.to,
      s.outletId,
      s.eventType,
      s.actorUserId,
      s.entityId,
      kursor?.at ?? null,
      kursor?.id ?? null,
      // Satu baris lebih banyak daripada yang diminta: itu yang membedakan
      // "halaman penuh kebetulan" dari "masih ada lagi". Kursor yang selalu
      // ada membuat layar menampilkan tombol yang menghasilkan halaman kosong.
      s.batas + 1,
      s.hanyaSupport ? true : null,
    ]
  );

  const adaLagi = rows.length > s.batas;
  const dipakai = adaLagi ? rows.slice(0, s.batas) : rows;
  const terakhir = dipakai[dipakai.length - 1];

  return {
    peristiwa: dipakai.map((r) => ({
      id: r.id,
      occurredAt: keIso(r.occurred_at),
      recordedAt: keIso(r.recorded_at),
      eventType: r.event_type,
      kelompok: kelompokPeristiwa(r.event_type),
      entityType: r.entity_type,
      entityId: r.entity_id,
      aktorId: r.actor_user_id,
      aktorNama: r.aktor_nama ?? r.actor_user_id,
      penyetujuId: r.approver_user_id,
      penyetujuNama: r.approver_user_id === null ? null : (r.penyetuju_nama ?? r.approver_user_id),
      outletId: r.outlet_id,
      outletNama: r.outlet_nama,
      deviceId: r.device_id,
      deviceKode: r.device_kode,
      reasonCode: r.reason_code,
      reasonNote: r.reason_note,
      supportSessionId: r.support_session_id,
      supportAdmin: r.support_admin,
    })),
    kursorBerikut:
      adaLagi && terakhir !== undefined
        ? susunKursor(keIso(terakhir.occurred_at), terakhir.id)
        : null,
  };
}
