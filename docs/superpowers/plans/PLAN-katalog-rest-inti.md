# Modul Katalog — Endpoint REST Inti (F1, sub-project 1) — Implementation Plan

> **For agentic workers:** Steps pakai checkbox (`- [ ]`). Urutan langkah **TDD ketat**: test gagal dulu → konfirmasi gagal karena alasan yang benar → implementasi minimum → suite hijau → commit. Tidak ada pengecualian.

**Tanggal audit:** 1 Agustus 2026 · **Status:** ⏸ menunggu approval eksplisit (pertanyaan Q1–Q5 sudah dijawab, lihat § 8)

---

## 1. Ringkasan audit

1. **F0 tertutup.** Semua item gate F0 di `CLAUDE.md` § "Status & fase" hijau: migrasi `db/migrations/0001–0014`, test isolasi lintas-tenant (`npm run test:isolation`, 189/189), skema SQLite lokal, self-host Inter, COOP/COEP, `npm run lint:ds` + CI, dan aplikasi kosong di Tauri.
2. **F1 sudah dimulai secara infrastruktur, belum secara bisnis.** `apps/server` (Fastify + `fastify-openapi-glue` + `withTenantTransaction`) dan `packages/contracts` sudah ada dan hijau — `npm run test:server` lolos 6/6 terhadap PostgreSQL nyata (diverifikasi 1 Agu 2026).
3. **`packages/contracts/openapi.yaml` masih hanya berisi `/health`.** Nol endpoint bisnis.
4. **`apps/server/src/modules/` kosong** (hanya `README.md`). Tidak ada satu baris pun kode yang menyentuh tabel katalog.
5. **Sudah ada design doc + plan lengkap untuk modul Katalog** (`docs/superpowers/specs/2026-07-31-catalog-module-design.md`, `docs/superpowers/plans/2026-07-31-catalog-module.md`, 2595 baris, commit `2189a2d`) — **belum dieksekusi sama sekali**.
6. **Checkbox di plan lama bukan sinyal status.** Plan milestone yang sudah selesai (Tauri shell, lint DS, server scaffold) juga 100% unchecked. Status sebenarnya harus dibaca dari kode + `HANDOFF.md`.
7. Milestone berikutnya menurut roadmap **tidak ambigu**: F1 → Modul A (Katalog). Yang ambigu adalah *plan mana yang dipakai* — lihat § 8 Q1.
8. Audit menemukan **4 cacat substantif di plan lama** (batas 250 off-by-one, validasi harga negatif hilang, urutan langkah bukan TDD, tidak ada npm script) — dikoreksi di plan ini.

---

## 2. Milestone yang dipilih

**F1 — Inti transaksi, sub-project 1: Modul A (Katalog), endpoint REST inti.**

Dasar dokumen:

- `product/ARCH-lumi-pos-v1.md` § 14: *"**F1** 4–6 mgg | Modul catalog, ordering, payment · idempotency · append-only"* — catalog disebut pertama.
- `product/PRD-lumi-pos-v1.md` § 13: *"**F1 — Inti transaksi** | Modul A (Katalog) · B (Kasir & Order) · C (Pembayaran & Pajak)"*.
- `product/specs/spec-a-katalog.md` § A.0: *"Modul ini … adalah **hulu** dari seluruh sistem: kesalahan struktur di sini merambat ke inventori, laporan margin, dan struk historis."* — urutan bukan selera; B dan C mengonsumsi struktur A.
- `docs/superpowers/specs/2026-07-31-catalog-module-design.md` (Status: Disetujui) — batas scope sub-project ini sudah disepakati user: FR-A1, FR-A2, FR-A4, FR-A6, FR-A9.

FR yang ditutup: **FR-A1** (struktur tiga tingkat), **FR-A2** (item satu-variation), **FR-A4** (kategori maks dua tingkat), **FR-A6** (arsip bukan hapus), **FR-A9** (kolom satuan).

---

## 3. Scope

29 `operationId` di `packages/contracts/openapi.yaml` (28 baru + `getHealth` yang sudah ada), diimplementasikan di `apps/server/src/modules/catalog/`:

| Grup | Operasi |
|---|---|
| Infrastruktur bersama | `HttpError`, `getTenantId`, global error handler, wiring `createCatalogHandlers` |
| Category (6) | `createCategory` `listCategories` `getCategory` `updateCategory` `archiveCategory` `restoreCategory` |
| Item + ItemVariation (10) | `createItem` `listItems` `getItem` `updateItem` `archiveItem` `restoreItem` `createItemVariation` `updateItemVariation` `archiveItemVariation` `restoreItemVariation` |
| ModifierList + Modifier (10) | `createModifierList` `listModifierLists` `getModifierList` `updateModifierList` `archiveModifierList` `restoreModifierList` `createModifier` `updateModifier` `archiveModifier` `restoreModifier` |
| Item↔ModifierList (2) | `attachModifierList` `detachModifierList` |

Plus tiga koreksi hasil audit yang **tidak ada** di plan lama:

