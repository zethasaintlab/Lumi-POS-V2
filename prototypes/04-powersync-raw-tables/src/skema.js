// Skema lokal yang SAMA PERSIS dengan yang dipakai aplikasi dan prototipe 03:
// `db/local/001-initial.sql`, tidak disalin ulang. Menyalinnya berarti menguji
// skema yang bukan skema kami.
import SKEMA_SQL from '../../../db/local/001-initial.sql?raw';

/**
 * Memecah berkas skema jadi pernyataan tunggal.
 *
 * `db.execute()` PowerSync sebenarnya menjalankan seluruh pernyataan dalam satu
 * string (`executeRaw` melakukan iterasi atas `api.statements`), tapi ia hanya
 * mengembalikan hasil pernyataan PERTAMA. Memecahnya di sini membuat kegagalan
 * DDL menunjuk ke pernyataan yang benar-benar gagal, bukan ke seluruh berkas.
 */
export function pernyataanSkema() {
  return SKEMA_SQL.split('\n')
    .map((b) => b.replace(/--.*$/, ''))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Tabel yang direplikasi — kandidat raw table.
//
// TIGA tabel di skema kami sengaja TIDAK ada di sini, dan alasannya berbeda:
//
// - `stock_snapshot` dan `device_config` murni lokal; tidak pernah naik atau
//   turun. Tidak mendeklarasikannya berarti PowerSync tidak tahu keduanya ada,
//   dan itu justru yang kita mau — namanya tidak berawalan `ps_`, jadi
//   `powersync_replace_schema` tidak akan pernah menyentuhnya.
// - `outbox_local` juga lokal, dan ia justru JANTUNG jalur naik kami. Ia harus
//   tetap tidak terlihat oleh PowerSync.
//
// `item_modifier_list` DULU ada di daftar TABEL_TANPA_ID: ia katalog, harus
// turun, tapi primary key-nya komposit dan tidak ada kolom `id`. Migrasi
// PostgreSQL 0018 menambahkannya, jadi ia kini raw table biasa. Yang menjaga
// syarat "raw table wajib punya id" tetap terbukti sekarang `stock_snapshot`
// (lihat TABEL_TANPA_ID) -- uji itu tidak dihapus bersama masalahnya.
export const TABEL_RAW = [
  'category',
  'item',
  'item_variation',
  'modifier_list',
  'modifier',
  'item_modifier_list',
  'tax_rate',
  'order',
  'check',
  'order_line',
  'order_line_modifier',
  'payment',
  'refund',
  'stock_movement',
  'cash_drawer_shift',
  'cash_movement',
  'audit_event',
];

export const TABEL_LOKAL_SAJA = ['outbox_local', 'device_config'];

// Subjek T1g. `stock_snapshot` juga murni lokal -- ia cache hasil agregasi
// `stock_movement`, tidak pernah naik maupun turun -- jadi ia TIDAK perlu
// kolom `id`, dan justru itu yang membuatnya subjek yang benar: ia tetap ada
// sebagai bukti hidup bahwa PowerSync menolak raw table tanpa `id`.
//
// Kalau suatu hari ia diberi `id` juga, T1g kehilangan subjeknya lagi dan
// harus dipindahkan, bukan dihapus.
export const TABEL_TANPA_ID = ['stock_snapshot'];

export const SEMUA_TABEL_KAMI = [
  ...TABEL_RAW,
  ...TABEL_LOKAL_SAJA,
  ...TABEL_TANPA_ID,
];

export const INDEX_KAMI = [
  'ix_order_outlet_date', 'ux_order_receipt', 'ix_order_open',
  'ix_line_order', 'ix_line_variation', 'ix_payment_order', 'ix_payment_pending',
  'ix_mv_stock', 'ix_mv_hlc', 'ix_audit_outlet', 'ix_audit_actor',
  'ix_cash_shift', 'ix_var_barcode', 'ix_item_name', 'ix_outbox_status',
];
