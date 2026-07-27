# Spec Modul F — Identitas, RBAC & Audit

**Status:** Draft · **Versi:** 0.1 · **Terakhir diperbarui:** 27 Juli 2026
**Induk:** `/product/PRD-lumi-pos-v1.md` § 7 Modul F · **Riset:** `/research/08-SECURITY-AND-COMPLIANCE.md`

---

## F.0 Ringkasan modul

Modul ini menjawab tiga pertanyaan: **siapa yang login**, **apa yang boleh dilakukannya**, dan **apa yang sudah dilakukan siapa**.

Alur autentikasi POS tidak standar dan tidak dilayani IAM generik: kasir login dengan PIN di perangkat bersama, manajer melakukan otorisasi di tengah sesi kasir lain, dan semuanya harus bekerja tanpa internet. Karena itu modul ini dibangun sendiri (KEP-14), dengan batas yang dijaga agar dapat ditukar ke Zitadel bila kebutuhan SSO enterprise muncul.

**Invariant:**

1. Aplikasi hanya mengenal `subject`, `tenant`, `outlet`, dan `roles` — bukan mekanisme bagaimana keempatnya didapat.
2. Audit trail append-only; tidak dapat dinonaktifkan; owner tidak dikecualikan.
3. Login dan otorisasi berfungsi penuh saat offline.
4. PIN tidak pernah meninggalkan perangkat dalam bentuk plaintext.

---

## F.1 Peran & hak akses

### FR-F1 [P0] — Definisi peran

| Peran | Cakupan | Boleh | Tidak boleh |
|---|---|---|---|
| **Owner** | Tenant | Semua, termasuk billing, membuat outlet, menghapus pengguna | — |
| **Manajer Area** | Beberapa outlet | Laporan lintas outlet, katalog, harga, otorisasi | Billing, membuat/menghapus outlet |
| **Manajer Outlet** | Satu outlet | Otorisasi void/refund/diskon, tutup kas, laporan outlet, stok, kelola kasir | Ubah harga, lihat outlet lain |
| **Kasir** | Satu outlet | Transaksi, buka/tutup shift sendiri, lihat laporan shift sendiri | **Margin, HPP**, laporan outlet, otorisasi |
| **Akuntan** | Tenant, read-only | Semua laporan keuangan, ekspor | Mengubah apa pun |
| **KDS** (v1.1) | Satu outlet, tanpa login | Baca tiket, tandai selesai | Harga, pelanggan, laporan |

**Matriks hak akses per operasi** (ringkas; lengkap di implementasi):

| Operasi | Owner | Mgr Area | Mgr Outlet | Kasir | Akuntan |
|---|:---:|:---:|:---:|:---:|:---:|
| Transaksi penjualan | ✅ | ✅ | ✅ | ✅ | ❌ |
| Void / refund (sebagai pelaku) | ✅ | ✅ | ✅ | ✅ | ❌ |
| **Menyetujui** void/refund/diskon | ✅ | ✅ | ✅ | ❌ | ❌ |
| Buka/tutup shift | ✅ | ✅ | ✅ | ✅ | ❌ |
| Menyetujui selisih kas | ✅ | ✅ | ✅ | ❌ | ❌ |
| Ubah katalog | ✅ | ✅ | ❌ | ❌ | ❌ |
| Ubah harga | ✅ | ✅ | ❌ | ❌ | ❌ |
| Penyesuaian stok | ✅ | ✅ | ✅ | ❌ | ❌ |
| Lihat margin & HPP | ✅ | ✅ | ✅ | **❌** | ✅ |
| Laporan exception | ✅ | ✅ | ✅ | ❌ | ✅ |
| Kelola pengguna | ✅ | ✅ | Kasir saja | ❌ | ❌ |
| Pengaturan pajak | ✅ | ❌ | ❌ | ❌ | ❌ |
| Billing & langganan | ✅ | ❌ | ❌ | ❌ | ❌ |
| Cabut perangkat | ✅ | ✅ | ✅ | ❌ | ❌ |

### FR-F5 [P0] — Kasir tidak melihat margin dan HPP

**Deskripsi.** Kasir memiliki turnover tinggi dan sering pindah ke kompetitor merchant. HPP dan margin adalah informasi kompetitif merchant, bukan informasi operasional kasir.

**Cakupan larangan:** kolom margin di laporan · `cost` pada detail produk · `cost_at_sale` pada riwayat transaksi · laporan produk terlaris berbasis margin · ekspor apa pun yang memuat HPP.