- **K1** — batas 250 variation ditegakkan di application layer (`COUNT` sebelum insert), bukan mengandalkan CHECK `sort_order <= 250` yang meleset satu (lihat § 8 Q2).
- **K2** — harga negatif ditolak `400 VALIDATION_ERROR` (`spec-a-katalog.md` § A.7: *"Harga negatif | Ditolak"*; skema tidak punya CHECK-nya).
- **K3** — `npm run test:catalog` ditambahkan ke `package.json`.

Kontrak yang mengikat:

- Setiap tulis lewat `withTenantTransaction` — **tidak ada** `pool.query`/`pool.connect` langsung di `modules/catalog/`.
- ID selalu dari klien di body `create*`; server tidak pernah generate ID entitas.
- `item.image_url` tidak pernah muncul di request maupun response.
- `item_variation.price` hanya bisa di-set saat create; tidak ada `UPDATE` harga di sub-project ini (FR-A7 menyusul).
- Tidak ada `DELETE` SQL di modul ini kecuali `item_modifier_list` (relasi N:M, tidak punya `archived_at`).
- Respons: `create*` → 201 + resource · `update*`/`archive*`/`restore*`/`attach*` → 200 + resource · `list*` → 200 + `{"items":[…]}` · `detach*` → 204.

---

## 4. Non-scope — eksplisit tidak disentuh

| Tidak dikerjakan | Alasan |
|---|---|
| **FR-A7** harga per outlet + `price_history` | Sub-project terpisah; `price_history` tidak disentuh sama sekali |
| **FR-A3 / FR-A5** aturan pilihan modifier + guardrail | Perilaku layar kasir, bukan endpoint backend |
| **FR-A8** impor katalog | P1, sub-project terpisah |
| UI apa pun (`apps/kasir`, `apps/backoffice`) | Backend REST saja, disepakati di design doc |
| Auth/RBAC sungguhan | `X-Tenant-Id` placeholder eksplisit sampai modul `identity` (F3) |
| Migrasi skema baru | Semua endpoint jalan di atas `db/migrations/0004_catalog.sql` apa adanya |
| Modul `ordering`, `payment` | Sub-project F1 berikutnya |
| `db/local/*` (SQLite) | Jalur turun katalog milik PowerSync (F2) |
| `product/`, `research/`, `docs/superpowers/specs/` | Terlarang per instruksi |

Dua hal berikut **awalnya** di luar scope, lalu **dimasukkan** atas keputusan user (§ 8 Q4/Q5) sebagai Task 8 dan Task 9 — dikerjakan setelah endpoint selesai, sebagai commit terpisah:

- PostgreSQL service container di CI (Task 8)
- Perbaikan `CLAUDE.md` + `README.md` yang menyatakan fase yang salah (Task 9)

---

## 5. Task breakdown

Setiap task berakhir dengan suite hijau + satu commit. Kode implementasi lengkap untuk tiap handler **sudah tertulis** di `docs/superpowers/plans/2026-07-31-catalog-module.md` — plan ini merujuknya per task alih-alih menyalin 2000 baris, dan menuliskan **penuh** setiap tempat yang berbeda dari plan lama.

### Task 1 — Infrastruktur bersama: `HttpError`, `getTenantId`, wiring kosong

**Files**
- Create: `apps/server/src/http-error.ts`, `apps/server/src/tenant-context.ts`, `apps/server/src/modules/catalog/index.ts`
- Modify: `apps/server/src/app.ts`, `packages/contracts/openapi.yaml` (`components.schemas.Error`), `package.json` (script `test:catalog`)
- Test: `tests/catalog/infra.test.js`

**Produces** — dipakai semua task berikutnya: `HttpError(statusCode, code, message)`; `getTenantId(req): string`; `createCatalogHandlers(pool): Record<string, unknown>`.

- [ ] **1.1** Tulis `tests/catalog/infra.test.js` (test gagal duluan) — sumber: plan lama Task 1 Step 6, ditambah satu test baru untuk header terlalu panjang:

  ```js
  test('getTenantId: header > 64 karakter ditolak', async () => {
    const { getTenantId } = await import('../../apps/server/src/tenant-context.ts');
    const { HttpError } = await import('../../apps/server/src/http-error.ts');
    assert.throws(
      () => getTenantId({ headers: { 'x-tenant-id': 'x'.repeat(65) } }),
      (err) => err instanceof HttpError && err.statusCode === 400
    );
  });
  ```
- [ ] **1.2** Tambahkan script ke `package.json`: `"test:catalog": "node --env-file=.env --test \"tests/catalog/*.test.js\""`
- [ ] **1.3** Jalankan `npm run test:catalog` → **harus gagal** dengan `ERR_MODULE_NOT_FOUND` untuk `tenant-context.ts` (bukan syntax error di test-nya)
- [ ] **1.4** Implementasi `http-error.ts` + `tenant-context.ts` + `modules/catalog/index.ts` (isi persis plan lama Task 1 Step 1–3)
- [ ] **1.5** Modifikasi `app.ts`: pindahkan `createPool()` ke atas `serviceHandlers`, daftarkan `app.setErrorHandler`, spread `createCatalogHandlers(pool)` (isi persis plan lama Task 1 Step 5)
- [ ] **1.6** Tambahkan `components.schemas.Error` ke `openapi.yaml` (plan lama Task 1 Step 4)
- [ ] **1.7** `npm run test:catalog` hijau · `npm run test:server` hijau · `cd apps/server && npx tsc --noEmit` 0 error
- [ ] **1.8** Commit

