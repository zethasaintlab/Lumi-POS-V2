# Temuan Prototipe 03 — SQLite WASM + OPFS di browser

**Tanggal:** 7 Agustus 2026 · **Menutup:** item F0 terakhir yang masih terbuka · **Memblokir sebelumnya:** F2 (sisi klien)
**Paket:** `@sqlite.org/sqlite-wasm` 3.53.0-build1 (resmi tim SQLite, keputusan user 7 Agu 2026)

> `CLAUDE.md`: angka hasil pengukuran **mengalahkan** estimasi di dokumen lain. Angka di bawah diukur, bukan diperkirakan.

---

## Ringkasan — dan satu temuan yang membalik asumsi

| Temuan | Dampak |
|---|---|
| **VFS `opfs-sahpool` 71× lebih cepat menulis daripada VFS `opfs`** (3,97 ms vs 281,68 ms per penjualan) | Pilihan VFS bukan detail. 282 ms per penjualan adalah jeda yang **terlihat kasir** setelah setiap transaksi |
| **SAHPool tidak butuh COOP/COEP, dan justru itu yang lebih cepat** | Asumsi di `research/03` bahwa header COOP/COEP adalah harga yang dibayar untuk performa **terbalik** |
| **Dua tab tidak dapat sama-sama menulis** — `NoModificationAllowedError` | Pola "hanya tab aktif yang menulis" bukan optimasi, melainkan **keharusan** |
| **`navigator.storage.persisted()` = `false`** | Data lokal dapat dihapus browser saat ruang menipis. Untuk POS offline-first ini bahaya nyata, dan belum ada yang menanganinya |
| OPFS dan `crossOriginIsolated` keduanya aktif dengan konfigurasi `apps/kasir` apa adanya | Header COOP/COEP dari F0 sudah benar |

---

## 1. Yang diukur

