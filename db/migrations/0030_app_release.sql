-- module: tenancy + identity (see apps/server/src/modules/README.md)
SET LOCAL lock_timeout = '5s';

-- F6 — staged rollout. `ARCH:§12`, KEP-36.
--
-- KEP-36 menolak dua jalan yang lebih mudah, dan alasannya tertulis di sana:
-- auto-update paksa menghentikan outlet di jam makan siang, dan update manual
-- berarti delapan versi di lapangan setelah setahun. Yang tersisa adalah
-- staged rollout dengan jendela waktu — dan itu menuntut tabel.
--
-- ===========================================================================
-- ⛔ Yang tabel ini TIDAK lakukan
-- ===========================================================================
--
-- Ia tidak memasang apa pun. Mengunduh dan memasang versi menuntut shell
-- Tauri, dan itu utang F4 yang tercatat. Yang ada di sini adalah KEPUTUSAN:
-- perangkat mana yang seharusnya di versi mana, boleh dipasang jam berapa,
-- dan boleh ditunda berapa kali. Aturannya di
-- `packages/domain/src/rilis.ts` — tabel ini hanya menyimpan keadaannya.

-- ===========================================================================
-- 1. `app_release` — dikecualikan dari RLS, dan itu disengaja
-- ===========================================================================
--
-- ⛔ Rilis adalah milik KAMI, bukan milik merchant. Ia tidak punya
-- `tenant_id` karena tidak ada tenant yang memilikinya — sejajar dengan
-- `printer_profile`, dan alasan yang sama: data referensi global.
--
-- Konsekuensinya dinyatakan: setiap merchant dapat MEMBACA baris ini. Yang
-- dibacanya adalah nomor versi dan tahap rollout — tidak ada satu pun kolom
-- yang menyebut merchant lain.
CREATE TABLE app_release (
  version            text PRIMARY KEY,

  -- Kosakatanya SAMA dengan `TAHAP_ROLLOUT` di `packages/domain/src/rilis.ts`,
  -- dan `tests/domain/rilis.test.js` membandingkan keduanya. Dua daftar
  -- tertutup untuk hal yang sama akan menyimpang pada tahap berikutnya yang
  -- ditambahkan salah satunya.
  stage              text NOT NULL DEFAULT 'kanari'
                       CHECK (stage IN ('kanari','lima','duapuluhlima','penuh')),

  -- ⛔ Kapan tahap SEKARANG dimasuki, bukan kapan rilisnya dibuat. Jeda 24
  -- jam `ARCH:355` dihitung dari sini; memakai `created_at` membuat tahap
  -- kedua dan ketiga naik tanpa jeda sama sekali begitu yang pertama lewat.
  stage_entered_at   timestamptz NOT NULL DEFAULT now(),

  -- Daftar TERTUTUP, dan itu ADALAH "definisi tertulis" yang `ARCH:356`
  -- tuntut. Tanpa daftar tertutup, setiap rilis akan menemukan alasan untuk
  -- menjadi mendesak — dan jendela update berhenti berarti apa pun.
  mandatory_reason   text CHECK (mandatory_reason IN ('keamanan','kehilangan_data')),

  -- Angka yang dipakai saat tahap terakhir kali dinaikkan. ⛔ DISIMPAN, bukan
  -- dihitung ulang saat dibaca: keduanya adalah catatan tentang keputusan
  -- yang sudah diambil, dan crash rate hari ini tidak menjelaskan kenapa
  -- seseorang menaikkan tahap kemarin.
  gate_crash_candidate  double precision,
  gate_crash_baseline   double precision,

  -- Rilis yang dihentikan tidak pernah menjadi jawaban `GET .../update`.
  -- ⛔ Baris TIDAK dihapus (invariant #2 semangatnya): versi yang pernah
  -- ditawarkan lalu ditarik adalah persis yang perlu dijelaskan saat
  -- perangkat terlanjur memasangnya.
  halted_at          timestamptz,
  halted_reason      text,

  notes              text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
-- exempt from RLS: rilis adalah data referensi global, lihat komentar di atas.

-- Rilis aktif = yang terbaru dan belum dihentikan.
CREATE INDEX ix_app_release_aktif ON app_release(created_at DESC) WHERE halted_at IS NULL;

-- ===========================================================================
-- 2. Kanari adalah PILIHAN, bukan undian
-- ===========================================================================
--
-- ⛔ Kohort 5%/25% diundi dari hash tenant; kanari tidak. Merchant sungguhan
-- tidak pernah menjadi kelinci percobaan tanpa memilihnya, dan "kanari
-- internal" (`ARCH:355`) berarti tenant milik kami sendiri.
ALTER TABLE tenant
  ADD COLUMN is_canary boolean NOT NULL DEFAULT false;

-- ===========================================================================
-- 3. Jendela update per OUTLET
-- ===========================================================================
--
-- Waktunya waktu LOKAL OUTLET, dan `outlet.timezone` sudah ada sejak migrasi
-- 0002. Per outlet, bukan per tenant: satu merchant dapat punya cabang di
-- Jakarta dan Makassar, dan "03:00" berarti dua saat yang berbeda.
--
-- NULL = pakai bawaan `JENDELA_BAWAAN` (03:00–06:00). ⛔ Bawaannya hidup di
-- `packages/domain`, bukan sebagai DEFAULT kolom: kolom ber-default membuat
-- perubahan bawaan hanya berlaku untuk outlet yang dibuat SESUDAHNYA.
ALTER TABLE outlet
  ADD COLUMN update_window_start_hour int CHECK (update_window_start_hour BETWEEN 0 AND 23),
  ADD COLUMN update_window_end_hour   int CHECK (update_window_end_hour BETWEEN 0 AND 23);

-- ⛔ Jendela KOSONG (`mulai = selesai`) ditolak database, bukan hanya
-- aplikasi. Menafsirkannya sebagai "24 jam penuh" akan membuat satu salah
-- ketik konfigurasi mengizinkan update di jam makan siang.
ALTER TABLE outlet
  ADD CONSTRAINT ck_outlet_update_window CHECK (
    update_window_start_hour IS NULL
    OR update_window_end_hour IS NULL
    OR update_window_start_hour <> update_window_end_hour
  );

-- ===========================================================================
-- 4. Penundaan per PERANGKAT, per VERSI
-- ===========================================================================
--
-- ⛔ `update_deferred_version` bukan pelengkap: tanpa itu, penundaan yang
-- terkumpul untuk versi lama membuat versi BERIKUTNYA wajib segera saat
-- pertama kali muncul — merchant kehilangan hak menundanya tanpa pernah
-- memakainya. Penghitung direset saat versinya berganti.
ALTER TABLE device
  ADD COLUMN update_deferrals        int NOT NULL DEFAULT 0
    CHECK (update_deferrals >= 0),
  ADD COLUMN update_deferred_version text;
