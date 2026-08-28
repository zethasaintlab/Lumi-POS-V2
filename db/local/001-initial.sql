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
  -- FR-B8 — ambang otorisasi diskon. Turun ke perangkat karena otorisasi
  -- step-up harus bekerja OFFLINE: klien yang tidak tahu ambangnya akan
  -- menerapkan diskon 90% tanpa satu pun PIN, lalu server menolaknya
  -- berjam-jam kemudian — saat uangnya sudah diterima dan pelanggannya sudah
  -- pulang.
  --
  -- ⛔ NULL berarti "pakai bawaan", dan bawaannya di
  -- `packages/domain/src/diskon.ts`. Bukan DEFAULT kolom: outlet lama akan
  -- diam-diam memakai angka lama selamanya.
  discount_threshold_percent INTEGER,   -- x10000
  discount_threshold_amount INTEGER,
  -- B-26 — dua ambang sisanya, alasan yang SAMA: keduanya diputuskan di
  -- perangkat, dan keduanya offline.
  --
  -- ⛔ Tutup kas (K-12) dan buka laci no-sale (K-16) berjalan tanpa jaringan.
  -- Perangkat yang tidak tahu ambang outletnya memakai bawaan domain, dan
  -- server memakai angka yang merchant setel — kasir yang sama, shift yang
  -- sama, jawaban berbeda. Itu persis bentuk penyimpangan yang
  -- `packages/domain/src/buku-kas.ts` catat saat konstantanya dipindahkan ke
  -- domain.
  cash_variance_threshold INTEGER,
  no_sale_threshold INTEGER,
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

-- F4 — profil printer. Data referensi hardware GLOBAL: tanpa `tenant_id`,
-- dikecualikan dari RLS di server (`db/migrations/0012`). Perintah potong dan
-- laci disimpan sebagai hex berspasi ("1B 40"), supaya menambah model printer
-- adalah menambah baris — bukan menyentuh renderer.
CREATE TABLE printer_profile (
  id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL,
  paper_width_mm INTEGER, chars_per_line INTEGER, codepage TEXT,
  has_cutter INTEGER NOT NULL DEFAULT 0,
  init_command TEXT, cut_command TEXT, drawer_command TEXT,
  image_support INTEGER NOT NULL DEFAULT 0
);

