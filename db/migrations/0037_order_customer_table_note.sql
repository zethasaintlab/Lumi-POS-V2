-- module: ordering (see apps/server/src/modules/README.md)
SET LOCAL lock_timeout = '5s';

-- Nama pemesan, nomor meja, catatan — SATU migrasi, tiga kolom `order`
-- (sub-proyek 2 Kasir, Task 11; keputusan user P5(b) dan P6(a), 28 September
-- 2026, issue #76 komentar 5883887477).
--
-- ⛔ SATU MIGRASI, BUKAN TIGA
--
-- `order` adalah raw table PowerSync: setiap kolom baru mengubah sidik jari
-- skema lokal, dan setiap perubahan itu memaksa SETIAP perangkat menjalankan
-- `disconnectAndClear()` dan mengunduh ulang katalog + riwayat. Syarat user:
-- merchant membayar ongkos itu SEKALI. Tiga migrasi = tiga kali.
--
-- ⛔ EXPAND SAJA — nullable, tanpa default (preseden 0036)
--
-- Klien versi N-1 tidak mengirim ketiganya; server menerima payload tanpa
-- field itu dan baris lama tetap NULL. Tidak ada backfill, tidak ada DROP.
--
-- ⛔ Nama saja, tanpa nomor telepon (keputusan user). `customer_name` adalah
-- data pribadi (UU PDP); jalur turun dibatasi tenant oleh sync rules.
-- `check.label` TETAP NULL dan tidak disentuh.
--
-- Batas panjang di DATABASE, bukan hanya aplikasi; satu di antaranya
-- [ASUMSI]: `table_number` ≤ 16 (spec kasir § 12). Angkanya DISALIN dari
-- `packages/domain/src/data-pesanan.ts`; penjaganya
-- `tests/ordering/data-pesanan.test.js`.
--
-- Pengecualian yang dinyatakan terhadap invariant #2: tidak ada. Kolom ini
-- ditulis SEKALI saat INSERT order; tidak ada jalur UPDATE.

-- ⛔ CHECK ditulis inline (bukan `NOT VALID` + `VALIDATE CONSTRAINT`) dengan alasan:
-- kolomnya baru, jadi SEMUA baris lama NULL dan CHECK `IS NULL OR …` lulus tanpa
-- memindai nilai apa pun; dan runner (`db/migrate.js`) membungkus berkas ini dalam SATU
-- transaksi, sehingga `NOT VALID` memegang kunci ACCESS EXCLUSIVE sampai commit juga —
-- memisahkan VALIDATE di dalam transaksi yang sama tidak mengurangi lamanya kunci.
-- Yang menjaga adalah `lock_timeout` di atas: migrasi gagal cepat, bukan menahan penjualan.
ALTER TABLE "order"
  ADD COLUMN customer_name text
    CONSTRAINT ck_order_customer_name_len CHECK (customer_name IS NULL OR length(customer_name) <= 40),
  ADD COLUMN table_number text
    CONSTRAINT ck_order_table_number_len CHECK (table_number IS NULL OR length(table_number) <= 16),
  ADD COLUMN note text
    CONSTRAINT ck_order_note_len CHECK (note IS NULL OR length(note) <= 140);
