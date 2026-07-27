# Handoff Checklist

Status per 27 Juli 2026. Centang saat selesai.

## Sebelum baris kode pertama

- [ ] Baca [`CLAUDE.md`](CLAUDE.md) — delapan invariant, stack terkunci, daftar "jangan bangun"
- [ ] `git init` dan commit pertama berisi seluruh dokumentasi
- [ ] PostgreSQL 17+ berjalan lokal
- [ ] Buat **dua** role database: `lumi_owner` (migrasi) dan `lumi_app` (aplikasi, **tanpa** `BYPASSRLS`, **bukan** owner tabel)

## Gate F0 — semua harus hijau sebelum F1

- [ ] Skema PostgreSQL berjalan dari `db/migrations/`
- [ ] **Test isolasi lintas-tenant hijau untuk setiap tabel** ← gate utama
- [ ] `FORCE ROW LEVEL SECURITY` aktif di setiap tabel
- [ ] `app.tenant_id` di-`SET LOCAL` per transaksi, terbukti tidak bocor antar request
- [ ] Skema SQLite lokal berjalan (`db/local/001-initial.sql` + `stock_snapshot` + `ix_mv_hlc`)
- [ ] Font Inter di-self-host, `@import` Google Fonts dihapus
- [ ] Header COOP/COEP di-set; SQLite WASM+OPFS berjalan di browser
- [ ] `npm run lint:ds` hijau dan masuk CI
- [ ] Aplikasi kosong berjalan di Tauri dengan token design system terpasang

## Keputusan produk yang perlu dikonfirmasi sebelum F1

Semuanya menyentuh skema — murah sekarang, mahal nanti.

- [ ] Tanggal bisnis berakhir saat tutup shift (default 04:00), bukan tengah malam
- [ ] `VerticalProfile` per **outlet** dengan default dari tenant (OQ-09)
- [ ] QRIS statis konfirmasi manual didukung (OQ-15)
- [ ] Ambang otorisasi default: diskon >20% atau >Rp50.000 · selisih kas >Rp20.000 · no-sale >3×/shift
- [ ] Batas kredensial offline (OQ-08)

## Proses eksternal — mulai sekarang, lead time di luar kendali

- [ ] Konsultasi pajak: kewajiban penyedia POS pasca-Coretax (OQ-04) + pajak dine-in vs takeaway (OQ-05)
- [ ] Email konfirmasi lisensi ke hello@powersync.com untuk redistribusi on-premise (OQ-03b)
- [ ] Cek persyaratan program partner GoFood & GrabFood (OQ-06) — menentukan tanggal v1.1
- [ ] Daftar akun sandbox Midtrans
- [ ] Beli 5–8 model printer thermal paling umum untuk program "Diuji dengan Lumi POS" (< Rp5 juta)

## Prototipe yang masih perlu dijalankan

- [ ] **OQ-14** — Tauri Android: printer Bluetooth + scanner HID (1–2 minggu). Menentukan apakah rencana mobile bertahan
- [ ] Ukur ulang performa query pada perangkat kasir nyata — faktor tablet 3–5× masih asumsi
- [ ] Tambahkan clock skew + HLC ke harness DST — FR-H5 belum divalidasi sama sekali

## Validasi pasar — sebelum F2 dimulai

- [ ] Wawancara 10 merchant target: seberapa sering outage, dan apa yang mereka lakukan sekarang
- [ ] 30–50 percakapan penjualan dengan harga disebutkan (Rp349.000 / Rp699.000)
- [ ] Validasi ambang otorisasi ke 3 merchant

Asumsi terbesar yang belum diuji ada di [`product/PRD-lumi-pos-v1.md`](product/PRD-lumi-pos-v1.md) § 11.2. Kalau A1 (frekuensi outage) runtuh, posisi produk berubah — sebaiknya diuji **sebelum** F2, bukan sesudah.
