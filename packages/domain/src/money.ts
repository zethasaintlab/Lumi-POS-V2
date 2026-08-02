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
  /** `outlet.rounding_increment`, default 100 di skema. `1` = tanpa pembulatan. */
  roundingIncrement: bigint;
}

export interface OrderTotals {
  subtotal: bigint;
  roundingAdjustment: bigint;
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
 * `line_total` untuk satu `order_line`.
 *
 * Modifier melekat PER UNIT lalu ikut dikalikan kuantitas baris: 2 kopi
 * dengan extra shot = 2 x (harga kopi + harga shot). Ini semantik POS yang
 * lazim, dan `order_line_modifier.quantity` (default `1000` = 1) memungkinkan
 * "2 extra shot pada 1 kopi" secara terpisah.
 *
 * Pembulatan dilakukan **sekali di akhir**, bukan di setiap langkah. Membulatkan
 * per modifier lalu menjumlahkannya akan mengakumulasi galat yang, pada order
 * besar, muncul sebagai selisih beberapa rupiah yang tidak bisa ditelusuri.
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

  // Satuan: rupiah x1000 (karena quantityMilli modifier berskala 1000).
  let perUnitScaled = input.unitPrice * MILLI;
  for (const m of input.modifiers) {
    assertBigint(m.price, 'modifier.price');
    assertBigint(m.quantityMilli, 'modifier.quantityMilli');
    if (m.price < 0n) {
      throw new RangeError('modifier.price tidak boleh negatif.');
    }
    if (m.quantityMilli < 0n) {
      throw new RangeError('modifier.quantityMilli tidak boleh negatif.');
    }
    perUnitScaled += m.price * m.quantityMilli;
  }

  // Satuan: rupiah x1e6. Satu-satunya titik pembulatan.
  const gross = divRoundHalfUp(perUnitScaled * input.quantityMilli, LINE_SCALE);

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
 * Total order, termasuk pembulatan tunai Indonesia.
 *
 * Pecahan di bawah Rp 100 praktis tidak beredar, jadi
 * `outlet.rounding_increment` (default `100`) membulatkan total akhir.
 * Selisihnya **dicatat** sebagai `roundingAdjustment`, bukan dihilangkan --
 * tanpa itu, laporan kas tidak akan berimbang dan tidak ada yang bisa
 * menjelaskan ke mana rupiahnya pergi.
 *
 * Invariant yang dijamin fungsi ini:
 *
 *   subtotal - orderDiscount + serviceCharge + tax + roundingAdjustment == total
 *   total % roundingIncrement == 0
 */
export function computeOrderTotals(input: OrderTotalsInput): OrderTotals {
  assertBigint(input.orderDiscount, 'orderDiscount');
  assertBigint(input.serviceChargeAmount, 'serviceChargeAmount');
  assertBigint(input.taxAmount, 'taxAmount');
  assertBigint(input.roundingIncrement, 'roundingIncrement');

  if (input.roundingIncrement <= 0n) {
    throw new RangeError('roundingIncrement harus lebih besar dari 0.');
  }

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

  const beforeRounding =
    subtotal - input.orderDiscount + input.serviceChargeAmount + input.taxAmount;
  const total =
    divRoundHalfUp(beforeRounding, input.roundingIncrement) * input.roundingIncrement;

  return {
    subtotal,
    // Diturunkan dari selisih, bukan dihitung terpisah -- dengan begitu
    // invariant keberimbangan di atas benar secara konstruksi, bukan karena
    // dua perhitungan kebetulan cocok.
    roundingAdjustment: total - beforeRounding,
    total,
  };
}
