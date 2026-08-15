# PLAN — Katalog UI (B-08 Kategori, B-06 Produk, B-07 Edit Produk)

**Branch:** `f6-katalog-ui` (bertumpu pada `f5-onboarding` selama PR #18 belum di-merge)

Backend sudah lengkap — 28 operasi REST atas `category`, `item`/`item_variation`,
`modifier_list`/`modifier`, `item_modifier_list`. Yang dibangun di sini konsumennya.

Ini "hari biasa merchant": impor katalog (B-11) menutup hari PERTAMA, tapi menaikkan
harga satu produk, menonaktifkan menu yang habis, dan menambah varian baru adalah
pekerjaan mingguan yang belum punya layar sama sekali.

---

## ⛔ Aturan produk yang WAJIB terlihat di layar, bukan disembunyikan

### 1. `item_variation.price` BEKU setelah variation dibuat

`updateItemVariation` **tidak menerima `price`**, dan itu permanen, bukan penundaan
(`CLAUDE.md` § keputusan katalog). Harga awal adalah anak tangga paling bawah
resolusi; setiap perubahan lewat `price_history` (B-10).

Layar B-07 karena itu **tidak boleh** menampilkan field harga yang dapat disunting
untuk variation yang sudah ada. Field yang terlihat dapat diketik lalu diam-diam
tidak terkirim adalah kebohongan antarmuka. Yang ditampilkan: harga awal sebagai
**teks**, dengan jalan menuju B-10.

### 2. Kategori maksimal DUA tingkat

Tingkat ketiga dijawab `409` server. Layar harus menolak lebih dulu **dan**
menjelaskan — pemilih induk tidak boleh menawarkan kategori yang sudah punya induk.

### 3. Katalog tidak pernah di-`DELETE` (invariant #2)

Hanya `archived_at`. Layar menyebutnya "Arsipkan", bukan "Hapus", dan yang terarsip
tetap dapat dilihat serta dipulihkan.

### 4. Kuota produk (`max_products`) ditegakkan server

Penolakan membawa angkanya. Layar meneruskan pesan server apa adanya.

---

## Sub-project 1 — B-08 Kategori

- [ ] `katalog/pohon.ts` — murni: daftar datar → pohon dua tingkat; validasi induk
- [ ] `katalog/Kategori.tsx` — daftar bertingkat, tambah, ubah nama/induk/urutan, arsip/pulihkan
- [ ] `navigasi.ts` — `LAYAR_SIAP += 'B-08'`
- [ ] Test: `tests/backoffice/pohon-kategori.test.js`

## Sub-project 2 — B-06 Produk (daftar)

- [ ] Daftar item + filter kategori + toggle terarsip
- [ ] Tambah produk → membuka B-07
- [ ] Test: penyusunan daftar (murni)

## Sub-project 3 — B-07 Edit Produk + Variation

- [ ] Sunting item (nama, kategori, deskripsi, urutan)
- [ ] Variation: tambah, ubah nama/SKU/barcode/unit, arsip/pulihkan
- [ ] ⛔ Harga variation **tidak dapat disunting** — teks, bukan field
- [ ] Modifier list: attach/detach
- [ ] Test: muatan variation (murni), termasuk `conversionFactor` ×1000

## Sub-project 4 — bukti

- [ ] Dijalankan di browser terhadap server sungguhan
- [ ] Seluruh suite + typecheck + lint:ds

---

## Batas yang dinyatakan

- **Modifier (B-09) tidak dibangun di branch ini.** B-07 hanya MENGAITKAN
  modifier list yang sudah ada; membuat dan menyunting isinya adalah layar
  tersendiri di `IA:§3.3`.
- **Harga (B-10) tidak dibangun di branch ini.** B-07 menunjuk ke sana.
