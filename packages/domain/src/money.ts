/**
 * Aritmetika uang order (FR-B4, `CLAUDE.md` § Konvensi data).
 *
 * Dua konvensi bertemu di sini, keduanya hasil pengukuran, bukan selera:
 *
 *   Uang      : `bigint` rupiah UTUH. **Tidak pernah float.**
 *   Kuantitas : `INTEGER x1000`. `0.5 kg` -> `500`.
 *
 * `CLAUDE.md` soal yang kedua: "Terbukti lewat pengukuran: `REAL` membuat
 * `WHERE stok = 0` gagal diam-diam."
 *
 * ## Kenapa di packages/domain
 *
 * Server dan klien harus menghitung total yang SAMA PERSIS. Klien menampilkan
 * angka di layar sebelum penjualan tersimpan; server menyimpannya. Kalau
 * keduanya punya implementasi sendiri, perbedaan satu rupiah akibat urutan
 * pembulatan akan muncul sebagai selisih kas di akhir shift yang tidak bisa
 * dijelaskan siapa pun.
 *
 * ## Invariant #7 -- tidak ada pajak di sini
 *
 * Modul ini **menerima** `taxAmount` yang sudah dihitung dan meneruskannya.
 * Tidak ada tarif, tidak ada `0.11`, tidak ada persentase apa pun di file
 * ini. Menghitung pajak adalah pekerjaan `TaxCalculator` (Modul C), dan
 * memindahkan sedikit saja logikanya ke sini adalah cacat arsitektur.
 */

const MILLI = 1000n;

/** Kuantitas x1000 dikali kuantitas modifier x1000 = penyebut 1e6. */
const LINE_SCALE = MILLI * MILLI;

export interface ModifierAmount {
  price: bigint;
  quantityMilli: bigint;
}

export interface LineInput {
  unitPrice: bigint;
  /** Kuantitas x1000. `2` -> `2000`, `0.5` -> `500`. */
  quantityMilli: bigint;
  modifiers: ReadonlyArray<ModifierAmount>;
  discountAmount: bigint;
}

export interface OrderTotalsInput {
  lineTotals: ReadonlyArray<bigint>;
  orderDiscount: bigint;
  serviceChargeAmount: bigint;
  /** Sudah dihitung TaxCalculator (Modul C). Modul ini tidak menghitungnya. */
  taxAmount: bigint;
}

export type RoundingMode = 'half_up' | 'up' | 'down';

export interface CashRoundingInput {
  /** Sisa yang akan dibayar tunai — bukan `total` order. */
  outstanding: bigint;
  /** `outlet.rounding_increment`, default 100. `1` = tanpa pembulatan. */
  roundingIncrement: bigint;
  /** `outlet.rounding_mode`. */
  roundingMode: string;
}

export interface CashRounding {
  roundedOutstanding: bigint;
  /** `roundedOutstanding - outstanding`. Bisa negatif. */
  roundingAdjustment: bigint;
}

export interface OrderTotals {
  /** Langkah 6: SUM(line_total). */
  subtotal: bigint;
  /** Langkah 8: subtotal - order_discount. */
  base: bigint;
  /** Langkah 10: base + service_charge. Service charge KENA pajak. */
  taxBase: bigint;
  /** Langkah 12: tax_base + tax_amount. **Tidak dibulatkan.** */
  total: bigint;
}

function assertBigint(value: unknown, nama: string): asserts value is bigint {
  if (typeof value !== 'bigint') {
    // Menerima `number` di sini adalah jalan masuk float ke jalur uang.
    // Mengonversinya diam-diam akan menyembunyikan persis kesalahan yang
    // konvensi bigint ini ada untuk mencegah.
    throw new TypeError(`${nama} harus bigint, bukan ${typeof value}. Uang tidak pernah float.`);
  }
}

/**
 * Pembulatan half-up untuk bigint non-negatif.
 *
 * Pembagian `bigint` di JavaScript memotong ke arah nol. Untuk nilai
 * non-negatif itu sama dengan floor, jadi menambahkan setengah penyebut
 * sebelum membagi menghasilkan half-up yang tepat -- tanpa pernah menyentuh
 * floating point.
 */
function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}

