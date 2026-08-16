-- module: inventory (see apps/server/src/modules/README.md)
--
-- B-14 opname — satu varian hanya boleh punya SATU baris per opname.
--
-- ⛔ Tanpa constraint ini, petugas yang menyimpan hitungan dua kali untuk
-- varian yang sama menghasilkan dua baris, dan `POST .../complete` menulis
-- movement untuk KEDUANYA. Selisihnya tercatat dua kali, dan stok bergerak
-- dua kali lipat dari yang seharusnya — tanpa satu pun error.
--
-- Ia sekaligus yang membuat `ON CONFLICT (stocktake_id, variation_id)
-- DO UPDATE` mungkin: menyimpan ulang hitungan adalah alur NORMAL (FR-E7:
-- "Opname dapat dijeda dan dilanjutkan"), bukan kesalahan.
--
-- `expected_qty` sengaja tidak ikut di-`UPDATE` oleh klausa itu. Itu
-- pertahanan berlapis, BUKAN yang menjaga waktu T: yang membekukan T adalah
-- penyaring `occurred_at <= snapshot_at` saat nilainya dihitung, dan
-- menghitungnya ulang kapan pun menghasilkan angka yang sama. Klaim
-- sebaliknya sempat tertulis di sini sampai sabotase membuktikannya salah.
--
-- Aman dijalankan: tabelnya belum pernah punya baris — sampai PR ini,
-- `stocktake_line` tidak punya satu pun rute yang menulisinya.
SET LOCAL lock_timeout = '5s';

CREATE UNIQUE INDEX ux_stocktake_line_variation
  ON stocktake_line (stocktake_id, variation_id);
