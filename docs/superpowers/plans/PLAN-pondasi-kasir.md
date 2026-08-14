# PLAN — pondasi `apps/kasir`

**Status:** SELESAI 8 Agustus 2026 — §3.1–§3.7 disetujui penuh, dikerjakan, 846 test hijau + harness browser 14/14
**Keputusan user:** node --test + harness browser sungguhan (happy-dom ditolak) · router buatan sendiri · tanpa state library · `@powersync/web@2.1.1` · JWT pindah ke endpoint server (Modul F), tidak pernah di-generate di klien · scope pondasi apa adanya · interval 15 detik
**Fase:** F2, sisi klien · **Prasyarat untuk:** FR-H2, FR-H3, FR-H7
**Dokumen pengikat:** `product/IA-lumi-pos-v1.md` §2 dan §7 · `product/ARCH-lumi-pos-v1.md` §7 dan §14 · `CLAUDE.md` bagian F2

---

## 1. Apa yang benar-benar ada sekarang

Dibaca dari kode, bukan dari ingatan:

| Bagian | Keadaan |
|---|---|
| `apps/kasir/src` | **Tiga berkas.** `App.tsx` merender `<AppShell>` berisi satu `<p>`. Tanpa rute, tanpa state, tanpa database |
| `apps/kasir` dependency | React 19, Tauri 2, `ds`. **Tidak ada** PowerSync, tidak ada router, tidak ada test runner |
| `packages/sync-client` | 45 test hijau, **tidak tersambung ke apa pun**. Tidak ada penjadwal yang memanggil `kirimBatch` |
| Port `DbLokal` | Baru pernah diisi `node:sqlite`. Kecocokannya dengan `writeTransaction` PowerSync **belum dibuktikan dengan menjalankan kode** |
| Reaktivitas PowerSync | **Belum pernah dijalankan.** Prototipe 05 memakai `setInterval` 500 ms, bukan `watch()`/`onChange` |
| Token PowerSync | Prototipe mencetak JWT **simetris di dalam browser**. Tidak ada endpoint token di server, dan tidak ada JWKS |
| Test kode browser | **Nol.** 791 test seluruhnya `node --test`. Prototipe 03/04/05 diuji lewat harness buatan tangan, dijalankan manual, hasilnya ditempel ke FINDINGS |
| K-14 Status Sinkronisasi | **Sudah ada di IA** — `IA:64`, `IA:111`, rute `/kasir/sync` (`IA:316`). Bukan layar karangan |

Yang mengikat kode klien sudah tertulis lengkap di `CLAUDE.md` bagian F2 — sepuluh aturan hasil prototipe 04 dan 05. Rencana ini memasangnya, tidak menegosiasikannya ulang.

---

## 2. Yang dibangun

**Kerangka dan sambungan. Nol layar fitur.**

```
apps/kasir/src/
  lokal/     skema raw table · pembuka database · adapter DbLokal · migrasi lokal
  sync/      connector PowerSync · port sumber token · penjadwal relay
  rute/      tabel rute (fungsi murni) + komponen penyambung
  layar/     satu komponen per rute; seluruhnya `BelumDibangun` kecuali kerangka
  konteks/   provider: database, konfigurasi perangkat
```

Setelah ini selesai, FR-H2 dan FR-H3 adalah pekerjaan mengisi K-14 dan menyambungkan `SyncIndicator` — bukan membangun aplikasi.

---

## 3. Tujuh keputusan yang perlu kamu ambil

### 3.1 Bagaimana kode browser diuji — keputusan terpenting di dokumen ini

Repo ini punya 791 test dan **nol** di antaranya menyentuh React. Kalau pola itu diteruskan tanpa disadari, kita akan punya aplikasi kasir tanpa jaring pengaman apa pun.

Ada satu fakta yang membuka jalan keluar murah: `test:dst` sudah berjalan dengan `node --experimental-strip-types`. **Node dapat menjalankan `.ts` kita apa adanya** — selama modulnya tidak mengimpor React atau PowerSync.

| Opsi | Isi | Harga |
|---|---|---|
| **A (usulanku)** | Semua logika ditulis sebagai modul murni `.ts` dan diuji `node --test`. React dijaga tetap tipis. Ditambah **satu harness browser** untuk klaim yang hanya browser dapat buktikan, pola prototipe | Nol dependency baru |
| B | Vitest + `@testing-library/react` + happy-dom | 3 dev dependency; **dan happy-dom tidak punya OPFS maupun Web Worker sungguhan** — suite hijau tidak membuktikan PowerSync bekerja |
| C | Vitest browser mode / Playwright, Chromium sungguhan di CI | Membuktikan OPFS; CI naik dari 3 menit, plus unduhan browser |

