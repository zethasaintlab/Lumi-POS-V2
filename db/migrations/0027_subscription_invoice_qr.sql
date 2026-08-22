-- QR tagihan langganan disimpan, bukan hanya dikembalikan sekali (F5).
--
-- ## ⛔ Cacat yang ditutup, ditemukan DI BROWSER dan bukan lewat test
--
-- `qrString` hanya hidup di respons `POST /tenants/subscription/invoices`.
-- Konsekuensinya baru terlihat saat B-29 benar-benar dipakai:
--
--   1. Merchant membuat tagihan, QR tampil.
--   2. Ia memuat ulang halaman -- atau menekan "Cek status pembayaran",
--      atau membukanya besok dari perangkat lain.
--   3. QR-nya HILANG selamanya. Tagihannya masih `pending_confirmation`,
--      index unik parsial menolak tagihan kedua, dan tidak ada satu pun
--      jalan membayarnya sampai ia kedaluwarsa sendiri.
--
-- Merchant terkunci dari fitur yang baru saja ia beli, tanpa satu pun error.
-- Menanyakan ulang ke gateway tidak menolong: respons `/v2/{id}/status`
-- Midtrans tidak memuat `actions`, jadi QR-nya memang hanya datang sekali.
--
-- ⛔ Berbeda dari `payment`, dan perbedaannya disengaja: QR penjualan hidup
-- selama kasir berdiri di depan layar, dan pelanggan yang pergi berarti
-- ordernya dibatalkan. Tagihan langganan dibayar oleh orang yang sama yang
-- membuatnya, kadang berhari-hari kemudian, dari perangkat lain.
--
-- Bukan data kartu: ini QR yang MERCHANT pindai untuk membayar kami. Larangan
-- menyimpan PAN/CVV/track tidak menyentuhnya.
--
-- Aditif dan nullable -- tagihan yang sudah ada tetap sah dengan NULL di
-- keduanya (expand-contract; tidak ada langkah contract yang dibutuhkan).

SET LOCAL lock_timeout = '5s';

ALTER TABLE subscription_invoice
  ADD COLUMN qr_string  text,
  -- Kedaluwarsa DARI GATEWAY, bukan dihitung dari jam kami. `expiry_time`
  -- Midtrans adalah satu-satunya yang tahu kapan QR-nya berhenti berlaku;
  -- menebaknya berarti layar menyebut waktu yang tidak mengikat siapa pun.
  ADD COLUMN expires_at timestamptz;
