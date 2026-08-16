-- module: ordering (see apps/server/src/modules/README.md)
--
-- B-02 — pencarian nomor struk.
--
-- Kasus pemakaian utamanya satu kalimat: pelanggan datang membawa struk dan
-- mengeluh. Tanpa index, pencariannya sequential scan atas seluruh riwayat
-- transaksi merchant.
--
-- ⛔ B-Tree biasa, BUKAN UNIQUE (keputusan user 16 Agustus 2026).
--
-- UNIQUE terlihat menggoda karena `spec-h` I2 berbunyi "satu nomor struk =
-- tepat satu order di server". Tapi invariant itu SUDAH ditegakkan, lewat
-- kolom lain: `UNIQUE (device_id, business_date, sequence)` di migrasi 0007,
-- dan nomor struk diturunkan dari ketiganya. Menambah UNIQUE kedua di sini
-- tidak membeli jaminan baru — ia hanya menambah cara baru bagi migrasi untuk
-- GAGAL pada database yang sudah memuat data.
--
-- ⛔ Batas yang dinyatakan, bukan didiamkan: pencarian memakai
-- `ILIKE '%...%'` (keputusan user yang sama), dan wildcard di AWAL pola
-- membuat index ini TIDAK terpakai untuk pencarian itu. Yang menahan biayanya
-- adalah penyaring rentang tanggal yang selalu ikut — scan-nya terbatas pada
-- rentang yang diminta, bukan seluruh riwayat.
--
-- Index ini tetap berguna: pencarian setara (`=`) dan pengurutan menurut nomor
-- struk memakainya. Kalau kelak pencarian sebagian menjadi lambat pada
-- merchant sungguhan, jawabannya `pg_trgm` + GIN — ekstensi baru, dan itu
-- keputusan tersendiri.
SET LOCAL lock_timeout = '5s';

CREATE INDEX ix_order_receipt ON "order"(tenant_id, receipt_number);
