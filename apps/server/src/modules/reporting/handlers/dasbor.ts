import type { PoolClient } from '../../../db.ts';
import { ambilPenjualan, ambilProduk } from '../../ordering/index.ts';
import { ambilStok, saldoTampil } from './stok.ts';
import {
  AMBANG_ANTREAN,
  tingkatAntrean,
  type TingkatAntrean,
} from '../../../../../../packages/domain/src/antrean-menua.ts';

/**
 * B-01 — dasbor beranda.
 *
 * ## ⛔ Ia tidak menghitung apa pun sendiri
 *
 * Omzet datang dari `ambilPenjualan`, produk terlaris dari `ambilProduk`,
 * stok dari `ambilStok` — ketiganya fungsi yang SAMA dengan yang melayani
 * B-16, B-17, dan B-12.
 *
 * Itu bukan sekadar kerapian. Dasbor adalah layar yang pertama dilihat
 * merchant setiap pagi dan yang paling jarang diperiksa ulang; angka di sini
 * yang berbeda dari laporan akan dipercaya lebih dulu, dan `spec-g:29`
 * menyebut akibatnya — kepercayaan merchant hilang lebih cepat daripada
 * karena fitur yang tidak ada.
 *
 * Penjaga `satu-sumber-omzet` menegakkan separuhnya: `SUM(...)` atas tabel
 * `order` di luar `posisi-penjualan.ts` ditolak. Sisanya disiplin, dan berkas
 * ini memilih tidak mengujinya.
 *
 * ## Efisiensi
 *
 * Ketiganya menyaring `business_date` yang punya index
 * `ix_order_outlet_date (tenant_id, outlet_id, business_date)`, dan
 * `ambilProduk` menyaring lewat `ix_line_order`. Rentang bawaan dasbor adalah
 * SATU hari, jadi jumlah baris yang disentuh terikat pada satu tanggal bisnis
 * — bukan pada besarnya riwayat merchant.
 *
 * ⛔ Ketiganya dijalankan BERURUTAN, dan itu bukan pilihan — versi pertama
 * memakai `Promise.all` dengan komentar yang menyatakan ketiganya berjalan
 * "bersamaan". Itu tidak benar: `Promise.all` atas SATU `PoolClient` tidak
 * memparalelkan apa pun. `node-postgres` mengantrekan query pada koneksi yang
 * sama, jadi wall-clock-nya identik dengan berurutan — sambil memancing
 * `DeprecationWarning: Calling client.query() when the client is already
 * executing a query`, perilaku yang **dihapus di pg@9**.
 *
 * Terlihat di log server saat E2E, bukan di test — ketiganya menjawab benar.
 *
 * Memparalelkannya dengan sungguh-sungguh menuntut tiga koneksi, dan itu
 * berarti tiga transaksi: `SET LOCAL app.tenant_id` berlaku per transaksi
 * (invariant #8), jadi ketiganya harus menyetelnya sendiri-sendiri dan dasbor
 * berhenti menjadi satu potret pada satu titik waktu.
 */

export interface ProdukTerlaris {
  variationId: string;
  itemName: string;
  variationName: string;
  /** Kuantitas ×1000, STRING. */
  kuantitas: string;
  /** Bentuk terbaca, dihitung dari bilangan bulat. */
  kuantitasTampil: string;
  nilaiKotor: string;
}

export interface RingkasStokDasbor {
  /** Varian bersaldo di bawah nol — mustahil secara fisik. */
  minus: number;
  /** Varian bersaldo tepat nol. */
  habis: number;
  /** Beberapa nama untuk ditampilkan tanpa membuka B-12. */
  contoh: { variationId: string; itemName: string; variationName: string; saldo: string }[];
}

export interface PerangkatMenua {
  deviceId: string;
  code: string;
  outletId: string;
  /** `null` berarti BELUM PERNAH terhubung — bukan hal yang sama dengan basi. */
  lastSeenAt: string | null;
  /** Jam sejak terakhir menyapa, dibulatkan ke bawah. `null` bila belum pernah. */
  jamSejakTerlihat: number | null;
  tingkat: TingkatAntrean;
}

/**
 * FR-H8 sisi OWNER (`spec-h:311` — "> 24 jam: notifikasi ke owner").
 *
 * ## ⛔ Ini BUKAN umur antrean, dan menyamakan keduanya berbohong dua arah
 *
 * Antrean yang menua adalah penjualan yang **belum pernah sampai** ke server.
 * Server tidak dapat melihatnya sama sekali — tidak ada baris untuk dihitung.
 * Yang dapat dilihatnya adalah perangkat yang **berhenti menyapa**.
 *
 * Perangkat yang mati (bukan offline) terlihat basi meski tidak ada penjualan
 * tertahan; perangkat yang online tapi selalu ditolak server terlihat sehat.
 * Karena itu keduanya dinamai berbeda di UI — "belum terhubung", bukan
 * "antrean menua" — dan hanya AMBANGNYA yang dibagi (`packages/domain`).
 */
export interface RingkasPerangkat {
  /** Perangkat aktif (belum dicabut) yang punya kredensial. */
  total: number;
  /** Yang melewati ambang, terlama dulu. Yang sehat TIDAK ikut. */
  menua: PerangkatMenua[];
  /** Sudah dibuat tapi belum sekali pun menyapa server. */
  belumPernah: number;
}

