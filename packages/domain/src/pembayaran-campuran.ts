import { computeCashRounding, type RoundingMode } from './money.ts';

/**
 * Pembayaran campuran — satu order, banyak payment. FR-C1 [P0], `spec-c:195`.
 *
 * *"Pembayaran campuran (tunai + QRIS) adalah alur harian di kafe Indonesia,
 * bukan edge case."*
 *
 * ## ⛔ Kenapa pembulatan tidak dapat dihitung sekali di awal
 *
 * `spec-c:181`: yang dibulatkan adalah **sisa tunai setelah pembayaran
 * non-tunai** — total 93.555 dengan QRIS 50.000 membulatkan 43.555 menjadi
 * 43.600, bukan membulatkan 93.555. Jadi `amount_due` sebuah order bergantung
 * pada CAMPURAN metodenya, bukan hanya pada totalnya.
 *
 * Itu sebabnya berkas ini menerima seluruh bagian pembayaran sekaligus dan
 * mengembalikan satu rencana. Menghitungnya per bagian, satu per satu, berarti
 * pembulatan diterapkan pada sisa yang belum lengkap.
 *
 * ## ⛔ Kelebihan bayar NON-TUNAI ditolak
 *
 * `spec-c:225`: tidak ada mekanisme mengembalikan kembalian non-tunai. QRIS
 * yang kelebihan Rp 10.000 berarti merchant berutang Rp 10.000 kepada
 * pelanggan lewat saluran yang tidak dapat mengembalikannya — dan yang
 * mengetahuinya hanya pelanggan.
 */

/**
 * ⛔ `qris_dynamic` IKUT, dan konsekuensinya satu: pembulatan tunai tetap
 * dihitung dari sisa setelah SELURUH bagian non-tunai, apa pun salurannya.
 *
 * Ia tidak dapat digabung dengan metode lain hari ini — jalur online-first
 * mengirim satu bagian penuh ke gateway — tetapi membiarkannya di luar tipe
 * ini berarti aritmetika campuran punya lubang berbentuk metode: hari ada yang
 * menggabungnya, `sisaTagihan` tidak menghitungnya dan kasir menagih tunai
 * sebesar SELURUH total untuk transaksi yang separuhnya sudah dibayar.
 */
export type MetodeCampuran = 'cash' | 'qris_dynamic' | 'qris_static' | 'card_edc';

export interface BagianBayar {
  metode: MetodeCampuran;
  /**
   * Nominal untuk bagian NON-TUNAI, rupiah utuh.
   *
   * Untuk tunai ia diabaikan: yang menentukan adalah sisa tagihan setelah
   * bagian non-tunai, dibulatkan. Kasir tidak mengetik nominal tunai — ia
   * mengetik uang yang DISERAHKAN.
   */
  nominal?: bigint;
  /** Uang yang diserahkan pelanggan. Hanya untuk tunai. */
  tendered?: bigint;
}

export interface RencanaBayar {
  /** Yang tercatat di `order.amount_due` — jumlah seluruh bagian. */
  amountDue: bigint;
  roundingAdjustment: bigint;
  /** Nominal yang harus dibayar tunai, sesudah non-tunai dan dibulatkan. */
  tunaiDitagih: bigint;
  kembalian: bigint;
  /** Nominal per bagian, urutannya sama dengan masukan. */
  nominalBagian: bigint[];
}

export type KodeGalatCampuran =
  | 'KELEBIHAN_NON_TUNAI'
  | 'KURANG_BAYAR'
  | 'TANPA_PEMBAYARAN'
  | 'BANYAK_TUNAI'
  | 'NOMINAL_TIDAK_SAH';

export type HasilRencanaBayar =
  | { ok: true; rencana: RencanaBayar }
  | { ok: false; kode: KodeGalatCampuran; pesan: string };

function gagal(kode: KodeGalatCampuran, pesan: string): HasilRencanaBayar {
  return { ok: false, kode, pesan };
}

/**
 * Menyusun rencana pembayaran untuk satu order.
 *
 * ⛔ SATU bagian tunai, maksimal. Dua baris tunai pada satu order tidak
 * menambah informasi apa pun — uang tunai tidak punya identitas yang
 * membedakan — sementara ia membuat "berapa kembaliannya" punya lebih dari
 * satu jawaban yang sama benarnya.
 */
