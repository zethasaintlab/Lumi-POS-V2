import type { DbLokal } from '../../../../packages/sync-client/src/ports.ts';
import type { KonfigPerangkat } from '../../../../packages/sync-client/src/perangkat.ts';
import { enqueue } from '../../../../packages/sync-client/src/enqueue.ts';
import {
  REFUND_REASON_CODES,
  VOID_REASON_CODES,
  decideCancellation,
  remainingRefundable,
  type CancellationOperation,
} from '../../../../packages/domain/src/cancellation.ts';
import { nomorStruk, tanggalBisnis } from '../../../../packages/domain/src/tanggal-bisnis.ts';
import { simpanHlc } from '../lokal/hlc.ts';
import {
  counterpartUntuk,
  deltaBertanda,
  metodeRefundDari,
} from '../../../../packages/domain/src/buku-kas.ts';
import type { Sesi } from '../identitas/login.ts';

/**
 * K-10 — void / refund dari perangkat (FR-B7).
 *
 * ## Kenapa TIDAK menerima shift
 *
 * Order PEMBATAL menyalin `shift_id` dari order yang dibatalkan, bukan dari
 * shift yang sedang berjalan — sama seperti `INSERT_VOID_ORDER_SQL` di server.
 * Pembatalan adalah catatan tentang penjualan LAMA; menaruhnya di shift baru
 * akan membuat laporan shift itu memuat pembatalan penjualan yang tidak
 * pernah ada di dalamnya.
 *
 * Konsekuensinya UI juga tidak boleh menuntut shift terbuka untuk
 * membatalkan.
 *
 * ## ⛔ Kasir tidak memilih operasinya
 *
 * `spec-b:235`: "Kasir tidak memilih 'void' atau 'refund' — kasir menekan
 * 'Batalkan transaksi', dan SISTEM menentukan operasi mana yang berlaku
 * berdasarkan state." Di server itu sudah berlaku; di klien harus berlaku
 * juga, karena saat offline tidak ada server yang dapat memutuskan apa pun.
 *
 * Aturannya datang dari `packages/domain/src/cancellation.ts` — dua salinan
 * akan membuat perangkat mengirim payload void untuk order yang server
 * perlakukan sebagai refund, dan penolakannya baru muncul setelah antrean
 * terkuras.
 *
 * ## Yang membedakan void dari refund di sini
 *
 * | | void | refund |
 * |---|---|---|
 * | menulis | order PEMBATAL baru | baris `refund` |
 * | penyetuju | **tidak** (keputusan user 1 Agu 2026) | **selalu** (`spec-b:278`) |
 * | order asli | tidak disentuh sama sekali | tidak disentuh sama sekali |
 *
 * Keduanya menulis `stock_movement` + `audit_event` + outbox dalam SATU
 * transaksi. Untuk void, restock dan audit adalah kontrol yang TERSISA —
 * keputusan yang menghapus PIN manajer dari void membuat keduanya bukan
 * pelengkap.
 */

export interface AlasanPembatalan {
  kode: string;
  catatan: string | null;
}

export interface BarisRefund {
  lineId: string;
  quantityMilli: number;
}

export type HasilPembatalan =
  | { status: 'tersimpan'; operasi: CancellationOperation; id: string }
  | { status: 'tidak_ditemukan' }
  | { status: 'tidak_dapat_dibatalkan'; pesan: string }
  | { status: 'butuh_penyetuju' }
  | { status: 'penyetuju_sama_dengan_aktor' }
  | { status: 'alasan_tidak_berlaku'; pesan: string }
  | { status: 'melebihi_sisa'; sisa: number };

interface BarisOrder {
  id: string;
  status: string;
  total: number;
  outlet_id: string;
  device_id: string;
  shift_id: string;
  business_date: string;
  channel: string;
  subtotal: number;
  order_discount: number;
  service_charge_amount: number;
  tax_amount: number;
  rounding_adjustment: number;
  amount_due: number;
}

