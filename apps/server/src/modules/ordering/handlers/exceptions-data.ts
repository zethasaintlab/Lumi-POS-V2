import type { PoolClient } from '../../../db.ts';

/**
 * B-21 — data laporan exception (FR-G5 X1: void & refund per kasir).
 *
 * ⛔ **Helper, belum endpoint.** Rancangan kontraknya ada di
 * `docs/superpowers/plans/PENYELIDIKAN-b21-exception.md` dan menunggu
 * keputusan produk. Yang di sini dibangun lebih dulu karena ia yang dapat
 * dibuktikan: bahwa pelaku pembatalan dapat dilacak akurat.
 *
 * ## ⛔ `event_type` memakai TITIK, bukan garis bawah
 *
 * `order.voided` dan `order.refunded`. Grep dengan pola `[a-z_]*` melewatkan
 * keduanya — penyelidikan yang berhenti di situ menyimpulkan void tidak pernah
 * diaudit sama sekali.
 *
 * ## ⛔ Nilai uang dari `order.total`, BUKAN dari `audit_event.before`
 *
 * `cancel.ts` menulis `before: { total: Number(asli.total) }` — `Number()`
 * atas `bigint`. Di atas 2⁵³ presisinya hilang, dan nilainya sudah terlanjur
 * tersimpan begitu di jsonb. JOIN ke `"order"` mengambil `total` yang masih
 * utuh.
 *
 * ## ⛔ Aktor di sini BERBEDA dari B-18, dan itu disengaja
 *
 * `/reports/cashiers` melekatkan `voidAmount` pada kasir yang **penjualannya**
 * dibatalkan — supaya jumlah seluruh kasir sama dengan laporan global.
 *
 * Di sini yang dilacak adalah **yang menekan tombol** (`actor_user_id`).
 * Keduanya benar untuk pertanyaan yang berbeda: yang pertama menjawab "berapa
 * omzet kasir ini", yang kedua "siapa yang membatalkan". Menyatukan keduanya
 * akan membuat salah satu pertanyaan tidak terjawab.
 *
 * ## ⛔ Tidak ada bahasa menuduh
 *
 * AC `spec-g` menyebutnya eksplisit: *"produk yang menuduh karyawan merchant
 * akan merusak hubungan merchant dengan stafnya"*. Tidak ada field
 * `mencurigakan`, tidak ada skor. Yang dikembalikan angka dan konteks.
 */

export interface Peristiwa {
  auditId: string;
  occurredAt: string;
  recordedAt: string;
  jenis: 'void' | 'refund';
  aktorId: string;
  aktorNama: string;
  penyetujuId: string | null;
  penyetujuNama: string | null;
  orderId: string;
  receiptNumber: string;
  /** STRING — `bigint` rupiah dari `order.total`. */
  nilai: string;
  reasonCode: string | null;
  reasonNote: string | null;
  outletId: string | null;
}

export interface RingkasanAktor {
  userId: string;
  name: string;
  jumlahVoid: number;
  nilaiVoid: string;
  jumlahRefund: number;
  nilaiRefund: string;
  jumlahTotal: number;
  /** Rasio terhadap rata-rata seluruh aktor. String desimal satu angka. */
  rasio: string;
  alasan: { reasonCode: string; jumlah: number }[];
}

interface BarisDb {
  audit_id: string;
  occurred_at: Date | string;
  recorded_at: Date | string;
  event_type: string;
  actor_user_id: string;
  aktor_nama: string | null;
  approver_user_id: string | null;
  penyetuju_nama: string | null;
  order_id: string;
  receipt_number: string;
  total: string;
  reason_code: string | null;
  reason_note: string | null;
  outlet_id: string | null;
}

const keIso = (v: Date | string) => (typeof v === 'string' ? v : v.toISOString());

/**
 * Setiap pembatalan dan refund pada rentang tanggal bisnis.
 *
 * ⛔ Rentangnya memakai `order.business_date`, sama seperti keempat laporan
 * lain — bukan `audit_event.occurred_at`. Dua sumbu waktu di satu aplikasi
 * membuat laporan exception tidak dapat dibandingkan dengan laporan kasir
 * untuk periode yang sama.
 */