-- F4 — antrean cetak. `ERD:447`.
--
-- ⛔ MURNI LOKAL, tidak direplikasi ke mana pun. Struk adalah artefak
-- perangkat: printer yang gagal di kasir 1 tidak dapat dicetak ulang oleh
-- kasir 2, dan mengirim antrean cetak ke server berarti server menyimpan
-- dokumen yang tidak dapat dipakainya.
--
-- `document` menyimpan dokumen APA ADANYA. Retry karena itu mencetak
-- persis yang gagal — bukan dokumen yang dibangun ulang dan mungkin
-- berbeda karena kode di antaranya berubah.
CREATE TABLE print_job (
  id TEXT PRIMARY KEY NOT NULL, order_id TEXT, peripheral_id TEXT,
  document TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','printed','failed')),
  attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX ix_print_job_pending ON print_job(status, created_at);

-- F6 — telemetri klien (`ARCH:294` § 10). MURNI LOKAL.
--
-- Lima dari delapan metrik `ARCH:296` tidak dapat dihasilkan server: umur
-- antrean, item gagal sinkron, latensi keranjang, crash rate, dan rasio
-- offline. Semuanya terjadi di perangkat, sebagian besar justru saat
-- perangkat TIDAK terhubung.
--
-- ⛔ TIDAK didaftarkan sebagai raw table. Ia tidak pernah turun dari server,
-- dan mendaftarkannya berarti PowerSync membuat VIEW bernama sama di atas
-- `ps_data__telemetry_local` yang bertabrakan dengan tabel ini.
--
-- ⛔ Nilai selalu REAL, tidak pernah TEXT. `ARCH:309` menetapkan batas etis:
-- "tidak pernah mengirim nama produk, harga, nilai transaksi, data pelanggan,
-- atau nama merchant. Metrik dan tipe error saja." Kolom bertipe angka adalah
-- lapisan pertama yang menegakkannya — string tidak punya tempat untuk
-- singgah.
--
-- `tipe` adalah LABEL KATEGORI (`TypeError`, `IDEMPOTENCY_KEY_REUSED`), bukan
-- pesan error: pesan dapat memuat nama produk dan nilai transaksi.
CREATE TABLE telemetry_local (
  id TEXT PRIMARY KEY NOT NULL,
  event TEXT NOT NULL,
  nilai REAL NOT NULL,
  tipe TEXT,
  pada_waktu TEXT NOT NULL
);
-- Pemangkasan buffer membuang yang TERLAMA; index ini yang membuatnya murah.
CREATE INDEX ix_telemetry_waktu ON telemetry_local(pada_waktu);

-- ---------- FEATURE FLAG (murni lokal, disegarkan dari server) ----------
-- `ARCH:358` — kill switch per fitur per merchant, tanpa rilis.
--
-- ⛔ TIDAK didaftarkan sebagai raw table, dan itu keputusan, bukan kelalaian.
-- Menambah raw table mengubah SIDIK JARI skema lokal, dan itu menuntut
-- `disconnectAndClear()` + unduh ulang katalog di SETIAP perangkat merchant.
-- Biaya nyata itu untuk tiga boolean yang dapat diambil satu permintaan HTTP.
--
-- ⛔ Barisnya BERTAHAN saat perangkat offline. Kill switch yang hilang begitu
-- internet mati adalah kill switch yang tidak berlaku justru pada perangkat
-- yang paling sulit dijangkau. Fitur yang tidak punya baris sama sekali
-- mengikuti bawaan `packages/domain/src/fitur.ts` — perangkat yang belum
-- pernah menyegarkan tetap dapat berjualan penuh.
CREATE TABLE fitur_lokal (
  kunci TEXT PRIMARY KEY NOT NULL,
  aktif INTEGER NOT NULL,
  disegarkan_pada TEXT NOT NULL
);

-- KEP-21 — keranjang K-03 yang BERTAHAN melewati muat ulang.
--
-- Sampai sekarang keranjang hanya hidup di memori modul
-- (`apps/kasir/src/kasir/simpanan.ts`): tab yang ter-refresh, tablet yang mati
-- baterai, atau browser yang membuang tab di belakang membuat kasir memasukkan
-- ulang seluruh pesanan di depan pelanggan yang sedang menunggu.
--
-- ⛔ Ini BUKAN `order` berstatus `open`, dan itu keputusan.
--
-- `ERD` menyiapkan `order.status = 'open'` + `owned_by_device_id` untuk
-- keranjang yang bertahan, tapi menulis baris `order` berarti mengirimkannya
-- ke server — dan order `open` yang tidak pernah dibayar lalu muncul di
-- laporan, menuntut jalan penutupan yang belum ada. Ia juga tidak dibutuhkan
-- v1: berbagi order antar device saat offline adalah non-goal yang DINYATAKAN
-- (`PRD` § 4, ditunda ke v1.1). Yang dipecahkan di sini hanya "keranjang
-- perangkat INI hilang saat dimuat ulang", dan untuk itu tabel lokal cukup.
--
-- ⛔ SENGAJA bukan raw table, alasan yang sama dengan `fitur_lokal`: sidik
-- jari skema yang berubah menuntut unduh ulang katalog di setiap perangkat.
--
-- ⛔ SATU baris, dan `id` selalu 'kini'. Perangkat ini punya satu keranjang
-- yang sedang berjalan; primary key konstan membuat "simpan keranjang"
-- menjadi satu UPSERT yang tidak dapat meninggalkan baris yatim, dan membuat
-- mustahil ada dua keranjang yang keduanya mengaku sedang berjalan.
--
-- ⛔ `shift_id` disimpan supaya keranjang milik shift yang SUDAH DITUTUP tidak
-- pernah bangkit. Kasir berikutnya yang membuka shift baru dan menemukan
-- pesanan pelanggan kemarin di layarnya akan menjualnya kepada orang yang
-- salah.
--
-- `isi` adalah JSON `Keranjang` apa adanya (baris + modifier + diskon).
-- Bentuknya milik klien sepenuhnya dan tidak pernah dikirim ke mana pun, jadi
-- ia tidak menuntut kolom per-field maupun kesepakatan dengan skema server.
-- FR-C3/FR-C14 — draf penjualan QRIS DINAMIS yang menunggu konfirmasi gateway.
--
-- ⛔ Kenapa ia harus BERTAHAN, dan kenapa ini bukan kemewahan
--
-- `spec-c:328` menuntutnya sebagai acceptance criteria: *"Aplikasi mati di
-- tengah polling → setelah restart, payment masih `pending_confirmation` dan
-- polling dilanjutkan."*
--
-- Jalur QRIS dinamis menulis order ke SERVER lebih dulu lalu menunggu. Di
-- antara keduanya ada jendela — kadang lima menit penuh — tempat uang sudah
-- (atau sedang) berpindah dan perangkat belum menulis apa pun secara lokal.
-- Tab yang ter-refresh di jendela itu membuat kasir kehilangan seluruh jejak
-- transaksi yang pelanggannya mungkin SUDAH bayar, dan satu-satunya yang tahu
-- adalah server.
--
-- ⛔ SATU baris, `id = 'kini'`, pola yang sama dengan `keranjang_lokal`. Satu
-- perangkat menunggu paling banyak satu QR: kasir tidak dapat melayani
-- pelanggan berikutnya sebelum yang ini selesai, dan dua draf berjalan berarti
-- dua QR di layar yang sama.
--
-- ⛔ Murni lokal, SENGAJA bukan raw table — alasan yang sama dengan
-- `keranjang_lokal` dan `fitur_lokal`: sidik jari skema yang berubah menuntut
-- `disconnectAndClear()` di setiap perangkat merchant.
--
-- `muatan` adalah JSON muatan order yang SUDAH dikirim ke server, apa adanya.
-- Menyimpannya berarti pemulihan tidak perlu menyusun ulang apa pun — dan
-- muatan yang disusun ulang setelah restart dapat berbeda dari yang server
-- terima, karena harga katalog mungkin sudah berubah di antaranya.
CREATE TABLE draf_qris_lokal (
  id            TEXT PRIMARY KEY NOT NULL,
  order_id      TEXT NOT NULL,
  payment_id    TEXT NOT NULL,
  shift_id      TEXT NOT NULL,
  -- Draf `DrafTerkirim` + muatan order, keduanya JSON.
  draf          TEXT NOT NULL,
  muatan        TEXT NOT NULL,
  -- QR yang sedang ditampilkan. Kosong berarti gateway belum menjawab.
  qr_string     TEXT,
  dibuat_pada   TEXT NOT NULL
);

CREATE TABLE keranjang_lokal (
  id TEXT PRIMARY KEY NOT NULL,
  shift_id TEXT NOT NULL,
  isi TEXT NOT NULL,
  diperbarui_pada TEXT NOT NULL
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
  -- `tax_rate_name` adalah SNAPSHOT, sama seperti `item_name`: struk yang
  -- dicetak ulang tidak boleh menyentuh tabel katalog (`spec-b:145`), jadi
  -- namanya harus sudah ada di sini sejak penjualan ditulis.
  tax_rate_id TEXT, tax_rate INTEGER DEFAULT 0, tax_amount INTEGER DEFAULT 0,
  tax_rate_name TEXT,
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
  actor_id TEXT,
  -- ⛔ PENYETUJU, dibekukan dengan alasan yang sama — dan ketiadaannya adalah
  -- cacat yang PERNAH TERJADI, bukan kemungkinan teoretis.
  --
  -- Sebelum kolom ini ada, relay tidak pernah mengirim `X-Approver-Id` sama
  -- sekali, sementara `POST /orders/{id}/cancel` menuntutnya untuk setiap
  -- refund. Akibatnya SETIAP REFUND YANG DIBUAT OFFLINE dijawab
  -- `400 MISSING_APPROVER_ID`, diklasifikasi `gagal-permanen`, dan tidak
  -- pernah sampai ke server — sementara kasir sudah mengembalikan uangnya,
  -- stok sudah kembali, dan laci sudah berkurang. Buku merchant dan server
  -- berpisah tanpa satu pun error.
  --
  -- Direproduksi terhadap server sungguhan lewat transport relay yang sama,
  -- bukan disimpulkan dari membaca kode. Testnya
  -- `tests/ordering/refund-offline-relay.test.js`.
  approver_id TEXT
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
  last_sync_at TEXT,
  -- ⛔ Profil printer yang BERLAKU di perangkat ini, dan alasannya bukan
  -- kenyamanan: sebelum kolom ini ada, K-09 dan K-15 memakai `p[0]` — baris
  -- PERTAMA yang query kembalikan, tanpa `ORDER BY`. Merchant yang punya tiga
  -- model printer tersinkron mencetak dengan profil yang dipilih urutan baris,
  -- bukan dengan profil printer yang benar-benar tercolok — dan gejalanya
  -- struk selebar 80 mm yang dipotong di kolom 32, atau perintah potong yang
  -- tercetak sebagai karakter sampah.
  --
  -- Ia MURNI LOKAL: printer menempel pada perangkat, bukan pada merchant.
  -- Kasir 1 dengan Epson dan kasir 2 dengan Xprinter di outlet yang sama
  -- adalah keadaan normal.
  --
  -- NULL berarti belum dipilih; `profilBerlaku` yang memutuskan apa yang
  -- dipakai sementara itu.
  printer_profile_id TEXT,
  peripheral_id TEXT
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
