-- module: identity (see apps/server/src/modules/README.md)
SET LOCAL lock_timeout = '5s';

-- F.5 akses support (`spec-f:391`).
--
-- *"Untuk mendukung ratusan merchant, akses support diperlukan — tetapi harus
-- menjadi fitur SISTEM, bukan akses database langsung."*
--
-- Itu kalimat kuncinya. Alternatif yang tidak dibangun adalah alternatif yang
-- akan dipakai: staf yang tidak punya jalan resmi akan diberi kredensial
-- database, dan sejak saat itu tidak ada satu pun baris yang mencatat siapa
-- membaca apa milik merchant mana.
--
-- ## ⛔ Kenapa BUKAN `admin_user_id` seperti yang spec tulis
--
-- `spec-f:405` menyebut `admin_user_id`, dan kolom itu mengandaikan tabel
-- pengguna STAF yang tidak ada di sistem ini — setiap peran di `spec-f` adalah
-- peran merchant, dan `"user"` ber-`tenant_id` serta tunduk RLS. Batas yang
-- sama sudah dinyatakan untuk `tools/naikkan-tahap.mjs`.
--
-- Yang disimpan karena itu `admin_label`: siapa dari pihak kami yang meminta,
-- sebagaimana merchant menuliskannya saat menyetujui. Ia teks bebas dan itu
-- DISENGAJA — ia bukan otentikasi, ia catatan tentang persetujuan siapa yang
-- diberikan. Yang mengotentikasi adalah `token_hash` di bawah.
--
-- ## ⛔ Read-only adalah BAWAAN, dan menulis menuntut persetujuan TERPISAH
--
-- `spec-f:403`. `is_write_enabled` karena itu `NOT NULL DEFAULT false`, dan
-- tidak ada satu pun jalan menyalakannya di permintaan yang sama dengan
-- pemberian akses: owner yang sedang panik memberi akses cepat tidak boleh
-- memberikan akses tulis tanpa memilihnya sendiri.
CREATE TABLE support_session (
  id           text PRIMARY KEY,
  tenant_id    text NOT NULL REFERENCES tenant(id),
  -- Siapa dari pihak kami. Teks bebas; lihat catatan di atas.
  admin_label  text NOT NULL CHECK (length(trim(admin_label)) > 0),
  -- Owner yang menyetujui. Tanpa baris ini akses support tidak ada.
  granted_by   text NOT NULL REFERENCES "user"(id),
  -- ⛔ Alasan WAJIB dan tidak boleh kosong. Akses ke data merchant yang tidak
  -- menyebutkan untuk apa adalah akses yang tidak dapat dipertanggungjawabkan
  -- enam bulan kemudian, dan `spec-f:405` mendaftarkannya sebagai kolom.
  reason       text NOT NULL CHECK (length(trim(reason)) > 0),
  -- ⛔ HASH, bukan token apa adanya — sejajar `user_session.token_hash` dan
  -- `device.token_hash`. SHA-256: token ini 256 bit dari CSPRNG, bukan rahasia
  -- berentropi rendah yang dipilih manusia.
  token_hash   text NOT NULL UNIQUE,
  started_at   timestamptz NOT NULL DEFAULT now(),
  -- ⛔ Berbatas waktu, dan batasnya ditegakkan DATABASE juga (`spec-f:400`:
  -- default 2 jam, maksimum 24 jam). Aturan yang hanya hidup di aplikasi
  -- adalah aturan yang hilang pada jalan masuk berikutnya.
  expires_at   timestamptz NOT NULL,
  -- Diakhiri lebih awal oleh merchant. `NULL` = belum diakhiri manual; itu
  -- TIDAK berarti masih aktif — `expires_at` yang memutuskan.
  ended_at     timestamptz,
  is_write_enabled boolean NOT NULL DEFAULT false,
  CHECK (expires_at > started_at),
  CHECK (expires_at <= started_at + interval '24 hours'),
  CHECK (ended_at IS NULL OR ended_at >= started_at)
);
SELECT apply_tenant_rls('support_session');

-- Pencarian utama: "apakah tenant ini punya sesi yang sedang aktif?" — dibaca
-- pada setiap permintaan yang membawa token support, dan oleh banner.
CREATE INDEX ix_support_session_aktif
  ON support_session(tenant_id, expires_at)
  WHERE ended_at IS NULL;

-- ⛔ PENANDA yang `spec-f:412` tuntut: *"Setiap tindakan selama sesi support
-- tercatat dengan penanda"*.
--
-- Ia kolom di `audit_event`, bukan jenis peristiwa tersendiri. Tindakan yang
-- dilakukan selama sesi support adalah tindakan yang SAMA — `item_updated`
-- tetap `item_updated` — dan memberinya nama lain berarti setiap laporan yang
-- menyaring per jenis diam-diam melewatkan yang dilakukan support. Yang
-- berubah bukan APA yang terjadi, melainkan ATAS NAMA SIAPA.
--
-- `actor_user_id` tetap owner yang menyetujui: ia orang yang bertanggung
-- jawab atas akses itu, dan kolom itu `NOT NULL` ber-FK ke `"user"` sehingga
-- tidak dapat menampung staf kami. Penanda inilah yang mencegah pembacanya
-- menyimpulkan bahwa ownernya sendiri yang melakukannya.
ALTER TABLE audit_event
  ADD COLUMN support_session_id text;

CREATE INDEX ix_audit_support_session
  ON audit_event(support_session_id, occurred_at)
  WHERE support_session_id IS NOT NULL;