### Task 2 — Category (6 operasi, FR-A4 + FR-A6)

**Files**
- Create: `apps/server/src/modules/catalog/handlers/categories.ts`
- Modify: `apps/server/src/modules/catalog/index.ts`, `packages/contracts/openapi.yaml`
- Test: `tests/catalog/categories.test.js`

**Consumes** `withTenantTransaction`, `HttpError`, `getTenantId` · **Produces** `createCategoryHandlers(pool)`

- [ ] **2.1** Tulis `tests/catalog/categories.test.js` lengkap (plan lama Task 2 Step 4 — 7 test: top-level, tingkat 2, tingkat 3 ditolak `CATEGORY_DEPTH_EXCEEDED`, archive→restore, `includeArchived`, update parent ke anak ditolak, 404)
- [ ] **2.2** Jalankan → **harus gagal** karena `serviceHandlers` tidak punya `createCategory` (`assertAllOperationsImplemented` melempar saat `buildApp()`), bukan karena test-nya salah tulis
- [ ] **2.3** Tambahkan `Category` schema + 6 path ke `openapi.yaml` (plan lama Task 2 Step 1)
- [ ] **2.4** Implementasi `handlers/categories.ts` (plan lama Task 2 Step 2) + wiring di `index.ts` (Step 3)
- [ ] **2.5** `npm run test:catalog` + `npm run test:server` + `tsc --noEmit` hijau
- [ ] **2.6** Commit

### Task 3 — Item + ItemVariation (10 operasi, FR-A1/A2/A9 + koreksi K1 & K2)

**Files**
- Create: `apps/server/src/modules/catalog/handlers/items.ts`
- Modify: `apps/server/src/modules/catalog/index.ts`, `packages/contracts/openapi.yaml`
- Test: `tests/catalog/items.test.js`

**Consumes** infrastruktur Task 1 · **Produces** `createItemHandlers(pool)`

- [ ] **3.1** Tulis `tests/catalog/items.test.js` — seluruh test dari plan lama Task 3 Step 4, **plus tiga test baru** yang menutup cacat audit:

  ```js
  test('createItem: harga negatif ditolak 400 VALIDATION_ERROR', async () => {
    const res = await req('POST', '/items', {
      id: crypto.randomUUID(),
      name: 'Rusak',
      variations: [{ id: crypto.randomUUID(), price: -1 }],
    });
    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(res.body).error.code, 'VALIDATION_ERROR');
  });

  test('createItemVariation: harga negatif ditolak 400 VALIDATION_ERROR', async () => {
    const itemId = crypto.randomUUID();
    await req('POST', '/items', { id: itemId, name: 'Kopi', variations: [{ id: crypto.randomUUID(), price: 1000 }] });
    const res = await req('POST', `/items/${itemId}/variations`, { id: crypto.randomUUID(), price: -5 });
    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(res.body).error.code, 'VALIDATION_ERROR');
  });

  // spec-a-katalog.md § A.7: "Variation ke-251 | Ditolak dengan pesan; batas 250"
  test('createItemVariation: variation ke-251 ditolak VARIATION_LIMIT_EXCEEDED', async () => {
    const itemId = crypto.randomUUID();
    const first = crypto.randomUUID();
    await req('POST', '/items', { id: itemId, name: 'Banyak', variations: [{ id: first, price: 1000 }] });
    for (let i = 2; i <= 250; i += 1) {
      const res = await req('POST', `/items/${itemId}/variations`, { id: crypto.randomUUID(), price: 1000 });
      assert.equal(res.statusCode, 201, `variation ke-${i} seharusnya diterima`);
    }
    const res251 = await req('POST', `/items/${itemId}/variations`, { id: crypto.randomUUID(), price: 1000 });
    assert.equal(res251.statusCode, 409);
    assert.equal(JSON.parse(res251.body).error.code, 'VARIATION_LIMIT_EXCEEDED');
  });
  ```

  Catatan: test ke-251 sengaja membangun 250 variation sungguhan — lambat (~beberapa detik) tapi ini satu-satunya cara membuktikan batasnya tepat di 250, bukan 251. Kalau ternyata > 30 detik, dipindah ke test terpisah bertanda `{ concurrency: false }`, bukan dihapus.

