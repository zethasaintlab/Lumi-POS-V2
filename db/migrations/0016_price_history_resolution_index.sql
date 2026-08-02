-- module: catalog (see apps/server/src/modules/README.md)
SET LOCAL lock_timeout = '5s';

-- FR-A7 -- resolusi harga tiga tingkat (spec-a-katalog.md:202-209):
--
--   1. price_history (variation, outlet) dengan effective_from terbesar <= waktu transaksi
--   2. bila tidak ada, (variation, outlet = NULL)
--   3. bila tidak ada, item_variation.price
--
-- Tabelnya sudah ada sejak 0004_catalog.sql; yang tidak ada adalah cara
-- menjalankan tangga itu tanpa memindai seluruh riwayat harga tenant. Seluruh
-- 0004 hanya punya satu index (ux_variation_barcode) -- resolusi harga terjadi
-- di jalur penjualan, sekali per baris order, jadi seq scan di sana adalah
-- biaya yang tumbuh seumur hidup merchant.
--
-- Urutan kolom mengikuti aturan equality-dulu-rentang-belakangan: tiga kolom
-- pertama selalu dipakai sebagai kesetaraan, `effective_from` selalu sebagai
-- rentang + ORDER BY. DESC ditulis eksplisit supaya `ORDER BY effective_from
-- DESC LIMIT 1` terlayani tanpa langkah Sort.
--
-- Catatan bentuk query: tangga ini HARUS ditulis sebagai dua lookup terpisah
-- (`outlet_id = $3`, lalu `outlet_id IS NULL`), bukan satu predikat
-- `outlet_id IS NOT DISTINCT FROM $3`. Yang terakhir bukan operator
-- btree-indexable -- diukur lewat EXPLAIN, ia muncul sebagai Filter setelah
-- scan, bukan Index Cond. Lihat tests/schema/price-history.test.js.
CREATE INDEX ix_price_history_resolution
  ON price_history (tenant_id, variation_id, outlet_id, effective_from DESC);

COMMENT ON INDEX ix_price_history_resolution IS
  'Melayani tangga resolusi harga FR-A7. Dua lookup terpisah (outlet_id = $3, lalu outlet_id IS NULL); JANGAN memakai IS NOT DISTINCT FROM -- tidak indexable.';
