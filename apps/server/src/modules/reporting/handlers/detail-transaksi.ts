import type { PoolClient } from '../../../db.ts';

/**
 * B-03 — detail satu transaksi, digabung dari lima modul.
 *
 * ## ⛔ Modul ini PUNYA IZIN membaca lintas domain. Ia satu-satunya.
 *
 * `apps/server/src/modules/README.md` aturan 2 melarang query ke tabel milik
 * modul lain, dan `reporting` adalah pengecualian yang tabelnya sendiri
 * kosong — ia tidak memiliki satu tabel pun. Keputusan user 16 Agustus 2026.
 *
 * Alasannya struktural, bukan kenyamanan: satu struk **menurut definisi**
 * menggabungkan order (`ordering`), pembayaran (`payment`), nama kasir
 * (`identity`), dan nanti audit (`audit`). Tidak ada satu pemilik yang masuk
 * akal. Alternatifnya `ordering` menjangkau empat modul lain — dan itu persis
 * yang sudah terjadi tujuh kali di endpoint laporan, yang jadi utang.
 *
 * ⛔ Izin ini **berhenti di modul ini**. `ordering` tetap tidak boleh
 * menjangkau `payment` atau `"user"`; test batas modul di
 * `tests/server/riwayat-pesanan.test.js` tetap berlaku dan tetap hijau.
 * Membaca dari sini legal justru karena modul ini tidak menulis apa pun.
 *
 * ## ⛔ Hanya MEMBACA
 *
 * Tidak ada `INSERT`, `UPDATE`, maupun `DELETE`. Ada test yang memindai
 * berkas ini untuk ketiganya. Modul agregator yang boleh menulis akan menjadi
 * jalan pintas kedua ke setiap tabel di sistem — dan invariant #1 (satu
 * penjualan = satu transaksi) tidak lagi punya satu pintu.
 *
 * ## Nama tabelnya `order_line`, bukan `order_item`
 *
 * Dicatat karena instruksinya menyebut `order_item`. Yang ada di skema
 * `order_line` (migrasi `0007`), dengan `order_line_modifier` terpisah.
 */

export interface ModifierDetail {
  id: string;
  name: string;
  price: string;
  quantityMilli: number;
}

export interface BarisDetail {
  id: string;
  itemName: string;
  variationName: string;
  unitPrice: string;
  /** ×1000. `2500` berarti 2,5 — lihat `kuantitasTampil`. */
  quantityMilli: number;
  discountAmount: string;
  taxAmount: string;
  isTaxInclusive: boolean;
  lineTotal: string;
  modifiers: ModifierDetail[];
}

export interface PembayaranDetail {
  id: string;
  method: string;
  amount: string;
  /** `null` untuk metode non-tunai — tidak ada uang yang diserahkan. */
  tenderedAmount: string | null;
  changeAmount: string | null;
  status: string;
  confirmedManually: boolean;
  cardLast4: string | null;
  occurredAt: string;
}

export interface RefundDetail {
  id: string;
  amount: string;
  method: string | null;
  reasonCode: string;
  reasonNote: string | null;
  createdBy: string;
  createdByNama: string;
  approvedBy: string;
  approvedByNama: string;
  occurredAt: string;
}

export interface DetailTransaksi {
  id: string;
  receiptNumber: string;
  businessDate: string;
  sequence: number;
  outletId: string;
  deviceId: string;
  channel: string;
  status: string;
  createdBy: string;
  createdByNama: string;
  occurredAt: string;
  recordedAt: string;
  subtotal: string;
  orderDiscount: string;
  serviceChargeAmount: string;
  taxAmount: string;
  roundingAdjustment: string;
  total: string;
  amountDue: string;
  hasCalculationVariance: boolean;
  varianceAmount: string | null;
  /** Order pembatal, bila transaksi ini dibatalkan. */
  dibatalkanOleh: string | null;
  dibatalkanPada: string | null;
  lines: BarisDetail[];
  payments: PembayaranDetail[];
  refunds: RefundDetail[];
  /** `SUM(payment.amount)` yang berstatus `confirmed`. */
  totalDibayar: string;
  totalRefund: string;
}

const keIso = (v: Date | string | null): string | null =>
  v === null ? null : v instanceof Date ? v.toISOString() : String(v);

const teks = (v: unknown): string => String(v ?? 0);

