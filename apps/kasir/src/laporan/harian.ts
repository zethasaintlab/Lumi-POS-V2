import type { DbLokal } from '../../../../packages/sync-client/src/ports.ts';
import {
  posisiPenjualan,
  type PosisiPenjualan,
} from '../../../../packages/domain/src/posisi-penjualan.ts';

/**
 * FR-G1 / FR-G2 / FR-G4 — laporan operasional dari data LOKAL.
 *
 * ## Yang dilakukan berkas ini, dan yang TIDAK
 *
 * Ia membaca baris dan mengelompokkannya. Ia tidak mendefinisikan omzet —
 * itu milik `packages/domain/src/posisi-penjualan.ts` (FR-G3), dan ada
 * penjaga yang menolak `SUM(...)` atas tabel `"order"` di berkas mana pun
 * selain itu.
 *
 * ## ⛔ Tanggal bisnis dibaca, bukan dihitung ulang
 *
 * `order.business_date` sudah distempel saat penjualan ditulis, memakai zona
 * outlet dan batas `business_day_ends_at`. Laporan yang menghitungnya ulang
 * dari `occurred_at` menjadi tempat KEDUA yang memutuskan hal yang sama, dan
 * keduanya akan bergeser — perangkat yang zonanya berubah, atau outlet yang
 * mengubah jam tutupnya, membuat laporan lama berpindah hari tanpa satu pun
 * baris berubah.
 *
 * ## Cakupan dinyatakan, bukan diasumsikan
 *
 * `spec-g:111` menuntut UI menyatakan "Laporan ini hanya mencakup transaksi
 * dari perangkat ini." Nilainya dibawa di DATA (`cakupan`), bukan hanya di
 * teks layar, supaya ekspor dan pemanggil lain tidak kehilangannya.
 */

/**
 * Label bersih/kotor (FR-G2).
 *
 * `spec-g:64`: labelnya "tidak dapat dilewatkan". Karena itu ia field di
 * dalam laporan, bukan kalimat yang ditulis layar — layar berikutnya yang
 * lupa menuliskannya menghasilkan angka tanpa arti, dan ekspor CSV
 * kehilangannya sepenuhnya (`spec-g:74`).
 */
export type BasisAngka = 'setelah void & refund' | 'sebelum void & refund';

interface BarisOrder {
  id: string;
  status: string;
  total: number;
  tax_amount: number;
  voided_by_order_id: string | null;
}

/**
 * Order pada tanggal bisnis ini, beserta pembatalnya.
 *
 * Pembatal WAJIB ikut terbaca: tanpanya `posisiPenjualan` tidak dapat tahu
 * order mana yang dibatalkan, dan penjualan yang sudah batal tetap masuk
 * omzet kotor.
 */
async function orderHari(db: DbLokal, businessDate: string): Promise<BarisOrder[]> {
  return db.getAll<BarisOrder>(
    `SELECT id, status, total, tax_amount, voided_by_order_id
       FROM "order" WHERE business_date = ?`,
    [businessDate]
  );
}

async function refundHari(
  db: DbLokal,
  businessDate: string
): Promise<{ order_id: string; amount: number }[]> {
  return db.getAll<{ order_id: string; amount: number }>(
    `SELECT r.order_id, r.amount
       FROM refund r JOIN "order" o ON o.id = r.order_id
      WHERE o.business_date = ?`,
    [businessDate]
  );
}

function keposisi(orders: BarisOrder[], refunds: { order_id: string; amount: number }[]) {
  return posisiPenjualan({
    orders: orders.map((o) => ({
      id: o.id,
      status: o.status,
      total: o.total,
      taxAmount: o.tax_amount,
      voidedByOrderId: o.voided_by_order_id,
    })),
    refunds: refunds.map((r) => ({ orderId: r.order_id, amount: r.amount })),
  });
}

/** Id order yang punya pembatal — dipakai untuk menyaring baris produk. */
function idDibatalkan(orders: BarisOrder[]): Set<string> {
  const s = new Set<string>();
  for (const o of orders) if (o.voided_by_order_id) s.add(o.voided_by_order_id);
  return s;
}

const STATUS_PENJUALAN: ReadonlySet<string> = new Set(['paid', 'closed', 'refunded']);

export interface LaporanHarian {
  businessDate: string;
  basis: BasisAngka;
  /** FR-G4 — `spec-g:111`. */
  cakupan: 'perangkat-ini';
  penjualan: PosisiPenjualan;
  perMetode: { metode: string; jumlah: number; total: bigint }[];
  perJam: { jam: number; jumlahTransaksi: number; omzet: bigint }[];
}