/**
 * `line_total` untuk satu `order_line` — langkah 1–5 FR-C8.
 *
 * ```
 * 1. line_subtotal    = unit_price x quantity                 -> bulatkan
 * 2. line_modifiers   = SUM(modifier.price x modifier.qty)    -> bulatkan
 * 3. line_before_disc = 1 + 2
 * 4. line_discount    = diskon tingkat baris
 * 5. line_total       = 3 - 4
 * ```
 *
 * Modifier melekat PER UNIT lalu ikut dikalikan kuantitas baris: 2 kopi
 * dengan extra shot = 2 x (harga kopi + harga shot). Ini semantik POS yang
 * lazim, dan `order_line_modifier.quantity` (default `1000` = 1) memungkinkan
 * "2 extra shot pada 1 kopi" secara terpisah.
 *
 * ## Pembulatan dilakukan PER LANGKAH
 *
 * `spec-c-pembayaran-pajak.md:126` mewajibkannya, dengan alasan yang tertulis:
 * "menyimpan pecahan lalu membulatkan di akhir menghasilkan total yang tidak
 * sama dengan jumlah baris yang tercetak di struk — dan merchant akan
 * menemukannya."
 *
 * Versi pertama fungsi ini membulatkan sekali di akhir dan komentarnya justru
 * membenarkan kebalikannya. Itu keliru. Selisihnya nyata pada kuantitas
 * pecahan: `unit_price` 3.333 qty 0,5 dengan modifier 3.333 menghasilkan
 * 3.334 menurut spec, 3.333 dengan pembulatan tunggal.
 */
export function computeLineTotal(input: LineInput): bigint {
  assertBigint(input.unitPrice, 'unitPrice');
  assertBigint(input.quantityMilli, 'quantityMilli');
  assertBigint(input.discountAmount, 'discountAmount');

  if (input.unitPrice < 0n) {
    throw new RangeError('unitPrice tidak boleh negatif.');
  }
  if (input.quantityMilli <= 0n) {
    throw new RangeError('kuantitas harus lebih besar dari 0.');
  }
  if (input.discountAmount < 0n) {
    throw new RangeError('discountAmount tidak boleh negatif.');
  }

  // Langkah 1 -- unit_price x quantity, dibulatkan.
  const lineSubtotal = divRoundHalfUp(input.unitPrice * input.quantityMilli, MILLI);

  // Langkah 2 -- SUM(modifier.price x modifier.qty), dibulatkan. `qty` di sini
  // adalah kuantitas EFEKTIF: kuantitas modifier dikali kuantitas baris. Itu
  // yang dipakai contoh terhitung spec-c:137 (Extra Shot 5.000 x 2 kopi =
  // 10.000), bukan kuantitas modifier saja.
  let modifiersScaled = 0n;
  for (const m of input.modifiers) {
    assertBigint(m.price, 'modifier.price');
    assertBigint(m.quantityMilli, 'modifier.quantityMilli');
    if (m.price < 0n) {
      throw new RangeError('modifier.price tidak boleh negatif.');
    }
    if (m.quantityMilli < 0n) {
      throw new RangeError('modifier.quantityMilli tidak boleh negatif.');
    }
    modifiersScaled += m.price * m.quantityMilli * input.quantityMilli;
  }
  const lineModifiers = divRoundHalfUp(modifiersScaled, LINE_SCALE);

  // Langkah 3 -- penjumlahan dua bigint yang sudah dibulatkan, eksak.
  const gross = lineSubtotal + lineModifiers;

  if (input.discountAmount > gross) {
    // Baris dengan total negatif bukan diskon, itu data rusak. Menjepitnya ke
    // nol akan menyembunyikan kesalahan input; menolaknya membuatnya terlihat.
    throw new RangeError(
      `discountAmount (${input.discountAmount}) melebihi nilai kotor baris (${gross}).`
    );
  }
  return gross - input.discountAmount;
}

/**
 * Total order — langkah 6–12 FR-C8.
 *
 * ```
 * 6.  subtotal   = SUM(line_total)
 * 7.  order_discount
 * 8.  base       = subtotal - order_discount
 * 9.  service_charge = base x service_charge_rate   (diterima sudah dihitung)
 * 10. tax_base   = base + service_charge            <- service charge KENA pajak
 * 11. tax_amount = tax_base x tax_rate              (dari TaxCalculator)
 * 12. total      = tax_base + tax_amount
 * ```
 *
 * ## `total` TIDAK dibulatkan — ini sengaja
 *
 * Versi pertama fungsi ini membulatkan `total` ke kelipatan
 * `rounding_increment`. Itu keliru terhadap FR-C8: yang dibulatkan adalah
 * **`amount_due`** (langkah 13–14), bukan `total`.
 *
 * `total` adalah nilai transaksi — dipakai laporan penjualan dan dasar
 * pelaporan pajak. Membulatkannya menggeser angka itu. Pada contoh terhitung
 * `spec-c:145-147`, `total` adalah 93.555 sementara yang dibayar 93.600.
 *
 * Lebih jauh, FR-C9 menetapkan pembulatan hanya berlaku **bila ada pembayaran
 * tunai**; order yang dibayar 100% QRIS punya `rounding_adjustment = 0`.
 * Karena itu pembulatan mustahil dihitung di sini: saat order dibuat, belum
 * ada pembayaran apa pun. Ia hidup di jalur pembayaran, bukan di sini —
 * makanya `roundingIncrement` tidak lagi jadi parameter, bukan sekadar
 * diabaikan.
 *
 * Invariant yang dijamin fungsi ini:
 *
 *   base     == subtotal - orderDiscount
 *   taxBase  == base + serviceChargeAmount
 *   total    == taxBase + taxAmount
 */