/**
 * Kuantitas ×1000 dibuat terbaca manusia.
 *
 * ⛔ Dibagi 1000 di JAVASCRIPT, bukan di SQL — `quantity / 1000` di PostgreSQL
 * atas kolom `bigint` melakukan pembagian INTEGER dan `2500` menjadi `2`.
 * Angka setengah kilogram menghilang tanpa error.
 */
export function kuantitasTampil(milli: number): string {
  const utuh = Math.trunc(milli / 1000);
  const sisa = milli % 1000;
  if (sisa === 0) return String(utuh);
  return `${utuh},${String(sisa).padStart(3, '0').replace(/0+$/, '')}`;
}

interface BarisOrderDb {
  id: string;
  receipt_number: string;
  business_date_teks: string;
  sequence: number;
  outlet_id: string;
  device_id: string;
  channel: string;
  status: string;
  created_by: string;
  created_by_nama: string | null;
  occurred_at: Date | string;
  recorded_at: Date | string;
  subtotal: unknown;
  order_discount: unknown;
  service_charge_amount: unknown;
  tax_amount: unknown;
  rounding_adjustment: unknown;
  total: unknown;
  amount_due: unknown;
  has_calculation_variance: boolean;
  variance_amount: unknown;
  dibatalkan_oleh: string | null;
  dibatalkan_pada: Date | string | null;
}

/**
 * Satu transaksi lengkap, atau `null` bila tidak terlihat oleh tenant ini.
 *
 * ⛔ `null` untuk "tidak ada" DAN untuk "milik tenant lain" — pemanggil
 * menjawab keduanya dengan `404` yang sama. Membedakannya memberi tahu
 * penyerang bahwa id yang ia tebak benar-benar ada di suatu tempat.
 *
 * Lima query terpisah, bukan satu JOIN raksasa: baris, pembayaran, dan refund
 * punya kardinalitas berbeda, dan menggabungkannya menghasilkan perkalian
 * silang yang harus dibongkar ulang di JavaScript. Yang dihemat satu
 * round-trip; yang dibayar adalah kelas bug yang paling sulit dilihat.
 */
