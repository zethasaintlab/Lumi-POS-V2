import type { PoolClient } from '../../../db.ts';

/**
 * B-02 — daftar transaksi back-office. Helper SQL + turunan statusnya.
 *
 * ## ⛔ Tabel `order` TIDAK berisi satu baris per transaksi
 *
 * Ini temuan yang menentukan seluruh bentuk berkas ini, dan ia tidak terlihat
 * dari skema. Sebuah penjualan yang dibatalkan menghasilkan **dua** baris:
 *
 * | baris | `status` | `voided_by_order_id` | apa sebenarnya ia |
 * |---|---|---|---|
 * | order asli | `open` | `NULL` | penjualan yang dibatalkan |
 * | order pembatal | `voided` | id order asli | catatan koreksi, bukan penjualan |
 *
 * Arah `voided_by_order_id` dipaksa AC FR-B7 pertama ("tidak ada `UPDATE` pada
 * order asli"), jadi order asli **tetap** `open` selamanya. Dibuktikan pada
 * data sungguhan: dua penjualan yang di-void menghasilkan
 * `{voided: 2, open: 2}`.
 *
 * Konsekuensinya untuk layar daftar, dan semuanya salah bila diabaikan:
 *
 * 1. `SELECT * FROM "order"` menampilkan **empat baris untuk dua transaksi**.
 * 2. Dua di antaranya berlabel `open` — terbaca sebagai pesanan yang belum
 *    selesai, padahal justru yang dibatalkan.
 * 3. Dua lainnya berlabel `voided` dengan nilai uang yang merupakan SALINAN
 *    dari order aslinya. Menjumlahkan kolom itu menggandakan angka.
 *
 * `packages/domain/src/posisi-penjualan.ts` sudah menyelesaikan hal yang sama
 * untuk laporan — "order dianggap batal bila ADA pembatal yang menunjuknya".
 * Berkas ini memakai aturan yang sama, bukan menuliskannya lagi.
 *
 * ## ⛔ Yang SENGAJA tidak di-JOIN di sini
 *
 * Nama kasir (`"user"`), pembayaran (`payment`), dan audit (`audit_event`)
 * tidak disentuh — ketiganya milik modul lain (invariant #4). Daftar ini
 * mengembalikan `createdBy` sebagai id; nama diresolusi klien lewat
 * `GET /users`, sama seperti nama outlet lewat `GET /outlets`.
 *
 * Batas itu ditegakkan di sini justru karena laporan-laporan sebelumnya sudah
 * melanggarnya di tujuh tempat. Menambah yang kedelapan akan membuat
 * perbaikannya makin mahal, dan daftar transaksi adalah permukaan yang paling
 * banyak dibaca — ia akan menjadi contoh yang disalin.
 */

/** Status yang DITAMPILKAN, diturunkan — bukan kolom `order.status` apa adanya. */
export type StatusTampil =
  | 'terjual'
  | 'dibatalkan'
  | 'direfund'
  | 'terbuka'
  | 'ditinggalkan';

export interface BarisRiwayat {
  id: string;
  receiptNumber: string;
  businessDate: string;
  sequence: number;
  outletId: string;
  deviceId: string;
  createdBy: string;
  occurredAt: string;
  total: string;
  status: StatusTampil;
  /** Id order pembatal, bila transaksi ini dibatalkan. Untuk drill-down B-03. */
  dibatalkanOleh: string | null;
  /** Total refund atas transaksi ini. `'0'` bila tidak ada. */
  nilaiRefund: string;
  hasCalculationVariance: boolean;
}

/**
 * ⛔ Status yang boleh MUNCUL di daftar (keputusan user 16 Agustus 2026).
 *
 * Keranjang `terbuka` yang belum dibayar disembunyikan. Ia bukan transaksi —
 * ia pesanan yang sedang berjalan, atau sisa keranjang dari perangkat yang
 * dimuat ulang (`CLAUDE.md`: keranjang K-03 hanya ada di memori). Menampilkan-
 * nya di daftar transaksi membuat manajer mengira ada penjualan menggantung
 * yang perlu ditutup, sementara belum ada jalan menutupnya sama sekali.
 *
 * `ditinggalkan` ikut tersembunyi. Ia tidak punya penulis di seluruh repo —
 * `abandoned` ada di state machine (`packages/domain/src/order-state.ts`) dan
 * di CHECK constraint, tapi tidak satu pun kode menulisnya. Menampilkan kolom
 * untuk keadaan yang tidak dapat terjadi adalah janji kosong.
 */
export const STATUS_TERLIHAT = ['terjual', 'dibatalkan', 'direfund'] as const;
export type StatusTerlihat = (typeof STATUS_TERLIHAT)[number];

