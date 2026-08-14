-- Skema SQLite lokal Lumi POS v1 — diturunkan dari /product/ERD-lumi-pos-v1.md
-- Uang: INTEGER rupiah utuh. Kuantitas: INTEGER x1000. ID: TEXT (ULID 26 char).

PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- ---------- KATALOG (direplikasi turun) ----------
CREATE TABLE category (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL,
  parent_id TEXT, sort_order INTEGER DEFAULT 0, color_hint TEXT, archived_at TEXT
);
CREATE TABLE item (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL,
  category_id TEXT, description TEXT, image_url TEXT,
  sort_order INTEGER DEFAULT 0, archived_at TEXT
);
-- ⛔ `cost` SENGAJA TIDAK ADA. FR-F5: "kolom dan field yang memuat
-- cost/margin TIDAK ADA di respons — bukan sekadar disembunyikan di UI."
--
-- Sampai 14 Agustus 2026 ia turun lewat `SELECT *` ke SETIAP perangkat.
-- Perangkat kasir dipakai kasir dan manajer bergantian, jadi tidak ada
-- penyaringan per-peran yang mungkin di satu stream — dan `spec-f:57`
-- menyebut alasannya: kasir punya turnover tinggi, HPP adalah informasi
-- kompetitif merchant.
--
-- Yang membuat penghapusannya MUNGKIN, dan ini baru dapat dipastikan setelah
-- penulisan order klien ada: klien menulis `order_line.cost_at_sale = 0` dan
-- SERVER menghitungnya sendiri lewat `getVariationSnapshot`. Perangkat tidak
-- pernah membutuhkan angka ini untuk apa pun.
CREATE TABLE item_variation (
  id TEXT PRIMARY KEY, item_id TEXT NOT NULL, name TEXT NOT NULL DEFAULT 'Regular',
  sku TEXT, barcode TEXT, price INTEGER NOT NULL,
  stocking_unit TEXT DEFAULT 'pcs', selling_unit TEXT DEFAULT 'pcs',
  conversion_factor INTEGER DEFAULT 1000,
  track_stock INTEGER NOT NULL DEFAULT 1, sort_order INTEGER DEFAULT 0, archived_at TEXT
);
CREATE TABLE modifier_list (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL,
  selection_type TEXT NOT NULL CHECK(selection_type IN ('single','multi')),
  min_selections INTEGER DEFAULT 0, max_selections INTEGER,
  allow_duplicate INTEGER DEFAULT 0, is_required INTEGER DEFAULT 0, archived_at TEXT
);
CREATE TABLE modifier (
  id TEXT PRIMARY KEY, modifier_list_id TEXT NOT NULL, name TEXT NOT NULL,
  price INTEGER NOT NULL DEFAULT 0, is_default INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0, archived_at TEXT
);
-- `id` ada karena PowerSync menolak raw table tanpanya ("Table X has no id
-- column"), bukan karena kunci alaminya berubah. Kunci alaminya tetap
-- pasangan (item_id, modifier_list_id), dan ux_item_modifier_list_pair yang
-- menjaganya sejak primary key pindah. Sejajar dengan migrasi PostgreSQL 0018;
-- bentuk lokal dan server HARUS sama, karena baris ini turun lewat sync.
-- `NOT NULL` ditulis eksplisit, dan itu BUKAN redundan: di tabel rowid,
-- SQLite mengizinkan NULL pada kolom PRIMARY KEY -- bug lama yang
-- dipertahankan demi kompatibilitas. Tanpa baris ini, baris ber-id NULL
-- diterima di perangkat sementara PostgreSQL menolaknya, dan selisih itu baru
-- terlihat saat sync. Ditemukan oleh test, bukan oleh review.
CREATE TABLE item_modifier_list (
  id TEXT PRIMARY KEY NOT NULL,
  item_id TEXT NOT NULL, modifier_list_id TEXT NOT NULL, sort_order INTEGER DEFAULT 0
);
CREATE UNIQUE INDEX ux_item_modifier_list_pair
  ON item_modifier_list(item_id, modifier_list_id);
CREATE TABLE tax_rate (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, outlet_id TEXT,
  name TEXT NOT NULL, type TEXT NOT NULL, rate INTEGER NOT NULL, -- rate x10000
  is_inclusive INTEGER DEFAULT 0, phase TEXT DEFAULT 'subtotal',
  jurisdiction TEXT, channel TEXT DEFAULT 'all',
  applies_to TEXT DEFAULT 'all_items', applies_to_ids TEXT,
  effective_from TEXT NOT NULL, effective_to TEXT
);

-- ⛔ price_history WAJIB turun, dan itu bukan kelengkapan.
-- Harga jual adalah TANGGA tiga tingkat (FR-A7): harga outlet -> harga tenant
-- -> item_variation.price. Tanpa tabel ini perangkat hanya melihat anak tangga
-- paling bawah, dan setiap perubahan harga yang pernah dibuat merchant
-- diabaikan diam-diam saat offline -- kasir menjual dengan harga lama, struk
-- tercetak, dan selisihnya baru terlihat di laporan.
--
-- `changed_by` dan `reason` TIDAK turun: keduanya kolom audit yang tidak
-- dipakai layar kasir mana pun.
CREATE TABLE price_history (
  id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL, variation_id TEXT NOT NULL,
  outlet_id TEXT, price INTEGER NOT NULL, effective_from TEXT NOT NULL
);
CREATE INDEX ix_price_history_resolusi
  ON price_history(variation_id, outlet_id, effective_from);

-- ---------- KONFIGURASI OUTLET (direplikasi turun) ----------
-- Prasyarat FR-D1 yang spec-d sebut langsung: "Katalog dan konfigurasi outlet
-- tersedia lokal." Tanpa ini klien tidak dapat menghitung TANGGAL BISNIS
-- (butuh `timezone` + `business_day_ends_at`) maupun pembulatan tunai (butuh
-- `rounding_increment` + `rounding_mode`) saat offline — dan keduanya adalah
-- angka yang muncul di struk.
--
-- ⛔ `service_charge_rate` adalah `numeric(6,4)` di server dan INTEGER x10000
-- di sini — kelas divergensi yang SAMA PERSIS dengan `tax_rate.rate`, yang
-- dulu mendarat sebagai `0.11` bertipe `real` di kolom INTEGER tanpa satu pun
-- error. Ia terdaftar di SKALA_KOLOM, dan `put` yang ditulis sendiri yang
-- menegakkannya.
CREATE TABLE outlet (
  id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL, name TEXT NOT NULL,
  timezone TEXT NOT NULL, business_day_ends_at TEXT NOT NULL,
  rounding_increment INTEGER NOT NULL DEFAULT 100,
  rounding_mode TEXT NOT NULL DEFAULT 'half_up',
  service_charge_rate INTEGER NOT NULL DEFAULT 0,   -- x10000
  vertical_profile_id TEXT,
  archived_at TEXT
);

-- FR-E4 / OQ-09. Resolusi = COALESCE(profil_outlet, profil_default_tenant),
-- dilakukan di perangkat (packages/domain/src/profil-vertikal.ts) karena
-- peringatan stok harus bekerja offline.
CREATE TABLE vertical_profile (
  id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL, name TEXT NOT NULL,
  allow_negative_stock INTEGER NOT NULL DEFAULT 1,
  is_tenant_default INTEGER NOT NULL DEFAULT 0,
  default_channel TEXT, requires_barcode_flow INTEGER DEFAULT 0,
  default_tax_type TEXT
);

-- ---------- IDENTITAS (direplikasi turun) ----------
-- FR-F3: login berfungsi offline. Itu hanya mungkin bila hash PIN ADA di
-- perangkat (`spec-f:124`) -- verifikasi terjadi lokal, tanpa jaringan.
--
-- ⛔ Kolom di sini SENGAJA lebih sedikit daripada tabel servernya.
-- `password_hash`, `mfa_secret`, dan `email` TIDAK turun: permukaan kasir
-- tidak menerima login password (`spec-f:150`), jadi mengirimkannya hanya
-- menambah bahan yang hilang bersama tablet yang dicuri. Sync rules yang
-- menegakkannya -- daftar kolom eksplisit, bukan SELECT *.
--
-- `pin_hash` sendiri memang harus turun, dan itu diterima dengan sadar:
-- `spec-f:242` mengasumsikan setiap tablet suatu saat berada di tangan yang
-- salah. Yang membatasi kerusakannya adalah Argon2id (bukan hash cepat),
-- cakupan per-outlet, dan enkripsi at-rest yang menunggu Tauri (F4).
CREATE TABLE "user" (
  id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL, name TEXT NOT NULL,
  pin_hash TEXT, pin_algo TEXT,
  pin_must_change INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE user_role (
  id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL,
  role TEXT NOT NULL, scope_type TEXT NOT NULL, scope_id TEXT NOT NULL
);
CREATE TABLE user_outlet (
  id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL, outlet_id TEXT NOT NULL
);

-- ---------- TRANSAKSI (dibuat lokal, naik) ----------
CREATE TABLE "order" (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, outlet_id TEXT NOT NULL,
  device_id TEXT NOT NULL, shift_id TEXT NOT NULL,
  receipt_number TEXT NOT NULL, business_date TEXT NOT NULL, sequence INTEGER NOT NULL,
  status TEXT NOT NULL, channel TEXT NOT NULL DEFAULT 'takeaway',
  owned_by_device_id TEXT,
  subtotal INTEGER NOT NULL, order_discount INTEGER NOT NULL DEFAULT 0,
  service_charge_amount INTEGER NOT NULL DEFAULT 0, tax_amount INTEGER NOT NULL DEFAULT 0,
  rounding_adjustment INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL, amount_due INTEGER NOT NULL,
  has_calculation_variance INTEGER DEFAULT 0, variance_amount INTEGER,
  -- ⛔ Ada di order PEMBATAL, menunjuk order yang dibatalkan (AC FR-B7
  -- pertama: tidak ada UPDATE pada order asli). Tanpa kolom ini, RANTAI
  -- KOREKSI yang `IA:68` tuntut di K-09 tidak dapat dibaca sama sekali, dan
  -- order yang sudah di-void terlihat normal — statusnya tetap `open`.
  --
  -- Hilang dari skema lokal sampai K-08 dibangun, dan tidak ada yang
  -- menangkapnya: penjaga drift hanya membandingkan kolom yang ada di KEDUA
  -- sisi. `KOLOM_SENGAJA_TIDAK_TURUN` sekarang menutup celah itu.
  voided_by_order_id TEXT,
  created_by TEXT NOT NULL, occurred_at TEXT NOT NULL, recorded_at TEXT, hlc INTEGER NOT NULL
);
CREATE TABLE "check" (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL, label TEXT,
  subtotal INTEGER NOT NULL, total INTEGER NOT NULL
);
CREATE TABLE order_line (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL, check_id TEXT NOT NULL,
  variation_id TEXT NOT NULL,
  item_name TEXT NOT NULL, variation_name TEXT NOT NULL,
  unit_price INTEGER NOT NULL, quantity INTEGER NOT NULL,       -- x1000
  modifier_snapshot TEXT, discount_amount INTEGER DEFAULT 0,
  tax_rate_id TEXT, tax_rate INTEGER DEFAULT 0, tax_amount INTEGER DEFAULT 0,
  is_tax_inclusive INTEGER DEFAULT 0, cost_at_sale INTEGER NOT NULL DEFAULT 0,
  line_total INTEGER NOT NULL
);
CREATE TABLE order_line_modifier (
  id TEXT PRIMARY KEY, order_line_id TEXT NOT NULL, modifier_id TEXT,
  name TEXT NOT NULL, price INTEGER NOT NULL, quantity INTEGER NOT NULL DEFAULT 1000
);
CREATE TABLE payment (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL, check_id TEXT NOT NULL,
  method TEXT NOT NULL, amount INTEGER NOT NULL,
  tendered_amount INTEGER, change_amount INTEGER, status TEXT NOT NULL,
  provider TEXT, provider_reference TEXT, terminal_reference TEXT,
  approval_code TEXT, card_last4 TEXT CHECK(card_last4 IS NULL OR length(card_last4)<=4),
  card_brand TEXT, acquirer TEXT, confirmed_manually INTEGER DEFAULT 0,
  mdr_estimated INTEGER, tendered_at TEXT NOT NULL
);
CREATE TABLE refund (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL, amount INTEGER NOT NULL,
  reason_code TEXT NOT NULL, reason_note TEXT,
  -- Lewat apa uangnya dikembalikan. Hanya `cash` yang mengurangi saldo laci
  -- (`spec-d:14`); refund lewat transfer atau pembalikan QRIS tidak menyentuh
  -- laci sama sekali. NULL berarti TIDAK DIKETAHUI, bukan tunai — lihat
  -- db/migrations/0021_refund_method.sql.
  method TEXT,
  created_by TEXT NOT NULL, approved_by TEXT NOT NULL,
  occurred_at TEXT NOT NULL, recorded_at TEXT, hlc INTEGER NOT NULL
);
CREATE TABLE stock_movement (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, outlet_id TEXT NOT NULL,
  device_id TEXT, variation_id TEXT NOT NULL, type TEXT NOT NULL,
  delta INTEGER NOT NULL,                                        -- x1000
  order_id TEXT, stocktake_id TEXT, reason_code TEXT, note TEXT, unit_cost INTEGER,
  created_by TEXT, occurred_at TEXT NOT NULL, recorded_at TEXT, hlc INTEGER NOT NULL
);

-- FR-E5 — penandaan habis MANUAL, terpisah dari stok terhitung.
--
-- `spec-e:220`: "Produk dapat ditandai habis meskipun stok tercatat masih 10
-- (mis. bahan habis, mesin rusak)." Keduanya disimpan terpisah dan tidak
-- pernah saling menyimpulkan.
--
-- ⛔ Tabel LOG, bukan satu baris per produk: tidak ada unique constraint pada
-- (outlet_id, variation_id), sama seperti servernya. Dua perangkat yang
-- menandai produk yang sama saat offline sama-sama menulis, dan yang menang
-- ditentukan HLC — bukan baris yang kebetulan ditulis belakangan.
CREATE TABLE sold_out_flag (
  id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL, outlet_id TEXT NOT NULL,
  variation_id TEXT NOT NULL,
  is_sold_out INTEGER NOT NULL DEFAULT 0,
  set_by TEXT NOT NULL, set_at TEXT NOT NULL, hlc INTEGER NOT NULL
);
CREATE INDEX ix_sold_out_terbaru ON sold_out_flag(outlet_id, variation_id, hlc);

-- stock_snapshot: cache lokal hasil agregasi stock_movement, dibangun ulang
-- saat tutup shift (bukan direplikasi naik/turun) — bentuk dan alasan index
-- ix_mv_hlc di bawah sudah diukur, lihat prototypes/01-sqlite-sizing/FINDINGS.md §5.
CREATE TABLE stock_snapshot (
  tenant_id TEXT NOT NULL, outlet_id TEXT NOT NULL, variation_id TEXT NOT NULL,
  balance INTEGER NOT NULL, -- x1000
  checkpoint_hlc INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, outlet_id, variation_id)
) WITHOUT ROWID;

CREATE TABLE cash_drawer_shift (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, outlet_id TEXT NOT NULL,
  device_id TEXT NOT NULL, business_date TEXT NOT NULL, status TEXT NOT NULL,
  opening_float INTEGER NOT NULL, opened_by TEXT, opened_at TEXT,
  counted_amount INTEGER, expected_amount INTEGER, difference INTEGER,
  count_attempts TEXT, variance_reason_code TEXT, variance_note TEXT,
  closed_by TEXT, approved_by TEXT, closed_at TEXT
);
CREATE TABLE cash_movement (
  id TEXT PRIMARY KEY, shift_id TEXT NOT NULL, type TEXT NOT NULL,
  delta INTEGER NOT NULL, order_id TEXT, counterpart_type TEXT NOT NULL,
  reason_code TEXT, note TEXT, created_by TEXT,
  occurred_at TEXT NOT NULL, recorded_at TEXT, hlc INTEGER NOT NULL
);
CREATE TABLE audit_event (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, outlet_id TEXT, device_id TEXT,
  actor_user_id TEXT NOT NULL, approver_user_id TEXT,
  event_type TEXT NOT NULL, entity_type TEXT, entity_id TEXT,
  before TEXT, after TEXT, reason_code TEXT, reason_note TEXT,
  occurred_at TEXT NOT NULL, recorded_at TEXT, hlc INTEGER NOT NULL
);

-- ---------- LOKAL-ONLY ----------
-- FR-H1. `depends_on` menunjuk `outbox_local.id` lain, dan ia bukan
-- kenyamanan: spec menuntut urutan dependensi dihormati (shift sebelum order)
-- SEKALIGUS item gagal tidak memblokir item independen. Tanpa penanda ini,
-- satu-satunya cara memenuhi keduanya adalah membiarkan item yang bergantung
-- gagal sendiri di server -- yang MEMBAKAR counter percobaannya, dan menandai
-- order yang sempurna sebagai `failed` permanen hanya karena shift-nya lambat.
--
-- Sengaja TANPA foreign key. Item yang sudah terkirim boleh dipangkas kelak,
-- dan FK akan menahan pemangkasan itu justru saat antrean paling perlu
-- diringankan. Relay memperlakukan dependensi yang tidak ditemukan sebagai
-- sudah selesai.
CREATE TABLE outbox_local (
  id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  operation TEXT NOT NULL, payload TEXT NOT NULL, idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER DEFAULT 0,
  last_error TEXT, last_attempt_at TEXT, created_at TEXT NOT NULL,
  depends_on TEXT,
  -- ⛔ Aktor dibekukan saat item DIBUAT, bukan dibaca saat item dikirim.
  -- Antrean dapat terkuras berjam-jam kemudian, mungkin setelah pergantian
  -- shift: memakai "siapa yang sedang masuk" akan mencatat penjualan Sari
  -- atas nama Budi di `X-Actor-Id`, dan audit server percaya begitu saja.
  actor_id TEXT
);
-- Identitas perangkat + counter lokalnya. Satu baris, dipaksa CHECK: satu
-- pemasangan aplikasi adalah satu perangkat, dan `device_code` sebagai
-- primary key dulu menyiratkan sebaliknya.
--
-- ⛔ `token_secret` disimpan APA ADANYA. AC ketiga FR-F12 menuntut database
-- lokal terenkripsi dengan kunci di keystore OS, dan itu menunggu Tauri (F4).
-- Sampai itu ada, siapa pun yang dapat membaca berkas database perangkat
-- dapat menyamar jadi perangkat itu sampai kredensialnya dicabut. Dicatat di
-- HANDOFF, bukan disembunyikan.
CREATE TABLE device_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  device_id TEXT NOT NULL,
  device_code TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  outlet_id TEXT NOT NULL,
  base_url TEXT NOT NULL,
  token_secret TEXT,
  receipt_sequence INTEGER DEFAULT 0, sequence_business_date TEXT,
  -- ⛔ `hlc_state` INTEGER dipertahankan HANYA untuk perangkat lama; jangan
  -- dipakai lagi. HLC adalah bilangan 57-bit, dan kolom INTEGER membuatnya
  -- kembali sebagai `number` JavaScript yang SUDAH kehilangan presisi di atas
  -- 2^53. Ditemukan dengan menjalankan aplikasi: nilai yang ditulis
  -- 117089592062246913 dibaca sebagai ...912, ditolak parser, lalu HLC jatuh
  -- ke jam dinding — yang sedang mundur. HLC turun setelah restart, dan tidak
  -- ada satu pun error.
  --
  -- `hlc_teks` adalah kolom yang berlaku. Ia TEXT karena hanya teks yang
  -- melewati SQLite dan JavaScript tanpa menyentuh double.
  --
  -- Kolom lama tidak dibuang: `device_config` murni lokal dan bermigrasi
  -- ADITIF (ALTER TABLE ADD COLUMN), dan SQLite tidak dapat mengubah tipe
  -- kolom sama sekali.
  hlc_state INTEGER DEFAULT 0,
  hlc_teks TEXT,
  last_sync_at TEXT
);
-- Sidik jari bentuk raw table pada saat skema terakhir dipasang di perangkat
-- ini. Ia menggantikan nomor versi yang ditulis tangan, dan alasannya bukan
-- kerapian: nomor versi harus DIINGAT untuk dinaikkan, dan yang lupa dinaikkan
-- menghasilkan tepat keadaan paling berbahaya di jalur turun -- tabel dibangun
-- ulang tanpa `disconnectAndClear()`, katalog kosong permanen, dan
-- `waitForFirstSync()` melaporkan sukses dalam 0 ms.
--
-- Satu baris, dipaksa oleh CHECK. Murni lokal: PowerSync tidak boleh tahu ia
-- ada, sama seperti `outbox_local`.
CREATE TABLE skema_lokal (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  sidik_raw_table TEXT NOT NULL,
  dipasang_pada TEXT NOT NULL
);

