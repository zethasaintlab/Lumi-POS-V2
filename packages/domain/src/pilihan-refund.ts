/**
 * FR-B7 — refund parsial: *"Kasir memilih baris mana yang direfund. Total
 * refund tidak boleh melebihi total order dikurangi refund sebelumnya."*
 *
 * Modul murni, dibagi klien dan server. Ia menjawab dua pertanyaan yang
 * KEDUANYA harus dijawab sama di layar kasir dan di server, karena jawaban
 * yang berbeda berarti kasir menjanjikan angka yang lalu ditolak — di depan
 * pelanggan.
 *
 *   1. berapa banyak dari tiap baris yang MASIH boleh dikembalikan;
 *   2. berapa rupiah yang seharusnya dikembalikan untuk pilihan itu.
 *
 * ## ⛔ Nilai refund TIDAK dijumlahkan dari `line_total`
 *
 * `order_line.line_total` **belum kena pajak eksklusif**, sementara
 * `order.total` sudah. Menjumlahkan `line_total` baris terpilih karena itu
 * mengembalikan uang lebih sedikit daripada yang pelanggan bayar — dan
 * salahnya diam, karena angkanya masuk akal.
 *
 * Untuk pajak INKLUSIF, `line_total` justru sudah memuat pajaknya. Tidak ada
 * satu rumus penjumlahan yang benar untuk keduanya.
 *
 * Yang benar: bagi `order.total` itu sendiri dengan `line_total` sebagai
 * bobot (`allocateProportionally`). Apa pun bentuk pajaknya, pembulatannya,
 * dan service charge-nya, refund SELURUH baris mengembalikan **tepat**
 * `order.total`.
 *
 * ## ⛔ Batas per baris diturunkan per VARIASI, bukan per baris
 *
 * Itu aturan server (`planRestock` → `RESTOCK_EXCEEDS_SOLD`), dan ia harus
 * ditiru di sini persis. Dua baris dapat menunjuk `variation_id` yang sama —
 * modifier memisahkan baris, stoknya satu — dan `stock_movement` hanya
 * mencatat variasi, bukan baris. Membatasi per baris akan meloloskan pilihan
 * yang server tolak.
 */

import { allocateProportionally } from './alokasi.ts';

/** Satu baris order, sebagaimana dibaca dari database mana pun. */
export interface BarisOrderRefund {
  lineId: string;
  variationId: string;
  /** Kuantitas terjual, INTEGER ×1000. */
  quantityMilli: bigint;
  /** `order_line.line_total` — bobot alokasi, bukan nilai refund. */
  lineTotal: bigint;
}

/** Berapa dari satu variasi yang sudah pernah dikembalikan ke rak. */
export interface DikembalikanPerVariasi {
  variationId: string;
  quantityMilli: bigint;
}

export interface BarisTerpilih {
  lineId: string;
  quantityMilli: bigint;
}

export interface SisaBaris {
  lineId: string;
  /** Terjual pada baris ini. */
  terjualMilli: bigint;
  /**
   * Yang masih boleh dikembalikan DARI baris ini, sesudah memperhitungkan
   * pengembalian sebelumnya atas variasi yang sama.
   */
  sisaMilli: bigint;
}

/**
 * Sisa yang dapat dikembalikan per baris.
 *
 * ⛔ Pengembalian sebelumnya tercatat per VARIASI, jadi ia harus dibagi ke
 * baris-baris yang memakai variasi itu. Urutannya **baris pertama lebih
 * dulu** — deterministik, dan sama di klien dan server. Membaginya
 * proporsional akan menghasilkan pecahan kuantitas yang tidak dapat dipilih
 * kasir.
 *
 * Ini perkiraan yang AMAN, bukan kebenaran per baris: kebenaran per baris
 * tidak ada di mana pun karena `stock_movement` tidak menyimpan `line_id`.
 * Yang dijamin adalah jumlahnya per variasi tidak pernah melebihi yang
 * server izinkan.
 */
export function sisaPerBaris(
  baris: readonly BarisOrderRefund[],
  dikembalikan: readonly DikembalikanPerVariasi[]
): SisaBaris[] {
  const sisaVariasi = new Map<string, bigint>();
  for (const d of dikembalikan) {
    sisaVariasi.set(d.variationId, (sisaVariasi.get(d.variationId) ?? 0n) + d.quantityMilli);
  }

  return baris.map((b) => {
    const terpakai = sisaVariasi.get(b.variationId) ?? 0n;
    // Baris ini menyerap sebanyak-banyaknya kuantitasnya sendiri.
    const diserap = terpakai > b.quantityMilli ? b.quantityMilli : terpakai;
    sisaVariasi.set(b.variationId, terpakai - diserap);
    return {
      lineId: b.lineId,
      terjualMilli: b.quantityMilli,
      sisaMilli: b.quantityMilli - diserap,
    };
  });
}