**Usulanku A**, dengan dua syarat yang saya tulis supaya tidak jadi janji kosong:

1. Setiap keputusan yang dapat ditulis sebagai fungsi murni **harus** ditulis begitu, bukan ditanam di komponen. Ini yang membuat "React-nya tipis" dapat diperiksa, bukan diklaim.
2. Keputusan ini **ditinjau ulang saat layar kasir sungguhan pertama** (K-03/K-06) dibangun, dan dicatat sebagai utang di `HANDOFF.md` sampai itu terjadi.

B saya tolak sebagai pilihan utama justru karena ia terlihat paling meyakinkan: happy-dom akan memberi kita suite hijau yang tidak menyentuh satu pun hal yang berbahaya di aplikasi ini.

### 3.2 Router — library atau buatan sendiri

`IA:308-317` sudah mengunci daftar URL kasir: `/login`, `/shift/buka`, `/`, `/riwayat`, `/riwayat/:orderId`, `/shift/tutup`, `/sync`, `/perangkat`.

- **A (usulanku): buatan sendiri.** Satu fungsi murni `cocokkanRute(pathname) → { layar, params }` plus pembungkus tipis di atas `history`. Sekitar 60 baris, **dapat diuji penuh di node**, dan daftar rutenya menjadi terjemahan langsung dari IA.
- B: `react-router` — dependency baru.

Alasan A bukan "library itu buruk": permukaan yang kita butuhkan kecil (delapan rute, satu layout, tanpa nested route), Tauri tidak memberi kasir URL bar, dan router buatan sendiri adalah satu-satunya bentuk yang masuk `node --test`. **Back-office boleh memutuskan berbeda** — ia punya sidebar, breadcrumb, dan 30 layar.

### 3.3 State management

- **A (usulanku): tanpa library.** Yang benar-benar global hanya database, konfigurasi perangkat, dan sesi — itu React context. **Data dibaca dari SQLite, tidak disalin ke store JS.**
- B: Zustand atau sejenisnya.

Alasan mengikat: **database lokal ADALAH state-nya.** Menyalin katalog dan antrean ke store berarti dua sumber kebenaran plus invalidasi cache — persis masalah yang PowerSync selesaikan. Yang tersisa untuk context terlalu sedikit untuk membayar library.

⚠️ **Satu hal yang membuat A bergantung pada bukti:** reaktivitas. Rencananya `useSyncExternalStore` di atas `db.watch()`/`onChange`. Kita **belum pernah menjalankan API itu** — prototipe 05 memakai polling 500 ms. Kalau `watch` tidak berperilaku seperti asumsi ini, keputusan 3.3 dibuka kembali. Itu sebabnya ia jadi task tersendiri (T7) dan bukan detail implementasi.

### 3.4 Dependency baru yang saya minta

Satu, dan sudah terbukti jalan di dua prototipe:

- **`@powersync/web@2.1.1`** ke `apps/kasir`

Yang **tidak** saya minta: `@powersync/react` (tidak perlu bila 3.3-A dipilih), router, state library, test runner.

### 3.5 Token PowerSync — port sekarang, endpoint nanti

Prototipe mencetak JWT simetris di browser. Itu pola prototipe dan **tidak boleh masuk aplikasi**: kunci simetris di klien berarti setiap perangkat dapat mencetak token untuk tenant mana pun — dan pada jalur turun, sync rules adalah satu-satunya batas tenant (`CLAUDE.md` F2, ⛔ pertama).

Produksi menuntut kunci **asimetris**, JWKS diterbitkan server kami, token per perangkat. Itu menuntut autentikasi perangkat, yang adalah **Modul F** dan belum ada selain `POST /devices`.

- **A (usulanku):** pondasi mendefinisikan port `SumberToken` dan mengirim implementasi pengembangan yang membaca token dari konfigurasi. Endpoint sungguhan menjadi sub-project sendiri bersama Modul F.
- B: bangun endpoint token sekarang.

B menyeret autentikasi perangkat, rotasi kunci, dan masa berlaku ke dalam pondasi UI — tiga keputusan yang belum kamu ambil.

