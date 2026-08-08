# Prototipe 05 — jalur turun PowerSync, terhadap layanan self-hosted sungguhan

**Dijalankan:** 8 Agustus 2026 · Chromium desktop, Windows 11 · Docker Desktop 29.6.2
**Stack:** `journeyapps/powersync-service:latest` · PostgreSQL 18 (sumber) · PostgreSQL 18 (bucket storage) · `@powersync/web` 2.1.1
**Menjalankan:** `npm run stack:up --workspace prototipe-powersync-jalur-turun` → `npm run siapkan ...` → `npm run dev ...` → `http://localhost:5175`

Prototipe 04 menutup dengan satu kalimat: *"jalur turun belum pernah dijalankan."* Ini menjalankannya — terhadap PowerSync Open Edition yang di-host sendiri, bukan cloud, bukan tiruan.

---

## Ringkasan

| Yang dibuktikan | Hasil |
|---|---|
| Sinkronisasi turun mengisi **tabel kami sendiri**, bukan `ps_data__*` | **YA** — 7/7 tabel katalog, nol tabel `ps_data__*` |
| `item_modifier_list` turun utuh (alasan migrasi `0018` ada) | **YA** — beserta kolom `id`-nya |
| Isolasi tenant pada jalur turun | **YA**, dan **hanya** karena sync rules — dibuktikan dengan sabotase |
| Perubahan **berjalan** (bukan hanya muatan awal) sampai ke klien | **YA** — `UPDATE` di PostgreSQL muncul di browser |
| Sinkronisasi pertama | **76–178 ms** untuk 7 baris |
| MongoDB dibutuhkan | **TIDAK** — PostgreSQL dipakai sebagai bucket storage |
| **Menghapus tabel lokal memicu unduh ulang** | **TIDAK — dan ini bahaya produksi.** §5 |

---

## 1. Bentuk stack, dan satu keputusan yang menghapus satu container

Tiga container, tidak ada MongoDB:

| Service | Peran | Port host |
|---|---|---|
| `pg-db` | sumber replikasi — memegang skema Lumi POS (migrasi `0001`–`0018`) | 5433 |
| `pg-storage` | bucket storage PowerSync | 5434 |
| `powersync` | layanan PowerSync, mode `unified` | 8080 |

Demo resmi memakai MongoDB untuk bucket storage. PowerSync menerima PostgreSQL juga, dan memilihnya membuat seluruh stack satu jenis database — satu bagian bergerak lebih sedikit untuk dipahami dan di-debug.

Port digeser dari 5432 karena PostgreSQL pengembangan sudah memakainya. Container tetap memakai 5432 di jaringan internal Compose.

**Skema yang direplikasi adalah skema sungguhan** — `db/migrate.js` dijalankan apa adanya terhadap container, bukan skema tiruan. Prototipe yang menguji tabel mainan tidak menguji apa pun.

---

## 2. Jalur turun berjalan

| Uji | Hasil |
|---|---|
| T0 — katalog lokal sebelum `connect()` | 0 baris |
| T1 — sinkronisasi pertama | **76–178 ms** |
| T2 — ketujuh tabel katalog terisi | `category, item, item_variation, modifier_list, modifier, item_modifier_list, tax_rate` = 1 baris masing-masing |
| T2b — tabel `ps_data__*` yang dibuat | **0** |
| T3 — `item_modifier_list` | `{id: tenant-alpha-iml, item_id: …, modifier_list_id: …, sort_order: 0}` |

T0 ada supaya T2 berarti. Tanpa memastikan lokal kosong lebih dulu, "tabel terisi" tidak dapat dibedakan dari "tabel sudah terisi sejak sebelumnya".

**T2b adalah inti prototipe 04 yang akhirnya diuji ujung-ke-ujung.** PowerSync menulis ke tabel yang KAMI buat, lewat pernyataan `put` yang disimpulkannya dari `pragma_table_info` — bukan ke tabel JSON miliknya sendiri. Raw table bekerja pada jalur turun sungguhan, bukan hanya saat dideklarasikan.

