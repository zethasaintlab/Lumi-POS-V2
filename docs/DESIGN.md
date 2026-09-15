# Design system LumiPOS

**Dokumen ini diturunkan dari kode, bukan dari ingatan.** Setiap nilai di bawah
dibaca langsung dari berkas token di repo ini pada commit yang disebut, dan
setiap angka dapat ditelusuri ke satu baris berkas. Nilai yang tidak ada di
berkas mana pun tidak ditulis nilainya — ia dinyatakan sebagai belum
terdefinisi.

| | |
|---|---|
| Commit | `4dbe377df8a4790c82b519ed666cb8419497b7ea` (`4dbe377`) |
| Branch | `perbaikan-ui-pasca-uji-manual` |
| Tanggal | 15 September 2026 |

## Berkas sumber

| Berkas | Token terdeklarasi |
|---|---:|
| `ds-bundle/tokens/colors.css` | 28 |
| `ds-bundle/tokens/typography.css` | 14 |
| `ds-bundle/tokens/spacing.css` | 11 |
| `ds-bundle/tokens/effects.css` | 2 |
| `ds-bundle/tokens/fonts.css` | 0 — hanya satu `@import` Google Fonts |
| `packages/ds/lumi.css` | 14 |
| **Total unik** | **69** |

⛔ **`ds-bundle/` adalah artefak vendor dan tidak pernah disunting langsung.**
Aturan ini ditegakkan `tests/runtime/ds-bundle-vendor.test.js`, yang
membandingkan isi direktori itu dengan basis upstream. Setiap perubahan milik
kita hidup di `packages/ds/lumi.css`, yang diimpor paling akhir supaya
kekhususan yang sama menang.

⛔ **Lapisan override tidak mendefinisikan ulang satu pun token bundle.**
Diperiksa: dari 69 token unik, nol bertabrakan nama antara `ds-bundle/tokens/`
dan `packages/ds/lumi.css`. Aturan "override menang" karena itu belum pernah
terpakai — `packages/ds/lumi.css` hanya menambah token yang bundle tidak
punya. Komentar di berkas itu menyatakan alasannya: menyalin nilai inti ke sana
menciptakan tempat kedua yang memutuskan hal yang sama.

---

## 1. Konteks produk dan tiga aplikasi

LumiPOS adalah point-of-sale untuk kafe takeaway 2–20 outlet di Indonesia.
Bahasa antarmuka Indonesia; istilah teknis tetap Inggris.

Repo ini berisi **empat** direktori di bawah `apps/`, tiga di antaranya
antarmuka:

| Direktori | Judul di `index.html` | Postur pengguna |
|---|---|---|
| `apps/kasir` | `Lumi POS — Kasir` | Berdiri, satu tangan, tangan sering basah, menatap layar dari ~50 cm sambil melihat pelanggan. Offline-first: seluruh alur penjualan berjalan tanpa jaringan |
| `apps/backoffice` | `Lumi POS — Back Office` | Duduk, mouse dan keyboard, layar lebar. Online-only |
| `apps/hp` | `Lumi POS — Owner` | Owner, layar 390px, sering satu pertanyaan saja pada jam tutup. Online-only |
| `apps/server` | — | Fastify, tanpa antarmuka |

⛔ **Catatan penelusuran.** Task yang meminta dokumen ini menyebut aplikasi
ketiga sebagai "Lumi-Order". Nama itu **tidak muncul di satu pun berkas repo
ini** — dicari di `apps/`, `packages/`, `product/`, dan `docs/`. Aplikasi ketiga
yang ada adalah `apps/hp`, berjudul `Lumi POS — Owner`, dan `CLAUDE.md` § G2
menyebutnya "Owner mobile" dengan empat layar M-00…M-03. Yang ditulis di tabel
di atas adalah yang terbaca dari berkas.

**Keputusan produk** (tidak terbaca dari token): postur pengguna kasir itulah
yang memaksa target sentuh 56px untuk aksi menyangkut uang, dan memaksa angka
uang memakai tabular numerals. Alasannya ditulis di `ds-bundle/tokens/spacing.css`
dan `ds-bundle/tokens/fonts.css` sebagai komentar, bukan sebagai nilai.