**Behavior.**

```
GIVEN pengguna berperan Kasir
WHEN membuka detail produk atau laporan mana pun
THEN kolom dan field yang memuat cost/margin TIDAK ADA di respons API
 AND bukan sekadar disembunyikan di UI
```

**Acceptance criteria.**

- [ ] Field `cost` dan `cost_at_sale` tidak ada dalam payload API untuk peran Kasir — diverifikasi inspeksi network
- [ ] Endpoint laporan margin menolak peran Kasir dengan `403`
- [ ] Ekspor yang dijalankan Kasir tidak memuat kolom HPP

---

**Acceptance criteria peran secara umum.**

- [ ] Kasir tidak dapat menyetujui operasinya sendiri — diverifikasi test
- [ ] Manajer Outlet tidak dapat melihat data outlet lain, ditegakkan di lapisan query bukan UI
- [ ] Akuntan tidak dapat melakukan mutasi apa pun; seluruh endpoint mutasi menolak
- [ ] Penambahan peran baru tidak memerlukan perubahan di layar kasir

---

### Pemisahan tugas

**Aturan yang ditegakkan:**

- Kasir yang menghitung laci **tidak boleh** menjadi orang yang menyetujui selisihnya. Alur tutup kas melibatkan dua identitas ketika selisih di atas ambang.
- **Owner tidak dikecualikan dari audit trail** (FR-F10). Kafe dengan beberapa investor adalah hal biasa; sengketa antar pemilik membutuhkan jejak yang lengkap.

**Acceptance criteria.**

- [ ] `actor_user_id` = `approver_user_id` ditolak pada operasi berotorisasi
- [ ] Tindakan owner menghasilkan `audit_event` yang sama lengkapnya dengan tindakan kasir

---

## F.2 Autentikasi

### FR-F2 [P0] — Kredensial dibagi per permukaan

**Deskripsi.** Sistem memakai **dua mekanisme kredensial**, dipilih berdasarkan permukaan — bukan satu mekanisme untuk semua.

| Permukaan | Kredensial | Alasan |
|---|---|---|
| **Aplikasi kasir** (K-01…K-17) | **PIN 6 digit** | Otorisasi step-up terjadi di tengah transaksi dengan antrean menunggu; kecepatan menentukan |
| **Otorisasi step-up** (K-11) | **PIN manajer 6 digit** | Sama |
| **Back-office** (B-01…B-29) | **Email + password** (+ MFA opsional) | Diakses dari laptop, sesi panjang, hak akses luas |
| **Owner mobile** (M-01…M-03) | **Email + password** | Sama |

**Mengapa bukan email+password di kasir.** Login awal shift hanya sekali sehari dan bukan masalah. Yang menentukan adalah **otorisasi step-up**: manajer memasukkan kredensial di perangkat kasir lain, di tengah transaksi, dengan antrean menunggu, tangan sering basah. PIN ≈2 detik; email+password 15–30 detik dengan tingkat salah ketik tinggi.

Konsekuensinya berlipat: **friksi login menyebabkan berbagi akun**, dan begitu akun dibagi, atribusi hancur — yang membuat delapan laporan exception di Modul G tidak berguna. Seluruh nilai anti-fraud bergantung pada login yang cukup cepat sehingga tidak ada yang berbagi.

**PIN bukan batas keamanan.** Keamanan perangkat berasal dari token perangkat yang terikat dan dapat dicabut (FR-F12), enkripsi at-rest, dan keberadaan fisik perangkat di outlet. PIN menjawab pertanyaan berbeda: *siapa di antara staf outlet ini yang sedang mengoperasikan*. Itu **atribusi**, bukan otentikasi.

**Aturan PIN.**

- Panjang **tepat 6 digit**. Bukan 4 — 100× ruang pencarian dengan selisih waktu ketik yang dapat diabaikan.
- Argon2id + salt per pengguna di server.
- Hash direplikasi ke perangkat outlet tempat pengguna terdaftar.
- Verifikasi **lokal** terhadap hash; PIN plaintext tidak pernah meninggalkan input.
- PIN unik dalam satu outlet — dua kasir dengan PIN sama membuat atribusi ambigu.
- PIN boleh sama antar outlet berbeda.

**Penolakan PIN lemah.** Ditolak saat pembuatan dan penggantian:

| Pola | Contoh |
|---|---|
| Digit berulang | `000000`, `111111` |
| Urutan naik/turun | `123456`, `654321` |
| Tanggal lahir pengguna (jika diketahui) | `170890` |
| Pola berulang | `121212`, `123123` |
| 20 PIN paling umum | daftar statis yang di-bundle |

