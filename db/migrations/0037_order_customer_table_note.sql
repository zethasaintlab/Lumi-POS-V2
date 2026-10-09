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
-- Batas di DATABASE, bukan hanya aplikasi (sumber: packages/domain/src/
-- data-pesanan.ts). `table_number` 16 [ASUMSI], keputusan otonom spec § 12.
--
-- Transaksi selesai tidak di-UPDATE (invariant #2): kolom ini ditulis SEKALI,
-- di INSERT order. RLS tabel `order` sudah berlaku untuk kolom baru.

ALTER TABLE "order"
  ADD COLUMN customer_name text
    CHECK (customer_name IS NULL OR length(customer_name) <= 40),
  ADD COLUMN table_number text
    CHECK (table_number IS NULL OR length(table_number) <= 16),
  ADD COLUMN note text
    CHECK (note IS NULL OR length(note) <= 140);
