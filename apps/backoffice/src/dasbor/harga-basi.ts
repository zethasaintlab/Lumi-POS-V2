/**
 * FR-A7 AC keempat — aturan tampilan panel "perangkat berharga basi" di B-01.
 *
 * ⛔ Seluruh kalimat di sini menyatakan BATAS pengetahuannya, dan itu bukan
 * kehati-hatian berlebihan. `last_seen_at` adalah proksi: server tahu kapan
 * perangkat terakhir menghubunginya, bukan apa yang sudah mendarat di sana.
 * Merchant yang membaca daftar kosong sebagai "semua perangkat sudah memakai
 * harga baru" menyimpulkan lebih dari yang datanya dukung — dan ia akan
 * menyimpulkannya, kecuali layar mengatakan sebaliknya.
 */

export interface PerangkatHargaBasi {
  deviceId: string;
  kode: string;
  nama: string;
  outletId: string;
  outletNama: string | null;
  lastSeenAt: string | null;
  perubahanTertinggal: number;
  tertinggalSejak: string;
}

export interface HargaBasi {
  outletId: string | null;
  perubahanTerakhir: string | null;
  jumlahDiperiksa: number;
  perangkat: PerangkatHargaBasi[];
}

export const JUDUL_PANEL = 'Perangkat berharga basi';

/**
 * ⛔ Kalimat yang menyatakan asimetrinya, dan ia SELALU tampil — juga saat
 * daftarnya kosong.
 *
 * "Belum menerima" dapat dibuktikan; "sudah menerima" tidak. Panel yang hanya
 * menampilkan daftar tanpa kalimat ini membuat kosong terbaca sebagai jaminan.
 */
export const CATATAN_BATAS =
  'Daftar ini diturunkan dari kapan perangkat terakhir menghubungi server, bukan dari apa yang benar-benar sudah tersimpan di sana. Perangkat yang TIDAK muncul di sini belum tentu sudah memakai harga baru — ia hanya sudah menghubungi kami sejak perubahan terakhir.';

export type KeadaanPanel = 'memuat' | 'kosong' | 'tidak-berhak' | 'gagal' | 'siap';

/**
 * Pesan pengganti tabel, atau `null` bila tabelnya yang dirender.
 *
 * ⛔ SATU fungsi untuk keempat keadaan bukan-siap — aturan yang sama dengan
 * `pesanLaporan` di B-21. "Belum dimuat", "semua perangkat mutakhir", "Anda
 * tidak berhak melihat ini", dan "gagal memuat" tampak sama di layar dan
 * berarti hal yang sangat berbeda. Yang paling berbahaya adalah keempat
 * terbaca seperti kedua: merchant menyimpulkan armadanya sehat padahal ia
 * hanya tidak dapat memeriksanya.
 */
export function pesanPanel(keadaan: KeadaanPanel, jumlahDiperiksa: number): string | null {
  switch (keadaan) {
    case 'memuat':
      return 'Memeriksa perangkat…';
    case 'tidak-berhak':
      return 'Hanya Owner dan Manajer Area yang dapat melihat status harga perangkat.';
    case 'gagal':
      return 'Status perangkat tidak dapat dimuat. Ini BUKAN berarti semua perangkat sudah mutakhir — coba lagi sebelum menyimpulkan apa pun.';
    case 'kosong':
      // ⛔ Jumlah yang diperiksa DISEBUTKAN. "Tidak ada perangkat yang
      // tertinggal" dari NOL perangkat berarti hal yang sangat berbeda dari
      // yang sama dari sepuluh perangkat, dan keduanya terlihat sama.
      return jumlahDiperiksa === 0
        ? 'Belum ada perangkat terdaftar di cakupan ini.'
        : `Tidak ada dari ${jumlahDiperiksa} perangkat yang tertinggal perubahan harga.`;
    default:
      return null;
  }
}

/**
 * Berapa lama perangkat ini tidak terlihat, sebagai kalimat.
 *
 * ⛔ `null` dibedakan tegas: perangkat yang BELUM PERNAH menghubungi server
 * bukan perangkat yang "0 jam lalu" maupun yang tidak diketahui — ia perangkat
 * yang tidak pernah memakai harga apa pun yang benar, dan itu keadaan yang
 * paling perlu ditindaklanjuti.
 */
export function terlihatTampil(lastSeenAt: string | null, sekarang: Date): string {
  if (lastSeenAt === null) return 'Belum pernah terhubung';
  const jam = Math.floor((sekarang.getTime() - new Date(lastSeenAt).getTime()) / 3_600_000);
  if (jam < 1) return 'Kurang dari 1 jam lalu';
  if (jam < 24) return `${jam} jam lalu`;
  const hari = Math.floor(jam / 24);
  return `${hari} hari lalu`;
}

/**
 * ⛔ Angkanya disertai KATANYA. "3" di kolom bernama "Tertinggal" dapat
 * terbaca sebagai jam, hari, atau rupiah oleh orang yang membaca sekilas — dan
 * layar ini dibaca sekilas setiap pagi.
 */
export function tertinggalTampil(n: number): string {
  return n === 1 ? '1 perubahan harga' : `${n} perubahan harga`;
}