**Rotasi PIN manajer.** PIN manajer wajib dirotasi berkala (default 90 hari, dapat dikonfigurasi). Ini **satu-satunya mitigasi untuk shoulder surfing**, dan PIN manajer adalah yang paling sering diketik di depan orang lain. PIN kasir tidak wajib dirotasi.

**Acceptance criteria.**

- [ ] PIN tepat 6 digit; 4 atau 5 digit ditolak
- [ ] Kelima pola PIN lemah ditolak dengan pesan yang menjelaskan pola mana
- [ ] PIN duplikat dalam satu outlet ditolak; antar outlet diizinkan
- [ ] Hash Argon2id, bukan bcrypt/SHA/MD5
- [ ] PIN plaintext tidak pernah muncul di log, request body tersimpan, maupun database
- [ ] Pesan kegagalan tidak membocorkan keberadaan pengguna
- [ ] Peringatan rotasi PIN manajer muncul 7 hari sebelum jatuh tempo
- [ ] Back-office dan owner mobile **tidak menerima login PIN**; kasir **tidak menerima login password**

**Behavior.**

```
GIVEN kasir memasukkan PIN 6 digit
WHEN PIN cocok dengan hash lokal salah satu pengguna outlet
THEN sesi dibuat untuk pengguna tersebut
 AND AuditEvent type='login' dibuat

WHEN PIN tidak cocok
THEN pesan netral: "PIN salah" — tidak menyebut apakah pengguna ada
 AND hitungan percobaan bertambah
```

---

### FR-F2b [P0] — Login back-office & owner mobile

**Deskripsi.** Email + password untuk permukaan yang diakses dari laptop atau HP pribadi.

**Aturan.**

- Password di-hash **Argon2id**; minimal 10 karakter; ditolak bila ada di daftar password bocor yang di-bundle.
- Reset password lewat email dengan token berumur 30 menit, sekali pakai.
- **MFA (TOTP) opsional di v1, wajib untuk peran Owner di v1.1** — peran Owner memegang akses billing dan penghapusan outlet.
- Sesi back-office kedaluwarsa setelah 12 jam tidak aktif.

**Acceptance criteria.**

- [ ] Password < 10 karakter ditolak
- [ ] Password dari daftar bocor ditolak dengan pesan yang menjelaskan
- [ ] Token reset sekali pakai dan kedaluwarsa 30 menit
- [ ] Sesi back-office kedaluwarsa; sesi kasir **tidak** (shift yang menentukan)
- [ ] Pengguna tanpa email tidak dapat mengakses back-office — ini benar, kasir memang tidak seharusnya bisa

---

### FR-F3 [P0] — Login berfungsi offline

**Deskripsi.** Pembeda utama versus Toast, yang secara eksplisit menyatakan pengguna tidak dapat login kembali sampai koneksi pulih.

**Behavior.**

```
GIVEN perangkat offline dan belum pernah offline sebelumnya hari ini
WHEN kasir memasukkan PIN yang benar
THEN login berhasil menggunakan hash yang ter-cache
 AND sesi dibuat lokal
 AND AuditEvent login masuk antrean upload
```

**Aturan pencabutan.** Pengguna yang dicabut di server tidak akan tercabut di perangkat offline sampai sinkronisasi. Mitigasi: token perangkat memiliki masa berlaku (FR-F12), dan pencabutan pengguna diprioritaskan di antrean sinkronisasi turun.

**Acceptance criteria.**

- [ ] Login berhasil dengan jaringan dimatikan sepenuhnya
- [ ] Logout **diblokir** saat antrean upload tidak kosong, dengan pesan yang menjelaskan — pelajaran dari Toast, di mana logout offline mengunci pengguna
- [ ] Pengguna yang dicabut ditolak segera setelah perangkat tersinkron

---

### FR-F4 [P0] — Rate limiting PIN lokal

**Behavior.**

```
GIVEN 5 percobaan PIN gagal berturut-turut
WHEN percobaan ke-6 dilakukan
THEN perangkat mengunci input PIN selama 60 detik
 AND hitungan mundur ditampilkan
 AND penguncian berlaku PENUH saat offline
 AND AuditEvent type='pin_lockout' dibuat

GIVEN penguncian aktif
WHEN perangkat di-restart
THEN penguncian TETAP berlaku (disimpan persisten, bukan di memori)
```