- [ ] **3.2** Jalankan → **harus gagal** karena handler item belum ada
- [ ] **3.3** Tambahkan schema `Item`/`ItemVariation`/`ItemVariationInput` + 10 path ke `openapi.yaml` (plan lama Task 3 Step 1)
- [ ] **3.4** Implementasi `handlers/items.ts` (plan lama Task 3 Step 2) **dengan dua perubahan wajib terhadap plan lama**:

  ```ts
  // K2 — harga negatif ditolak di application layer (skema tidak punya CHECK-nya).
  function assertPriceValid(input: VariationInput): void {
    if (typeof input.price !== 'number' || !Number.isInteger(input.price) || input.price < 0) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Harga harus bilangan bulat rupiah >= 0.');
    }
    if (input.cost !== undefined && (!Number.isInteger(input.cost) || input.cost < 0)) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Cost harus bilangan bulat rupiah >= 0.');
    }
  }

  // K1 — batas 250 ditegakkan dengan COUNT di transaksi yang sama, BUKAN mengandalkan
  // CHECK (sort_order <= 250): sort_order mulai dari 0, jadi CHECK baru menolak
  // variation ke-252. spec-a-katalog.md § A.7 menuntut yang ke-251 ditolak.
  const MAX_VARIATIONS_PER_ITEM = 250;

  async function assertVariationSlotAvailable(client: PoolClient, itemId: string): Promise<void> {
    const { rows } = await client.query<{ count: string }>(
      'SELECT COUNT(*) AS count FROM item_variation WHERE item_id = $1',
      [itemId]
    );
    if (Number(rows[0].count) >= MAX_VARIATIONS_PER_ITEM) {
      throw new HttpError(
        409,
        'VARIATION_LIMIT_EXCEEDED',
        `Batas ${MAX_VARIATIONS_PER_ITEM} variation per item sudah tercapai.`
      );
    }
  }
  ```

  `insertVariation` memanggil `assertPriceValid(input)` lalu `assertVariationSlotAvailable(client, itemId)` sebelum `INSERT`. `translateConstraintError` tetap memetakan `23505` → `BARCODE_DUPLICATE`; pemetaan `23514` → `VARIATION_LIMIT_EXCEEDED` **dipertahankan sebagai jaring pengaman**, tidak dihapus.

- [ ] **3.5** Wiring `createItemHandlers` di `index.ts`
- [ ] **3.6** `npm run test:catalog` + `npm run test:server` + `tsc --noEmit` hijau
- [ ] **3.7** Commit

### Task 4 — ModifierList + Modifier (10 operasi, FR-A1 + FR-A6)

**Files**
- Create: `apps/server/src/modules/catalog/handlers/modifier-lists.ts`
- Modify: `apps/server/src/modules/catalog/index.ts`, `packages/contracts/openapi.yaml`
- Test: `tests/catalog/modifier-lists.test.js`

- [ ] **4.1** Tulis `tests/catalog/modifier-lists.test.js` (plan lama Task 4 Step 5), **plus** satu test yang mengunci AC `spec-a-katalog.md` § FR-A1 (*"`Modifier` tidak memiliki kolom `sku` maupun `track_stock`"*):

  ```js
  test('response Modifier tidak pernah membawa sku atau trackStock', async () => {
    const listId = crypto.randomUUID();
    await req('POST', '/modifier-lists', { id: listId, name: 'Extra', selectionType: 'multi' });
    const res = await req('POST', `/modifier-lists/${listId}/modifiers`, {
      id: crypto.randomUUID(), name: 'Extra Shot', price: 5000,
    });
    const body = JSON.parse(res.body);
    assert.equal('sku' in body, false);
    assert.equal('trackStock' in body, false);
  });
  ```
- [ ] **4.2** Jalankan → **harus gagal** karena handler modifier belum ada
- [ ] **4.3** Tambahkan schema + 10 path ke `openapi.yaml` (plan lama Task 4 Step 1 dan Step 3 — Step 3 menambahkan dua path archive/restore Modifier yang terlewat di Step 1; **keduanya wajib**, kalau tidak `assertAllOperationsImplemented` akan lolos tapi endpoint-nya tidak ada rutenya)
- [ ] **4.4** Implementasi `handlers/modifier-lists.ts` (plan lama Task 4 Step 2) + wiring
- [ ] **4.5** `npm run test:catalog` + `npm run test:server` + `tsc --noEmit` hijau
- [ ] **4.6** Commit

### Task 5 — Item↔ModifierList attach/detach (2 operasi)

**Files**
- Create: `apps/server/src/modules/catalog/handlers/item-modifier-lists.ts`
- Modify: `apps/server/src/modules/catalog/index.ts`, `packages/contracts/openapi.yaml`
- Test: `tests/catalog/item-modifier-lists.test.js`

- [ ] **5.1** Tulis `tests/catalog/item-modifier-lists.test.js` (plan lama Task 5 Step 4 — attach, attach idempoten, satu list dipakai dua item, detach 204, 404 untuk item/list tidak ada)
- [ ] **5.2** Jalankan → **harus gagal**
- [ ] **5.3** Tambahkan 2 path ke `openapi.yaml` + implementasi `handlers/item-modifier-lists.ts` (plan lama Task 5 Step 1–2) + wiring
- [ ] **5.4** `npm run test:catalog` + `npm run test:server` + `tsc --noEmit` hijau
- [ ] **5.5** Commit

### Task 6 — Test invariant modul (property + grep guard)

**Files**
- Test: `tests/catalog/invariants.test.js`

Task ini menutup AC dari `spec-a-katalog.md` § A.8 yang **tidak** dicakup plan lama sebagai test tersendiri.