---

## 2. Tipografi

Sumber: `ds-bundle/tokens/typography.css`, `ds-bundle/tokens/fonts.css`,
`packages/ds/lumi.css`.

### Keluarga font

```css
--font-sans: 'Inter', system-ui, -apple-system, sans-serif;
```

Dimuat lewat `@import` Google Fonts di `ds-bundle/tokens/fonts.css`, bobot
`400;500;600` saja. Komentar di berkas itu menyatakan alasannya: Inter dipilih
karena tabular numerals — di POS angka tersusun dalam kolom dan font
proporsional membuat kolom bergoyang.

⛔ **Keputusan produk yang tidak terbaca dari token:** `CLAUDE.md` gate F0
mencatat Inter **di-self-host** untuk menggantikan `@import` Google Fonts. Baris
`@import` di `ds-bundle/tokens/fonts.css` masih ada karena berkas itu artefak
vendor dan tidak dapat disunting. Yang benar-benar dimuat aplikasi tidak dapat
diputuskan dari berkas token saja.

### Ukuran — tujuh terdeklarasi, lima yang sah

| Token | Nilai di berkas | px pada `--scale: 1` | Status |
|---|---|---:|---|
| `--text-hero` | `calc(40px * var(--scale))` | 40 | **orphan, dilarang** |
| `--text-heading` | `calc(28px * var(--scale))` | 28 | **orphan, dilarang** |
| `--text-display` | `calc(32px * var(--scale))` | 32 | inti |
| `--text-title-lg` | `calc(24px * var(--scale))` | 24 | khusus → `--t-metric` |
| `--text-title` | `calc(20px * var(--scale))` | 20 | inti |
| `--text-body` | `calc(15px * var(--scale))` | 15 | inti |
| `--text-caption` | `calc(12px * var(--scale))` | 12 | inti |

⛔ **Yang orphan tidak dihapus, dan itu disengaja.** Keduanya hidup di
`ds-bundle/tokens/typography.css` — vendor, tidak dapat disunting. Larangan
adalah satu-satunya penegakan yang tersedia, dan ia dipasang di
`tools/oxlint-plugins/ds-adherence.mjs` (menolak kelas `t-hero`/`t-heading`/
`t-title-lg` yang ditulis sendiri di `apps/` dan `packages/`) serta di
`tests/runtime/token-css-ada.test.js`.

**Keputusan produk:** skala lima token adalah keputusan user 31 Agustus 2026
("Opsi A"), tercatat di `CLAUDE.md` § Skala teks final. Ia tidak dapat dibaca
dari berkas token — berkasnya mendeklarasikan tujuh.

### Token khusus

```css
--t-metric: var(--text-title-lg);
```

Didefinisikan di `packages/ds/lumi.css`. Cakupannya diikat di berkas yang sama:

```css
.stat .t-title-lg { font-size: var(--t-metric); }
```

⛔ Nilainya `var(--text-title-lg)`, bukan `24px` yang diketik ulang. Angka yang
disalin menyimpang dari bundle diam-diam.

### Bobot

| Token | Nilai | Catatan di berkas |
|---|---:|---|
| `--weight-regular` | `400` | — |
| `--weight-medium` | `500` | — |
| `--weight-bold` | `600` | *"hanya untuk `--text-display`"* |

### Leading

| Token | Nilai |
|---|---:|
| `--leading-tight` | `1.2` |
| `--leading-body` | `1.5` |

### Cara `--scale` bekerja

`--scale` dideklarasikan **dua kali** di `ds-bundle/tokens/typography.css`:

```css
:root      { --scale: 1;   }
.kds-scale { --scale: 1.6; }
```

Ketujuh token ukuran adalah `calc(<px> * var(--scale))`, jadi satu variabel
memperbesar seluruh skala sekaligus. Komentar di berkas menyebut hasilnya untuk
KDS: display → 51px, title → 32px.

