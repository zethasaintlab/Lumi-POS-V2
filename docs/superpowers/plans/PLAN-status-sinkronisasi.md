# PLAN — FR-H2 & FR-H3: status sinkronisasi yang terlihat kasir

**Status:** SELESAI 8 Agustus 2026 — disusun dan dieksekusi atas instruksi "putuskan dan lanjutkan". 859 test hijau, harness FR-H2 9/9
**Fase:** F2, sisi klien · **Prasyarat:** pondasi `apps/kasir` (`PLAN-pondasi-kasir.md`) — selesai
**Spec:** `product/specs/spec-h-sinkronisasi.md` FR-H2 (baris 204–225) dan FR-H3 (228–265) · `product/IA-lumi-pos-v1.md` §2.2 K-14, §2.4, §7

---

## 1. Yang dibangun

Dua hal yang saling menunjuk: indikator di topbar, dan layar yang ia tuju.

`IA:114` menyatakan relasinya harus eksplisit — *"indikator yang tidak dapat diklik membuat kasir tidak tahu harus berbuat apa."*

Pembagiannya mengikuti §3.1 pondasi: **semua keputusan jadi fungsi murni** di `packages/sync-client`, React tinggal menggambar.

---

## 2. Keputusan yang saya ambil sendiri

Diambil karena user meminta ("evaluasi, putuskan, lanjutkan"). Semuanya dicatat supaya dapat dibalik.

### 2.1 Apa yang menentukan state indikator

Design system punya empat state; spec memberi teks untuk masing-masing. Pemetaannya:

| Keadaan antrean | state | teks |
|---|---|---|
| ada item `failed` | `failed` | `Gagal kirim (N) · Coba lagi` |
| ada `pending`/`sending` | `queued` | `Offline · N menunggu` |
| kosong | `ok` | `Tersinkron` |

**`offline-only` tidak diproduksi antrean.** Ia untuk data yang memang tidak pernah naik, dan di jalur ini tidak ada yang seperti itu. Ia tetap ada di pemetaan per-record, dipakai pemanggil untuk data murni lokal.

**`failed` menang atas `queued`** — item gagal tidak akan pernah pergi sendiri, sementara yang mengantre akan.

`[ASUMSI]` Teks `queued` menyebut "Offline" meski perangkat mungkin daring dan sedang mengirim. Itu teks yang ditetapkan design system dan spec (`spec-h:215`); saya tidak mengubahnya sendiri.

### 2.2 Status PER-RECORD, bukan hanya global

`spec-h:221` menuntutnya, dan `spec-h:208` menjelaskan alasannya: *"Sync engine yang hanya menyediakan `isOnline` tidak memenuhi kebutuhan."*

Karena itu ada `statusRecord(barisOutbox | null)`: satu order tahu status pengirimannya sendiri. `null` berarti tidak ada entri outbox — sudah dipangkas, atau memang tidak pernah antre — dan itu `ok`.

### 2.3 "Terakhir tersinkron" diturunkan, bukan disimpan

`MAX(last_attempt_at) WHERE status = 'sent'`. Kolom `device_config.last_sync_at` ada tapi tidak ada yang menulisnya, dan kolom yang diisi di tempat lain akan hanyut dari kenyataan.

Ini **waktu jalur NAIK**. Jalur turun punya jamnya sendiri di PowerSync, dan menggabungkan keduanya jadi satu angka akan menyembunyikan kasus "penjualan naik lancar, katalog basi tiga hari" — yang `spec-h:381` sebut eksplisit.

### 2.4 Ekspor darurat: teks, bukan JSON

`spec-h:263` menuntut "dapat dibaca manusia". JSON mentah dapat dibaca mesin. Yang dihasilkan berkas `.txt`: header (perangkat, waktu, jumlah), lalu satu blok per item dengan payload-nya di-format. Ia jaring pengaman terakhir saat perangkat rusak — yang membacanya orang support, bukan parser.

### 2.5 Halaman daftar gagal: 50 per halaman

`spec-h:372` menyebut antrean 5.000 item harus paginated. 50 dipilih karena sama dengan `BATAS_BATCH` — satu halaman = satu batch, dan itu satu-satunya angka yang sudah punya arti di modul ini.

### 2.6 Penggunaan storage: `navigator.storage.estimate()`