Bukan `INSERT` tunggal. Yang diukur adalah **satu penjualan = satu transaksi** (invariant #1) dalam bentuk sebenarnya: 10 baris di 9 tabel — `order` + `check` + 2× `order_line` + `order_line_modifier` + `payment` + 2× `stock_movement` + `audit_event` + `outbox_local`.

Skema dibaca langsung dari `db/local/001-initial.sql`, bukan salinan — 20 tabel, `journal_mode=WAL`, `foreign_keys=ON`.

Engine dan OPFS berjalan di **Web Worker**, mengikuti pola yang direkomendasikan `research/03-TECH-STACK-EVALUATION.md`:187.

200 transaksi diukur setelah 20 transaksi pemanasan.

---

## 2. Hasil

Lingkungan: browser in-app (Chromium), Windows 11, `crossOriginIsolated = true`.

| Ukuran | `opfs` (SharedArrayBuffer) | `opfs-sahpool` | Rasio |
|---|---|---|---|
| Pasang skema, 20 tabel | **1.398,9 ms** | **84,7 ms** | 16,5× |
| Tulis 1 penjualan — p50 | **281,68 ms** | **3,97 ms** | **71×** |
| Tulis 1 penjualan — p95 | 322,00 ms | 4,99 ms | 65× |
| Tulis 1 penjualan — p99 | 457,43 ms | 5,83 ms | 78× |
| Throughput | **3 penjualan/detik** | **246 penjualan/detik** | 82× |
| Baca total hari ini (220 order) | 4,16 ms | 0,15 ms | 28× |
| Baca 50 order + join baris | 4,85 ms | 0,67 ms | 7× |

Inisialisasi WASM: **45–54 ms**. Versi SQLite: **3.53.0**.

### Kenapa selisihnya sebesar itu

VFS `opfs` menjalankan setiap operasi berkas lewat **proxy asinkron** ke thread lain, dengan `Atomics.wait` di setiap langkah. VFS `opfs-sahpool` memesan `FileSystemSyncAccessHandle` **di muka** dan memakainya secara sinkron — tidak ada perjalanan bolak-balik per operasi.

Untuk POS, 282 ms per penjualan berarti jeda yang terlihat setelah setiap transaksi, dan itu di mesin pengembangan. Angka SAHPool (4 ms) tidak terasa.

---

## 3. Dua tab: `NoModificationAllowedError`

Diukur dengan sengaja, bukan ditemukan sebagai gangguan. Tab pertama membuka pool dan menahannya; tab kedua mencoba hal yang sama:

```
tab 1: tab ini memegang pool → ya
tab 2: tab ini memegang pool → GAGAL — NoModificationAllowedError:
       Access Handles cannot be created if there is another open Access
       Handle or Writable stream associated with the same file.
```

**Konsekuensi arsitektur:** klien kasir **wajib** memakai pola "hanya satu penulis" — persis yang dilakukan Notion menurut `research/03`:185, dengan tab lain merutekan penulisan lewat `SharedWorker` ke tab aktif. Ini bukan optimasi yang bisa ditunda; tanpanya, tab kedua yang tidak sengaja dibuka kasir membuat aplikasi **gagal membuka database sama sekali**.

Catatan penting soal cara mengukurnya: dua koneksi di dalam **satu** worker dilaporkan "diizinkan", dan itu menyesatkan — keduanya berbagi pool yang sama. Pertanyaan yang benar hanya terjawab dengan dua tab sungguhan.

Efek samping yang perlu diketahui: pool yang **tidak dilepas** memblokir run berikutnya dengan error yang sama. Selama pengembangan, kegagalan itu terbaca seperti "OPFS rusak" padahal hanya handle yang tertinggal.

---

## 4. Penyimpanan

| Ukuran | Nilai |
|---|---|
| Kuota | **40.339 MB** (~40 GB) |
| Terpakai setelah 440 order | 0,8 MB |
| `navigator.storage.persisted()` | **`false`** |

Kuota bukan masalah. **`persisted = false` adalah masalah:** tanpa izin persistence, browser boleh menghapus OPFS saat ruang disk menipis — dan yang terhapus adalah antrean upload yang belum terkirim.

`navigator.storage.persist()` harus dipanggil dan hasilnya diperiksa, dan **perilaku saat ditolak harus didefinisikan**. Itu belum ada di spec mana pun. Diangkat sebagai pertanyaan terbuka, bukan diputuskan di sini.

Ekstrapolasi kasar dari 0,8 MB / 440 order: satu outlet dengan 300 transaksi/hari menulis ~0,5 MB/hari, jadi jendela riwayat lokal 90 hari (FR-H7) ≈ **50 MB**. Jauh di bawah kuota. `[ASUMSI]` — belum diukur dengan data yang beragam.

---

## 5. Ukuran bundle

| Berkas | Mentah | gzip |
|---|---|---|
| `sqlite3.wasm` | 864,75 kB | **401,93 kB** |
| worker (termasuk skema) | 230,87 kB | — |
| `sqlite3-worker1.js` | 213,43 kB | — |
| proxy async OPFS | 32,29 kB | — |

`research/03`:196 memperkirakan "ukuran WASM ~1 MB". Terukur **864,75 kB mentah / 402 kB gzip** — perkiraannya benar.

Proxy async OPFS (32 kB) hanya dibutuhkan VFS `opfs`. Kalau SAHPool yang dipakai, ia dapat dikeluarkan dari bundle.

---

## 6. Rekomendasi

1. **Pakai `opfs-sahpool`, bukan `opfs`.** 71× lebih cepat menulis, dan tidak butuh COOP/COEP.
2. **Header COOP/COEP tetap dipertahankan** di `apps/kasir` — ia tidak merugikan, dan mempertahankannya menjaga pintu ke VFS `opfs` tetap terbuka bila SAHPool bermasalah di platform tertentu. Tapi dashboard owner **tidak perlu** membayarnya.
3. **Pola satu-penulis wajib dibangun sejak awal.** Ia bukan penyempurnaan; tanpanya tab kedua mematikan aplikasi.
4. **`navigator.storage.persist()` harus dipanggil**, dan perilaku saat ditolak didefinisikan.

---

## 7. Batas temuan ini — apa yang BELUM diukur

Angka di atas berasal dari **satu lingkungan**: Chromium di Windows 11, mesin pengembangan. Yang belum diukur, dan tidak dapat diukur dari sini:

- **Android** (Chrome dan WebView Tauri) — target utama tablet kasir
- **iOS/Safari** — dukungan OPFS-nya berbeda, dan `research/03` tidak pernah mengukurnya
- **Perangkat kelas bawah** — 4 ms di mesin pengembangan bukan 4 ms di tablet Rp 1,5 juta
- **Perilaku saat kuota benar-benar habis** — hanya dibaca kuotanya, tidak diisi sampai penuh
- **Perilaku saat tab ditutup di tengah transaksi** — pemulihan WAL belum diuji

Keempat pertama butuh perangkat nyata dan merupakan **langkah manual**, sejajar dengan verifikasi webhook Midtrans. Sampai dijalankan, angka di dokumen ini berlaku untuk desktop Chromium saja.

---

## 8. Cara menjalankan ulang

```
npm run dev --workspace prototipe-sqlite-opfs
```

Buka `http://localhost:5173`. Tambahkan `?tahan=1` untuk menahan pool (uji dua tab: buka dua tab dengan parameter itu).
