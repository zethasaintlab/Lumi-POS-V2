import type { PoolClient } from '../../../db.ts';
import {
  arahTren,
  persentil,
  posisiVoid,
  rasioTerhadapRataRata,
  rataRataSatuDesimal,
  type Arah,
  type PosisiVoid,
} from '../../../../../../packages/domain/src/statistik.ts';
import { EVENT_NO_SALE } from '../../../../../../packages/domain/src/no-sale.ts';

/**
 * Laporan exception X2–X7. FR-G5, `spec-g:149`.
 *
 * ## ⛔ Kenapa di `reporting` sementara X1 ada di `ordering`
 *
 * X1 lahir sebelum modul ini ada, dan `reporting/index.ts` sudah menyatakan
 * kebijakannya: pelanggaran batas modul yang sudah terlanjur ada di `ordering`
 * TIDAK dipindahkan sambil lalu — itu refactor tersendiri dengan risikonya
 * sendiri.
 *
 * Yang baru tidak boleh menambah pelanggaran itu. X2, X4, dan X7 membaca
 * `cash_drawer_shift` (milik `cash`) bersama `audit_event` (milik `audit`) dan
 * `"order"` (milik `ordering`) — tiga modul dalam satu pertanyaan. `reporting`
 * adalah satu-satunya tempat yang boleh melakukannya (invariant #4), dan ia
 * aman karena dua sifat yang diuji: tidak memiliki tabel, dan tidak pernah
 * menulis.
 *
 * ## ⛔ Tanpa bahasa menuduh
 *
 * `spec-g:168`. Tidak ada field skor, tidak ada label "mencurigakan". Yang
 * dikembalikan angka dan konteks; penafsirannya milik orang yang membaca.
 * Ada test yang memindai nama field keluaran.
 *
 * ## ⛔ Terurut tingkat anomali, bukan kronologis
 *
 * `spec-g:166`: *"Baris teratas adalah yang paling layak diselidiki."* Urutan
 * kronologis membuat baris itu tenggelam di antara yang biasa saja.
 */

const keIso = (v: Date | string) => (typeof v === 'string' ? v : v.toISOString());
const keMs = (v: Date | string) => (typeof v === 'string' ? Date.parse(v) : v.getTime());

// ---------------------------------------------------------------------------
// X2 — void mendekati / sesudah tutup shift
// ---------------------------------------------------------------------------

export interface VoidDekatTutup {
  auditId: string;
  occurredAt: string;
  posisi: PosisiVoid;
  /** Menit sebelum tutup. Negatif berarti SESUDAH tutup. */
  menitKeTutup: number | null;
  aktorId: string;
  aktorNama: string;
  orderId: string;
  receiptNumber: string;
  /** STRING — `bigint` rupiah. */
  nilai: string;
  shiftId: string;
  outletId: string | null;
}

interface BarisVoidShift {
  audit_id: string;
  occurred_at: Date | string;
  actor_user_id: string;
  aktor_nama: string | null;
  order_id: string;
  receipt_number: string;
  total: string;
  shift_id: string;
  outlet_id: string | null;
  closed_at: Date | string | null;
}

/**
 * X2 — void yang terjadi di ujung shift. `spec-g:158`.
 *
 * *"Void dalam 60 menit terakhir shift, dan void setelah shift ditutup.
 * Lonjakan di akhir shift — pola klasik."*
 *
 * ⛔ Yang dibandingkan `audit_event.occurred_at` dengan `shift.closed_at`,
 * bukan dengan jam sekarang. Shift yang BELUM ditutup tidak punya "60 menit
 * terakhir": menghitungnya dari sekarang membuat setiap void pada shift
 * berjalan tertandai selama satu jam lalu berhenti tertandai sendiri — laporan
 * yang jawabannya berubah tanpa satu pun data berubah.
 */