### 3.6 Sampai mana "pondasi" berhenti

Usul: **kerangka penuh, isi kosong.** Tabel rute memuat **seluruh** rute kasir dari IA; rute yang layarnya belum dibangun merender satu komponen `BelumDibangun` bersama (bukan 17 komponen palsu). Yang benar-benar hidup di sub-project ini hanya shell dan topbar.

Konsekuensi yang sengaja: **`SyncIndicator` di topbar belum tersambung ke data antrean.** Itu FR-H2, dan menyambungkannya di sini berarti mengerjakan H2 sambil menyebutnya pondasi.

### 3.7 Penjadwal relay — di mana ia tinggal dan apa yang memicunya

`kirimBatch` sudah ada; tidak ada yang memanggilnya.

Usul: **penjadwal ditulis di `packages/sync-client` sebagai fungsi murni dengan timer di-inject** — sejajar `now` yang sudah di-inject di sana, jadi ia tetap dapat diuji tanpa browser. `apps/kasir` hanya menyuntikkan timer sungguhan.

Pemicunya tiga, dan ketiganya perlu kamu setujui karena menentukan perilaku yang terlihat merchant:

1. Interval berkala (usulan **15 detik** saat antrean tidak kosong, berhenti saat kosong)
2. Segera setelah penulisan lokal baru masuk antrean
3. Saat koneksi kembali (`online`)

Angka 15 detik `[ASUMSI]` — tidak ada spec yang menyebutkannya.

---

## 4. Yang HANYA dapat dibuktikan di browser — dan bagaimana saya membuktikannya

Ini bagian yang paling mudah dipalsukan, jadi saya tulis batasnya lebih dulu.

| Klaim | Dapat diuji di node? |
|---|---|
| Pemetaan rute, penjadwal relay, keputusan migrasi lokal, daftar raw table | ✅ `node --test` |
| Adapter `DbLokal` di atas `writeTransaction` PowerSync | ❌ browser |
| `watch()`/`onChange` benar-benar memicu render | ❌ browser |
| `disconnectAndClear()` sungguh memulihkan setelah skema lokal dibangun ulang | ❌ browser |
| Antrean bertahan melewati force-close di OPFS | ❌ browser |

Yang browser-only dijalankan lewat **satu halaman harness** di `apps/kasir` (mode dev, tidak ikut build rilis), pola yang sama dengan prototipe 04/05 — dan hasilnya ditempel apa adanya, termasuk bila merah. Harness itulah yang menemukan cacat `tax_rate.rate`; ia bukan formalitas.

---

## 5. Task — TDD, test gagal dulu

| # | Isi | Diuji di |
|---|---|---|
| T1 | Tabel rute dari `IA:308-317` + `cocokkanRute` murni, termasuk `:orderId` dan rute tak dikenal | node |
| T2 | Modul skema lokal: `TABEL_RAW`, `TABEL_LOKAL_SAJA`, definisi raw table. **Tanpa impor Vite** supaya node dapat memuatnya | node |
| T3 | **Penjaga drift**: baca `db/local/001-initial.sql`, bandingkan kolom per kolom dengan T2. Gagal bila ada tabel direplikasi yang tidak dideklarasikan, kolom hilang, **atau tabel lokal-saja ikut dideklarasikan** | node |
| T4 | **`put` yang ditulis sendiri untuk setiap kolom yang tipenya berbeda** antara PostgreSQL dan skema lokal — `tax_rate.rate` sudah terbukti; `conversion_factor`, setiap `quantity`, `service_charge_rate` diperiksa dengan mata yang sama | node |
| T5 | Keputusan migrasi lokal: versi skema berubah **dan** menyentuh raw table → wajib `disconnectAndClear()`. Fungsi murni; pemanggilannya di T9 | node |
| T6 | Penjadwal relay di `packages/sync-client`: timer di-inject, berhenti saat antrean kosong, tidak menumpuk putaran, tiga pemicu §3.7 | node |
| T7 | **Harness browser**: `watch()`/`onChange` memicu pembaruan tanpa polling | browser |
| T8 | **Harness browser**: adapter `DbLokal` di atas `writeTransaction` — satu penjualan utuh + rollback sungguhan; membuktikan klaim port yang selama ini belum terbukti | browser |
| T9 | **Harness browser**: bangun ulang raw table lokal → tanpa `disconnectAndClear()` katalog kosong permanen; dengan itu, pulih | browser |
| T10 | Shell: `AppShell` + topbar + router terpasang, `BelumDibangun` punya keadaan kosong sesuai aturan DS | browser (mata) |
| T11 | `enableMultiTabs` di-set **eksplisit**; `vite build` hijau (menjaga `worker: { format: 'es' }` tetap berguna) | perintah |