export interface FilterRiwayat {
  from: string;
  to: string;
  outletId: string | null;
  /** `created_by`. Layar menyebutnya kasir; kolomnya aktor pembuat order. */
  createdBy: string | null;
  /**
   * Pencarian nomor struk, **cocok sebagian** (`ILIKE '%…%'`).
   *
   * Keputusan user 16 Agustus 2026. Alasannya praktis: struk termal luntur dan
   * pelanggan mengetik ulang sebagian — "0007" harus menemukan
   * `K1-20260810-0007`.
   */
  receiptNumber: string | null;
  /**
   * Status yang diminta. `null` berarti seluruh `STATUS_TERLIHAT`.
   *
   * ⛔ LARIK, bukan satu nilai. B-02 menyaringnya lewat pilihan ganda, dan
   * "Dibatalkan + Refund" adalah pertanyaan yang wajar — koreksi apa saja yang
   * terjadi minggu ini. Bentuk tunggal memaksa layar memilih antara satu
   * status atau semuanya, dan tidak ada di antaranya.
   *
   * Larik KOSONG berarti tidak ada yang cocok, dan itu jawaban yang benar
   * untuk penyaring yang tidak memilih apa pun — bukan alasan menampilkan
   * segalanya.
   */
  status: readonly StatusTerlihat[] | null;
  limit: number;
  /** Keyset dari halaman sebelumnya: `{businessDate, sequence, id}`. */
  cursor: Kursor | null;
}

/**
 * ⛔ `%` dan `_` di input pengguna DILUCUTI maknanya.
 *
 * Tanpa ini, kasir yang mengetik `%` mendapat seluruh riwayat merchant dalam
 * satu permintaan, dan `_` diam-diam mencocokkan karakter apa pun. Bukan
 * lubang keamanan — parameternya tetap ter-bind, jadi tidak ada injeksi — tapi
 * pencarian yang mengembalikan segalanya sama tidak bergunanya dengan
 * pencarian yang mengembalikan kosong.
 *
 * Backslash dilucuti LEBIH DULU; membaliknya akan meloloskan `\%` sebagai
 * wildcard kembali.
 */
export function polaCari(teks: string): string {
  return `%${teks.replace(/\\/g, '\\\\').replace(/[%_]/g, (c) => `\\${c}`)}%`;
}

/*
 * ⛔ Klausa `ESCAPE` di query ditulis DUA backslash di sumber, satu di SQL.
 *
 * Versi pertama menulis satu, dan template literal TypeScript memakannya —
 * yang terkirim ke PostgreSQL adalah escape KOSONG, artinya tidak ada karakter
 * escape sama sekali, dan pelucutan `polaCari` di atas jadi hiasan.
 *
 * Tiga test wildcard tetap HIJAU di atas cacat itu, karena alasan yang salah:
 * polanya berisi backslash harfiah, tidak ada nomor struk yang memuatnya, jadi
 * jawabannya nol baris. Nol karena tidak pernah cocok terlihat sama persis
 * dengan nol karena wildcard berhasil dilucuti.
 *
 * Yang membedakan keduanya hanya satu test: nomor struk yang benar-benar
 * memuat `_` HARUS ditemukan saat dicari. Itu yang sekarang menjaganya.
 *
 * Catatan ini hidup di sini, bukan sebagai komentar SQL di dalam query-nya —
 * backtick di dalam template literal menutup literalnya, dan `CLAUDE.md` sudah
 * mencatat gejalanya: galat sintaks yang menunjuk baris yang salah.
 */

export interface Kursor {
  businessDate: string;
  sequence: number;
  id: string;
}

interface BarisDb {
  id: string;
  receipt_number: string;
  business_date: Date | string;
  business_date_teks: string;
  sequence: number;
  outlet_id: string;
  device_id: string;
  created_by: string;
  occurred_at: Date | string;
  total: string | number | bigint;
  status: string;
  dibatalkan_oleh: string | null;
  nilai_refund: string | number | bigint | null;
  status_tampil: StatusTampil;
  has_calculation_variance: boolean;
}

const keIso = (v: Date | string): string => (v instanceof Date ? v.toISOString() : String(v));