- [ ] **6.1** Tulis `tests/catalog/invariants.test.js`:

  ```js
  // spec-a-katalog.md § A.8 property test: "Untuk Item apa pun: jumlah variation >= 1"
  test('property: setiap Item yang berhasil dibuat selalu punya >= 1 variation', async () => {
    for (let n = 1; n <= 5; n += 1) {
      const itemId = crypto.randomUUID();
      const variations = Array.from({ length: n }, () => ({ id: crypto.randomUUID(), price: 1000 }));
      const res = await req('POST', '/items', { id: itemId, name: `Item ${n}`, variations });
      assert.equal(res.statusCode, 201);
      assert.ok(JSON.parse(res.body).variations.length >= 1);
    }
    const listed = await req('GET', '/items');
    for (const item of JSON.parse(listed.body).items) {
      assert.ok(item.variations.length >= 1, `item ${item.id} tanpa variation`);
    }
  });

  // spec-a-katalog.md § A.8 test kegagalan: "DELETE pada tabel katalog tidak ada di kode (grep test)"
  test('tidak ada DELETE SQL pada tabel katalog di modules/catalog', async () => {
    const dir = new URL('../../apps/server/src/modules/catalog/', import.meta.url);
    const files = await collectTsFiles(dir); // helper lokal, rekursif
    for (const file of files) {
      const src = await readFile(file, 'utf8');
      const deletes = src.match(/DELETE\s+FROM\s+(\w+)/gi) ?? [];
      for (const stmt of deletes) {
        const table = stmt.split(/\s+/)[2].toLowerCase();
        assert.equal(
          table, 'item_modifier_list',
          `DELETE FROM ${table} di ${file} melanggar FR-A6 -- katalog hanya diarsipkan`
        );
      }
    }
  });

  // Invariant #4 ARCH: setiap tulis lewat withTenantTransaction
  test('tidak ada pool.query / pool.connect langsung di modules/catalog', async () => {
    const files = await collectTsFiles(new URL('../../apps/server/src/modules/catalog/', import.meta.url));
    for (const file of files) {
      const src = await readFile(file, 'utf8');
      assert.equal(/pool\.(query|connect)\s*\(/.test(src), false, `akses pool langsung di ${file}`);
    }
  });

  // CLAUDE.md: image_url tidak pernah muncul di permukaan API
  test('image_url tidak pernah muncul di kode modul maupun kontrak OpenAPI', async () => {
    const files = await collectTsFiles(new URL('../../apps/server/src/modules/catalog/', import.meta.url));
    for (const file of files) {
      assert.equal((await readFile(file, 'utf8')).includes('image_url'), false, `image_url di ${file}`);
    }
    const spec = await readFile(new URL('../../packages/contracts/openapi.yaml', import.meta.url), 'utf8');
    assert.equal(/imageUrl|image_url/.test(spec), false, 'image_url bocor ke kontrak OpenAPI');
  });
  ```
- [ ] **6.2** Jalankan → test grep **harus lulus** langsung (kode sudah benar sejak Task 3–5); test property **harus gagal dulu** kalau dijalankan sebelum Task 3 — karena Task 6 setelah Task 5, konfirmasi kegagalan dilakukan dengan sengaja merusak sementara: hapus guard `ITEM_NO_VARIATION` di `items.ts`, jalankan, pastikan test property merah, kembalikan guard, pastikan hijau. **Ini wajib** — test yang tidak pernah terbukti bisa merah bukan test.
- [ ] **6.3** Seluruh suite hijau
- [ ] **6.4** Commit

### Task 7 — PostgreSQL service container di CI (keputusan Q4)

**Files**
- Modify: `.github/workflows/lint-ds.yml` (atau file workflow baru `test.yml` — lihat 7.1)

Menutup drift D5 + memenuhi `product/ARCH-lumi-pos-v1.md` § 9: *"**Gate CI wajib:** test isolasi lintas-tenant untuk **setiap** tabel"*. Sekarang test itu tidak pernah dijalankan CI sama sekali.

- [ ] **7.1** Putuskan bentuknya: tambah job `test` **terpisah** di workflow baru `.github/workflows/test.yml`, bukan menumpang job `lint-ds` — lint tidak butuh database dan harus tetap cepat serta bisa hijau sendiri
- [ ] **7.2** Tulis workflow dengan `services: postgres:17`, `env` yang memetakan `DATABASE_ADMIN_URL`/`DATABASE_MIGRATION_URL`/`DATABASE_URL` ke service tersebut, lalu langkah `npm ci` → `npm run db:bootstrap` → `npm run db:migrate` → `test:isolation` → `test:server` → `test:catalog` → `test:sqlite-local` → `test:oxlint-ds-adherence`
- [ ] **7.3** Verifikasi lokal sejauh mungkin: `db/bootstrap.js` dan `db/migrate.js` jalan dari nol terhadap database kosong. **Batas jujur:** workflow ini tetap **tidak bisa dibuktikan hijau di GitHub** dari lingkungan ini — repo belum punya git remote (drift D5). Ini dilaporkan sebagai gap terbuka, bukan diklaim selesai
- [ ] **7.4** Commit

### Task 8 — Perbaiki dokumen yang menyatakan fase yang salah (keputusan Q5)

