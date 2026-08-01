-- module: tenancy (see apps/server/src/modules/README.md)
SET LOCAL lock_timeout = '5s';

-- OQ-09 TERJAWAB (1 Agustus 2026): VerticalProfile hidup di level OUTLET dan
-- mewarisi default dari TENANT. Pusat menetapkan standar, cabang boleh override.
--
-- Skema F0 (0002_tenancy.sql) sudah menyiapkan separuh aturan ini di bawah
-- penanda [ASUMSI]: `outlet.vertical_profile_id` nullable (jalur override), dan
-- `vertical_profile.allow_negative_stock` (FR-E4) sudah jadi kolom sungguhan.
-- Keduanya TIDAK diubah di sini -- keputusan user mengonfirmasi asumsi itu,
-- bukan menggantinya.
--
-- Yang belum bisa dinyatakan skema lama: profil MANA milik tenant yang menjadi
-- default. `vertical_profile.tenant_id` mengizinkan satu tenant punya banyak
-- profil, dan `outlet.vertical_profile_id` boleh NULL -- tapi tidak ada apa pun
-- yang menyatakan ke profil mana outlet ber-NULL itu jatuh kembali. Tanpa ini,
-- separuh "mewarisi default dari tenant" hanya konvensi lisan yang tidak bisa
-- ditegakkan dan tidak bisa di-query.
ALTER TABLE vertical_profile
  ADD COLUMN is_tenant_default boolean NOT NULL DEFAULT false;

-- Tepat satu default per tenant, ditegakkan DATABASE, bukan aplikasi.
-- Partial index (bukan UNIQUE(tenant_id, is_tenant_default)) karena yang
-- dibatasi hanya baris default: satu tenant tetap boleh punya banyak profil
-- non-default untuk dipakai per-outlet sebagai override.
--
-- Sengaja BUKAN `tenant.default_vertical_profile_id`: itu akan membuat siklus
-- FK tenant -> vertical_profile -> tenant, yang mempersulit urutan INSERT dan
-- restore dump tanpa memberi jaminan tambahan apa pun.
CREATE UNIQUE INDEX ux_vertical_profile_tenant_default
  ON vertical_profile (tenant_id)
  WHERE is_tenant_default;

COMMENT ON COLUMN vertical_profile.is_tenant_default IS
  'Profil yang diwarisi outlet ber-vertical_profile_id NULL. Maksimal satu per tenant (ux_vertical_profile_tenant_default). Resolusi: COALESCE(profil_outlet, profil_default_tenant).';
