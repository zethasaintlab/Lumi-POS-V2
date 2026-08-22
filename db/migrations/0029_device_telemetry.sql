-- module: identity (see apps/server/src/modules/README.md)
SET LOCAL lock_timeout = '5s';

-- F6 — telemetri klien. `ARCH:294` § 10.
--
-- `apps/server/src/metrik.ts` mendaftar lima dari delapan metrik `ARCH:296`
-- yang **tidak dapat dihasilkan server**: umur antrean, item gagal sinkron,
-- latensi keranjang, crash rate, dan rasio offline. Semuanya terjadi di
-- perangkat, sebagian besar justru saat perangkat tidak terhubung. Tabel ini
-- tempat mendaratnya.
--
-- ===========================================================================
-- ⛔ BATAS ETIS — `ARCH:309`
-- ===========================================================================
--
-- *"Tidak pernah mengirim nama produk, harga, nilai transaksi, data
-- pelanggan, atau nama merchant. Metrik dan tipe error saja."*
--
-- Yang menegakkannya di sini adalah BENTUK TABELNYA, bukan disiplin
-- pemanggil:
--
--   * `event` punya CHECK berisi daftar TERTUTUP. Ia disalin dari
--     `packages/domain/src/telemetri.ts`, dan `tests/domain/telemetri.test.js`
--     membandingkan keduanya supaya salinannya tidak dapat menyimpang —
--     pola yang sama dengan kosakata `stock_movement.type`.
--   * tidak ada satu pun kolom `text` bebas selain `type`, yang dibatasi
--     panjangnya. Tidak ada `payload jsonb`, dan itu keputusan: kolom JSON
--     bebas adalah pintu tempat nama produk masuk enam bulan dari sekarang,
--     lewat satu baris kode yang tidak terlihat melanggar apa pun.
--
-- ===========================================================================
-- ⛔ AGREGAT, bukan peristiwa mentah
-- ===========================================================================
--
-- Satu baris = satu (`event`, `type`) dalam satu jendela waktu dari satu
-- perangkat. Dua alasan yang berdiri sendiri:
--
--   1. **Volume.** Satu shift sibuk menghasilkan ribuan pengukuran latensi.
--   2. **Privasi.** Deretan peristiwa ber-cap waktu adalah jejak aktivitas
--      per menit — kapan outlet ramai, kapan kasir berhenti. Agregat per
--      jendela tidak memuat itu.
--
-- ===========================================================================
-- `double precision` — dan kenapa itu BUKAN pelanggaran
-- ===========================================================================
--
-- `CLAUDE.md` melarang float **di jalur uang**. Tidak satu pun kolom di sini
-- ada di jalur itu: nilainya milidetik, jam, detik, dan cacah percobaan.
-- Yang menjaganya tetap begitu adalah CHECK `event` di atas — tidak ada nama
-- event yang menyebut jumlah uang, dan tidak boleh ada.
CREATE TABLE device_telemetry (
  id            text PRIMARY KEY,
  tenant_id     text NOT NULL REFERENCES tenant(id),
  device_id     text NOT NULL REFERENCES device(id),

  -- Versi aplikasi saat jendela ini diukur. `ARCH:302` memakai crash rate
  -- PER VERSI sebagai gate rollout bertahap, jadi ia harus tersimpan bersama
  -- angkanya — bukan dibaca dari `device.app_version`, yang menyebut versi
  -- perangkat SEKARANG dan sudah berubah saat rollout gagal.
  app_version   text,

  event         text NOT NULL CHECK (event IN (
                  'latensi_keranjang_ms',
                  'umur_antrean_jam',
                  'antrean_gagal',
                  'cetak_percobaan',
                  'offline_detik',
                  'selisih_jam_detik',
                  'crash'
                )),
  -- Label kategori — tipe error, bukan pesannya. Panjangnya dibatasi karena
  -- pesan error dapat memuat nama produk ("Kopi Susu tidak ditemukan"), dan
  -- pemotongan di klien saja berarti satu lapisan tanpa cadangan.
  type          text CHECK (type IS NULL OR length(type) <= 64),

  -- Jendela yang diringkas, dari jam PERANGKAT. Ia dapat melenceng — itulah
  -- sebabnya `selisih_jam_detik` ada di daftar event.
  window_start  timestamptz NOT NULL,
  window_end    timestamptz NOT NULL,
  CHECK (window_end >= window_start),

  sample_count  integer NOT NULL CHECK (sample_count > 0),
  total_value   double precision NOT NULL,
  min_value     double precision NOT NULL,
  max_value     double precision NOT NULL,
  p95_value     double precision NOT NULL,

  -- Jam SERVER, sejajar `recorded_at` di tabel lain: kapan ia benar-benar
  -- sampai. Selisihnya terhadap `window_end` adalah berapa lama perangkat
  -- tidak terhubung.
  recorded_at   timestamptz NOT NULL DEFAULT now()
);
SELECT apply_tenant_rls('device_telemetry');

-- Pertanyaan yang tabel ini jawab selalu berbentuk "perangkat ini, jendela
-- ini" (B-28) — index-nya mengikuti bentuk itu, bukan bentuk penulisannya.
CREATE INDEX ix_device_telemetry_device ON device_telemetry(device_id, window_end DESC);

-- ⛔ Tidak ada unique constraint atas (`device_id`, `event`, `type`,
-- `window_start`), dan itu disengaja.
--
-- Pengiriman ulang setelah respons yang hilang akan menghasilkan jendela yang
-- SAMA dua kali. Yang melindunginya adalah `Idempotency-Key`, sama seperti
-- pembayaran — bukan primary key. Menaruh unique di sini berarti perangkat
-- yang jamnya mundur (dan itu terjadi; lihat catatan HLC di `CLAUDE.md`)
-- tidak dapat mengirim jendela keduanya sama sekali, dan yang hilang adalah
-- metrik, tanpa satu pun keluhan.
