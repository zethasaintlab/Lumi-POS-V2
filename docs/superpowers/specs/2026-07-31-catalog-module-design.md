# Modul Katalog — endpoint REST inti (struktur, kategori, arsip, satuan)

**Status:** Disetujui · **Tanggal:** 31 Juli 2026
**Bagian dari:** F1 — modul pertama dengan endpoint bisnis sungguhan, dibangun di atas fondasi `apps/server` (Fastify + `fastify-openapi-glue` + `withTenantTransaction`) yang baru selesai.

## Konteks

Skema tabel katalog sudah ada (`db/migrations/0004_catalog.sql`, RLS dari F0): `category`, `item`, `item_variation`, `modifier_list`, `modifier`, `item_modifier_list`, `price_history`. Belum ada kode aplikasi yang menyentuhnya sama sekali.

Dikonfirmasi lewat `product/IA-lumi-pos-v1.md` §7: seluruh layar back-office (termasuk kelola katalog) **online-only** — kasir hanya *membaca* katalog hasil sinkronisasi, tidak pernah menulis. Ini menghapus kekhawatiran idempotency-key/outbox untuk jalur tulis katalog — setiap panggilan API katalog adalah satu transaksi server biasa lewat `withTenantTransaction`.

Cakupan disepakati dengan user: **backend REST API saja** (UI kelola produk menyusul), **tanpa gambar produk** (`image_url` tetap di skema, dihilangkan total dari permukaan API), dan FR yang masuk sub-project ini: **FR-A1** (struktur tiga tingkat), **FR-A2** (item satu-variation disederhanakan), **FR-A4** (kategori maks dua tingkat), **FR-A6** (arsip bukan hapus), **FR-A9** (kolom satuan). **FR-A7** (harga + riwayat), **FR-A3/FR-A5** (aturan pilihan modifier — lebih ke UI kasir), **FR-A8** (impor, P1) ditunda ke sub-project Katalog berikutnya.

## Keputusan desain

### 1. Struktur modul

```
apps/server/src/modules/catalog/
  index.ts                    # satu-satunya permukaan publik: createCatalogHandlers(pool)
  handlers/
    categories.ts
    items.ts
    item-variations.ts
    modifier-lists.ts
    modifiers.ts
    item-modifier-lists.ts
  errors.ts                    # CatalogError (statusCode, code, message)
```

`app.ts` memanggil `createCatalogHandlers(pool)` dan menyebarkan hasilnya ke `serviceHandlers` datar yang dibutuhkan `fastify-openapi-glue` — internal modul tetap di belakang `index.ts`, sesuai aturan modul di `apps/server/src/modules/README.md` (belum ada yang bisa dilanggar karena ini modul pertama, tapi bentuknya sudah benar untuk modul kedua nanti).

### 2. Sumber `tenantId` — placeholder eksplisit, bukan keamanan asli

