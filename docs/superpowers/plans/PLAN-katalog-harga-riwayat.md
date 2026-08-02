# PLAN — Modul A sub-project 2: harga per outlet dan riwayatnya (FR-A7)

Status: **disetujui, dalam pengerjaan.** Empat keputusan di §8 sudah dijawab user — lihat §8.0.

---

## 1. Ringkasan audit

1. `main` di `4a3b99c` — bersih, 319 test hijau, PR #1 dan #2 sudah merged.
2. **PR #3 (`oq09-vertical-profile-outlet`) masih OPEN.** Migrasi `0015` ada di sana, belum di `main`.
3. Modul A sub-project 1 selesai: 28 operasi REST, FR-A1/A2/A4/A6/A9 tertutup di backend.
4. FR-A7 secara eksplisit ditinggalkan, ditandai di `apps/server/src/modules/catalog/handlers/items.ts:530` — `updateItemVariation` sengaja tidak pernah membaca `price` dari body.
5. **Tabel `price_history` SUDAH ADA** (`db/migrations/0004_catalog.sql:87`), lengkap dengan RLS. Tidak perlu migrasi tabel baru.
6. **Tapi tidak ada index untuk resolusi harga.** Seluruh `0004_catalog.sql` hanya punya satu index (`ux_variation_barcode`). Query resolusi tiga tingkat akan seq-scan.
7. **`price_history.changed_by` adalah `text NOT NULL` tanpa FK ke `"user"`** — dan tidak ada satu pun sumber identitas aktor di server. `getTenantId` membaca header `X-Tenant-Id` dan komentarnya sendiri menyebut auth asli belum ada.
8. Dua dari empat acceptance criteria FR-A7 tidak bisa ditutup di sub-project ini: satu butuh `order_line` (Modul B), satu butuh sync (F2) + laporan (Modul G).

---

## 2. Milestone yang dipilih

**F1 · Modul A sub-project 2 — FR-A7 [P0] "Harga per outlet dan riwayatnya".**

Alasan urutan, dari dokumen:

> `product/specs/spec-a-katalog.md:198` — **FR-A7 [P0] — Harga per outlet dan riwayatnya**

> `product/specs/spec-a-katalog.md:202-209`
> ```
> 1. Cari PriceHistory untuk (variation, outlet) dengan effective_from
>    terbesar yang ≤ waktu transaksi
> 2. Bila tidak ada, cari untuk (variation, outlet=NULL)
> 3. Bila tidak ada, pakai ItemVariation.price
> ```

> `product/ERD-lumi-pos-v1.md:202` — **Resolusi harga:** `(variation, outlet)` terbaru ≤ waktu transaksi → `(variation, NULL)` → `item_variation.price`.

> `CLAUDE.md` — "Sengaja belum digarap di sub-project ini: FR-A7 (harga + `price_history`)"

FR-A7 mendahului Modul B karena `order_line.unit_price` adalah **snapshot** hasil resolusi ini (`product/ERD-lumi-pos-v1.md:260`). Membangun order tanpa resolver harga berarti menebak harga di dalam Modul B lalu merombaknya.

---

## 3. Scope

### 3.1 Migrasi

`db/migrations/00NN_price_history_index.sql` — index saja, tanpa perubahan tabel:

```sql
CREATE INDEX ix_price_history_resolution
  ON price_history (tenant_id, variation_id, outlet_id, effective_from DESC);
```

Nomor migrasi tergantung jawaban **Q2** di §8.

### 3.2 Endpoint REST baru (4 operasi)

| Metode | Path | Guna |
|---|---|---|
| `POST` | `/items/{itemId}/variations/{variationId}/prices` | Catat harga baru — **selalu INSERT, tidak pernah UPDATE** |
| `GET` | `/items/{itemId}/variations/{variationId}/prices` | Riwayat, terbaru dulu |
| `GET` | `/items/{itemId}/variations/{variationId}/price` | Harga terselesaikan (ladder 3 tingkat) |
| `GET` | `/outlets/{outletId}/prices` | Harga efektif seluruh variation di satu outlet — yang dibutuhkan klien POS saat sinkron turun |

Body `POST`:

```json
{
  "id": "01J...",
  "price": 28000,
  "outletId": "01J..." ,
  "effectiveFrom": "2026-08-02T10:00:00Z",
  "reason": "Kenaikan harga biji kopi"
}
```

`outletId` boleh `null` → harga default tenant. `id` di-generate klien (konvensi ULID). `effectiveFrom` opsional, default `now()`.

### 3.3 Validasi & guard