/**
 * Operasi yang berlaku untuk satu status, beserta daftar alasannya.
 *
 * Dipisah dari `batalkan` supaya DIALOG dapat menanyakan alasan yang benar
 * SEBELUM apa pun ditulis — daftar void dan refund berbeda (`spec-b` §B.4),
 * dan menawarkan alasan yang salah berarti kasir memilih sesuatu yang server
 * tolak berjam-jam kemudian.
 */
export function rencanaPembatalan(status: string): {
  operasi: CancellationOperation;
  alasanBerlaku: readonly string[];
  butuhPenyetuju: boolean;
} {
  const operasi = decideCancellation(status);
  return {
    operasi,
    alasanBerlaku: operasi === 'void' ? VOID_REASON_CODES : REFUND_REASON_CODES,
    // Void berjalan TANPA PIN manajer — keputusan user 1 Agustus 2026, override
    // eksplisit terhadap `research/08` §3. Refund selalu menuntutnya.
    butuhPenyetuju: operasi === 'refund',
  };
}

export async function batalkan({
  db,
  konfig,
  sesi,
  orderId,
  alasan,
  approverId,
  jumlah,
  lines = [],
  waktu,
  idBaru,
  hlc,
}: {
  db: DbLokal;
  konfig: KonfigPerangkat;
  sesi: Sesi;
  orderId: string;
  alasan: AlasanPembatalan;
  approverId: string | null;
  /** Refund saja. */
  jumlah?: number;
  /** Refund parsial: baris mana yang stoknya kembali. `[]` = tanpa restock. */
  lines?: BarisRefund[];
  waktu: () => Date;
  idBaru: () => string;
  hlc: () => bigint;
}): Promise<HasilPembatalan> {
  const order = (
    await db.getAll<BarisOrder>(
      `SELECT id, status, total, outlet_id, device_id, shift_id, business_date, channel,
              subtotal, order_discount, service_charge_amount, tax_amount,
              rounding_adjustment, amount_due
         FROM "order" WHERE id = ?`,
      [orderId]
    )
  )[0];
  if (!order) return { status: 'tidak_ditemukan' };

  let rencana;
  try {
    rencana = rencanaPembatalan(order.status);
  } catch {
    // `decideCancellation` melempar untuk status yang tidak mengizinkan
    // keduanya — order yang sudah `voided` atau `refunded`.
    return {
      status: 'tidak_dapat_dibatalkan',
      pesan: 'Transaksi ini sudah dibatalkan sebelumnya.',
    };
  }

  if (!rencana.alasanBerlaku.includes(alasan.kode)) {
    return {
      status: 'alasan_tidak_berlaku',
      pesan: `Alasan "${alasan.kode}" tidak berlaku untuk operasi ini.`,
    };
  }

  if (rencana.butuhPenyetuju) {
    if (!approverId) return { status: 'butuh_penyetuju' };
    // ⛔ Diperiksa DI SINI juga, bukan hanya di dialog otorisasi. `audit_event`
    // punya CHECK yang menolaknya di server; kalau perangkat meloloskannya,
    // kasir baru tahu setelah refund gagal terkirim — dan uangnya sudah keluar
    // laci.
    if (approverId === sesi.userId) return { status: 'penyetuju_sama_dengan_aktor' };
  }

  const sekarang = waktu();
  const occurredAt = sekarang.toISOString();
  const hlcValue = hlc();
  const id = idBaru();

  if (rencana.operasi === 'refund') {
    const sudah = await db.getAll<{ amount: number }>(
      `SELECT amount FROM refund WHERE order_id = ?`,
      [orderId]
    );
    const sisa = remainingRefundable({
      orderTotal: BigInt(order.total),
      alreadyRefunded: sudah.reduce((s, r) => s + BigInt(r.amount), 0n),
    });
    const diminta = BigInt(jumlah ?? 0);
    if (diminta <= 0n || diminta > sisa) {
      return { status: 'melebihi_sisa', sisa: Number(sisa) };
    }
  }

  // Lewat apa uangnya dikembalikan.
  //
  // ⛔ Diturunkan dari payment order aslinya, lalu DISIMPAN eksplisit di
  // `refund.method` (keputusan 14 Agustus 2026). Menyimpannya, bukan
  // menyimpulkannya ulang setiap kali laporan dibaca, adalah bedanya: jawaban
  // hari ini terkunci pada baris itu, dan tidak berubah kalau aturan
  // turunannya kelak diganti.
  //
  // Uang dikembalikan lewat jalan yang sama dengan datangnya — itu asumsi yang
  // benar untuk klien v1, yang menulis tepat SATU payment per order dan
  // seluruhnya tunai.
  //
  // Aturannya milik `packages/domain/src/buku-kas.ts`, dibagi dengan server —
  // yang menulis `refund.method` untuk refund YANG SAMA saat antrean terkuras.
  let metodeRefund: string | null = null;
  if (rencana.operasi === 'refund') {
    const metode = await db.getAll<{ method: string }>(
      `SELECT DISTINCT method FROM payment WHERE order_id = ?`,
      [orderId]
    );
    metodeRefund = metodeRefundDari(metode.map((m) => m.method));
  }

  const barisOrder = await db.getAll<{ id: string; variation_id: string; quantity: number }>(
    `SELECT id, variation_id, quantity FROM order_line WHERE order_id = ?`,
    [orderId]
  );
  const perBaris = new Map(barisOrder.map((b) => [b.id, b]));

  await db.transaction(async (tx) => {
    if (rencana.operasi === 'void') {
      // ⛔ Order PEMBATAL baru. AC FR-B7 pertama: TIDAK ADA `UPDATE` pada
      // order asli — pembatalnya belum ada saat order asli ditulis, jadi
      // `voided_by_order_id` hanya bisa ada di sini, menunjuk ke sana.
      // Namanya terbaca terbalik; itu utang yang tercatat, bukan kekeliruan.
      const businessDate = tanggalBisnis(
        sekarang,
        (await db.getAll<{ timezone: string; business_day_ends_at: string }>(
          `SELECT timezone, business_day_ends_at FROM outlet WHERE id = ?`,
          [konfig.outletId]
        ))[0]?.timezone ?? 'Asia/Jakarta',
        '04:00'
      );
      const urutan = await urutanBerikutnya(tx, businessDate);

      await tx.execute(
        `INSERT INTO "order"
           (id, tenant_id, outlet_id, device_id, shift_id, receipt_number, business_date, sequence,
            status, channel, subtotal, order_discount, service_charge_amount, tax_amount,
            rounding_adjustment, total, amount_due, voided_by_order_id, created_by, occurred_at, hlc)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'voided', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, konfig.tenantId, order.outlet_id, order.device_id, order.shift_id,
          nomorStruk(konfig.deviceCode, businessDate, urutan), businessDate, urutan,
          order.channel,
          // Nilai uang DISALIN, bukan nol: baris ini menyatakan "penjualan
          // sebesar sekian dibatalkan". Laporan mengecualikannya lewat
          // `status = 'voided'` (AC FR-B7 keenam), bukan lewat nilai nol —
          // nol akan membuat void mustahil dibedakan dari order kosong.
          order.subtotal, order.order_discount, order.service_charge_amount,
          order.tax_amount, order.rounding_adjustment, order.total, order.amount_due,
          orderId, sesi.userId, occurredAt, Number(hlcValue),
        ]
      );
    } else {
      // Refund TIDAK membuat payment negatif (keputusan user 7 Agu 2026):
      // `payment.amount` punya `CHECK (amount > 0)` dan itu dipertahankan.
      // Arah berlawanan dinyatakan lewat baris `refund`.
      await tx.execute(
        `INSERT INTO refund
           (id, order_id, amount, reason_code, reason_note, method, created_by, approved_by, occurred_at, hlc)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, orderId, jumlah ?? 0, alasan.kode, alasan.catatan, metodeRefund,
          sesi.userId, approverId, occurredAt, Number(hlcValue),
        ]
      );

      // ⛔ Buku kas HANYA untuk refund TUNAI (`spec-d:14`). Uang yang kembali
      // lewat transfer atau pembalikan QRIS tidak keluar dari laci;
      // mengurangkannya membuat kasir terlihat KELEBIHAN sebesar nilai refund
      // — cacat yang sama besarnya dengan yang tidak menghitungnya sama
      // sekali, hanya berlawanan arah.
      if (metodeRefund === 'cash') {
        await tx.execute(
          `INSERT INTO cash_movement
             (id, shift_id, type, delta, order_id, counterpart_type, created_by, occurred_at, hlc)
           VALUES (?, ?, 'refund', ?, ?, ?, ?, ?, ?)`,
          [
            idBaru(),
            order.shift_id,
            deltaBertanda('refund', Number(jumlah ?? 0)),
            orderId,
            counterpartUntuk('refund'),
            sesi.userId,
            occurredAt,
            Number(hlcValue),
          ]
        );
      }
    }

    // Restock. Untuk VOID seluruh baris kembali; untuk REFUND hanya baris yang
    // disebut — `lines: []` berarti uang kembali tanpa barang kembali, dan itu
    // keadaan yang SAH, bukan kelalaian.
    const dikembalikan =
      rencana.operasi === 'void'
        ? barisOrder.map((b) => ({ lineId: b.id, quantityMilli: b.quantity }))
        : lines;

    for (const l of dikembalikan) {
      const b = perBaris.get(l.lineId);
      if (!b) continue;
      await tx.execute(
        `INSERT INTO stock_movement
           (id, tenant_id, outlet_id, device_id, variation_id, type, delta, order_id,
            reason_code, created_by, occurred_at, hlc)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          idBaru(), konfig.tenantId, order.outlet_id, order.device_id, b.variation_id,
          rencana.operasi === 'void' ? 'void_return' : 'refund_return',
          // Delta POSITIF: barang kembali ke rak.
          l.quantityMilli,
          orderId, alasan.kode, sesi.userId, occurredAt, Number(hlcValue),
        ]
      );
    }

    await tx.execute(
      `INSERT INTO audit_event
         (id, tenant_id, outlet_id, device_id, actor_user_id, approver_user_id,
          event_type, entity_type, entity_id, reason_code, reason_note, occurred_at, hlc)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'order', ?, ?, ?, ?, ?)`,
      [
        idBaru(), konfig.tenantId, order.outlet_id, konfig.deviceId,
        sesi.userId, approverId,
        rencana.operasi === 'void' ? 'order_voided' : 'order_refunded',
        orderId, alasan.kode, alasan.catatan, occurredAt, Number(hlcValue),
      ]
    );

    await enqueue(tx, {
      id: idBaru(),
      entityType: 'order_cancel',
      // `entity_id` adalah order yang DIBATALKAN — rutenya
      // `/orders/{entity_id}/cancel`.
      entityId: orderId,
      operation: 'cancel',
      payload: {
        id,
        reasonCode: alasan.kode,
        ...(alasan.catatan ? { reasonNote: alasan.catatan } : {}),
        ...(rencana.operasi === 'refund'
          ? { amount: jumlah, lines }
          : {}),
        hlc: hlcValue.toString(),
        occurredAt,
      },
      idempotencyKey: id,
      createdAt: occurredAt,
      actorId: sesi.userId,
    });

    await simpanHlc(tx, hlcValue);
  });

  return { status: 'tersimpan', operasi: rencana.operasi, id };
}

/** Sama dengan `urutanBerikutnya` di `penjualan.ts` — order pembatal juga butuh nomor struk. */
async function urutanBerikutnya(tx: DbLokal, businessDate: string): Promise<number> {
  const baris = await tx.getAll<{ receipt_sequence: number; sequence_business_date: string | null }>(
    `SELECT receipt_sequence, sequence_business_date FROM device_config WHERE id = 1`
  );
  const kini = baris[0];
  const sama = kini?.sequence_business_date === businessDate;
  const berikutnya = sama ? (kini?.receipt_sequence ?? 0) + 1 : 1;
  await tx.execute(
    `UPDATE device_config SET receipt_sequence = ?, sequence_business_date = ? WHERE id = 1`,
    [berikutnya, businessDate]
  );
  return berikutnya;
}