Satu-satunya sumber yang ada. `spec-h:264` dan AC FR-H7 keempat menuntutnya ditampilkan. Nilainya kuota browser, **bukan** kapasitas disk perangkat — dan itu ditulis di layar, bukan disembunyikan, karena `persisted = false` berarti angka itu bisa berubah tanpa pemberitahuan.

---

## 3. Yang tidak dikerjakan

- **FR-H4** (blokir logout/resync saat antrean tidak kosong). Ia butuh sesi dan tombol logout, yaitu Modul F. Diangkat, tidak dibangun.
- **FR-H8** (notifikasi antrean menua) — P1.
- **Menyalakan penjadwal relay.** Masih menunggu identitas perangkat (Modul F). Tombol "Coba kirim sekarang" memicu satu putaran manual dengan pengirim yang di-inject; ia tidak memerlukan penjadwal berjalan.
- Layar K-15, dan layar kasir mana pun selain K-14.

---

## 4. Task — TDD

| # | Isi | Diuji di |
|---|---|---|
| H2-1 | `ringkasanAntrean(db)` — menunggu, gagal, tertua, terakhir terkirim | node |
| H2-2 | `keadaanIndikator(ringkasan)` — pemetaan §2.1, teks persis design system | node |
| H2-3 | `statusRecord(baris)` — status per-record, termasuk `null` | node |
| H3-1 | `pesanGagal(baris)` — alasan yang dapat dipahami, bukan stack trace | node |
| H3-2 | `umurRelatif(dari, sekarang)` — "2 jam lalu", bahasa Indonesia | node |
| H3-3 | `daftarGagal(db, halaman)` — 50 per halaman, urut tertua | node |
| H3-4 | `buatEksporDarurat(...)` — teks yang dapat dibaca manusia, memuat seluruh antrean | node |
| H3-5 | Layar K-14 + rute `/sync` merender ringkasan, gagal, storage, ekspor | browser |
| H2-4 | `SyncIndicator` topbar tersambung, diperbarui **< 1 detik** lewat `pemberitahu` | browser |

---

## 5. Verifikasi

- [x] Seluruh suite hijau (**859 test**), `typecheck`, `lint:ds`, `vite build`
- [x] Harness browser dijalankan, output ditempel apa adanya (§7)
- [x] Sabotase pada tiap jalur yang menentukan, jangkar diperiksa lebih dulu (§7)

---

## 6. Tiga hal yang berbeda dari rencana

### 6.1 `<Button>` design system tidak dapat menerima `onClick`

`ds-bundle/_adherence.oxlintrc.json` — yang `CLAUDE.md` nyatakan final dan tidak boleh diubah — membatasi props `<Button>` menjadi tepat `variant`, `critical`, `fullWidth`, `className`, `style`, `key`, `ref`, `children`. `onClick` dan `disabled` adalah pelanggaran yang **menjatuhkan `npm run lint:ds` di CI**, meskipun komponennya me-spread `...rest` dan akan bekerja.

Jalan keluarnya bukan mengakali linter, melainkan mengikuti apa yang design system SENDIRI lakukan: `SyncIndicator.jsx` merender `<button className="btn btn-danger">` langsung. `apps/kasir/src/Tombol.tsx` melakukan hal yang sama, satu tempat, dengan alasannya tertulis. Kalau konfigurasi adherence kelak mengizinkan handler, berkas itu dihapus.

### 6.2 Indikator adalah `span role="button"`, bukan `<button>`

Pada state `failed`, `SyncIndicator` merender tombol "Coba lagi" miliknya sendiri — dan tombol di dalam tombol adalah HTML tidak sah. `spec-h:216` menuliskan teks gagal utuh ("Gagal kirim (2) · Coba lagi"), dan bagian "Coba lagi" itu **hanya muncul bila `onRetry` diberikan**; indikator tanpa `onRetry` karena itu tidak memenuhi AC-nya. Keduanya menuju K-14, jadi tidak ada aksi yang hilang.

Catatan yang perlu diketahui: pemisah "·" pada state failed adalah `<span className="dot" />` — titik VISUAL tanpa teks. `textContent`-nya berbunyi "Gagal kirim (2) Coba lagi". Yang dituntut spec ada di layar; yang tidak ada hanya glifnya di `textContent`.

### 6.3 Alat ukurnya sendiri yang cacat, dua kali

