/**
 * Matriks hak akses (FR-F1, `product/specs/spec-f-rbac-audit.md` §F.1).
 *
 * ## Kenapa DATA, bukan `if`
 *
 * AC `spec-f:83`: "Penambahan peran baru tidak memerlukan perubahan di layar
 * kasir." Itu hanya mungkin bila layar bertanya `bolehkah(peran, operasi)`
 * alih-alih memeriksa nama peran. Matriks di bawah karena itu adalah tabel
 * yang dapat dibaca berdampingan dengan spec-nya, bukan rangkaian cabang.
 *
 * ## Kenapa di packages/domain
 *
 * Server menegakkannya di endpoint; klien memakainya untuk menyembunyikan
 * aksi yang tidak boleh dilakukan — **saat offline**, tanpa bertanya ke siapa
 * pun. Dua salinan matriks adalah cara paling langsung untuk membuat tombol
 * yang terlihat aktif di perangkat lalu ditolak server beberapa jam kemudian,
 * setelah antrean terkuras.
 *
 * Murni: tanpa I/O, tanpa waktu, tanpa database.
 *
 * ## Batas yang harus dibaca bersama ini
 *
 * Matriks ini menjawab "peran ini boleh apa". Ia TIDAK menjawab "apakah orang
 * ini benar-benar orang yang diklaimnya" — di jalur naik, `X-Actor-Id`
 * dijamin perangkat, bukan diverifikasi server (lihat §5 PLAN-modul-f).
 * Yang menjaga sisi itu adalah token perangkat yang dapat dicabut (FR-F12).
 */

export type Peran = 'owner' | 'area_manager' | 'outlet_manager' | 'cashier' | 'accountant';

/** Harus sama persis dengan CHECK di `db/migrations/0003_identity.sql`. */
export const PERAN_DIKENAL: ReadonlySet<Peran> = new Set([
  'owner',
  'area_manager',
  'outlet_manager',
  'cashier',
  'accountant',
]);

export type Operasi =
  | 'sale'
  | 'void_refund'
  | 'approve_authorization'
  | 'shift_open_close'
  | 'approve_cash_variance'
  | 'catalog_edit'
  | 'price_edit'
  | 'stock_adjust'
  | 'view_margin'
  | 'report_exception'
  | 'tax_settings'
  | 'billing'
  | 'outlet_manage'
  | 'device_revoke';

/**
 * Tabel `spec-f:38-53`, satu baris per operasi.
 *
 * Sel "Kelola pengguna → Manajer Outlet → Kasir saja" TIDAK ada di sini: ia
 * satu-satunya sel bersyarat di seluruh matriks dan tidak muat sebagai
 * boolean. Ia hidup di `bolehKelolaPengguna` di bawah.
 */
const MATRIKS: Readonly<Record<Operasi, ReadonlySet<Peran>>> = {
  sale: new Set(['owner', 'area_manager', 'outlet_manager', 'cashier']),
  void_refund: new Set(['owner', 'area_manager', 'outlet_manager', 'cashier']),
  approve_authorization: new Set(['owner', 'area_manager', 'outlet_manager']),
  shift_open_close: new Set(['owner', 'area_manager', 'outlet_manager', 'cashier']),
  approve_cash_variance: new Set(['owner', 'area_manager', 'outlet_manager']),
  catalog_edit: new Set(['owner', 'area_manager']),
  price_edit: new Set(['owner', 'area_manager']),
  stock_adjust: new Set(['owner', 'area_manager', 'outlet_manager']),
  view_margin: new Set(['owner', 'area_manager', 'outlet_manager', 'accountant']),
  report_exception: new Set(['owner', 'area_manager', 'outlet_manager', 'accountant']),
  tax_settings: new Set(['owner']),
  billing: new Set(['owner']),
  // `spec-f:29` memberi Owner "membuat outlet"; `spec-f:30` menaruhnya di
  // kolom YANG TIDAK BOLEH milik Manajer Area, berdampingan dengan billing.
  // Owner-only karena itu diturunkan dari tabel, bukan ditebak — dan ia
  // operasi tersendiri, bukan `billing` yang dipakai ulang, supaya penolakan
  // membaca "tidak berhak mengelola outlet" alih-alih menyalahkan tagihan.
  outlet_manage: new Set(['owner']),
  device_revoke: new Set(['owner', 'area_manager', 'outlet_manager']),
};

/**
 * Operasi yang MENGUBAH sesuatu.
 *
 * Ada supaya AC `spec-f:82` ("Akuntan tidak dapat melakukan mutasi apa pun")
 * dapat diuji sebagai property atas seluruh daftar, bukan sebagai beberapa
 * contoh. Operasi mutasi yang ditambahkan kelak ikut terjaga tanpa ada yang
 * perlu ingat menuliskan assertion-nya.
 */
