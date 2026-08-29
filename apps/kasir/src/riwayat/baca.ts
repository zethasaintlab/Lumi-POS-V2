import type { DbLokal } from '../../../../packages/sync-client/src/ports.ts';
import { statusRecordBanyak } from '../../../../packages/sync-client/src/status.ts';
import type { StateIndikator } from '../../../../packages/sync-client/src/status.ts';
import { sisaPerBaris } from '../../../../packages/domain/src/pilihan-refund.ts';

/**
 * K-08 Riwayat Transaksi + K-09 Detail Transaksi.
 *
 * ## ⛔ Kenapa "rantai koreksi" menentukan bentuk modul ini
 *
 * `IA:68` menandai K-09 dengan satu kalimat: *"Menampilkan rantai koreksi."*
 * Itu konsekuensi langsung invariant #2 — transaksi selesai tidak pernah
 * di-`UPDATE`. Void dan refund adalah baris **lain**, dan tanpa merangkainya
 * kasir melihat order yang terlihat normal padahal sudah dibatalkan.
 *
 * Yang paling mudah salah: `CLAUDE.md` menyatakan **order yang sudah di-void
 * tetap berstatus `open`**. `voided_by_order_id` ada di order PEMBATAL,
 * menunjuk order yang dibatalkan — arahnya dipaksa AC FR-B7 pertama, karena
 * pembatalnya belum ada saat order asli ditulis. Menyimpulkan "order ini sah"
 * dari `status = 'open'` saja adalah kekeliruan yang tidak terlihat di layar.
 *
 * Seluruhnya dibaca dari SQLite lokal: K-08 dan K-09 offline-capable
 * (`IA:2.2`), dan riwayat yang menuntut jaringan tidak berguna justru saat
 * kasir paling membutuhkannya.
 */

export interface RingkasOrder {
  id: string;
  receiptNumber: string;
  businessDate: string;
  status: string;
  total: number;
  occurredAt: string;
  statusSync: StateIndikator;
  /** Order ini dibatalkan oleh order lain. */
  dibatalkan: boolean;
  dibatalkanOleh: string | null;
  /** Order ini adalah PEMBATAL bagi order lain. */
  membatalkan: string | null;
}

interface BarisOrder {
  id: string;
  receipt_number: string;
  business_date: string;
  status: string;
  total: number;
  amount_due: number;
  tax_amount: number;
  rounding_adjustment: number;
  occurred_at: string;
  created_by: string;
  voided_by_order_id: string | null;
}

const SQL_DAFTAR = `
  SELECT o.id, o.receipt_number, o.business_date, o.status, o.total, o.amount_due,
         o.tax_amount, o.rounding_adjustment, o.occurred_at, o.created_by,
         o.voided_by_order_id
    FROM "order" o
   ORDER BY o.occurred_at DESC, o.sequence DESC
   LIMIT ?`;

export async function bacaRiwayat(
  db: DbLokal,
  { batas = 50 }: { batas?: number } = {}
): Promise<RingkasOrder[]> {
  const baris = await db.getAll<BarisOrder>(SQL_DAFTAR, [batas]);
  if (baris.length === 0) return [];

  // Terburuk-menang, dan itu WAJIB: satu order punya beberapa baris outbox
  // (`order` dan `payment` memakai `entity_id` yang sama). Order yang
  // pembayarannya gagal terkirim tidak boleh terlihat `ok` — justru itu
  // penjualan yang uangnya berisiko.
  const status = await statusRecordBanyak(db, baris.map((b) => b.id));

  // Peta terbalik: order mana yang dibatalkan order mana. Dibangun dari
  // daftar yang sama, bukan lewat query kedua — pembatal dan yang dibatalkan
  // selalu berdekatan waktunya, jadi keduanya ada di jendela riwayat yang
  // sama. Pembatal yang jatuh di luar batas hanya berarti penanda tidak
  // muncul, bukan data yang salah.
  const dibatalkanOleh = new Map<string, string>();
  for (const b of baris) {
    if (b.voided_by_order_id) dibatalkanOleh.set(b.voided_by_order_id, b.id);
  }

  // ⛔ Diurutkan LAGI di sini, dan itu bukan duplikasi `ORDER BY` di atas.
  // Keduanya punya tugas berbeda: `ORDER BY … LIMIT ?` menentukan baris MANA
  // yang masuk jendela riwayat (tanpa itu, `LIMIT` mengambil N baris
  // sembarang), sementara pengurutan di sini menjamin urutan TAMPIL.
  //
  // Ia juga satu-satunya yang membuat jaminan urutan dapat diuji tanpa
  // SQLite sungguhan — pelajaran yang sama dengan urutan modifier di
  // `katalog/baca.ts`.
  const terurut = [...baris].sort(
    (a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at)
  );

  return terurut.map((b) => ({
    id: b.id,
    receiptNumber: b.receipt_number,
    businessDate: b.business_date,
    status: b.status,
    total: b.total,
    occurredAt: b.occurred_at,
    statusSync: status[b.id] ?? 'ok',
    dibatalkan: dibatalkanOleh.has(b.id),
    dibatalkanOleh: dibatalkanOleh.get(b.id) ?? null,
    membatalkan: b.voided_by_order_id,
  }));
}

