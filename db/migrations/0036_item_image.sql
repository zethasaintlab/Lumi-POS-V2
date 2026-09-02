-- module: catalog (see apps/server/src/modules/README.md)
SET LOCAL lock_timeout = '5s';

-- Gambar produk — DS #8 dicabut lebih jauh, keputusan user 1 September 2026:
-- *"Card harusnya bergambar"*.
--
-- ⛔ TEKS BASE64, BUKAN `bytea` — DAN ITU PENCABUTAN YANG DIUKUR
--
-- Versi pertama migrasi ini memakai `bytea` yang turun lewat PowerSync, sesuai
-- keputusan user 1 September. Keputusan itu **ditarik user 2 September 2026**,
-- setelah diukur.
--
-- Alasannya, dan ia bukan "base64 lebih aman": bila byte biner melintas jalur
-- teks dengan salah, muatan 15 byte menjadi **4 byte**, tersimpan sebagai
-- `text` di kolom `BLOB` SQLite — dan TANPA SATU PUN ERROR. `length()`
-- mengembalikan 4, jadi pemeriksaan "ada isinya" bernilai BENAR. Satu-satunya
-- pembeda rusak dari utuh adalah panjang ASLI, angka yang perangkat tidak
-- punya. Terukur: `docs/verifikasi/GAMBAR-ANGGARAN.md` § 5.
--
-- Yang menentukan bukan bahwa base64 lebih aman, melainkan bahwa base64
-- **menghapus KELASNYA**: tidak ada biner yang melintasi transport, jadi tidak
-- ada `put` yang harus menebak representasi mana yang datang.
--
-- ⛔ Jangan mengembalikan `bytea` sebagai "optimasi ukuran". Ia ditolak karena
-- DIUKUR, bukan karena tidak terpikir. Ongkos base64 (+33%) sudah dibayar di
-- anggaran: batas turun 32 KB → 30 KB, dan 500 item = 19,5 MB per perangkat.
--
-- ⛔ DIGANTI DI TEMPAT, bukan lewat migrasi 0037
--
-- `0036` diterapkan pertama kali pada 2 September 2026 di database pengembangan
-- yang dibuat hari itu juga, dengan NOL baris (diperiksa: `pg_stat_user_tables`
-- dan hitungan dalam scope tenant, keduanya 0). Ia belum pernah ada di database
-- merchant mana pun.
--
-- Migrasi kedua akan menjadi perubahan sidik jari skema lokal yang KEDUA, dan
-- setiap perubahan sidik jari memaksa SETIAP perangkat membangun ulang tabel
-- rawnya. Syarat user eksplisit: merchant membayar ongkos itu SEKALI.
--
-- ⛔ PANJANG + CHECKSUM MENEMPEL DI BARIS YANG SAMA
--
-- Base64 menghapus kelas kerusakan biner; ia tidak menghapus kerusakan
-- TRANSPORT (pemotongan, penulisan sebagian). Yang menghapus DIAMNYA adalah
-- `byte` dan `checksum`: perangkat memverifikasi keduanya saat membaca, dan
-- yang tidak cocok menghasilkan keadaan "gambar gagal dimuat" — keadaan yang
-- BERBEDA dari "item ini belum punya gambar".
--
-- ~40 byte per baris untuk menukar kekosongan diam dengan keadaan bernama.
--
-- ⛔ TABEL TERPISAH, BUKAN KOLOM DI `item`
--
-- Teks base64 di `item` ikut terseret setiap query katalog, dan `bacaKatalog`
-- berjalan pada SETIAP pembukaan K-03. Lebih dari itu: jalur turun PowerSync
-- mereplikasi BARIS, bukan kolom yang layar seleksi — jadi setiap perubahan
-- harga akan memancarkan ulang gambarnya ke seluruh armada.
--
-- ⛔ `image_url` DI `item` DITINGGALKAN, TIDAK DIHAPUS
--
-- Kolomnya ada sejak F0 dan tidak pernah dibaca, ditulis, maupun disinkronkan.
-- Menghapusnya adalah migrasi merusak untuk kolom yang tidak merugikan siapa
-- pun. Yang TIDAK boleh terjadi adalah dua sumber gambar — dan itu dijaga oleh
-- ketiadaan jalur tulis ke `image_url`, bukan oleh kolomnya.
--
-- ⛔ SATU GAMBAR PER ITEM, dan PK-nya bernama `id` — BUKAN `item_id`
--
-- Galeri banyak gambar menggandakan anggaran armada untuk kenyamanan yang
-- tidak seorang pun minta, dan kartu grid hanya punya ruang untuk satu. PK
-- tunggal membuat "ganti gambar" menjadi UPSERT alih-alih hapus-lalu-sisip
-- yang meninggalkan jendela tanpa gambar.
--
-- ⛔ Namanya `id`, dan itu TUNTUTAN PowerSync, bukan selera: raw table wajib
-- punya kolom `id` atau core menolaknya saat boot (`Table X has no id
-- column.`) — sudah tercatat di `CLAUDE.md`, dan penjaga T3 menangkap versi
-- pertama migrasi ini yang menamainya `item_id`.
--
-- Kebetulan ia juga lebih jujur: identitas gambar ADALAH identitas itemnya.
-- Satu gambar per item berarti tidak ada identitas kedua untuk disimpan.
--
-- ⛔ PENGECUALIAN YANG DINYATAKAN terhadap invariant #2
--
-- Baris ini DI-UPDATE saat merchant mengganti foto. Invariant #2 menjaga
-- transaksi selesai dan katalog; gambar bukan keduanya — ia setelan tampilan,
-- sejajar `peripheral` yang pengiriman ulangnya memperbarui barisnya. Riwayat
-- perubahannya ada di `audit_event`.

