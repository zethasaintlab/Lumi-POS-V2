-- module: ordering (see apps/server/src/modules/README.md)
SET LOCAL lock_timeout = '5s';

-- FR-D5 -- refund harus menyatakan lewat APA uangnya dikembalikan.
--
-- Sampai sekarang tabel `refund` tidak punya kolom ini, dan itu tidak terasa
-- selama tidak ada yang menghitung isi laci dari buku kas. Begitu
-- `cash_movement` menjadi sumber tunggal saldo laci (`spec-d:14`), pertanyaan
-- "apakah refund ini mengurangi laci" harus punya jawaban -- hanya refund
-- TUNAI yang mengurangi, dan refund lewat transfer atau pembalikan QRIS tidak
-- menyentuh laci sama sekali.
--
-- Alternatif yang ditolak (keputusan 14 Agustus 2026): menyimpulkannya dari
-- payment order asli. Ia cukup hari ini -- klien v1 menulis satu payment per
-- order dan seluruhnya tunai -- tapi ia tidak punya jawaban untuk pembayaran
-- campuran, yang `spec-d:207` sudah sebut ("pembayaran campuran menghasilkan
-- movement hanya untuk porsi tunai"). Kolom eksplisit menjawab keduanya, dan
-- tidak meninggalkan asumsi yang harus dibongkar nanti di jalur uang.
--
-- Expand-contract: kolom NULLABLE lebih dulu supaya klien versi N-1 -- yang
-- tidak mengirim `method` -- tetap dapat menulis refund. Baris lama diisi
-- 'cash' karena seluruh refund yang pernah ada memang tunai: jalur pembayaran
-- non-tunai (QRIS/EDC) baru mendarat di Modul C sub-project 2, dan tidak ada
-- satu pun refund yang dibuat lewatnya. Menjadikannya NOT NULL adalah langkah
-- CONTRACT terpisah, setelah semua klien mengirimnya.
-- ⛔ Backfill lewat DEFAULT di DDL, BUKAN lewat `UPDATE`.
--
-- `UPDATE refund SET method = 'cash'` gagal di sini, dan kegagalannya benar:
--
--     unrecognized configuration parameter "app.tenant_id"
--
-- `refund` punya FORCE ROW LEVEL SECURITY (invariant #8), jadi kebijakannya
-- berlaku untuk owner tabel juga. Migrasi tidak menyetel `app.tenant_id` --
-- dan tidak boleh, karena backfill ini menyentuh SELURUH tenant sementara
-- `app.tenant_id` hanya dapat bernilai satu tenant. Backfill lintas-tenant
-- lewat DML karena itu mustahil selama RLS aktif, dan itu memang yang
-- diinginkan.
--
-- `ADD COLUMN ... DEFAULT` adalah DDL: ia tidak melewati kebijakan RLS, dan
-- sejak PostgreSQL 11 ia mengisi baris lama tanpa menulis ulang tabel.
--
-- DEFAULT-nya lalu DIBUANG. Kalau ia dibiarkan, klien yang lupa mengirim
-- `method` diam-diam mencatat refund TUNAI -- dan refund tunai mengurangi
-- saldo laci. Default yang tak terlihat di jalur uang adalah persis bentuk
-- cacat yang plan ini perbaiki. Setelah DROP, baris baru tanpa `method`
-- bernilai NULL, dan NULL berarti "tidak diketahui" -- bukan "tunai".
ALTER TABLE refund ADD COLUMN method text DEFAULT 'cash';
ALTER TABLE refund ALTER COLUMN method DROP DEFAULT;

-- Daftar tertutup yang sama dengan `payment.method`. Enum sebagai text +
-- CHECK, mengikuti konvensi data di CLAUDE.md.
ALTER TABLE refund ADD CONSTRAINT refund_method_check
  CHECK (method IS NULL OR method IN ('cash', 'qris_dynamic', 'qris_static', 'card_edc', 'other'));