- `price` wajib integer ≥ 0. Bukan float, bukan negatif, bukan `Number.MAX_SAFE_INTEGER` ke atas.
- `effectiveFrom` wajib timestamp valid bila dikirim.
- **`variationId` divalidasi lewat `SELECT` yang tunduk RLS** sebelum dipakai — pelajaran FK-bukan-RLS di `CLAUDE.md`.
- **`outletId` divalidasi lewat `SELECT` yang tunduk RLS.** Ini paparan FK klien-suplai yang persis sama; `price_history.outlet_id` mereferensi `outlet(id)` lintas modul.
- `changed_by` — lihat **Q1**, memblokir.

### 3.4 Resolver harga

Fungsi resolusi ditulis sebagai **satu query SQL** (bukan tiga round-trip), di `apps/server/src/modules/catalog/handlers/prices.ts`. Diekspor lewat `catalog/index.ts` supaya Modul B memakainya tanpa menyentuh tabel katalog langsung — invariant #4.

### 3.5 Kontrak

`packages/contracts/openapi.yaml` — 4 operasi baru, mengikuti pola respons error yang sudah ada.

---

## 4. Non-scope — ditulis eksplisit supaya tidak diam-diam masuk

| Hal | Alasan |
|---|---|
| **AC FR-A7 #3** — "Laporan margin historis memakai `cost_at_sale` dari `order_line`" | `order_line` milik Modul B, belum ada. Tidak bisa diuji sekarang. |
| **AC FR-A7 #4** — "Dashboard menampilkan device mana yang belum menerima perubahan harga terakhir" | Butuh sync (F2) + Modul G. Dua fase ke depan. |
| **UI apa pun** | Tidak ada UI di proyek ini sama sekali. Ini murni backend. |
| **`UPDATE`/`DELETE` pada `price_history`** | Invariant #2. Tidak dibangun, dan diuji bahwa tidak ada jalurnya. |
| **Mengubah `item_variation.price` lewat endpoint** | Lihat **Q3**. |
| **Harga modifier** (`modifier.price`) | FR-A7 bicara `ItemVariation`. Tidak diperluas. |
| **Pagination pada list** | Temuan tertunda yang sudah tercatat untuk seluruh endpoint list; diperbaiki sekaligus, bukan di sini. |
| **FR-A3/A5** (aturan pemilihan modifier) | UI kasir. |
| **FR-A8** (impor katalog) | P1. |

---

## 5. Task breakdown — urutan TDD

Setiap task: test merah dulu → konfirmasi merah karena alasan yang benar → implementasi minimum → suite penuh hijau.

- [x] **T0** — `getActorId(req)` di `apps/server/src/tenant-context.ts` (keputusan Q1). Test: header hilang → `400 MISSING_ACTOR_ID`; aktor milik tenant lain → `404`; aktor nonaktif → `404`. Validasi lewat SELECT yang tunduk RLS, bukan FK.
- [x] **T1** — Migrasi `0016` index `ix_price_history_resolution`. Test: index ada, dan `EXPLAIN` query resolusi memakainya.
- [x] **T2** — `POST .../prices` jalur bahagia: INSERT satu baris, `201`, badan respons berisi record.
- [x] **T3** — Validasi `price`: tolak negatif, non-integer, non-angka → `400 VALIDATION_ERROR`.
- [x] **T4** — Guard `variationId` lintas tenant: variation milik tenant lain → `404`, dan **tidak ada baris tersimpan**.
- [x] **T5** — Guard `outletId` lintas tenant: outlet milik tenant lain → `404`, dan **tidak ada baris tersimpan**. (Kelas bug yang sama dengan temuan F1 — diuji dengan bukti tulis, bukan hanya status code.)
- [x] **T6** — `GET .../prices`: riwayat terurut `effective_from DESC, id DESC`, isolasi tenant.
- [x] **T7** — Resolver: ladder tiga tingkat. **Property test** — untuk sembarang kombinasi (ada/tidak override outlet) × (ada/tidak default tenant) × (waktu sebelum/sesudah `effective_from`), hasil selalu sesuai tangga. Ini yang dimaksud "invariant finansial diuji sebagai property" di Definition of Done.
- [x] **T8** — `GET .../price`: endpoint resolusi, termasuk parameter `at` (waktu transaksi) dan `outletId`.
- [x] **T9** — Append-only: ubah harga dua kali → dua baris, baris lama byte-identik dengan sebelumnya. Menegakkan invariant #2 dan AC FR-A7 #1.
- [x] **T10** — `GET /outlets/{outletId}/prices`: harga efektif seluruh variation aktif di satu outlet, satu query.
- [x] **T11** — Kontrak OpenAPI + regenerasi/validasi glue.
- [x] **T12** — Perbarui `CLAUDE.md`, `README.md`, `HANDOFF.md`, `apps/server/src/modules/README.md` bila status berubah. **Tidak menyentuh `/product/`, `/research/`, `/docs/superpowers/specs/`.**