Skrip baru `test:kasir` (`node --experimental-strip-types --test`), masuk CI bersama yang lain.

---

## 6. Yang TIDAK dikerjakan

- **FR-H2, FR-H3, FR-H7.** Termasuk menyambungkan `SyncIndicator` ke data antrean.
- **Layar fitur apa pun** — K-01 sampai K-17 tetap `BelumDibangun`.
- **Endpoint token / JWKS di server**, dan autentikasi perangkat (Modul F).
- **`product/`, `research/`, `docs/superpowers/specs/`** tidak disunting. Kalau §3.7 berarti spec perlu menyebut interval relay, itu keputusanmu.
- **Backfill `NOT NULL` untuk ~15 tabel lokal** (utang HANDOFF) — perubahan skema lokal, pekerjaan terpisah.
- **Membangun UI back-office atau owner mobile.**

---

## 7. Verifikasi sebelum menyatakan selesai

- [x] `test:kasir` hijau (48), dan seluruh suite lama tetap hijau — **846 test, 0 gagal**
- [x] `npm run typecheck` dan `npm run lint:ds` hijau — `apps/kasir` masuk cakupan keduanya
- [x] `npm ci --dry-run` exit 0 (dependency baru → lock ikut di-commit)
- [x] `npm run build` di `apps/kasir` hijau — dan kini benar-benar memuat PowerSync + wa-sqlite
- [x] Harness browser dijalankan, **14/14 LULUS**, outputnya ditempel di §10
- [x] Sabotase dijalankan, empat kali, semuanya merah pada jangkar yang benar (§10)

---

## 8. Checklist

- [x] Keputusan §3.1–§3.7 diambil
- [x] T1 rute · T2 skema · T3 penjaga drift · T4 `put` per kolom
- [x] T5 keputusan migrasi · T6 penjadwal relay
- [x] T7 reaktivitas · T8 adapter `DbLokal` · T9 keputusan migrasi di penyimpanan nyata
- [x] T10 shell · T11 build rilis
- [x] Sabotase dijalankan dan hasilnya dicatat
- [x] `HANDOFF.md` diperbarui — termasuk utang §3.1 (test React ditunda)

---

## 9. Empat hal yang berbeda dari rencana

**⛔ PowerSync menyimpan database di IndexedDB, BUKAN OPFS.** Ditemukan saat harness pertama kali berjalan: pembersih sisa harness menyapu OPFS dan selalu menemukan nol berkas, sementara databasenya jelas-jelas ada. `@powersync/web@2.1.1` default-nya `WASQLiteVFS.IDBBatchAtomicVFS` (`resolveAndValidateOptions.js:32`); OPFS adalah opsi yang harus diminta. Prototipe 04 dan 05 tidak pernah menyetel `vfs`, jadi **seluruh angkanya — termasuk 12,33 ms per penjualan — adalah angka IndexedDB**, dan tidak sebanding dengan angka prototipe 03 (`@sqlite.org/sqlite-wasm`, `opfs-sahpool`). Harness sekarang MELAPORKAN penyimpanan yang dipakai di setiap run. Pilihan VFS tidak diambil sendiri — ia keputusan pemilik produk.

**`disconnectAndClear()` dijalankan SEBELUM DDL, bukan sesudah.** Rencana menyiratkan sebaliknya. Urutan yang dipakai adalah urutan yang benar-benar dijalankan dan diukur di prototipe 05 (`init` → `disconnectAndClear` → pasang tabel → `updateSchema`); urutan sebaliknya belum pernah dijalankan sama sekali, dan `disconnectAndClear` mengenal raw table kami.

**Versi skema lokal berupa SIDIK JARI, bukan nomor.** Nomor versi harus diingat untuk dinaikkan, dan yang lupa dinaikkan menghasilkan tepat keadaan paling berbahaya di jalur turun. Sidik jarinya dihitung dari nama + kolom raw table, disimpan di tabel lokal baru `skema_lokal`. Tabel murni lokal sengaja tidak ikut dihitung — bentuk `outbox_local` tidak ada hubungannya dengan checkpoint PowerSync.

