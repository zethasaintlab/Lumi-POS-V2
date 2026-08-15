/**
 * Sidebar back-office — `IA:§3.2`, satu-satu dari diagramnya.
 *
 * > *"Pengelompokan mencerminkan batas modul."*
 *
 * ⛔ **PENGAWASAN terpisah dari LAPORAN, dan itu bukan selera.** `IA:171`
 * menyebut alasannya: laporan menjawab "apa yang terjadi", pengawasan
 * menjawab "apa yang tidak wajar". Mencampurnya membuat laporan exception
 * tenggelam di antara laporan rutin — dan laporan exception adalah yang
 * dibeli owner. Ia juga satu-satunya kontrol terhadap penyalahgunaan void
 * setelah keputusan 1 Agustus 2026 menghapus PIN manajer dari void.
 *
 * Setiap `id` adalah kode layar dari tabel `IA:§3.3`, bukan slug karangan.
 * Itu yang membuat "layar mana yang belum ada" dapat dijawab dengan
 * membandingkan berkas ini dengan tabel itu, bukan dengan menebak. Versi
 * pertama berkas ini memakai kode dari ingatan dan **seluruhnya bergeser**
 * mulai dari B-08 — ada test yang sekarang menahannya.
 *
 * B-00 (Login), B-03, B-05, dan B-07 tidak ada di sini: yang pertama adalah
 * layar sebelum shell, sisanya layar detail yang dicapai dari daftarnya.
 */

import type { IconName } from 'ds';

export interface ItemNavigasi {
  /** Kode layar `IA:§3.3`. */
  id: string;
  label: string;
  /**
   * ⛔ Bertipe `IconName`, bukan `string`.
   *
   * `ds-bundle` mengetik daftar ikonnya, jadi nama yang tidak ada GAGAL saat
   * typecheck — bukan merender kosong diam-diam di sidebar. Versi pertama
   * berkas ini memakai `folder`, `upload`, `box`, `chart`, `card`, `list`,
   * `store`, `percent`, dan `device`; **tidak satu pun ada**.
   */
  icon: IconName;
  /**
   * Akses minimum dari `IA:§3.3`.
   *
   * ⛔ BELUM DITEGAKKAN. Sesi back-office belum ada (B-00 belum dibangun),
   * jadi tidak ada peran untuk dibandingkan. Disimpan sekarang karena ia
   * datang dari tabel yang sama dengan kode layarnya — memisahkannya berarti
   * membaca tabel itu dua kali, di dua waktu berbeda.
   */
  aksesMinimum: string;
}

export interface GrupNavigasi {
  group: string;
  items: ItemNavigasi[];
}

export const NAVIGASI: readonly GrupNavigasi[] = [
  {
    group: 'Ringkasan',
    items: [{ id: 'B-01', label: 'Dashboard', icon: 'dashboard', aksesMinimum: 'outlet_manager' }],
  },
  {
    group: 'Penjualan',
    items: [
      { id: 'B-02', label: 'Transaksi', icon: 'receipt', aksesMinimum: 'outlet_manager' },
      { id: 'B-04', label: 'Shift', icon: 'clock', aksesMinimum: 'outlet_manager' },
    ],
  },
  {
    group: 'Katalog',
    items: [
      { id: 'B-06', label: 'Produk', icon: 'package', aksesMinimum: 'area_manager' },
      { id: 'B-08', label: 'Kategori', icon: 'layers', aksesMinimum: 'area_manager' },
      { id: 'B-09', label: 'Modifier', icon: 'sliders', aksesMinimum: 'area_manager' },
      { id: 'B-10', label: 'Harga', icon: 'tag', aksesMinimum: 'area_manager' },
      { id: 'B-11', label: 'Impor katalog', icon: 'swap', aksesMinimum: 'area_manager' },
    ],
  },
  {
    group: 'Inventori',
    items: [
      { id: 'B-12', label: 'Stok', icon: 'table', aksesMinimum: 'outlet_manager' },
      { id: 'B-13', label: 'Penyesuaian', icon: 'edit', aksesMinimum: 'outlet_manager' },
      { id: 'B-14', label: 'Opname', icon: 'clipboard', aksesMinimum: 'outlet_manager' },
      { id: 'B-15', label: 'Perlu diperiksa', icon: 'alert', aksesMinimum: 'outlet_manager' },
    ],
  },
  {
    group: 'Laporan',
    items: [
      { id: 'B-16', label: 'Penjualan', icon: 'activity', aksesMinimum: 'outlet_manager' },
      { id: 'B-17', label: 'Produk', icon: 'layers', aksesMinimum: 'outlet_manager' },
      { id: 'B-18', label: 'Kasir', icon: 'users', aksesMinimum: 'outlet_manager' },
      { id: 'B-19', label: 'Pembayaran', icon: 'qr', aksesMinimum: 'outlet_manager' },
      { id: 'B-20', label: 'Ekspor', icon: 'download', aksesMinimum: 'accountant' },
    ],
  },
  {
    group: 'Pengawasan',
    items: [
      { id: 'B-21', label: 'Laporan exception', icon: 'shield', aksesMinimum: 'outlet_manager' },
      { id: 'B-22', label: 'Audit & Aktivitas', icon: 'book', aksesMinimum: 'outlet_manager' },
    ],
  },
  {
    group: 'Pengaturan',
    items: [
      { id: 'B-23', label: 'Outlet', icon: 'map-pin', aksesMinimum: 'area_manager' },
      { id: 'B-24', label: 'Profil vertikal', icon: 'settings', aksesMinimum: 'owner' },
      { id: 'B-25', label: 'Pajak', icon: 'file', aksesMinimum: 'owner' },
      { id: 'B-26', label: 'Ambang otorisasi', icon: 'lock', aksesMinimum: 'area_manager' },
      { id: 'B-27', label: 'Pengguna & Peran', icon: 'user', aksesMinimum: 'outlet_manager' },
      { id: 'B-28', label: 'Perangkat', icon: 'register', aksesMinimum: 'outlet_manager' },
      { id: 'B-29', label: 'Langganan & Batas', icon: 'star', aksesMinimum: 'owner' },
    ],
  },
];