export async function ambilVoidDekatTutup(
  client: PoolClient,
  { from, to, outletId }: { from: string; to: string; outletId: string | null }
): Promise<VoidDekatTutup[]> {
  const { rows } = await client.query<BarisVoidShift>(
    `SELECT a.id            AS audit_id,
            a.occurred_at,
            a.actor_user_id,
            ua.name         AS aktor_nama,
            o.id            AS order_id,
            o.receipt_number,
            o.total,
            o.shift_id,
            o.outlet_id,
            s.closed_at
       FROM audit_event a
       JOIN "order" o             ON o.id = a.entity_id
       JOIN cash_drawer_shift s   ON s.id = o.shift_id
       LEFT JOIN "user" ua        ON ua.id = a.actor_user_id
      WHERE a.event_type = 'order.voided'
        AND o.business_date BETWEEN $1 AND $2
        AND ($3::text IS NULL OR o.outlet_id = $3)`,
    [from, to, outletId]
  );

  return rows
    .map((r) => {
      const voidMs = keMs(r.occurred_at);
      const tutupMs = r.closed_at === null ? null : keMs(r.closed_at);
      const posisi = posisiVoid(voidMs, tutupMs);
      return {
        auditId: r.audit_id,
        occurredAt: keIso(r.occurred_at),
        posisi,
        menitKeTutup: tutupMs === null ? null : Math.round((tutupMs - voidMs) / 60_000),
        aktorId: r.actor_user_id,
        aktorNama: r.aktor_nama ?? r.actor_user_id,
        orderId: r.order_id,
        receiptNumber: r.receipt_number,
        nilai: String(r.total),
        shiftId: r.shift_id,
        outletId: r.outlet_id,
      };
    })
    // ⛔ Hanya yang di ujung shift. Void biasa sudah ada di X1; mengulangnya di
    // sini membuat laporan ini kehilangan gunanya — yang dicari adalah pola
    // waktu, dan pola tenggelam di antara seluruh void.
    .filter((v) => v.posisi !== 'biasa')
    // `sesudah_tutup` selalu di atas: ia keadaan yang berbeda, bukan sekadar
    // lebih dekat.
    .sort((a, b) => {
      if (a.posisi !== b.posisi) return a.posisi === 'sesudah_tutup' ? -1 : 1;
      return (a.menitKeTutup ?? 0) - (b.menitKeTutup ?? 0);
    });
}

// ---------------------------------------------------------------------------
// X3 — refund bernilai tinggi
// ---------------------------------------------------------------------------

export interface RefundTinggi {
  refundId: string;
  occurredAt: string;
  /** STRING — `bigint` rupiah. */
  nilai: string;
  reasonCode: string;
  reasonNote: string | null;
  aktorId: string;
  aktorNama: string;
  penyetujuId: string;
  penyetujuNama: string;
  orderId: string;
  receiptNumber: string;
  outletId: string | null;
}

export interface LaporanRefundTinggi {
  /** Nilai p90 pada periode ini, STRING rupiah. Ambangnya, bukan tebakan. */
  ambang: string;
  jumlahSeluruhRefund: number;
  refund: RefundTinggi[];
}

interface BarisRefund {
  refund_id: string;
  occurred_at: Date | string;
  amount: string;
  reason_code: string;
  reason_note: string | null;
  created_by: string;
  aktor_nama: string | null;
  approved_by: string;
  penyetuju_nama: string | null;
  order_id: string;
  receipt_number: string;
  outlet_id: string | null;
}

/**
 * X3 — refund di atas persentil 90. `spec-g:159`.
 *
 * ⛔ Persentil, bukan ambang rupiah tetap. Kafe yang omzetnya besar punya
 * refund besar; ambang tetap menandai seluruh kasirnya sementara kafe kecil
 * tidak pernah menandai siapa pun. `spec-g:153` menyebut prinsipnya: yang
 * dicari VARIASI, bukan nilai absolut.
 *
 * ⛔ Ambangnya dihitung dari periode YANG DIMINTA, dan ikut dikembalikan.
 * Laporan yang menampilkan daftar tanpa ambangnya tidak dapat dijelaskan
 * kepada kasir yang namanya ada di sana.
 */