**T3 adalah pembenaran migrasi `0018`.** Sebelum kolom `id` ada, tabel ini tidak dapat menjadi raw table sama sekali; sekarang relasi item↔modifier sampai ke perangkat, lengkap.

### Perubahan berjalan, bukan hanya muatan awal

Muatan awal dan replikasi berjalan adalah dua jalur berbeda di PowerSync — yang pertama snapshot, yang kedua WAL decoding. Diuji terpisah: `UPDATE item SET name = 'Kopi Susu Alpha HARGA BARU'` dijalankan di PostgreSQL selagi browser terhubung, dan muncul di halaman tanpa reload.

```
✓ PERUBAHAN TURUN | [] -> ["Kopi Susu Alpha HARGA BARU"]
```

---

## 3. ⛔ Isolasi tenant: sync rules adalah SATU-SATUNYA yang menjaganya

Ini temuan terpenting prototipe ini, dan ia harus dibaca sebelum satu baris sync rules pun ditulis.

Role replikasi PowerSync dibuat dengan **`BYPASSRLS`**:

```sql
CREATE ROLE powersync_role WITH REPLICATION BYPASSRLS LOGIN PASSWORD '…';
```

Itu bukan kelalaian konfigurasi yang dapat diperbaiki. Replikasi logis membaca **WAL**, bukan tabel — RLS tidak berlaku di sana sama sekali. `BYPASSRLS` hanya membuat pembacaan snapshot awal konsisten dengan apa yang kemudian datang lewat WAL. Tanpanya, snapshot berisi nol baris sementara WAL berisi semuanya.

**Konsekuensinya:** invariant #8 — yang menjaga setiap jalur baca-tulis aplikasi selama ini — **tidak menjaga apa pun pada jalur turun**. `sync-config.yaml` berdiri sendirian.

### Dibuktikan dengan melepasnya

Satu klausa dilepas dari satu baris (`SELECT * FROM item WHERE tenant_id = auth.parameter('tenant_id')` → `SELECT * FROM item`), layanan di-restart, klien tenant beta menyambung:

```
✗ T2 ketujuh tabel katalog terisi   {"category":1,"item":2,…}
✗ T4 HANYA katalog tenant ini turun  terlihat: [tenant-alpha-item, tenant-beta-item]
                                     — milik tenant lain (tenant-alpha-item) BOCOR
```

Katalog satu merchant mendarat di perangkat merchant lain. Tidak ada apa pun yang menahannya, dan tidak ada error di mana pun.

Jangkarnya diperiksa sebelum disabotase — sabotase yang tidak mengenai apa pun membuat "hijau" tidak berarti.

### Yang lebih halus, dan lebih berbahaya

**T4b tetap LULUS selama kebocoran itu.** Ia memeriksa `tenant_id` pada tabel `category`, yang klausanya masih utuh. Kebocoran per-tabel tidak terlihat oleh pemeriksaan yang mengambil sampel tabel lain.

Artinya: pemeriksaan isolasi jalur turun harus menyentuh **setiap tabel**, bukan satu tabel sebagai wakil. Satu baris `WHERE` yang lupa ditulis pada tabel ke-tujuh tidak akan terlihat oleh test yang memeriksa tabel pertama.

---

## 4. Otentikasi

`client_auth.jwks` menerima kunci **inline**, termasuk simetris `oct`/HS256. Itu menghapus container backend yang dipakai demo resmi hanya untuk melayani endpoint JWKS.

`auth.parameter('tenant_id')` membaca klaim **top-level** dari JWT yang sudah diverifikasi — `auth.parameters()` mengembalikan seluruh payload. Klaim yang **tidak** diverifikasi tersedia lewat `subscription.parameter(...)`; jangan pernah memakainya untuk batas tenant.

