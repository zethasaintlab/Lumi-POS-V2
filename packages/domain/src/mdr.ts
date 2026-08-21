/**
 * FR-C12 — perkiraan MDR (*Merchant Discount Rate*) untuk rekonsiliasi.
 *
 * `spec-c:422`: *"MDR dipotong di sisi settlement, sehingga yang masuk
 * rekening merchant lebih kecil dari nilai transaksi. Tanpa ditampilkan,
 * merchant mengira ada uang hilang."*
 *
 * Itu masalah yang persis: kasir mencatat QRIS Rp 100.000, rekening menerima
 * Rp 99.300, dan tanpa satu baris pun yang menjelaskan selisihnya merchant
 * menyimpulkan POS-nya salah — atau kasirnya mencuri.
 *
 * ## ⛔ Ini BUKAN pajak, dan tidak boleh diperlakukan seperti pajak
 *
 * Invariant #7 melarang angka tarif pajak di luar `TaxCalculator`. MDR bukan
 * pajak: ia biaya jasa akuisisi yang dipotong penyelenggara, tidak masuk
 * `order.tax_amount`, tidak muncul di struk, dan tidak mengubah satu pun
 * angka di `order`. Ia hidup di sini justru supaya tidak pernah tersesat ke
 * `tax.ts` dan ikut terhitung sebagai pajak.
 *
 * ## ⛔ PERKIRAAN, dan kata itu wajib ikut sampai ke layar
 *
 * AC FR-C12 kedua: *"Angka settlement ditandai sebagai perkiraan, bukan nilai
 * final."* Yang menentukan potongan sebenarnya adalah penyelenggara, per
 * settlement, dan angkanya dapat berbeda karena promo, kategori yang
 * diperbarui, atau aturan yang berubah. Angka di sini menjelaskan selisih —
 * ia tidak pernah menjadi dasar penagihan.
 *
 * ## Skala
 *
 * Tarif disimpan sebagai `bigint` berskala 10.000, konvensi yang sama dengan
 * `tax_rate.rate` (`numeric.ts`): 0,3% → `30n`, 0,7% → `70n`. Bukan karena
 * presisi float bermasalah di skala ini — ia tidak — melainkan supaya aturan
 * "jalur uang tidak menyentuh float" tidak punya pengecualian yang akan
 * disalin ke tempat lain. Alasan lengkapnya di `numeric.ts`.
 */

/** Skala tarif: sama dengan `numeric(6,4)` di `tax_rate.rate`. */
const SKALA = 10_000n;

/**
 * Kategori merchant menurut penggolongan penyelenggara QRIS.
 *
 * UMI usaha mikro, UKE kecil, UME menengah, UBE besar. Yang membedakannya di
 * sini hanya tarif; penggolongannya sendiri ditetapkan penyelenggara saat
 * merchant didaftarkan, bukan oleh POS.
 */
export const KATEGORI_MERCHANT = ['umi', 'uke', 'ume', 'ube'] as const;
export type KategoriMerchant = (typeof KATEGORI_MERCHANT)[number];

export function adalahKategoriMerchant(nilai: unknown): nilai is KategoriMerchant {
  return typeof nilai === 'string' && (KATEGORI_MERCHANT as readonly string[]).includes(nilai);
}

/**
 * Batas transaksi UMI bebas potongan.
 *
 * `[FAKTA]` per 15 Maret 2025 menurut `spec-c:424`, dan **dapat berubah** —
 * ia ditetapkan regulator, bukan oleh kami. Kalau berubah, satu-satunya
 * tempat yang perlu disunting adalah berkas ini.
 */
export const AMBANG_UMI = 500_000n;

/** Tarif berskala 10.000. `spec-c:426`. */
const TARIF_UMI_DI_BAWAH_AMBANG = 0n;
const TARIF_UMI_DI_ATAS_AMBANG = 30n;
const TARIF_SELAIN_UMI = 70n;

/**
 * Metode pembayaran yang punya perkiraan MDR.
 *
 * ⛔ `card_edc` TIDAK termasuk, dan itu batas yang dinyatakan. MDR kartu
 * ditetapkan per-acquirer dan per-jenis kartu (debit domestik, kredit, kartu
 * terbitan luar negeri) — `spec-c` tidak memberikan satu pun angkanya. Menebak
 * satu tarif untuk semuanya menghasilkan perkiraan yang salah dengan
 * percaya diri, dan angka yang salah lebih buruk daripada kolom kosong pada
 * laporan yang gunanya justru menjelaskan selisih.
 *
 * `cash` jelas tidak punya potongan. `other` tidak diketahui apa-apanya.
 */
const METODE_BER_MDR = new Set(['qris_dynamic', 'qris_static']);

export function metodePunyaPerkiraanMdr(method: string): boolean {
  return METODE_BER_MDR.has(method);
}

/** Tarif berskala 10.000 untuk satu transaksi, atau `null` bila tak berlaku. */
export function tarifMdrBerskala(
  kategori: KategoriMerchant,
  method: string,
  amount: bigint
): bigint | null {
  if (!metodePunyaPerkiraanMdr(method)) return null;
  if (kategori !== 'umi') return TARIF_SELAIN_UMI;
  // ⛔ `<=`, bukan `<`. `spec-c:427` menulis "≤ Rp 500.000" — transaksi tepat
  // sebesar ambang masih bebas potongan.
  return amount <= AMBANG_UMI ? TARIF_UMI_DI_BAWAH_AMBANG : TARIF_UMI_DI_ATAS_AMBANG;
}

/**
 * Perkiraan potongan dalam rupiah utuh, atau `null` bila metodenya tidak punya
 * perkiraan.
 *
 * ⛔ `null` dan `0n` adalah dua hal BERBEDA, dan membedakannya penting:
 * `0n` berarti "diperkirakan tidak ada potongan" (UMI di bawah ambang);
 * `null` berarti "tidak ada perkiraan untuk metode ini". Laporan menampilkan
 * yang pertama sebagai nol dan yang kedua sebagai tanda hubung — merchant yang
 * melihat "Rp 0" untuk kartu EDC akan menyimpulkan kartu tidak dipotong.
 *
 * Pembulatan **ke bawah** (pembagian bigint memotong). Perkiraan yang lebih
 * kecil daripada potongan sebenarnya membuat settlement datang sedikit di
 * bawah perkiraan; perkiraan yang lebih besar membuatnya datang di atas, dan
 * merchant yang menerima LEBIH dari perkiraan tidak pernah menelepon support.
 * Selisihnya paling banyak satu rupiah.
 */
export function perkiraanMdr(input: {
  kategori: KategoriMerchant;
  method: string;
  amount: bigint;
}): bigint | null {
  const tarif = tarifMdrBerskala(input.kategori, input.method, input.amount);
  if (tarif === null) return null;
  if (input.amount <= 0n) return 0n;
  return (input.amount * tarif) / SKALA;
}

/**
 * Perkiraan yang masuk rekening: nilai transaksi dikurangi potongan.
 *
 * Metode tanpa perkiraan MDR mengembalikan nilai transaksinya apa adanya —
 * bukan `null`. Yang tidak diketahui adalah potongannya, bukan uangnya.
 */
export function perkiraanSettlement(input: {
  kategori: KategoriMerchant;
  method: string;
  amount: bigint;
}): bigint {
  return input.amount - (perkiraanMdr(input) ?? 0n);
}
