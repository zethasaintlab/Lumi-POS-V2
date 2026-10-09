-- module: ordering (see apps/server/src/modules/README.md)
SET LOCAL lock_timeout = '5s';

-- Nama pemesan, nomor meja, catatan pesanan — keputusan user P5 (b) dan P6 (a),
-- issue #76 komentar 5862870577, 28 September 2026. Sub-proyek 4 memesan per
-- meja dan butuh nomor meja sebagai DATA; nama saja, tanpa nomor telepon.
--
-- ⛔ SATU migrasi untuk ketiganya. Setiap perubahan kolom pada raw table
-- `order` mengubah sidik jari skema lokal dan memaksa SETIAP perangkat
-- membangun ulang tabel rawnya (`disconnectAndClear`); tiga migrasi = tiga
-- unduh ulang riwayat. Sama alasannya dengan 0036.
--
-- Expand saja: nullable, tanpa default, tanpa backfill — klien N-1 tidak
-- mengirimnya dan INSERT lama tetap sah. `check.label` TIDAK disentuh.
--
-- Batas di DATABASE (CHECK, lihat bawah), bukan hanya aplikasi (sumber: packages/domain/src/
-- data-pesanan.ts). `table_number` 16 [ASUMSI], keputusan otonom spec § 12.
--
-- Transaksi selesai tidak di-UPDATE (invariant #2): kolom ini ditulis SEKALI,
-- di INSERT order. RLS tabel `order` sudah berlaku untuk kolom baru.

ALTER TABLE "order"
  ADD COLUMN customer_name text,
  ADD COLUMN table_number text,
  ADD COLUMN note text;

-- ⛔ NOT VALID, dan itu disengaja. `ADD COLUMN ... CHECK` memindai SELURUH
-- tabel `order` di bawah ACCESS EXCLUSIVE; `NOT VALID` hanya menyentuh katalog
-- (lock singkat, di bawah `lock_timeout`) dan TETAP menegakkan batas pada setiap
-- INSERT/UPDATE baru. Baris lama NULL, jadi memang tidak ada yang dilanggar.
--
-- [UTANG] `VALIDATE CONSTRAINT` belum dijalankan. Ia hanya butuh
-- SHARE UPDATE EXCLUSIVE dan dapat menyusul di migrasi terpisah.
ALTER TABLE "order"
  ADD CONSTRAINT order_customer_name_len CHECK (customer_name IS NULL OR length(customer_name) <= 40) NOT VALID,
  ADD CONSTRAINT order_table_number_len  CHECK (table_number  IS NULL OR length(table_number)  <= 16) NOT VALID,
  ADD CONSTRAINT order_note_len          CHECK (note          IS NULL OR length(note)          <= 140) NOT VALID;
