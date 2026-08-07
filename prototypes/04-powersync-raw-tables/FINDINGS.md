# Prototipe 04 — PowerSync memegang database lokal, 20 tabel kami sebagai raw table

**Dijalankan:** 7 Agustus 2026 · Chromium desktop, Windows 11
**Paket:** `@powersync/web` 2.1.1 · `@powersync/common` 2.0.0 · `@powersync/shared-internals` 1.1.1 · ekstensi core `0.5.2/c5c23134` · SQLite 3.53.0
**Menjalankan:** `npm run dev --workspace prototipe-powersync-raw-tables` → `http://localhost:5174`

Prototipe 03 §5c menjawab dua pertanyaan penentu dari **pembacaan kode**, dan menandai dirinya sendiri sebagai bukan-pengukuran. Berkas ini menjalankannya. Semua angka dan semua jawaban di bawah berasal dari kode yang benar-benar dieksekusi.

---

## Ringkasan

| Yang dibuktikan | Hasil |
|---|---|
| Satu penjualan utuh dalam satu `writeTransaction` (invariant #1) | **YA** — dan yang membuktikannya bukan penulisan yang berhasil, melainkan yang **gagal**: T3 |
| Dua puluh tabel + 15 index kami selamat dari `powersync_replace_schema` | **YA** — 20/20 dan 15/15 |
| Raw table menghasilkan view atau tabel `ps_data__*` | **TIDAK** — nol keduanya |
| Jalur naik tetap milik `outbox_local` | **YA** — `ps_crud` tetap kosong, dan T4b membuktikan mekanismenya memang bekerja bila dipasang |
| Dua tab dapat menulis bersamaan (§7) | **YA** — dan ini membalik temuan prototipe 03 §3 |
| Tulis 1 penjualan | **12,3 ms** p50 — **3,8× lebih lambat** daripada 3,25 ms di prototipe 03 |
| `item_modifier_list` dapat jadi raw table | **TIDAK** — tidak punya kolom `id`. **Diputuskan user 7 Agu 2026: kolom `id` ditambahkan** (§5) |

---

## 1. Yang diuji, dan kenapa bentuknya begitu

Skema yang dipasang adalah `db/local/001-initial.sql` apa adanya — tidak disalin ulang. Menyalinnya berarti menguji skema yang bukan skema kami.

Satu "penjualan" adalah 10 baris di 8 tabel: `order`, `check`, `order_line` ×2, `order_line_modifier`, `stock_movement` ×2, `payment`, `audit_event`, `outbox_local`. Sama persis dengan yang diukur prototipe 03, supaya angkanya dapat dibandingkan langsung.

Enam belas tabel yang direplikasi dideklarasikan sebagai raw table. Tiga tabel murni lokal (`stock_snapshot`, `outbox_local`, `device_config`) **tidak disebut sama sekali** kepada PowerSync — dan T1f memeriksa bahwa itu justru aman. Satu tabel, `item_modifier_list`, tidak bisa (§5).

---

## 2. Invariant #1 — dan kenapa T2 tidak membuktikannya

T2 menulis satu penjualan penuh dalam satu `writeTransaction` dan menemukan 10 baris tersimpan. **Itu tidak membuktikan atomisitas.** Sepuluh `INSERT` berurutan tanpa transaksi apa pun akan memberi hasil yang sama persis.

Yang membuktikannya T3: penjualan yang **pernyataan terakhirnya gagal**.

| | |
|---|---|
| T3a — pernyataan terakhir memang gagal | `NOT NULL constraint failed: outbox_local.idempotency_key` |
| T3b — sembilan baris sebelumnya ikut hilang | **0 baris tersisa** |

T3a ada supaya T3b tidak hampa. Kalau pernyataan terakhir diam-diam berhenti gagal — kolom berubah nullable, misalnya — T3b akan tetap hijau sambil tidak memeriksa apa pun. Ini bentuk yang sama dengan pelajaran `HANDOFF.md`: guard yang tidak dapat dibedakan dari luar adalah guard yang tidak teruji.

Sembilan baris pertama benar-benar sudah ditulis saat kegagalan terjadi. Nol yang tersisa adalah `ROLLBACK` yang sungguhan, bukan penulisan yang tidak pernah dimulai.

**Invariant #1 berlaku di atas PowerSync.**

---

## 3. Koeksistensi skema

| Uji | Hasil |
|---|---|
| T1a — 20 tabel kami setelah `powersync_replace_schema` | 20/20 ada |
| T1b — 15 index kami | 15/15 ada |
| T1c — tabel `ps_data__*` yang dibuat | 0 |
| T1d — view di database | 0 |
| T1e — tabel internal PowerSync | `ps_buckets`, `ps_crud`, `ps_kv`, `ps_migration`, `ps_oplog`, `ps_stream_subscriptions`, `ps_sync_state`, `ps_tx`, `ps_untyped`, `ps_updated_rows` |
| T1f — tabel lokal-saja yang tak dikenal PowerSync | `stock_snapshot`, `outbox_local`, `device_config` — utuh |

Sepuluh tabel `ps_*` hidup di database yang sama dengan 20 tabel kami. Tidak ada tabrakan nama, tidak ada view yang dibuat, dan tidak ada satu pun tabel kami yang tersentuh.

T1f layak diperhatikan tersendiri: cara paling aman memberi tahu PowerSync tentang tabel lokal kami ternyata **tidak memberitahunya sama sekali**. Namanya tidak berawalan `ps_`, jadi ia tidak pernah masuk jaring `GLOB 'ps_data_*'`.

---

## 4. Jalur naik tetap milik `outbox_local`

| Uji | Hasil |
|---|---|
| T4a — `ps_crud` setelah 2 penjualan ditulis | **0 entri** |
| T4b — setelah trigger dipasang + 1 INSERT | **1 entri** |
| T4c — setelah trigger dilepas + 1 INSERT lagi | tetap 1 entri |

T4a sendirian tidak membuktikan apa pun — `ps_crud` yang kosong bisa berarti mekanismenya memang tidak pernah bekerja. T4b memasang trigger lewat `powersync_create_raw_table_crud_trigger` dan menunjukkan antreannya **memang** terisi; T4c melepasnya lagi dan penangkapan berhenti.

Jadi: penulisan lokal ke raw table ditangkap PowerSync **hanya** lewat trigger yang kita pasang sendiri. Tidak memasangnya membuat `outbox_local` + REST idempoten tetap satu-satunya jalur naik — persis stack terkunci di `CLAUDE.md`, tanpa perlu menonaktifkan apa pun.

---

## 5. `item_modifier_list` tidak bisa jadi raw table

```
Table item_modifier_list has no id column.
```

Raw table PowerSync **mewajibkan** kolom bernama `id` (`InferredTableStructure::read_from_database` di core). `item_modifier_list` primary key-nya komposit `(item_id, modifier_list_id)` dan tidak punya `id`. Ia katalog, jadi ia harus turun.

Tiga arah diajukan, semuanya perubahan skema dan karena itu keputusan pemilik produk:

1. Tambahkan kolom `id` ke `item_modifier_list`.
2. Turunkan relasinya sebagai bagian dari dokumen `item`, bukan tabel sendiri.
3. Biarkan ia tabel PowerSync biasa (JSON + view) dengan **nama berbeda** dari tabel lokal kami.

**Diputuskan user 7 Agustus 2026: arah 1 — kolom `id` (`TEXT PRIMARY KEY`) ditambahkan.**

Yang menyusul dari keputusan itu, dan belum dikerjakan:

- Migrasi PostgreSQL **baru** (`0018`), bukan penyuntingan `0004_catalog.sql` — expand-contract. Primary key berubah dari `(item_id, modifier_list_id)` menjadi `id`, dengan **unique constraint** atas pasangan lama supaya relasi ganda tetap mustahil.
- `db/local/001-initial.sql` menyusul bentuk yang sama.
- `item_modifier_list` naik dari `TABEL_TANPA_ID` ke `TABEL_RAW` di `src/skema.js`, dan T1g kehilangan subjeknya — ia harus diarahkan ke `stock_snapshot`, yang tetap tanpa `id` dan memang tidak perlu turun.
- `product/ERD-lumi-pos-v1.md` §15 menyimpan bentuk lama. **Penyuntingan dokumen produk bukan kewenangan agent** — diangkat, tidak dikerjakan.

`stock_snapshot` juga tanpa `id`, dan itu **dibiarkan**: ia cache lokal hasil agregasi `stock_movement`, tidak pernah naik maupun turun.

**Catatan cara uji ini nyaris hampa.** Versi pertamanya menerima error apa pun sebagai "ditolak", dan ia lulus — atas `unexpected write type insert`, karena parameter write type saya tulis huruf kecil sementara core menuntut `INSERT`. Uji yang lulus atas kegagalan yang salah tidak membuktikan apa pun tentang kolom `id`. Sekarang ia menuntut pesan yang menyebut `id column`. Yang mengungkapnya bukan review, melainkan T4b yang gagal dengan pesan yang sama.

---

## 6. Latensi — dan angka yang membalik klaim prototipe 03

| Ukuran | Prototipe 03 (`wa-sqlite` `OPFSCoopSyncVFS` langsung) | Prototipe 04 (lewat PowerSync) |
|---|---|---|
| Tulis 1 penjualan p50 | **3,25 ms** | **12,33 ms** |
| p95 | 4,25 ms | 17,93 ms |
| p99 | 4,92 ms | 24,48 ms |
| Throughput | 302/detik | 76/detik |

**Prototipe 03 §5b menyimpulkan performa "dicoret sebagai pertimbangan". Kesimpulan itu terlalu jauh.** Yang benar diukur di sana adalah VFS-nya — dan VFS PowerSync memang sedikit paling cepat. Tapi VFS bukan yang dibayar; yang dibayar adalah seluruh lapisan di atasnya, dan itu 3,8×.

### Dari mana selisihnya

| Uji | p50 | Yang disimpulkan |
|---|---|---|
| T5c — `writeTransaction` berisi 1 pernyataan sepele | 1,29 ms | Lantai biaya transaksi: `BEGIN IMMEDIATE` + `COMMIT` + kunci global |
| T5b — 10 pernyataan sebagai **satu** `tx.execute` | 12,55 ms | Perjalanan bolak-balik per pernyataan **bukan** penyebabnya |
| T5d — `enableMultiTabs: false` (dedicated worker) | 10,69 ms | SharedWorker menyumbang ~2,3 ms |
| T5d — `enableMultiTabs: true` (SharedWorker) | 12,94 ms | |
| T5e — 10 INSERT ke tabel **raw** (`check`) | 5,33 ms | |
| T5e — 10 INSERT ke tabel yang PowerSync **tak kenal** (`outbox_local`) | 7,15 ms | Memilih raw table **tidak** membebani apa pun |

T5e menjawab pertanyaan yang paling penting bagi keputusan: menulis ke tabel yang terdaftar sebagai raw table **tidak lebih mahal** daripada menulis ke tabel yang PowerSync tidak tahu keberadaannya — malah sedikit lebih murah. Biaya tambahan itu melekat pada koneksi PowerSync secara umum, **bukan pada keputusan memakai raw table**.

Sekitar 6–7 ms tetap **tidak dapat saya atribusikan**. Bukan RPC per pernyataan (T5b), bukan SharedWorker (T5d), bukan raw table (T5e). Saya tidak menebak sisanya.

### Apakah 12 ms cukup

Ya. Ambang yang relevan bukan perbandingan antar driver melainkan apakah kasir melihat jeda. Prototipe 03 §2 menolak VFS `opfs` karena 282 ms **terlihat**; 12 ms tidak, dan satu kasir menyelesaikan penjualan tiap puluhan detik, bukan tiap 13 milidetik.

Yang tetap harus diwaspadai: angka ini dari mesin pengembangan. 3,8× di sini bisa jadi 3,8× dari basis yang jauh lebih lambat di tablet Rp 1,5 juta, dan **itu belum diukur**.

---

## 6b. Dua hal yang hanya terlihat saat build produksi

**`worker: { format: 'es' }` wajib.** `vite dev` berjalan hijau tanpanya; `vite build` gagal:

```
Invalid value "iife" for option "worker.format" — UMD and IIFE output
formats are not supported for code-splitting builds.
```

Default Vite untuk worker adalah `iife`, sementara worker PowerSync memakai code-splitting. Jebakannya bukan kegagalannya melainkan **waktunya**: ia muncul saat build rilis, jauh setelah pengembangan sehari-hari menyatakan semuanya beres.

**Sudah dipasang di `apps/kasir/vite.config.ts` (7 Agu 2026), sebelum PowerSync masuk ke sana** — beserta komentar yang menjelaskan kenapa, supaya ia tidak dikira baris yang tidak terpakai dan dihapus.

**Bundle mengandung EMPAT build WASM**, bukan satu:

| Berkas | Mentah | gzip |
|---|---|---|
| `wa-sqlite.wasm` | 1.124,66 kB | 525,70 kB |
| `mc-wa-sqlite.wasm` (multiple-ciphers, untuk enkripsi) | 1.312,17 kB | 600,53 kB |
| `wa-sqlite-async.wasm` | 2.281,77 kB | 798,76 kB |
| `mc-wa-sqlite-async.wasm` | 2.504,96 kB | 883,06 kB |

Keempatnya di-`import()` dinamis, jadi hanya satu yang benar-benar diunduh saat runtime — tapi keempatnya ikut ter-*deploy*. Prototipe 03 §5 memperkirakan ukuran dari satu berkas saja; angka yang benar untuk artefak yang dikirim adalah **~7,2 MB mentah di disk**, dengan **~526 kB gzip** yang benar-benar melewati jaringan pada jalur normal (tanpa enkripsi, VFS sinkron).

---

## 7. Dua tab — membalik temuan prototipe 03 §3

Prototipe 03 menemukan tab kedua **gagal membuka database sama sekali** (`NoModificationAllowedError`), dan menyimpulkan pola satu-penulis wajib kita bangun sendiri.

Dengan PowerSync memegang database dan `enableMultiTabs: true`, dua tab dijalankan bersamaan (`/?tahan=1` di keduanya):

```
Tab A: ✓ Tab ini berhasil MEMBUKA database — lumi-powersync.db
       ✓ tulis ke-20 dari tab-296 — BERHASIL — 2 tab tercatat di device_config
Tab B: ✓ Tab ini berhasil MEMBUKA database — lumi-powersync.db
       ✓ tulis ke-9 dari tab-191 — BERHASIL — 2 tab tercatat di device_config
```

Keduanya menulis, keduanya berhasil, dan keduanya **melihat baris tab yang lain** — jadi keduanya benar-benar memegang database yang sama, bukan dua berkas terpisah.

**Pola satu-penulis tidak perlu kita bangun.** Ia sudah ada, di dalam SharedWorker PowerSync. Biayanya terukur: ~2,3 ms per penjualan (T5d).

---

## 8. Batas temuan ini

- **Satu lingkungan**: Chromium desktop, Windows 11. Android, iOS/Safari, dan perangkat kelas bawah belum diukur — sama seperti prototipe 03.
- **Jalur turun tidak pernah dijalankan.** Tidak ada koneksi ke layanan PowerSync; tidak ada instance backend. Yang diuji adalah database lokal dan kontrol transaksinya. Bahwa PowerSync benar-benar dapat **menulis masuk** ke raw table kami dari sinkronisasi sungguhan **belum dibuktikan**.
- **`disconnectAndClear()` belum diuji.** Pada raw table, pernyataan `clear` kami yang menentukan; salah tulis di sana menghapus data lokal.
- **Migrasi skema raw table belum diuji.** PowerSync tidak mengelolanya; itu tetap urusan `db/local/00X-*.sql` kami.
- **Sekitar 6–7 ms latensi tidak terjelaskan** (§6).
- **`PRAGMA foreign_keys`** tidak di-set oleh SDK. Skema lokal kami menyalakannya di baris 5, tapi tidak punya satu pun `REFERENCES` — jadi hari ini tidak berakibat apa-apa, dan akan berakibat begitu ada.

---

## 9. Cara menjalankan ulang

```
npm run dev --workspace prototipe-powersync-raw-tables
```

| URL | Yang dijalankan |
|---|---|
| `/` | T1–T5: koeksistensi, invariant #1, jalur naik, latensi |
| `/?tahan=1` | Mode dua tab. Buka **DUA** tab dengan parameter ini |