export const OPERASI_MUTASI: readonly Operasi[] = [
  'sale',
  'void_refund',
  'shift_open_close',
  'catalog_edit',
  'price_edit',
  'stock_adjust',
  'tax_settings',
  'billing',
  'outlet_manage',
  'device_revoke',
];

/** Operasi yang menyetujui tindakan orang lain (`spec-f:80`). */
export const OPERASI_PERSETUJUAN: readonly Operasi[] = [
  'approve_authorization',
  'approve_cash_variance',
];

/**
 * Apakah gabungan peran ini boleh melakukan operasi tersebut.
 *
 * ⛔ **Fail-closed.** Operasi yang tidak dikenal ditolak untuk semua orang,
 * termasuk owner. Endpoint baru yang lupa didaftarkan di matriks karena itu
 * gagal terlihat — alternatifnya, terbuka untuk semua orang, adalah kegagalan
 * diam-diam yang baru ketahuan setelah dipakai.
 *
 * Beberapa peran digabung dengan OR, bukan AND: manajer outlet yang juga
 * kasir di outlet lain harus tetap dapat menyetujui. Mengambil yang paling
 * sempit akan mencabut hak yang sudah diberikan.
 */
export function bolehkah(peran: readonly string[], operasi: string): boolean {
  const diizinkan = MATRIKS[operasi as Operasi];
  if (!diizinkan) return false;
  return peran.some((p) => diizinkan.has(p as Peran));
}

/**
 * Terjemahan peran untuk manusia.
 *
 * ⛔ Di sini, bukan di layar. Pesan penolakan server menyebut peran mana
 * (`ROLE_SCOPE_TOO_WIDE`), dan layar B-27 menampilkan pilihan peran — dua
 * tempat, satu daftar. Terjemahan yang disalin akan menyimpang, dan yang
 * menyimpang menghasilkan layar yang menyebut "Manajer Outlet" sementara
 * penolakannya menyebut sesuatu yang lain.
 */
export const LABEL_PERAN: Readonly<Record<Peran, string>> = {
  owner: 'Owner',
  area_manager: 'Manajer Area',
  outlet_manager: 'Manajer Outlet',
  cashier: 'Kasir',
  accountant: 'Akuntan',
};

/**
 * Cakupan peran — kolom "Cakupan" di tabel `spec-f:27-33`, diturunkan apa
 * adanya:
 *
 * | Peran | Cakupan |
 * |---|---|
 * | Owner | Tenant |
 * | Akuntan | Tenant, read-only |
 * | Manajer Area | **Beberapa** outlet |
 * | Manajer Outlet | **Satu** outlet |
 * | Kasir | **Satu** outlet |
 */
export const CAKUPAN_TENANT: ReadonlySet<string> = new Set<Peran>(['owner', 'accountant']);
export const CAKUPAN_SATU_OUTLET: ReadonlySet<string> = new Set<Peran>([
  'outlet_manager',
  'cashier',
]);

/**
 * Peran pertama yang cakupannya dilampaui, atau `null`.
 *
 * ⛔ Batasnya nyata, bukan formalitas. Kasir yang terdaftar di dua outlet
 * muncul di layar login KEDUA tablet, dan penjualannya dapat dinisbatkan ke
 * outlet yang tidak pernah ia tempati — laporan per outlet dan per kasir
 * keduanya jadi salah tanpa satu pun error. Manajer Outlet bercakupan dua
 * outlet menyetujui refund di outlet yang bukan tanggung jawabnya, dan
 * pemisahan tugas `spec-f:91` runtuh tanpa aturan apa pun terlihat dilanggar.
 *
 * ⛔ `jumlahOutlet` harus jumlah outlet UNIK. `['o1','o1']` adalah satu
 * outlet, dan handler sendiri mem-`Set`-kannya sebelum menulis — penjaga yang
 * menghitung panjang array mentah menolak permintaan yang sah.
 *
 * Mengembalikan peran, bukan boolean, supaya pemanggil dapat MENYEBUTNYA.
 * Penolakan yang hanya berkata "tidak boleh" membuat pemanggil menebak batas
 * mana yang kena.
 */
export function peranMelebihiCakupan(
  peran: readonly string[],
  jumlahOutlet: number
): string | null {
  if (jumlahOutlet <= 1) return null;
  return peran.find((p) => CAKUPAN_SATU_OUTLET.has(p)) ?? null;
}

/**
 * Sel bersyarat `spec-f:50`: Manajer Outlet mengelola **kasir saja**.
 *
 * Batasnya nyata, bukan formalitas: manajer outlet yang dapat membuat manajer
 * outlet lain dapat memberi dirinya rekan yang menyetujui refund-nya sendiri,
 * dan pemisahan tugas di `spec-f:91` runtuh tanpa satu pun aturan dilanggar.
 */
export function bolehKelolaPengguna(peran: readonly string[], peranTarget: string): boolean {
  if (peran.includes('owner') || peran.includes('area_manager')) return true;
  if (peran.includes('outlet_manager')) return peranTarget === 'cashier';
  return false;
}
