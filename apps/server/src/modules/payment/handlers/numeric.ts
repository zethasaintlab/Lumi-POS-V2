/**
 * Jembatan antara `tax_rate.rate` (`numeric(6,4)` di PostgreSQL) dan
 * representasi domain (`bigint` berskala 10.000).
 *
 * ## Kenapa ini file tersendiri
 *
 * node-postgres mengembalikan `numeric` sebagai **string** (`"0.1000"`),
 * bukan `number` — justru supaya presisinya tidak hilang. `calculateTax`
 * menerima `rateScaled: bigint`. Konversi di antara keduanya adalah
 * satu-satunya titik di mana presisi bisa bocor, jadi ia berdiri sendiri dan
 * diuji sendiri, terpisah dari database.
 *
 * ## Kenapa string, padahal float TERBUKTI aman di skala ini
 *
 * Jangan percaya alasan "float akan kehilangan presisi" di sini — itu keliru,
 * dan sudah diukur. `numeric(6,4)` maksimum 99.9999, jadi nilai berskalanya
 * paling besar 999.999, jauh di bawah presisi IEEE754.
 * `Math.round(Number(s) * 10000)` diuji terhadap **seluruh 1.000.000 nilai
 * yang mungkin** dan tidak meleset satu pun (6 Agu 2026). Sabotase yang
 * mengganti baris di bawah dengan jalur float **tidak membuat satu test pun
 * merah**, karena memang tidak ada yang bisa ditangkap.
 *
 * Yang tersisa sebagai alasan, dan cukup:
 *
 * 1. **Aturannya berlaku tanpa pengecualian.** Jalur uang tidak menyentuh
 *    float. Aturan yang punya satu pengecualian "tapi di sini aman" akan
 *    punya dua, lalu tiga — dan pembaca berikutnya tidak akan menurunkan
 *    ulang argumen presisinya sebelum menyalin polanya ke kolom lain.
 * 2. **Tetap benar bila kolomnya berubah.** `numeric(12,6)` atau tarif
 *    berskala lebih besar akan mematahkan jalur float tanpa gejala; jalur
 *    string tidak peduli.
 * 3. Validasi berbasis regex di bawah lebih ketat daripada `Number()`, yang
 *    menerima `"1e-1"` dan `" 0.1"` tanpa keluhan.
 *
 * Konversinya sendiri murni operasi string dan `BigInt`: pisahkan di titik
 * desimal, lengkapi digit desimal ke 4, susun bigint-nya.
 */

/** `numeric(6,4)` — 4 digit desimal, jadi skala 10.000. */
const SCALE_DIGITS = 4;
const SCALE = 10n ** BigInt(SCALE_DIGITS);

/** Presisi 6, skala 4 -> maksimum 99.9999. */
const MAX_SCALED = 10n ** 6n - 1n;

// Bagian bulat opsional, bagian desimal opsional, tapi minimal salah satu ada.
// Sengaja ketat: tanpa spasi, tanpa tanda, tanpa notasi eksponen. Bentuk
// longgar akan meloloskan "1e-1", dan menerjemahkannya butuh float.
const DECIMAL_PATTERN = /^(\d*)(?:\.(\d+))?$/;

export function parseRateToScaled(value: unknown): bigint {
  if (typeof value !== 'string') {
    // JSON.parse menghasilkan `number` untuk `0.1`. Menerimanya diam-diam
    // akan membatalkan seluruh alasan modul ini ada.
    throw new TypeError(`Tarif harus dikirim sebagai string desimal, bukan ${typeof value}.`);
  }

  const match = DECIMAL_PATTERN.exec(value);
  if (match === null || (match[1] === '' && match[2] === undefined)) {
    throw new RangeError(`Tarif "${value}" bukan bilangan desimal yang sah.`);
  }

  const whole = match[1] === '' ? '0' : match[1];
  const fraction = match[2] ?? '';

  if (fraction.length > SCALE_DIGITS) {
    // Membulatkan di sini akan membuat nilai yang dikirim klien berbeda dari
    // yang tersimpan, tanpa ada yang tahu. Lebih baik menolak.
    throw new RangeError(
      `Tarif "${value}" punya lebih dari ${SCALE_DIGITS} digit desimal; numeric(6,4) tidak menyimpannya.`
    );
  }

  const padded = fraction.padEnd(SCALE_DIGITS, '0');
  const scaled = BigInt(whole) * SCALE + BigInt(padded);

  if (scaled > MAX_SCALED) {
    throw new RangeError(`Tarif "${value}" di luar jangkauan numeric(6,4) (maksimum 99.9999).`);
  }
  return scaled;
}

export function formatScaledRate(scaled: bigint): string {
  if (typeof scaled !== 'bigint') {
    throw new TypeError(`formatScaledRate menerima bigint, bukan ${typeof scaled}.`);
  }
  if (scaled < 0n) {
    throw new RangeError('Tarif tidak boleh negatif.');
  }
  const whole = scaled / SCALE;
  const fraction = (scaled % SCALE).toString().padStart(SCALE_DIGITS, '0');
  return `${whole}.${fraction}`;
}