**Files**
- Modify: `CLAUDE.md` (§ "Status & fase saat ini"), `README.md` (baris status + section "Yang belum selesai")

Menutup drift D1. **Tidak** menyentuh `product/`, `research/`, atau `docs/superpowers/specs/`.

- [ ] **8.1** `CLAUDE.md`: ubah *"Fase: F0 — Fondasi. Belum ada kode aplikasi."* → status F1 berjalan; centang checklist gate F0 sesuai `HANDOFF.md`; tambahkan satu baris bahwa item OPFS (drift D4) memblokir F2, bukan F1
- [ ] **8.2** `README.md`: ubah *"Status: pra-produksi selesai · Fase berikutnya: F0 · Belum ada kode aplikasi"*; perbarui section "Yang belum selesai" yang masih menyebut test isolasi sebagai blocker F0 padahal sudah hijau
- [ ] **8.3** Tidak menyentuh angka atau klaim lain di kedua file — hanya pernyataan status yang terbukti salah
- [ ] **8.4** Commit terpisah dari kode

### Task 9 — Verifikasi akhir + update checklist

- [ ] **9.1** Jalankan berurutan dan tempel outputnya apa adanya: `npm run test:catalog` · `npm run test:server` · `npm run test:isolation` · `npm run test:sqlite-local` · `npm run test:oxlint-ds-adherence` · `npm run lint:ds` · `cd apps/server && npx tsc --noEmit`
- [ ] **9.2** Centang seluruh checkbox di plan ini sesuai yang benar-benar selesai
- [ ] **9.3** Laporkan gap yang tersisa apa adanya (minimal: workflow CI belum terbukti hijau di GitHub karena tidak ada remote)
- [ ] **9.4** Commit terakhir

---

## 6. Rencana test

| Task | Test yang ditulis **lebih dulu** | Membuktikan |
|---|---|---|
| 1 | `tests/catalog/infra.test.js` | `getTenantId` menolak header hilang/kosong/>64 char; `/health` tetap 200 tanpa `X-Tenant-Id` (bukti `getTenantId` bukan hook global) |
| 2 | `tests/catalog/categories.test.js` | FR-A4: rantai 3 tingkat ditolak `409 CATEGORY_DEPTH_EXCEEDED`, baik saat create maupun update. FR-A6: archive→restore, `includeArchived` |
| 3 | `tests/catalog/items.test.js` | FR-A1: item tanpa variation ditolak. FR-A2: variation tanpa nama → `'Regular'`. FR-A9: default `pcs`/`pcs`/`1`. § A.7: harga negatif ditolak, variation **ke-251** ditolak, barcode duplikat ditolak. `image_url` tidak ada di response |
| 4 | `tests/catalog/modifier-lists.test.js` | FR-A1: `Modifier` tanpa `sku`/`trackStock`; satu `ModifierList` dipakai banyak `Item`. FR-A6: tidak ada endpoint delete → AC "menghapus list yang dipakai ditolak" terpenuhi secara struktural |
| 5 | `tests/catalog/item-modifier-lists.test.js` | Attach idempoten (`ON CONFLICT` pada PK komposit); detach 204; 404 untuk item/list tidak ada |
| 6 | `tests/catalog/invariants.test.js` | Property "setiap Item ≥1 variation"; grep guard: tidak ada `DELETE FROM` tabel katalog, tidak ada `pool.query` langsung, tidak ada `image_url` |

Isolasi tenant **tidak** diuji ulang per-endpoint: sudah dibuktikan di lapisan bawah oleh `tests/isolation/` (189 test) dan `tests/server/tenant-transaction.test.js`. Yang diuji di sini adalah *setiap handler benar-benar lewat `withTenantTransaction`* — ditegakkan oleh grep guard Task 6, bukan duplikasi 28× test RLS.

---

## 7. Definition of Done

Semua perintah berikut harus hijau, dengan output ditempel apa adanya di laporan akhir:

```bash
npm run test:catalog
```
```bash
npm run test:server
```
```bash
npm run test:isolation
```
```bash
npm run test:sqlite-local
```
```bash
npm run test:oxlint-ds-adherence
```
```bash
npm run lint:ds
```
```bash
cd apps/server && npx tsc --noEmit
```

Plus kriteria yang tidak berbentuk perintah:

- [ ] 29 `operationId` di `openapi.yaml` semuanya punya handler — dijamin runtime oleh `assertAllOperationsImplemented`, yang melempar saat `buildApp()` kalau ada yang bolong
- [ ] `git grep -n "DELETE FROM" apps/server/src/modules/catalog` hanya menghasilkan `item_modifier_list`
- [ ] Checklist di plan ini tercentang sesuai kenyataan

- [ ] Workflow CI baru (`.github/workflows/test.yml`) ada dan menjalankan seluruh suite di atas PostgreSQL 17
- [ ] `CLAUDE.md` dan `README.md` tidak lagi menyatakan "Belum ada kode aplikasi"

**Tidak** termasuk DoD: `npm run test:dst` (masih `exit 1` by design, milik F2) dan `npm run db:migrate` sebagai perubahan skema (skema tidak berubah — `db:migrate` hanya dipanggil di CI untuk menyiapkan database dari nol).

