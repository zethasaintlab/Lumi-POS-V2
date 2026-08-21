/**
 * `TaxCalculator` — satu-satunya sumber logika pajak (FR-C11).
 *
 * `CLAUDE.md` invariant #7: **tidak ada angka pajak di luar `TaxCalculator`.**
 * Kemunculan `0.11`, `* 0.1`, atau `10%` di jalur perhitungan mana pun adalah
 * cacat arsitektur, bukan preferensi gaya.
 *
 * ## Kenapa murni, dan kenapa di packages/domain
 *
 * `ARCH:106` menyebut klien menghitung total lewat "TaxCalculator versi
 * klien" saat offline. Kalau logika pajak hanya hidup di server, angka di
 * layar kasir dan angka yang tersimpan bisa berbeda — dan yang tercetak di
 * struk adalah yang dilihat, dibayar, dan dipersoalkan pelanggan.
 *
 * Modul ini tidak melakukan I/O. Penyaringan waktu (`effective_from` /
 * `effective_to`) tetap di SQL karena di sanalah index-nya; resolusi
 * spesifisitas ada di sini karena klien offline harus menerapkannya sama
 * persis.
 *
 * ## Tarif tidak pernah float
 *
 * `tax_rate.rate` adalah `numeric(6,4)`. Di sini ia `bigint` berskala 10.000:
 * 10% → `1000n`, 11% → `1100n`. Memakai `0.1` sebagai `number` akan menyeret
 * floating point ke jalur uang lewat pintu belakang — kelas kesalahan yang
 * sama dengan menyimpan rupiah sebagai `REAL`.
 */

import { allocateProportionally } from './alokasi.ts';
import { SKALA_TARIF } from './numeric.ts';

// Satu sumber untuk skala tarif — lihat `SKALA_TARIF` di `numeric.ts`.
const RATE_SCALE = SKALA_TARIF;

export type TaxChannel = 'all' | 'dine_in' | 'takeaway';
export type TaxAppliesTo = 'all_items' | 'category' | 'item';

export interface TaxRateSpec {
  id: string;
  name: string;
  /** `numeric(6,4)` x 10.000. 10% = `1000n`. */
  rateScaled: bigint;
  isInclusive: boolean;
  /**
   * Yurisdiksi yang memungut tarif ini — kabupaten/kota untuk PBJT, pusat
   * untuk PPN. `null` bila tidak tercatat.
   *
   * ⛔ Ia ikut ke sini, bukan diresolusi pemanggil lewat `id`, dengan alasan
   * yang sama persis dengan `name`: AC FR-C13 pertama menuntut rekapitulasi
   * memisahkan pajak **per jenis DAN per yurisdiksi**, dan yurisdiksi yang
   * diresolusi saat laporan dibuat akan berubah bila tarifnya dipindah —
   * membuat dua ekspor untuk periode yang sama berbeda tanpa satu pun
   * transaksi berubah.
   *
   * ⛔ TIDAK ikut menentukan tarif mana yang menang di `resolveRateForLine`.
   * Yurisdiksi adalah label pelaporan; yang memilih tarif adalah outlet,
   * channel, dan spesifisitas.
   */
  jurisdiction: string | null;
  /** `null` = berlaku untuk seluruh tenant. */
  outletId: string | null;
  channel: TaxChannel;
  appliesTo: TaxAppliesTo;
  appliesToIds: ReadonlyArray<string>;
}

export interface TaxableLine {
  lineId: string;
  itemId: string;
  categoryId: string | null;
  /** `line_total` — sesudah diskon baris, sebelum diskon order. */
  amount: bigint;
}

export interface TaxCalculationInput {
  lines: ReadonlyArray<TaxableLine>;
  serviceChargeAmount: bigint;
  orderDiscount: bigint;
  taxRates: ReadonlyArray<TaxRateSpec>;
  channel: Exclude<TaxChannel, 'all'>;
  outletId: string;
}

export interface TaxBreakdownLine {
  taxRateId: string;
  name: string;
  rateScaled: bigint;
  base: bigint;
  amount: bigint;
  isInclusive: boolean;
}