export async function ambilRefundTinggi(
  client: PoolClient,
  { from, to, outletId }: { from: string; to: string; outletId: string | null }
): Promise<LaporanRefundTinggi> {
  const { rows } = await client.query<BarisRefund>(
    `SELECT r.id           AS refund_id,
            r.occurred_at,
            r.amount,
            r.reason_code,
            r.reason_note,
            r.created_by,
            ua.name        AS aktor_nama,
            r.approved_by,
            up.name        AS penyetuju_nama,
            o.id           AS order_id,
            o.receipt_number,
            o.outlet_id
       FROM refund r
       JOIN "order" o      ON o.id = r.order_id
       LEFT JOIN "user" ua ON ua.id = r.created_by
       LEFT JOIN "user" up ON up.id = r.approved_by
      WHERE o.business_date BETWEEN $1 AND $2
        AND ($3::text IS NULL OR o.outlet_id = $3)`,
    [from, to, outletId]
  );

  // ⛔ Persentil dihitung atas SELURUH refund periode ini, termasuk yang tidak
  // akan ditampilkan. Menghitungnya dari yang sudah tersaring menghasilkan
  // ambang yang bergeser setiap kali laporannya dibuka.
  const urut = rows.map((r) => Number(r.amount)).sort((a, b) => a - b);
  const ambang = persentil(urut, 90);

  const refund = rows
    .filter((r) => Number(r.amount) >= ambang)
    .map((r) => ({
      refundId: r.refund_id,
      occurredAt: keIso(r.occurred_at),
      nilai: String(r.amount),
      reasonCode: r.reason_code,
      reasonNote: r.reason_note,
      aktorId: r.created_by,
      aktorNama: r.aktor_nama ?? r.created_by,
      penyetujuId: r.approved_by,
      penyetujuNama: r.penyetuju_nama ?? r.approved_by,
      orderId: r.order_id,
      receiptNumber: r.receipt_number,
      outletId: r.outlet_id,
    }))
    .sort((a, b) => Number(b.nilai) - Number(a.nilai));

  return { ambang: String(ambang), jumlahSeluruhRefund: rows.length, refund };
}

// ---------------------------------------------------------------------------
// X4 — frekuensi no-sale
// ---------------------------------------------------------------------------

export interface NoSalePerKasir {
  userId: string;
  name: string;
  jumlah: number;
  /** Berapa shift berbeda ia membuka laci tanpa penjualan. */
  jumlahShift: number;
  /** Rata-rata per shift, satu desimal. */
  perShift: string;
  /** Terhadap rata-rata seluruh kasir pada periode ini. */
  rasio: string;
}

interface BarisNoSale {
  actor_user_id: string;
  nama: string | null;
  shift_id: string | null;
  jumlah: string;
}

/**
 * X4 — pembukaan laci tanpa transaksi, per kasir per shift. `spec-g:160`.
 *
 * *"Frekuensi jauh di atas rekan kerja."*
 *
 * ⛔ Dihitung dari `audit_event`, bukan dari kolom hitungan. Pola yang sama
 * dengan ambang PIN no-sale (`CLAUDE.md`): kolom hitungan adalah angka kedua
 * yang harus dijaga sepakat dengan jejaknya.
 */
export async function ambilNoSalePerKasir(
  client: PoolClient,
  { from, to, outletId }: { from: string; to: string; outletId: string | null }
): Promise<NoSalePerKasir[]> {
  const { rows } = await client.query<BarisNoSale>(
    `SELECT a.actor_user_id,
            u.name          AS nama,
            a.entity_id     AS shift_id,
            count(*)::text  AS jumlah
       FROM audit_event a
       JOIN cash_drawer_shift s ON s.id = a.entity_id
       LEFT JOIN "user" u       ON u.id = a.actor_user_id
      WHERE a.event_type = $4
        AND s.business_date BETWEEN $1 AND $2
        AND ($3::text IS NULL OR s.outlet_id = $3)
      GROUP BY a.actor_user_id, u.name, a.entity_id`,
    [from, to, outletId, EVENT_NO_SALE]
  );

  const perKasir = new Map<string, { name: string; jumlah: number; shift: Set<string> }>();
  for (const r of rows) {
    let k = perKasir.get(r.actor_user_id);
    if (!k) {
      k = { name: r.nama ?? r.actor_user_id, jumlah: 0, shift: new Set() };
      perKasir.set(r.actor_user_id, k);
    }
    k.jumlah += Number(r.jumlah);
    if (r.shift_id !== null) k.shift.add(r.shift_id);
  }

  const semua = [...perKasir.values()].map((k) => k.jumlah);
  return [...perKasir.entries()]
    .map(([userId, k]) => ({
      userId,
      name: k.name,
      jumlah: k.jumlah,
      jumlahShift: k.shift.size,
      perShift: rataRataSatuDesimal(k.jumlah, k.shift.size),
      rasio: rasioTerhadapRataRata(k.jumlah, semua),
    }))
    .sort((a, b) => Number(b.perShift) - Number(a.perShift) || b.jumlah - a.jumlah);
}

