-- module: tenancy (see apps/server/src/modules/README.md)
SET LOCAL lock_timeout = '5s';

-- FR-B8 — ambang otorisasi diskon, dapat dikonfigurasi per outlet.
-- `spec-b:273`, keputusan user 1 Agustus 2026.
--
-- ⛔ Kolomnya nullable, TANPA `DEFAULT`.
--
-- Bawaannya (20% / Rp 50.000) hidup di `packages/domain/src/diskon.ts`, dan
-- itu bukan selera: kolom ber-`DEFAULT` membuat perubahan bawaan hanya
-- berlaku untuk outlet yang dibuat SESUDAHNYA, dan outlet lama diam-diam
-- memakai angka lama selamanya. Pola yang sama dengan jendela update F6.
--
-- ⛔ Angkanya `[ASUMSI]`. `spec-b:462` menuntut validasi tiga merchant untuk
-- NILAINYA — bukan untuk keberadaan ambangnya. Yang dapat diubah merchant
-- adalah angkanya; yang tidak dapat dimatikan adalah kontrolnya.
--
-- `numeric(6,4)` untuk persen: konvensi yang SAMA dengan `tax_rate.rate` dan
-- `outlet.service_charge_rate`. Di domain ia `bigint` berskala 10.000, lewat
-- `parseRateToScaled` — jalur uang tidak menyentuh float, dan aturan itu
-- tidak punya pengecualian yang akan disalin ke kolom berikutnya.
ALTER TABLE outlet
  ADD COLUMN discount_threshold_percent numeric(6,4)
    CHECK (discount_threshold_percent IS NULL
           OR (discount_threshold_percent >= 0 AND discount_threshold_percent <= 1)),
  ADD COLUMN discount_threshold_amount bigint
    CHECK (discount_threshold_amount IS NULL OR discount_threshold_amount >= 0);

-- ⛔ TIDAK ada kolom `order.discount_reason_code`.
--
-- Alasan dan penyetuju hidup di `audit_event` — satu tempat, dengan aktor dan
-- penyetuju sebagai dua kolom terpisah dan `CHECK` yang menuntut keduanya
-- berbeda. Menyalinnya ke `order` akan membuat laporan exception FR-G5 punya
-- dua sumber yang harus dijaga sepakat, dan yang menyimpang di antaranya
-- tidak dapat diputuskan mana yang benar. Pola yang sama dengan no-sale
-- (FR-D7), yang juga tidak menulis kolom hitungan di samping jejaknya.
