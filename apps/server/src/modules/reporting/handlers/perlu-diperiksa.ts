import type { PoolClient } from '../../../db.ts';

/**
 * B-15 — "Perlu Diperiksa": oversell **dan** selisih kas.
 *
 * ## ⛔ Dua hal, karena `IA:§3.3` menyebut dua hal
 *
 * Judul layarnya di IA berbunyi *"Perlu Diperiksa (oversell + selisih)"*.
 * Membangun setengahnya menghasilkan layar yang namanya menjanjikan lebih
 * daripada isinya — dan yang tidak dibangun adalah separuh yang menyangkut
 * uang.
 *
 * Selisih kas datang dari `cash_drawer_shift`, dan sudah punya bentuk yang
 * benar sejak PR #41: `difference` dibekukan saat shift ditutup, bukan
 * dihitung ulang saat laporan dibaca.
 *
 * ## ⛔ Oversell BUKAN kesalahan, dan layarnya tidak boleh menyebutnya begitu
 *
 * `spec-e:177` dan PRD menyebut pencegahan oversell saat offline sebagai
 * **non-goal permanen** — konsekuensi teorema CAP, bukan bug. Dua perangkat
 * yang menjual barang terakhir saat offline SAMA-SAMA benar, dan keduanya
 * harus berhasil.
 *
 * Yang dapat dan harus dilakukan adalah membuat konsekuensinya terlihat dan
 * tertangani sebagai proses bisnis. Karena itu bahasanya deskriptif, sama
 * seperti B-21, dan `quantity_over` disebut apa adanya — bukan "kerugian".
 */

export interface BarisOversell {
  id: string;
  outletId: string;
  variationId: string;
  itemName: string;
  variationName: string;
  detectedAt: string;
  /** Kuantitas ×1000 yang terjual melebihi saldo. STRING. */
  quantityOver: string;
  /** Perangkat yang terlibat — bukan "pelaku". Lihat catatan kepala. */
  devicesInvolved: string[];
  ordersInvolved: string[];
  resolvedBy: string | null;
  resolvedByNama: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
}

export interface BarisSelisihKas {
  shiftId: string;
  outletId: string;
  businessDate: string;
  openedByNama: string;
  closedByNama: string | null;
  approvedByNama: string | null;
  closedAt: string | null;
  difference: string;
  varianceReasonCode: string | null;
  varianceNote: string | null;
}

const teks = (v: unknown): string => String(v ?? 0);
const keIso = (v: Date | string | null): string | null =>
  v === null ? null : v instanceof Date ? v.toISOString() : String(v);

/** Larik dari kolom jsonb yang isinya mungkin `null` atau bukan larik. */
function keLarik(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)) : [];
}

export interface FilterPeriksa {
  from: string;
  to: string;
  outletId: string | null;
  /** Sertakan oversell yang sudah ditindaklanjuti. */
  sertakanSelesai: boolean;
}

/**
 * Oversell pada rentang tanggal.
 *
 * ⛔ Rentangnya atas `detected_at` — waktu SERVER menyadarinya, bukan waktu
 * penjualannya. Oversell lahir saat perangkat kedua tersinkronisasi, dan itu
 * dapat berhari-hari setelah penjualannya terjadi. Memakai tanggal bisnis
 * membuat kejadian yang baru ketahuan hari ini tersembunyi di rentang minggu
 * lalu, tempat tidak ada yang mencarinya lagi.
 */
