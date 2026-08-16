import type { PoolClient } from '../../../db.ts';

/**
 * B-12 — saldo stok per variation, dari `SUM(delta)`.
 *
 * ## ⛔ `SUM(delta)`, bukan `stock_snapshot`
 *
 * Keputusan user 16 Agustus 2026. Tabel `stock_snapshot` ada di skema server
 * sejak migrasi `0010` dan **kosong** (terukur 0 baris) — pola snapshot hanya
 * hidup di aplikasi kasir. Memakainya di sini berarti membangun keadaan kedua
 * yang dapat basi, untuk mempercepat sesuatu yang belum pernah diukur lambat.
 *
 * ## Modul `reporting`, dan itu keputusan yang sama dengan B-03
 *
 * Saldo stok butuh `stock_movement` (milik `inventory`) DAN nama produk
 * (milik `catalog`). Tidak ada satu pemilik yang masuk akal, dan modul ini
 * satu-satunya yang boleh membaca lintas domain — karena ia tidak memiliki
 * tabel apa pun dan tidak menulis apa pun.
 *
 * ## ⛔ Pembagian 1000 di JavaScript
 *
 * `SUM(delta) / 1000` di PostgreSQL atas kolom `bigint` adalah pembagian
 * INTEGER: saldo `2500` menjadi `2`, dan setengah kilogram menghilang tanpa
 * error. Pelajaran yang sama dengan `kuantitasTampil` di B-03 — dan di sini
 * akibatnya lebih jauh, karena angkanya dipakai memutuskan pembelian.
 */

export interface BarisStok {
  variationId: string;
  itemId: string;
  itemName: string;
  variationName: string;
  categoryId: string | null;
  outletId: string;
  trackStock: boolean;
  archived: boolean;
  /** Saldo ×1000, STRING — kuantitas ikut aturan uang. */
  saldoMilli: string;
  /** Saldo terbaca manusia, dihitung dari bilangan bulat. */
  saldo: string;
  jumlahMovement: number;
  movementTerakhir: string | null;
}

export interface FilterStok {
  outletId: string | null;
  /** Hanya variation yang saldonya < 0. */
  hanyaNegatif: boolean;
  /** Sertakan variation yang belum punya movement sama sekali. */
  sertakanNol: boolean;
}

/**
 * Saldo ×1000 dibuat terbaca manusia.
 *
 * ⛔ Dari bilangan bulat, tidak pernah lewat pembagian float. Sama persis
 * dengan `kuantitasTampil` di B-03, dan ada test yang membandingkan keduanya
 * supaya tidak menyimpang.
 */
export function saldoTampil(milli: bigint): string {
  const negatif = milli < 0n;
  const abs = negatif ? -milli : milli;
  const utuh = abs / 1000n;
  const sisa = abs % 1000n;
  const tanda = negatif ? '-' : '';
  if (sisa === 0n) return `${tanda}${utuh}`;
  return `${tanda}${utuh},${sisa.toString().padStart(3, '0').replace(/0+$/, '')}`;
}

interface BarisDb {
  variation_id: string;
  item_id: string;
  item_name: string;
  variation_name: string;
  category_id: string | null;
  outlet_id: string;
  track_stock: boolean;
  archived: boolean;
  saldo: string | number | bigint | null;
  jumlah_movement: string | number;
  movement_terakhir: Date | string | null;
}

/**
 * Saldo stok per (outlet, variation).
 *
 * ⛔ `LEFT JOIN` dari katalog ke movement, bukan sebaliknya. Variation yang
 * belum punya satu pun movement **tidak muncul** kalau arahnya dibalik — dan
 * itu persis produk yang paling perlu terlihat di B-12: barang baru yang
 * stoknya belum pernah dimasukkan. Nol yang hilang dari daftar terbaca sebagai
 * "tidak ada masalah".
 *
 * ⛔ Outlet ikut di-`CROSS JOIN` ketika `outletId` diberikan, supaya saldo nol
 * tetap punya baris. Tanpa outlet yang jelas, saldo per outlet tidak dapat
 * dibentuk untuk variation tanpa movement — dan itu sebabnya `sertakanNol`
 * hanya berlaku bila satu outlet dipilih.
 */
export async function ambilStok(
  client: PoolClient,
  f: FilterStok
): Promise<BarisStok[]> {
  const sertakanNol = f.sertakanNol && f.outletId !== null;

  const sql = sertakanNol
    ? `WITH dasar AS (
         SELECT iv.id AS variation_id, iv.item_id, i.name AS item_name,
                iv.name AS variation_name, i.category_id, iv.track_stock,
                (iv.archived_at IS NOT NULL OR i.archived_at IS NOT NULL) AS archived,
                $1::text AS outlet_id
           FROM item_variation iv
           JOIN item i ON i.id = iv.item_id
       )
       SELECT d.*,
              COALESCE(SUM(sm.delta), 0)::text AS saldo,
              count(sm.*)::int                 AS jumlah_movement,
              MAX(sm.occurred_at)              AS movement_terakhir
         FROM dasar d
         LEFT JOIN stock_movement sm
                ON sm.variation_id = d.variation_id AND sm.outlet_id = d.outlet_id
        GROUP BY d.variation_id, d.item_id, d.item_name, d.variation_name,
                 d.category_id, d.track_stock, d.archived, d.outlet_id
        ORDER BY d.item_name, d.variation_name, d.variation_id`
    : `SELECT sm.variation_id, iv.item_id, i.name AS item_name,
              iv.name AS variation_name, i.category_id, iv.track_stock,
              (iv.archived_at IS NOT NULL OR i.archived_at IS NOT NULL) AS archived,
              sm.outlet_id,
              SUM(sm.delta)::text AS saldo,
              count(*)::int       AS jumlah_movement,
              MAX(sm.occurred_at) AS movement_terakhir
         FROM stock_movement sm
         JOIN item_variation iv ON iv.id = sm.variation_id
         JOIN item i            ON i.id = iv.item_id
        WHERE ($1::text IS NULL OR sm.outlet_id = $1)
        GROUP BY sm.variation_id, iv.item_id, i.name, iv.name, i.category_id,
                 iv.track_stock, iv.archived_at, i.archived_at, sm.outlet_id
        ORDER BY i.name, iv.name, sm.variation_id`;

  const { rows } = await client.query<BarisDb>(sql, [f.outletId]);

  const hasil: BarisStok[] = [];
  for (const r of rows) {
    const milli = BigInt(String(r.saldo ?? 0));
    if (f.hanyaNegatif && milli >= 0n) continue;
    hasil.push({
      variationId: r.variation_id,
      itemId: r.item_id,
      itemName: r.item_name,
      variationName: r.variation_name,
      categoryId: r.category_id,
      outletId: r.outlet_id,
      trackStock: r.track_stock,
      archived: r.archived,
      saldoMilli: milli.toString(),
      saldo: saldoTampil(milli),
      jumlahMovement: Number(r.jumlah_movement),
      movementTerakhir:
        r.movement_terakhir === null
          ? null
          : r.movement_terakhir instanceof Date
            ? r.movement_terakhir.toISOString()
            : String(r.movement_terakhir),
    });
  }
  return hasil;
}