export type GalatPilihan =
  | { kode: 'BARIS_TIDAK_DIKENAL'; lineId: string }
  | { kode: 'KUANTITAS_TIDAK_SAH'; lineId: string }
  | { kode: 'MELEBIHI_SISA'; lineId: string; sisaMilli: bigint; dimintaMilli: bigint };

/**
 * Validasi pilihan kasir terhadap sisa. `null` berarti sah.
 *
 * ⛔ Kuantitas nol DITOLAK, bukan diabaikan. Baris ber-kuantitas nol di
 * `lines` berarti "baris ini kembali" bagi pembacaan sepintas dan "tidak ada
 * yang kembali" bagi server; menerimanya diam-diam membuat dua pihak
 * menyimpulkan hal berbeda dari permintaan yang sama.
 */
export function periksaPilihan(
  baris: readonly BarisOrderRefund[],
  dikembalikan: readonly DikembalikanPerVariasi[],
  pilihan: readonly BarisTerpilih[]
): GalatPilihan | null {
  const sisa = new Map(sisaPerBaris(baris, dikembalikan).map((s) => [s.lineId, s.sisaMilli]));

  for (const p of pilihan) {
    if (!sisa.has(p.lineId)) return { kode: 'BARIS_TIDAK_DIKENAL', lineId: p.lineId };
    if (p.quantityMilli <= 0n) return { kode: 'KUANTITAS_TIDAK_SAH', lineId: p.lineId };
  }

  // Baris yang sama disebut dua kali dijumlahkan, bukan ditolak: pemanggil
  // yang menyusunnya dari UI dapat menghasilkan bentuk itu, dan yang penting
  // adalah TOTAL per baris tidak melebihi sisanya.
  const diminta = new Map<string, bigint>();
  for (const p of pilihan) {
    diminta.set(p.lineId, (diminta.get(p.lineId) ?? 0n) + p.quantityMilli);
  }
  for (const [lineId, jumlah] of diminta) {
    const s = sisa.get(lineId) ?? 0n;
    if (jumlah > s) {
      return { kode: 'MELEBIHI_SISA', lineId, sisaMilli: s, dimintaMilli: jumlah };
    }
  }
  return null;
}

/**
 * Nilai rupiah yang sepadan dengan baris terpilih.
 *
 * `orderTotal` dibagi ke seluruh baris dengan `line_total` sebagai bobot;
 * bagian tiap baris lalu diambil sebanding kuantitas yang dipilih.
 *
 * ⛔ Dua sifat yang dijamin, dan keduanya diuji sebagai property:
 *
 *   - memilih SELURUH baris dengan kuantitas penuh menghasilkan **tepat**
 *     `orderTotal` — tidak kurang satu rupiah, yang akan membuat "refund
 *     penuh" meninggalkan sisa yang tidak dapat dijelaskan;
 *   - hasilnya tidak pernah melebihi `orderTotal`.
 *
 * Pembulatan bagian sebagian ke BAWAH: refund yang sedikit lebih kecil
 * meninggalkan sisa yang masih dapat dikembalikan; yang sedikit lebih besar
 * membuat sisa negatif dan menuntut penjepitan di tempat lain.
 */
export function nilaiRefundBaris(
  baris: readonly BarisOrderRefund[],
  orderTotal: bigint,
  pilihan: readonly BarisTerpilih[]
): bigint {
  const bagian = allocateProportionally(
    orderTotal,
    baris.map((b) => b.lineTotal)
  );
  const perBaris = new Map(baris.map((b, i) => [b.lineId, { baris: b, bagian: bagian[i] }]));

  const diminta = new Map<string, bigint>();
  for (const p of pilihan) {
    diminta.set(p.lineId, (diminta.get(p.lineId) ?? 0n) + p.quantityMilli);
  }

  let total = 0n;
  for (const [lineId, qty] of diminta) {
    const b = perBaris.get(lineId);
    if (b === undefined) continue;
    if (b.baris.quantityMilli <= 0n) continue;
    // Kuantitas penuh mengambil bagiannya UTUH — tanpa perkalian dan
    // pembagian yang dapat kehilangan satu rupiah pada pembulatan.
    total += qty >= b.baris.quantityMilli
      ? b.bagian
      : (b.bagian * qty) / b.baris.quantityMilli;
  }
  return total;
}

/** Seluruh baris, kuantitas penuh — bentuk pilihan untuk refund PENUH. */
export function seluruhBaris(baris: readonly BarisOrderRefund[]): BarisTerpilih[] {
  return baris.map((b) => ({ lineId: b.lineId, quantityMilli: b.quantityMilli }));
}