-- Sesi kasir yang sedang berjalan. Satu baris, dipaksa CHECK: satu perangkat
-- melayani satu kasir pada satu waktu (`IA:2.1` -- topbar menampilkan satu
-- nama).
--
-- ⛔ MURNI LOKAL, dan itu bukan penyederhanaan. `spec-f:183`: "sesi
-- back-office kedaluwarsa; sesi kasir TIDAK -- shift yang menentukan." Sesi
-- kasir tidak punya padanan di server, tidak direplikasi, dan tidak pernah
-- naik. Yang naik adalah `audit_event` login/logout-nya.
CREATE TABLE sesi_lokal (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  user_id TEXT NOT NULL,
  nama TEXT NOT NULL,
  peran TEXT NOT NULL,              -- JSON array; sesi tidak menyimpan matriks, hanya peran
  masuk_pada TEXT NOT NULL,
  wajib_ganti_pin INTEGER NOT NULL DEFAULT 0
);

-- FR-F4. Penguncian PIN per PENGGUNA (`spec-f:236`), bukan per perangkat --
-- kasir lain yang PIN-nya benar tidak boleh ikut terhalang.
--
-- ⛔ Tabel, bukan variabel di memori. `spec-f:226`: "perangkat di-restart ->
-- penguncian TETAP berlaku (disimpan persisten, bukan di memori)". Penguncian
-- yang hilang saat restart adalah penguncian yang dapat dilewati siapa pun
-- yang dapat mematikan tablet.
--
-- Ia lokal-saja dan tidak pernah naik: server memegang hitungannya sendiri
-- lewat POST /users/{id}/pin-attempts, dan yang di sini adalah yang berlaku
-- saat offline -- keadaan yang `spec-f:221` tuntut tetap dijaga PENUH.
CREATE TABLE pin_lockout_lokal (
  user_id TEXT PRIMARY KEY NOT NULL,
  gagal_berturut INTEGER NOT NULL DEFAULT 0,
  terkunci_sampai TEXT,
  jumlah_penguncian INTEGER NOT NULL DEFAULT 0,
  jendela_mulai TEXT
) WITHOUT ROWID;

