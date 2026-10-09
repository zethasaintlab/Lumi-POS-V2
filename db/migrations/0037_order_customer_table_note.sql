-- module: ordering (see apps/server/src/modules/README.md)
SET LOCAL lock_timeout = '5s';

-- Nama pemesan, nomor meja, catatan pesanan — SATU migrasi, TIGA kolom.
-- Keputusan user P5(b) dan P6(a), 28 September 2026 (issue #76 komentar
-- 5862870577): kolom terstruktur, bukan `check.label` (yang tetap NULL),
-- karena sub-proyek 4 memesan per meja dan butuh nomor meja sebagai DATA.
--
-- ⛔ SATU migrasi, bukan tiga: kolom `order` ikut dalam raw table PowerSync
-- perangkat, jadi setiap migrasi tambahan mengubah sidik jari skema lokal lagi
-- dan memaksa setiap perangkat mengunduh ulang riwayat sekali lagi (R4).
--
-- Expand saja: nullable, tanpa default, tanpa backfill. Klien N-1 tidak
-- mengirim ketiganya dan baris lama tetap sah (NULL = "tidak diisi"), jadi
-- server baru di bawah klien lama tidak berubah perilaku (R8: server dulu).
--
-- ⛔ Nama saja, tanpa nomor telepon (keputusan user). `customer_name` adalah
-- data pribadi (UU PDP) yang ikut turun ke perangkat lewat stream `riwayat`,
-- terbatas tenant oleh sync rules. Tidak ada kolom telepon, dan tidak ada
-- pola telepon yang ditolak (Q7: label "Nama pemesan", bukan penolakan pola).
--
-- Batas panjang ditegakkan DI SINI juga, bukan hanya di packages/domain
-- (`data-pesanan.ts`): klien yang melewati handler tetap tidak bisa menulis
-- 10 KB ke struk. 16 untuk nomor meja adalah [ASUMSI] spec § 12.
ALTER TABLE "order"
  ADD COLUMN customer_name text CHECK (customer_name IS NULL OR length(customer_name) <= 40),
  ADD COLUMN table_number  text CHECK (table_number  IS NULL OR length(table_number)  <= 16),
  ADD COLUMN note          text CHECK (note          IS NULL OR length(note)          <= 140);