export interface BarisDetail {
  id: string;
  /** Dibutuhkan pemilihan baris refund: batasnya per VARIASI, bukan per baris. */
  variationId: string;
  itemName: string;
  variationName: string;
  unitPrice: number;
  quantityMilli: number;
  lineTotal: number;
  taxAmount: number;
  modifier: string[];
  /**
   * FR-B7 — yang MASIH boleh dikembalikan dari baris ini (×1000).
   *
   * ⛔ Dihitung, tidak disimpan, dan turunannya per VARIASI: `stock_movement`
   * tidak menyimpan `line_id`, jadi kebenaran per baris tidak ada di mana pun.
   * Aturannya milik `packages/domain/src/pilihan-refund.ts` dan dibagi dengan
   * penegakan di `batalkan` — dua salinan akan menawarkan pilihan yang lalu
   * ditolak.
   */
  sisaKembaliMilli: number;
}

export interface PembayaranDetail {
  id: string;
  metode: string;
  jumlah: number;
  diterima: number | null;
  kembalian: number | null;
  status: string;
}

export interface RefundDetail {
  id: string;
  jumlah: number;
  alasan: string;
  catatan: string | null;
  disetujuiOleh: string | null;
  terjadiPada: string;
}

export interface DetailOrder {
  order: {
    id: string;
    receiptNumber: string;
    businessDate: string;
    status: string;
    total: number;
    amountDue: number;
    taxAmount: number;
    roundingAdjustment: number;
    occurredAt: string;
    createdBy: string;
    membatalkan: string | null;
  };
  baris: BarisDetail[];
  pembayaran: PembayaranDetail[];
  refund: RefundDetail[];
  /** Dihitung, tidak disimpan — lihat catatan di bawah. */
  sisaDapatDirefund: number;
}

