import type { HasilPenjualan } from './penjualan.ts';

/**
 * Kalimat galat K-06 untuk hasil `simpanPenjualan` yang BUKAN `tersimpan`.
 *
 * ⛔ Satu fungsi, tanpa `default` yang menjawab "Keranjang kosong.": status yang
 * belum punya cabang (dulu `data_pesanan_tidak_sah`) melaporkan keranjang berisi
 * sebagai kosong — DS #7 menuntut galat yang benar. Pesan domain dipakai kata
 * demi kata (`pembayaran-manual.ts`, `data-pesanan.ts`), tidak ditulis ulang.
 */
export function pesanPenjualanGagal(
  hasil: Exclude<HasilPenjualan, { status: 'tersimpan' }>,
  /** Pemformat rupiah tunggal (`uang-tampilan.ts`) disuntik pemanggil: tidak ada pemformat/pengimpor baru. */
  rupiah: (n: bigint) => string
): string {
  switch (hasil.status) {
    case 'keranjang_kosong':
      return 'Keranjang kosong.';
    case 'kurang_bayar':
      // Tombol sudah nonaktif untuk tunai kurang; jalur cadangan, TANPA angka kurang (satu sumber: rencana).
      return 'Uang diterima kurang dari tagihan tunai. Penjualan belum tersimpan.';
    case 'pembayaran_tidak_sah':
      return `${hasil.pesan} Penjualan belum tersimpan.`;
    case 'data_pesanan_tidak_sah':
      return `${hasil.pesan} Penjualan belum tersimpan — perbaiki di kasir (Catatan, Pelanggan, atau No. Meja).`;
    case 'butuh_penyetuju_diskon':
      return (
        `Diskon ${rupiah(hasil.nominal)} melewati batas dan belum disetujui manajer. ` +
        'Penjualan belum tersimpan — kembali ke kasir untuk meminta persetujuan.'
      );
    default:
      return 'Penjualan belum tersimpan. Status tidak dikenali; hubungi dukungan.';
  }
}
