# PLAN — kolom `id` untuk `item_modifier_list`

**Status:** SELESAI 7 Agustus 2026 — disetujui user, dikerjakan, seluruh suite hijau
**Keputusan yang mendasari:** user, 7 Agustus 2026 — lihat `prototypes/04-powersync-raw-tables/FINDINGS.md` §5
**Modul:** `catalog` · **Fase:** F2 (prasyarat jalur turun)

---

## 1. Kenapa ini dikerjakan

PowerSync menolak raw table tanpa kolom bernama `id`:

```
Table item_modifier_list has no id column.
```

Bukan konvensi kami — ekstensi core yang menolaknya (`InferredTableStructure::read_from_database`), dan diukur di prototipe 04 T1g. PK tabel ini komposit `(item_id, modifier_list_id)`.

`item_modifier_list` adalah katalog: ia **harus** turun ke perangkat. Tanpa kolom `id`, relasi item↔modifier tidak dapat direplikasi sama sekali, dan kasir tidak akan melihat modifier apa pun pada item.

**Ini satu-satunya alasannya.** Tidak ada keluhan tentang PK komposit dari sisi produk, dan API-nya tidak berubah bentuk.

---

## 2. Bahaya utama — dan yang menjaganya

Memindahkan PK dari `(item_id, modifier_list_id)` ke `id` **menghapus jaminan** bahwa satu item tidak bisa menunjuk modifier list yang sama dua kali. Tanpa penggantinya, kita menukar satu masalah PowerSync dengan satu cacat data: satu item dengan dua baris "Tingkat gula" yang sama, dan kasir melihat daftar modifier ganda.

**`UNIQUE (item_id, modifier_list_id)` karena itu wajib, bukan pelengkap.** Ia juga yang membuat `ON CONFLICT (item_id, modifier_list_id) DO UPDATE` di handler tetap valid — tanpanya PostgreSQL menolak klausa itu, dan attach ulang untuk mengubah `sortOrder` patah.

Uji sabotase (T7) ada khusus untuk membuktikan constraint itulah yang menahan, bukan kebetulan.

---

## 3. Dua hal yang perlu kamu putuskan sebelum saya mulai

### 3.1 `id` di-generate SERVER, bukan klien — menyimpang dari konvensi

`CLAUDE.md` menetapkan **"ID ULID/UUIDv7 di-generate klien. Auto-increment mustahil untuk penulisan offline."**

Alasan konvensi itu adalah penulisan offline. `item_modifier_list` **tidak pernah ditulis offline**: ia katalog, dikelola lewat REST admin yang online-only, dan turun ke perangkat sebagai data baca. Endpoint-nya pun tidak menerima id — ia di-key oleh pasangan `(itemId, modifierListId)` di URL.

**Usulan: server men-generate `randomUUID()`,** pola yang sudah dipakai `ordering` dan `payment` untuk baris yang lahir di server. Tidak ada abstraksi baru.

**Kalau kamu lebih suka klien yang mengirim id,** bentuk endpoint ikut berubah (body wajib berisi `id`, dan attach jadi tidak lagi idempoten dengan cara yang sama). Katakan sekarang — mengubahnya setelah implementasi berarti membongkar test.

### 3.2 Apakah `id` muncul di respons REST?

Respons `attachModifierList` sekarang `{itemId, modifierListId, sortOrder}`.

**Usulan: tambahkan `id`.** Menambah field ke respons aman untuk klien N-1 (DoD: kompatibilitas N-1). Perangkat mendapat baris ini lewat PowerSync, bukan REST, jadi ini murni supaya admin dapat merujuk barisnya.

Kalau kamu tidak mau permukaan API bertambah sama sekali, `id` tetap ada di database dan tetap turun lewat PowerSync — respons REST-nya saja yang tidak berubah. Keduanya berfungsi.

---

## 4. Yang TIDAK dikerjakan