**Konsol devtools tidak dapat dipakai mengukur ini.** `import()` dari konsol mendapat **instance modul kedua** — Vite menambahkan `?t=` pada modul yang sudah lewat HMR, dan singleton `buka()` memoisasi per instance. Akibatnya pengukuran melaporkan jalur `watch()` (~1.300 ms) sambil terlihat seperti mengukur jalur `pemberitahu`. Terbukti dari `jumlahPelanggan: 0` — aplikasi berlangganan ke objek yang lain. Karena itu pengukuran FR-H2 tinggal di `harness-h2.html`, tempat impornya tunggal dan `ShellKasir` sungguhan dirender.

**`setTimeout` di-clamp ~1.000 ms di tab yang tidak di depan.** Versi pertama harness memakai poll 10 ms dan melaporkan latensi indikator **991 ms** secara konsisten — nyaris sama dengan `watch()`, dan itu membuat seluruh jalur `pemberitahu` terlihat tidak ada gunanya. Probe di dalam test yang sama membantahnya: callback 0,0 ms, query 1,5 ms. Diganti `MutationObserver`, dan angkanya jatuh ke **1–2 ms**.

Dua-duanya kelas kesalahan yang sama dengan T7 di sub-project sebelumnya: alat ukur yang gagal ke arah "produk rusak".

---

## 7. Bukti

### Harness FR-H2 (`apps/kasir/harness-h2.html`, Chromium)

```
LULUS  H2-4a database aplikasi terbuka                    lumi-kasir.db
LULUS  H2-4b indikator awal                               Tersinkron
LULUS  H2-4c komponen aplikasi berlangganan pemberitahu   1 pelanggan
LULUS  H2-4d1 probe: isyarat / query / DOM   callback 0,0 ms · query 1,5 ms · DOM 130 ms
LULUS  H2-4d tiga item mengantre (pemberitahu)   Tersinkron -> Offline · 3 menunggu — 1 ms
LULUS  H2-4e failed menang, teks lengkap spec-h:216  -> Gagal kirim (2) Coba lagi — 2 ms
LULUS  H2-4f antrean dikosongkan                 -> Tersinkron — 1 ms
LULUS  H2-4g tanpa isyarat: hanya watch()        -> Offline · 1 menunggu — 980 ms
LULUS  H2-4h isyarat jauh lebih cepat            pemberitahu 1 ms vs watch 980 ms
LULUS  H2-4i indikator dapat diklik menuju K-14   Buka Status Sinkronisasi
```

**AC `spec-h:224` (< 1 detik) terpenuhi dengan margin besar pada jalur yang lewat kode kita: 1–2 ms.** Jalur `watch()` 980 ms — itulah alasan `pemberitahu` ada.

### K-14 dengan 63 item (58 gagal, 5 mengantre), di browser

```
Gagal kirim (58) Coba lagi        (topbar, dapat diklik)
Menunggu terkirim  5 · Tertua: 3 jam lalu
Gagal terkirim    58
Penyimpanan perangkat  7 MB / 39,3 GB
Detail item gagal: 50 baris · "Halaman 1 dari 2" · halaman 2 = 8 baris, mulai ord-50
Alasan yang tampil: "Transaksi ini dikirim ulang dengan isi berbeda…" ·
  "Perangkat tidak lagi dikenali server…" · "Data tujuan tidak ditemukan…" ·
  "Koneksi terputus sebelum server menjawab…" · "TypeError: boom"  ← stack frame dibuang
Ekspor darurat: 17.078 karakter, 63 item, blok per item dengan payload ter-format
```

### Sabotase

| Yang dimatikan | Akibat |
|---|---|
| `failed` tidak lagi menang atas `queued` | H2-2 merah |
| `tertuaPada` dihitung dari SELURUH baris | H2-1 merah: umur antrean sehat terbaca satu hari |
| pemotongan stack trace dilepas | H3-1 merah |
| `deps.pemberitahu?.beritahu()` dilepas dari penjadwal | 2 test pemberitahu merah |

Jangkar diperiksa lebih dulu pada setiap sabotase. Satu upaya sabotase (bedah indeks pada `pesanGagal`) merusak seluruh modul alih-alih satu perilaku — hasilnya **dibuang, bukan dilaporkan**, dan diulang dengan suntingan yang tepat sasaran.

### Suite

```
domain 107 · dst 10 · sync-client 85 · kasir 48 · sqlite-local 8 · oxlint-ds-adherence 10
isolation 189 · schema 14 · server 14 · catalog 147 · ordering 117 · dst-server 10 · payment 120
= 859 test, 0 gagal · typecheck bersih · lint:ds bersih · vite build hijau
```
