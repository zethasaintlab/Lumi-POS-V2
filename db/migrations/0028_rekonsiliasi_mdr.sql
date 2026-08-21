-- module: tenancy + ordering (see apps/server/src/modules/README.md)
SET LOCAL lock_timeout = '5s';

-- Modul C-3 — rekonsiliasi (FR-C12) dan ekspor rekapitulasi (FR-C13).
--
-- Dua kolom, dua fitur, satu migrasi karena keduanya aditif dan tidak saling
-- bergantung.
--
-- ===========================================================================
-- 1. `tenant.merchant_category` — FR-C12
-- ===========================================================================
--
-- AC FR-C12 ketiga: *"Kategori merchant dapat dikonfigurasi per tenant."*
--
-- Kategori menentukan tarif MDR yang dipakai untuk MEMPERKIRAKAN potongan
-- settlement (`packages/domain/src/mdr.ts`). Ia ditetapkan penyelenggara QRIS
-- saat merchant didaftarkan — POS tidak dapat menurunkannya dari data apa pun
-- yang dimilikinya, jadi ia harus disimpan.
--
-- ⛔ Bawaan `umi`, dan itu ditandai [ASUMSI].
--
-- Target produk ini kafe takeaway 2–20 outlet (`CLAUDE.md`), dan sebagian
-- besarnya masuk golongan usaha mikro. Tapi angkanya BELUM divalidasi ke
-- merchant mana pun, sama seperti `allow_negative_stock` di `spec-e:341`.
--
-- Yang membuat bawaan yang salah tidak berbahaya di sini: seluruh angka
-- turunannya ditandai PERKIRAAN sampai ke layar (AC FR-C12 kedua), dan tidak
-- satu pun dari keduanya masuk `order`, struk, atau omzet. Salah kategori
-- menghasilkan perkiraan yang meleset — bukan pembukuan yang salah.
--
-- DEFAULT dipertahankan (berbeda dari `refund.method` di migrasi 0021):
-- tenant baru harus punya kategori, dan tidak ada klien yang mengirim kolom
-- ini — ia disetel dari back-office, bukan dari jalur penjualan.
ALTER TABLE tenant
  ADD COLUMN merchant_category text NOT NULL DEFAULT 'umi'
    CHECK (merchant_category IN ('umi','uke','ume','ube'));

-- ===========================================================================
-- 2. `order_line.tax_jurisdiction` — FR-C13
-- ===========================================================================
--
-- AC FR-C13 pertama: *"Pajak dipisah per jenis dan yurisdiksi, bukan satu
-- angka gabungan."*
--
-- Migrasi 0022 sudah menyalin `tax_rate.name` ke `order_line` sebagai
-- snapshot, dengan alasan yang berlaku sama persis di sini: tarif yang
-- di-rename, dipindah yurisdiksi, atau diakhiri setelah transaksi tidak boleh
-- mengubah rekapitulasi periode yang sudah dilaporkan ke kantor pajak.
--
-- Meresolusinya lewat JOIN ke `tax_rate` saat laporan dibuat berarti dua
-- ekspor untuk periode yang SAMA dapat berbeda — dan yang kedua akan dianggap
-- koreksi atas yang pertama, padahal tidak ada yang berubah selain nama.
--
-- NULLABLE, tanpa backfill, alasan yang sama dengan 0022: baris lama tidak
-- punya nilainya dan menuliskan yurisdiksi SEKARANG ke transaksi lama adalah
-- persis kesalahan yang kolom ini ada untuk cegah. Rekapitulasi untuk baris
-- itu mengelompokkan yurisdiksinya sebagai "(tidak tercatat)" — jujur, bukan
-- menebak.
ALTER TABLE order_line ADD COLUMN tax_jurisdiction text;