- **`product/ERD-lumi-pos-v1.md`** menyimpan bentuk lama. Dokumen produk bukan kewenangan agent — **kamu yang menyunting**, dan saya akan menandainya di HANDOFF sebagai utang terbuka sampai kamu lakukan.
- **`prototypes/01-sqlite-sizing/schema.sql`** memakai bentuk lama. Ia catatan pengukuran yang sudah dijalankan; mengubahnya membuat angkanya tidak lagi menggambarkan apa yang diukur. Dibiarkan.
- **`stock_snapshot` tetap tanpa `id`.** Ia cache lokal hasil agregasi `stock_movement`, tidak pernah naik maupun turun, jadi PowerSync tidak perlu mengenalnya.
- **Jalur turun tidak dijalankan di sini.** Rencana ini membuat tabelnya *layak* jadi raw table; membuktikan sinkronisasi benar-benar menulis ke sana adalah pekerjaan terpisah.

---

## 5. Task — TDD, test gagal dulu

### T1 — Migrasi `0018_item_modifier_list_id.sql`

Test lebih dulu di `tests/schema/item-modifier-list.test.js`: kolom `id` ada, NOT NULL, dan merupakan primary key; constraint unik atas `(item_id, modifier_list_id)` ada.

Bentuk migrasinya (expand-contract, `SET LOCAL lock_timeout = '5s'` seperti `0016`/`0017`):

```sql
ALTER TABLE item_modifier_list ADD COLUMN id text;
UPDATE item_modifier_list SET id = gen_random_uuid()::text WHERE id IS NULL;
ALTER TABLE item_modifier_list ALTER COLUMN id SET NOT NULL;
ALTER TABLE item_modifier_list
  ADD CONSTRAINT ux_item_modifier_list_pair UNIQUE (item_id, modifier_list_id);
ALTER TABLE item_modifier_list DROP CONSTRAINT item_modifier_list_pkey;
ALTER TABLE item_modifier_list ADD CONSTRAINT item_modifier_list_pkey PRIMARY KEY (id);
```

**Catatan kunci yang harus masuk komentar migrasi:** `CREATE INDEX CONCURRENTLY` **tidak mungkin** di sini — `db/migrate.js` membungkus setiap berkas dalam `BEGIN`/`COMMIT`, dan `CONCURRENTLY` dilarang di dalam transaksi. Table lock diterima secara sadar karena tabel ini kecil (beberapa baris per item, bukan per transaksi) dan tumbuh dengan ukuran katalog, bukan dengan volume penjualan. `lock_timeout` yang menjaga agar migrasi gagal cepat alih-alih memblokir kasir.

### T2 — `db/local/001-initial.sql` menyusul

Test di `tests/sqlite-local/schema.test.js`: `item_modifier_list` punya kolom `id` sebagai PK, dan index unik atas pasangan lama.

Tidak ada mekanisme migrasi lokal dan belum ada perangkat terpasang, jadi berkas awal disunting langsung — bukan migrasi `002`.

### T3 — Handler menulis `id`

`attachModifierList` men-generate `randomUUID()` dan memasukkannya; `ON CONFLICT` tetap atas pasangan, `RETURNING` menyertakan `id`.

Test yang harus gagal dulu: attach mengembalikan `id` berbentuk UUID; **attach ulang atas pasangan yang sama mengembalikan `id` yang SAMA** dan tetap hanya satu baris — `DO UPDATE` tidak boleh menerbitkan id baru, karena baris yang sudah tersinkron ke perangkat akan terlihat sebagai baris berbeda.

`detachModifierList` tidak berubah: ia `DELETE ... WHERE` yang sudah tunduk RLS, dan alasannya sudah tertulis panjang di handler.

### T4 — OpenAPI

Tambahkan `id` ke skema respons `attachModifierList` (bila 3.2 disetujui). `fastify-openapi-glue` membuang field yang tidak dideklarasikan — pelajaran dari Modul C; kalau skema tidak diperbarui, `id` hilang diam-diam dari respons meski handler mengembalikannya.

### T5 — Helper isolasi

`tests/isolation/helpers/tables.js` menyimpan penanganan khusus untuk tabel ini ("bridge table has no surrogate id"). Dengan `id` ada, `whereForRow` dan `buildImpersonationRow` dapat memakai jalur generik.

**Hati-hati:** fixture `item2` di `seed.js` dicadangkan khusus untuk uji impersonasi tabel ini. Kalau penanganan khususnya dihapus, komentar di `seed.js` jadi menyesatkan dan `item2` mungkin tak terpakai. Diperiksa, bukan diasumsikan — 189 test isolasi harus tetap 189 dan tetap hijau.

