# PLAN — B-10 Harga & Riwayat, B-09 Modifier

**Branch:** `f6-produk-pelengkap`, berakar dari `main` (aturan baru: tidak ada chained branch)

B-07 membekukan harga varian dan menunjuk ke B-10. Sampai B-10 ada, tunjukan itu mengarah ke layar yang tidak ada — **satu-satunya jalan mengubah harga adalah lewat API langsung.**

---

## ⛔ Aturan yang mengikat B-10

### 1. "Berlaku sekarang" MENGHILANGKAN `effectiveFrom`, tidak mengirim jam browser

`createPrice` menulis `COALESCE($6, now())` — jam **PostgreSQL**. Mengirim
`new Date().toISOString()` dari browser memperkenalkan **jam ketiga**.

`CLAUDE.md` mencatat pengukurannya: skew **±2 ms** antara jam Node dan jam
PostgreSQL sudah cukup menggagalkan 4 dari 12 run test, karena harga yang baru
ditulis dianggap belum berlaku dan resolusi diam-diam jatuh ke anak tangga di
bawahnya. Jam browser merchant dapat meleset **menit**.

Akibatnya bila dilanggar: merchant menaikkan harga, layar berkata tersimpan,
dan kasir tetap menagih harga lama — tanpa satu pun error di mana pun.

### 2. Harga terjadwal masa depan DIIZINKAN

`effective_from` boleh di masa depan; resolusi `effective_from <= at` yang
menentukan kapan ia berlaku. Baris terjadwal karena itu **tidak boleh**
ditampilkan seolah sedang berlaku.

### 3. Anak tangga yang dipakai WAJIB terlihat

`getResolvedPrice` mengembalikan `source`: `outlet` · `tenant` · `variation`.
Kontraknya menyebut alasannya — *"diagnosabilitas di lapangan tanpa membaca
database langsung"*. Menyembunyikannya membuat "kenapa harganya segini" hanya
dapat dijawab lewat SQL.

### 4. Status di tabel riwayat adalah PENAFSIRAN KLIEN, bukan kebenaran

Ia dihitung dari jam browser. Yang otoritatif adalah `getResolvedPrice` (jam
database). Layar harus menyatakan perbedaan itu, bukan mengaburkannya.

---

## Sub-project 1 — B-10 Harga & Riwayat

- [ ] `katalog/harga.ts` — murni: muatan `createPrice`, ringkasan status riwayat
- [ ] `katalog/Harga.tsx` — pilih produk/varian, harga terselesaikan + anak tangga, riwayat, form
- [ ] `navigasi.ts` — `LAYAR_SIAP += 'B-10'`
- [ ] Test: `tests/backoffice/harga.test.js`

## Sub-project 2 — B-09 Modifier

- [ ] CRUD modifier list + modifier
- [ ] Kaitkan/lepas dari item (`attachModifierList` / `detachModifierList`)
- [ ] `navigasi.ts` — `LAYAR_SIAP += 'B-09'`

## Sub-project 3 — bukti

- [ ] Dijalankan di browser terhadap server sungguhan
- [ ] Seluruh suite + typecheck + lint:ds
