-- module: catalog (see apps/server/src/modules/README.md)
SET LOCAL lock_timeout = '5s';

-- Gambar produk — DS #8 dicabut lebih jauh, keputusan user 1 September 2026:
-- *"Card harusnya bergambar"*.
--
-- ⛔ TABEL TERPISAH, BUKAN KOLOM DI `item`
--
-- Blob di `item` ikut terseret setiap query katalog, dan `bacaKatalog`
-- berjalan pada SETIAP pembukaan K-03. PostgreSQL menyimpan `bytea` besar di
-- TOAST dan tidak membacanya kecuali kolomnya diseleksi — tetapi jalur turun
-- PowerSync mereplikasi BARIS, bukan kolom yang diseleksi layar, jadi setiap
-- perubahan harga akan memancarkan ulang gambarnya ke seluruh armada.
--
-- Tabel terpisah membuat gambar bergerak hanya saat gambarnya berubah.
--
-- ⛔ `image_url` DI `item` DITINGGALKAN, TIDAK DIHAPUS
--
-- Kolomnya ada sejak F0 dan tidak pernah dibaca, tidak pernah ditulis, tidak
-- pernah ada di sync rules. Menghapusnya adalah migrasi merusak untuk kolom
-- yang tidak merugikan siapa pun; membiarkannya adalah utang yang dinyatakan.
-- Yang TIDAK boleh terjadi adalah dua sumber gambar — dan itu dijaga oleh
-- ketiadaan jalur tulis ke `image_url`, bukan oleh kolomnya.
--
-- ⛔ SATU GAMBAR PER ITEM, dan PK-nya `item_id`
--
-- Bukan `(item_id, urutan)`. Galeri banyak gambar menggandakan anggaran armada
-- untuk kenyamanan yang tidak seorang pun minta, dan kartu grid hanya punya
-- ruang untuk satu. PK pada `item_id` membuat "ganti gambar" menjadi UPSERT
-- alih-alih hapus-lalu-sisip yang meninggalkan jendela tanpa gambar.
--
-- ⛔ PENGECUALIAN YANG DINYATAKAN terhadap invariant #2
--
-- Baris ini DI-UPDATE saat merchant mengganti foto. Invariant #2 menjaga
-- transaksi selesai dan katalog; gambar bukan keduanya — ia setelan tampilan,
-- sejajar `peripheral` yang pengiriman ulangnya memperbarui barisnya. Riwayat
-- perubahannya ada di `audit_event`.

CREATE TABLE item_image (
  item_id     text PRIMARY KEY REFERENCES item(id),
  tenant_id   text NOT NULL REFERENCES tenant(id),

  -- ⛔ `bytea`, bukan URL ke object storage. Keputusan user: object storage
  -- adalah layanan berbayar baru, DAN gambar yang tidak ikut PowerSync
  -- menuntut mekanisme cache KEDUA supaya kartu tidak jadi kotak kosong tepat
  -- saat internet mati — keadaan yang seluruh arsitektur ini ada untuk
  -- mendukungnya.
  bytes       bytea NOT NULL CHECK (octet_length(bytes) > 0),

  -- ⛔ Batasnya DI DATABASE, bukan hanya di aplikasi. Anggaran unduhan setiap
  -- perangkat di armada adalah `batas × jumlah item`; satu jalur tulis yang
  -- lupa memvalidasi menaikkan tagihan data setiap merchant, dan tidak ada
  -- satu pun error yang muncul saat itu terjadi.
  --
  -- 32768 = `BATAS_BYTE` di `packages/domain/src/gambar-produk.ts`, diturunkan
  -- dari pengukuran (`docs/verifikasi/GAMBAR-ANGGARAN.md`), bukan dikarang.
  -- Dua tempat menyimpan angka yang sama, dan penjaganya test yang membaca
  -- keduanya.
  CONSTRAINT item_image_batas_byte CHECK (octet_length(bytes) <= 32768),

  -- Satu-satunya mime yang disimpan. Sumbernya boleh JPEG/PNG; yang mendarat
  -- di sini selalu WebP hasil kanvas klien.
  mime        text NOT NULL CHECK (mime = 'image/webp'),

  width       int  NOT NULL CHECK (width  > 0),
  height      int  NOT NULL CHECK (height > 0),

  -- ⛔ `updated_at` ADA dan `hlc` TIDAK.
  --
  -- HLC menyatakan urutan kausal terhadap peristiwa PERANGKAT. Gambar diunggah
  -- dari back-office, yang tidak punya perangkat dan tidak berhak mengklaim
  -- posisi di dalamnya — alasan yang sama persis dengan `hlc: 0n` pada audit
  -- perubahan back-office. Yang dibutuhkan jalur turun hanyalah "berubah atau
  -- tidak", dan itu yang `updated_at` berikan.
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text NOT NULL REFERENCES "user"(id)
);

SELECT apply_tenant_rls('item_image');

-- Jalur turun menyaring per tenant; index ini yang membuatnya tidak memindai
-- seluruh tabel saat armada besar menarik katalognya.
CREATE INDEX ix_item_image_tenant ON item_image(tenant_id);
