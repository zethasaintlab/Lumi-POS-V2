-- module: tenancy (see apps/server/src/modules/README.md)
SET LOCAL lock_timeout = '5s';

-- B-26 Ambang Otorisasi (`IA:205`) — dua ambang sisanya, per outlet.
--
-- Ambang diskon sudah dapat dikonfigurasi sejak migrasi `0031`; dua ini belum,
-- dan keduanya disebut keputusan 1 Agustus 2026 dalam kalimat yang sama:
-- *"selisih kas >Rp20.000 · no-sale wajib alasan, PIN di atas 3×/shift"*.
-- Angkanya `[ASUMSI]` yang sama, dan itu justru alasannya dapat diubah.
--
-- ⛔ Nullable, TANPA `DEFAULT` — alasan yang sama persis dengan `0031`.
--
-- Bawaannya hidup di `packages/domain/src/buku-kas.ts` (`AMBANG_SELISIH`) dan
-- `packages/domain/src/no-sale.ts` (`AMBANG_NO_SALE`). Kolom ber-`DEFAULT`
-- membuat perubahan bawaan hanya berlaku untuk outlet yang dibuat SESUDAHNYA,
-- dan outlet lama diam-diam memakai angka lama selamanya.
--
-- ⛔ `NULL` BERBEDA dari nol, dan perbedaannya sampai ke perilaku:
--
-- - `cash_variance_threshold = NULL` → pakai bawaan (Rp 20.000).
-- - `cash_variance_threshold = 0`    → SETIAP selisih menuntut otorisasi
--   manajer. Itu pilihan yang sah untuk merchant yang lacinya kecil, dan ia
--   tidak dapat dinyatakan kalau nol diperlakukan sebagai "tidak diatur".
--
-- Hal yang sama untuk `no_sale_threshold = 0`: setiap pembukaan laci menuntut
-- PIN. Yang TIDAK dapat dinyatakan adalah "tidak pernah menuntut PIN" —
-- kontrolnya tidak dapat dimatikan, hanya angkanya yang dapat diubah.
ALTER TABLE outlet
  ADD COLUMN cash_variance_threshold bigint
    CHECK (cash_variance_threshold IS NULL OR cash_variance_threshold >= 0),
  ADD COLUMN no_sale_threshold integer
    CHECK (no_sale_threshold IS NULL OR no_sale_threshold >= 0);

-- ⛔ TIDAK ada kolom untuk MEMATIKAN ambang.
--
-- `spec-f:369` melarang setting yang menonaktifkan audit trail; aturan yang
-- sama berlaku untuk kontrol yang audit trail itu ada untuk mengawasi. Ambang
-- yang dapat dimatikan adalah kontrol yang hilang pada hari seseorang
-- membutuhkannya — dan yang mematikannya adalah orang yang paling ingin ia
-- mati.
--
-- Merchant yang menginginkan "praktis tanpa PIN" menyetel angkanya tinggi. Itu
-- terlihat di layar sebagai angka, tercatat di `audit_event` sebagai
-- `threshold_changed` dengan nilai lama dan barunya, dan dapat dibaca kembali.
-- Sebuah toggle `false` tidak menceritakan apa pun tentang seberapa jauh.