/**
 * Snapshot pajak untuk satu `order_line` (FR-B3).
 *
 * `TaxBreakdownLine` dikelompokkan per TARIF karena itu yang dicetak di
 * struk. `order_line` menyimpan per BARIS supaya struk lama kebal perubahan
 * tarif. Keduanya dibutuhkan, dan keduanya harus berasal dari sini —
 * menghitung pajak per baris di handler melanggar invariant #7.
 */
export interface TaxPerLine {
  lineId: string;
  taxRateId: string;
  /**
   * Nama tarif, ikut sebagai SNAPSHOT.
   *
   * ⛔ Ada di sini, bukan diresolusi pemanggil lewat `taxRateId`. Struk yang
   * dicetak ulang tidak boleh menyentuh tabel katalog (`spec-b:145`), jadi
   * namanya harus tersimpan di `order_line` sejak penjualan ditulis — dan
   * satu-satunya tempat yang tahu namanya saat itu adalah hasil perhitungan
   * ini.
   */
  name: string;
  /** Yurisdiksi, ikut sebagai SNAPSHOT. FR-C13 — lihat `TaxRateSpec`. */
  jurisdiction: string | null;
  rateScaled: bigint;
  amount: bigint;
  isInclusive: boolean;
}

export interface TaxBreakdown {
  lines: TaxBreakdownLine[];
  /**
   * Snapshot per `order_line`. Baris yang tidak kena tarif apa pun **tidak**
   * muncul di sini.
   *
   * `SUM(perLine.amount)` untuk satu tarif sama persis dengan `amount` tarif
   * itu — dijamin lewat alokasi, bukan lewat penjumlahan pembulatan terpisah.
   */
  perLine: TaxPerLine[];
  /** Seluruh pajak, inklusif maupun eksklusif — untuk dicetak di struk. */
  totalTax: bigint;
  /**
   * Hanya bagian yang MENAMBAH total (FR-C8 langkah 12). Pajak inklusif sudah
   * ada di dalam harga, jadi ia tidak muncul di sini. Memakai `totalTax`
   * sebagai `order.tax_amount` akan menggandakan pajak inklusif.
   */
  totalTaxExclusive: bigint;
}

function assertBigint(value: unknown, nama: string): asserts value is bigint {
  if (typeof value !== 'bigint') {
    throw new TypeError(`${nama} harus bigint, bukan ${typeof value}. Tarif pajak tidak pernah float.`);
  }
}

function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}

const SPECIFICITY: Record<TaxAppliesTo, number> = {
  item: 3,
  category: 2,
  all_items: 1,
};

function matchesLine(rate: TaxRateSpec, line: TaxableLine): boolean {
  if (rate.appliesTo === 'all_items') return true;
  if (rate.appliesTo === 'item') return rate.appliesToIds.includes(line.itemId);
  return line.categoryId !== null && rate.appliesToIds.includes(line.categoryId);
}

/**
 * Tarif mana yang berlaku untuk satu baris.
 *
 * Urutan menang, dari `spec-c-pembayaran-pajak.md:52` dan FR-C7:
 *   1. `item` > `category` > `all_items`
 *   2. seri → `outlet_id` terisi menang atas `null`
 *   3. seri → channel spesifik menang atas `all`
 *
 * Tarif milik outlet LAIN disaring keluar lebih dulu — bukan diberi skor
 * rendah. Memberinya skor rendah berarti ia bisa menang saat tidak ada
 * kandidat lain, dan itu pajak outlet lain yang dikenakan ke penjualan sini.
 */
function resolveRateForLine(
  rates: ReadonlyArray<TaxRateSpec>,
  line: TaxableLine,
  channel: string,
  outletId: string
): TaxRateSpec | null {
  let winner: TaxRateSpec | null = null;
  let winnerScore = -1;

  for (const rate of rates) {
    if (rate.outletId !== null && rate.outletId !== outletId) continue;
    if (rate.channel !== 'all' && rate.channel !== channel) continue;
    if (!matchesLine(rate, line)) continue;

    // Skor gabungan: spesifisitas dominan, lalu outlet, lalu channel.
    const score =
      SPECIFICITY[rate.appliesTo] * 100 +
      (rate.outletId !== null ? 10 : 0) +
      (rate.channel !== 'all' ? 1 : 0);

    if (score > winnerScore) {
      winner = rate;
      winnerScore = score;
    }
  }
  return winner;
}