**Interval tetap 15 detik membuat tiga anak tangga backoff terbawah efektif jadi 15 detik.** spec-h:62 menulis 2/4/8/16/32/60 detik; dengan tick tetap, yang di bawah 15 detik hanya tercapai pada tick berikutnya. Arahnya selalu lebih lambat, tidak pernah lebih agresif, jadi ia tidak melanggar maksud spec — tapi ia nyata, dipaku oleh test, dan diangkat sebagai pertanyaan produk.

---

## 10. Bukti

### Harness browser (`apps/kasir/harness.html`, Chromium, 8 Agustus 2026)

```
LULUS  T9a boot pertama memutuskan bangun ulang + bersihkan sync (4 sisa dibuang)
       {"perluBangunUlang":true,"perluBersihkanSync":true,"alasan":"Skema lokal belum pernah dipasang di perangkat ini."}
LULUS  T0  di mana database lokal disimpan   IndexedDB: YA (2 db) · OPFS: tidak (0 entri) · persisted=false
LULUS  T9b sidik jari skema tersimpan di perangkat            fnv1a-1e248518-2290
LULUS  T3a nol tabel ps_data__*                               tidak ada
LULUS  T3b nol VIEW bikinan PowerSync                         tidak ada
LULUS  T3c outbox_local ada dan TIDAK dikenal PowerSync       ada
LULUS  T8a satu penjualan = satu writeTransaction             order=1 outbox=1 · 5.01 ms
LULUS  T8b kegagalan di tengah transaksi benar-benar rollback melempar=true baris tersisa=0
LULUS  T8c transaksi bersarang ditolak, tidak menggantung
LULUS  T8d kirimBatch memindahkan item ke `sent`              terkirim=1 status=sent
LULUS  T7  watch() memicu pembaruan tanpa polling             pemberitahuan: 1 -> 2
LULUS  T6e penjadwal mengosongkan antrean lalu menganggur     dikirim=1 sisa=0 menganggur=true
LULUS  T9c boot kedua: skema tidak dibangun ulang
LULUS  T9d outbox_local selamat melewati boot ulang           2 baris
```

### Sabotase

| Yang dimatikan | Akibat |
|---|---|
| Satu tabel karangan ditambahkan ke `TABEL_RAW` | T3 merah: *"TABEL_RAW + TABEL_LOKAL_SAJA harus persis sama dengan tabel di db/local/001-initial.sql"* |
| `SKALA_KOLOM.order_line.tax_rate` dilepas | T4 merah: *"order_line.tax_rate adalah numeric(6,4) di server dan integer di lokal, tapi tidak punya skala"* |
| `bersihkanSync()` dilepas dari `jalankanMigrasi` | T5 merah pada urutan langkah |
| Tabel lokal ikut masuk daftar `drop` | T5 merah: *"stock_snapshot ikut di-drop -- antrean upload akan hilang"* |
| Penjadwalan ulang dimatikan | Empat test T6 merah |
| `worker.format` diubah ke `iife` | `vite build` merah: *"Invalid value \"iife\" for option \"worker.format\""* |

Jangkar diperiksa lebih dulu pada setiap sabotase.

### Suite

```
domain 107 · dst 10 · sync-client 59 · kasir 48 · sqlite-local 8 · oxlint-ds-adherence 10
isolation 189 · schema 14 · server 14 · catalog 147 · ordering 117 · dst-server 10 · payment 120
= 853 test, 0 gagal · typecheck bersih · lint:ds bersih · npm ci --dry-run exit 0
```

---

## 11. Empat keputusan yang tertunda, diambil 8 Agustus 2026

Diambil sendiri atas permintaan user ("evaluasi opsi paling valid, putuskan"). Tiga dari empat diputuskan lewat **pengukuran**, bukan argumen — `CLAUDE.md` menetapkan angka hasil pengukuran mengalahkan estimasi, dan ketiganya persis kelas itu.

### 11.1 VFS — `OPFSWriteAheadVFS`

Keempat kandidat diukur lewat PowerSync di `apps/kasir/harness-vfs.html`, tiga run, beban kerja **sama persis** dengan prototipe 03 §5b dan prototipe 04 (10 baris di 8 tabel, satu `writeTransaction`, 60 penjualan; berkas bebannya **diimpor**, bukan disalin). `enableMultiTabs: true` dipertahankan di semua kandidat.