> ⛔ **Pola prototipe, bukan pola produksi.** Kunci simetris berarti siapa pun yang dapat memverifikasi token juga dapat membuatnya — di sini token dicetak di browser, jadi setiap pengunjung halaman ini dapat mencetak token untuk tenant mana pun. Dapat diterima karena stack-nya localhost dan yang diuji adalah jalur turun, bukan otentikasi. Di F2 sungguhan token dicetak server Fastify kami dengan kunci **asimetris**, dan `jwks_uri` menunjuk endpoint server itu.

---

## 5. ⛔ Menghapus tabel lokal TIDAK memicu unduh ulang

Ditemukan tanpa dicari: run kedua prototipe ini tiba-tiba menerima nol baris.

Checkpoint PowerSync hidup di tabel `ps_*`, **terpisah dari tabel kami**. Menghapus dan membangun ulang raw table tidak memberi tahu PowerSync apa pun — ia tetap yakin klien sudah mutakhir.

```
✓ T5 menghapus tabel lokal TIDAK memicu unduh ulang
  0 baris setelah drop -> 0 setelah reconnect,
  waitForFirstSync 0 ms dan MELAPORKAN SUKSES
```

**`waitForFirstSync()` selesai dalam 0 ms dan melaporkan sukses.** Tidak ada error, tidak ada peringatan.

Akibatnya di produksi: **migrasi skema lokal yang membangun ulang sebuah raw table menghasilkan katalog kosong secara permanen.** Layar kasir kosong, sinkronisasi mengaku sehat.

Yang memulihkannya hanya `disconnectAndClear()`. Karena itu setiap migrasi skema lokal yang menyentuh raw table **wajib** diikuti pembersihan sync state — dan itu harus masuk ke prosedur migrasi klien, bukan diingat-ingat.

---

## 6. Batas temuan ini

- **Satu lingkungan**: Chromium desktop, Windows 11, Docker Desktop. Android/iOS belum.
- **Skala mainan**: 7 baris per tenant, 2 tenant. Angka 76–178 ms tidak mengatakan apa pun tentang katalog 2.000 item, dan **tidak boleh dikutip seolah begitu**.
- **Jalur naik tidak diuji di sini** — `uploadData` sengaja kosong. Itu benar secara desain (prototipe 04 T4: tanpa trigger, `ps_crud` tidak pernah terisi), tapi berarti prototipe ini tidak mengatakan apa pun tentang `outbox_local`.
- **Healthcheck container HIJAU sementara replikasi GAGAL.** Saat publication belum ada, `/probes/liveness` tetap 200 dan Compose melaporkan `healthy`. Liveness tidak mencerminkan kesehatan replikasi — jangan pakai ia sebagai sinyal kesiapan.
- **Perilaku saat sync rules berubah pada klien yang sudah tersinkron** belum diuji secara sistematis; di sini selalu didahului `disconnectAndClear()`.
- **Konflik tulis** tidak diuji: jalur turun kami read-only di perangkat.
- **`tax_rate.rate`** turun sebagai `numeric` PostgreSQL ke kolom `INTEGER` lokal. Belum diperiksa apakah pembulatannya sesuai konvensi `×10000` kami. **Diangkat, bukan diuji.**

---

## 7. Cara menjalankan ulang

```
npm run stack:up   --workspace prototipe-powersync-jalur-turun
npm run siapkan    --workspace prototipe-powersync-jalur-turun
npm run dev        --workspace prototipe-powersync-jalur-turun
```

| URL | Yang dijalankan |
|---|---|
| `/?tenant=alpha` | T0–T5 untuk tenant alpha |
| `/?tenant=beta` | T0–T5 untuk tenant beta |
| `/?tenant=alpha&mode=pantau` | Memantau perubahan berjalan; jalankan `node tools/ubah.mjs "Nama Baru" alpha` |

Menghentikan: `npm run stack:down` · menghapus volume juga: `npm run stack:bersih`