Sebuah Fastify `preHandler` hook global membaca header `X-Tenant-Id`, memvalidasi bentuknya (string non-kosong, panjang wajar untuk ULID/UUIDv7), menolak dengan 400 kalau tidak ada/tidak valid, lalu menaruhnya di `req.tenantId`. **Diberi komentar eksplisit di kode** bahwa ini placeholder untuk modul `identity` (F3) menggantinya dengan ekstraksi token/session asli. RLS Postgres tetap jadi lapisan pertahanan sesungguhnya (invariant #8) — header ini cuma menentukan *apa* yang diminta, bukan mengizinkannya.

### 3. Amplop error — kode bisnis yang konsisten

```ts
class CatalogError extends Error {
  constructor(public statusCode: number, public code: string, message: string) {
    super(message);
  }
}
```

Ditangkap oleh Fastify error handler global (`app.ts`), diserialisasi jadi:
```json
{ "error": { "code": "CATEGORY_DEPTH_EXCEEDED", "message": "..." } }
```
Kode yang dipakai sub-project ini: `CATEGORY_DEPTH_EXCEEDED`, `ITEM_NO_VARIATION`, `VARIATION_LIMIT_EXCEEDED` (dari CHECK `sort_order <= 250`, `error.code === '23514'`), `BARCODE_DUPLICATE` (dari unique index, `error.code === '23505'`), `NOT_FOUND`, `VALIDATION_ERROR` (harga negatif, dll. — divalidasi di application layer; skema `item_variation.price` **tidak** punya CHECK non-negatif, jadi ini murni tanggung jawab handler, tidak menyentuh migrasi).

### 4. ID — klien yang generate, konsisten di seluruh sistem

Setiap request body `create*` menyertakan `id` (ULID/UUIDv7 yang sudah di-generate pemanggil) — server tidak pernah `gen_random_uuid()` atau sejenisnya untuk entitas apa pun, termasuk untuk jalur online-only ini. Konsisten dengan `CLAUDE.md`, satu aturan tanpa pengecualian per modul.

### 5. Endpoint per resource

**Category** (`createCategory`, `listCategories`, `getCategory`, `updateCategory`, `archiveCategory`, `restoreCategory`)
- `create`/`update`: kalau `parentId` diisi, ambil parent-nya — tolak (`CATEGORY_DEPTH_EXCEEDED`) kalau `parent.parent_id IS NOT NULL` (parent itu sendiri sudah anak kategori lain). Ini persis aturan "kategori yang sudah punya parent tidak boleh jadi parent".
- `list`: `?includeArchived=true` opsional, default hanya yang aktif.

**Item + variation pertama** (`createItem` — satu transaksi, Item + ≥1 variation di body yang sama)
- Body: `{ id, name, categoryId?, description?, sortOrder?, variations: [{ id, name?, sku?, barcode?, price, cost?, stockingUnit?, sellingUnit?, conversionFactor?, trackStock? }] }` — `variations` minimal 1 elemen (`ITEM_NO_VARIATION` kalau kosong). `variations[].name` default `'Regular'` kalau tidak diisi (FR-A2, cocok default DB). `stockingUnit`/`sellingUnit`/`conversionFactor` default `pcs`/`pcs`/`1` (FR-A9) — tidak ada logika konversi, cuma disimpan.
- `sortOrder` variation pertama = 0 (dihitung server, lihat §6).
- `image_url` **tidak muncul** di request maupun response.
- `updateItem`: field struktural saja (`name`, `categoryId`, `description`, `sortOrder`) — bukan variation.
- `archiveItem`/`restoreItem`: set/clear `archived_at` di Item saja — variation-nya tidak ikut ter-archive otomatis (arsip per-variation punya endpoint sendiri, lihat berikutnya). Item yang diarsipkan hilang dari kasir terlepas status variation-nya.

**ItemVariation** (`createItemVariation`, `updateItemVariation`, `archiveItemVariation`, `restoreItemVariation`)
- `create`: body **tidak** menyertakan `sortOrder` — server hitung `MAX(sort_order)+1` untuk item itu, dalam transaksi yang sama dengan `INSERT`. CHECK `sort_order <= 250` yang sudah ada di skema otomatis menolak percobaan ke-251; handler menerjemahkan `23514` jadi `VARIATION_LIMIT_EXCEEDED` (pesan jelas, bukan error Postgres mentah).
- `update`: **tidak boleh mengubah `price`** — field yang diizinkan: `name`, `sku`, `barcode`, `trackStock`, `stockingUnit`, `sellingUnit`, `conversionFactor`. Endpoint ubah-harga yang benar (lewat `price_history`) dibangun di sub-project FR-A7.
- Barcode duplikat (unique index `ux_variation_barcode`) → `23505` diterjemahkan jadi `BARCODE_DUPLICATE`.
- `archive`/`restore` per-variation: endpoint terpisah dari arsip Item.

**ModifierList** (`createModifierList`, `listModifierLists`, `getModifierList`, `updateModifierList`, `archiveModifierList`, `restoreModifierList`) — CRUD standar, `archive` satu-satunya cara "hapus" (tidak ada endpoint delete literal sama sekali, jadi AC "menghapus yang dipakai Item ditolak" otomatis terpenuhi — tidak ada operasi untuk ditolak).

**Modifier** (`createModifier`, `updateModifier`, `archiveModifier`, `restoreModifier`) — bersarang di bawah `modifier_list_id`, CRUD standar.

**Item↔ModifierList** (`attachModifierList` POST, `detachModifierList` DELETE) — `detach` adalah `DELETE` baris bridge sungguhan (bukan arsip) — invariant #4 bicara soal entitas, bukan relasi N:M, dan `item_modifier_list` memang tidak punya `archived_at` di skema.

### 6. Konvensi respons

`create*` mengembalikan `201` dengan resource lengkap yang baru dibuat (Item termasuk `variations` bersarang). `update*`/`archive*`/`restore*` mengembalikan `200` dengan resource lengkap versi terbaru. `list*` mengembalikan `200` dengan `{ "items": [...] }` (bukan array telanjang — memberi ruang untuk pagination di masa depan tanpa breaking change). `attach*`/`detach*` mengembalikan `204` tanpa body (relasi bridge, bukan resource dengan representasi sendiri).

### 7. Transaksi & konkurensi

Setiap operasi tulis (create/update/archive/restore/attach/detach) adalah **satu** `withTenantTransaction` — termasuk `createItem` (Item + N variation) dan `createItemVariation` (hitung `MAX(sort_order)` + `INSERT` dalam transaksi yang sama supaya tidak race dengan create variation lain yang bersamaan).

## Di luar scope (sengaja tidak disentuh)

- FR-A7 (harga per outlet + `price_history`) — `item_variation.price` cuma bisa di-set saat create.
- FR-A3/FR-A5 (aturan pilihan modifier di kasir, guardrail UI) — itu perilaku layar kasir, bukan endpoint backend.
- FR-A8 (impor katalog) — P1, sub-project terpisah.
- UI kelola produk apa pun (`apps/kasir` atau `apps/backoffice`).
- Auth/RBAC sungguhan — `X-Tenant-Id` placeholder eksplisit, diganti modul `identity` (F3).
- Migrasi skema baru — semua endpoint bekerja di atas `db/migrations/0004_catalog.sql` apa adanya, termasuk validasi harga negatif yang murni application-layer.

## Verifikasi

- Property test: untuk `Item` apa pun yang berhasil dibuat, jumlah variation ≥ 1 (tidak pernah ada state Item-tanpa-variation, sekalipun sesaat, karena satu transaksi).
- Test kategori tingkat 3 ditolak; variation ke-251 ditolak dengan `VARIATION_LIMIT_EXCEEDED`; barcode duplikat ditolak dengan `BARCODE_DUPLICATE`.
- Test isolasi tenant: setiap endpoint hanya lewat `withTenantTransaction`, tidak ada `pool.query` langsung di modul ini.
- Test arsip: `DELETE` tidak pernah muncul di kode SQL modul ini (grep test, sama pola dengan AC spec).
- `npm run test:server` (atau suite baru `tests/catalog/`) hijau, plus `tsc --noEmit`, plus `npm run lint:ds` tetap hijau.