export async function ambilDetail(
  client: PoolClient,
  orderId: string
): Promise<DetailTransaksi | null> {
  const { rows: orderRows } = await client.query<BarisOrderDb>(
    `SELECT o.id, o.receipt_number,
            to_char(o.business_date, 'YYYY-MM-DD') AS business_date_teks,
            o.sequence, o.outlet_id, o.device_id, o.channel, o.status,
            o.created_by, u.name AS created_by_nama,
            o.occurred_at, o.recorded_at,
            o.subtotal, o.order_discount, o.service_charge_amount, o.tax_amount,
            o.rounding_adjustment, o.total, o.amount_due,
            o.has_calculation_variance, o.variance_amount,
            v.id AS dibatalkan_oleh, v.occurred_at AS dibatalkan_pada
       FROM "order" o
       LEFT JOIN "user" u  ON u.id = o.created_by
       LEFT JOIN "order" v ON v.voided_by_order_id = o.id
      WHERE o.id = $1
      LIMIT 1`,
    [orderId]
  );
  if (orderRows.length === 0) return null;
  const o = orderRows[0];

  const { rows: lineRows } = await client.query(
    `SELECT id, item_name, variation_name, unit_price, quantity,
            discount_amount, tax_amount, is_tax_inclusive, line_total
       FROM order_line
      WHERE order_id = $1
      ORDER BY occurred_at, id`,
    [orderId]
  );

  const idBaris = lineRows.map((l) => l.id as string);
  const modPerBaris = new Map<string, ModifierDetail[]>();
  if (idBaris.length > 0) {
    const { rows: modRows } = await client.query(
      `SELECT id, order_line_id, name, price, quantity
         FROM order_line_modifier
        WHERE order_line_id = ANY($1)
        ORDER BY id`,
      [idBaris]
    );
    for (const m of modRows) {
      const daftar = modPerBaris.get(m.order_line_id as string) ?? [];
      daftar.push({
        id: m.id as string,
        name: m.name as string,
        price: teks(m.price),
        quantityMilli: Number(m.quantity),
      });
      modPerBaris.set(m.order_line_id as string, daftar);
    }
  }

  const { rows: payRows } = await client.query(
    `SELECT id, method, amount, tendered_amount, change_amount, status,
            confirmed_manually, card_last4, occurred_at
       FROM payment
      WHERE order_id = $1
      ORDER BY occurred_at, id`,
    [orderId]
  );

  const { rows: refRows } = await client.query(
    `SELECT r.id, r.amount, r.method, r.reason_code, r.reason_note,
            r.created_by, uc.name AS created_by_nama,
            r.approved_by, ua.name AS approved_by_nama,
            r.occurred_at
       FROM refund r
       LEFT JOIN "user" uc ON uc.id = r.created_by
       LEFT JOIN "user" ua ON ua.id = r.approved_by
      WHERE r.order_id = $1
      ORDER BY r.occurred_at, r.id`,
    [orderId]
  );

  // ⛔ Dijumlahkan di JavaScript sebagai `bigint`, bukan `SUM()` di SQL.
  // Bukan gaya: penjaga satu-sumber-omzet menolak agregasi atas tabel `order`,
  // dan menjumlahkan uang lewat `Number` kehilangan presisi di atas 2^53.
  let totalDibayar = 0n;
  for (const p of payRows) {
    if (p.status === 'confirmed') totalDibayar += BigInt(teks(p.amount));
  }
  let totalRefund = 0n;
  for (const r of refRows) totalRefund += BigInt(teks(r.amount));

  return {
    id: o.id,
    receiptNumber: o.receipt_number,
    businessDate: o.business_date_teks,
    sequence: o.sequence,
    outletId: o.outlet_id,
    deviceId: o.device_id,
    channel: o.channel,
    status: o.status,
    createdBy: o.created_by,
    // Nama boleh hilang bila RLS menyembunyikannya; id tetap ditampilkan
    // alih-alih sel kosong.
    createdByNama: o.created_by_nama ?? o.created_by,
    occurredAt: keIso(o.occurred_at) as string,
    recordedAt: keIso(o.recorded_at) as string,
    subtotal: teks(o.subtotal),
    orderDiscount: teks(o.order_discount),
    serviceChargeAmount: teks(o.service_charge_amount),
    taxAmount: teks(o.tax_amount),
    roundingAdjustment: teks(o.rounding_adjustment),
    total: teks(o.total),
    amountDue: teks(o.amount_due),
    hasCalculationVariance: o.has_calculation_variance,
    varianceAmount: o.variance_amount === null ? null : teks(o.variance_amount),
    dibatalkanOleh: o.dibatalkan_oleh,
    dibatalkanPada: keIso(o.dibatalkan_pada),
    lines: lineRows.map((l) => ({
      id: l.id as string,
      itemName: l.item_name as string,
      variationName: l.variation_name as string,
      unitPrice: teks(l.unit_price),
      quantityMilli: Number(l.quantity),
      discountAmount: teks(l.discount_amount),
      taxAmount: teks(l.tax_amount),
      isTaxInclusive: l.is_tax_inclusive as boolean,
      lineTotal: teks(l.line_total),
      modifiers: modPerBaris.get(l.id as string) ?? [],
    })),
    payments: payRows.map((p) => ({
      id: p.id as string,
      method: p.method as string,
      amount: teks(p.amount),
      // ⛔ `null` DIPERTAHANKAN, tidak dijadikan `'0'`. QRIS tidak punya uang
      // yang diserahkan, dan "Tunai diterima: Rp 0" adalah pernyataan yang
      // salah — bukan sekadar kosong.
      tenderedAmount: p.tendered_amount === null ? null : teks(p.tendered_amount),
      changeAmount: p.change_amount === null ? null : teks(p.change_amount),
      status: p.status as string,
      confirmedManually: p.confirmed_manually as boolean,
      cardLast4: (p.card_last4 as string | null) ?? null,
      occurredAt: keIso(p.occurred_at) as string,
    })),
    refunds: refRows.map((r) => ({
      id: r.id as string,
      amount: teks(r.amount),
      method: (r.method as string | null) ?? null,
      reasonCode: r.reason_code as string,
      reasonNote: (r.reason_note as string | null) ?? null,
      createdBy: r.created_by as string,
      createdByNama: (r.created_by_nama as string | null) ?? (r.created_by as string),
      approvedBy: r.approved_by as string,
      approvedByNama: (r.approved_by_nama as string | null) ?? (r.approved_by as string),
      occurredAt: keIso(r.occurred_at) as string,
    })),
    totalDibayar: totalDibayar.toString(),
    totalRefund: totalRefund.toString(),
  };
}
