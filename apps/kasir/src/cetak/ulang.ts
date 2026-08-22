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
  order_discount: number | null;
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
 * Rincian pajak per TARIF, dari snapshot `order_line`.
 *
 * Baris yang tarifnya sama digabung — struk mencetak satu baris per tarif
 * (`spec-c:404`), bukan satu per produk.
 *
 * ⛔ Baris tanpa `tax_rate_name` (ditulis sebelum F5) dikumpulkan ke satu
 * baris "Pajak". Mengarang nama untuk mereka berarti struk menyebut tarif yang
 * mungkin tidak pernah berlaku pada transaksi itu.
 *
 * Bila tidak ada rincian sama sekali, `totalPajak` dipakai apa adanya —
 * jumlah yang tercetak harus tetap menutup selisih ke TOTAL (AC FR-C10 kedua).
 */
function rincianPajak(
  baris: readonly { tax_rate_name: string | null; tax_amount: number | null }[],
  totalPajak: number
): { nama: string; jumlah: number }[] {
  const per = new Map<string, number>();
  let terinci = 0;
  for (const b of baris) {
    const jumlah = Number(b.tax_amount ?? 0);
    if (jumlah === 0) continue;
    const nama = b.tax_rate_name ?? 'Pajak';
    per.set(nama, (per.get(nama) ?? 0) + jumlah);
    terinci += jumlah;
  }

  // Selisih terjadi bila pajak tersimpan di order tetapi tidak di barisnya —
  // bentuk data lama. Ia ditambahkan sebagai "Pajak" supaya aritmetika struk
  // tetap tertutup.
  const sisa = totalPajak - terinci;
  if (sisa !== 0) per.set('Pajak', (per.get('Pajak') ?? 0) + sisa);

  return [...per].map(([nama, jumlah]) => ({ nama, jumlah })).filter((r) => r.jumlah !== 0);
}

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
      `SELECT receipt_number, occurred_at, channel, subtotal, order_discount, tax_amount,
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
    tax_rate_name: string | null;
    tax_amount: number | null;
  }>(
    `SELECT id, item_name, variation_name, quantity, line_total,
            tax_rate_name, tax_amount
       FROM order_line WHERE order_id = ?`,
    [orderId]
  );

  // ⛔ `quantity` ikut dibaca (FR-A3, `allow_duplicate`). Cetak ulang wajib
  // IDENTIK dengan cetakan pertama (`spec-b:145`); yang melewatkan kuantitas
  // modifier mencetak "Extra Shot" seharga satu shot pada struk yang totalnya
  // memuat dua — dan selisihnya hanya muncul pada cetakan kedua.
  const modifier = await db.getAll<{
    order_line_id: string;
    name: string;
    price: number;
    quantity: number | null;
  }>(
    `SELECT m.order_line_id, m.name, m.price, m.quantity
       FROM order_line_modifier m
       JOIN order_line l ON l.id = m.order_line_id
      WHERE l.order_id = ?`,
    [orderId]
  );
  const perBaris = new Map<string, { nama: string; harga: number; qtyMilli: number }[]>();
  for (const m of modifier) {
    const daftar = perBaris.get(m.order_line_id) ?? [];
    daftar.push({
      nama: m.name,
      harga: Number(m.price),
      // Baris lama ditulis sebelum FR-A3 selalu ber-qty 1000; `null` dari
      // baris yang entah bagaimana kosong dibaca satu, bukan nol — modifier
      // yang tercetak tanpa harga lebih baik daripada modifier yang hilang.
      qtyMilli: m.quantity === null ? 1000 : Number(m.quantity),
    });
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
    // ⛔ Diskon SUNGGUHAN. `subtotal` di `order` adalah subtotal KOTOR, jadi
    // cetak ulang yang menulis nol menyodorkan dua angka yang selisihnya tidak
    // dapat dijelaskan — dan berbeda dari cetakan pertama, yang `spec-b:145`
    // tuntut identik.
    diskon: Number(order.order_discount ?? 0),
    serviceCharge: 0,
    // ⛔ Nama tarif dibaca dari SNAPSHOT di `order_line`, bukan dari
    // `tax_rate`. Larangan `spec-b:145` tidak dilonggarkan — yang berubah
    // (F5, keputusan user 15 Agustus 2026) adalah apa yang tersimpan: nama
    // tarif kini ikut disalin saat penjualan ditulis, sama seperti
    // `item_name`.
    //
    // Baris LAMA tidak punya namanya dan tidak dapat direkonstruksi tanpa
    // menebak; keduanya jatuh ke "Pajak", dan itu jujur.
    pajak: rincianPajak(baris, Number(order.tax_amount)),
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
