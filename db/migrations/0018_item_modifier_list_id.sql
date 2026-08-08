-- module: catalog (see apps/server/src/modules/README.md)
SET LOCAL lock_timeout = '5s';

-- PowerSync menolak raw table tanpa kolom bernama `id`:
--
--   Table item_modifier_list has no id column.
--
-- Bukan konvensi kami -- ekstensi core yang menolaknya
-- (`InferredTableStructure::read_from_database`), diukur di
-- prototypes/04-powersync-raw-tables (T1g). `item_modifier_list` adalah
-- katalog: ia HARUS turun ke perangkat, dan tanpa `id` relasi item<->modifier
-- tidak dapat direplikasi sama sekali -- kasir tidak melihat modifier apa pun.
--
-- `id` di-generate SERVER (randomUUID di handler), menyimpang dari konvensi
-- "ID di-generate klien" di CLAUDE.md. Keputusan user 7 Agustus 2026, dengan
-- alasan yang membatasi penyimpangannya: konvensi itu ada untuk penulisan
-- OFFLINE, dan tabel ini tidak pernah ditulis offline -- ia dikelola lewat
-- REST admin yang online-only lalu turun sebagai data baca. Jangan tarik
-- penyimpangan ini ke tabel yang lahir di perangkat.
--
-- ---------------------------------------------------------------------------
-- Yang HILANG saat primary key pindah, dan penggantinya
-- ---------------------------------------------------------------------------
--
-- PRIMARY KEY (item_id, modifier_list_id) adalah satu-satunya yang menjamin
-- satu item tidak menunjuk modifier list yang sama dua kali. Memindahkannya
-- ke `id` tanpa pengganti menukar satu masalah PowerSync dengan satu cacat
-- data: satu item dengan dua baris "Tingkat gula", dan kasir melihat daftar
-- modifier ganda.
--
-- ux_item_modifier_list_pair adalah penggantinya. Ia WAJIB, bukan pelengkap,
-- dan ia juga yang membuat `ON CONFLICT (item_id, modifier_list_id) DO UPDATE`
-- di handler tetap valid -- tanpanya PostgreSQL menolak klausa itu dan
-- attach-ulang untuk mengubah sort_order patah.
--
-- ---------------------------------------------------------------------------
-- Kenapa TIDAK ada CREATE INDEX CONCURRENTLY di sini
-- ---------------------------------------------------------------------------
--
-- db/migrate.js membungkus setiap berkas migrasi dalam BEGIN/COMMIT, dan
-- CONCURRENTLY dilarang di dalam transaksi. Table lock karena itu diterima
-- secara SADAR, dengan batas yang membuatnya dapat diterima: tabel ini tumbuh
-- dengan ukuran KATALOG (beberapa baris per item), bukan dengan volume
-- penjualan. lock_timeout 5s yang menjaga agar migrasi gagal cepat alih-alih
-- memblokir kasir yang sedang melayani.
--
-- Kalau suatu hari tabel ini ikut tumbuh per transaksi, bentuk migrasi ini
-- tidak lagi aman dan harus dipecah keluar dari transaksi.

-- ---------------------------------------------------------------------------
-- Kenapa backfill-nya DDL, bukan UPDATE
-- ---------------------------------------------------------------------------
--
-- Versi pertama migrasi ini memakai
--
--   ALTER TABLE ... ADD COLUMN id text;
--   UPDATE item_modifier_list SET id = gen_random_uuid()::text WHERE id IS NULL;
--
-- dan GAGAL: `unrecognized configuration parameter "app.tenant_id"`. Sebabnya
-- invariant #8 bekerja persis seperti seharusnya -- FORCE ROW LEVEL SECURITY
-- berlaku untuk PEMILIK tabel juga, jadi UPDATE dari migrasi pun disaring
-- kebijakan RLS, dan kebijakan itu membaca app.tenant_id yang tidak di-set.
--
-- Yang membuat ini berbahaya bukan kegagalannya melainkan perbaikan yang
-- menggoda: `SET LOCAL app.tenant_id = '<sesuatu>'` akan membuat migrasi
-- BERHASIL sambil hanya mengisi baris SATU tenant, dan `SET NOT NULL` di
-- langkah berikutnya baru meledak -- atau lebih buruk, tidak meledak sama
-- sekali kalau kebetulan hanya ada satu tenant di database pengembangan.
-- Mematikan RLS sementara (NO FORCE) juga berhasil, tapi ia membuka jendela
-- di mana invariant #8 tidak berlaku.
--
-- DDL tidak tunduk RLS. Dan DEFAULT yang VOLATILE dievaluasi PER BARIS saat
-- rewrite -- diuji langsung sebelum ditulis di sini, tiga baris menghasilkan
-- tiga UUID berbeda -- jadi satu pernyataan mengisi seluruh baris seluruh
-- tenant tanpa menyentuh RLS sama sekali.

-- 1. expand + backfill sekaligus
ALTER TABLE item_modifier_list ADD COLUMN id text NOT NULL DEFAULT gen_random_uuid()::text;

-- 2. lepaskan default-nya lagi.
--    Ia alat migrasi, bukan perilaku yang diteruskan. Membiarkannya berarti
--    handler yang lupa mengirim `id` tetap berhasil menulis -- diam-diam,
--    dengan id yang tidak pernah dilihat siapa pun. Tanpa default, kelalaian
--    itu gagal keras.
ALTER TABLE item_modifier_list ALTER COLUMN id DROP DEFAULT;

-- 3. pengganti jaminan PK lama -- dipasang SEBELUM PK lama dilepas, supaya
--    tidak pernah ada jendela waktu tanpa penjagaan
ALTER TABLE item_modifier_list
  ADD CONSTRAINT ux_item_modifier_list_pair UNIQUE (item_id, modifier_list_id);

-- 4. contract -- pindahkan primary key
ALTER TABLE item_modifier_list DROP CONSTRAINT item_modifier_list_pkey;
ALTER TABLE item_modifier_list ADD CONSTRAINT item_modifier_list_pkey PRIMARY KEY (id);

COMMENT ON COLUMN item_modifier_list.id IS
  'Surrogate key yang dituntut PowerSync untuk raw table (Table X has no id column). Di-generate SERVER -- tabel ini tidak pernah ditulis offline. Bukan kunci alami: pasangan (item_id, modifier_list_id) yang alami, dan ux_item_modifier_list_pair yang menjaganya.';

COMMENT ON CONSTRAINT ux_item_modifier_list_pair ON item_modifier_list IS
  'Pengganti PRIMARY KEY (item_id, modifier_list_id) yang dilepas di 0018. Tanpa ini satu item dapat menunjuk modifier list yang sama dua kali, dan ON CONFLICT di attachModifierList tidak lagi valid.';