export function rencanakanPembayaran({
  total,
  bagian,
  roundingIncrement,
  roundingMode,
}: {
  total: bigint;
  bagian: readonly BagianBayar[];
  roundingIncrement: bigint;
  roundingMode: RoundingMode;
}): HasilRencanaBayar {
  if (bagian.length === 0) {
    return gagal('TANPA_PEMBAYARAN', 'Belum ada pembayaran yang dimasukkan.');
  }

  const tunai = bagian.filter((b) => b.metode === 'cash');
  if (tunai.length > 1) {
    return gagal('BANYAK_TUNAI', 'Hanya satu bagian tunai per transaksi.');
  }

  let nonTunai = 0n;
  for (const b of bagian) {
    if (b.metode === 'cash') continue;
    const n = b.nominal;
    if (typeof n !== 'bigint' || n <= 0n) {
      return gagal('NOMINAL_TIDAK_SAH', 'Nominal pembayaran non-tunai harus lebih besar dari nol.');
    }
    nonTunai += n;
  }

  if (nonTunai > total) {
    // `spec-c:225`. Pesannya menyebut ANGKANYA: kasir yang membaca "kelebihan
    // bayar" tanpa nominal harus menghitung sendiri di depan pelanggan.
    return gagal(
      'KELEBIHAN_NON_TUNAI',
      `Pembayaran non-tunai melebihi tagihan sebesar ${nonTunai - total}. ` +
        'Kembalian non-tunai tidak dapat diberikan — kurangi nominalnya.'
    );
  }

  const sisa = total - nonTunai;

  if (tunai.length === 0) {
    if (sisa > 0n) {
      return gagal(
        'KURANG_BAYAR',
        `Kurang ${sisa}. Tambahkan pembayaran tunai atau naikkan nominal non-tunai.`
      );
    }
    return {
      ok: true,
      rencana: {
        amountDue: total,
        // ⛔ Tanpa tunai tidak ada pembulatan sama sekali (FR-C9). Bukan
        // "pembulatan nol karena kebetulan" — tidak ada lembaran yang perlu
        // dibulatkan, jadi tidak ada langkah pembulatan.
        roundingAdjustment: 0n,
        tunaiDitagih: 0n,
        kembalian: 0n,
        nominalBagian: bagian.map((b) => b.nominal ?? 0n),
      },
    };
  }

  // ⛔ Yang dibulatkan SISA-nya, bukan totalnya (`spec-c:181`).
  const bulat = computeCashRounding({
    outstanding: sisa,
    roundingIncrement,
    roundingMode,
  });
  const tunaiDitagih = bulat.roundedOutstanding;

  const diserahkan = tunai[0].tendered;
  if (typeof diserahkan !== 'bigint' || diserahkan < 0n) {
    return gagal('NOMINAL_TIDAK_SAH', 'Uang tunai yang diserahkan tidak sah.');
  }
  if (diserahkan < tunaiDitagih) {
    return gagal('KURANG_BAYAR', `Kurang ${tunaiDitagih - diserahkan}.`);
  }

  return {
    ok: true,
    rencana: {
      amountDue: nonTunai + tunaiDitagih,
      roundingAdjustment: bulat.roundingAdjustment,
      tunaiDitagih,
      // Kembalian dari nominal yang SUDAH dibulatkan. Menghitungnya dari sisa
      // yang belum dibulatkan memberi kembalian beberapa rupiah lebih banyak
      // pada setiap transaksi.
      kembalian: diserahkan - tunaiDitagih,
      nominalBagian: bagian.map((b) => (b.metode === 'cash' ? tunaiDitagih : (b.nominal ?? 0n))),
    },
  };
}

/**
 * Sisa tagihan setelah bagian yang sudah dimasukkan — untuk DITAMPILKAN.
 *
 * AC FR-C1 kedua menuntut sisa tagihan terlihat. Ia sengaja tidak memakai
 * `rencanakanPembayaran`: yang ini harus menjawab bahkan saat masukannya belum
 * lengkap, yaitu justru keadaan saat kasir paling membutuhkannya.
 */
export function sisaTagihan(total: bigint, bagian: readonly BagianBayar[]): bigint {
  let nonTunai = 0n;
  for (const b of bagian) {
    if (b.metode === 'cash') continue;
    if (typeof b.nominal === 'bigint' && b.nominal > 0n) nonTunai += b.nominal;
  }
  const sisa = total - nonTunai;
  return sisa > 0n ? sisa : 0n;
}
