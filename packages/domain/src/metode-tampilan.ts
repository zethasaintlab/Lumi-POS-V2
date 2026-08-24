/**
 * Nama metode dan status pembayaran DI LAYAR — satu peta untuk setiap aplikasi
 * yang menampilkannya kepada merchant.
 *
 * Pindah dari `apps/backoffice/src/penjualan/b03.ts` pada 24 Agustus 2026,
 * saat `apps/hp` (Owner mobile, M-01) menjadi permukaan KEDUA yang merinci
 * pembayaran per metode. Dua peta yang menyimpang menghasilkan ringkasan HP
 * yang menyebut saluran berbeda dari laporan back-office untuk hari yang sama,
 * dan owner tidak punya cara memutuskan mana yang benar.
 *
 * ⛔ `apps/kasir/src/cetak/metode.ts` SENGAJA tetap terpisah, dan itu bukan
 * duplikasi yang terlewat: nama di struk dipilih pendek karena struk 58 mm
 * hanya 32 kolom dan nama metode berbagi baris dengan nominalnya. "QRIS
 * (dinamis)" tidak muat di sana. Batasnya dinyatakan di kedua berkas.
 *
 * Murni: tanpa I/O.
 */

/** Metode pembayaran, dalam kata yang merchant pakai. */
export const LABEL_METODE: Record<string, string> = {
  cash: 'Tunai',
  qris_dynamic: 'QRIS (dinamis)',
  qris_static: 'QRIS (statis)',
  card_edc: 'Kartu / EDC',
  other: 'Lainnya',
};

/**
 * Status pembayaran.
 *
 * ⛔ `pending_confirmation` TIDAK disebut "gagal" maupun "lunas". Ia keadaan
 * ketiga yang nyata: QRIS yang QR-nya sudah diminta tapi gateway belum
 * menjawab, sementara pelanggan mungkin sudah membayar (FR-C14).
 */
export const LABEL_STATUS_BAYAR: Record<string, string> = {
  confirmed: 'Terkonfirmasi',
  pending_confirmation: 'Menunggu konfirmasi',
  failed: 'Gagal',
  voided: 'Dibatalkan',
};

export function labelMetode(kode: string): string {
  return LABEL_METODE[kode] ?? kode;
}

export function labelStatusBayar(kode: string): string {
  return LABEL_STATUS_BAYAR[kode] ?? kode;
}
