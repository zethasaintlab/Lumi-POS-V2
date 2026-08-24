import {
  ALASAN_SUPPORT,
  DURASI_BAWAAN_MENIT,
  DURASI_MAKS_MENIT,
} from '../../../../packages/domain/src/sesi-support.ts';

/**
 * F.5 — banner akses support dan layar pemberiannya.
 *
 * `spec-f:401`: *"Sangat terlihat — banner menonjol di SELURUH layar saat sesi
 * aktif."*
 *
 * ⛔ Kalimat itu berarti banner tidak boleh milik satu layar. Ia dirender di
 * `App.tsx`, di atas `children` `AppShell`, sehingga ia ada di ke-29 layar
 * tanpa satu pun dari mereka perlu mengingatnya. Banner yang harus dipasang
 * per layar akan hilang di layar ke-30.
 *
 * ⛔ Ia juga tidak dijaga peran. Setiap orang di merchant berhak tahu bahwa
 * pihak kami sedang punya akses ke datanya — banner yang hanya muncul untuk
 * owner berarti kasir yang sedang bekerja di layar itu tidak tahu siapa lagi
 * yang sedang melihatnya, dan itu justru orang yang paling tidak berdaya.
 */

export const JUDUL_LAYAR = 'Akses Support';

export type KeadaanSesi = 'aktif' | 'diakhiri' | 'kedaluwarsa';

export interface SesiSupport {
  id: string;
  adminLabel: string;
  grantedBy: string;
  reasonCode: string;
  startedAt: string;
  expiresAt: string;
  endedAt: string | null;
  writeEnabled: boolean;
  state: KeadaanSesi;
  remainingMinutes: number;
}

/**
 * ⛔ Label alasan hidup di sini, dan daftar KUNCINYA di `packages/domain`.
 *
 * Ada test yang menuntut setiap alasan punya label. Alasan yang ditambahkan
 * kelak karena itu gagal di test alih-alih tampil sebagai slug mentah di
 * banner yang merchant baca saat memutuskan apakah akan memberi akses.
 */
export const LABEL_ALASAN: Record<string, string> = {
  investigasi_laporan_bug: 'Investigasi laporan bug',
  pemulihan_data: 'Pemulihan data',
  bantuan_konfigurasi: 'Bantuan konfigurasi',
  audit_atas_permintaan_merchant: 'Audit atas permintaan Anda',
  lainnya: 'Lainnya',
};

export function labelAlasan(kode: string): string {
  return LABEL_ALASAN[kode] ?? kode;
}

export const PILIHAN_ALASAN = ALASAN_SUPPORT.map((kode) => ({
  kode,
  label: labelAlasan(kode),
}));

/**
 * Pilihan durasi yang ditawarkan.
 *
 * ⛔ Bawaan 2 jam ada di daftar dan DITANDAI. Owner yang memilih dari daftar
 * tanpa membaca akan mengambil yang pertama; yang pertama karena itu harus
 * yang paling sempit, bukan yang paling nyaman untuk kami.
 */
export const PILIHAN_DURASI: readonly { menit: number; label: string }[] = [
  { menit: 30, label: '30 menit' },
  { menit: DURASI_BAWAAN_MENIT, label: '2 jam (bawaan)' },
  { menit: 8 * 60, label: '8 jam' },
  { menit: DURASI_MAKS_MENIT, label: '24 jam (maksimum)' },
];

/**
 * Kalimat banner. `null` berarti tidak ada yang perlu ditampilkan.
 *
 * ⛔ Ia menyebut SISA WAKTU, bukan hanya "sedang aktif". Merchant yang tidak
 * tahu kapan akses berakhir tidak punya cara menilai apakah ia perlu
 * mengakhirinya sendiri.
 *
 * ⛔ Izin TULIS disebut terpisah dan eksplisit. "Support sedang melihat data
 * Anda" dan "support sedang dapat MENGUBAH data Anda" adalah dua keadaan yang
 * sangat berbeda, dan yang kedua tidak boleh terbaca seperti yang pertama.
 */
export function pesanBanner(sesi: SesiSupport | null): string | null {
  if (sesi === null || sesi.state !== 'aktif') return null;
  const sisa = sesi.remainingMinutes;
  const waktu = sisa >= 60 ? `${Math.floor(sisa / 60)} jam ${sisa % 60} menit` : `${sisa} menit`;
  const akses = sesi.writeEnabled
    ? 'membaca dan MENGUBAH data Anda'
    : 'membaca data Anda (tanpa mengubah)';
  return `${sesi.adminLabel} dari tim Lumi sedang dapat ${akses}. Berakhir dalam ${waktu}.`;
}

/**
 * Kalimat untuk satu baris riwayat.
 *
 * ⛔ "Diakhiri" DIBEDAKAN dari "kedaluwarsa" di layar juga, bukan hanya di
 * database. Keduanya berarti akses sudah tidak berlaku, tetapi yang pertama
 * berarti seseorang di merchant memutuskan untuk memutusnya — dan riwayat
 * yang menyamakannya menghapus satu-satunya sinyal itu.
 */
export function pesanKeadaan(sesi: SesiSupport): string {
  switch (sesi.state) {
    case 'aktif':
      return `Berlaku, sisa ${sesi.remainingMinutes} menit`;
    case 'diakhiri':
      return 'Diakhiri lebih awal oleh merchant';
    default:
      return 'Berakhir karena habis waktunya';
  }
}

/** Keadaan layar, dan kalimat untuk masing-masing. */
export type KeadaanLayar = 'memuat' | 'kosong' | 'gagal' | 'siap';

/**
 * ⛔ SATU fungsi untuk ketiga keadaan bukan-siap. "Belum dimuat", "tidak ada
 * apa-apa", dan "gagal memuat" tampak sama dan berarti sangat berbeda — dan
 * yang paling berbahaya adalah yang ketiga terbaca seperti yang kedua:
 * merchant menyimpulkan tidak ada akses support padahal ia hanya tidak dapat
 * memeriksanya.
 */
export function pesanLayar(keadaan: KeadaanLayar): string | null {
  switch (keadaan) {
    case 'memuat':
      return 'Membaca riwayat akses support…';
    case 'kosong':
      return 'Belum pernah ada akses support ke data Anda.';
    case 'gagal':
      return 'Riwayat akses support tidak dapat dimuat. Ini BUKAN berarti tidak ada akses yang sedang berjalan — coba lagi sebelum menyimpulkan apa pun.';
    default:
      return null;
  }
}

/**
 * ⛔ Kalimat yang menyatakan bahwa tokennya hanya muncul sekali.
 *
 * Owner yang menutup dialog tanpa menyalin tokennya tidak punya cara
 * mendapatkannya lagi — dan itu konsekuensi dari menyimpan hash saja, bukan
 * kelalaian. Yang tidak dinyatakan akan ditemukan merchant pada saat paling
 * buruk, yaitu saat ia sedang menunggu bantuan.
 */
export const CATATAN_TOKEN =
  'Salin kode ini sekarang dan kirimkan ke petugas support. Kode hanya ditampilkan sekali — yang tersimpan di server hanya sidik jarinya, jadi ia tidak dapat ditampilkan lagi. Bila hilang, akhiri sesi ini dan beri akses baru.';

/** ⛔ Konsekuensi izin tulis, dinyatakan sebelum owner memilihnya. */
export const CATATAN_TULIS =
  'Tanpa ini, petugas support hanya dapat MEMBACA. Dengan ini, ia dapat mengubah katalog, harga, stok, dan pengaturan Anda. Setiap perubahannya tercatat di Audit & Aktivitas dengan penanda sesi ini.';
