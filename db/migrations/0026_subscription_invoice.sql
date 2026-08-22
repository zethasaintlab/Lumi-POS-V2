-- Tagihan langganan (F5). Modul `tenancy`.
--
-- ⛔ SELURUH bentuk tabel ini `[ASUMSI]`.
--
-- `ERD:466` menyebut `subscription` lalu berkata "Sesuai spec modul komersial
-- dan operasional" -- spec itu TIDAK ADA. Delapan spec modul memuat 414
-- acceptance criteria dan tidak satu pun menyangkut paket, kuota, atau
-- lisensi; 77 FR di PRD berhenti di FR-H8. `HANDOFF.md` sudah mencatat
-- ketiadaan ini sebagai penundaan sadar di F0 untuk menghindari menebak skema.
--
-- Setelah migrasi ini mendarat, ERD dan database BERBEDA sampai pemilik produk
-- menyamakannya -- sejajar dengan `item_modifier_list` ERD §15 yang sudah
-- tercatat. Menyunting dokumen produk bukan kewenangan agent.
--
-- ## ⛔ Kenapa TABEL SENDIRI, bukan baris di `payment`
--
-- `payment` punya empat kolom NOT NULL yang tagihan langganan tidak punya:
--
--     order_id  NOT NULL REFERENCES "order"(id)
--     outlet_id NOT NULL REFERENCES outlet(id)
--     device_id NOT NULL REFERENCES device(id)
--     check_id  NOT NULL REFERENCES "check"(id)
--
-- Tagihan langganan bukan penjualan di outlet mana pun, tidak dilakukan
-- perangkat mana pun, dan tidak menutup check mana pun. Skemanya sudah
-- mencegah kesalahan ini, dan itu kabar baik: kalau keempatnya nullable, jalan
-- termudah adalah menulis tagihan langganan sebagai `payment` -- dan
-- akibatnya `posisi-penjualan.ts` serta B-19 akan menampilkan biaya langganan
-- merchant sebagai OMZET KAFENYA SENDIRI. Cacat diam di jalur uang.
--
-- ## ⛔ Yang SENGAJA tidak ada: periode tagihan
--
-- Siklus tagihan (bulanan / tahunan / keduanya) belum diputuskan. Menebaknya
-- berarti setiap tagihan yang pernah dibuat membawa periode yang salah, dan
-- itu jauh lebih mahal daripada `ADD COLUMN` kelak.
--
-- Konsekuensi yang harus dibaca: tanpa periode dan tanpa penanganan langganan
-- berakhir (di luar scope epik ini, keputusan user 21 Agustus 2026), membayar
-- satu tagihan menaikkan paket **secara permanen**. Itu keadaan yang
-- disengaja dan dinyatakan, bukan kelalaian.

SET LOCAL lock_timeout = '5s';

CREATE TABLE subscription_invoice (
  id                  text PRIMARY KEY,
  tenant_id           text NOT NULL REFERENCES tenant(id),

  -- ⛔ Hanya tier berbayar yang punya tagihan. `free` tidak perlu dibayar,
  -- dan `enterprise` adalah negosiasi -- harga angka untuknya berarti
  -- seseorang dapat membelinya sendiri dengan harga yang tidak pernah
  -- disepakati siapa pun.
  plan                text NOT NULL CHECK (plan IN ('standard', 'pro')),

  -- ⛔ SNAPSHOT, ketiganya. Alasan yang sama dengan `order_line.unit_price`:
  -- harga dan jumlah outlet berubah, dan tagihan yang sudah dibayar harus
  -- tetap dapat dijelaskan dengan angka yang berlaku SAAT ia dibuat. Tanpa
  -- snapshot, menaikkan harga bulan depan mengubah arti setiap tagihan lama.
  outlet_count        integer NOT NULL CHECK (outlet_count >= 1),
  unit_price          bigint  NOT NULL CHECK (unit_price > 0),
  amount              bigint  NOT NULL CHECK (amount > 0),

  -- Kosakata status SAMA dengan `payment.status`, dan itu disengaja: dua
  -- kosakata untuk hal yang sama akan menyimpang pada status berikutnya yang
  -- ditambahkan salah satunya.
  status              text NOT NULL DEFAULT 'pending_confirmation'
                        CHECK (status IN ('pending_confirmation', 'confirmed', 'failed', 'expired')),

  provider            text,
  provider_reference  text,

  created_at          timestamptz NOT NULL DEFAULT now(),
  confirmed_at        timestamptz,

  -- Siapa yang meminta. Owner-only ditegakkan RBAC; kolom ini yang membuat
  -- "siapa menaikkan paket" dapat dijawab enam bulan kemudian.
  requested_by        text NOT NULL,

  -- `amount` WAJIB konsisten dengan snapshotnya. Tanpa ini, tagihan dapat
  -- menyebut 3 outlet x Rp349.000 lalu menagih Rp1.000 -- dan tidak ada apa
  -- pun yang menandainya.
  --
  -- ⛔ Namanya BUKAN `subscription_invoice_amount_check`. PostgreSQL
  -- membangkitkan nama itu sendiri untuk `CHECK (amount > 0)` di kolom
  -- `amount`, dan memakainya di sini menabrak dengan
  -- "constraint already exists" -- error yang terbaca seperti migrasi sudah
  -- pernah jalan, padahal ini jalan pertamanya.
  CONSTRAINT subscription_invoice_amount_konsisten
    CHECK (amount = unit_price * outlet_count)
);

SELECT apply_tenant_rls('subscription_invoice');

-- ⛔ SATU tagihan terbuka per tenant.
--
-- Ini yang mencegah merchant yang menekan "Bayar" dua kali mendapat dua
-- tagihan dan membayar dua kali. Idempotency-Key melindungi retry satu klien;
-- index ini melindungi dari dua klik, dua tab, dan dua perangkat -- di
-- database, bukan di aplikasi.
CREATE UNIQUE INDEX ux_subscription_invoice_terbuka
  ON subscription_invoice (tenant_id)
  WHERE status = 'pending_confirmation';

-- Riwayat tagihan di B-29, terbaru dulu.
CREATE INDEX ix_subscription_invoice_tenant
  ON subscription_invoice (tenant_id, created_at DESC);

-- Webhook mencari tagihan lewat rujukan gateway. Tanpa index ini, setiap
-- notifikasi memindai seluruh tabel.
CREATE INDEX ix_subscription_invoice_reference
  ON subscription_invoice (provider_reference)
  WHERE provider_reference IS NOT NULL;