DROP TABLE IF EXISTS item_image;

CREATE TABLE item_image (
  id          text PRIMARY KEY REFERENCES item(id),
  tenant_id   text NOT NULL REFERENCES tenant(id),

  -- WebP hasil kompresi kanvas klien, disandikan base64.
  --
  -- ⛔ Batasnya DI DATABASE, bukan hanya di aplikasi. Anggaran unduhan setiap
  -- perangkat adalah `batas × jumlah item`; satu jalur tulis yang lupa
  -- memvalidasi menaikkan tagihan data setiap merchant, dan tidak ada satu pun
  -- error yang muncul saat itu terjadi.
  --
  -- 40960 = `BATAS_BASE64` di `packages/domain/src/gambar-produk.ts`, yang
  -- DIHITUNG dari `BATAS_BYTE` (30 KB) — bukan diketik dua kali. Penjaganya
  -- test yang membaca kedua berkas.
  data_base64 text NOT NULL
                CHECK (length(data_base64) > 0 AND length(data_base64) <= 40960),

  -- ⛔ Panjang byte HASIL DECODE, bukan panjang teksnya. Ia yang perangkat
  -- bandingkan setelah men-decode; panjang teks sudah dijaga CHECK di atas.
  byte        int NOT NULL CHECK (byte > 0),

  -- FNV-1a 32-bit atas TEKS base64, heks 8 karakter. Bukan kripto dan tidak
  -- perlu: yang dilawan kerusakan transport, bukan pemalsuan.
  checksum    text NOT NULL CHECK (checksum ~ '^[0-9a-f]{8}$'),

  mime        text NOT NULL CHECK (mime = 'image/webp'),
  width       int  NOT NULL CHECK (width  > 0),
  height      int  NOT NULL CHECK (height > 0),

  -- ⛔ `updated_at` ADA dan `hlc` TIDAK.
  --
  -- HLC menyatakan urutan kausal terhadap peristiwa PERANGKAT. Gambar diunggah
  -- dari back-office, yang tidak punya perangkat dan tidak berhak mengklaim
  -- posisi di dalamnya — alasan yang sama persis dengan `hlc: 0n` pada audit
  -- perubahan back-office. Yang jalur turun butuhkan hanya "berubah atau
  -- tidak", dan itu yang `updated_at` berikan.
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text NOT NULL REFERENCES "user"(id)
);

SELECT apply_tenant_rls('item_image');

-- Jalur turun menyaring per tenant; index ini yang membuatnya tidak memindai
-- seluruh tabel saat armada besar menarik katalognya.
CREATE INDEX ix_item_image_tenant ON item_image(tenant_id);
