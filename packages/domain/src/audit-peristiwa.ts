/**
 * Kosakata `audit_event.event_type` — daftar tertutup. FR-F6, `spec-f:288`.
 *
 * ## ⛔ Kenapa daftar ini baru lahir sekarang
 *
 * `recordAuditEvent` menerima `eventType: string` sejak Modul B. Delapan belas
 * nama karena itu tersebar di dua belas berkas, tidak satu pun terdaftar di
 * mana pun, dan **tidak ada apa pun yang menahan yang kesembilan belas dieja
 * berbeda**. Ejaan yang menyimpang tidak menghasilkan error: ia menghasilkan
 * baris audit yang tidak pernah cocok dengan saringan mana pun, dan laporan
 * yang melewatkannya terlihat persis seperti laporan yang tidak menemukan apa
 * pun.
 *
 * Bentuk cacat yang sama persis dengan `stock_movement.type` (`CLAUDE.md`):
 * dua kosakata untuk satu peristiwa menjadi laporan yang menghitung sebagian
 * dan melewatkan sisanya.
 *
 * ## ⛔ Kosakata KODE yang menang, bukan kosakata spec
 *
 * `spec-f:292` menulis `order_voided`; kode menulis `order.voided`. Keduanya
 * sudah ada di database merchant, dan `audit_event` tidak pernah di-`UPDATE`
 * (invariant #2) — baris lama tidak dapat ditulis ulang. Menyeragamkan ke ejaan
 * spec berarti dua ejaan untuk satu peristiwa, selamanya, dan laporan yang
 * menyaring salah satunya melewatkan separuh sejarah.
 *
 * Yang dilakukan sebaliknya: ejaan kode dibekukan di sini, dan `PETA_EJAAN_SPEC`
 * menyatakan padanannya supaya daftar spec tetap dapat dibandingkan.
 *
 * ## ⛔ Daftar ini BELUM lengkap terhadap spec, dan itu DATA
 *
 * `PERISTIWA_BELUM_DIPANCARKAN` diturunkan — tidak ditulis tangan — dari selisih
 * antara daftar spec dan yang benar-benar dipancarkan kode. Ia menyusut sendiri
 * saat peristiwa yang hilang mulai ditulis. FR-F6 AC pertama menuntut *"setiap
 * event dalam daftar menghasilkan record"*, dan trail berlubang lebih berbahaya
 * daripada trail yang tidak ada: ia terlihat lengkap.
 *
 * Murni: tanpa I/O, tanpa waktu, tanpa database.
 */

/** Kelompok pada tabel `spec-f:288`, dipakai menyaring layar B-22. */
export type KelompokPeristiwa =
  | 'sesi'
  | 'shift'
  | 'transaksi'
  | 'kas'
  | 'katalog'
  | 'stok'
  | 'konfigurasi'
  | 'identitas'
  | 'perangkat'
  | 'data'
  | 'tenant';

/**
 * Peristiwa yang kode ini BENAR-BENAR pancarkan hari ini, dengan kelompoknya.
 *
 * ⛔ Menambah baris di sini tanpa memancarkannya membuat `PERISTIWA_BELUM_DIPANCARKAN`
 * berbohong. Menambah pemanggilan `recordAuditEvent` tanpa baris di sini
 * ditolak TypeScript — itu yang membuat daftar ini tetap benar.
 */
export const PERISTIWA_AUDIT = {
  // Sesi
  //
  // ⛔ Tidak ada `login_failed`, dan itu batas yang dinyatakan bukan
  // kelalaian: `audit_event.actor_user_id` adalah `NOT NULL` ber-FK ke
  // `"user"`, sementara login yang gagal sering memakai email yang tidak
  // menunjuk pengguna mana pun. Daftar `spec-f:290` sendiri tidak memuatnya.
  login: 'sesi',
  logout: 'sesi',
  pin_failed: 'sesi',
  pin_lockout: 'sesi',

  // Shift
  //
  // ⛔ Tidak ada `shift_count_attempt`, dan itu batas yang DINYATAKAN. Server
  // hanya mencatat percobaan hitungan yang BERHASIL menutup shift — percobaan
  // yang ditolak (selisih melewati ambang tanpa penyetuju) dilempar sebelum
  // `UPDATE`, jadi transaksinya di-rollback dan tidak meninggalkan apa pun.
  // Percobaan yang gagal justru yang `spec-d` ingin buktikan tidak dapat
  // diulang diam-diam, dan mencatatnya menuntut jalur tulis yang bertahan
  // melewati rollback — perubahan rancangan, bukan satu baris.
  //
  // Percobaan yang berhasil sudah dijelaskan sepenuhnya oleh `shift_closed`
  // (hitungan, selisih, alasan, penyetuju); memancarkan peristiwa kedua yang
  // isinya sama hanya menambah baris yang tidak menjelaskan apa pun.
  shift_opened: 'shift',
  shift_closed: 'shift',

  // Transaksi
  'order.voided': 'transaksi',
  'order.refunded': 'transaksi',
  'order.abandoned': 'transaksi',
  discount_applied: 'transaksi',
  // Tidak ada di daftar spec, dan sengaja: `spec-h:95` menuntut selisih
  // hitungan klien DITANDAI alih-alih ditolak, dan penandanya adalah baris
  // audit ini.
  calculation_variance: 'transaksi',

  // Kas
  cash_drawer_opened: 'kas',
  cash_variance_approved: 'kas',

  // Katalog
  catalog_imported: 'katalog',
  item_created: 'katalog',
  item_updated: 'katalog',
  item_archived: 'katalog',
  price_changed: 'katalog',

  // Stok
  stock_adjusted: 'stok',
  stocktake_completed: 'stok',
  sold_out_toggled: 'stok',

  // Konfigurasi
  tax_rate_changed: 'konfigurasi',
  threshold_changed: 'konfigurasi',
  vertical_profile_changed: 'konfigurasi',

  // Identitas
  user_created: 'identitas',
  user_role_changed: 'identitas',
  user_deactivated: 'identitas',
  pin_changed: 'identitas',

  // Perangkat
  device_provisioned: 'perangkat',
  device_revoked: 'perangkat',
  clock_drift_detected: 'perangkat',

  // Data
  data_exported: 'data',

  // Tenant & langganan — kelompok yang TIDAK ada di tabel `spec-f:288`.
  //
  // `[ASUMSI]` Mendaftarkan merchant, membuat outlet, dan menaikkan paket
  // adalah tindakan yang menyentuh uang dan cakupan akses; keduanya harus
  // dapat ditelusuri, dan tidak satu pun kelompok spec memuatnya. Kelompoknya
  // ditambahkan alih-alih peristiwanya diselundupkan ke kelompok yang salah.
  tenant_registered: 'tenant',
  outlet_created: 'tenant',
  subscription_invoice_created: 'tenant',
  subscription_plan_upgraded: 'tenant',
} as const satisfies Record<string, KelompokPeristiwa>;