**Eskalasi.** 3 penguncian berturut dalam satu jam memperpanjang durasi menjadi 15 menit dan mengirim notifikasi ke manajer outlet saat tersinkron.

**Acceptance criteria.**

- [ ] Penguncian berfungsi offline
- [ ] Penguncian bertahan melewati restart aplikasi dan restart perangkat
- [ ] Percobaan gagal tercatat di audit trail
- [ ] Penguncian tidak menghalangi kasir lain yang PIN-nya benar — penguncian per pengguna, bukan per perangkat

---

### FR-F12 [P0] — Token perangkat

**Deskripsi.** Perangkat kasir adalah kelas perangkat yang **akan** hilang. Asumsi desain: setiap tablet yang dikirim ke merchant suatu saat akan berada di tangan yang salah.

| Prinsip | Implementasi |
|---|---|
| Terikat perangkat | Token di-issue saat provisioning, tidak dapat dipindah |
| Dapat dicabut | Pencabutan dari dashboard; berlaku pada koneksi berikutnya |
| Umur pendek + refresh | Access token menit; refresh token terikat perangkat |
| Batas offline | Perangkat yang tidak terhubung > N hari harus diaktivasi ulang — **lihat OQ-08** |
| Cakupan minimal | Perangkat hanya mereplikasi data outletnya. Perangkat curian tidak memberi akses ke outlet lain, apalagi tenant lain |
| Enkripsi at-rest | SQLite lokal terenkripsi, kunci di keystore OS — wajib, karena remote wipe tidak dijamin sampai |

**Kompromi batas offline** (rekomendasi, menunggu OQ-08): perangkat yang melewati batas tetap dapat **menyelesaikan transaksi berjalan dan menutup shift**, tetapi tidak dapat membuka shift baru sampai terhubung. Ini menjaga merchant tidak kehilangan data sambil membatasi jendela penyalahgunaan.

**Acceptance criteria.**

- [ ] Token tidak dapat dipakai di perangkat lain — diverifikasi test
- [ ] Pencabutan berlaku pada koneksi berikutnya
- [ ] Database lokal terenkripsi; kunci tidak berada di file konfigurasi
- [ ] Perangkat yang melewati batas offline tetap dapat menutup shift

---

## F.3 Otorisasi step-up

Detail alur ada di Modul B (FR-B8, FR-B9). Yang menjadi tanggung jawab modul ini:

**Aturan.**

- Verifikasi PIN penyetuju terjadi **lokal** terhadap hash yang direplikasi.
- Penyetuju harus memiliki hak `approve` untuk operasi tersebut.
- Sesi kasir **tidak berubah** — tidak ada logout, tidak ada pergantian konteks.
- Hasilnya adalah `audit_event` dengan **dua identitas**.

**Acceptance criteria.**

- [ ] Otorisasi berfungsi offline
- [ ] Pengguna tanpa hak `approve` ditolak meskipun PIN benar
- [ ] Sesi kasir identik sebelum dan sesudah otorisasi — diverifikasi test
- [ ] Rate limiting berlaku pada PIN penyetuju

---

## F.4 Audit trail

### FR-F6 [P0] — Event yang wajib tercatat

| Kategori | Event |
|---|---|
| Sesi | `login` · `logout` · `pin_failed` · `pin_lockout` |
| Shift | `shift_opened` · `shift_closed` · `shift_count_attempt` |
| Transaksi | `order_voided` · `order_refunded` · `discount_applied` (di atas ambang) |
| Kas | `cash_drawer_opened` (no-sale) · `cash_paid_in` · `cash_paid_out` · `cash_variance_approved` |
| Katalog | `item_created` · `item_updated` · `item_archived` · `price_changed` · `catalog_imported` |
| Stok | `stock_adjusted` · `stocktake_completed` · `sold_out_toggled` |
| Konfigurasi | `tax_rate_changed` · `threshold_changed` · `vertical_profile_changed` |
| Identitas | `user_created` · `user_role_changed` · `user_deactivated` · `pin_changed` |
| Perangkat | `device_provisioned` · `device_revoked` · `peripheral_configured` |
| Data | `data_exported` · `support_session_started` · `support_session_ended` |

**Struktur `AuditEvent`:**