/**
 * ⛔ `business_date` diformat di SQL, TIDAK PERNAH lewat `Date` JavaScript.
 *
 * Ditemukan dengan menjalankan: `node-postgres` memetakan kolom `date` ke
 * `Date` bertengah-malam **lokal**, dan `toISOString()` menariknya kembali ke
 * UTC. Di WIB (+7) itu menggeser setiap tanggal satu hari MUNDUR — `2026-08-10`
 * terbaca `2026-08-09`, tanpa satu pun error.
 *
 * Akibat keduanya, dan yang kedua jauh lebih sulit dilacak:
 *
 * 1. Setiap tanggal di layar salah satu hari.
 * 2. **Kursor paginasi ikut bergeser**, jadi halaman kedua menyaring
 *    `< '2026-08-09'` dan membuang seluruh transaksi tanggal itu. Halaman 2
 *    datang KOSONG sementara datanya ada. Test paginasi merah bukan karena
 *    paginasinya salah, melainkan karena tanggalnya.
 *
 * Sejalan dengan aturan repo ini: waktu selalu dari jam database. Ini sisi
 * sebaliknya — tanggal juga selalu dari FORMAT database.
 */
const TANGGAL_SQL = (kolom: string) => `to_char(${kolom}, 'YYYY-MM-DD')`;

/**
 * ⛔ Aturan status hidup di SQL, dan HANYA di SQL.
 *
 * Ia terlihat seperti kandidat sempurna untuk fungsi murni di
 * `packages/domain` — sampai dipikirkan sampai selesai: statusnya harus dapat
 * **disaring** dan **diurutkan**, dan penyaringan setelah `LIMIT` menghasilkan
 * halaman yang isinya lebih sedikit daripada yang diminta, kadang kosong,
 * sementara masih ada baris yang cocok di belakangnya.
 *
 * Jadi SQL harus tahu aturannya. Menuliskannya lagi di JavaScript membuat dua
 * definisi yang akan menyimpang — dan bentuk penyimpangannya buruk: yang satu
 * menentukan baris mana yang MASUK halaman, yang lain menentukan label yang
 * DIBACA manajer. Sebuah transaksi dapat tersaring sebagai "dibatalkan" lalu
 * tampil berlabel "terjual".
 *
 * Karena itu `SELECT` mengembalikan `status_tampil` dan JavaScript hanya
 * membacanya. Ada test yang menahan JavaScript tidak menghitungnya ulang.
 */
const KOLOM_STATUS = `
  CASE
    WHEN dibatalkan_oleh IS NOT NULL              THEN 'dibatalkan'
    WHEN status = 'refunded' OR nilai_refund > 0  THEN 'direfund'
    WHEN status = 'abandoned'                     THEN 'ditinggalkan'
    WHEN status = 'open'                          THEN 'terbuka'
    ELSE 'terjual'
  END`;

/**
 * Satu halaman riwayat transaksi.
 *
 * ## ⛔ Paginasi KEYSET, bukan `OFFSET`
 *
 * Bukan selera. Order tiba dari perangkat yang baru tersambung setelah
 * berjam-jam offline, dan `occurred_at`/`business_date`-nya **historis** — ia
 * menyisip di TENGAH urutan, bukan di ujungnya. Dengan `OFFSET`, satu order
 * yang menyisip saat manajer membuka halaman 2 membuat satu transaksi
 * terlewat sepenuhnya dan satu lagi tampil dua kali.
 *
 * Halaman yang melewatkan transaksi adalah cacat yang tidak terlihat: tidak
 * ada error, hanya struk yang "tidak ada di sistem" saat pelanggan komplain.
 *
 * ⛔ Kursornya `(business_date, sequence, id)`, bukan `occurred_at` —
 * `occurred_at` datang dari jam PERANGKAT (jam ketiga, lihat `HANDOFF.md`) dan
 * dapat mundur. Kursor yang mundur mengulang halaman selamanya.
 * `UNIQUE (device_id, business_date, sequence)` membuat pasangan itu stabil,
 * dan `id` menutup sisa keterikatan antar-perangkat.
 */
