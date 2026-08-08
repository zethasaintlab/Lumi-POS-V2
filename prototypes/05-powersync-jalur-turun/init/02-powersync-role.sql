\connect lumi

-- Role replikasi PowerSync.
--
-- BYPASSRLS ada di sini dengan sengaja, dan ia layak dibaca pelan-pelan.
--
-- Invariant #8 menuntut APLIKASI terhubung sebagai user yang tunduk RLS. Role
-- ini bukan aplikasi -- ia pembaca replikasi logis, dan replikasi logis
-- membaca WAL, bukan tabel. RLS tidak berlaku pada WAL sama sekali; BYPASSRLS
-- di sini hanya membuat pembacaan awal (snapshot) konsisten dengan apa yang
-- kemudian datang lewat WAL. Tanpa itu, snapshot berisi nol baris sementara
-- WAL berisi semuanya -- perbedaan yang tidak akan pernah terlihat sampai
-- data merchant lain muncul di perangkat yang salah.
--
-- Konsekuensinya harus dinyatakan terang-terangan, bukan disembunyikan di
-- komentar konfigurasi: PADA JALUR TURUN, SYNC RULES ADALAH SATU-SATUNYA
-- BATAS TENANT. RLS tidak menjaga apa pun di sana. T4 dan T5 di prototipe ini
-- ada untuk membuktikan batas itu benar-benar menahan, dan untuk menunjukkan
-- apa yang bocor ketika ia dilepas.
CREATE ROLE powersync_role WITH REPLICATION BYPASSRLS LOGIN PASSWORD 'powersync';

GRANT CONNECT ON DATABASE lumi TO powersync_role;
GRANT USAGE ON SCHEMA public TO powersync_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO powersync_role;

-- `FOR ROLE lumi_owner` bukan hiasan. Tanpa itu, default privileges hanya
-- berlaku untuk tabel yang dibuat oleh role yang MENJALANKAN pernyataan ini
-- (postgres) -- sementara seluruh tabel kami dibuat migrasi sebagai
-- lumi_owner. Akibatnya powersync_role tidak dapat membaca satu tabel pun,
-- dan gejalanya "replikasi berjalan tapi tidak ada data".
ALTER DEFAULT PRIVILEGES FOR ROLE lumi_owner IN SCHEMA public
  GRANT SELECT ON TABLES TO powersync_role;

-- Publication dibuat setelah migrasi berjalan (tabelnya belum ada di sini),
-- oleh tools/siapkan.mjs. Sengaja TIDAK `FOR ALL TABLES`: jalur turun v1
-- hanya membawa katalog, dan publication yang memuat tabel transaksi berarti
-- setiap penjualan ikut melewati WAL decoding tanpa ada yang membutuhkannya.