// ---------------------------------------------------------------------------
// X5 — diskon manual per kasir
// ---------------------------------------------------------------------------

export interface DiskonPerKasir {
  userId: string;
  name: string;
  jumlah: number;
  /** STRING — total rupiah potongan. */
  nilai: string;
  /** Berapa kali diskonnya menuntut PIN manajer. */
  jumlahBerpenyetuju: number;
  rasio: string;
  /** Sebaran alasan, terurut dari yang tersering. */
  alasan: { reasonCode: string; jumlah: number }[];
}

interface BarisDiskon {
  actor_user_id: string;
  nama: string | null;
  reason_code: string | null;
  approver_user_id: string | null;
  after: { orderDiscount?: unknown } | null;
}

/**
 * X5 — diskon manual per kasir. `spec-g:161`.
 *
 * *"Total nilai, frekuensi, sebaran alasan. Kasir dengan diskon tinggi
 * terkonsentrasi pada alasan tertentu."*
 *
 * ⛔ Nilai potongan dibaca dari `audit_event.after.orderDiscount`, BUKAN dari
 * `order.order_discount`. Keduanya sama hari ini, tapi audit adalah yang
 * mencatat siapa yang menekannya — dan pertanyaan laporan ini adalah "siapa",
 * bukan "berapa omzet setelah diskon".
 *
 * Sebaran alasan ikut, karena itu sinyal yang `spec-g` sebut: bukan diskon
 * besar melainkan diskon yang selalu beralasan sama.
 */
export async function ambilDiskonPerKasir(
  client: PoolClient,
  { from, to, outletId }: { from: string; to: string; outletId: string | null }
): Promise<DiskonPerKasir[]> {
  const { rows } = await client.query<BarisDiskon>(
    `SELECT a.actor_user_id,
            u.name AS nama,
            a.reason_code,
            a.approver_user_id,
            a.after
       FROM audit_event a
       JOIN "order" o     ON o.id = a.entity_id
       LEFT JOIN "user" u ON u.id = a.actor_user_id
      WHERE a.event_type = 'discount_applied'
        AND o.business_date BETWEEN $1 AND $2
        AND ($3::text IS NULL OR o.outlet_id = $3)`,
    [from, to, outletId]
  );

  const perKasir = new Map<
    string,
    { name: string; jumlah: number; nilai: number; berpenyetuju: number; alasan: Map<string, number> }
  >();
  for (const r of rows) {
    let k = perKasir.get(r.actor_user_id);
    if (!k) {
      k = { name: r.nama ?? r.actor_user_id, jumlah: 0, nilai: 0, berpenyetuju: 0, alasan: new Map() };
      perKasir.set(r.actor_user_id, k);
    }
    k.jumlah += 1;
    k.nilai += typeof r.after?.orderDiscount === 'number' ? r.after.orderDiscount : 0;
    if (r.approver_user_id !== null) k.berpenyetuju += 1;
    const kode = r.reason_code ?? 'tanpa_alasan';
    k.alasan.set(kode, (k.alasan.get(kode) ?? 0) + 1);
  }

  const semua = [...perKasir.values()].map((k) => k.nilai);
  return [...perKasir.entries()]
    .map(([userId, k]) => ({
      userId,
      name: k.name,
      jumlah: k.jumlah,
      nilai: String(k.nilai),
      jumlahBerpenyetuju: k.berpenyetuju,
      rasio: rasioTerhadapRataRata(k.nilai, semua),
      alasan: [...k.alasan.entries()]
        .map(([reasonCode, jumlah]) => ({ reasonCode, jumlah }))
        .sort((a, b) => b.jumlah - a.jumlah || (a.reasonCode < b.reasonCode ? -1 : 1)),
    }))
    .sort((a, b) => Number(b.nilai) - Number(a.nilai));
}