Catatan jujur: `test:catalog`, `test:server`, dan `test:isolation` butuh PostgreSQL berjalan. Sudah diverifikasi jalan di lingkungan ini (`npm run test:server` 6/6 hijau, 1 Agu 2026). Workflow CI dari Task 7 **tidak bisa dibuktikan hijau di GitHub** dari sini karena repo belum punya git remote — gap ini dilaporkan terbuka, tidak diklaim selesai.

---

## 8. Pertanyaan terbuka, drift, dan risiko

### Keputusan user — 1 Agustus 2026 ✅

| # | Pertanyaan | Keputusan |
|---|---|---|
| **Q1** | Plan mana sumber kebenaran? | **(a)** Plan ini jadi checklist eksekusi; `2026-07-31-catalog-module.md` tetap di repo sebagai referensi isi kode. Tidak ada file dihapus |
| **Q2** | Batas 250 variation | **(a)** Application layer `COUNT(*) >= 250` (koreksi K1). CHECK `sort_order <= 250` dibiarkan sebagai jaring pengaman. **Nol migrasi** |
| **Q3** | Respons `attachModifierList` | **(a)** `attach` → `200` + `{itemId, modifierListId, sortOrder}` · `detach` → `204`. Design doc § 6 menyebut 204 untuk keduanya — deviasi ini disengaja dan disetujui |
| **Q4** | PostgreSQL di CI | **Ya, dikerjakan** — masuk sebagai **Task 7** |
| **Q5** | Perbaiki `CLAUDE.md` / `README.md` | **Ya, dikerjakan** — masuk sebagai **Task 8**, commit terpisah di akhir |

Pertanyaan asli beserta opsi yang tidak dipilih tetap tercatat di bawah, supaya alasan keputusannya bisa dilacak nanti.

### Pertanyaan yang butuh keputusan kamu (arsip — sudah dijawab)

**Q1 — Plan mana yang jadi sumber kebenaran?** [MEMBLOKIR]
Sudah ada `docs/superpowers/plans/2026-07-31-catalog-module.md` (2595 baris, lengkap, belum dieksekusi). Plan ini **tidak menggantikannya** melainkan membungkusnya: urutan langkah diubah jadi TDD ketat (plan lama menulis implementasi di Step 2 dan test di Step 4 — melanggar aturan Fase 4 kamu), ditambah tiga koreksi K1–K3 dan Task 6. Pilihan:
- **(a) Rekomendasi** — plan ini jadi checklist eksekusi; plan lama tetap di repo sebagai referensi isi kode per task. Tidak ada file yang dihapus.
- (b) Eksekusi plan lama apa adanya, koreksi K1–K3 diabaikan (artinya variation ke-251 lolos dan harga negatif diterima — saya tidak merekomendasikan ini).
- (c) Tulis ulang satu plan gabungan penuh 2600 baris, hapus yang lama.

**Q2 — Batas 250 variation: application layer atau migrasi?**
`db/migrations/0004_catalog.sql` punya `sort_order int NOT NULL DEFAULT 0 CHECK (sort_order <= 250)`. `sort_order` mulai dari 0, jadi CHECK baru menolak variation **ke-252**, sementara `spec-a-katalog.md` § A.7 menuntut yang **ke-251** ditolak. Off-by-one nyata.
- **(a) Rekomendasi** — tegakkan `COUNT(*) >= 250` di handler (K1), CHECK dibiarkan sebagai jaring pengaman. Nol migrasi, nol perubahan skema.
- (b) Ubah CHECK jadi `sort_order <= 249` lewat migrasi `0015`. Lebih "benar" secara deklaratif, tapi menyentuh skema yang gate F0-nya sudah ditutup dan diverifikasi 189 test — biaya tidak sebanding untuk batas kosmetik.

**Q3 — Konvensi respons `attachModifierList`: 200 + body, atau 204 kosong?**
`docs/superpowers/specs/2026-07-31-catalog-module-design.md` § 6 menulis *"`attach*`/`detach*` mengembalikan `204` tanpa body"*, tapi § "Global Constraints" plan lama menulis `attach*` → 200 + baris bridge. Ini konflik antara dua dokumen turunan. Saya **tidak boleh** mengubah design doc.
- **(a) Rekomendasi** — ikuti plan lama: `attach` → 200 + `{itemId, modifierListId, sortOrder}`, `detach` → 204. Klien butuh `sortOrder` hasil server tanpa GET tambahan.
- (b) Ikuti design doc: keduanya 204.

**Q4 — Test integrasi masuk CI atau tidak (sekarang)?**
`.github/workflows/lint-ds.yml` cuma menjalankan `lint:ds` + `tsc`. Seluruh test yang butuh PostgreSQL (`isolation`, `server`, `catalog`) **tidak pernah jalan di CI**, padahal `product/ARCH-lumi-pos-v1.md` § 9 menyebut test isolasi lintas-tenant sebagai *"Gate CI wajib"*. Menambahkan `services: postgres` + `db:bootstrap` + `db:migrate` ke workflow adalah pekerjaan ~1 task.
- **(a) Rekomendasi** — di luar scope milestone ini, jadi sub-project sendiri sesudahnya (mengubah scope yang sudah disepakati).
- (b) Tambahkan sebagai Task 8 di plan ini.