export async function ambilOversell(
  client: PoolClient,
  f: FilterPeriksa
): Promise<BarisOversell[]> {
  const { rows } = await client.query(
    `SELECT oe.id, oe.outlet_id, oe.variation_id, oe.detected_at,
            oe.quantity_over, oe.devices_involved, oe.orders_involved,
            oe.resolved_by, oe.resolved_at, oe.resolution_note,
            iv.name AS variation_name, i.name AS item_name,
            u.name  AS resolved_by_nama
       FROM oversell_event oe
       -- ⛔ Nama produk lewat JOIN katalog. Tanpa itu barisnya hanya berisi
       -- UUID, dan manajer yang harus memutuskan tidak dapat menyelidiki
       -- kejadian yang tidak ia kenali barangnya.
       LEFT JOIN item_variation iv ON iv.id = oe.variation_id
       LEFT JOIN item i            ON i.id = iv.item_id
       LEFT JOIN "user" u          ON u.id = oe.resolved_by
      WHERE oe.detected_at::date BETWEEN $1 AND $2
        AND ($3::text IS NULL OR oe.outlet_id = $3)
        AND ($4::boolean IS TRUE OR oe.resolved_at IS NULL)
      ORDER BY oe.detected_at DESC, oe.id DESC`,
    [f.from, f.to, f.outletId, f.sertakanSelesai]
  );

  return rows.map((r) => ({
    id: r.id as string,
    outletId: r.outlet_id as string,
    variationId: r.variation_id as string,
    // Katalog dapat menghilang dari pandangan (arsip, atau varian yang dihapus
    // dari sisi lain); id tetap ditampilkan alih-alih sel kosong.
    itemName: (r.item_name as string | null) ?? (r.variation_id as string),
    variationName: (r.variation_name as string | null) ?? '—',
    detectedAt: keIso(r.detected_at as Date) as string,
    quantityOver: teks(r.quantity_over),
    devicesInvolved: keLarik(r.devices_involved),
    ordersInvolved: keLarik(r.orders_involved),
    resolvedBy: (r.resolved_by as string | null) ?? null,
    resolvedByNama:
      r.resolved_by === null ? null : ((r.resolved_by_nama as string | null) ?? (r.resolved_by as string)),
    resolvedAt: keIso(r.resolved_at as Date | null),
    resolutionNote: (r.resolution_note as string | null) ?? null,
  }));
}

/**
 * Shift yang selisih kasnya BUKAN nol.
 *
 * ⛔ Nol dikecualikan di SQL, bukan disaring di layar. Shift yang cocok bukan
 * "perlu diperiksa", dan mengirimkannya lalu menyembunyikannya membuat jumlah
 * di ringkasan tidak dapat dipercaya.
 *
 * ⛔ Shift yang belum ditutup juga dikecualikan: `difference` NULL berarti
 * belum ada hitungan fisik, bukan selisih nol.
 */
export async function ambilSelisihKas(
  client: PoolClient,
  f: FilterPeriksa
): Promise<BarisSelisihKas[]> {
  const { rows } = await client.query(
    `SELECT s.id, s.outlet_id,
            to_char(s.business_date, 'YYYY-MM-DD') AS business_date_teks,
            s.closed_at, s.difference, s.variance_reason_code, s.variance_note,
            uo.name AS opened_by_nama, uc.name AS closed_by_nama, ua.name AS approved_by_nama,
            s.opened_by, s.closed_by, s.approved_by
       FROM cash_drawer_shift s
       LEFT JOIN "user" uo ON uo.id = s.opened_by
       LEFT JOIN "user" uc ON uc.id = s.closed_by
       LEFT JOIN "user" ua ON ua.id = s.approved_by
      WHERE s.business_date BETWEEN $1 AND $2
        AND ($3::text IS NULL OR s.outlet_id = $3)
        AND s.status = 'closed'
        AND s.difference IS NOT NULL
        AND s.difference <> 0
      ORDER BY s.business_date DESC, s.closed_at DESC, s.id DESC`,
    [f.from, f.to, f.outletId]
  );

  return rows.map((r) => ({
    shiftId: r.id as string,
    outletId: r.outlet_id as string,
    businessDate: r.business_date_teks as string,
    openedByNama: (r.opened_by_nama as string | null) ?? (r.opened_by as string),
    closedByNama:
      r.closed_by === null ? null : ((r.closed_by_nama as string | null) ?? (r.closed_by as string)),
    approvedByNama:
      r.approved_by === null
        ? null
        : ((r.approved_by_nama as string | null) ?? (r.approved_by as string)),
    closedAt: keIso(r.closed_at as Date | null),
    difference: teks(r.difference),
    varianceReasonCode: (r.variance_reason_code as string | null) ?? null,
    varianceNote: (r.variance_note as string | null) ?? null,
  }));
}
