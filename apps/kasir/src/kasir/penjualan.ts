import type { DbLokal } from '../../../../packages/sync-client/src/ports.ts';
import type { KonfigPerangkat } from '../../../../packages/sync-client/src/perangkat.ts';
import { enqueue } from '../../../../packages/sync-client/src/enqueue.ts';
import {
  computeCashRounding,
  computeLineTotal,
  computeOrderTotals,
} from '../../../../packages/domain/src/money.ts';
import { ambangDari } from '../../../../packages/domain/src/diskon.ts';
import {
  dikonfirmasiManual,
  metodeDibulatkan,
  periksaApprovalCode,
  periksaCardLast4,
  periksaReferensi,
  type GalatBayar,
  type KodeGalatBayar,
} from '../../../../packages/domain/src/pembayaran-manual.ts';
import { statusDiskon } from './diskon.ts';
import { calculateTax, type TaxRateSpec } from '../../../../packages/domain/src/tax.ts';
import { nomorStruk, tanggalBisnis } from '../../../../packages/domain/src/tanggal-bisnis.ts';
import { simpanHlc } from '../lokal/hlc.ts';
import { bangunDokumenStruk } from '../cetak/dokumen.ts';
import { labelMetode } from '../cetak/metode.ts';
import { type HasilCetak, type PeripheralPort } from '../cetak/port.ts';
import { cetakDanCatat } from '../cetak/antrean.ts';
import type { PrinterProfile } from '../cetak/escpos.ts';
import { counterpartUntuk, deltaBertanda } from '../../../../packages/domain/src/buku-kas.ts';
import type { Sesi } from '../identitas/login.ts';
import type { ShiftAktif } from '../kas/shift.ts';
import type { Keranjang } from './keranjang.ts';

/**
 * K-06/K-07 — menyimpan penjualan di perangkat.
 *
 * ## ⛔ Invariant #1, di klien, dengan uang sungguhan
 *
 * Order + check + line + modifier + payment + DUA item outbox ditulis dalam
 * SATU `writeTransaction`. Yang tersimpan setengah adalah penjualan yang
 * uangnya sudah masuk laci tapi tidak ada di mana pun — atau item outbox yang
 * mengirim order yang tidak pernah ditulis.
 *
 * ## Aritmetikanya BUKAN milik berkas ini
 *
 * `computeLineTotal`, `calculateTax`, `computeOrderTotals`, dan
 * `computeCashRounding` semuanya dari `packages/domain`, dibagi dengan
 * server. Menghitungnya sendiri di sini berarti angka di struk menyimpang
 * dari angka yang tersimpan — dan selisihnya baru terlihat berminggu-minggu
 * kemudian, di laporan.
 *
 * Yang menjadi tanggung jawab berkas ini hanya URUTAN dan PERSISTENSI.
 */

/**
 * ⛔ QRIS DINAMIS tidak ada di daftar ini, dan itu batas yang dinyatakan.
 *
 * Ia menuntut gateway menjawab sebelum pembayaran dapat dinyatakan lunas
 * (`spec-c:320`), jadi ordernya harus sudah ada di server — sementara jalur
 * penjualan di perangkat ini menulis lokal lebih dulu dan me-relay kemudian.
 * Membangunnya menuntut jalur penjualan online-first yang belum ada.
 *
 * Ketiga yang ADA di sini semuanya berfungsi tanpa jaringan, dan itu sengaja:
 * merchant yang internetnya mati tetap dapat menerima ketiganya.
 */
export type MetodeBayar = 'cash' | 'qris_static' | 'card_edc';

export interface PembayaranTunai {
  metode: 'cash';
  /** Uang yang diserahkan pelanggan, rupiah utuh. */
  tendered: number;
}

/** FR-C2 — QR cetak merchant, dikonfirmasi kasir. Tanpa verifikasi sistem. */
export interface PembayaranQrisStatis {
  metode: 'qris_static';
  /** WAJIB (`periksaReferensi`). Kontrol anti-fraud, bukan formalitas. */
  referensi: string;
}

/** FR-C4 — mesin EDC terpisah; yang mengonfirmasi adalah struk terminal. */
export interface PembayaranEdc {
  metode: 'card_edc';
  approvalCode: string;
  cardLast4?: string | null;
  acquirer?: string | null;
  terminalReference?: string | null;
}

export type Pembayaran = PembayaranTunai | PembayaranQrisStatis | PembayaranEdc;