// ---------------------------------------------------------------------------
// X7 — selisih kas per kasir
// ---------------------------------------------------------------------------

export interface SelisihKasPerKasir {
  userId: string;
  name: string;
  jumlahShift: number;
  /** STRING — jumlah seluruh selisih, boleh NEGATIF. */
  totalSelisih: string;
  /** STRING — jumlah nilai mutlak, untuk membedakan "kacau" dari "konsisten". */
  totalMutlak: string;
  jumlahKurang: number;
  jumlahLebih: number;
  /** Kecenderungan selisih dari waktu ke waktu. */
  tren: Arah;
  /** Selisih per shift, terurut waktu — untuk digambar layar. */
  deret: string[];
}

interface BarisSelisih {
  closed_by: string | null;
  nama: string | null;
  business_date: Date | string;
  closed_at: Date | string | null;
  difference: string | null;
}

/**
 * X7 — selisih kas per kasir, dengan trennya. `spec-g:163`.
 *
 * *"Selisih per shift dengan tren, positif dan negatif. Selisih konsisten satu
 * arah."*
 *
 * ⛔ `totalSelisih` DAN `totalMutlak` keduanya dikembalikan, dan itu bukan
 * kelebihan data: kasir yang kurang Rp 50.000 lalu lebih Rp 50.000 punya total
 * nol dan mutlak Rp 100.000 — dua angka yang menceritakan hal yang sangat
 * berbeda, dan menampilkan salah satunya saja menyembunyikan yang lain.
 *
 * ⛔ Selisih TIDAK di-clamp ke positif. Sama seperti saldo laci dan omzet
 * bersih (`CLAUDE.md`), arahnya adalah informasinya.
 */
export async function ambilSelisihKasPerKasir(
  client: PoolClient,
  { from, to, outletId }: { from: string; to: string; outletId: string | null }
): Promise<SelisihKasPerKasir[]> {
  const { rows } = await client.query<BarisSelisih>(
    `SELECT s.closed_by,
            u.name AS nama,
            s.business_date,
            s.closed_at,
            s.difference
       FROM cash_drawer_shift s
       LEFT JOIN "user" u ON u.id = s.closed_by
      WHERE s.status = 'closed'
        AND s.difference IS NOT NULL
        AND s.business_date BETWEEN $1 AND $2
        AND ($3::text IS NULL OR s.outlet_id = $3)
      ORDER BY s.business_date, s.closed_at`,
    [from, to, outletId]
  );

  const perKasir = new Map<string, { name: string; nilai: number[] }>();
  for (const r of rows) {
    const id = r.closed_by ?? 'tidak_diketahui';
    let k = perKasir.get(id);
    if (!k) {
      k = { name: r.nama ?? id, nilai: [] };
      perKasir.set(id, k);
    }
    k.nilai.push(Number(r.difference));
  }

  return [...perKasir.entries()]
    .map(([userId, k]) => {
      const total = k.nilai.reduce((a, b) => a + b, 0);
      const mutlak = k.nilai.reduce((a, b) => a + Math.abs(b), 0);
      return {
        userId,
        name: k.name,
        jumlahShift: k.nilai.length,
        totalSelisih: String(total),
        totalMutlak: String(mutlak),
        jumlahKurang: k.nilai.filter((n) => n < 0).length,
        jumlahLebih: k.nilai.filter((n) => n > 0).length,
        tren: arahTren(k.nilai),
        deret: k.nilai.map(String),
      };
    })
    // Yang paling layak diselidiki adalah yang selisihnya paling besar dalam
    // NILAI MUTLAK — arah mana pun.
    .sort((a, b) => Number(b.totalMutlak) - Number(a.totalMutlak));
}