export async function laporanHarian(
  db: DbLokal,
  { businessDate }: { businessDate: string }
): Promise<LaporanHarian> {
  const orders = await orderHari(db, businessDate);
  const refunds = await refundHari(db, businessDate);
  const batal = idDibatalkan(orders);

  const bayar = await db.getAll<{ method: string; amount: number; order_id: string }>(
    `SELECT p.method, p.amount, p.order_id
       FROM payment p JOIN "order" o ON o.id = p.order_id
      WHERE o.business_date = ?`,
    [businessDate]
  );
  const perMetodeMap = new Map<string, { jumlah: number; total: bigint }>();
  for (const b of bayar) {
    if (batal.has(b.order_id)) continue;
    const kini = perMetodeMap.get(b.method) ?? { jumlah: 0, total: 0n };
    kini.jumlah += 1;
    kini.total += BigInt(b.amount);
    perMetodeMap.set(b.method, kini);
  }

  // Distribusi per jam (`spec-g:90`) — untuk perencanaan staf.
  //
  // Jam tanpa transaksi TIDAK dilaporkan sebagai nol. Dua puluh empat baris
  // yang sebagian besar kosong memenuhi layar dan menyembunyikan yang tiga
  // yang benar-benar ada.
  const perJamMap = new Map<number, { jumlahTransaksi: number; omzet: bigint }>();
  const waktu = await db.getAll<{ id: string; status: string; total: number; occurred_at: string }>(
    `SELECT id, status, total, occurred_at FROM "order" WHERE business_date = ?`,
    [businessDate]
  );
  for (const o of waktu) {
    if (!STATUS_PENJUALAN.has(o.status) || batal.has(o.id)) continue;
    const jam = Number(o.occurred_at.slice(11, 13));
    if (!Number.isInteger(jam)) continue;
    const kini = perJamMap.get(jam) ?? { jumlahTransaksi: 0, omzet: 0n };
    kini.jumlahTransaksi += 1;
    kini.omzet += BigInt(o.total);
    perJamMap.set(jam, kini);
  }

  return {
    businessDate,
    basis: 'setelah void & refund',
    cakupan: 'perangkat-ini',
    penjualan: keposisi(orders, refunds),
    // ⛔ Diurutkan di JS, bukan lewat `ORDER BY`. Jaminan urutan yang hanya
    // hidup di SQL tidak dapat diuji sama sekali — fake `DbLokal` tidak
    // menegakkannya, dan pelajaran itu sudah dibayar sekali.
    perMetode: [...perMetodeMap]
      .map(([metode, v]) => ({ metode, ...v }))
      .sort((a, b) => (b.total > a.total ? 1 : b.total < a.total ? -1 : a.metode.localeCompare(b.metode))),
    perJam: [...perJamMap]
      .map(([jam, v]) => ({ jam, ...v }))
      .sort((a, b) => a.jam - b.jam),
  };
}

export interface BarisProduk {
  variationId: string;
  namaItem: string;
  namaVariasi: string;
  /** ×1000, konvensi kuantitas. */
  kuantitasMilli: number;
  omzet: bigint;
  /** Dibulatkan ke bilangan bulat; jumlahnya boleh tidak tepat 100. */
  kontribusiPersen: number;
}

export interface LaporanPerProduk {
  businessDate: string;
  /**
   * ⛔ `sebelum void & refund`, dan itu BUKAN kelalaian.
   *
   * Baris produk menyatakan barang apa yang keluar, dan refund uang tidak
   * selalu mengembalikan barang — `lines: []` berarti uang kembali tanpa
   * barang kembali (keputusan refund parsial). Menyebutnya "bersih" akan
   * mengklaim sesuatu yang datanya tidak dukung.
   *
   * Order yang DIBATALKAN tetap disaring keluar: di sana barangnya memang
   * kembali ke rak, dan totalnya harus cocok dengan omzet kotor harian.
   */
  basis: BasisAngka;
  cakupan: 'perangkat-ini';
  baris: BarisProduk[];
}

export async function laporanPerProduk(
  db: DbLokal,
  { businessDate }: { businessDate: string }
): Promise<LaporanPerProduk> {
  const orders = await orderHari(db, businessDate);
  const batal = idDibatalkan(orders);
  const sah = new Set(
    orders.filter((o) => STATUS_PENJUALAN.has(o.status) && !batal.has(o.id)).map((o) => o.id)
  );

  // ⛔ TIDAK ADA `cost_at_sale` di sini, dan tidak ada margin (FR-F5).
  // `spec-f:66`: "kolom dan field yang memuat cost/margin TIDAK ADA di
  // respons — bukan sekadar disembunyikan di UI." Di perangkat ini bahkan
  // tidak mungkin: `item_variation.cost` sudah dibuang dari skema lokal dan
  // dari sync rules, jadi datanya tidak pernah turun.
  const baris = await db.getAll<{
    order_id: string;
    variation_id: string;
    item_name: string;
    variation_name: string;
    quantity: number;
    line_total: number;
  }>(
    `SELECT l.order_id, l.variation_id, l.item_name, l.variation_name, l.quantity, l.line_total
       FROM order_line l JOIN "order" o ON o.id = l.order_id
      WHERE o.business_date = ?`,
    [businessDate]
  );

  const per = new Map<string, BarisProduk>();
  let total = 0n;
  for (const b of baris) {
    if (!sah.has(b.order_id)) continue;
    const kini = per.get(b.variation_id) ?? {
      variationId: b.variation_id,
      namaItem: b.item_name,
      namaVariasi: b.variation_name,
      kuantitasMilli: 0,
      omzet: 0n,
      kontribusiPersen: 0,
    };
    kini.kuantitasMilli += b.quantity;
    kini.omzet += BigInt(b.line_total);
    total += BigInt(b.line_total);
    per.set(b.variation_id, kini);
  }

  const hasil = [...per.values()].map((b) => ({
    ...b,
    kontribusiPersen: total === 0n ? 0 : Number((b.omzet * 100n) / total),
  }));

  return {
    businessDate,
    basis: 'sebelum void & refund',
    cakupan: 'perangkat-ini',
    // Terurut menurun: `spec-g:86` menuntut laporan per produk "diurutkan",
    // dan yang berguna bagi merchant adalah yang paling laku di baris atas.
    baris: hasil.sort((a, b) =>
      b.omzet > a.omzet ? 1 : b.omzet < a.omzet ? -1 : a.variationId.localeCompare(b.variationId)
    ),
  };
}