---

## 6. Rencana test

| Suite | Tambahan |
|---|---|
| `npm run test:catalog` | T2–T10, target +40 test |
| `npm run test:isolation` | tetap 189 — tabel tidak berubah, jadi tidak ada tambahan |
| `npm run test:schema` | +1 (index) — **suite ini hidup di PR #3**, lihat Q2 |
| `npm run test:server` | tetap |
| `npm run lint:ds` | tetap hijau |

Test lintas tenant untuk T4/T5 harus membuktikan **tidak ada baris tersimpan**, bukan sekadar status `404`. Bug FK-bukan-RLS di F1 mengembalikan `201` sambil menyimpan — status code saja tidak pernah cukup sebagai bukti.

---

## 7. Definition of done

- [x] Invariant harga diuji sebagai **property**, bukan contoh (T7) — matriks kasus, dibuktikan tidak kosong lewat sabotase
- [x] Idempotensi: POST ulang dengan `id` sama → `409 ID_ALREADY_EXISTS`, dan tepat satu baris tersimpan. Retry dengan `price` berbeda juga `409`, harga pertama tidak tertimpa
- [x] Isolasi tenant diuji untuk keempat endpoint baru
- [x] Append-only terbukti — tidak ada jalur `UPDATE`/`DELETE`; baris pertama dibandingkan utuh (bukan hanya `price`) sebelum dan sesudah perubahan kedua
- [x] Migrasi memakai `lock_timeout`, mengikuti pola `0015`
- [x] Kompatibilitas klien N-1: keempat operasi bersifat aditif; tidak ada endpoint lama yang berubah bentuk
- [x] Empty state: variation tanpa riwayat harga mengembalikan `item_variation.price` dengan `source: 'variation'`, bukan error
- [x] Seluruh suite hijau: catalog 139 · isolation 189 · schema 10 · server 14 · sqlite-local 3 · oxlint-ds 10 · `lint:ds` exit 0
- [x] Checklist di file ini diperbarui seiring task selesai

Yang **tidak** bisa dicentang di sub-project ini dan alasannya sudah di §4: audit event (Modul F belum ada), perilaku offline (F2), metrik & alarm (F6), runbook (F6).

### Yang ditemukan lewat sabotase, bukan lewat test yang lolos

Tiga guard/aturan dinonaktifkan satu per satu untuk membuktikan testnya bukan hiasan:

| Yang disabotase | Hasil |
|---|---|
| `assertOutletVisible` di `createPrice` | **`201` + baris benar-benar tersimpan** menunjuk outlet tenant lain. FK ke `outlet(id)` tidak menghentikannya — konfirmasi ketiga temuan FK-bukan-RLS |
| Filter `effective_from <= at` di anak tangga 1 | Matriks T7 gagal pada kasus "override terjadwal masa depan" |
| Presedensi outlet-vs-tenant di `resolvePrice` | Matriks T7 gagal pada kasus "override menang atas default" |
| Urutan `COALESCE` di `listOutletPrices` | **Awalnya LOLOS — 133/133 hijau.** Lubang nyata: tidak ada satu pun kasus dengan override outlet DAN default tenant sekaligus, yaitu satu-satunya kombinasi yang membedakan anak tangga 1 dari 2. Ditutup dengan tiga test presedensi + satu test yang mengikat `listOutletPrices` ke `resolvePrice` supaya kedua salinan tangga tidak bisa menyimpang |

### Satu hal yang belum tuntas

Satu run `test:catalog` gagal 1 test (dari 139) dan **tidak pernah tereproduksi lagi** dalam 7 run serial berikutnya. Nama testnya tidak sempat tertangkap. Sebagian besar kegagalan acak selama sub-project ini terbukti berasal dari menjalankan dua suite bersamaan ke satu database (dicatat di `HANDOFF.md`), tapi run yang satu ini tidak bisa saya kaitkan ke sana dengan pasti. Dicatat di sini apa adanya, bukan dianggap selesai.

---

## 8. Pertanyaan terbuka — perlu keputusanmu

### 8.0 Keputusan user (2026-08-02)

