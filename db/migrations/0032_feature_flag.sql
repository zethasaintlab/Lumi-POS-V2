-- module: rilis (see apps/server/src/modules/README.md)
SET LOCAL lock_timeout = '5s';

-- Feature flag dan kill switch. `ARCH:358`, KEP-36.
--
-- "Feature flag: terpisah dari rilis; fitur berisiko dikirim mati, dinyalakan
-- per merchant. Kill switch: per fitur per merchant, dari server tanpa rilis
-- — kebutuhan operasional, bukan kemewahan."
--
-- ===========================================================================
-- ⛔ Tabel ini menyimpan PENYIMPANGAN saja
-- ===========================================================================
--
-- Bawaan setiap fitur hidup di `packages/domain/src/fitur.ts`, bukan sebagai
-- `DEFAULT` kolom di sini. Pola yang sama dengan ambang diskon dan jendela
-- update, dan alasannya sama: kolom ber-default membuat perubahan bawaan
-- hanya berlaku untuk baris yang dibuat sesudahnya.
--
-- Konsekuensinya: merchant yang tidak punya baris mendapat bawaan kode, dan
-- itu keadaan normal untuk hampir seluruh merchant. Tabel ini akan tetap
-- hampir kosong, dan itu benar.
--
-- ===========================================================================
-- ⛔ DIKECUALIKAN dari RLS, sejajar `app_release` dan `printer_profile`
-- ===========================================================================
--
-- Flag adalah keputusan OPERATOR, bukan data merchant: merchant tidak dapat
-- menyalakan fitur yang kami matikan untuknya, dan alat yang menulisnya
-- memakai kredensial migrasi (`DATABASE_MIGRATION_URL`). `FORCE ROW LEVEL
-- SECURITY` berlaku untuk owner juga, jadi tabel ber-RLS tidak dapat ditulis
-- lintas tenant oleh alat operator sama sekali — itu yang dipelajari saat
-- backfill `refund.method` (migrasi 0021).
--
-- Konsekuensinya DINYATAKAN: setiap pemanggil yang tunduk RLS tetap dapat
-- MEMBACA seluruh baris tabel ini. Yang dibacanya adalah nama fitur, sebuah
-- tenant id, dan sebuah boolean — tidak ada nama merchant, tidak ada angka
-- uang, tidak ada satu pun kolom yang menjelaskan bisnis siapa pun.
--
-- Yang menjaga agar itu tidak berubah adalah `tests/kasir/fitur-penjaga.test.js`:
-- hanya SATU fungsi yang boleh menyentuh tabel ini, dan ia menyaring tenant.
CREATE TABLE feature_flag (
  id          uuid PRIMARY KEY,

  -- Kosakatanya SAMA dengan `FITUR` di `packages/domain/src/fitur.ts`, dan
  -- ada test yang membandingkan keduanya. ⛔ TANPA CHECK constraint yang
  -- menyebut daftarnya: kunci yang dihapus dari kode harus tetap dapat
  -- dibaca dan dihapus barisnya, dan CHECK membuat baris lama tidak dapat
  -- disentuh sama sekali setelah kuncinya hilang dari daftar.
  --
  -- Yang menjaga kunci asing tidak menyalakan apa pun adalah `resolusiFitur`,
  -- yang membaca kunci tak dikenal sebagai MATI.
  key         text NOT NULL CHECK (key <> ''),

  -- ⛔ NULL berarti penyimpangan GLOBAL — seluruh merchant. Itu yang membuat
  -- "matikan fitur ini di mana-mana sekarang juga" mungkin tanpa rilis, dan
  -- `ARCH:358` menyebut itu kebutuhan operasional.
  --
  -- TANPA foreign key ke `tenant`. FK ke tabel ber-RLS dicek dengan privilese
  -- owner dan tidak tunduk `FORCE ROW LEVEL SECURITY` (temuan F1), jadi ia
  -- tidak membuktikan apa pun tentang tenant yang benar; sementara ia MEMBUAT
  -- baris flag tidak dapat dihapus saat tenantnya dihapus. Nilai yang tidak
  -- cocok tenant mana pun tidak berbahaya: ia tidak pernah cocok saat
  -- resolusi, jadi ia tidak menyalakan maupun mematikan apa pun.
  tenant_id   uuid,

  enabled     boolean NOT NULL,

  -- Kenapa. Untuk OPERATOR, tidak pernah ditampilkan ke merchant: alasan
  -- kill switch biasanya menyebut dugaan fraud, dan menampilkannya ke pihak
  -- yang sedang diselidiki menghapus gunanya.
  reason      text,

  updated_at  timestamptz NOT NULL DEFAULT now(),
  -- Siapa. Operator, bukan pengguna merchant — karena itu `text`, bukan FK
  -- ke `"user"`, dan pola yang sama dengan `app_release`.
  updated_by  text NOT NULL
);

-- ⛔ DUA index unik, bukan satu.
--
-- PostgreSQL memperlakukan NULL sebagai tidak-sama-dengan-NULL di index unik,
-- jadi `UNIQUE (key, tenant_id)` tunggal akan mengizinkan DUA baris global
-- untuk fitur yang sama — dan "mana yang berlaku" lalu tidak punya jawaban.
-- Index parsial di bawah menutupnya.
CREATE UNIQUE INDEX ux_feature_flag_global ON feature_flag (key) WHERE tenant_id IS NULL;
CREATE UNIQUE INDEX ux_feature_flag_tenant ON feature_flag (key, tenant_id) WHERE tenant_id IS NOT NULL;

-- Resolusi membaca seluruh baris untuk satu tenant plus seluruh baris global.
CREATE INDEX ix_feature_flag_lookup ON feature_flag (key, tenant_id);
