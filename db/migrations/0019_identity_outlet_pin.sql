-- module: identity (see apps/server/src/modules/README.md)
SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. `user_outlet` — tabel jembatan yang ERD §3 sebut tapi tidak pernah
--    definisikan
-- ---------------------------------------------------------------------------
--
-- `ERD:143` menulis: "Constraint: UNIQUE(outlet_id, pin_hash) lewat tabel
-- jembatan — PIN unik per outlet, bukan per tenant."
-- `0003_identity.sql:26` mencatat TODO(F1) untuk membangunnya.
--
-- Tabelnya dibangun di sini. Constraint-nya TIDAK — lihat bagian 2.
--
-- Ia menjawab tiga pertanyaan sekaligus, dan ketiganya dibutuhkan Modul F:
--
--   a. PIN unik di outlet MANA (spec-f:126);
--   b. pengguna mana yang hash PIN-nya direplikasi ke perangkat outlet ini
--      (spec-f:124) — tanpa ini, jalur turun harus mengirim seluruh pengguna
--      tenant ke setiap perangkat, termasuk staf outlet lain;
--   c. batas "Manajer Outlet tidak dapat melihat data outlet lain"
--      (spec-f:81), yang AC-nya menuntut penegakan "di lapisan query bukan UI".
--
-- ⛔ BUKAN `user.outlet_id`. Manajer area bekerja di beberapa outlet
-- (spec-f:30), dan kasir yang membantu di cabang lain adalah hal biasa.
-- Kolom tunggal akan memaksa duplikasi baris `"user"` — dan dua baris untuk
-- satu orang menghancurkan atribusi persis seperti PIN yang dibagi.
--
-- `user_role` TIDAK menggantikan tabel ini: owner ber-scope tenant tidak
-- punya baris outlet sama sekali, tapi tetap harus dapat login di perangkat.
CREATE TABLE user_outlet (
  id         text PRIMARY KEY,
  tenant_id  text NOT NULL REFERENCES tenant(id),
  user_id    text NOT NULL REFERENCES "user"(id),
  outlet_id  text NOT NULL REFERENCES outlet(id),
  UNIQUE (user_id, outlet_id)
);
SELECT apply_tenant_rls('user_outlet');

-- Jalur turun menyaring per outlet (sync-config.yaml); ini index yang
-- dipakainya. Arah sebaliknya (user -> outlet) dilayani UNIQUE di atas.
CREATE INDEX ix_user_outlet_outlet ON user_outlet(outlet_id);

COMMENT ON TABLE user_outlet IS
  'Tabel jembatan yang ERD §3 sebut tapi tidak definisikan. Menjawab: PIN unik di outlet mana, pengguna mana yang direplikasi ke perangkat outlet ini, dan batas visibilitas Manajer Outlet.';

-- ---------------------------------------------------------------------------
-- 2. ⛔ `UNIQUE(outlet_id, pin_hash)` TIDAK DIBUAT, dan tidak akan pernah
-- ---------------------------------------------------------------------------
--
-- Constraint di `ERD:143` MUSTAHIL ditegakkan database. Bukan karena tabel
-- jembatannya belum ada — ia sekarang ada — melainkan karena Argon2id
-- memakai salt per pengguna:
--
--     PIN '482913' + salt A  ->  hash X
--     PIN '482913' + salt B  ->  hash Y        X <> Y   (diukur)
--
-- Salt per pengguna adalah syarat Argon2id yang BENAR; tanpanya, dua PIN
-- identik menghasilkan hash identik dan seluruh tabel dapat dipecahkan
-- sekaligus. Jadi yang harus menyerah adalah constraint-nya, bukan salt-nya.
--
-- Unique index atas kolom itu akan hijau selamanya sambil membiarkan dua
-- kasir seoutlet memakai PIN yang sama — tepat keadaan yang `spec-f:126`
-- larang, dan tepat keadaan yang membuat delapan laporan exception di Modul G
-- tidak berguna (spec-f:116).
--
-- Penegakan pindah ke aplikasi: saat PIN diset, PIN baru DIVERIFIKASI
-- terhadap pin_hash setiap pengguna lain di outlet yang sama. Biayanya
-- n x 23 ms dengan n = jumlah staf outlet (< 20), pada operasi yang jarang.
--
-- Ini menuntut perubahan `product/ERD-lumi-pos-v1.md:143`. Dokumen itu milik
-- user; dilaporkan, tidak disunting.

-- ---------------------------------------------------------------------------
-- 3. Kolom PIN yang belum ada
-- ---------------------------------------------------------------------------

-- spec-f:420: "Manajer mereset PIN; reset tercatat; PIN baru wajib diubah
-- kasir saat login pertama." Tanpa kolom ini, PIN yang diketahui manajer
-- tetap berlaku selamanya, dan atribusi kasir itu tidak dapat dipercaya lagi
-- sejak saat reset.
ALTER TABLE "user" ADD COLUMN pin_must_change boolean NOT NULL DEFAULT false;

-- spec-f:135 menolak PIN berupa tanggal lahir pengguna — tapi hanya "jika
-- diketahui". Tanpa kolom ini, aturan itu tidak pernah dapat berjalan sama
-- sekali, dan salah satu dari lima pola PIN lemah menjadi mati sejak lahir.
--
-- Nullable, dan tetap nullable: memaksa merchant memasukkan tanggal lahir
-- setiap kasir hanya untuk mengaktifkan satu aturan PIN adalah pertukaran
-- yang buruk, dan data pribadi yang tidak dibutuhkan lebih baik tidak ada.
ALTER TABLE "user" ADD COLUMN birth_date date;

-- Algoritma yang dipakai hash yang tersimpan. Parameternya sendiri ikut di
-- dalam string PHC; kolom ini menjawab pertanyaan yang lebih kasar — apakah
-- barisnya masih Argon2 sama sekali — supaya migrasi algoritma kelak dapat
-- di-query alih-alih ditebak dengan LIKE atas kolom hash.
ALTER TABLE "user" ADD COLUMN pin_algo text
  CHECK (pin_algo IS NULL OR pin_algo IN ('argon2id'));

-- spec-f:229: "3 penguncian berturut dalam satu jam memperpanjang durasi
-- menjadi 15 menit." Eskalasi itu butuh ingatan yang bertahan melewati
-- restart (spec-f:226) DAN melewati berakhirnya penguncian itu sendiri —
-- pin_locked_until yang sudah lewat tidak menyimpan apa pun tentang berapa
-- kali ia pernah terjadi.
ALTER TABLE "user" ADD COLUMN pin_lockout_count int NOT NULL DEFAULT 0;
ALTER TABLE "user" ADD COLUMN pin_lockout_window_start timestamptz;

COMMENT ON COLUMN "user".pin_must_change IS
  'Diset saat manajer mereset PIN (spec-f:420). Login berikutnya wajib mengganti PIN sebelum melakukan apa pun.';
COMMENT ON COLUMN "user".pin_lockout_count IS
  'Jumlah penguncian di dalam jendela pin_lockout_window_start. Dasar eskalasi 60 detik -> 15 menit (spec-f:229).';
