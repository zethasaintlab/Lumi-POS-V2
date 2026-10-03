-- module: ordering (see apps/server/src/modules/README.md)
SET LOCAL lock_timeout = '5s';

-- Nama pemesan, nomor meja, catatan pesanan (PR 2C Task 11) — keputusan user
-- P5(b) dan P6(a), 28 September 2026 (issue #76 komentar 5862870577):
-- "satukan dengan `order.note` dalam satu migrasi, supaya perangkat hanya
-- membangun ulang sekali". Nama saja, tanpa nomor telepon.
--
-- ⛔ SATU migrasi, tiga kolom: setiap kolom baru di `order` mengubah sidik jari
-- skema lokal dan memaksa SETIAP perangkat mengunduh ulang riwayatnya.
--
-- EXPAND saja: nullable, tanpa default. Klien N-1 tidak mengirimnya dan tidak
-- terpengaruh; baris lama tetap NULL. `check.label` TIDAK disentuh.
--
-- Batas di DATABASE juga, bukan hanya di aplikasi (`packages/domain/src/
-- data-pesanan.ts`: 40/16/140). 16 untuk nomor meja adalah [ASUMSI] spec § 12.
-- Tabel `order` dipartisi; ALTER pada induk merambat ke partisi.

ALTER TABLE "order"
  ADD COLUMN customer_name text CHECK (customer_name IS NULL OR length(customer_name) <= 40),
  ADD COLUMN table_number  text CHECK (table_number  IS NULL OR length(table_number)  <= 16),
  ADD COLUMN note          text CHECK (note          IS NULL OR length(note)          <= 140);
