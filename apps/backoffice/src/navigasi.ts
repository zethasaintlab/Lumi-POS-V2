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
import { bolehkah, type Operasi } from '../../../packages/domain/src/rbac.ts';

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
  /**
   * Operasi `spec-f` yang layar ini butuhkan, bila ada satu yang tepat.
   *
   * ⛔ Ada supaya persona yang menunya disempitkan TIDAK ditentukan daftar
   * kedua yang ditulis tangan. Akuntan melihat B-21 karena matriks di
   * `packages/domain/src/rbac.ts` memberinya `report_exception` — matriks yang
   * SAMA dengan yang server tegakkan lewat `assertBoleh`. Kalau kelak hak itu
   * dicabut, menunya ikut hilang tanpa ada yang perlu ingat menghapusnya.
   *
   * Sebagian besar item tidak punya satu operasi yang tepat (Dashboard,
   * Transaksi) dan sengaja dibiarkan kosong. `aksesMinimum` tetap ada dan tetap
   * berperan lain: ia salinan kolom "akses minimum" dari `IA:§3.3`, bukan
   * kosakata RBAC.
   */
  operasi?: Operasi;
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
      {
        id: 'B-21',
        label: 'Laporan exception',
        icon: 'shield',
        aksesMinimum: 'outlet_manager',
        operasi: 'report_exception',
      },
      {
        id: 'B-22',
        label: 'Audit & Aktivitas',
        icon: 'book',
        aksesMinimum: 'outlet_manager',
        // ⛔ `report_exception`, dan itu `[ASUMSI]` yang dinyatakan — lihat
        // `reporting/index.ts`. Matriks `spec-f:38-53` tidak punya baris untuk
        // audit trail; himpunan peran operasi ini sama persis dengan minimum
        // `IA:201`, dan isi audit trail adalah SUPERSET dari X1 yang matriks
        // sudah berikan kepada keempat peran itu. Menolak trail sambil
        // memberikan X1 tidak melindungi apa pun.
        operasi: 'report_exception',
      },
    ],
  },
  {
    group: 'Pengaturan',
    items: [
      { id: 'B-23', label: 'Outlet', icon: 'map-pin', aksesMinimum: 'area_manager' },
      {
        id: 'B-24',
        label: 'Profil vertikal',
        icon: 'settings',
        aksesMinimum: 'owner',
        // ⛔ `outlet_manage` (owner saja), dipakai ulang alih-alih operasi
        // baru: profil vertikal menentukan perilaku SELURUH outlet yang
        // mewarisinya, dan himpunan perannya sama persis dengan membuat
        // outlet. Operasi baru yang himpunannya identik hanya menambah baris
        // ke matriks yang spec tidak nyatakan.
        operasi: 'outlet_manage',
      },
      { id: 'B-25', label: 'Pajak', icon: 'file', aksesMinimum: 'owner' },
      {
        id: 'B-26',
        label: 'Ambang otorisasi',
        icon: 'lock',
        aksesMinimum: 'area_manager',
        // ⛔ `threshold_settings` = {owner, area_manager}, diturunkan dari
        // `IA:205`. Manajer Outlet sengaja di luar: ambang inilah yang
        // memutuskan kapan persetujuan MANAJER OUTLET dituntut, dan yang dapat
        // menaikkannya dapat menghapus kebutuhan atas persetujuannya sendiri.
        operasi: 'threshold_settings',
      },
      { id: 'B-27', label: 'Pengguna & Peran', icon: 'user', aksesMinimum: 'outlet_manager' },
      { id: 'B-28', label: 'Perangkat', icon: 'register', aksesMinimum: 'outlet_manager' },
      { id: 'B-29', label: 'Langganan & Batas', icon: 'star', aksesMinimum: 'owner' },
      {
        // F.5 — akses support. TIDAK di `IA:§3.3`, dan itu dinyatakan: peta
        // layar berhenti di B-29, sementara `spec-f:391` menuntut fiturnya
        // ada. Ia diberi nomor berikutnya alih-alih diselipkan ke layar lain.
        //
        // ⛔ `aksesMinimum: 'cashier'` — MEMBACA riwayat terbuka untuk semua
        // peran. `spec-f:401` menuntut akses support "sangat terlihat", dan
        // menyembunyikan menunya dari staf berarti orang yang sedang bekerja
        // di layar itu tidak punya cara memeriksa siapa lagi yang melihatnya.
        // Yang dijaga adalah MEMBERI-nya (`support_grant`, owner saja), dan
        // itu ditegakkan server plus disembunyikan formulirnya di layar.
        id: 'B-30',
        label: 'Akses Support',
        icon: 'shield',
        aksesMinimum: 'cashier',
      },
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
  'B-01',
  'B-02',
  'B-04',
  'B-06',
  'B-08',
  'B-09',
  'B-10',
  'B-11',
  'B-12',
  'B-13',
  'B-14',
  'B-15',
  'B-16',
  'B-17',
  'B-18',
  'B-19',
  'B-20',
  'B-21',
  'B-22',
  'B-23',
  'B-24',
  'B-25',
  'B-26',
  'B-27',
  'B-28',
  'B-29',
  'B-30',
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
 * ⛔ **Ketegangan yang dicatat di sini sudah ditutup, 16 Agustus 2026.** Versi
 * sebelumnya menuliskan: matriks memberi Akuntan `report_exception`, jadi B-21
 * sebenarnya boleh ia buka, tapi menunya tetap disembunyikan karena B-21 bukan
 * grup Laporan. Keputusan produk direvisi — Akuntan mendapat B-21.
 *
 * Yang berubah bukan hanya isinya. Sebelumnya penyempitan ditentukan SEMATA
 * oleh daftar grup di bawah; sekarang item di luar grup itu ikut terlihat bila
 * matriks `spec-f` memberi Akuntan operasinya. Itu memindahkan keputusan
 * "layar mana yang Akuntan lihat" dari daftar tulisan tangan ke matriks yang
 * server tegakkan — satu sumber, bukan dua yang harus diingat agar sepakat.
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

/**
 * Navigasi yang terlihat oleh pemegang peran ini.
 *
 * ⛔ Untuk Akuntan: grup di `GRUP_AKUNTAN` utuh, DITAMBAH item di luar grup itu
 * yang operasinya diberikan matriks kepadanya. Grup yang tersisa kosong
 * dibuang — judul grup tanpa satu pun menu di bawahnya terbaca seperti menu
 * yang gagal dimuat.
 *
 * Penambahannya per ITEM, bukan per grup — dan itu tetap benar meski kini
 * kedua item Pengawasan menuntut operasi yang sama. Grup berikutnya yang lahir
 * di luar `GRUP_AKUNTAN` akan punya item tanpa operasi, dan membukanya
 * borongan berarti memberi Akuntan layar yang tidak seorang pun putuskan
 * untuknya.
 *
 * ⛔ B-22 mendapat `report_exception` sejak 23 Agustus 2026, dan itu `[ASUMSI]`
 * yang dinyatakan: matriks `spec-f` tidak punya baris untuk audit trail. Lihat
 * catatan di entri navigasinya dan di `reporting/index.ts`.
 */
export function navigasiUntuk(peran: readonly string[]): GrupNavigasi[] {
  const semua = NAVIGASI.map((g) => ({ ...g, items: [...g.items] }));
  if (!hanyaAkuntan(peran)) return semua;

  return semua
    .map((g) =>
      GRUP_AKUNTAN.has(g.group)
        ? g
        : { ...g, items: g.items.filter((i) => i.operasi !== undefined && bolehkah(peran, i.operasi)) }
    )
    .filter((g) => g.items.length > 0);
}
