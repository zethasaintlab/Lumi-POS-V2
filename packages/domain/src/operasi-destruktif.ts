/**
 * FR-H4 [P0] — blokir operasi destruktif saat antrean tidak kosong.
 * `spec-h:270`.
 *
 * *"Pelajaran langsung dari daftar 'jangan' milik Toast, di mana instruksi
 * manual (jangan uninstall aplikasi, jangan clear cache, jangan logout)
 * melindungi data. Lumi POS menegakkannya **secara teknis**, bukan lewat
 * dokumentasi."*
 *
 * ## ⛔ Di domain, karena AC ketiga menuntutnya
 *
 * *"Blokir ditegakkan di lapisan domain, bukan hanya menyembunyikan tombol."*
 * Tombol yang dinonaktifkan berdasarkan angka yang dibaca beberapa detik
 * sebelumnya akan meloloskan penjualan yang masuk di antara keduanya — dan
 * penjualan yang masuk di antara keduanya adalah tepat penjualan yang hilang.
 *
 * ## ⛔ Yang TIDAK diblokir, dan kenapa itu penting
 *
 * Alamat server dan kredensial perangkat **tidak pernah** diblokir. Keduanya
 * adalah jalan MEMPERBAIKI antrean yang macet: server yang pindah alamat atau
 * kredensial yang kedaluwarsa menghasilkan antrean yang tidak dapat terkuras,
 * dan memblokir perbaikannya karena antreannya tidak kosong mengunci merchant
 * di dalam keadaan itu selamanya.
 *
 * Yang diblokir adalah perubahan IDENTITAS — tenant, outlet, device — karena
 * itu yang membuat antrean lama mendarat di tempat yang salah atau ditolak
 * permanen.
 */

/** Daftar TERTUTUP. `spec-h:274`. */
export const OPERASI_DESTRUKTIF = [
  'logout',
  'resync',
  'hapus_data',
  'ganti_identitas_perangkat',
] as const;

export type OperasiDestruktif = (typeof OPERASI_DESTRUKTIF)[number];

export interface IzinOperasi {
  boleh: boolean;
  /** Kosong bila diizinkan. Selalu menyebut JUMLAH bila ditolak. */
  pesan: string;
}

/**
 * Kalimat kedua tiap pesan: apa yang harus dilakukan berikutnya.
 *
 * `spec-h:290` menuntut jalan keluarnya ditawarkan — "[Coba kirim sekarang]
 * dan [Ekspor darurat]". Keduanya ada di K-14, jadi pesannya menunjuk ke sana
 * alih-alih menggambarkan tombol yang tidak ada di layar tempat pesan ini
 * muncul.
 */
const JALAN_KELUAR =
  'Sambungkan ke internet, atau buka Status Sinkronisasi untuk mencoba kirim ulang dan ekspor darurat.';

const AKIBAT: Record<OperasiDestruktif, string> = {
  logout:
    'Transaksi ini hanya ada di perangkat ini — keluar sekarang membuat kasir berikutnya menanggungnya.',
  resync:
    'Memuat ulang data akan menghapus yang tersimpan di perangkat ini, termasuk transaksi yang belum terkirim.',
  hapus_data: 'Menghapus data aplikasi menghilangkan transaksi itu tanpa jejak di mana pun.',
  ganti_identitas_perangkat:
    'Transaksi yang antre akan dikirim atas nama outlet yang salah, atau ditolak permanen.',
};

/**
 * Boleh atau tidak, beserta alasannya.
 *
 * ⛔ Pesannya menyebut JUMLAH, bukan kalimat generik (AC kedua). Kasir yang
 * tidak tahu berapa banyak tidak dapat menilai apakah menunggu sebentar cukup
 * atau harus memanggil manajer.
 */
export function periksaOperasiDestruktif(
  operasi: OperasiDestruktif,
  { jumlahBelumTerkirim }: { jumlahBelumTerkirim: number }
): IzinOperasi {
  if (!(OPERASI_DESTRUKTIF as readonly string[]).includes(operasi)) {
    // Operasi tak dikenal DITOLAK, bukan diizinkan. Daftar yang tertutup dan
    // gagal-terbuka adalah daftar yang tidak menjaga apa pun: operasi
    // destruktif berikutnya yang lahir akan lolos tanpa ada yang menyadarinya.
    return {
      boleh: false,
      pesan: `Operasi "${String(operasi)}" tidak dikenal dan tidak diizinkan.`,
    };
  }
  if (jumlahBelumTerkirim <= 0) return { boleh: true, pesan: '' };

  return {
    boleh: false,
    pesan: `${jumlahBelumTerkirim} transaksi belum terkirim ke server. ${AKIBAT[operasi]} ${JALAN_KELUAR}`,
  };
}

/** Field identitas — perubahannya yang diblokir. */
export interface IdentitasPerangkat {
  tenantId: string;
  outletId: string;
  deviceId: string;
}

/**
 * Apakah dua konfigurasi menunjuk perangkat yang SAMA.
 *
 * ⛔ `deviceCode` sengaja TIDAK ikut. Ia hanya prefiks nomor struk dan tidak
 * menentukan ke mana antrean mendarat; memasukkannya berarti merchant yang
 * memperbaiki salah ketik "K1" → "K2" terkunci sampai antreannya kosong.
 *
 * ⛔ `baseUrl` dan `tokenSecret` juga tidak — keduanya justru jalan
 * memperbaiki antrean yang macet.
 */
export function identitasBerubah(
  lama: IdentitasPerangkat | null,
  baru: IdentitasPerangkat
): boolean {
  if (lama === null) return false;
  return (
    lama.tenantId !== baru.tenantId ||
    lama.outletId !== baru.outletId ||
    lama.deviceId !== baru.deviceId
  );
}
