-- module: ordering (see apps/server/src/modules/README.md)
SET LOCAL lock_timeout = '5s';

-- FR-A2 AC keempat — `spec-a:98`: *"struk mencetak nama variation **hanya**
-- bila item punya >1 variation"*.
--
-- ⛔ CACAT YANG MEMBUAT MIGRASI INI ADA
--
-- `cetak/dokumen.ts` menerima `variationName` di setiap baris dan tidak pernah
-- merendernya sama sekali. Merchant yang menjual "Kopi Susu Regular" dan "Kopi
-- Susu Large" mencetak dua baris struk yang TIDAK DAPAT DIBEDAKAN — dan struk
-- adalah satu-satunya bukti yang pelanggan pegang. Saat ia kembali
-- mempersoalkan ukuran yang ia terima, tidak ada yang dapat menjawabnya.
--
-- ⛔ KENAPA KOLOM, BUKAN ATURAN YANG DITURUNKAN DARI NAMANYA
--
-- Alternatif tanpa migrasi adalah "sebut varian bila namanya berbeda dari nama
-- item". Ia DICOBA dan DIKEMBALIKAN: `spec-c:376` mencetak "2x Kopi Susu"
-- untuk baris yang varian-nya bernama "Regular", jadi aturan itu bertentangan
-- dengan contoh spec sendiri.
--
-- Yang menuntut kolom adalah `spec-b:145`: cetak ulang membangun dokumennya
-- dari `order_line` dan TIDAK BOLEH menyentuh tabel katalog. Jumlah varian
-- karena itu harus ada DI BARISNYA — kalau tidak, cetakan pertama (yang punya
-- katalog di tangan) dan cetak ulang (yang tidak) akan berbeda, tepat pada
-- hari merchant menambahkan varian kedua.
--
-- ⛔ SNAPSHOT, sejajar `cost_at_sale`, `unit_price`, dan `variation_name`
--
-- Ia jumlah varian PADA SAAT PENJUALAN. Merchant yang menambahkan varian
-- kedua besok tidak boleh mengubah struk yang sudah dipegang pelanggan
-- kemarin — dan cetak ulang struk itu harus tetap identik dengan cetakan
-- pertamanya.
--
-- ⛔ DEFAULT 1 UNTUK BARIS LAMA, LALU DROP DEFAULT
--
-- Backfill lintas-tenant mustahil lewat DML: `UPDATE` ditolak
-- `FORCE ROW LEVEL SECURITY` yang berlaku untuk owner juga, sementara
-- `app.tenant_id` hanya dapat bernilai satu tenant. Jalannya `ADD COLUMN …
-- DEFAULT` (DDL, tidak lewat RLS) — pola yang sama dengan `refund.method`
-- (migrasi `0021`).
--
-- Nilai 1 untuk baris lama adalah yang JUJUR: kita tidak tahu berapa varian
-- item itu punya saat penjualan lama terjadi, dan 1 menghasilkan perilaku yang
-- sama dengan hari ini (nama varian tidak tercetak). Ia tidak mengarang
-- informasi baru.
--
-- ⛔ DEFAULT-nya DIBUANG sesudahnya. Default yang tertinggal membuat jalur
-- tulis berikutnya yang lupa mengirimnya diam-diam mengaku "produk ini hanya
-- punya satu varian" — dan nama varian menghilang dari struk tanpa satu pun
-- error. Itu cacat yang PERSIS sama dengan yang migrasi ini perbaiki.
ALTER TABLE order_line
  ADD COLUMN variation_count_at_sale int NOT NULL DEFAULT 1;

ALTER TABLE order_line
  ALTER COLUMN variation_count_at_sale DROP DEFAULT;

-- ⛔ CHECK, bukan sekadar NOT NULL. Nol berarti "item ini tidak punya varian",
-- keadaan yang tidak dapat ada: `POST /items` menuntut minimal satu varian.
-- Nol yang lolos akan membuat `> 1` bernilai false dan nama varian hilang —
-- gejala yang sama dengan default yang tertinggal.
ALTER TABLE order_line
  ADD CONSTRAINT ck_order_line_variation_count CHECK (variation_count_at_sale >= 1);