**Q5 — Boleh saya perbarui `CLAUDE.md`, `README.md`, `HANDOFF.md`?**
Ketiganya sekarang menyatakan hal yang tidak lagi benar (lihat drift D1). Ketiganya di luar folder terlarang, tapi juga di luar scope milestone. Rekomendasi: **ya, di akhir milestone, sebagai commit terpisah** — dokumen yang berbohong tentang fasenya sendiri akan menyesatkan sesi berikutnya.

### Drift yang ditemukan di fase audit

| # | Drift | Bukti | Dampak |
|---|---|---|---|
| **D1** | `CLAUDE.md` § "Status & fase" bilang *"Fase: F0 — Fondasi. **Belum ada kode aplikasi.**"* dengan seluruh gate F0 tidak tercentang; `README.md` bilang *"Belum ada kode aplikasi"* | Kenyataannya `apps/server`, `apps/kasir`, `packages/ds`, `packages/contracts`, 14 migrasi, dan 5 suite test sudah ada dan hijau. `HANDOFF.md` sudah benar | Menyesatkan; lihat Q5 |
| **D2** | `apps/server/src/modules/README.md` mencantumkan `stock_snapshot` sebagai milik `inventory`; `product/ARCH-lumi-pos-v1.md` § 3 tidak menyebutnya | `db/migrations/0010_inventory.sql` + `db/local/001-initial.sql` memang punya tabel itu (hasil `prototypes/01-sqlite-sizing/FINDINGS.md`) | Kode benar, ARCH tertinggal. ARCH terlarang diubah — **dilaporkan saja** |
| **D3** | ERD § 11 menyebut `subscription`, `usage_metric`, `support_session`; tidak ada di migrasi | Sengaja, terdokumentasi di `HANDOFF.md` ("tanpa daftar kolom … sengaja tidak dibuat di F0") | Tidak memblokir F1 |
| **D4** | `HANDOFF.md` punya item gate F0 *"SQLite WASM+OPFS berjalan di browser"* yang belum dikerjakan; item ini **tidak ada** di gate F0 versi `CLAUDE.md` maupun `ARCH` § 14 | — | Tidak memblokir milestone ini (murni server-side). Akan memblokir F2 |
| **D5** | Workflow `lint-ds` belum pernah benar-benar berjalan — repo tidak punya git remote | `git remote -v` kosong | Lihat Q4; butuh aksi manual user (push ke remote) |
| **D6** | Checkbox di 5 plan lama semuanya unchecked meski milestone-nya selesai | `grep -c '\[x\]'` = 0 di kelimanya | Status tidak bisa dibaca dari plan. Plan ini akan dicentang beneran (Task 7.2) |
| **D7** | Plan lama punya section *"Manual verification"* terduplikasi di bagian akhir file | baris 2592–2595 | Kosmetik |

### Risiko

| Risiko | Mitigasi |
|---|---|
| Test ke-251 variation lambat (250 request HTTP berurutan) | Diukur di Task 3. Kalau > 30 detik: dipisah ke file test sendiri, **tidak dihapus** — ini AC spec |
| Dua `createItemVariation` bersamaan untuk item yang sama bisa menghasilkan `sort_order` duplikat (tidak ada UNIQUE `(item_id, sort_order)`) | Kosmetik (urutan tampilan), tidak melanggar invariant mana pun. Diterima sadar, sama seperti catatan di plan lama. `SELECT … FOR UPDATE` pada baris `item` menutupnya kalau nanti diperlukan |
| Race yang sama juga berlaku pada `COUNT` batas 250 — dua request bersamaan bisa lolos jadi 251 | CHECK `sort_order <= 250` di DB tetap jadi jaring pengaman terakhir. Tidak ditambah locking untuk batas kosmetik |
| `X-Tenant-Id` dari header = **bukan** keamanan | Disengaja dan diberi komentar eksplisit di `tenant-context.ts`. RLS Postgres yang jadi pertahanan (invariant #8). Diganti modul `identity` di F3 |
| `translateConstraintError` memetakan **semua** `23514` ke `VARIATION_LIMIT_EXCEEDED` | Setelah K1, satu-satunya CHECK di tabel ini memang `sort_order`. Kalau CHECK lain ditambahkan nanti, pemetaan ini harus diperketat — dicatat di komentar kode |
| Menyentuh `openapi.yaml` di 5 task berbeda berisiko konflik/urutan | Setiap task menambah, tidak pernah mengubah, blok yang sudah ada; `assertAllOperationsImplemented` gagal keras kalau ada yang bolong |

---

## Yang saya minta darimu sekarang

Q1–Q5 sudah dijawab dan plan ini sudah disesuaikan (Task 7 dan Task 8 ditambahkan). Yang tersisa: **approval eksplisit untuk mulai implementasi**.

Begitu disetujui, langkah pertama adalah Task 1.1 — menulis `tests/catalog/infra.test.js` yang gagal, sebelum satu baris kode produksi pun ditulis.