| # | Keputusan | Konsekuensi |
|---|---|---|
| **Q1** | **Header `X-Actor-Id`, divalidasi** ke tabel `"user"` lewat SELECT yang tunduk RLS | `getActorId` lahir di `tenant-context.ts`, pola sama dengan `getTenantId`. Aktor lintas tenant → `404`, bukan `changed_by` karangan. Satu titik ganti saat modul identity datang. |
| **Q2** | **Merge PR #3 dulu** — sudah dilakukan user, `main` kini di `0015` | Migrasi FR-A7 = `0016`. Cabang lurus dari `main`. |
| **Q3** | **`item_variation.price` beku setelah dibuat** | Satu sumber kebenaran. `updateItemVariation` yang sudah menolak `price` kini jadi perilaku permanen, bukan penundaan — komentar di `items.ts:530` harus diperbarui supaya tidak berbohong. |
| **Q4** | **Harga terjadwal diizinkan** | `effectiveFrom` di masa depan diterima. Konsekuensi yang harus diuji: resolusi pada `now()` **tidak boleh** memungut harga terjadwal yang belum berlaku. Ini menambah satu kasus property test di T7. |

Q1 menambah satu task baru (**T0**) sebelum T2, karena `getActorId` adalah prasyarat setiap endpoint tulis di sub-project ini.

### Q1 — Dari mana `changed_by` diisi? **MEMBLOKIR.**

AC FR-A7 #2 berbunyi "`changed_by` selalu terisi". Tapi server tidak punya identitas aktor sama sekali — `apps/server/src/tenant-context.ts:12` hanya membaca header `X-Tenant-Id`, dan komentarnya sendiri menyebut auth asli baru datang di modul identity. Kolom `price_history.changed_by` juga `text NOT NULL` **tanpa FK** ke `"user"`.

Tiga jalan:

**(a) Header `X-Actor-Id`, divalidasi ke tabel `"user"` lewat SELECT yang tunduk RLS.**
Sejalan dengan pola `X-Tenant-Id` yang sudah ada, dan divalidasi sungguhan sehingga `changed_by` tidak pernah berisi id karangan. Saat modul identity datang, header diganti ekstraksi token — satu tempat. **Ini rekomendasi saya.**

**(b) Header `X-Actor-Id` tanpa validasi.**
Lebih cepat, tapi menulis id sembarang ke kolom audit finansial. Saya tidak menyarankan.

**(c) Tunda FR-A7 sampai Modul F selesai.**
Berarti Modul B juga tertunda — `order_line.unit_price` butuh resolver ini. Praktis membalik seluruh urutan fase.

### Q2 — Nomor migrasi: PR #3 belum di-merge.

Migrasi `0015` ada di PR #3 yang masih OPEN. Index FR-A7 akan jadi `0016` — tapi kalau saya kerjakan dari `main`, `0016` akan lahir tanpa `0015` di sejarahnya.

**(a) Kamu merge PR #3 dulu, saya cabang dari `main` yang baru.** Paling bersih. **Rekomendasi saya.**
**(b) Saya cabang dari `oq09-vertical-profile-outlet`.** PR baru jadi bertumpuk di atas PR #3; kalau kamu tolak PR #3, semua ikut tertahan.

### Q3 — Apakah `item_variation.price` masih boleh berubah setelah item dibuat?

Tangga resolusi menaruh `item_variation.price` di tingkat paling bawah — artinya ia adalah **harga awal**, bukan harga saat ini. Kalau kolom itu masih bisa di-`UPDATE`, akan ada dua sumber kebenaran untuk hal yang sama, dan riwayat harga jadi bolong.

Usul saya: **`item_variation.price` diisi sekali saat variation dibuat, sesudah itu tidak pernah berubah.** Semua perubahan lewat `price_history`. Konsisten dengan invariant #2 dan dengan `updateItemVariation` yang memang sudah tidak menerima `price`.

Ini keputusan produk, bukan teknis — makanya saya tanyakan.

### Q4 — Harga bertanggal masa depan: didukung?

Tangga resolusi `effective_from ≤ waktu transaksi` secara teknis sudah mendukung penjadwalan harga ("naik jadi 30.000 mulai 1 September"). Tidak ada yang perlu dibangun tambahan — hanya perlu **tidak** ditolak validasi.

Usul: **izinkan**, karena menolaknya justru butuh kode ekstra. Tapi ini menambah janji produk yang belum ada di spec mana pun, jadi saya angkat.

### Risiko

- **Resolver ini akan dipakai Modul B.** Salah bentuk di sini berarti retrofit di sana. Karena itu diekspor lewat `catalog/index.ts` sejak awal (invariant #4), bukan diakses langsung.
- **Query resolusi per-outlet untuk seluruh katalog** (`GET /outlets/{id}/prices`) berpotensi berat pada katalog besar. Diukur, bukan diasumsikan; kalau lambat, dicatat di FINDINGS bukan ditebak.
- **Sub-project ini tidak menutup FR-A7 sepenuhnya.** Dua dari empat AC tetap terbuka sampai Modul B dan F2/G. `CLAUDE.md` akan menyebut FR-A7 "sebagian", bukan "selesai" — supaya dokumen tidak berbohong.
