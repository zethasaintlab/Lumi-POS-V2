import type { PoolClient } from '../../../db.ts';

/**
 * M-01/M-02 — "hal yang perlu diperiksa" untuk Owner mobile.
 *
 * `IA:§8` mendaftarkan tepat tiga peristiwa yang muncul di kolom **Owner
 * mobile** sebagai bagian "perlu diperiksa": oversell terdeteksi, dan
 * pembayaran `pending_confirmation` lebih dari 24 jam. Selisih kas ikut karena
 * `spec-g:231` menggambarnya di dalam wireframe M-01 ("Selisih kas Cabang
 * Dago") — dua dokumen, satu daftar.
 *
 * ## ⛔ "Perlu diperiksa" adalah TERTUNGGAK, bukan "terjadi hari ini"
 *
 * Ia sengaja TIDAK disaring per tanggal. Oversell yang belum ditindaklanjuti
 * tiga hari lalu masih perlu ditindaklanjuti malam ini, dan pembayaran yang
 * menggantung 48 jam lebih mendesak daripada yang menggantung 25 jam — bukan
 * kurang. Daftar yang hanya memuat temuan hari ini akan **mengosongkan
 * dirinya sendiri setiap tengah malam**, dan owner yang membukanya pukul 23:00
 * lalu 00:30 melihat dua jawaban berbeda untuk pertanyaan yang sama.
 *
 * Konsekuensinya dinyatakan di layar: bagian ini menjawab "apa yang belum
 * beres", bukan "apa yang terjadi hari ini".
 *
 * ## ⛔ Tanpa bahasa menuduh, dan yang dikirim DATA
 *
 * Aturan `spec-g:168` berlaku penuh di sini — tidak ada skor, tidak ada label,
 * tidak ada kata yang menyalahkan siapa pun. Yang dikirim adalah jenis,
 * outlet, angka, dan waktunya; kalimatnya disusun di klien
 * (`apps/hp/src/ringkasan/m02.ts`), tempat yang sama yang menyusun kalimat
 * lain di layar itu. Kalimat yang disusun server akan menjadi kalimat KEDUA
 * yang harus dijaga sepakat dengan yang di back-office.
 */

/** Ambang `IA:376`. Dinyatakan sebagai konstanta karena layar menyebutnya. */
export const JAM_PEMBAYARAN_MENGGANTUNG = 24;

export type JenisTemuan = 'oversell' | 'selisih_kas' | 'pembayaran_menggantung';

export interface Temuan {
  jenis: JenisTemuan;
  /** Baris asalnya — oversell id, shift id, atau payment id. */
  id: string;
  outletId: string;
  outletNama: string | null;
  /**
   * Angka yang menyertainya, sebagai STRING. Artinya tergantung `jenis`:
   * kuantitas ×1000 (oversell), rupiah bertanda (selisih kas), rupiah
   * (pembayaran menggantung).
   *
   * ⛔ STRING, bukan number — `bigint` tidak dapat melewati JSON dan `Number`
   * membuang presisi di atas 2^53. Aturan yang sama dengan seluruh uang di
   * repo ini.
   */
  nilai: string;
  /** Kapan hal ini mulai perlu diperiksa. ISO. */
  terjadiPada: string;
  /**
   * Konteks tambahan yang hanya sebagian jenis punya: nama produk (oversell)
   * atau tanggal bisnis shift (selisih kas). `null` bila tidak berlaku.
   */
  keterangan: string | null;
}

export interface PerluPerhatian {
  outletId: string | null;
  /**
   * ⛔ TOTAL, bukan panjang `temuan`. Layar M-01 hanya menampilkan tiga
   * (`IA:373`: "maks 3 temuan"), dan tiga dari sembilan yang tidak menyebut
   * sembilan **mengecilkan** apa yang sebenarnya menunggu.
   */
  jumlah: number;
  temuan: Temuan[];
}

const teks = (v: unknown): string => String(v ?? 0);
const keIso = (v: Date | string): string => (v instanceof Date ? v.toISOString() : String(v));

/**
 * Seluruh hal yang belum beres, terbaru lebih dulu.
 *
 * ⛔ Ketiga query berjalan BERURUTAN pada satu `PoolClient`. `node-postgres`
 * mengantrekan query pada koneksi yang sama, jadi `Promise.all` di sini tidak
 * membeli apa pun selain `DeprecationWarning` — perilaku yang dihapus di
 * pg@9. Alasan lengkapnya di `reporting/index.ts`.
 */
