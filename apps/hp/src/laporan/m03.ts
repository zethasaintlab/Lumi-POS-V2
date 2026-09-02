/**
 * M-03 — Laporan ringkas untuk HP.
 *
 * `IA:248` menyebutnya *"subset dari back-office"*, dan kata **subset** itulah
 * kontraknya: yang tampil di sini harus ADA di back-office dan berarti hal
 * yang sama. Layar HP yang menghitung sendiri menjadi tempat kedua yang
 * memutuskan omzet.
 *
 * ## ⛔ Yang TIDAK dibangun, dan kenapa
 *
 * Back-office punya enam layar laporan (B-16…B-21, `IA:195-200`). Menyalin semuanya ke
 * 390px menghasilkan tabel yang tidak dapat dibaca dan navigasi yang `IA:229`
 * justru menolak. Yang dipilih: **omzet per rentang**, angka yang sama dengan
 * B-16, dengan tiga rentang siap pakai. Ekspor, saringan, dan rincian per
 * produk tetap di laptop.
 *
 * ## ⛔ Rentang dihitung dari tanggal yang SERVER berikan
 *
 * Bukan dari `new Date()` di HP. Alasannya sama dengan M-01: jam HP dapat
 * salah, dan rentang yang bergeser satu hari menghasilkan angka yang tidak
 * pernah cocok dengan laporan mana pun. `dasar` di sini adalah `tanggal` dari
 * respons `GET /reports/daily-summary`.
 */

export interface PilihanRentang {
  id: '7h' | '30h' | 'bulan-ini';
  label: string;
  /** Berapa hari ke belakang, termasuk hari dasar. `null` = awal bulan. */
  hari: number | null;
}

export const RENTANG: PilihanRentang[] = [
  { id: '7h', label: '7 hari', hari: 7 },
  { id: '30h', label: '30 hari', hari: 30 },
  { id: 'bulan-ini', label: 'Bulan ini', hari: null },
];

/**
 * `from`/`to` untuk sebuah pilihan.
 *
 * ⛔ Aritmetika tanggal di UTC apa adanya, dan itu aman karena masukannya
 * **tanggal bisnis** — string yang sudah diturunkan dari zona outlet dan jam
 * tutupnya. Menghitung ulang zona di sini akan menjadi tempat kedua yang
 * memutuskan hari apa sebuah penjualan terjadi. Aturan yang sama dengan
 * `tanggalPembanding` di `packages/domain/src/tren-harian.ts`.
 */
export function rentangDari(dasar: string, pilihan: PilihanRentang): { from: string; to: string } {
  const d = new Date(`${dasar}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new TypeError(`Tanggal dasar tidak sah: ${dasar}`);

  if (pilihan.hari === null) {
    // Awal bulan kalender yang memuat tanggal dasar.
    const awal = `${dasar.slice(0, 7)}-01`;
    return { from: awal, to: dasar };
  }

  // ⛔ `hari - 1`, bukan `hari`. "7 hari" yang memuat delapan tanggal
  // menghasilkan rata-rata harian yang selalu sedikit terlalu rendah, dan
  // salahnya tidak pernah cukup besar untuk terlihat.
  const mulai = new Date(d.getTime() - (pilihan.hari - 1) * 86_400_000);
  return { from: mulai.toISOString().slice(0, 10), to: dasar };
}

export type KeadaanLaporan = 'memuat' | 'siap' | 'gagal' | 'tidak-berhak';

/**
 * ⛔ SATU fungsi untuk ketiga keadaan bukan-siap, aturan yang sama dengan
 * M-01 dan M-02. "Gagal memuat" yang terbaca seperti "tidak ada penjualan"
 * adalah kesimpulan yang paling mudah diambil dari layar laporan yang kosong.
 */
export function pesanLaporan(keadaan: KeadaanLaporan): string | null {
  switch (keadaan) {
    case 'memuat':
      return 'Mengambil laporan…';
    case 'gagal':
      return 'Laporan tidak dapat dimuat. Ini BUKAN berarti tidak ada penjualan pada periode ini — coba lagi sebelum menyimpulkan apa pun.';
    case 'tidak-berhak':
      return 'Akun Anda tidak berhak melihat laporan penjualan.';
    default:
      return null;
  }
}

/** Rentang sebagai kalimat, supaya angka di layar tidak pernah tanpa periodenya. */
export function periodeTampil(from: string, to: string): string {
  return from === to ? from : `${from} sampai ${to}`;
}
