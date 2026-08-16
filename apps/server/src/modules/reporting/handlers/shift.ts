import type { PoolClient } from '../../../db.ts';

/**
 * B-04 (daftar shift) & B-05 (detail shift) — modul `reporting`.
 *
 * Satu baris shift menggabungkan `cash_drawer_shift` (milik `cash`), nama
 * kasir (`identity`), dan rincian pembayaran (`payment`). Tidak ada satu
 * pemilik yang masuk akal — pola yang sama persis dengan B-03.
 *
 * ## ⛔ Saldo seharusnya TIDAK dihitung ulang di sini
 *
 * `expected_amount` dan `difference` dibaca dari kolom yang ditulis saat shift
 * DITUTUP. Menghitungnya ulang saat laporan dibaca akan menghasilkan angka
 * yang berubah setiap kali `cash_movement` bertambah — dan movement yang tiba
 * terlambat dari perangkat offline akan mengubah selisih shift yang sudah
 * ditandatangani manajer, tanpa satu pun jejak.
 *
 * Shift yang MASIH TERBUKA tidak punya angka itu, dan tetap tidak dihitungkan:
 * `spec-d` FR-D2 melarang saldo terhitung terlihat sebelum kasir memasukkan
 * hitungan fisiknya. Laporan yang menampilkannya untuk shift berjalan
 * membocorkan angka target lewat pintu belakang.
 */

export interface BarisShift {
  id: string;
  outletId: string;
  deviceId: string;
  businessDate: string;
  status: string;
  openingFloat: string;
  openedBy: string;
  openedByNama: string;
  openedAt: string;
  closedBy: string | null;
  closedByNama: string | null;
  approvedBy: string | null;
  approvedByNama: string | null;
  closedAt: string | null;
  /** `null` selama shift masih terbuka — lihat catatan kepala. */
  countedAmount: string | null;
  expectedAmount: string | null;
  difference: string | null;
  varianceReasonCode: string | null;
  varianceNote: string | null;
  /** Uang yang benar-benar diterima pada shift ini, seluruh metode. */
  totalDiterima: string;
  jumlahTransaksi: number;
}

export interface RincianMetode {
  method: string;
  jumlahTransaksi: number;
  total: string;
}

export interface DetailShift extends BarisShift {
  perMetode: RincianMetode[];
  /** Pergerakan kas non-penjualan: paid_in, paid_out, bank_deposit, adjustment. */
  gerakanKas: {
    id: string;
    type: string;
    delta: string;
    reasonCode: string | null;
    note: string | null;
    occurredAt: string;
  }[];
  percobaanHitungan: { hitungan: string; pada: string | null; oleh: string | null }[];
}

const teks = (v: unknown): string => String(v ?? 0);
const keIso = (v: Date | string | null): string | null =>
  v === null ? null : v instanceof Date ? v.toISOString() : String(v);

const KOLOM = `
  s.id, s.outlet_id, s.device_id,
  to_char(s.business_date, 'YYYY-MM-DD') AS business_date_teks,
  s.status, s.opening_float, s.opened_by, s.opened_at,
  s.closed_by, s.approved_by, s.closed_at,
  s.counted_amount, s.expected_amount, s.difference,
  s.variance_reason_code, s.variance_note,
  uo.name AS opened_by_nama, uc.name AS closed_by_nama, ua.name AS approved_by_nama`;

const JOIN_NAMA = `
  LEFT JOIN "user" uo ON uo.id = s.opened_by
  LEFT JOIN "user" uc ON uc.id = s.closed_by
  LEFT JOIN "user" ua ON ua.id = s.approved_by`;

interface DbShift {
  id: string;
  outlet_id: string;
  device_id: string;
  business_date_teks: string;
  status: string;
  opening_float: unknown;
  opened_by: string;
  opened_at: Date | string;
  closed_by: string | null;
  closed_at: Date | string | null;
  approved_by: string | null;
  counted_amount: unknown;
  expected_amount: unknown;
  difference: unknown;
  variance_reason_code: string | null;
  variance_note: string | null;
  opened_by_nama: string | null;
  closed_by_nama: string | null;
  approved_by_nama: string | null;
}

/**
 * Uang diterima per shift.
 *
 * ⛔ Hanya `confirmed` (`spec-c:223`). QRIS yang masih menunggu jawaban
 * gateway bukan uang yang diterima, dan memasukkannya ke laporan shift
 * membuat kasir terlihat memegang uang yang tidak pernah ada.
 */
async function penerimaanPerShift(
  client: PoolClient,
  shiftIds: readonly string[]
): Promise<Map<string, { total: bigint; jumlah: number; perMetode: Map<string, { total: bigint; jumlah: number }> }>> {
  const peta = new Map<
    string,
    { total: bigint; jumlah: number; perMetode: Map<string, { total: bigint; jumlah: number }> }
  >();
  if (shiftIds.length === 0) return peta;

  const { rows } = await client.query<{
    shift_id: string;
    method: string;
    amount: unknown;
  }>(
    `SELECT o.shift_id, p.method, p.amount
       FROM payment p
       JOIN "order" o ON o.id = p.order_id
      WHERE o.shift_id = ANY($1) AND p.status = 'confirmed'`,
    [[...shiftIds]]
  );

  for (const r of rows) {
    const kini = peta.get(r.shift_id) ?? { total: 0n, jumlah: 0, perMetode: new Map() };
    const nilai = BigInt(teks(r.amount));
    kini.total += nilai;
    kini.jumlah += 1;
    const m = kini.perMetode.get(r.method) ?? { total: 0n, jumlah: 0 };
    m.total += nilai;
    m.jumlah += 1;
    kini.perMetode.set(r.method, m);
    peta.set(r.shift_id, kini);
  }
  return peta;
}

