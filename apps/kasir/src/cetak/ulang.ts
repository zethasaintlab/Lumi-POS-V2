import type { DbLokal } from '../../../../packages/sync-client/src/ports.ts';
import { bangunDokumenStruk, type DataStruk } from './dokumen.ts';
import type { PrinterProfile, ReceiptDocument } from './escpos.ts';
import { cetakStruk, type HasilCetak, type PeripheralPort } from './port.ts';

/**
 * FR-B11 — cetak ulang struk.
 *
 * ## ⛔ TIDAK ADA query ke tabel katalog
 *
 * `spec-b:145` menuntutnya langsung, dan `spec-b:131` menjelaskan kenapa:
 * produk yang di-rename, dinaikkan harganya, lalu diarsipkan harus tetap
 * tercetak dengan nama dan harga SAAT TRANSAKSI TERJADI.
 *
 * Query di bawah menyentuh `order`, `order_line`, `order_line_modifier`, dan
 * `payment` — semuanya menyimpan salinan nilai (`spec-b:115`), bukan referensi
 * yang diresolusi saat ditampilkan. Ada test yang memeriksa daftar tabel yang
 * disentuh, karena "tidak query katalog" adalah janji yang mudah dilanggar
 * satu JOIN kemudian.
 *
 * ## Ditandai CETAK ULANG
 *
 * Struk kedua yang tidak dapat dibedakan dari yang pertama adalah alat
 * penipuan: pelanggan yang sama dapat menagih dua kali, dan tidak ada yang
 * dapat membuktikan mana yang asli.
 */

interface BarisOrderStruk {
  receipt_number: string;
  occurred_at: string;
  channel: string;
  subtotal: number;
  tax_amount: number;
  rounding_adjustment: number;
  total: number;
  amount_due: number;
  created_by: string;
  outlet_id: string;
}

const METODE: Record<string, string> = {
  cash: 'Tunai',
  qris_dynamic: 'QRIS',
  qris_static: 'QRIS',
  card_edc: 'Kartu',
  other: 'Lainnya',
};

/**
 * Membangun ulang dokumen struk sebuah order dari data LOKAL.
 *
 * `null` bila ordernya tidak ada di perangkat ini — riwayat lokal hanya
 * memuat jendela 90 hari, dan order yang lebih tua bukan kesalahan.
 */
export async function bangunUlangStruk(
  db: DbLokal,
  orderId: string,
  { namaMerchant, cetakUlang = true }: { namaMerchant: string; cetakUlang?: boolean }
): Promise<ReceiptDocument | null> {
  const order = (
    await db.getAll<BarisOrderStruk>(
      `SELECT receipt_number, occurred_at, channel, subtotal, tax_amount,
              rounding_adjustment, total, amount_due, created_by, outlet_id
         FROM "order" WHERE id = ?`,
      [orderId]
    )
  )[0];
  if (!order) return null;

  const baris = await db.getAll<{
    id: string;
    item_name: string;
    variation_name: string;
    quantity: number;
    line_total: number;
  }>(
    `SELECT id, item_name, variation_name, quantity, line_total
       FROM order_line WHERE order_id = ?`,
    [orderId]
  );

  const modifier = await db.getAll<{ order_line_id: string; name: string; price: number }>(
    `SELECT m.order_line_id, m.name, m.price
       FROM order_line_modifier m
       JOIN order_line l ON l.id = m.order_line_id
      WHERE l.order_id = ?`,
    [orderId]
  );
  const perBaris = new Map<string, { nama: string; harga: number }[]>();
  for (const m of modifier) {
    const daftar = perBaris.get(m.order_line_id) ?? [];
    daftar.push({ nama: m.name, harga: Number(m.price) });
    perBaris.set(m.order_line_id, daftar);
  }

  const payment = await db.getAll<{ method: string; amount: number; change_amount: number | null }>(
    `SELECT method, amount, change_amount FROM payment WHERE order_id = ?`,
    [orderId]
  );

  const data: DataStruk = {
    namaMerchant,
    alamatOutlet: null,
    receiptNumber: order.receipt_number,
    waktu: order.occurred_at,
    namaKasir: order.created_by,
    channel: order.channel === 'dine_in' ? 'dine_in' : 'takeaway',
    baris: baris.map((b) => ({
      itemName: b.item_name,
      variationName: b.variation_name,
      quantityMilli: Number(b.quantity),
      lineTotal: Number(b.line_total),
      modifier: perBaris.get(b.id) ?? [],
    })),
    subtotal: Number(order.subtotal),
    diskon: 0,
    serviceCharge: 0,
    // ⛔ `order.tax_amount` adalah SELURUH pajak dan tidak menyimpan nama
    // tarifnya. Nama per tarif hidup di `order_line.tax_rate_id`, dan
    // meresolusinya menuntut query ke `tax_rate` — tabel KATALOG, yang
    // `spec-b:145` larang untuk cetak ulang.
    //
    // Yang dipilih: satu baris "Pajak" tanpa nama tarif, dan itu BATAS YANG
    // DINYATAKAN. Alternatifnya menyalin nama tarif ke `order_line` saat
    // penjualan — perubahan skema yang belum diputuskan.
    pajak: Number(order.tax_amount) === 0 ? [] : [{ nama: 'Pajak', jumlah: Number(order.tax_amount) }],
    pembulatan: Number(order.rounding_adjustment),
    total: Number(order.amount_due),
    pembayaran: payment.map((p) => ({
      nama: METODE[p.method] ?? p.method,
      jumlah: Number(p.amount),
    })),
    kembalian: payment.reduce((t, p) => t + Number(p.change_amount ?? 0), 0),
    cetakUlang,
  };

  return bangunDokumenStruk(data);
}

/**
 * Mencetak ulang, dan seperti seluruh jalur cetak: TIDAK PERNAH melempar.
 *
 * Invariant #3 berlaku di sini juga — cetak ulang yang gagal tidak boleh
 * menjatuhkan layar riwayat yang sedang dibaca kasir.
 */
export async function cetakUlangStruk(
  db: DbLokal,
  orderId: string,
  {
    namaMerchant,
    peripheral,
    profil,
  }: {
    namaMerchant: string;
    peripheral: PeripheralPort | null | undefined;
    profil: PrinterProfile | null | undefined;
  }
): Promise<HasilCetak | { status: 'tidak_ditemukan' }> {
  const dok = await bangunUlangStruk(db, orderId, { namaMerchant });
  if (!dok) return { status: 'tidak_ditemukan' };
  return cetakStruk(peripheral, dok, profil);
}