export async function bacaDetail(db: DbLokal, orderId: string): Promise<DetailOrder | null> {
  const baris = await db.getAll<BarisOrder>(
    `SELECT o.id, o.receipt_number, o.business_date, o.status, o.total, o.amount_due,
            o.tax_amount, o.rounding_adjustment, o.occurred_at, o.created_by,
            o.voided_by_order_id
       FROM "order" o WHERE o.id = ?`,
    [orderId]
  );
  const o = baris[0];
  // `null`, bukan melempar. Order yang tidak ada dapat berarti tautan lama
  // atau riwayat yang sudah dipangkas; layar yang jatuh dengan galat merah
  // untuk itu lebih buruk daripada layar yang berkata "tidak ditemukan".
  if (!o) return null;

  const [lines, payments, refunds] = await Promise.all([
    db.getAll<{
      id: string; variation_id: string; item_name: string; variation_name: string;
      unit_price: number; quantity: number; line_total: number; tax_amount: number;
      modifier_snapshot: string | null;
    }>(
      `SELECT id, variation_id, item_name, variation_name, unit_price, quantity, line_total,
              tax_amount, modifier_snapshot
         FROM order_line WHERE order_id = ?`,
      [orderId]
    ),
    db.getAll<{
      id: string; method: string; amount: number; tendered_amount: number | null;
      change_amount: number | null; status: string;
    }>(
      `SELECT id, method, amount, tendered_amount, change_amount, status
         FROM payment WHERE order_id = ?`,
      [orderId]
    ),
    db.getAll<{
      id: string; amount: number; reason_code: string; reason_note: string | null;
      approved_by: string | null; occurred_at: string;
    }>(
      `SELECT id, amount, reason_code, reason_note, approved_by, occurred_at
         FROM refund WHERE order_id = ?`,
      [orderId]
    ),
  ]);

  const sudahDirefund = refunds.reduce((s, r) => s + r.amount, 0);

  // Barang yang sudah kembali ke rak dari order ini, per VARIASI. Aturan yang
  // sama dengan server (`planRestock`): `void` DAN `refund`, karena keduanya
  // mengembalikan stok.
  const kembali = await db.getAll<{ variation_id: string; total: number | bigint | string }>(
    `SELECT variation_id, SUM(delta) AS total
       FROM stock_movement
      WHERE order_id = ? AND type IN ('refund', 'void')
      GROUP BY variation_id`,
    [orderId]
  );
  const sisa = new Map(
    sisaPerBaris(
      lines.map((l) => ({
        lineId: l.id,
        variationId: l.variation_id,
        quantityMilli: BigInt(l.quantity),
        lineTotal: BigInt(l.line_total),
      })),
      // ⛔ Ketiga bentuk: `@powersync/web` mengembalikan INTEGER besar sebagai
      // `bigint`, `node:sqlite` sebagai `number`.
      kembali.map((k) => ({ variationId: k.variation_id, quantityMilli: BigInt(k.total ?? 0) }))
    ).map((s) => [s.lineId, Number(s.sisaMilli)])
  );

  return {
    order: {
      id: o.id,
      receiptNumber: o.receipt_number,
      businessDate: o.business_date,
      status: o.status,
      total: o.total,
      amountDue: o.amount_due,
      taxAmount: o.tax_amount,
      roundingAdjustment: o.rounding_adjustment,
      occurredAt: o.occurred_at,
      createdBy: o.created_by,
      membatalkan: o.voided_by_order_id,
    },
    baris: lines.map((l) => ({
      id: l.id,
      variationId: l.variation_id,
      itemName: l.item_name,
      variationName: l.variation_name,
      unitPrice: l.unit_price,
      quantityMilli: l.quantity,
      lineTotal: l.line_total,
      taxAmount: l.tax_amount,
      modifier: uraikanModifier(l.modifier_snapshot),
      sisaKembaliMilli: sisa.get(l.id) ?? l.quantity,
    })),
    pembayaran: payments.map((p) => ({
      id: p.id,
      metode: p.method,
      jumlah: p.amount,
      diterima: p.tendered_amount,
      kembalian: p.change_amount,
      status: p.status,
    })),
    refund: refunds.map((r) => ({
      id: r.id,
      jumlah: r.amount,
      alasan: r.reason_code,
      catatan: r.reason_note,
      disetujuiOleh: r.approved_by,
      terjadiPada: r.occurred_at,
    })),
    // ⛔ DIHITUNG, tidak disimpan. Server menegakkan batasnya sendiri
    // (`assertRefundWithinLimit`); yang di sini hanya agar K-10 tidak
    // menawarkan angka yang pasti ditolak — kasir yang menjanjikan uang lalu
    // ditolak berdiri di depan pelanggan.
    //
    // `Math.max(0, …)` bukan pemanis: refund yang totalnya melebihi order
    // seharusnya mustahil, tapi bila baris rusak sampai ke sini, angka
    // negatif di layar jauh lebih membingungkan daripada nol.
    sisaDapatDirefund: Math.max(0, o.total - sudahDirefund),
  };
}

/**
 * `order_line.modifier_snapshot` adalah JSON teks.
 *
 * Ia snapshot NAMA, bukan penunjuk ke `modifier` — modifier yang diganti
 * namanya besok tidak boleh mengubah struk yang sudah tercetak hari ini.
 * Bentuk rusak dikembalikan sebagai daftar kosong: satu baris yang JSON-nya
 * cacat tidak boleh menjatuhkan seluruh layar detail.
 *
 * ⛔ DUA bentuk diterima, dan itu bukan kelonggaran. Sebelum FR-A3 isinya
 * `["Es"]`; sejak FR-A3 ia `[{ nama, qtyMilli }]` supaya "Extra Shot ×2"
 * terbaca di layar yang dipakai memutuskan refund. Baris lama ada di perangkat
 * merchant dan tidak dapat ditulis ulang — `order_line` tidak pernah di-`UPDATE`
 * (invariant #2). Menolak bentuk lama berarti seluruh riwayat sebelum hari ini
 * kehilangan modifiernya.
 */
function uraikanModifier(snapshot: string | null): string[] {
  if (!snapshot) return [];
  try {
    const nilai: unknown = JSON.parse(snapshot);
    if (!Array.isArray(nilai)) return [];
    return nilai.map((m) => {
      if (typeof m !== 'object' || m === null) return String(m);
      const { nama, qtyMilli } = m as { nama?: unknown; qtyMilli?: unknown };
      const teks = typeof nama === 'string' ? nama : String(nama);
      const qty = typeof qtyMilli === 'number' ? qtyMilli : 1000;
      return qty === 1000 ? teks : `${teks} ×${qty / 1000}`;
    });
  } catch {
    return [];
  }
}

/** Pencarian nomor struk (K-08). */
export function cariRiwayat<T extends { receiptNumber: string }>(
  daftar: readonly T[],
  kueri: string
): T[] {
  const q = kueri.trim().toLowerCase();
  if (q === '') return [...daftar];
  return daftar.filter((o) => o.receiptNumber.toLowerCase().includes(q));
}