export type PeristiwaAudit = keyof typeof PERISTIWA_AUDIT;

export const KUNCI_PERISTIWA: readonly PeristiwaAudit[] = Object.keys(
  PERISTIWA_AUDIT
) as PeristiwaAudit[];

/**
 * Kelompok sebuah peristiwa, atau `null` bila tidak dikenal.
 *
 * ⛔ `null`, bukan kelompok bawaan. Baris lama dapat memuat nama yang sudah
 * tidak dipancarkan siapa pun, dan menaruhnya di kelompok yang salah membuat
 * saringan kelompok menyembunyikan baris yang justru paling perlu dilihat.
 */
export function kelompokPeristiwa(nama: string): KelompokPeristiwa | null {
  return (PERISTIWA_AUDIT as Record<string, KelompokPeristiwa>)[nama] ?? null;
}

export function adalahPeristiwaAudit(nama: string): nama is PeristiwaAudit {
  return kelompokPeristiwa(nama) !== null;
}

// ---------------------------------------------------------------------------
// Perbandingan dengan daftar spec
// ---------------------------------------------------------------------------

/** Tabel `spec-f:288-300` apa adanya, dengan ejaan yang spec pakai. */
const SPEC: Readonly<Record<string, KelompokPeristiwa>> = {
  login: 'sesi',
  logout: 'sesi',
  pin_failed: 'sesi',
  pin_lockout: 'sesi',

  shift_opened: 'shift',
  shift_closed: 'shift',
  shift_count_attempt: 'shift',

  order_voided: 'transaksi',
  order_refunded: 'transaksi',
  discount_applied: 'transaksi',

  cash_drawer_opened: 'kas',
  cash_paid_in: 'kas',
  cash_paid_out: 'kas',
  cash_variance_approved: 'kas',

  item_created: 'katalog',
  item_updated: 'katalog',
  item_archived: 'katalog',
  price_changed: 'katalog',
  catalog_imported: 'katalog',

  stock_adjusted: 'stok',
  stocktake_completed: 'stok',
  sold_out_toggled: 'stok',

  tax_rate_changed: 'konfigurasi',
  threshold_changed: 'konfigurasi',
  vertical_profile_changed: 'konfigurasi',

  user_created: 'identitas',
  user_role_changed: 'identitas',
  user_deactivated: 'identitas',
  pin_changed: 'identitas',

  device_provisioned: 'perangkat',
  device_revoked: 'perangkat',
  peripheral_configured: 'perangkat',

  data_exported: 'data',
  support_session_started: 'data',
  support_session_ended: 'data',
};

/**
 * Ejaan spec → ejaan kode, hanya untuk yang berbeda.
 *
 * Dua baris, dan keduanya lahir dari kebiasaan penamaan `ordering` yang memakai
 * titik. Lihat catatan kepala: yang dibekukan ejaan kode.
 */
export const PETA_EJAAN_SPEC: Readonly<Record<string, PeristiwaAudit>> = {
  order_voided: 'order.voided',
  order_refunded: 'order.refunded',
};

export const KUNCI_SPEC: readonly string[] = Object.keys(SPEC);

/**
 * Peristiwa yang spec sebut dan kode BELUM pancarkan — diturunkan, bukan
 * ditulis tangan.
 *
 * FR-F6 AC pertama: *"setiap event dalam daftar menghasilkan record"*. Daftar
 * ini adalah jarak yang tersisa ke sana, dan ia menyusut sendiri saat
 * peristiwanya mulai ditulis — tidak ada daftar kedua yang harus diingat untuk
 * dipangkas.
 *
 * ⛔ Layar B-22 MENYEBUTKANNYA. Trail berlubang yang terlihat lengkap adalah
 * bentuk paling berbahaya dari trail yang tidak lengkap: manajer yang tidak
 * menemukan perubahan harga di sini akan menyimpulkan tidak ada yang mengubah
 * harga.
 */
export const PERISTIWA_BELUM_DIPANCARKAN: readonly string[] = KUNCI_SPEC.filter(
  (nama) => !adalahPeristiwaAudit(PETA_EJAAN_SPEC[nama] ?? nama)
);

export function kelompokSpec(nama: string): KelompokPeristiwa | null {
  return SPEC[nama] ?? null;
}