function keBaris(
  s: DbShift,
  terima: { total: bigint; jumlah: number } | undefined
): BarisShift {
  return {
    id: s.id,
    outletId: s.outlet_id,
    deviceId: s.device_id,
    businessDate: s.business_date_teks,
    status: s.status,
    openingFloat: teks(s.opening_float),
    openedBy: s.opened_by,
    openedByNama: s.opened_by_nama ?? s.opened_by,
    openedAt: keIso(s.opened_at) as string,
    closedBy: s.closed_by,
    closedByNama: s.closed_by === null ? null : (s.closed_by_nama ?? s.closed_by),
    approvedBy: s.approved_by,
    approvedByNama: s.approved_by === null ? null : (s.approved_by_nama ?? s.approved_by),
    closedAt: keIso(s.closed_at),
    // ⛔ `null` DIPERTAHANKAN untuk shift terbuka. `'0'` akan terbaca sebagai
    // "sudah dihitung, hasilnya nol" — pernyataan yang salah, bukan kosong.
    countedAmount: s.counted_amount === null ? null : teks(s.counted_amount),
    expectedAmount: s.expected_amount === null ? null : teks(s.expected_amount),
    difference: s.difference === null ? null : teks(s.difference),
    varianceReasonCode: s.variance_reason_code,
    varianceNote: s.variance_note,
    totalDiterima: (terima?.total ?? 0n).toString(),
    jumlahTransaksi: terima?.jumlah ?? 0,
  };
}

export interface FilterShift {
  from: string;
  to: string;
  outletId: string | null;
  /** Hanya shift yang sudah ditutup. B-04 memakainya secara bawaan. */
  hanyaTertutup: boolean;
}

export async function ambilDaftarShift(
  client: PoolClient,
  f: FilterShift
): Promise<BarisShift[]> {
  const { rows } = await client.query<DbShift>(
    `SELECT ${KOLOM}
       FROM cash_drawer_shift s ${JOIN_NAMA}
      WHERE s.business_date BETWEEN $1 AND $2
        AND ($3::text IS NULL OR s.outlet_id = $3)
        AND ($4::boolean IS FALSE OR s.status = 'closed')
      ORDER BY s.business_date DESC, s.opened_at DESC, s.id DESC`,
    [f.from, f.to, f.outletId, f.hanyaTertutup]
  );

  const terima = await penerimaanPerShift(client, rows.map((r) => r.id));
  return rows.map((r) => keBaris(r, terima.get(r.id)));
}

export async function ambilDetailShift(
  client: PoolClient,
  shiftId: string
): Promise<DetailShift | null> {
  const { rows } = await client.query<DbShift & { count_attempts: unknown }>(
    `SELECT ${KOLOM}, s.count_attempts
       FROM cash_drawer_shift s ${JOIN_NAMA}
      WHERE s.id = $1
      LIMIT 1`,
    [shiftId]
  );
  if (rows.length === 0) return null;
  const s = rows[0];

  const terima = await penerimaanPerShift(client, [shiftId]);
  const ringkas = terima.get(shiftId);

  const { rows: gerak } = await client.query<{
    id: string;
    type: string;
    delta: unknown;
    reason_code: string | null;
    note: string | null;
    occurred_at: Date | string;
  }>(
    // ⛔ `opening_float` dan `sale` dikecualikan: yang pertama sudah menjadi
    // saldo awal, yang kedua sudah terwakili rincian per metode. Yang tersisa
    // justru yang tidak terlihat di mana pun lagi — setoran bank, pengeluaran,
    // dan koreksi.
    `SELECT id, type, delta, reason_code, note, occurred_at
       FROM cash_movement
      WHERE shift_id = $1 AND type NOT IN ('opening_float', 'sale')
      ORDER BY occurred_at, id`,
    [shiftId]
  );

  const percobaanMentah = Array.isArray(s.count_attempts) ? s.count_attempts : [];

  return {
    ...keBaris(s, ringkas),
    perMetode: [...(ringkas?.perMetode ?? new Map())]
      .map(([method, v]) => ({ method, jumlahTransaksi: v.jumlah, total: v.total.toString() }))
      .sort((a, b) => a.method.localeCompare(b.method)),
    gerakanKas: gerak.map((g) => ({
      id: g.id,
      type: g.type,
      delta: teks(g.delta),
      reasonCode: g.reason_code,
      note: g.note,
      occurredAt: keIso(g.occurred_at) as string,
    })),
    percobaanHitungan: percobaanMentah.map((p) => {
      const o = p as { hitungan?: unknown; pada?: unknown; oleh?: unknown };
      return {
        hitungan: teks(o.hitungan),
        pada: o.pada === undefined || o.pada === null ? null : String(o.pada),
        oleh: o.oleh === undefined || o.oleh === null ? null : String(o.oleh),
      };
    }),
  };
}