export type HasilPenjualan =
  | {
      status: 'tersimpan';
      orderId: string;
      receiptNumber: string;
      sequence: number;
      total: bigint;
      taxAmount: bigint;
      amountDue: bigint;
      roundingAdjustment: bigint;
      kembalian: bigint;
      /** Invariant #3: penjualan TERSIMPAN apa pun hasil ini. */
      cetak: HasilCetak;
    }
  | { status: 'keranjang_kosong' }
  | { status: 'kurang_bayar'; amountDue: bigint; kurang: bigint }
  /**
   * FR-C2/C4 — masukan pembayaran manual tidak sah.
   *
   * ⛔ Diperiksa di PERANGKAT, dengan aturan yang sama persis yang server
   * pakai (`packages/domain/src/pembayaran-manual.ts`). Aturan yang hanya
   * hidup di server berarti kasir menerima referensi kosong, penjualan
   * tersimpan, lalu barisnya berhenti `gagal-permanen` di antrean — bentuk
   * cacat yang sama dengan refund offline.
   */
  | { status: 'pembayaran_tidak_sah'; kode: KodeGalatBayar; pesan: string }
  /**
   * FR-B8 — diskon melewati ambang dan belum ada penyetuju.
   *
   * ⛔ Penjualan TIDAK ditulis. Berbeda dari selisih hitungan (`spec-h:95`,
   * "tidak pernah menolak transaksi"): di sana uangnya sudah diterima
   * merchant dan menolak berarti kehilangan penjualan. Di sini kasir belum
   * menerima apa pun — yang ditahan adalah potongan yang belum disetujui
   * siapa pun, dan menahannya justru yang FR-B8 minta.
   */
  | { status: 'butuh_penyetuju_diskon'; nominal: bigint };

interface BarisTarif {
  id: string;
  outlet_id: string | null;
  name: string;
  rate: number;
  is_inclusive: number;
  jurisdiction: string | null;
  channel: string;
  applies_to: string;
  applies_to_ids: string | null;
}

interface BarisOutlet {
  discount_threshold_percent: number | null;
  discount_threshold_amount: number | null;
  /** Dicetak di kepala struk (`spec-c:377`). */
  name: string;
  timezone: string;
  business_day_ends_at: string;
  rounding_increment: number;
  rounding_mode: string;
  service_charge_rate: number;
}

/**
 * Nomor struk berikutnya, dari counter LOKAL.
 *
 * `CLAUDE.md`: "Counter lokal, tidak pernah minta ke server." Perangkat
 * offline harus tetap dapat mencetak struk bernomor, dan nomor yang diminta
 * ke server adalah nomor yang tidak ada saat internet mati.
 *
 * ⛔ Direset saat TANGGAL BISNIS berganti, bukan saat tengah malam. Tanpa
 * reset, nomor struk tumbuh selamanya dan berhenti berarti "penjualan ke-N
 * hari ini"; direset di tengah malam, penjualan pukul 01:00 memulai urutan
 * baru di tengah shift yang sama.
 */