| Field | Catatan |
|---|---|
| `id` | ulid |
| `tenant_id`, `outlet_id`, `device_id` | |
| `actor_user_id` | Yang melakukan |
| **`approver_user_id`** | Yang menyetujui — nullable; **inilah yang membedakan audit berguna dari yang tidak** |
| `event_type` | Dari daftar di atas |
| `entity_type`, `entity_id` | Objek yang disentuh |
| `before`, `after` (jsonb) | Nilai sebelum dan sesudah untuk perubahan |
| `reason_code`, `reason_note` | Dari daftar tertutup |
| `occurred_at`, `recorded_at`, `hlc` | Waktu device dan server |

**Acceptance criteria.**

- [ ] Setiap event dalam daftar menghasilkan record
- [ ] `before`/`after` terisi untuk semua perubahan konfigurasi dan harga
- [ ] Event dibuat dalam transaksi yang sama dengan operasi yang dicatatnya
- [ ] Event yang dibuat offline masuk antrean dan tersinkron
- [ ] Tidak ada `UPDATE` maupun `DELETE` pada `audit_event`

---

### FR-F7 [P0] — Dua identitas

**Deskripsi.** Untuk otorisasi step-up, mencatat hanya satu identitas membuat audit trail tidak berguna. Pertanyaan yang harus terjawab: *"apakah manajer benar-benar menyetujui refund ini, atau kasir tahu PIN-nya?"* — jawaban sebagiannya ada pada pola: manajer yang menyetujui di jam ia tidak bertugas adalah sinyal.

**Acceptance criteria.**

- [ ] Setiap operasi berotorisasi mencatat `actor_user_id` dan `approver_user_id`
- [ ] Laporan dapat memfilter berdasarkan penyetuju
- [ ] `actor` = `approver` ditolak

---

### FR-F8 [P0] — Waktu ganda dan deteksi manipulasi jam

**Deskripsi.** Jam perangkat kasir dapat dimanipulasi untuk menanggalkan transaksi ke shift lain dan menyembunyikan pola.

**Behavior.**

```
GIVEN transaksi dibuat offline dengan occurred_at = 26 Jul 14:30
WHEN tersinkron pada 26 Jul 16:00 dan recorded_at = 26 Jul 16:00
THEN selisih 1,5 jam adalah wajar (durasi offline), tidak ditandai

GIVEN transaksi dengan occurred_at = 25 Jul 14:30
WHEN tersinkron pada 26 Jul 16:00 tetapi perangkat online sepanjang 25 Jul
THEN selisih ditandai sebagai anomali
 AND masuk laporan exception (Modul G, laporan ke-8)
```

**Deteksi.** Saat perangkat tersinkron, sistem membandingkan jam perangkat dengan jam server. Selisih > 5 menit menghasilkan `audit_event` type `clock_drift_detected`.

**Acceptance criteria.**

- [ ] `occurred_at` dan `recorded_at` selalu tersimpan terpisah
- [ ] HLC tersimpan pada setiap record yang direplikasi
- [ ] Selisih jam > 5 menit menghasilkan audit event
- [ ] Laporan menampilkan transaksi dengan anomali waktu

---

### FR-F9 & FR-F10 [P0] — Tidak dapat dimatikan, owner tidak dikecualikan

**Acceptance criteria.**

- [ ] Tidak ada setting, feature flag, maupun endpoint yang menonaktifkan audit trail
- [ ] Tindakan owner menghasilkan audit event yang sama lengkapnya
- [ ] Akses support menghasilkan audit event (`support_session_started`)
- [ ] Retensi audit trail **minimal 5 tahun**, lebih panjang dari retensi transaksi — sengketa muncul berbulan-bulan kemudian

---

### FR-F11 [P0] — Alasan dari daftar tertutup

**Deskripsi.** Free text tidak dapat diagregasi menjadi laporan fraud. Daftar tertutup + "Lainnya" yang wajib catatan adalah kompromi yang benar.

Daftar per operasi ada di Modul B § B.4.

**Acceptance criteria.**

- [ ] `reason_code` divalidasi terhadap daftar yang berlaku untuk operasi tersebut
- [ ] "Lainnya" memvalidasi `reason_note` ≥10 karakter
- [ ] Laporan dapat mengagregasi per `reason_code`
- [ ] Daftar alasan dapat dikonfigurasi per tenant tanpa rilis

---

## F.5 Akses support

**Deskripsi.** Untuk mendukung ratusan merchant, akses support diperlukan — tetapi harus menjadi fitur sistem, bukan akses database langsung.

**Aturan.**