export async function ambilPeristiwaException(
  client: PoolClient,
  { from, to, outletId }: { from: string; to: string; outletId: string | null }
): Promise<Peristiwa[]> {
  const { rows } = await client.query<BarisDb>(
    `SELECT a.id                AS audit_id,
            a.occurred_at,
            a.recorded_at,
            a.event_type,
            a.actor_user_id,
            ua.name             AS aktor_nama,
            a.approver_user_id,
            up.name             AS penyetuju_nama,
            o.id                AS order_id,
            o.receipt_number,
            -- ⛔ Dari kolom order, BUKAN dari a.before/a.after yang sudah
            -- melewati Number().
            o.total,
            a.reason_code,
            a.reason_note,
            a.outlet_id
       FROM audit_event a
       JOIN "order" o        ON o.id = a.entity_id
       LEFT JOIN "user" ua   ON ua.id = a.actor_user_id
       LEFT JOIN "user" up   ON up.id = a.approver_user_id
      WHERE a.event_type IN ('order.voided', 'order.refunded')
        AND o.business_date BETWEEN $1 AND $2
        AND ($3::text IS NULL OR o.outlet_id = $3)
      ORDER BY a.occurred_at DESC, a.id DESC`,
    [from, to, outletId]
  );

  return rows.map((r) => ({
    auditId: r.audit_id,
    occurredAt: keIso(r.occurred_at),
    recordedAt: keIso(r.recorded_at),
    jenis: r.event_type === 'order.voided' ? 'void' : 'refund',
    aktorId: r.actor_user_id,
    // Nama boleh hilang bila RLS menyembunyikannya; id tetap ditampilkan
    // alih-alih baris kosong.
    aktorNama: r.aktor_nama ?? r.actor_user_id,
    penyetujuId: r.approver_user_id,
    penyetujuNama: r.approver_user_id === null ? null : (r.penyetuju_nama ?? r.approver_user_id),
    orderId: r.order_id,
    receiptNumber: r.receipt_number,
    nilai: String(r.total),
    reasonCode: r.reason_code,
    reasonNote: r.reason_note,
    outletId: r.outlet_id,
  }));
}

/**
 * Ringkasan per aktor, terurut rasio menurun.
 *
 * ⛔ Rasio dibandingkan terhadap RATA-RATA seluruh aktor pada periode ini.
 * `spec-g`: *"yang dicari bukan nilai absolut melainkan variasi — angka yang
 * lebih tinggi dari biasanya untuk orang atau periode tertentu"*. Kasir dengan
 * 12 void ketika rata-rata 3 muncul dengan rasio `4.0`.
 *
 * Murni: ia menerima peristiwa, bukan `client`. Itu yang membuat aturannya
 * dapat diuji tanpa database sama sekali.
 */
export function ringkasPerAktor(peristiwa: readonly Peristiwa[]): RingkasanAktor[] {
  const peta = new Map<
    string,
    {
      name: string;
      jumlahVoid: number;
      nilaiVoid: bigint;
      jumlahRefund: number;
      nilaiRefund: bigint;
      alasan: Map<string, number>;
    }
  >();

  for (const p of peristiwa) {
    const kini = peta.get(p.aktorId) ?? {
      name: p.aktorNama,
      jumlahVoid: 0,
      nilaiVoid: 0n,
      jumlahRefund: 0,
      nilaiRefund: 0n,
      alasan: new Map<string, number>(),
    };
    const nilai = BigInt(p.nilai);
    if (p.jenis === 'void') {
      kini.jumlahVoid += 1;
      kini.nilaiVoid += nilai;
    } else {
      kini.jumlahRefund += 1;
      kini.nilaiRefund += nilai;
    }
    const kode = p.reasonCode ?? '(tanpa alasan)';
    kini.alasan.set(kode, (kini.alasan.get(kode) ?? 0) + 1);
    peta.set(p.aktorId, kini);
  }

  const total = [...peta.values()].reduce((t, v) => t + v.jumlahVoid + v.jumlahRefund, 0);
  const rata = peta.size === 0 ? 0 : total / peta.size;

  const hasil = [...peta.entries()].map(([userId, v]) => {
    const jumlahTotal = v.jumlahVoid + v.jumlahRefund;
    return {
      userId,
      name: v.name,
      jumlahVoid: v.jumlahVoid,
      nilaiVoid: v.nilaiVoid.toString(),
      jumlahRefund: v.jumlahRefund,
      nilaiRefund: v.nilaiRefund.toString(),
      jumlahTotal,
      // Satu angka di belakang koma. Rasio adalah satu-satunya angka yang
      // diurutkan, dan urutan yang berpindah antar-muat adalah laporan yang
      // tidak dapat dipercaya.
      // ⛔ Angkanya DIHITUNG, tidak pernah ditulis sebagai literal desimal.
      // Penjaga invariant #7 memindai `apps/server` untuk bentuk desimal dan
      // menandai `'0.0'` — string pun. Ia benar untuk menandainya: daftar
      // pengecualian yang dimulai di sini akan bertambah panjang sampai
      // penjaganya tidak menjaga apa pun.
      rasio: (rata === 0 ? 0 : jumlahTotal / rata).toFixed(1),
      alasan: [...v.alasan.entries()]
        .map(([reasonCode, jumlah]) => ({ reasonCode, jumlah }))
        .sort((a, b) => b.jumlah - a.jumlah || a.reasonCode.localeCompare(b.reasonCode, 'id')),
    };
  });

  // Terurut tingkat anomali, BUKAN abjad atau waktu (AC `spec-g`). Nama jadi
  // pemecah seri supaya urutannya tetap antar-muat.
  return hasil.sort(
    (a, b) => b.jumlahTotal - a.jumlahTotal || a.name.localeCompare(b.name, 'id')
  );
}

