-- module: identity (see apps/server/src/modules/README.md)
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- Resolusi tenant saat login back-office
-- ---------------------------------------------------------------------------
--
-- ## Masalahnya
--
-- `POST /auth/login` menuntut `X-Tenant-Id`, dan merchant tidak menghafal UUID
-- tenantnya. Layar masuk karena itu punya field "ID Tenant" yang tidak dapat
-- diisi siapa pun tanpa menyalin dari tempat lain — dan merchant yang baru
-- mendaftar tidak punya tempat lain.
--
-- ## ⛔ Kenapa fungsi, dan kenapa SECURITY DEFINER
--
-- `"user"` tunduk RLS. Mencari email lintas tenant karena itu mustahil lewat
-- query biasa: `app.tenant_id` hanya dapat bernilai satu tenant, dan nilainya
-- justru yang sedang dicari. Ayam dan telur, sama seperti pencarian sesi —
-- tapi di sana klien MENGETAHUI tenantnya, di sini tidak.
--
-- Fungsi `SECURITY DEFINER` adalah satu-satunya jalan yang tersisa, dan ia
-- dibuat SESEMPIT mungkin: satu parameter, satu nilai balik, tanpa akses ke
-- kolom lain, tanpa penulisan.
--
-- ⛔ Dan SECURITY DEFINER saja TIDAK CUKUP. `FORCE ROW LEVEL SECURITY`
-- berlaku untuk PEMILIK TABEL juga — temuan yang sudah tercatat di
-- `CLAUDE.md` untuk backfill `refund.method`, dan berlaku persis sama di
-- sini. Fungsi milik `lumi_owner` tetap mengembalikan nol baris, dan login
-- gagal untuk kredensial yang benar. Diukur, bukan diasumsikan.
--
-- Karena itu fungsinya dimiliki `lumi_resolver`: peran NOLOGIN ber-BYPASSRLS
-- yang dibuat `db/bootstrap.sql`. Tidak ada yang dapat terhubung sebagai
-- peran itu; haknya hanya dapat dipakai lewat fungsi yang ia miliki, dan
-- hari ini hanya ada satu.
--
-- ## ⛔ Ia TIDAK diekspos sebagai endpoint
--
-- Endpoint "cari tenant dari email" adalah oracle enumerasi: siapa pun dapat
-- memeriksa email mana yang terdaftar, dan email back-office adalah email
-- owner merchant. `spec-f:148` melarang persis itu ("pesan kegagalan tidak
-- membocorkan keberadaan pengguna").
--
-- Yang memanggilnya hanya `POST /auth/login`, di dalam jalur yang sudah
-- menuntut password dan sudah menjawab SATU pesan untuk setiap kegagalan.
-- Penyerang tidak mendapat apa pun yang tidak sudah dapat ia coba.
--
-- ## ⛔ Email ganda lintas tenant → NULL, bukan tebakan
--
-- Tidak ada UNIQUE global pada `"user".email`, dan tidak dapat ada tanpa
-- melanggar isolasi. Satu orang yang bekerja di dua merchant karena itu
-- mungkin. Mengembalikan salah satunya berarti memasukkannya ke tenant yang
-- SALAH — dengan password yang benar, tanpa satu pun error.
--
-- NULL berarti login gagal dengan pesan yang sama seperti password salah, dan
-- merchant harus menyebut tenantnya secara eksplisit. Jarang, dan jujur.
CREATE OR REPLACE FUNCTION resolve_login_tenant(p_email text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
-- `search_path` dikunci: fungsi SECURITY DEFINER tanpa ini dapat dibajak
-- lewat objek bernama sama di skema yang dikendalikan pemanggil.
SET search_path = pg_catalog, public, pg_temp
STABLE
AS $$
DECLARE
  jumlah int;
  hasil  text;
BEGIN
  SELECT count(*), min(u.tenant_id)
    INTO jumlah, hasil
    FROM public."user" u
   WHERE u.email = p_email
     -- Syarat yang SAMA dengan yang dipakai login itu sendiri. Kalau berbeda,
     -- resolusi dapat menunjuk tenant tempat penggunanya justru tidak dapat
     -- masuk — dan pesannya akan menyalahkan password.
     AND u.email IS NOT NULL
     AND u.password_hash IS NOT NULL
     AND u.is_active = true;

  IF jumlah <> 1 THEN
    RETURN NULL;
  END IF;
  RETURN hasil;
END;
$$;

-- ⛔ Dicabut dari PUBLIC lebih dulu. `SECURITY DEFINER` + EXECUTE untuk
-- PUBLIC berarti setiap peran di database dapat memanggilnya, termasuk peran
-- yang kelak dibuat untuk keperluan lain.
-- ⛔ Pemilik BARU sebuah fungsi wajib punya CREATE di skemanya, kalau tidak
-- ALTER FUNCTION … OWNER TO ditolak dengan "permission denied for schema
-- public" — pesan yang menyalahkan skema, bukan kepemilikannya.
--
-- USAGE + CREATE saja; lumi_resolver tidak diberi hak atas satu tabel pun.
-- Yang membuatnya berbahaya adalah BYPASSRLS, dan itu hanya dapat dipakai
-- lewat fungsi yang ia miliki.
GRANT USAGE, CREATE ON SCHEMA public TO lumi_resolver;

-- ⛔ BYPASSRLS melewati row-level security, TAPI GRANT tingkat tabel tetap
-- berlaku. Tanpa baris ini fungsinya gagal dengan "permission denied for
-- table user" — pesan yang terdengar seperti masalah RLS, padahal bukan.
--
-- SELECT saja, dan HANYA tabel ini. lumi_resolver tidak boleh dapat membaca
-- tabel lain mana pun, apalagi menulis.
GRANT SELECT ON TABLE "user" TO lumi_resolver;

ALTER FUNCTION resolve_login_tenant(text) OWNER TO lumi_resolver;
REVOKE ALL ON FUNCTION resolve_login_tenant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_login_tenant(text) TO lumi_app;

COMMENT ON FUNCTION resolve_login_tenant(text) IS
  'Resolusi tenant untuk login back-office. SECURITY DEFINER karena "user" tunduk RLS dan tenant belum diketahui. Email ganda lintas tenant mengembalikan NULL, bukan tebakan. TIDAK boleh diekspos sebagai endpoint (oracle enumerasi, spec-f:148).';
