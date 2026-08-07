-- module: ordering (see apps/server/src/modules/README.md)
SET LOCAL lock_timeout = '5s';

-- FR-B7 -- satu order hanya boleh dibatalkan SEKALI.
--
-- Kolom `voided_by_order_id` sudah ada sejak 0007_ordering.sql. Yang belum ada
-- adalah yang menjaganya unik, dan tanpa itu void ganda bukan kemungkinan
-- teoretis:
--
-- AC FR-B7 pertama melarang UPDATE pada order asli, jadi order yang sudah
-- di-void TETAP berstatus `open`. Tidak ada apa pun di statusnya yang menolak
-- void kedua. Aplikasi memeriksanya lewat SELECT, tapi di READ COMMITTED dua
-- transaksi bersamaan sama-sama melihat "belum ada pembatal" dan keduanya
-- menulis. Hasilnya stok dikembalikan dua kali -- selisih yang baru ketahuan
-- saat stock opname, berminggu-minggu kemudian.
--
-- Index unik ini yang menghentikannya, bukan SELECT di aplikasi. SELECT
-- tetap ada supaya kasus normal menjawab 409 yang bisa dijelaskan, bukan
-- pelanggaran constraint mentah.
--
-- Partial (`WHERE ... IS NOT NULL`) karena hampir semua order bukan pembatal;
-- tanpa itu index memuat satu entri NULL per order seumur hidup merchant.
--
-- tenant_id disertakan mengikuti pola index lain di repo ini. Ia tidak
-- diperlukan untuk keunikan -- `voided_by_order_id` menunjuk `order(id)` yang
-- sudah unik global -- tapi ia membuat index dapat dipakai untuk pertanyaan
-- "apakah order ini sudah dibatalkan" tanpa meninggalkan batas tenant.
CREATE UNIQUE INDEX ux_order_voided_by
  ON "order" (tenant_id, voided_by_order_id)
  WHERE voided_by_order_id IS NOT NULL;

COMMENT ON INDEX ux_order_voided_by IS
  'FR-B7: satu order hanya boleh punya satu order pembatal. Kolomnya ada di order PEMBATAL dan menunjuk order yang dibatalkan -- pembacaan sebaliknya menuntut UPDATE pada order asli, yang dilarang AC FR-B7 pertama.';