export async function ambilRiwayat(
  client: PoolClient,
  f: FilterRiwayat
): Promise<{ items: BarisRiwayat[]; cursorBerikut: Kursor | null }> {
  const p: unknown[] = [
    f.from,
    f.to,
    f.outletId,
    f.createdBy,
    f.receiptNumber === null ? null : polaCari(f.receiptNumber),
  ];

  // Satu baris ekstra diminta HANYA untuk mengetahui apakah masih ada
  // halaman berikutnya. Menghitung `COUNT(*)` atas seluruh rentang jauh lebih
  // mahal, dan angkanya basi begitu ia dikembalikan.
  p.push(f.limit + 1);
  const iLimit = p.length;

  let kursorSql = '';
  if (f.cursor !== null) {
    p.push(f.cursor.businessDate, f.cursor.sequence, f.cursor.id);
    const a = p.length - 2;
    kursorSql = `AND (o.business_date, o.sequence, o.id) < ($${a}::date, $${a + 1}::int, $${a + 2})`;
  }

  // ⛔ Penyaring status SELALU dipasang, bahkan ketika pemanggil tidak meminta
  // satu status tertentu. Yang dapat dipilih pemanggil hanyalah MENYEMPITKAN
  // daftar yang sudah terlihat — bukan membuka keranjang terbuka.
  //
  // Kalau daftar terlihatnya hanya berlaku saat `status === null`, permintaan
  // `?status=terbuka` akan menembusnya. Penyaring yang dapat dilewati dengan
  // satu parameter bukan penyaring — dan `STATUS_TERLIHAT` yang membatasi tipe
  // hanya menahan pemanggil TypeScript, bukan query string.
  // ⛔ IRISAN, bukan penggantian. Versi pertama menulis
  // `f.status === null ? STATUS_TERLIHAT : [f.status]` — dan `?status=terbuka`
  // menembusnya utuh, karena permintaan itu MENGGANTI daftar alih-alih
  // menyempitkannya. Ditemukan oleh test, bukan oleh review.
  //
  // Status di luar daftar terlihat menghasilkan larik kosong, jadi jawabannya
  // nol baris — bukan kebocoran, dan bukan error yang memberi tahu penebak
  // bahwa tebakannya hampir benar.
  const diminta: readonly string[] = f.status === null ? STATUS_TERLIHAT : f.status;
  p.push(diminta.filter((s) => (STATUS_TERLIHAT as readonly string[]).includes(s)));
  const statusSql = `AND st.status_tampil = ANY($${p.length}::text[])`;

  const { rows } = await client.query<BarisDb>(
    `WITH dasar AS (
       SELECT o.id, o.receipt_number, o.business_date, ${TANGGAL_SQL('o.business_date')} AS business_date_teks, o.sequence, o.outlet_id,
              o.device_id, o.created_by, o.occurred_at, o.total, o.status,
              o.has_calculation_variance,
              -- ⛔ Pembatal dicari lewat SUBQUERY atas tabel yang sama. Order
              -- asli tidak menyimpan penunjuk ke pembatalnya (AC FR-B7:
              -- "tidak ada UPDATE pada order asli"), jadi arahnya hanya dapat
              -- dibaca terbalik.
              (SELECT v.id FROM "order" v WHERE v.voided_by_order_id = o.id LIMIT 1)
                AS dibatalkan_oleh,
              COALESCE((SELECT SUM(r.amount) FROM refund r WHERE r.order_id = o.id), 0)
                AS nilai_refund
         FROM "order" o
        WHERE o.business_date BETWEEN $1 AND $2
          AND ($3::text IS NULL OR o.outlet_id = $3)
          AND ($4::text IS NULL OR o.created_by = $4)
          -- Lihat catatan ESCAPE di kepala berkas.
          AND ($5::text IS NULL OR o.receipt_number ILIKE $5 ESCAPE '\\')
          -- ⛔ Order PEMBATAL tidak pernah menjadi baris daftar. Ia catatan
          -- koreksi, dan nilainya salinan dari order yang dibatalkannya.
          AND o.voided_by_order_id IS NULL
          ${kursorSql}
     ),
     st AS (
       SELECT dasar.*, ${KOLOM_STATUS} AS status_tampil FROM dasar
     )
     SELECT * FROM st
      WHERE true ${statusSql}
      ORDER BY st.business_date DESC, st.sequence DESC, st.id DESC
      LIMIT $${iLimit}`,
    p
  );

  const adaLagi = rows.length > f.limit;
  const dipakai = adaLagi ? rows.slice(0, f.limit) : rows;

  const items = dipakai.map<BarisRiwayat>((r) => ({
    id: r.id,
    receiptNumber: r.receipt_number,
    businessDate: r.business_date_teks,
    sequence: r.sequence,
    outletId: r.outlet_id,
    deviceId: r.device_id,
    createdBy: r.created_by,
    occurredAt: keIso(r.occurred_at),
    // Uang tetap STRING dari ujung ke ujung — `bigint` rupiah melampaui apa
    // yang `Number` dapat pegang, dan `JSON.stringify` melempar untuk bigint.
    total: String(r.total),
    // ⛔ DIBACA dari SQL, tidak pernah dihitung ulang. Lihat KOLOM_STATUS.
    status: r.status_tampil,
    dibatalkanOleh: r.dibatalkan_oleh,
    nilaiRefund: String(r.nilai_refund ?? 0),
    hasCalculationVariance: r.has_calculation_variance,
  }));

  const akhir = dipakai[dipakai.length - 1];
  return {
    items,
    cursorBerikut:
      adaLagi && akhir !== undefined
        ? { businessDate: akhir.business_date_teks, sequence: akhir.sequence, id: akhir.id }
        : null,
  };
}