async function urutanBerikutnya(
  tx: DbLokal,
  businessDate: string
): Promise<number> {
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

/** `null` bila sah. Aturannya milik `packages/domain`. */
function periksaPembayaran(p: Pembayaran): GalatBayar | null {
  if (p.metode === 'qris_static') return periksaReferensi(p.referensi);
  if (p.metode === 'card_edc') {
    const galat = periksaApprovalCode(p.approvalCode);
    if (galat !== null) return galat;
    // ⛔ Opsional, tapi bila DIISI ia harus 1-4 digit. Kolomnya bernama
    // `card_last4`; apa pun yang lebih panjang di sana adalah data kartu yang
    // tidak boleh masuk POS sama sekali (`CLAUDE.md`, larangan permanen).
    if (p.cardLast4 !== undefined && p.cardLast4 !== null && p.cardLast4 !== '') {
      return periksaCardLast4(p.cardLast4);
    }
  }
  return null;
}

function muatanPembayaran(
  paymentId: string,
  p: Pembayaran,
  amountDue: bigint
): Record<string, unknown> {
  if (p.metode === 'cash') {
    // Server yang menghitung `amount` dan kembalian dari `tenderedAmount`,
    // karena keduanya bergantung pada pembulatan tunai milik outlet.
    return { id: paymentId, method: 'cash', tenderedAmount: Number(p.tendered) };
  }
  if (p.metode === 'qris_static') {
    return {
      id: paymentId,
      method: 'qris_static',
      amount: Number(amountDue),
      reference: p.referensi.trim(),
    };
  }
  return {
    id: paymentId,
    method: 'card_edc',
    amount: Number(amountDue),
    approvalCode: p.approvalCode.trim(),
    ...(p.cardLast4 ? { cardLast4: p.cardLast4 } : {}),
    ...(p.acquirer ? { acquirer: p.acquirer } : {}),
    ...(p.terminalReference ? { terminalReference: p.terminalReference } : {}),
  };
}

function keTarifSpec(b: BarisTarif): TaxRateSpec {
  return {
    id: b.id,
    name: b.name,
    // `rate` sudah INTEGER ×10000 di skema lokal — konversinya terjadi di
    // `put` raw table, bukan di sini.
    rateScaled: BigInt(b.rate),
    isInclusive: b.is_inclusive === 1,
    // FR-C13 — ikut supaya klien dan server memberi `TaxBreakdown` yang
    // BENTUKNYA sama. Klien tidak menyimpannya di `order_line` lokal: yang
    // memakainya adalah rekapitulasi back-office, dan back-office online-only
    // (`IA:§3.3`). Menghilangkannya di sini akan membuat perbandingan hitungan
    // klien-vs-server punya satu field yang selalu berbeda.
    jurisdiction: b.jurisdiction,
    outletId: b.outlet_id,
    channel: b.channel as TaxRateSpec['channel'],
    appliesTo: b.applies_to as TaxRateSpec['appliesTo'],
    appliesToIds: b.applies_to_ids ? (JSON.parse(b.applies_to_ids) as string[]) : [],
  };
}

export async function simpanPenjualan({
  db,
  konfig,
  sesi,
  shift,
  keranjang,
  pembayaran,
  waktu,
  idBaru,
  hlc,
  channel = 'takeaway',
  peripheral,
  printerProfile,
}: {
  db: DbLokal;
  konfig: KonfigPerangkat;
  sesi: Sesi;
  shift: ShiftAktif;
  keranjang: Keranjang;
  pembayaran: Pembayaran;
  waktu: () => Date;
  idBaru: () => string;
  hlc: () => bigint;
  channel?: 'dine_in' | 'takeaway';
  /**
   * Periferal perangkat ini. Boleh TIDAK ADA — merchant yang menjual lewat
   * QRIS tanpa printer adalah kasus nyata, dan aplikasi berjalan penuh di
   * sana. Hasilnya dilaporkan `tanpa_printer`, bukan `gagal`.
   */
  peripheral?: PeripheralPort | null;
  printerProfile?: PrinterProfile | null;
}): Promise<HasilPenjualan> {
  if (keranjang.baris.length === 0) return { status: 'keranjang_kosong' };

  const sekarang = waktu();
  const outlet = (
    await db.getAll<BarisOutlet>(
      `SELECT name, timezone, business_day_ends_at, rounding_increment, rounding_mode, service_charge_rate,
              discount_threshold_percent, discount_threshold_amount
         FROM outlet WHERE id = ?`,
      [konfig.outletId]
    )
  )[0];

  const businessDate = outlet
    ? tanggalBisnis(sekarang, outlet.timezone, outlet.business_day_ends_at)
    : shift.businessDate;

  // ---- aritmetika: seluruhnya packages/domain ----------------------------

  const lineTotals = keranjang.baris.map((b) =>
    computeLineTotal({
      unitPrice: BigInt(b.unitPrice),
      quantityMilli: BigInt(b.quantityMilli),
      // FR-A3 — `allow_duplicate`. `computeLineTotal` mengalikan kuantitas
      // modifier dengan kuantitas baris (`spec-c:137`: Extra Shot 5.000 × 2
      // kopi = 10.000), jadi yang dikirim ke sini adalah kuantitas modifier
      // per satu unit baris — bukan yang sudah dikali.
      modifiers: b.modifier.map((m) => ({
        price: BigInt(m.harga),
        quantityMilli: BigInt(m.qtyMilli),
      })),
      discountAmount: 0n,
    })
  );

  // ---- FR-B8: diskon tingkat order --------------------------------------
  //
  // ⛔ Dihitung dari subtotal yang SAMA yang dipakai `computeOrderTotals` di
  // bawah, lewat fungsi domain yang SAMA dengan server. Menghitungnya dengan
  // aritmetika sendiri di sini membuat angka di layar kasir menyimpang dari
  // angka yang server simpan — dan yang menyimpang di jalur uang tidak
  // menghasilkan error, hanya struk yang salah.
  const subtotalDiskon = lineTotals.reduce((n, x) => n + x, 0n);
  const ambangDiskon = ambangDari(
    // Kolom lokal berskala ×10000 (lihat `SKALA_KOLOM`), sudah INTEGER saat
    // tiba. `null` berarti pakai bawaan domain.
    outlet?.discount_threshold_percent === null || outlet?.discount_threshold_percent === undefined
      ? null
      : BigInt(outlet.discount_threshold_percent),
    outlet?.discount_threshold_amount === null || outlet?.discount_threshold_amount === undefined
      ? null
      : BigInt(outlet.discount_threshold_amount)
  );
  const statusDsk = statusDiskon(subtotalDiskon, keranjang.diskon, ambangDiskon);
  const orderDiscount = statusDsk?.nominal ?? 0n;

  // ⛔ Ambang diperiksa DI SINI juga, bukan hanya di layar. Layar dapat
  // dilewati (keranjang yang bertahan, jalur lain yang lahir kelak); yang
  // menulis penjualan adalah tempat terakhir yang dapat menolaknya sebelum
  // uang berpindah.
  //
  // ⛔ Yang diperiksa bukan sekadar "ada penyetuju", melainkan apakah potongan
  // SEKARANG masih tertutup angka yang penyetuju lihat — lihat
  // `DiskonKeranjang.nominalDisetujui`.
  if (statusDsk !== null && statusDsk.perluPersetujuan) {
    return { status: 'butuh_penyetuju_diskon', nominal: statusDsk.nominal };
  }

  const tarif = await db.getAll<BarisTarif>(
    `SELECT id, outlet_id, name, rate, is_inclusive, jurisdiction, channel, applies_to, applies_to_ids
       FROM tax_rate
      WHERE (outlet_id IS NULL OR outlet_id = ?)
        AND effective_from <= ?
        AND (effective_to IS NULL OR effective_to > ?)`,
    [konfig.outletId, sekarang.toISOString(), sekarang.toISOString()]
  );

  const pajak = calculateTax({
    lines: keranjang.baris.map((b, i) => ({
      lineId: b.id,
      // `itemId` dipakai tarif ber-`applies_to = 'item'`. Keranjang menyimpan
      // variation, dan tarif per-item belum dapat dicocokkan tanpa membaca
      // `item_variation.item_id` — dibiarkan sebagai variationId, dan itu
      // BATAS YANG DINYATAKAN: tarif per-item/per-kategori belum berlaku di
      // klien. Tarif `all_items` (yang dipakai PB1) tidak terpengaruh.
      itemId: b.variationId,
      categoryId: null,
      amount: lineTotals[i],
    })),
    serviceChargeAmount: 0n,
    orderDiscount,
    taxRates: tarif.map(keTarifSpec),
    channel,
    outletId: konfig.outletId,
  });

  const totals = computeOrderTotals({
    lineTotals,
    orderDiscount,
    serviceChargeAmount: 0n,
    // Hanya yang MENAMBAH total. `totalTax` di sini akan menggandakan pajak
    // inklusif (`CLAUDE.md`).
    taxAmount: pajak.totalTaxExclusive,
  });

  // ⛔ Pembulatan HANYA saat ada pembayaran TUNAI (FR-C9), dan hanya pada
  // `amount_due` — `total` tidak pernah dibulatkan.
  //
  // Sebelum QRIS statis dan EDC ada, satu-satunya metode adalah tunai, jadi
  // pembulatan tanpa syarat kebetulan benar. Ia berhenti benar begitu metode
  // kedua lahir: QRIS memindahkan angka, bukan lembaran, dan membulatkannya
  // menagih pelanggan beberapa rupiah lebih daripada nilai transaksinya lewat
  // saluran yang mencatat nominalnya persis.
  const bulat = metodeDibulatkan(pembayaran.metode)
    ? computeCashRounding({
        outstanding: totals.total,
        roundingIncrement: BigInt(outlet?.rounding_increment ?? 100),
        roundingMode: outlet?.rounding_mode ?? 'half_up',
      })
    : { roundedOutstanding: totals.total, roundingAdjustment: 0n };
  const amountDue = bulat.roundedOutstanding;

  // ---- FR-C2/C4: masukan pembayaran manual --------------------------------
  //
  // Diperiksa SEBELUM satu baris pun ditulis, dengan aturan yang sama persis
  // yang server pakai.
  const galatBayar = periksaPembayaran(pembayaran);
  if (galatBayar !== null) {
    return { status: 'pembayaran_tidak_sah', kode: galatBayar.kode, pesan: galatBayar.pesan };
  }

  // FR-E2 — `sale` HANYA untuk variation yang stoknya dilacak.
  //
  // ⛔ Dibaca dari KATALOG, bukan dari keranjang. Keranjang hidup di memori
  // (`simpanan.ts`) dan dapat basi terhadap katalog yang baru turun; menyalin
  // `lacakStok` ke dalamnya berarti keputusan stok diambil dari data yang
  // umurnya tidak diketahui siapa pun.
  const variationIds = [...new Set(keranjang.baris.map((b) => b.variationId))];
  const lacak = new Map<string, boolean>();
  if (variationIds.length > 0) {
    const baris = await db.getAll<{ id: string; track_stock: number }>(
      `SELECT id, track_stock FROM item_variation WHERE id IN (${variationIds.map(() => '?').join(',')})`,
      variationIds
    );
    for (const v of baris) lacak.set(v.id, v.track_stock === 1);
  }

  // ⛔ `tendered` dan kembalian hanya ada untuk TUNAI. QRIS dan kartu
  // memindahkan nominal yang persis; `tendered_amount` yang diisi sama dengan
  // `amount` membuat laporan tidak dapat membedakan uang yang benar-benar
  // diserahkan dari nominal transaksi — dan `spec-d:201` memakai perbedaan itu.
  const tendered = pembayaran.metode === 'cash' ? BigInt(pembayaran.tendered) : null;
  if (tendered !== null && tendered < amountDue) {
    return { status: 'kurang_bayar', amountDue, kurang: amountDue - tendered };
  }
  // Kembalian dari `amount_due` yang SUDAH dibulatkan. Menghitungnya dari
  // `total` memberi kembalian beberapa rupiah lebih banyak setiap transaksi.
  const kembalian = tendered === null ? 0n : tendered - amountDue;

  // ---- persistensi: satu transaksi ---------------------------------------

  const orderId = idBaru();
  const checkId = idBaru();
  const paymentId = idBaru();
  const idOutboxOrder = idBaru();
  const idMovement = idBaru();
  const occurredAt = sekarang.toISOString();
  const hlcValue = hlc();

  const perLine = new Map(pajak.perLine.map((p) => [p.lineId, p]));

  const hasil = await db.transaction(async (tx) => {
    const sequence = await urutanBerikutnya(tx, businessDate);
    const receiptNumber = nomorStruk(konfig.deviceCode, businessDate, sequence);

    await tx.execute(
      `INSERT INTO "order"
         (id, tenant_id, outlet_id, device_id, shift_id, receipt_number, business_date, sequence,
          status, channel, subtotal, order_discount, service_charge_amount, tax_amount,
          rounding_adjustment, total, amount_due, created_by, occurred_at, hlc)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'closed', ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`,
      [
        orderId, konfig.tenantId, konfig.outletId, konfig.deviceId, shift.id,
        receiptNumber, businessDate, sequence, channel,
        Number(totals.subtotal),
        Number(orderDiscount),
        // SELURUH pajak — untuk struk. Yang menambah total hanya bagian
        // eksklusifnya, dan itu sudah masuk lewat `computeOrderTotals`.
        Number(pajak.totalTax),
        Number(bulat.roundingAdjustment),
        Number(totals.total),
        Number(amountDue),
        sesi.userId, occurredAt, Number(hlcValue),
      ]
    );

    await tx.execute(
      `INSERT INTO "check" (id, order_id, label, subtotal, total) VALUES (?, ?, NULL, ?, ?)`,
      [checkId, orderId, Number(totals.subtotal), Number(totals.total)]
    );

    keranjang.baris.forEach(() => {});
    for (let i = 0; i < keranjang.baris.length; i += 1) {
      const b = keranjang.baris[i];
      const p = perLine.get(b.id);
      await tx.execute(
        `INSERT INTO order_line
           (id, order_id, check_id, variation_id, item_name, variation_name, unit_price,
            quantity, modifier_snapshot, discount_amount, tax_rate_id, tax_rate, tax_amount,
            is_tax_inclusive, cost_at_sale, line_total, tax_rate_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 0, ?, ?)`,
        [
          b.id, orderId, checkId, b.variationId, b.itemName, b.variationName,
          b.unitPrice, b.quantityMilli,
          // ⛔ Kuantitas ikut ke snapshot (FR-A3). Ia dibaca layar riwayat
          // K-09, dan daftar nama telanjang membuat "Extra Shot ×2" muncul di
          // sana sebagai satu shot — pada layar yang dipakai memutuskan refund.
          b.modifier.length > 0
            ? JSON.stringify(b.modifier.map((m) => ({ nama: m.nama, qtyMilli: m.qtyMilli })))
            : null,
          p?.taxRateId ?? null, Number(p?.rateScaled ?? 0n), Number(p?.amount ?? 0n),
          p?.isInclusive ? 1 : 0,
          Number(lineTotals[i]),
          // F5 — snapshot nama tarif, dari hasil `calculateTax` yang sudah
          // ada. Tanpanya struk yang dicetak ulang hanya dapat menulis
          // "Pajak" (`spec-b:145` melarang menyentuh tabel katalog).
          p?.name ?? null,
        ]
      );

      for (const m of b.modifier) {
        await tx.execute(
          `INSERT INTO order_line_modifier (id, order_line_id, modifier_id, name, price, quantity)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [idBaru(), b.id, m.id, m.nama, m.harga, m.qtyMilli]
        );
      }

      // FR-E3 — stock cutting, di transaksi yang SAMA (`spec-e:112`:
      // "kegagalan menulis movement me-rollback seluruh penjualan").
      //
      // ⛔ Modifier TIDAK menghasilkan movement di v1 (KEP-04): ia tidak punya
      // SKU dan stoknya tidak dilacak. Deplesi bahan lewat resep/BOM adalah
      // v1.2. Karena itu movement ditulis per BARIS, bukan per modifier.
      //
      // Delta NEGATIF sebesar kuantitasnya — barang keluar dari rak. Tidak
      // ada kolom `quantity` di mana pun; stok adalah `SUM(delta)`
      // (invariant Modul E nomor 1).
      if (lacak.get(b.variationId) === true) {
        await tx.execute(
          `INSERT INTO stock_movement
             (id, tenant_id, outlet_id, device_id, variation_id, type, delta, order_id,
              created_by, occurred_at, hlc)
           VALUES (?, ?, ?, ?, ?, 'sale', ?, ?, ?, ?, ?)`,
          [
            idBaru(), konfig.tenantId, konfig.outletId, konfig.deviceId, b.variationId,
            -b.quantityMilli, orderId, sesi.userId, occurredAt, Number(hlcValue),
          ]
        );
      }
    }

    // ⛔ `confirmed` untuk ketiganya, dan itu BUKAN pelanggaran `spec-c:320`.
    // Aturan itu berbunyi "tanpa konfirmasi dari GATEWAY" dan berlaku untuk
    // pembayaran yang punya gateway. Yang mengonfirmasi ketiga metode di sini
    // adalah ORANG — kasir yang melihat uangnya, notifikasi QRIS di ponsel
    // merchant, atau struk terminal EDC.
    //
    // `confirmed_manually` menandai bahwa tidak ada SISTEM yang
    // memverifikasinya, dan hanya QRIS statis yang mendapatkannya: EDC punya
    // kode approval dari acquirer, bukti yang dapat dicocokkan.
    await tx.execute(
      `INSERT INTO payment
         (id, order_id, check_id, method, amount, tendered_amount, change_amount, status,
          provider_reference, approval_code, card_last4, acquirer, terminal_reference,
          confirmed_manually, tendered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?, ?)`,
      [
        paymentId, orderId, checkId, pembayaran.metode, Number(amountDue),
        tendered === null ? null : Number(tendered),
        tendered === null ? null : Number(kembalian),
        pembayaran.metode === 'qris_static' ? pembayaran.referensi.trim() : null,
        pembayaran.metode === 'card_edc' ? pembayaran.approvalCode.trim() : null,
        pembayaran.metode === 'card_edc' ? (pembayaran.cardLast4 ?? null) : null,
        pembayaran.metode === 'card_edc' ? (pembayaran.acquirer ?? null) : null,
        pembayaran.metode === 'card_edc' ? (pembayaran.terminalReference ?? null) : null,
        dikonfirmasiManual(pembayaran.metode) ? 1 : 0,
        occurredAt,
      ]
    );

    // Buku kas — `spec-d:14` menjadikan jumlah `delta` sebagai SATU-SATUNYA
    // definisi saldo laci, dan `spec-d:200` menuntut baris `sale` ditulis
    // "dalam transaksi yang sama dengan penjualan". Ia ada di sini, bukan di
    // langkah berikutnya: laci yang bertambah tanpa penjualan yang tersimpan
    // (atau sebaliknya) adalah persis keadaan yang invariant #1 cegah.
    //
    // ⛔ `delta` memakai NILAI TRANSAKSI, bukan `tendered_amount` (`spec-d:201`).
    // Uang yang diserahkan pelanggan Rp 100.000 untuk belanja Rp 73.000
    // menambah laci Rp 73.000 — kembaliannya keluar lagi, dan `spec-d:201`
    // menegaskan kembalian TIDAK menghasilkan movement terpisah. Memakai
    // `tendered` membuat setiap penjualan berkembalian melebih-lebihkan laci.
    //
    // ⛔ HANYA tunai. QRIS dan kartu tidak memindahkan satu lembar pun ke
    // laci; movement untuk keduanya membuat saldo laci naik pada setiap
    // penjualan non-tunai, dan tutup kas menuntut otorisasi manajer untuk
    // selisih yang tidak pernah ada. Itu cacat yang PERSIS sama bentuknya
    // dengan yang F3 temukan pada refund tunai, hanya arahnya terbalik.
    if (pembayaran.metode === 'cash') {
      await tx.execute(
        `INSERT INTO cash_movement
           (id, shift_id, type, delta, order_id, counterpart_type, created_by, occurred_at, hlc)
         VALUES (?, ?, 'sale', ?, ?, ?, ?, ?, ?)`,
        [
          idMovement,
          shift.id,
          deltaBertanda('sale', Number(amountDue)),
          orderId,
          counterpartUntuk('sale'),
          sesi.userId,
          occurredAt,
          Number(hlcValue),
        ]
      );
    }

    await enqueue(tx, {
      id: idOutboxOrder,
      entityType: 'order',
      entityId: orderId,
      operation: 'create',
      payload: {
        id: orderId,
        outletId: konfig.outletId,
        deviceId: konfig.deviceId,
        shiftId: shift.id,
        receiptNumber,
        businessDate,
        sequence,
        channel,
        checkId,
        hlc: hlcValue.toString(),
        occurredAt,
        // FR-H6: total dan harga yang DIPAKAI KLIEN. Server tetap menghitung
        // sendiri; ini yang membuatnya dapat membedakan klien yang belum
        // tersinkron dari selisih yang tidak dapat dijelaskan.
        // ⛔ NUMBER, bukan string — tidak seperti `hlc`. `assertClientTotalValid`
        // menuntut `Number.isInteger`, dan rupiah utuh muat di double dengan
        // aman; `hlc` string justru karena ia 57-bit dan TIDAK muat.
        // Mengirimnya sebagai string ditolak 400 lalu jadi `gagal-permanen` —
        // penjualan yang sempurna berhenti di antrean. Ditemukan dengan
        // menembak server sungguhan; test pertama saya justru mengunci
        // bug-nya dengan mengharapkan string.
        total: Number(totals.total),
        // FR-B8 — dikirim sebagai PERMINTAAN, bukan nominal hasilnya.
        //
        // ⛔ Server menghitung ulang dari subtotal-nya SENDIRI, dan itu yang
        // membuat jalur pemeriksaan selisih (FR-H6) dapat memutuskan apakah
        // diskon persen dari perangkat yang harganya basi masih konsisten
        // dengan harga-harganya sendiri. Mengirim nominal membuat server
        // tidak dapat membedakan diskon yang wajar dari yang dikarang.
        ...(keranjang.diskon !== null
          ? {
              discount: {
                tipe: keranjang.diskon.minta.tipe,
                nilai: Number(keranjang.diskon.minta.nilai),
              },
              discountReasonCode: keranjang.diskon.alasanKode,
              ...(keranjang.diskon.alasanCatatan
                ? { discountReasonNote: keranjang.diskon.alasanCatatan }
                : {}),
            }
          : {}),
        lines: keranjang.baris.map((b) => ({
          id: b.id,
          variationId: b.variationId,
          quantityMilli: b.quantityMilli,
          discountAmount: 0,
          unitPrice: b.unitPrice,
          modifiers: b.modifier.map((m) => ({
            id: idBaru(),
            modifierId: m.id,
            name: m.nama,
            price: m.harga,
            quantityMilli: m.qtyMilli,
          })),
        })),
      },
      idempotencyKey: orderId,
      createdAt: occurredAt,
      actorId: sesi.userId,
      // ⛔ Penyetuju dibekukan bersama itemnya. Tanpa ini, diskon di atas
      // ambang yang dibuat offline dijawab `403 APPROVAL_REQUIRED` lalu
      // berhenti PERMANEN di antrean — bentuk cacat yang sama persis dengan
      // refund offline, dan alasan `outbox_local.approver_id` ada.
      approverId: keranjang.diskon?.approverId ?? null,
    });

    await enqueue(tx, {
      id: idBaru(),
      entityType: 'payment',
      entityId: orderId,
      operation: 'create',
      // ⛔ Yang dikirim per METODE, bukan gabungan seluruh field. Server
      // menuntut `tenderedAmount` untuk tunai dan `reference` untuk QRIS
      // statis; mengirim keduanya membuat validasi server tidak pernah dapat
      // menolak masukan yang salah tempat, dan pembayaran kartu yang membawa
      // `tenderedAmount` terlihat seperti tunai di setiap laporan yang
      // membacanya.
      payload: muatanPembayaran(paymentId, pembayaran, amountDue),
      idempotencyKey: paymentId,
      createdAt: occurredAt,
      // ⛔ Pembayaran BERGANTUNG pada order-nya. Tanpa ini, relay dapat
      // mengirim payment lebih dulu ke order yang belum ada di server — 404,
      // lalu `gagal-permanen` untuk penjualan yang sempurna.
      dependsOn: idOutboxOrder,
      actorId: sesi.userId,
    });

    // ⛔ Keadaan HLC disimpan DI DALAM transaksi ini, bukan sesudahnya.
    //
    // Kalau ia ditulis di luar, ada jendela di antara commit order dan commit
    // hlc_state. Perangkat yang mati di jendela itu memuat nilai LAMA saat
    // boot, dan tick berikutnya dapat menghasilkan HLC yang SUDAH DIPAKAI
    // order yang sudah ter-commit — pelanggaran I10 yang tidak menghasilkan
    // satu pun error, dan yang membuat "mana yang lebih dulu" tidak dapat
    // dijawab justru di tempat yang paling membutuhkannya.
    await simpanHlc(tx, hlcValue);

    return { receiptNumber, sequence };
  });

  // ⛔ INVARIANT #3 — "Simpan sebelum cetak, SELALU."
  //
  // Cetak berjalan SETELAH `db.transaction` di atas selesai dan ter-commit,
  // di luar blok transaksinya. Menaruhnya di dalam berarti kertas yang habis
  // me-rollback penjualan yang uangnya SUDAH masuk laci — dan penjualan yang
  // hilang tidak dapat dipulihkan, sementara struk selalu dapat dicetak ulang.
  //
  // `cetakStruk` tidak pernah melempar; hasilnya DIKEMBALIKAN supaya layar
  // dapat berkata "struk gagal dicetak, transaksi tersimpan" — bukan diam,
  // dan bukan menuduh penjualannya gagal.
  //
  // Ini juga urutan yang `ARCH:201` sebut mengikat: commit → SigningHook →
  // ReceiptRenderer. `SigningHook` masih no-op di Indonesia; tempatnya ada di
  // sini bila kelak dibutuhkan.
  // ⛔ `cetakDanCatat`, bukan `cetakStruk` telanjang. Satu pintu, supaya tidak
  // ada jalur cetak yang lupa mencatat ke `print_job` — dan jalur yang lupa
  // adalah jalur yang struknya HILANG saat gagal, yaitu tepat jalur yang paling
  // membutuhkan antreannya. Ia tetap tidak pernah melempar (invariant #3).
  const cetak = await cetakDanCatat(
    db,
    peripheral,
    bangunDokumenStruk({
      namaMerchant: outlet?.name ?? '',
      alamatOutlet: null,
      receiptNumber: hasil.receiptNumber,
      waktu: occurredAt,
      namaKasir: sesi.userId,
      channel,
      baris: keranjang.baris.map((b, i) => ({
        itemName: b.itemName,
        variationName: b.variationName,
        quantityMilli: b.quantityMilli,
        lineTotal: Number(lineTotals[i]),
        modifier: b.modifier.map((m) => ({
          nama: m.nama,
          harga: m.harga,
          qtyMilli: m.qtyMilli,
        })),
      })),
      subtotal: Number(totals.subtotal),
      // ⛔ Diskon SUNGGUHAN, bukan nol. `totals.subtotal` adalah subtotal KOTOR
      // (`computeOrderTotals` tidak menguranginya), jadi struk yang mencetak
      // subtotal dan TOTAL tanpa baris di antaranya menyodorkan dua angka yang
      // selisihnya tidak dapat dijelaskan pelanggan mana pun — dan selisih tak
      // terjelaskan pada struk adalah keluhan yang berakhir di kasir.
      diskon: Number(orderDiscount),
      serviceCharge: 0,
      // `lines` adalah rincian PER TARIF — itu yang dicetak di struk
      // (`spec-c:404`: nama dari `TaxRate.name`). `perLine` adalah snapshot
      // per baris order, dan mencetaknya akan mengulang tarif yang sama
      // sebanyak jumlah produk.
      pajak: pajak.lines.map((r) => ({ nama: r.name, jumlah: Number(r.amount) })),
      pembulatan: Number(bulat.roundingAdjustment),
      total: Number(amountDue),
      // ⛔ Yang dicetak untuk tunai adalah uang yang DISERAHKAN (bersama
      // kembaliannya); untuk metode lain, nominal transaksinya. Mencetak
      // `amount_due` sebagai "Tunai" pada struk berkembalian membuat baris
      // pembayaran dan baris kembalian tidak konsisten satu sama lain.
      pembayaran: [
        { nama: labelMetode(pembayaran.metode), jumlah: Number(tendered ?? amountDue) },
      ],
      kembalian: Number(kembalian),
    }),
    printerProfile,
    { id: idBaru(), orderId, waktu: occurredAt }
  );

  return {
    status: 'tersimpan',
    orderId,
    receiptNumber: hasil.receiptNumber,
    sequence: hasil.sequence,
    total: totals.total,
    taxAmount: pajak.totalTax,
    amountDue,
    roundingAdjustment: bulat.roundingAdjustment,
    kembalian,
    cetak,
  };
}
