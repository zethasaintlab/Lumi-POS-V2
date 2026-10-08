-- module: ordering (see apps/server/src/modules/README.md)
SET LOCAL lock_timeout = '5s';

-- Nama pemesan, nomor meja, dan catatan pesanan — P5(b) + P6(a), keputusan user
-- 28 September 2026 (issue #76, komentar 5862870577). Tombol toolbar kasir
-- Pelanggan, No. Meja, dan Catatan (spec kasir § 4 baris 4–6).
--
-- ⛔ SATU migrasi untuk ketiga kolom, bukan tiga. `order` adalah raw table
-- PowerSync: setiap kolom baru mengubah sidik jari skema lokal dan memaksa
-- SETIAP perangkat membangun ulang tabel rawnya (`disconnectAndClear()`).
-- Syarat user eksplisit: merchant membayar ongkos itu SEKALI.
--
-- Expand saja: nullable, tanpa default, tanpa backfill — klien versi N-1 tidak
-- mengirim ketiganya dan tidak boleh patah. RLS tidak berubah (kolom baru
-- mewarisi kebijakan `order`).
--
-- Batas panjang ada DI DATABASE juga, bukan hanya di aplikasi:
-- `packages/domain/src/data-pesanan.ts` (`MAKS_NAMA_PEMESAN` 40,
-- `MAKS_NOMOR_MEJA` 16 `[ASUMSI]`, `MAKS_CATATAN` 140). `length()` menghitung
-- code point, sama dengan domain.
--
-- ⛔ `check.label` TETAP NULL dan tidak disentuh. Nama pemesan sengaja kolom
-- terstruktur sendiri: sub-proyek 4 memesan per meja dan butuh nomor meja
-- sebagai DATA. Nama SAJA, tanpa nomor telepon.
--
-- Ketiganya milik transaksi penjualan (invariant #1) dan tidak pernah
-- di-UPDATE sesudah order selesai (invariant #2); tidak ada jalur tulis lain.

ALTER TABLE "order"
  ADD COLUMN customer_name text
    CONSTRAINT ck_order_customer_name_len CHECK (customer_name IS NULL OR length(customer_name) <= 40),
  ADD COLUMN table_number text
    CONSTRAINT ck_order_table_number_len CHECK (table_number IS NULL OR length(table_number) <= 16),
  ADD COLUMN note text
    CONSTRAINT ck_order_note_len CHECK (note IS NULL OR length(note) <= 140);