| Aturan | Implementasi |
|---|---|
| Butuh persetujuan merchant | Owner menyetujui dari dashboard; berlaku sekali per sesi |
| Berbatas waktu | Default 2 jam, maksimum 24 jam |
| Sangat terlihat | Banner menonjol di seluruh layar saat sesi aktif |
| Tercatat penuh | `SupportSession` + `audit_event` untuk setiap tindakan |
| Read-only secara default | Mutasi memerlukan persetujuan terpisah |

**Struktur `SupportSession`:** `id`, `admin_user_id`, `tenant_id`, `granted_by`, `reason`, `started_at`, `expires_at`, `ended_at`, `is_write_enabled`.

**Acceptance criteria.**

- [ ] Akses support tanpa persetujuan merchant tidak mungkin
- [ ] Sesi berakhir otomatis saat `expires_at`
- [ ] Banner terlihat di semua layar selama sesi aktif
- [ ] Setiap tindakan selama sesi support tercatat dengan penanda

---

## F.6 Edge cases modul

| Situasi | Perilaku |
|---|---|
| Kasir lupa PIN | Manajer mereset PIN; reset tercatat; PIN baru wajib diubah kasir saat login pertama |
| Manajer satu-satunya sedang cuti | Owner dapat menyetujui dari jarak jauh? **Tidak di v1** — otorisasi butuh kehadiran fisik di perangkat. Mitigasi: manajer kedua |
| Kasir dinonaktifkan saat shift aktif | Shift berjalan tetap dapat ditutup; login berikutnya ditolak |
| Perangkat dicuri saat offline dengan antrean berisi | Data terenkripsi at-rest; token dicabut; wipe berjalan bila perangkat terhubung. Antrean yang belum terkirim **hilang** — ini konsekuensi yang harus dinyatakan ke merchant |
| Dua pengguna dengan PIN sama di outlet berbeda | Diizinkan — PIN unik per outlet, bukan per tenant |
| Owner menghapus dirinya sendiri | Ditolak — minimal satu owner harus ada |
| Peran diubah saat pengguna sedang login | Berlaku pada aksi berikutnya, bukan memaksa logout |
| Audit event gagal ditulis | **Operasi utamanya juga gagal** — audit ditulis dalam transaksi yang sama, bukan best-effort |
| Jam perangkat mundur ke tahun 2020 | Transaksi tetap tersimpan; HLC menjaga urutan; anomali ditandai menonjol |
| Merchant meminta menghapus audit trail | Ditolak. Dinyatakan di Syarat & Ketentuan |

---

## F.7 Test yang wajib ada

**Property test:**

- [ ] Untuk operasi berotorisasi apa pun: `audit_event` memiliki dua identitas berbeda
- [ ] Tidak ada urutan operasi yang menghasilkan `UPDATE`/`DELETE` pada `audit_event`
- [ ] Untuk pengguna dan peran apa pun: operasi di luar hak aksesnya ditolak

**Test keamanan:**

- [ ] PIN plaintext tidak muncul di log — test mengirim PIN dan memeriksa seluruh output log
- [ ] Kasir tidak dapat mengakses endpoint margin/HPP secara langsung lewat API
- [ ] Token perangkat A ditolak saat dipakai dari perangkat B
- [ ] Manajer Outlet A tidak dapat membaca data Outlet B lewat manipulasi parameter

**Test offline:**

- [ ] Login, otorisasi, dan penguncian PIN berfungsi tanpa jaringan
- [ ] Logout diblokir saat antrean tidak kosong
- [ ] Penguncian bertahan melewati restart

---

## F.8 Open questions modul ini

| # | Pertanyaan | Dibutuhkan sebelum |
|---|---|---|
| OQ-08 | Batas kredensial offline (rekomendasi 30 hari) versus janji offline tak terbatas | Implementasi FR-F12 |
| — | Apakah peran `Akuntan` benar-benar dibutuhkan di v1? | Perencanaan F3 |
| — | Apakah owner dapat menyetujui otorisasi dari jarak jauh (mis. lewat notifikasi HP)? Menyelesaikan masalah nyata tetapi membuka vektor fraud baru | v1.1 |
| ~~Panjang PIN 4 atau 6 digit?~~ | ✅ **Terjawab: 6 digit.** 100× ruang pencarian, selisih waktu ketik dapat diabaikan | — |
| — | Apakah MFA wajib untuk Owner sejak v1, atau v1.1? Menambah friksi pada persona yang paling jarang login | Implementasi FR-F2b |
| — | Periode rotasi PIN manajer — 90 hari usulan; validasi dengan 3 merchant | Implementasi FR-F2 |

---

*Spec Modul F · Lumi POS v1 · Draft 0.1*