export function computeOrderTotals(input: OrderTotalsInput): OrderTotals {
  assertBigint(input.orderDiscount, 'orderDiscount');
  assertBigint(input.serviceChargeAmount, 'serviceChargeAmount');
  assertBigint(input.taxAmount, 'taxAmount');

  let subtotal = 0n;
  for (const lineTotal of input.lineTotals) {
    assertBigint(lineTotal, 'lineTotal');
    subtotal += lineTotal;
  }

  if (input.orderDiscount > subtotal) {
    throw new RangeError(
      `orderDiscount (${input.orderDiscount}) melebihi subtotal (${subtotal}).`
    );
  }

  const base = subtotal - input.orderDiscount;
  const taxBase = base + input.serviceChargeAmount;

  return {
    subtotal,
    base,
    taxBase,
    total: taxBase + input.taxAmount,
  };
}

/**
 * Pembulatan tunai Indonesia (FR-C9).
 *
 * Pecahan di bawah Rp 100 praktis tidak beredar, jadi jumlah yang dibayar
 * tunai dibulatkan ke `outlet.rounding_increment`.
 *
 * ## Yang dibulatkan bukan `total`
 *
 * `spec-c-pembayaran-pajak.md:162` — "Pembulatan mengubah **jumlah yang
 * dibayar tunai**, bukan nilai transaksi dan bukan dasar pengenaan pajak."
 *
 * Karena itu fungsi ini menerima `outstanding` (sisa yang akan dibayar
 * tunai), bukan `total`. Untuk pembayaran campuran, `spec-c:181` menegaskan
 * yang dibulatkan adalah sisa tunai setelah pembayaran non-tunai: total
 * 93.555 dengan QRIS 50.000 membulatkan 43.555 menjadi 43.600, bukan
 * membulatkan 93.555.
 *
 * Konsekuensinya pembulatan mustahil dihitung saat order dibuat — order baru
 * belum punya pembayaran apa pun, dan `computeOrderTotals` karena itu tidak
 * menerima `roundingIncrement` sama sekali.
 *
 * `roundingAdjustment` DITURUNKAN dari selisih, bukan dihitung terpisah,
 * sehingga `rounded === outstanding + adjustment` benar secara konstruksi.
 * Tanpa itu, laporan kas tidak akan berimbang dan tidak ada yang bisa
 * menjelaskan ke mana rupiahnya pergi.
 */
export function computeCashRounding(input: CashRoundingInput): CashRounding {
  assertBigint(input.outstanding, 'outstanding');
  assertBigint(input.roundingIncrement, 'roundingIncrement');

  if (input.roundingIncrement <= 0n) {
    throw new RangeError('roundingIncrement harus lebih besar dari 0.');
  }
  if (input.outstanding < 0n) {
    throw new RangeError('outstanding tidak boleh negatif.');
  }

  const inc = input.roundingIncrement;
  const sisa = input.outstanding % inc;

  let rounded: bigint;
  if (sisa === 0n) {
    rounded = input.outstanding;
  } else if (input.roundingMode === 'half_up') {
    rounded = divRoundHalfUp(input.outstanding, inc) * inc;
  } else if (input.roundingMode === 'up') {
    rounded = input.outstanding - sisa + inc;
  } else if (input.roundingMode === 'down') {
    rounded = input.outstanding - sisa;
  } else {
    // Jatuh diam-diam ke half_up untuk mode yang tidak dikenal akan membuat
    // outlet yang salah konfigurasi menagih berbeda dari yang diharapkan
    // merchant, tanpa gejala apa pun.
    throw new RangeError(
      `rounding_mode "${input.roundingMode}" tidak dikenal. Pilihannya: half_up, up, down.`
    );
  }

  return { roundedOutstanding: rounded, roundingAdjustment: rounded - input.outstanding };
}
