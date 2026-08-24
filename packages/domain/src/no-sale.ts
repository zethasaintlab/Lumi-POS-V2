/**
 * FR-D7 — no-sale: membuka laci tanpa transaksi.
 *
 * `spec-d:229`: *"Membuka laci tanpa transaksi adalah pola fraud kasir paling
 * dasar."* Yang dibangun karena itu bukan tombolnya — tombolnya sepele — tapi
 * **kontrolnya**: alasan dari daftar tertutup, ambang frekuensi per shift, dan
 * jejak audit untuk setiap pembukaan.
 *
 * ## ⛔ Batasan yang WAJIB dinyatakan ke merchant, bukan disembunyikan
 *
 * `spec-d:231`: sinyal ke laci bersifat **satu arah**. Sistem tidak dapat
 * mengetahui apakah laci benar-benar terbuka, dan **tidak dapat mendeteksi
 * laci yang dibuka manual dengan kunci**.
 *
 * Konsekuensinya untuk kode ini: yang dicatat adalah *"sistem memerintahkan
 * laci terbuka"*, bukan *"laci terbuka"*. AC FR-D7 ketiga menulisnya persis
 * begitu — "setiap pembukaan laci **yang diperintahkan sistem**". Menamai
 * event-nya seolah ia bukti pembukaan fisik akan membuat merchant
 * menyimpulkan selisih kas dari laporan yang tidak dapat melihat separuh
 * pembukaan.
 *
 * ## Murni
 *
 * Tanpa I/O. Ambangnya dibagi klien dan server: perangkat harus dapat
 * memutuskan "PIN diminta atau tidak" saat offline, dan server harus
 * memutuskan hal yang sama saat antrean terkuras.
 */

export const EVENT_NO_SALE = 'cash_drawer_opened';

/**
 * Alasan no-sale — daftar TERTUTUP.
 *
 * Free text tidak dapat diagregasi menjadi laporan fraud, dan itu seluruh
 * gunanya (`spec-f:378`). Daftar ini tidak berpotongan dengan alasan void
 * atau refund: yang dijelaskan bukan pembatalan transaksi melainkan kenapa
 * laci dibuka tanpa penjualan.
 */
export const ALASAN_NO_SALE = [
  'tukar_uang',
  'ambil_kembalian_tertinggal',
  'setor_ke_brankas',
  'periksa_laci',
  'lainnya',
] as const;

export type AlasanNoSale = (typeof ALASAN_NO_SALE)[number];

export function adalahAlasanNoSale(nilai: unknown): nilai is AlasanNoSale {
  return typeof nilai === 'string' && (ALASAN_NO_SALE as readonly string[]).includes(nilai);
}

/**
 * Ambang frekuensi: pembukaan **ke berapa** dalam satu shift yang mulai
 * menuntut PIN manajer.
 *
 * Keputusan produk 1 Agustus 2026 (`CLAUDE.md`): *"no-sale wajib alasan, PIN
 * di atas 3×/shift"*, dan AC FR-D7 kedua menyebut bawaannya 3× per shift.
 * Angkanya `[ASUMSI]` — belum divalidasi ke merchant.
 *
 * ⛔ Pembukaan **keempat dan seterusnya** yang menuntut PIN, bukan yang
 * ketiga. `spec-d:239` menulis *"bila ini pembukaan ke-4 dalam shift"*, dan
 * ambang yang bergeser satu membuat kasir dimintai PIN pada pembukaan yang
 * merchant janjikan bebas.
 */
export const AMBANG_NO_SALE = 3;

/**
 * Apakah pembukaan berikutnya menuntut PIN manajer.
 *
 * @param sudah Berapa kali laci sudah dibuka lewat no-sale dalam shift INI.
 */
export function butuhPenyetujuNoSale(sudah: number, ambang: number = AMBANG_NO_SALE): boolean {
  // `>=` karena `sudah` adalah hitungan SEBELUM pembukaan ini: sudah 3 kali
  // berarti yang sekarang adalah yang ke-4.
  return sudah >= ambang;
}

export interface RencanaNoSale {
  butuhPenyetuju: boolean;
  /** Pembukaan ke berapa dalam shift ini — untuk ditampilkan ke kasir. */
  urutan: number;
  /**
   * Ambang yang BERLAKU, untuk disebutkan ke kasir.
   *
   * ⛔ Ikut di sini alih-alih dibaca ulang komponen dari konstanta bawaan.
   * Sejak B-26 merchant dapat menyetelnya per outlet, dan kalimat yang
   * menyebut "3×" pada outlet berambang 6 memberi tahu kasir aturan yang tidak
   * berlaku baginya — kasir yang aturannya salah disebutkan berhenti
   * mempercayai kalimat berikutnya.
   */
  ambang: number;
}

/**
 * ⛔ Urutan ikut dikembalikan supaya layar dapat MENYEBUTNYA. Kasir yang
 * tiba-tiba dimintai PIN tanpa penjelasan akan menyimpulkan aplikasinya
 * rusak; kasir yang membaca "pembukaan ke-4 dalam shift ini" tahu persis
 * kenapa.
 */
export function rencanaNoSale(sudah: number, ambang: number = AMBANG_NO_SALE): RencanaNoSale {
  return { butuhPenyetuju: butuhPenyetujuNoSale(sudah, ambang), urutan: sudah + 1, ambang };
}