⛔ **`.kds-scale` muncul 0× di `apps/` dan `packages/`.** KDS ada di daftar
"jangan bangun" v1.1+ (`CLAUDE.md` § Jangan bangun ini). Mekanismenya siap; ia
belum punya layar.

### Kelas tipografi

`ds-bundle/tokens/typography.css` mendefinisikan `.t-hero`, `.t-heading`,
`.t-title-lg`, `.t-display`, `.t-title`, `.t-body`, `.t-body-md`, `.t-caption`.
Terukur di `apps/` + `packages/`:

| Kelas | Kemunculan |
|---|---:|
| `.t-caption` | 346 |
| `.t-body` | 201 |
| `.t-title` | 68 |
| `.t-display` | 12 |
| `.t-title-lg` | 5 |
| `.t-hero` | 0 |
| `.t-heading` | 0 |

---

## 3. Warna

Sumber: `ds-bundle/tokens/colors.css` (28) dan `packages/ds/lumi.css` (14).

Nada palet **hangat**. Komentar di `ds-bundle/tokens/colors.css` menyatakan
alasannya sebagai keputusan produk: *"Abu netral murni terasa dingin & klinis
untuk kafe; sedikit kehangatan agar layar tidak terasa seperti software rumah
sakit."*

### Aksen — satu, dan hanya satu

| Token | Nilai |
|---|---|
| `--accent` | `#0D5C63` |
| `--accent-hover` | `#0A4A50` |
| `--accent-soft` | `#E6F2F2` |
| `--accent-border` | `#9CC9CB` |
| `--on-accent` | `#FFFFFF` |

**Keputusan produk** (komentar di berkas): deep teal dipilih karena bertahan
terhadap glare layar counter yang kena matahari, tidak bentrok dengan semantik
hijau/merah, dan tidak dipakai kompetitor Indonesia. Kuota < 5% area, satu aksi
utama per layar.

### Semantik — hanya untuk status, tidak pernah dekoratif

| Token | Nilai | Catatan di berkas |
|---|---|---|
| `--success` | `#137535` | *"digelapkan dari #15803D: badge 12px butuh 4.5:1"* |
| `--success-soft` | `#E8F5EC` | — |
| `--success-border` | `#B6DCC3` | — |
| `--danger` | `#B91C1C` | — |
| `--danger-soft` | `#FDEAEA` | — |
| `--danger-border` | `#EFB4B4` | — |
| `--warning` | `#B45309` | — |
| `--warning-soft` | `#FDF3E7` | — |
| `--warning-border` | `#E8C79B` | — |

### Warna modul

| Token | Nilai | Catatan di berkas |
|---|---|---|
| `--info` | `#1D4ED8` | *"biru — informasi, swap shift"* |
| `--info-soft` | `#EAF0FD` | — |
| `--info-border` | `#BCD0F5` | — |
| `--violet` | `#6D5AE0` | *"modul reservasi"* |
| `--violet-soft` | `#EFEDFB` | — |
| `--violet-border` | `#CFC8F2` | — |

Komentar di berkas membatasi keduanya: *"Dipakai HANYA untuk identitas modul &
kartu statistik, tidak untuk aksi utama (aksi utama tetap teal)."*

### Netral hangat

| Token | Nilai | Kontras yang tercatat di berkas |
|---|---|---|
| `--ink` | `#14110F` | 18,8:1 putih · 16,3:1 alt — AAA |
| `--ink-muted` | `#5C5450` | 7,4:1 putih · 6,4:1 alt — AAA |
| `--ink-subtle` | `#6E6560` | 5,7:1 putih · 4,9:1 alt — AA |

### Permukaan dan pembatas

| Token | Nilai | Peran menurut komentar |
|---|---|---|
| `--surface` | `#FFFFFF` | kartu, panel |
| `--surface-sunk` | `#F7F5F3` | latar halaman |
| `--surface-alt` | `#F0EDEA` | baris zebra, disabled |
| `--border` | `#E2DDD8` | — |
| `--border-strong` | `#C9C2BB` | — |