| VFS | pasang skema (ms) | p50 | p95 | p99 | penjualan/dtk | disimpan di |
|---|---:|---:|---:|---:|---:|---|
| `IDBBatchAtomicVFS` *(default paket)* | 351–396 | 26,8 / 27,5 / 28,5 | 37,6–40,0 | 40,0–41,8 | 34–37 | IndexedDB |
| `OPFSCoopSyncVFS` | 158–236 | 9,1 / 7,0 / 9,0 | 8,5–11,9 | 8,6–12,4 | 106–139 | OPFS |
| `AccessHandlePoolVFS` | 216–228 | 9,2 / 11,8 / 9,0 | 10,6–15,2 | 10,7–18,4 | 83–110 | OPFS |
| **`OPFSWriteAheadVFS`** | **123–135** | **5,1 / 5,0 / 4,5** | 7,3–9,6 | 11,6–12,3 | **168–200** | OPFS |

Default paket adalah yang **paling lambat, ~5,5×**. Ia juga yang diam-diam berlaku selama prototipe 04 dan 05.

Dua tab diuji terpisah (`harness-dua-tab.html`): keduanya menulis 20 baris, keduanya melihat seluruh 40. Pola satu-penulis yang prototipe 04 §7 sandarkan pada `enableMultiTabs` karena itu **tetap berlaku di atas OPFS** — dan itu bukan sesuatu yang boleh diasumsikan, karena prototipe 04 mengukurnya di atas IndexedDB.

Cadangan bila ekor latensi kelak jadi masalah: `AccessHandlePoolVFS`, ekor paling rapat, satu konstanta.

### 11.2 Interval relay adalah batas atas, bukan denyut

Versi pertama memakai 15 detik sebagai denyut tetap. Akibatnya baru terlihat saat ditulis sebagai test: ketiga anak tangga backoff di bawah 15 detik (2/4/8, `spec-h:62`) tidak pernah tercapai, jadi penjualan yang gagal sekali karena gangguan sekejap menunggu 15 detik alih-alih 2.

Sekarang jeda berikutnya = waktu jatuh tempo **terdekat**, dipotong di 15 detik, dengan lantai 250 ms. Batas atasnya tetap perlu — item yang tertahan dependensi tidak punya waktu jatuh tempo, dan tanpa batas itu antrean seperti itu diam selamanya.

### 11.3 Koneksi kembali TIDAK mereset backoff

Ditolak. `spec-h:62` tidak menyebutnya, dan perangkat yang baru tersambung akan menembakkan 50 item ke server yang mungkin belum pulih. Pemicu `online` tetap menjalankan putaran segera; yang jatuh tempo naik, yang belum menunggu jatahnya.

### 11.4 ⛔ `watch()` ~1.000 ms — indikator antrean tidak boleh bergantung padanya

Diukur di browser: notifikasi `watch()` atas raw table datang **997 / 1013 / 1004 / 1004 / 998 ms** lewat `execute`, dan **1014 / 1001 / 1013 / 999 ms** lewat `writeTransaction`. `throttleMs: 20` tidak mengubahnya sama sekali. Mekanismenya tidak berhasil saya temukan di kode paket; yang mengikat adalah angkanya.

`spec-h:224` menuntut *"Indikator diperbarui < 1 detik setelah perubahan status"*. Seribu milidetik bukan di bawah satu detik — ia tepat di ambang, dan separuh pengukuran melewatinya.

**Keputusan:** perubahan yang lewat kode kita mengirim ISYARAT baca-ulang lewat `buatPemberitahu()`; datanya tetap dibaca dari SQLite. `watch()` **tidak diganti** — ia tetap satu-satunya yang melihat perubahan dari luar (katalog yang turun, tulisan tab lain). Yang satu instan tapi buta, yang lain lambat tapi melihat semuanya. Keputusan §3.3 utuh: database tetap satu-satunya sumber kebenaran, yang dipercepat hanya kapan seseorang tahu harus bertanya lagi.

### 11.5 Satu test saya sendiri yang cacat

T7 memakai `await tunggu(500)` dan **melaporkan GAGAL** saat mesinnya sibuk — `watch()` sebenarnya menyala, hanya lebih lambat dari 500 ms. Test yang gagal ke arah "produk rusak" lebih buruk daripada tidak ada test: ia mengirim orang memburu cacat yang tidak ada. Diganti `tungguSampai(syarat, batas)`, dan latensinya kini ikut dilaporkan — angka itulah yang menjadi §11.4.
