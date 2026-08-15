-- Bootstrap role-level objects for a fresh PostgreSQL cluster.
-- Run once per cluster via db/bootstrap.js (needs real superuser privileges).
-- Idempotent: safe to re-run against a cluster that already has these roles.

DO $do$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'lumi_owner') THEN
    CREATE ROLE lumi_owner LOGIN PASSWORD :'lumi_owner_password'
      NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS;
  END IF;

  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'lumi_app') THEN
    -- NOBYPASSRLS stated explicitly even though it is the default: Gate F0 hinges on
    -- this exact flag, so leaving it implicit here would be a foot-gun.
    CREATE ROLE lumi_app LOGIN PASSWORD :'lumi_app_password'
      NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS;
  END IF;

  -- ⛔ SATU-SATUNYA peran yang dapat melewati RLS di kluster ini, dan ia
  -- TIDAK DAPAT LOGIN.
  --
  -- Kenapa ia perlu ada: resolusi tenant saat login harus mencari email
  -- LINTAS tenant (`resolve_login_tenant`, migrasi 0023), sementara tabel
  -- `"user"` ber-`FORCE ROW LEVEL SECURITY` — yang berlaku untuk PEMILIK
  -- TABEL JUGA. Diukur, bukan diasumsikan: fungsi `SECURITY DEFINER` milik
  -- `lumi_owner` tetap mengembalikan nol baris, dan login gagal untuk
  -- kredensial yang benar.
  --
  -- Itu temuan yang sama yang sudah tercatat di `CLAUDE.md` untuk backfill
  -- `refund.method`: FORCE RLS tidak mengenal pengecualian pemilik.
  --
  -- Kenapa ia aman: `NOLOGIN` berarti tidak ada yang dapat terhubung sebagai
  -- peran ini. Haknya hanya dapat dipakai lewat fungsi `SECURITY DEFINER`
  -- yang ia miliki, dan hari ini hanya ada SATU fungsi seperti itu. Ada test
  -- yang menuntut jumlahnya tetap satu — peran ini bukan tempat menaruh
  -- fungsi kedua "mumpung sudah ada".
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'lumi_resolver') THEN
    CREATE ROLE lumi_resolver NOLOGIN
      NOSUPERUSER NOCREATEROLE NOCREATEDB BYPASSRLS;
  END IF;
END
$do$;

-- ⛔ Di LUAR blok DO.
--
-- `GRANT` tidak sah di dalam plpgsql tanpa `EXECUTE`, dan kesalahannya muncul
-- sebagai syntax error dari scanner — pesan yang tidak menyebut `GRANT` sama
-- sekali, di baris yang bukan barisnya.
--
-- `lumi_owner` harus memegang keanggotaan `lumi_resolver` supaya migrasi
-- dapat menjalankan `ALTER FUNCTION … OWNER TO lumi_resolver`.
GRANT lumi_resolver TO lumi_owner;
