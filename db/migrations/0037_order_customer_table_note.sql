-- module: ordering (see apps/server/src/modules/README.md)
SET LOCAL lock_timeout = '5s';

-- Nama pemesan, nomor meja, catatan pesanan — sub-proyek 2 Kasir, PR 2C
-- Task 11. P5(b) + P6(a), keputusan user (issue #76 komentar 5862870577 dan
-- 5883887477): TIGA kolom dalam SATU migrasi, supaya sidik jari skema lokal
-- berubah sekali dan perangkat membangun ulang sekali (R4).
--
-- EXPAND saja: nullable, tanpa default. Klien dan server versi N-1 tidak
-- menyentuhnya. Nama saja, tanpa nomor telepon (keputusan user).
-- `check.label` TETAP NULL — nama pemesan bukan label check.
--
-- `customer_name` adalah data pribadi (UU PDP) dan ikut turun ke perangkat
-- lewat stream `riwayat`, terbatas tenant dan perangkat oleh sync rules.
-- `table_number` ≤ 16 adalah [ASUMSI] (spec § 12), mis. "4", "A3".
ALTER TABLE "order"
  ADD COLUMN customer_name text CHECK (customer_name IS NULL OR length(customer_name) <= 40),
  ADD COLUMN table_number  text CHECK (table_number  IS NULL OR length(table_number)  <= 16),
  ADD COLUMN note          text CHECK (note          IS NULL OR length(note)          <= 140);