### T6 — Prototipe 04 menyusul

`item_modifier_list` naik dari `TABEL_TANPA_ID` ke `TABEL_RAW` di `src/skema.js`. T1g kehilangan subjeknya dan **harus diarahkan ke `stock_snapshot`** — bukan dihapus. Uji itu yang menjaga agar syarat "raw table wajib punya `id`" tetap terbukti, bukan sekadar diingat.

Dijalankan ulang di browser; hasilnya masuk FINDINGS.

### T7 — Sabotase: buktikan constraint uniknya yang menahan

Nonaktifkan `ux_item_modifier_list_pair`, jalankan attach dua kali dengan `ON CONFLICT` dilepas, dan pastikan baris ganda **benar-benar tersimpan**. Kalau tidak — constraint itu tidak menahan apa pun dan T1 hijau tanpa alasan.

Ini pola yang sama dengan lima kali sebelumnya di `CLAUDE.md`: guard yang tidak dapat dibedakan dari luar adalah guard yang tidak teruji.

---

## 6. Verifikasi sebelum menyatakan selesai

- [x] `npm run db:migrate` bersih di database kosong **dan** di database yang sudah berisi baris `item_modifier_list` (backfill benar-benar diuji, bukan hanya jalur baru)
- [x] `npm run test:schema` · `test:sqlite-local` · `test:catalog` · `test:isolation` (189) · `test:ordering` · `test:payment` · `test:server` · `test:domain` · `test:dst` · `test:dst-server`
- [x] `npm run typecheck` · `npm run lint:ds`
- [x] Prototipe 04 dijalankan ulang di browser, semua uji lulus
- [x] Output sebenarnya ditempel, bukan diklaim

---

## 7. Checklist

- [x] T1 migrasi `0018` + test skema
- [x] T2 skema SQLite lokal + test
- [x] T3 handler + test idempotensi id
- [x] T4 OpenAPI
- [x] T5 helper isolasi
- [x] T6 prototipe 04 + FINDINGS
- [x] T7 sabotase constraint unik
- [x] HANDOFF: tandai utang ERD sebagai terbuka

---

## 8. Catatan pelaksanaan — tiga hal yang tidak ada di rencana

**Backfill `UPDATE` tertahan RLS.** Bentuk migrasi yang direncanakan (`ADD COLUMN` nullable → `UPDATE` → `SET NOT NULL`) gagal: `unrecognized configuration parameter "app.tenant_id"`. `FORCE ROW LEVEL SECURITY` berlaku untuk pemilik tabel juga — invariant #8 bekerja persis seperti seharusnya. Yang berbahaya bukan kegagalannya melainkan perbaikan yang menggoda: `SET LOCAL app.tenant_id = '<sesuatu>'` membuat migrasi BERHASIL sambil hanya mengisi baris satu tenant, dan di database pengembangan yang cuma punya satu tenant itu tidak akan pernah ketahuan. Jalan keluarnya DDL — `ADD COLUMN ... DEFAULT gen_random_uuid()::text` dievaluasi per baris dan tidak tunduk RLS. Diuji dulu sebelum ditulis.

**SQLite menerima NULL di kolom `PRIMARY KEY`.** Ditangkap test T2, bukan review. `id TEXT PRIMARY KEY` tidak setara dengan PostgreSQL; `NOT NULL` harus eksplisit. ~15 tabel lain di skema lokal punya bentuk yang sama dan belum diperbaiki — diangkat di `HANDOFF.md`, di luar scope rencana ini.

**Penanganan khusus helper isolasi TIDAK jadi dihapus seluruhnya.** Rencana menduga ia bisa kembali ke jalur generik. Yang benar: `whereForRow` bisa, `buildImpersonationRow` tidak — baris kloningan membawa pasangan yang sama, dan pasangan itu kini dijaga constraint unik. Diuji langsung: pada PostgreSQL 17 kebijakan RLS menolak lebih dulu, jadi jalur generik pun tidak membuat test hampa **hari ini** — tapi urutan itu bukan jaminan yang didokumentasikan, jadi `item2` dipertahankan agar RLS satu-satunya yang mungkin menolak.