-- ---------- INDEX (dari ERD §15) ----------
CREATE INDEX ix_order_outlet_date   ON "order"(tenant_id, outlet_id, business_date);
CREATE UNIQUE INDEX ux_order_receipt ON "order"(device_id, business_date, sequence);
CREATE INDEX ix_order_open          ON "order"(status) WHERE status='open';
CREATE INDEX ix_line_order          ON order_line(order_id);
CREATE INDEX ix_line_variation      ON order_line(variation_id, id);
CREATE INDEX ix_payment_order       ON payment(order_id);
CREATE INDEX ix_payment_pending     ON payment(status) WHERE status='pending_confirmation';
CREATE INDEX ix_mv_stock            ON stock_movement(tenant_id, outlet_id, variation_id, occurred_at);
CREATE INDEX ix_mv_hlc              ON stock_movement(tenant_id, outlet_id, hlc);
CREATE INDEX ix_audit_outlet        ON audit_event(tenant_id, outlet_id, occurred_at);
CREATE INDEX ix_audit_actor         ON audit_event(actor_user_id, occurred_at);
CREATE INDEX ix_cash_shift          ON cash_movement(shift_id);
CREATE INDEX ix_var_barcode         ON item_variation(barcode);
CREATE INDEX ix_item_name           ON item(name);
CREATE INDEX ix_outbox_status       ON outbox_local(status, created_at);