export async function ambilPerluPerhatian(
  client: PoolClient,
  { outletId }: { outletId: string | null }
): Promise<PerluPerhatian> {
  const oversell = await client.query<{
    id: string;
    outlet_id: string;
    outlet_nama: string | null;
    quantity_over: string;
    detected_at: Date;
    nama: string | null;
  }>(
    `SELECT e.id,
            e.outlet_id,
            o.name AS outlet_nama,
            e.quantity_over,
            e.detected_at,
            i.name AS nama
       FROM oversell_event e
       LEFT JOIN outlet o ON o.id = e.outlet_id
       LEFT JOIN item_variation v ON v.id = e.variation_id
       LEFT JOIN item i ON i.id = v.item_id
      WHERE e.resolved_at IS NULL
        AND ($1::text IS NULL OR e.outlet_id = $1)
      ORDER BY e.detected_at DESC`,
    [outletId]
  );

  // ⛔ Hanya shift yang SUDAH DITUTUP. Shift berjalan tidak punya selisih —
  // `difference` dibekukan saat penutupan, dan membacanya sebelum itu berarti
  // melaporkan angka yang belum ditandatangani siapa pun.
  const selisih = await client.query<{
    id: string;
    outlet_id: string;
    outlet_nama: string | null;
    difference: string;
    closed_at: Date;
    business_date: string;
  }>(
    `SELECT s.id,
            s.outlet_id,
            o.name AS outlet_nama,
            s.difference,
            s.closed_at,
            s.business_date::text AS business_date
       FROM cash_drawer_shift s
       LEFT JOIN outlet o ON o.id = s.outlet_id
      WHERE s.status = 'closed'
        AND s.closed_at IS NOT NULL
        AND s.difference IS NOT NULL
        AND s.difference <> 0
        AND ($1::text IS NULL OR s.outlet_id = $1)
      ORDER BY s.closed_at DESC`,
    [outletId]
  );

  // ⛔ Ambangnya dihitung terhadap `now()` DATABASE, bukan jam pemanggil.
  // Jam Node dan jam PostgreSQL adalah dua mesin di produksi.
  const menggantung = await client.query<{
    id: string;
    outlet_id: string;
    outlet_nama: string | null;
    amount: string;
    occurred_at: Date;
  }>(
    `SELECT p.id,
            p.outlet_id,
            o.name AS outlet_nama,
            p.amount,
            p.occurred_at
       FROM payment p
       LEFT JOIN outlet o ON o.id = p.outlet_id
      WHERE p.status = 'pending_confirmation'
        AND p.occurred_at < now() - ($2 || ' hours')::interval
        AND ($1::text IS NULL OR p.outlet_id = $1)
      ORDER BY p.occurred_at DESC`,
    [outletId, String(JAM_PEMBAYARAN_MENGGANTUNG)]
  );

  const temuan: Temuan[] = [
    ...oversell.rows.map((r) => ({
      jenis: 'oversell' as const,
      id: r.id,
      outletId: r.outlet_id,
      outletNama: r.outlet_nama,
      nilai: teks(r.quantity_over),
      terjadiPada: keIso(r.detected_at),
      keterangan: r.nama,
    })),
    ...selisih.rows.map((r) => ({
      jenis: 'selisih_kas' as const,
      id: r.id,
      outletId: r.outlet_id,
      outletNama: r.outlet_nama,
      nilai: teks(r.difference),
      terjadiPada: keIso(r.closed_at),
      keterangan: r.business_date,
    })),
    ...menggantung.rows.map((r) => ({
      jenis: 'pembayaran_menggantung' as const,
      id: r.id,
      outletId: r.outlet_id,
      outletNama: r.outlet_nama,
      nilai: teks(r.amount),
      terjadiPada: keIso(r.occurred_at),
      keterangan: null,
    })),
  ];

  // ⛔ Diurutkan ulang lintas jenis. Tiga daftar yang disambung apa adanya
  // membuat M-01 — yang hanya menampilkan tiga teratas — selalu menampilkan
  // oversell dan tidak pernah menampilkan selisih kas, berapa pun umurnya.
  temuan.sort((a, b) => (a.terjadiPada < b.terjadiPada ? 1 : a.terjadiPada > b.terjadiPada ? -1 : 0));

  return { outletId, jumlah: temuan.length, temuan };
}
