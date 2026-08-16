# Penyelidikan Katalog — dan koreksi atas kode layar B-05

**16 Agustus 2026** · branch `g1-penyelidikan-b05-katalog` · tidak ada UI yang dibangun.

---

## 0. ⛔ Dua koreksi yang harus dibaca lebih dulu

### 0.1 B-05 bukan layar katalog

`IA:§3.3`, dibaca apa adanya:

| # | Layar |
|---|---|
| B-04 | Shift (daftar) |
| **B-05** | **Detail Shift** |
| B-06 | Produk (daftar) |
| B-07 | Edit Produk + Variation |
| B-08 | Kategori |
| B-09 | Modifier List |
| B-10 | Harga & Riwayat Harga |

B-05 adalah **Detail Shift**, dan ia **diblokir oleh sebab yang sama dengan B-04** — shift yang ditutup tidak pernah sampai ke server. Rantai buktinya lengkap di `PENYELIDIKAN-b02-b04.md` §3, dan keputusanmu 16 Agustus 2026 menunda B-04 sepenuhnya. B-05 ikut dalam penundaan itu; membangunnya sekarang menghasilkan layar detail untuk shift yang selamanya "terbuka", tanpa hitungan kas dan tanpa selisih.

**Tidak saya sentuh**, sesuai keputusan itu.

### 0.2 Seluruh UI katalog SUDAH DIBANGUN

Ini yang paling penting untuk perencanaanmu. Grup Katalog bukan pekerjaan yang akan datang — ia sudah selesai dan sudah di-merge:

| Layar | Berkas | Baris | PR |
|---|---|---:|---|
| B-06 Produk (daftar) | `katalog/Produk.tsx` | 367 | #20 |
| B-07 Edit Produk + Variation | `katalog/EditProduk.tsx` | 577 | #20 |
| B-08 Kategori | `katalog/Kategori.tsx` | 320 | #19 |
| B-09 Modifier List | `katalog/Modifier.tsx` | 608 | #22 |
| B-10 Harga & Riwayat | `katalog/Harga.tsx` | 487 | #21 |
| | **total** | **2.359** | |

Keempatnya terdaftar di `LAYAR_SIAP`, dan B-07 sengaja **tidak** di sidebar — `IA:§3.3` menaruhnya sebagai layar detail yang dicapai dari B-06, dan ada test yang menahannya begitu.

Jadi pertanyaan "apakah fondasi katalog solid sebelum disambungkan ke back-office" sudah terjawab oleh sejarah repo: ia sudah tersambung. Yang masih berguna dari penyelidikan ini adalah **batas kemampuannya**, dan itu isi sisa dokumen ini.

---

## 1. Permukaan REST modul `catalog`

25 rute, CRUD penuh plus arsip/pulihkan di setiap tingkat:

| Rute | Metode |
|---|---|
| `/categories` · `/categories/{id}` | POST · GET · PATCH |
| `/categories/{id}/archive` · `/restore` | POST |
| `/items` · `/items/{id}` | POST · GET · PATCH |
| `/items/{id}/archive` · `/restore` | POST |
| `/items/{id}/variations` · `/variations/{vid}` | POST · PATCH |
| `/variations/{vid}/archive` · `/restore` | POST |
| `/variations/{vid}/prices` | POST · GET |
| `/variations/{vid}/price` | GET (resolusi pada `at`) |
| `/outlets/{id}/prices` | GET |
| `/modifier-lists` (+ modifier, arsip, pulihkan) | 8 rute |
| `/items/{id}/modifier-lists/{mlid}` | POST · DELETE |
| `/catalog/import` | POST |

**Tidak ada `DELETE` untuk katalog** — dan itu benar, bukan kelalaian. Invariant #2: *"Katalog tidak pernah di-`DELETE`, hanya `archived_at`"*.

Endpointnya bernama `/items`, bukan `/catalog/products`.

---

## 2. `GET /items` — kemampuan sebenarnya

| Kemampuan | Ada? | Catatan |
|---|:---:|---|
| Paginasi | ❌ | tidak ada `limit`/`offset`/`cursor` |
| Pencarian nama | ❌ | tidak ada parameter apa pun |
| Filter kategori | ✅ | `?categoryId=` |
| Filter status arsip | ✅ | `?includeArchived=` (boolean) |
| Filter outlet | ❌ | katalog milik tenant, bukan outlet |
| Struktur | **nested** | `item → variations[] + modifierLists[]` |
| Kuantitas stok | ❌ | tidak ada sama sekali — lihat §4 |

### 2.1 Harga yang dikembalikan adalah harga AWAL, bukan harga berlaku

`item_variation.price` **beku setelah variation dibuat** (`CLAUDE.md`) — ia anak tangga paling bawah dari resolusi tiga tingkat. Harga yang benar-benar ditagih kasir datang dari `price_history` per outlet, lewat `GET /variations/{vid}/price?outletId&at`.

Layar B-06 yang sudah ada **menanganinya dengan benar**: kolomnya berjudul *"Harga awal"*, bukan *"Harga"*, dan komentar di berkasnya menyebut alasannya. Ini bukan temuan baru — ini catatan bahwa jebakannya sudah ditutup, dan tidak boleh dibuka lagi oleh layar berikutnya yang menampilkan harga.

---

## 3. ⛔ N+1 pada `GET /items` — diukur, bukan dibaca

Komentar di `items.ts:560-564` sudah mengakuinya (*"pre-existing N+1, out of scope to fix here per brief"*). Saya mengukurnya terhadap PostgreSQL sungguhan dengan membungkus `client.query` yang handler benar-benar pakai:

| Produk di katalog | Query terkirim | Query per produk | Waktu |
|---:|---:|---:|---:|
| 12 | 19 | 1,58 | 33 ms |
| 52 | 59 | 1,13 | 39 ms |
| 202 | 209 | 1,03 | 65 ms |

Polanya persis **`N + 7`**: tujuh query tetap (BEGIN, `SET LOCAL`, item, modifier-list, COMMIT, dan seterusnya) ditambah **satu query per produk** untuk mengambil variation-nya.

`fetchModifierListsForItems` sudah dibatch — hanya `fetchVariations` yang belum.

**Catatan kejujuran soal pengukuran:** run pertama melaporkan 110 query untuk beban yang sama dengan run kedua 59. Penyebabnya alat ukurnya sendiri: pool **memakai ulang koneksi**, jadi pembungkus penghitung bertumpuk dan setiap query terhitung dua kali. Angka di tabel di atas diambil setelah penanda `__dihitung` dipasang.

### Apakah ini masalah sekarang?

Pada skala yang PRD sebut — kafe takeaway 2–20 outlet — katalog realistis 50–200 produk, dan 65 ms untuk 202 produk **tidak terasa siapa pun**. Ini bukan kebakaran.

Yang membuatnya layak dicatat: `POST /catalog/import` (B-11) ada, dan impor massal adalah cara paling mudah katalog melewati angka itu tanpa ada yang merencanakannya.

---

## 4. Stok TIDAK ada di respons katalog, dan itu benar

`item_variation` punya `trackStock` (flag) dan `stockingUnit` (satuan) — **bukan kuantitas**. Pemindaian kunci respons mengonfirmasinya: tidak ada `quantity`, `onHand`, maupun sejenisnya.

Alasannya arsitektural, bukan kelalaian:

- Stok adalah `SUM(stock_movement.delta)` (`CLAUDE.md`: *"Tidak ada kolom `quantity`"*).
- `stock_movement` milik modul `inventory`, dan `catalog` tidak boleh menjangkaunya (invariant #4).
- Stok bersifat **per outlet**; katalog bersifat **per tenant**. Satu angka stok di daftar produk lintas-outlet tidak punya arti tunggal.

⛔ **Konsekuensinya untuk perencanaan:** kalau daftar produk kelak harus menampilkan stok, itu **bukan** perubahan pada `GET /items`. Itu B-12 (Stok) — layar tersendiri di grup Inventori yang memang belum dibangun — atau endpoint agregasi di modul `reporting`, mengikuti pola B-03.

---

## 5. Muatan dan penyaringan di klien

B-06 mengambil **seluruh katalog sekaligus** (`/items?includeArchived=true`) lalu menyaring nama, kategori, dan arsip **di JavaScript**.

Terukur: 202 produk = **150 KB JSON**.

Itu keputusan yang masuk akal pada skala kafe — penyaringan terasa seketika, tanpa perjalanan ke server per ketikan, dan tanpa debounce. Ia menjadi salah hanya bila katalog tumbuh jauh melampaui angka itu, dan gejalanya bukan error melainkan layar yang makin lambat dibuka.

---

## 6. Rencana perbaikan, bila dan ketika dibutuhkan

Diurutkan menurut nilai per risiko. **Tidak satu pun saya kerjakan** — penyelidikan ini tidak menyentuh kode.

| # | Perbaikan | Kapan ia layak | Risiko |
|---|---|---|---|
| **1** | Batch `fetchVariations` menjadi satu `WHERE item_id = ANY($1)`, persis seperti `fetchModifierListsForItems` sudah dilakukan | Sekarang aman dikerjakan kapan saja — perubahan internal, kontrak tidak berubah, dan polanya sudah ada di berkas yang sama | **rendah** |
| **2** | `?q=` pencarian nama (`ILIKE`, wildcard pengguna dilucuti) + index | Saat katalog melewati ~500 produk, atau saat kasir mengeluh | rendah |
| **3** | Paginasi keyset `(sort_order, id)` | Bersamaan dengan #2; sendirian ia justru memperburuk B-06, yang menyaring di klien dan butuh daftar penuh | sedang — **mengubah bentuk respons**, dan klien N-1 harus tetap jalan |
| **4** | Stok di daftar produk | Jangan lewat `GET /items`. B-12 atau `reporting` | — |

⛔ **Urutan #2 dan #3 penting.** Menambahkan paginasi lebih dulu akan mematahkan penyaringan klien B-06: layar yang menyaring atas satu halaman menampilkan "tidak ditemukan" untuk produk yang ada di halaman berikutnya — persis kelas kegagalan yang tidak menghasilkan error dan yang paling mudah dipercaya.

---

## 7. Yang tidak saya sentuh

- Tidak ada UI (sesuai instruksi).
- Tidak ada perubahan endpoint, migrasi, maupun perbaikan N+1 — semuanya menunggu keputusanmu.
- B-04 dan B-05 tidak disentuh, sesuai keputusan penundaan.
- `product/`, `research/`, dan `docs/superpowers/specs/` tidak disentuh.

## 8. Pertanyaan untukmu

1. **Katalog sudah jadi.** Apakah yang sebenarnya kamu inginkan adalah menyempurnakan B-06/B-07 yang ada (misalnya #1 dan #2 di atas), atau melanjutkan ke grup yang benar-benar kosong — **Inventori (B-12…B-15)**?
2. **B-12 Stok** adalah kandidat paling kuat berikutnya: ia grup penuh yang belum tersentuh, endpointnya belum ada, dan §4 menunjukkan stok memang tidak punya rumah di katalog.
3. Apakah perbaikan N+1 (#1) dikerjakan sekarang sebagai PR kecil tersendiri? Ia satu-satunya item berisiko rendah yang manfaatnya tidak menunggu skala.
