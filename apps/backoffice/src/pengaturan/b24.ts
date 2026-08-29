/**
 * B-24 — aturan tampilan Profil Vertikal (`IA:203`, Owner). OQ-09.
 *
 * Murni: data masuk → kalimat keluar. Tanpa DOM, tanpa jaringan.
 *
 * ## ⛔ Tiga keadaan outlet yang tampak sama dan berarti berbeda
 *
 * Sebuah outlet dapat: (a) memilih profilnya sendiri, (b) mengikuti bawaan
 * tenant, atau (c) mengikuti **bawaan keras domain** karena tenantnya belum
 * punya profil bawaan sama sekali. Ketiganya menghasilkan satu baris tabel
 * yang menampilkan aturan yang sama; hanya yang ketiga adalah aturan yang
 * **tidak dipilih siapa pun**.
 *
 * Menyamakan (b) dan (c) membuat merchant mengira pusat sudah menetapkan
 * sesuatu. Menyamakan (a) dan (b) membuat perubahan bawaan tenant terlihat
 * seperti tidak berpengaruh — sampai suatu hari ia berpengaruh pada cabang
 * yang tidak diperkirakan.
 */

export const JUDUL_LAYAR = 'Profil Vertikal';

export interface ProfilVertikal {
  id: string;
  name: string;
  allowNegativeStock: boolean;
  isTenantDefault: boolean;
}

export interface OutletProfil {
  id: string;
  name: string;
  /** `null` berarti mengikuti bawaan tenant. */
  verticalProfileId: string | null;
  berlaku: ProfilVertikal & { dariBawaan: boolean };
}

export type AsalProfil = 'sendiri' | 'bawaan_tenant' | 'bawaan_sistem';

export function asalProfil(o: OutletProfil): AsalProfil {
  if (o.berlaku.dariBawaan) return 'bawaan_sistem';
  return o.verticalProfileId === null ? 'bawaan_tenant' : 'sendiri';
}

const LABEL_ASAL: Record<AsalProfil, string> = {
  sendiri: 'Profil sendiri',
  bawaan_tenant: 'Mengikuti bawaan tenant',
  // ⛔ Kalimatnya menyatakan bahwa TIDAK ADA yang memilihnya. "Bawaan"
  // saja terbaca seperti keputusan pusat; ini bukan keputusan siapa pun.
  bawaan_sistem: 'Belum diatur — memakai aturan bawaan sistem',
};

export function labelAsal(asal: AsalProfil): string {
  return LABEL_ASAL[asal];
}

/**
 * Kalimat untuk `allow_negative_stock`.
 *
 * ⛔ Menyebut AKIBATNYA, bukan nama kolomnya. Yang membaca layar ini adalah
 * owner kafe, dan "izinkan stok negatif" tidak memberi tahu apa yang akan
 * berbeda di tablet kasirnya besok pagi.
 *
 * ⛔ Dan menyebut kedua arah. `spec-e:146` memilih "boleh negatif" dengan
 * alasan yang dinyatakan: melarang penjualan karena sistem MENGIRA stok habis
 * menghentikan penjualan nyata, dan kasir akan mencari jalan pintas —
 * memindahkan masalah ke tempat yang tidak terlihat sistem.
 */
export function kalimatStokNegatif(boleh: boolean): string {
  return boleh
    ? 'Kasir tetap dapat menjual saat stok tercatat habis. Penjualannya ditandai untuk ' +
        'diperiksa, bukan ditolak.'
    : 'Kasir tidak dapat menjual melebihi stok tercatat. Stok yang salah hitung akan ' +
        'menghentikan penjualan yang sebenarnya bisa dilayani.';
}

/**
 * ⛔ Profil yang dipakai outlet TIDAK dapat dihapus, dan bawaan tenant tidak
 * dapat dicabut. Kalimatnya menjelaskan apa yang harus dilakukan lebih dulu.
 */
export function alasanTidakDapatDicabut(p: ProfilVertikal): string | null {
  if (!p.isTenantDefault) return null;
  return (
    'Ini bawaan tenant. Tetapkan profil lain sebagai bawaan terlebih dahulu — mencabutnya ' +
    'membuat outlet tanpa profil sendiri memakai aturan yang tidak dipilih siapa pun.'
  );
}

/**
 * Kalimat tentang vertikal yang belum tersedia.
 *
 * ⛔ Dinyatakan di layar, bukan hanya ditolak endpoint. Merchant yang membaca
 * materi produk dan mencari "retail" akan menyimpulkan layarnya rusak kalau
 * pilihannya sekadar tidak ada.
 */
export const CATATAN_RETAIL =
  'Hanya profil F&B yang tersedia. Vertikal retail menuntut input barcode primer di layar ' +
  'kasir, konversi satuan, retur barang, dan preset pajak PPN — semuanya belum dibangun, ' +
  'jadi menyalakannya sekarang hanya mengubah labelnya.';

/**
 * ⛔ Kalimat yang menyatakan bahwa perubahan ini berlaku OFFLINE.
 *
 * `allow_negative_stock` turun ke perangkat dan dibaca `bacaProfilVertikal` di
 * sana. Perubahan yang belum tersinkronisasi tidak berlaku — dan owner yang
 * mengira ia langsung berlaku akan menyimpulkan setelannya tidak berfungsi.
 */
export const CATATAN_SINKRONISASI =
  'Perubahan berlaku di perangkat setelah tersinkronisasi. Tablet yang sedang offline masih ' +
  'memakai aturan lama sampai ia terhubung kembali.';