Kepala berkas menyatakan metodenya: *"kontras dihitung ulang & diverifikasi,
bukan diperkirakan. Kasus TERBURUK yang diuji: di atas `--surface-alt`
(#F0EDEA / baris zebra), bukan di atas putih. 8 dari 8 pasangan lolos WCAG AA."*

### Latar gelap dialog

| Token | Nilai | Berkas |
|---|---|---|
| `--overlay` | `rgba(20, 17, 15, .45)` | `packages/ds/lumi.css` |

Komentar di berkas mencatat sejarahnya: `--overlay` dipakai
`apps/kasir/src/kasir.css` sejak F2 dan tidak pernah terdefinisi di mana pun,
sehingga `background: var(--overlay)` dibuang seluruhnya oleh browser dan
dialog kasir melayang di atas layar yang masih terlihat penuh.

### Warna kategori produk

Enam slot, masing-masing sepasang. Semuanya di `packages/ds/lumi.css`.

| Slot | Nama di komentar | Padat | Soft |
|---|---|---|---|
| 1 | teal tua | `#0F766E` | `#E4F1F0` |
| 2 | terakota | `#9A3412` | `#FBEDE6` |
| 3 | indigo | `#3730A3` | `#ECEBF7` |
| 4 | plum | `#7C2D5E` | `#F8EAF2` |
| 5 | olive | `#4D5B16` | `#F0F3E2` |
| 6 | biru laut | `#1E4E79` | `#E7EFF6` |

⛔ **Ini pengkodean DATA, bukan status.** Komentar di berkas menyatakan
alasannya: hijau dan merah sudah punya arti di produk ini (stok aman, stok
minus, selisih kas), jadi kategori "Makanan" yang mendarat di hijau akan
terbaca sebagai penilaian, bukan sebagai kelompok.

Konsumennya `packages/domain/src/warna-kategori.ts:82-83`, yang menyusun
namanya lewat template literal:

```ts
'--chip':      `var(--kat-${slot})`,
'--chip-soft': `var(--kat-${slot}-soft)`,
```

⛔ **`--chip` dan `--chip-soft` BELUM TERDEFINISI di berkas token mana pun.**
Keduanya disuntikkan sebagai style inline oleh `gayaKategori`, dan setiap
pembacaan di CSS memakai fallback (`var(--chip, var(--ink-muted))`). Nilainya
karena itu tidak dapat disebutkan di dokumen ini — ia ditentukan saat render.

---

## 4. Bentuk, spasi, elevasi, target sentuh

Sumber: `ds-bundle/tokens/spacing.css` (11) dan `ds-bundle/tokens/effects.css` (2).

### Spasi — basis 4px

| Token | Nilai |
|---|---:|
| `--space-1` | `4px` |
| `--space-2` | `8px` |
| `--space-3` | `12px` |
| `--space-4` | `16px` |
| `--space-6` | `24px` |
| `--space-8` | `32px` |
| `--space-12` | `48px` |

Tidak ada `--space-5`, `--space-7`, `--space-9`…`--space-11`. Penomorannya
mengikuti kelipatan 4px, bukan urutan.

Terukur di `apps/` + `packages/` + `ds-bundle/`:

| Token | `var()` |
|---|---:|
| `--space-2` | 169 |
| `--space-4` | 130 |
| `--space-3` | 124 |
| `--space-1` | 71 |
| `--space-6` | 14 |
| `--space-8` | 3 |
| `--space-12` | 1 |

### Radius

| Token | Nilai | Peran menurut komentar |
|---|---:|---|
| `--radius-control` | `8px` | tombol, input |
| `--radius-card` | `12px` | kartu, panel |

Tidak ada token radius pill. Empat tempat di `ds-bundle/components.css` memakai
`999px` sebagai angka harfiah — `.badge` (baris 62), `.switch .track` (77),
`.sync` (114), `.chip` (153); berkas itu vendor dan tidak dapat disunting.

### Elevasi

| Token | Nilai |
|---|---|
| `--shadow-card` | `0 1px 2px rgba(20, 17, 15, 0.05)` |
| `--shadow-sheet` | `0 -4px 24px rgba(20, 17, 15, 0.12)` |

Kepala `ds-bundle/tokens/effects.css` menyatakan keputusan produknya:
*"Kafe terang; bayangan tebal hilang di bawah glare dan hanya menambah noise.
Kartu dibedakan oleh border, bukan bayangan."*

### Target sentuh

| Token | Nilai | Alasan menurut komentar |
|---|---:|---|
| `--touch-min` | `44px` | minimum absolut (WCAG 2.5.5 / Apple HIG) |
| `--touch-critical` | `56px` | aksi yang menyangkut uang (Bayar, Tutup Kas, konfirmasi void) |

`packages/ds/lumi.css` menaikkan dua target yang bundle kirim di bawah 44px:
`.shell-link` (dari 40px) dan tombol tutup dialog (dari 36px inline). Yang
kedua memakai satu-satunya `!important` di berkas itu, dengan alasan yang
dinyatakan di tempatnya: style inline mengalahkan stylesheet apa pun.

---

## 5. Aturan yang sudah ditegakkan test

Setiap baris di bawah adalah aturan yang punya berkas test, bukan konvensi
yang diandalkan pada disiplin.

| Aturan | Berkas test |
|---|---|
| Setiap `var(--token)` tanpa fallback punya definisinya | `tests/runtime/token-css-ada.test.js` |
| Token skala teks orphan (`--text-hero`, `--text-heading`) tidak dipakai di CSS aplikasi | `tests/runtime/token-css-ada.test.js` |
| `--t-metric` hanya dipakai di dalam `.stat`, dan tidak pernah di kasir | `tests/runtime/token-css-ada.test.js` |
| `ds-bundle/` identik dengan basis upstream — nol suntingan di tempat | `tests/runtime/ds-bundle-vendor.test.js` |
| Penjaga vendor benar-benar membandingkan, bukan hijau karena tidak melihat apa pun | `tests/runtime/ds-bundle-vendor.test.js` |
| Override Lumi ada dan benar-benar dimuat | `tests/runtime/ds-bundle-vendor.test.js` |
| Dialog diekspor dari pembungkus, bukan langsung dari bundle | `tests/runtime/ds-bundle-vendor.test.js` |
| Setiap kelas `t-*` yang dipakai aplikasi ada di `/ds-bundle` | `tests/oxlint-ds-adherence/kelas-tipografi.test.js` |
| Penjaga kelas tipografi benar-benar membaca token | `tests/oxlint-ds-adherence/kelas-tipografi.test.js` |
| Nilai hex, px lepas, prop tak dikenal, enum salah, dan deep import tertangkap lint | `tests/oxlint-ds-adherence/integration.test.js` |
| Kode asli di `apps/` dan `packages/` bersih terhadap lint DS | `tests/oxlint-ds-adherence/integration.test.js` |
| Bentuk aturan lint (`literalBan`, `propWhitelist`, `propEnum`) diparsing benar; bentuk tak dikenal melempar | `tests/oxlint-ds-adherence/plugin.test.js` |
| `packages/ds` tidak mengekspor `CartRow`/`ProductCard` — komponen bundle yang menyentuh uang | `tests/runtime/komponen-bundle-uang.test.js` |
| Larangan itu berhenti pada dua nama — komponen bundle lain tetap boleh | `tests/runtime/komponen-bundle-uang.test.js` |
| Hanya satu deklarasi pemformat rupiah di seluruh repo | `tests/runtime/pemformat-uang-tunggal.test.js` |
| Tidak ada string `Rp` yang dirakit tangan | `tests/runtime/pemformat-uang-tunggal.test.js` |
| Kartu K-03 merender tiga keadaan gambar, dan `tanpa` tanpa penanda apa pun | `tests/kasir/gambar-kartu.test.js` |
| Klaim berangka di dokumen cocok dengan yang terukur | `tests/runtime/klaim-registri.test.js` |

⛔ **Bentuk penjaga yang bekerja di repo ini bukan "assert lebih banyak".** Ia
membandingkan dua sumber yang tidak ada apa pun menyatukannya, dan ia
membuktikan bahwa ia memindai sesuatu — penjaga yang memeriksa nol berkas hijau
selamanya. Tiga baris "penjaga benar-benar …" di tabel di atas adalah sentinel
itu.

---

## 6. Token yang terdefinisi tetapi belum punya jalan ke layar

Diukur pada commit ini: `var(--token)` dihitung di `apps/`, `packages/`, dan
`ds-bundle/`, lalu ditelusuri apakah kelas bundle yang memakainya benar-benar
dirender aplikasi.

**12 token terdefinisi tanpa satu pun jalan ke layar:**

| Token | Nilai | Kenapa tidak sampai |
|---|---|---|
| `--text-hero` | `calc(40px * var(--scale))` | `.t-hero` 0× di `apps/`; orphan, dilarang lint |
| `--text-heading` | `calc(28px * var(--scale))` | `.t-heading` 0× di `apps/`; orphan, dilarang lint |
| `--info` | `#1D4ED8` | hanya `.badge-info`, yang 0× di `apps/` |
| `--info-soft` | `#EAF0FD` | sama |
| `--info-border` | `#BCD0F5` | sama |
| `--violet` | `#6D5AE0` | hanya `.badge-violet`, yang 0× di `apps/` |
| `--violet-soft` | `#EFEDFB` | sama |
| `--violet-border` | `#CFC8F2` | sama |
| `--success-soft` | `#E8F5EC` | hanya `.badge-success`, yang 0× di `apps/` |
| `--success-border` | `#B6DCC3` | sama |
| `--space-12` | `48px` | hanya `.empty` bundle, yang 0× di `apps/` |
| `--shadow-sheet` | `0 -4px 24px rgba(20, 17, 15, 0.12)` | nol pemakaian di `components.css`; hanya di kartu dokumentasi `ds-bundle/guidelines/` |

⛔ **Ini bukan daftar cacat.** Sepuluh di antaranya menunggu layar yang belum
dibangun — modul reservasi (`--violet*`), swap shift (`--info*`), bottom sheet
keranjang (`--shadow-sheet`). Dua sisanya (`--text-hero`, `--text-heading`)
adalah orphan yang sengaja dilarang. Yang berbahaya adalah mendokumentasikan
kedua belasnya seolah aktif; itulah kenapa daftar ini terpisah.

⛔ **`--success` sendiri BUKAN bagian daftar ini** — ia dipakai langsung 8×,
termasuk di `apps/backoffice`. Yang tidak sampai ke layar hanya kedua
variannya. Perbedaan itu penting: warna keluarga `success` memang dipakai;
badge-nya yang belum.

---

## 7. Token yang ditolak dari design system eksternal

Pada 15 September 2026 sebuah design system eksternal diterima sebagai zip
(`LumiPOS_design_system.zip`, 90 token: 68 warna, 9 tipografi, 13 bentuk/spasi)
dan disaring terhadap repo ini.

**Hasil penyaringan: 0 diadopsi · 55 dipetakan ke token repo yang sudah ada ·
20 ditolak.**

⛔ **Palet design system eksternal itu bernada dingin kebiruan karena berasal
dari perkiraan visual yang keliru atas sebuah screenshot, lalu perkiraan itu
dieksekusi jadi kode dan dibaca balik sebagai nilai asli — sementara palet repo
bernada hangat, dan itulah yang benar.** (Keputusan user, bukan fakta yang
terbaca dari token.)

### Tabel pemetaan lengkap — 55 token

Orang berikutnya yang menerima design system serupa dapat menelusuri tabel ini
tanpa mengulang penyaringan.

#### Aksen (5)

| Token eksternal | Padanan repo |
|---|---|
| `--primary` | `--accent` |
| `--ring` | `--accent` |
| `--primary-foreground` | `--on-accent` |
| `--accent-foreground` | `--on-accent` |
| `--accent-subtle` | `--accent-soft` |

#### Permukaan (12)

| Token eksternal | Padanan repo |
|---|---|
| `--background` | `--surface-sunk` |
| `--panel-subtle-bg` | `--surface-sunk` |
| `--dashed-bg` | `--surface-sunk` (`.kasir-kartu-gambar-rusak`) |
| `--card` | `--surface` |
| `--secondary` | `--surface` (`.btn-secondary`) |
| `--surface-raised` | `--surface` + `--shadow-card` |
| `--muted` | `--surface-alt` |
| `--secondary-hover` | `--surface-alt` |
| `--ghost-hover-bg` | `--surface-alt` (`.btn-ghost:hover`) |
| `--skeleton-bg` | `--surface-alt` (`.kasir-memuat`) |
| `--pin-inactive-bg` | `--surface-alt` (`.kasir-titik`) |
| `--step-inactive-bg` | `--surface-alt` (`.stepper`) |

#### Teks (11)

| Token eksternal | Padanan repo |
|---|---|
| `--foreground` | `--ink` |
| `--card-foreground` | `--ink` |
| `--secondary-foreground` | `--ink` |
| `--offline-banner-text` | `--ink` |
| `--muted-foreground` | `--ink-muted` |
| `--muted-foreground-strong` | `--ink-muted` |
| `--ghost-foreground` | `--ink-muted` (`.btn-ghost`) |
| `--avatar-bg` | `--accent-soft` (`.avatar`) |
| `--icon-muted` | `--ink-subtle` |
| `--sidebar-label` | `--ink-subtle` |
| `--step-inactive-text` | `--ink-subtle` |

#### Pembatas (7)

| Token eksternal | Padanan repo |
|---|---|
| `--card-outline` | `--border` (`.product-card`) |
| `--cart-divider` | `--border` (`.cart-row`) |
| `--row-divider` | `--border` |
| `--input-border` | `--border-strong` (`.field`) |
| `--keypad-border` | `--border-strong` (`.btn-secondary`) |
| `--dashed-border` | `--border-strong` (`.kasir-kartu-gambar-rusak`) |
| `--card-outline-hover` | `--accent-border` (`.product-card:hover`) |

#### Status badge (10)

| Token eksternal | Padanan repo |
|---|---|
| `--status-success-bg` | `--success-soft` |
| `--status-success-text` | `--success` |
| `--status-warning-bg` | `--warning-soft` |
| `--status-warning-text` | `--warning` |
| `--status-danger-bg` | `--danger-soft` |
| `--status-danger-text` | `--danger` |
| `--status-info-bg` | `--info-soft` |
| `--status-info-text` | `--info` |
| `--status-pending-bg` | `--surface-alt` (`.badge-neutral`) |
| `--status-pending-text` | `--ink-muted` |

#### Offline (5)

| Token eksternal | Padanan repo |
|---|---|
| `--offline-badge-bg` | `--warning-soft` |
| `--offline-badge-text` | `--warning` |
| `--offline-banner-bg` | `--warning-soft` (`.kasir-pita-peringatan`) |
| `--offline-banner-border` | `--warning-border` |
| `--offline-banner-text` | `--ink` |

`apps/kasir/src/kasir.css:690` sudah menyatakan aturannya: *"Tiga tingkat
memakai tiga warna semantik yang SUDAH ada — tidak ada token warna baru."*

#### Bahaya (2)

| Token eksternal | Padanan repo |
|---|---|
| `--destructive` | `--danger` |
| `--destructive-hover` | `--danger-soft` (`.btn-danger:hover`) |

#### Bentuk, sentuh, bobot (3)

| Token eksternal | Nilai eksternal | Padanan repo | Nilai repo |
|---|---:|---|---:|
| `--radius` | `12px` | `--radius-card` | `12px` — identik |
| `--touch-primary` | `56px` | `--touch-critical` | `56px` — identik |
| `--font-weight-regular` | `400` | `--weight-regular` | `400` — identik |
| `--font-weight-semibold` | `600` | `--weight-bold` | `600` — identik |

### 20 token ditolak — dua sebab yang berbeda

Pemisahan ini penting: satu kelompok dapat berubah, satu lagi tidak.

#### 6a. Ditolak karena nol konsumen — **dapat berubah**

Tokennya sah; layarnya belum ada. Kalau layar itu dibangun nanti, tokennya
lahir bersama layarnya, bukan sebelumnya.

| Token | Apa yang belum ada |
|---|---|
| `--dropzone-border` | Nol drag-and-drop. `.bo-gambar-kotak` di `apps/backoffice/src/backoffice.css:49` bertepi solid `var(--border)` |
| `--chart-baseline` | Nol grafik. B-01 seluruhnya angka dan tabel |
| `--progress-track` | Nol progress bar di repo |
| `--menu-hover-border` | Nol komponen menu |
| `--option-border` | Nol daftar opsi |
| `--chip-hover-bg` | `.chip` di `ds-bundle/components.css:150` tidak punya aturan `:hover` sama sekali |
| `--guest-background` | Nol konsep "tamu" di repo |
| `--guest-border` | sama |
| `--guest-card` | sama |
| `--font-mono` | Nol monospace di `apps/`. Layar pratinjau struk belum ada |

#### 6b. Ditolak karena duplikasi atau bertentangan dengan keputusan repo — **tidak akan berubah**

| Token | Sebab |
|---|---|
| `--icon-muted-alt` | Varian kedua abu ikon: `#91b3b4` di samping `--icon-muted` `#9ab4b5` |
| `--icon-muted-alt-2` | Varian ketiga: `#8eb1b1`. Tiga abu untuk satu peran |
| `--muted-foreground-strong-alt` | `#47666a` di samping `--muted-foreground-strong` `#49666a` |
| `--dashed-border-strong` | Varian ketiga; `--dashed-border` sudah dipetakan ke `--border-strong` |
| `--font-weight-bold` (`700`) | Skala bobot repo berhenti di 600 |
| `--font-weight-extrabold` (`800`) | Design system eksternal itu sendiri menulis *"never on body text"* |
| `--text-small` (`13px`) | Bertentangan dengan `--text-caption` `12px`; skala lima token dikunci `CLAUDE.md` § Skala teks final |
| `--radius-pill` (`999px`) | Nol pill di CSS kita; `.badge` bundle memakai `999px` harfiah, dan bundle vendor |
| `--shadow-raised` | Bayangan ketiga tanpa konsumen; repo punya `--shadow-card` dan `--shadow-sheet` |
| `--switcher-bg` | Milik bar Penjelajah — alat mockup design system eksternal, bukan produk |

### Yang juga ditolak, di luar 75

Empat nilai di bawah bertabrakan **nama** dengan token repo. Repo yang menang,
seluruhnya, karena alasan palet di atas.

| Token | Nilai eksternal | Nilai repo — yang berlaku |
|---|---|---|
| `--accent` | `#14706b` | `#0D5C63` |
| `--accent-hover` | `#0f5b57` | `#0A4A50` |
| `--border` | `#e3ecee` | `#E2DDD8` |
| `--radius-control` | `10px` | `8px` |
| `--shadow-card` | `0 1px 2px rgba(22,40,44,.04), 0 2px 8px rgba(22,40,44,.04)` | `0 1px 2px rgba(20,17,15,0.05)` |

Ditolak juga: keluarga font Nunito Sans (repo memakai Inter sejak gate F0), dan
skala empat ukuran teks (repo mengunci lima).

---

## Verifikasi dokumen ini

- **69 token terdokumentasi**, seluruhnya dari enam berkas sumber yang disebut
  di kepala dokumen: 28 + 14 + 11 + 2 + 0 + 14.
- **Nol nilai diperkirakan.** Setiap hex, px, dan angka bobot di atas dibaca
  dari berkas token pada commit `4dbe377`, bukan dari dokumen lain dan bukan
  dari ingatan.
- **Dua token dinyatakan belum terdefinisi** alih-alih diberi nilai karangan:
  `--chip` dan `--chip-soft`, yang disuntikkan inline oleh `gayaKategori`.
- **12 token dipisahkan** sebagai terdefinisi tanpa jalan ke layar, alih-alih
  didokumentasikan seolah aktif.
- **Alasan di balik keputusan ditandai eksplisit** sebagai keputusan produk di
  setiap tempat ia muncul, karena ia tidak terbaca dari nilai token.