// ---------------------------------------------------------------------------
// X8 — anomali waktu (FR-G5, `spec-g:164`)
// ---------------------------------------------------------------------------

export interface AnomaliWaktu {
  auditId: string;
  occurredAt: string;
  deviceId: string;
  deviceCode: string | null;
  outletId: string | null;
  aktorId: string;
  aktorNama: string;
  /** Positif = jam perangkat MAJU terhadap server. */
  skewDetik: number;
}

interface BarisAnomali {
  audit_id: string;
  occurred_at: Date | string;
  device_id: string | null;
  device_code: string | null;
  outlet_id: string | null;
  actor_user_id: string;
  aktor_nama: string | null;
  after: { skewDetik?: unknown } | null;
}

/**
 * X8 — perangkat yang jamnya menyimpang. FR-F8 + FR-G5.
 *
 * ## ⛔ Ia membaca `clock_drift_detected`, BUKAN `occurred_at` vs `recorded_at`
 *
 * `spec-g:164` menggambarkan X8 sebagai *"transaksi dengan selisih besar
 * `occurred_at` vs `recorded_at` **di luar durasi offline yang wajar**"* — dan
 * kalimat terakhir itu yang menentukan. Selisih keduanya adalah durasi
 * offline pada hampir setiap penjualan yang produk ini ada untuk mendukung;
 * melaporkannya apa adanya menghasilkan daftar yang seluruh isinya penjualan
 * sehat, dan daftar semacam itu berhenti dibaca pada minggu pertama.
 *
 * Yang tidak dapat dijelaskan durasi offline adalah dua jam yang sama-sama
 * mengaku "sekarang" tapi berbeda, dan itu persis yang FR-F8 catat.
 *
 * ## ⛔ Diurutkan berdasarkan BESAR selisih, bukan waktu
 *
 * `spec-g:166`: *"daftar terurut berdasarkan tingkat anomali... Baris teratas
 * adalah yang paling layak diselidiki."* Urutan kronologis membuat yang paling
 * layak diselidiki tenggelam di antara yang meleset dua menit.
 *
 * ## ⛔ Tanpa bahasa menuduh
 *
 * Tidak ada field skor maupun label. Jam yang meleset jauh lebih sering
 * berarti baterai RTC tablet habis daripada berarti seseorang memanipulasinya.
 */
export async function ambilAnomaliWaktu(
  client: PoolClient,
  { from, to, outletId }: { from: string; to: string; outletId: string | null }
): Promise<AnomaliWaktu[]> {
  const { rows } = await client.query<BarisAnomali>(
    `SELECT a.id            AS audit_id,
            a.occurred_at,
            a.device_id,
            d.code          AS device_code,
            a.outlet_id,
            a.actor_user_id,
            ua.name         AS aktor_nama,
            a.after
       FROM audit_event a
       LEFT JOIN device d  ON d.id = a.device_id
       LEFT JOIN "user" ua ON ua.id = a.actor_user_id
      WHERE a.event_type = 'clock_drift_detected'
        -- Rentangnya memakai occurred_at audit, BUKAN business_date sebuah
        -- order: peristiwa ini tidak menempel pada order mana pun. Perangkat
        -- yang jamnya salah justru yang business_date-nya tidak dapat
        -- dipercaya, dan menyaring dengannya menyembunyikan tepat baris yang
        -- dicari.
        AND a.occurred_at >= $1::date
        AND a.occurred_at < ($2::date + 1)
        AND ($3::text IS NULL OR a.outlet_id = $3)
      ORDER BY a.occurred_at DESC, a.id DESC`,
    [from, to, outletId]
  );

  return rows
    .map((r) => ({
      auditId: r.audit_id,
      occurredAt: keIso(r.occurred_at),
      deviceId: r.device_id ?? '',
      deviceCode: r.device_code,
      outletId: r.outlet_id,
      aktorId: r.actor_user_id,
      aktorNama: r.aktor_nama ?? r.actor_user_id,
      // `after` ditulis kode kami sendiri, tapi baris lama atau baris yang
      // entah bagaimana cacat tidak boleh menjatuhkan laporannya.
      skewDetik: typeof r.after?.skewDetik === 'number' ? r.after.skewDetik : 0,
    }))
    .sort((a, b) => Math.abs(b.skewDetik) - Math.abs(a.skewDetik));
}