export function calculateTax(input: TaxCalculationInput): TaxBreakdown {
  assertBigint(input.serviceChargeAmount, 'serviceChargeAmount');
  assertBigint(input.orderDiscount, 'orderDiscount');
  for (const rate of input.taxRates) {
    assertBigint(rate.rateScaled, `taxRate[${rate.id}].rateScaled`);
    if (rate.rateScaled < 0n) {
      throw new RangeError(`Tarif pajak ${rate.id} tidak boleh negatif.`);
    }
  }

  const amounts = input.lines.map((l) => {
    assertBigint(l.amount, `line[${l.lineId}].amount`);
    return l.amount;
  });

  // Diskon order dan service charge dialokasikan proporsional ke baris, lalu
  // baris dikelompokkan per tarif. Urutan ini penting: mengalokasikan per
  // TARIF akan salah ketika satu tarif melayani beberapa baris dengan bobot
  // berbeda.
  const discountPerLine = allocateProportionally(input.orderDiscount, amounts);
  const servicePerLine = allocateProportionally(input.serviceChargeAmount, amounts);

  // Map dipakai supaya urutan baris breakdown mengikuti urutan tarif pertama
  // kali muncul — stabil antar run, bukan bergantung iterasi objek.
  //
  // `members` menyimpan baris mana saja yang menyumbang ke tiap tarif, beserta
  // dasarnya masing-masing. Dibutuhkan untuk membagi kembali pajak per tarif
  // ke `perLine` di bawah.
  const perRate = new Map<
    string,
    { rate: TaxRateSpec; base: bigint; members: { lineId: string; base: bigint }[] }
  >();

  for (let i = 0; i < input.lines.length; i++) {
    const line = input.lines[i];
    const rate = resolveRateForLine(input.taxRates, line, input.channel, input.outletId);
    if (rate === null) continue; // Tidak ada tarif cocok -> baris ini tidak kena pajak.

    const base = line.amount - discountPerLine[i] + servicePerLine[i];
    const existing = perRate.get(rate.id);
    if (existing === undefined) {
      perRate.set(rate.id, { rate, base, members: [{ lineId: line.lineId, base }] });
    } else {
      existing.base += base;
      existing.members.push({ lineId: line.lineId, base });
    }
  }

  const lines: TaxBreakdownLine[] = [];
  const perLine: TaxPerLine[] = [];
  let totalTax = 0n;
  let totalTaxExclusive = 0n;

  for (const { rate, base, members } of perRate.values()) {
    // FR-C8 langkah 11 / 11':
    //   eksklusif : tax = base x rate
    //   inklusif  : tax = base - (base / (1 + rate))
    const amount = rate.isInclusive
      ? base - divRoundHalfUp(base * RATE_SCALE, RATE_SCALE + rate.rateScaled)
      : divRoundHalfUp(base * rate.rateScaled, RATE_SCALE);

    lines.push({
      taxRateId: rate.id,
      name: rate.name,
      rateScaled: rate.rateScaled,
      base,
      amount,
      isInclusive: rate.isInclusive,
    });

    // Pajak per baris DIALOKASIKAN dari `amount` yang sudah dihitung atas
    // dasar agregat -- bukan dihitung ulang per baris lalu dijumlahkan.
    // Bedanya menentukan: menghitung tiap baris sendiri-sendiri bisa meleset
    // satu-dua rupiah dari pajak yang tercetak di struk, dan struk yang tidak
    // berjumlah adalah persis yang spec-c:126 peringatkan akan ditemukan
    // merchant. allocateProportionally menjamin SUM(perLine) === amount.
    const bagian = allocateProportionally(amount, members.map((m) => m.base));
    for (let i = 0; i < members.length; i++) {
      perLine.push({
        lineId: members[i].lineId,
        taxRateId: rate.id,
        name: rate.name,
        jurisdiction: rate.jurisdiction,
        rateScaled: rate.rateScaled,
        amount: bagian[i],
        isInclusive: rate.isInclusive,
      });
    }

    totalTax += amount;
    if (!rate.isInclusive) {
      totalTaxExclusive += amount;
    }
  }

  return { lines, perLine, totalTax, totalTaxExclusive };
}