/**
 * Layar yang SUDAH punya isi. Sisanya menampilkan keadaan kosong yang
 * menyebut namanya sendiri.
 *
 * ⛔ Daftar ini ada supaya sidebar tidak berbohong. Menu yang diklik lalu
 * menampilkan halaman putih tidak dapat dibedakan dari aplikasi yang rusak —
 * dan yang membuka back-office pertama kali adalah merchant yang baru
 * mendaftar, tanpa siapa pun untuk ditanyai.
 */
export const LAYAR_SIAP: ReadonlySet<string> = new Set<string>([
  'B-06',
  'B-08',
  'B-09',
  'B-10',
  'B-11',
  'B-16',
  'B-17',
  'B-18',
  'B-19',
  'B-20',
  'B-23',
  'B-25',
  'B-27',
  'B-28',
  'B-29',
]);

export function cariItem(id: string): ItemNavigasi | undefined {
  for (const grup of NAVIGASI) {
    const item = grup.items.find((i) => i.id === id);
    if (item) return item;
  }
  return undefined;
}

export function grupUntuk(id: string): string | undefined {
  return NAVIGASI.find((g) => g.items.some((i) => i.id === id))?.group;
}

/**
 * ⛔ Akuntan hanya melihat grup LAPORAN.
 *
 * Keputusan produk yang menutup `IA:439` ("Apakah Akuntan punya navigasi
 * sendiri yang disederhanakan, atau back-office penuh dengan menu
 * tersembunyi?"): navigasi sendiri, disederhanakan.
 *
 * ⛔ **Ini penjaga UX, bukan batas keamanan.** Yang menahan Akuntan mengubah
 * apa pun adalah `apps/server/src/rbac-rute.ts` — setiap rute mutasi
 * administratif menuntut operasi yang matriks `spec-f` tidak berikan
 * kepadanya, dan `OPERASI_MUTASI` diuji sebagai property atas SELURUH daftar
 * ("Akuntan tidak dapat melakukan mutasi apa pun", `spec-f:82`). Menyembunyikan
 * menu hanya menghilangkan tombol yang setiap penekanannya akan ditolak.
 *
 * ⛔ Satu ketegangan yang dinyatakan, bukan didiamkan: matriks memberi Akuntan
 * `report_exception`, jadi B-21 (Laporan exception) sebenarnya BOLEH ia buka.
 * Keputusan produk di atas tetap menyembunyikannya karena ia bukan grup
 * Laporan. Kalau kelak Akuntan mengeluh tidak dapat melihat laporan exception
 * yang haknya ia punya, jawabannya ada di sini — bukan di kode server.
 */
export const GRUP_AKUNTAN: ReadonlySet<string> = new Set(['Laporan']);

/** Layar pertama Akuntan. Dashboard bukan miliknya. */
export const BERANDA_AKUNTAN = 'B-16';

/**
 * Apakah peran ini HANYA akuntan.
 *
 * ⛔ Seseorang dapat memegang beberapa peran. Akuntan yang juga Manajer Outlet
 * harus melihat menu manajer — penyempitan berlaku hanya bila akuntan adalah
 * satu-satunya perannya. Memeriksa `includes('accountant')` saja akan
 * menyembunyikan menu dari orang yang berhak memakainya.
 */
export function hanyaAkuntan(peran: readonly string[]): boolean {
  return peran.length > 0 && peran.every((p) => p === 'accountant');
}

/** Navigasi yang terlihat oleh pemegang peran ini. */
export function navigasiUntuk(peran: readonly string[]): GrupNavigasi[] {
  const semua = NAVIGASI.map((g) => ({ ...g, items: [...g.items] }));
  if (!hanyaAkuntan(peran)) return semua;
  return semua.filter((g) => GRUP_AKUNTAN.has(g.group));
}
