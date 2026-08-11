-- module: identity (see apps/server/src/modules/README.md)
SET LOCAL lock_timeout = '5s';

-- FR-F2b — sesi back-office (`spec-f:167`).
--
-- ⛔ Ini BUKAN sesi kasir. `spec-f:183`: "sesi back-office kedaluwarsa; sesi
-- kasir TIDAK — shift yang menentukan." Sesi kasir hidup di SQLite perangkat
-- (`sesi_lokal`), tidak pernah naik, dan tidak punya baris di sini. Menyatukan
-- keduanya akan memberi permukaan kasir sebuah kedaluwarsa yang spec larang —
-- sesi yang habis di tengah antrean pelanggan adalah tepat friksi yang
-- `spec-f:116` sebut menyebabkan berbagi akun.
--
-- Tabel, bukan JWT stateless: `spec-f` menuntut logout benar-benar mengakhiri
-- sesi, dan token stateless tidak dapat dicabut sebelum kedaluwarsa tanpa
-- daftar cabutan — yang ukurannya sama dengan tabel ini, tanpa gunanya.
CREATE TABLE user_session (
  id          text PRIMARY KEY,
  tenant_id   text NOT NULL REFERENCES tenant(id),
  user_id     text NOT NULL REFERENCES "user"(id),
  -- ⛔ HASH, bukan token apa adanya. Sejajar dengan `device.token_hash`
  -- (FR-F12): siapa pun yang dapat membaca tabel ini tidak boleh dapat
  -- menyamar jadi setiap pengguna yang sedang masuk.
  --
  -- SHA-256, bukan Argon2id — dan itu konsisten dengan keputusan yang sama di
  -- `handlers/tokens.ts`: token ini 256 bit dari CSPRNG, bukan rahasia
  -- berentropi rendah yang dipilih manusia. KDF lambat tidak membeli apa pun
  -- dan diverifikasi pada setiap permintaan.
  token_hash  text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  last_seen_at timestamptz
);
SELECT apply_tenant_rls('user_session');

CREATE INDEX ix_user_session_user ON user_session(user_id);

COMMENT ON TABLE user_session IS
  'Sesi back-office (FR-F2b), kedaluwarsa 12 jam. BUKAN sesi kasir — itu murni lokal di perangkat (spec-f:183).';