export interface Dasbor {
  from: string;
  to: string;
  outletId: string | null;
  penjualan: Awaited<ReturnType<typeof ambilPenjualan>>;
  terlaris: ProdukTerlaris[];
  stok: RingkasStokDasbor | null;
  perangkat: RingkasPerangkat;
}

/** Berapa produk terlaris yang ditampilkan. */
export const TOP_N = 5;

/** Berapa contoh stok bermasalah yang dibawa ke dasbor. */
const CONTOH_STOK = 5;

export async function ambilDasbor(
  client: PoolClient,
  { from, to, outletId }: { from: string; to: string; outletId: string | null }
): Promise<Dasbor> {
  // ⛔ Ringkasan stok hanya dapat dibentuk bila SATU outlet dipilih. Stok
  // bersifat per outlet, dan satu angka gabungan lintas outlet tidak dapat
  // dipakai memutuskan apa pun — kekurangan di satu cabang tertutup kelebihan
  // di cabang lain.
  const penjualan = await ambilPenjualan(client, { from, to, outletId });
  const produk = await ambilProduk(client, { from, to, outletId });
  const stok =
    outletId === null
      ? null
      : await ambilStok(client, { outletId, hanyaNegatif: false, sertakanNol: true });

  // ⛔ Top-N diambil dengan `slice`, bukan `LIMIT` di query baru. `ambilProduk`
  // sudah mengurutkan `SUM(quantity) DESC`, dan query kedua dengan LIMIT
  // sendiri adalah tempat kedua yang memutuskan "terlaris" — dua definisi yang
  // akan menyimpang pada aturan void/refund berikutnya yang berubah.
  const terlaris: ProdukTerlaris[] = produk.slice(0, TOP_N).map((p) => ({
    variationId: p.variationId,
    itemName: p.itemName,
    variationName: p.variationName,
    kuantitas: p.kuantitas,
    kuantitasTampil: p.kuantitasTampil,
    nilaiKotor: p.nilaiKotor,
  }));

  let ringkasStok: RingkasStokDasbor | null = null;
  if (stok !== null) {
    let minus = 0;
    let habis = 0;
    const contoh: RingkasStokDasbor['contoh'] = [];
    for (const b of stok) {
      // Varian yang stoknya tidak dilacak tidak punya "habis" yang berarti.
      if (!b.trackStock || b.archived) continue;
      let n: bigint;
      try {
        n = BigInt(b.saldoMilli);
      } catch {
        continue;
      }
      if (n < 0n) minus += 1;
      else if (n === 0n) habis += 1;
      else continue;

      if (contoh.length < CONTOH_STOK) {
        contoh.push({
          variationId: b.variationId,
          itemName: b.itemName,
          variationName: b.variationName,
          saldo: saldoTampil(n),
        });
      }
    }
    ringkasStok = { minus, habis, contoh };
  }

  const perangkat = await ambilRingkasPerangkat(client, outletId);

  return { from, to, outletId, penjualan, terlaris, stok: ringkasStok, perangkat };
}

/**
 * ⛔ Umur dihitung DI DATABASE (`now() - last_seen_at`), bukan di Node.
 *
 * Aturan repo ini, dan ia lahir dari bug nyata: resolusi harga menstempel
 * `effective_from` dengan jam PostgreSQL tapi membaca `at` dari jam Node, dan
 * skew ±2 ms cukup membuat 4 dari 12 run gagal. Di produksi keduanya mesin
 * terpisah — dan di sini selisihnya menentukan perangkat mana yang muncul di
 * layar owner.
 *
 * ⛔ Perangkat TANPA kredensial tidak dihitung sama sekali. Ia belum pernah
 * dapat menyapa server, jadi menandainya "belum terhubung 30 hari" adalah
 * memberi tahu owner tentang perangkat yang memang belum dipasang — dan
 * peringatan yang selalu menyala adalah peringatan yang diabaikan.
 */
async function ambilRingkasPerangkat(
  client: PoolClient,
  outletId: string | null
): Promise<RingkasPerangkat> {
  const { rows } = await client.query<{
    id: string;
    code: string;
    outlet_id: string;
    last_seen_at: string | null;
    jam: string | null;
  }>(
    `SELECT id, code, outlet_id, last_seen_at,
            floor(EXTRACT(EPOCH FROM (now() - last_seen_at)) / 3600)::text AS jam
       FROM device
      WHERE revoked_at IS NULL
        AND token_hash IS NOT NULL
        AND ($1::text IS NULL OR outlet_id = $1)
      ORDER BY last_seen_at NULLS FIRST`,
    [outletId]
  );

  const menua: PerangkatMenua[] = [];
  let belumPernah = 0;

  for (const r of rows) {
    if (r.last_seen_at === null) {
      belumPernah += 1;
      continue;
    }
    const jam = Number(r.jam);
    if (!Number.isFinite(jam)) continue;
    const tingkat = tingkatAntrean(jam, AMBANG_ANTREAN);
    if (tingkat === 'aman') continue;
    menua.push({
      deviceId: r.id,
      code: r.code,
      outletId: r.outlet_id,
      lastSeenAt: r.last_seen_at,
      jamSejakTerlihat: jam,
      tingkat,
    });
  }

  // Terlama dulu — itu yang paling lama tidak mencatat penjualan.
  menua.sort((a, b) => (b.jamSejakTerlihat ?? 0) - (a.jamSejakTerlihat ?? 0));

  return { total: rows.length, menua, belumPernah };
}
