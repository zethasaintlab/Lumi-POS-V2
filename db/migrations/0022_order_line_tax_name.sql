-- module: ordering (see apps/server/src/modules/README.md)
SET LOCAL lock_timeout = '5s';

-- F5 — nama tarif pajak sebagai SNAPSHOT di `order_line`.
--
-- Keputusan user 15 Agustus 2026, menjawab batas yang PR #12 angkat.
--
-- `order_line` sudah menyimpan `tax_rate_id` dan `tax_rate` sebagai snapshot,
-- tetapi TIDAK namanya. Akibatnya struk yang dicetak ulang hanya dapat
-- menulis "Pajak" — nama tarif hidup di `tax_rate`, dan `spec-b:145` melarang
-- cetak ulang menyentuh tabel katalog.
--
-- ⛔ Yang diperbaiki BUKAN larangannya. Larangan itu benar: struk adalah
-- rekaman historis, dan tarif yang di-rename atau diakhiri setelah transaksi
-- tidak boleh mengubah struk yang sudah tercetak. Yang diperbaiki adalah apa
-- yang tersimpan sebagai snapshot — ia harus lengkap SEJAK DITULIS, bukan
-- dilengkapi belakangan lewat query ke tabel yang mungkin sudah berubah.
--
-- Ini pola yang sama dengan `item_name` dan `variation_name` di tabel ini
-- (`spec-b:115`): salinan nilai, bukan referensi yang diresolusi saat
-- ditampilkan.
--
-- NULLABLE, dan sengaja: baris lama tidak punya namanya dan tidak dapat
-- direkonstruksi tanpa menebak. Cetak ulang untuk baris itu tetap jatuh ke
-- "Pajak", dan itu jujur — bukan mengarang nama tarif yang mungkin salah.
--
-- Backfill TIDAK dilakukan. `UPDATE ... FROM tax_rate` akan menuliskan nama
-- tarif SEKARANG ke transaksi lama, yang persis kesalahan yang kolom ini ada
-- untuk cegah. Baris lama dibiarkan NULL.
ALTER TABLE order_line ADD COLUMN tax_rate_name text;
