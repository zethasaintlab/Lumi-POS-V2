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

⛔ **Sebagian nilai di bawah DIGANTIKAN keputusan kampanye Hidupkan desain, 26
September 2026** (`docs/RENCANA-HIDUPKAN-DESAIN.md`): font (Nunito Sans,
bukan Inter), skala teks (empat token 32/20/15/13, `--t-metric` DIHAPUS),
palet (nilai mockup — lihat `docs/referensi-visual/PALET.md` untuk keputusan
dan koreksi AA-nya), dan wordmark (`packages/ds/Wordmark.tsx`, menggantikan
"logo tidak boleh disentuh"). Kampanye itu juga menambah satu berkas sumber
baru, `packages/ds/tokens-mockup.css` (token mockup di bawah namanya sendiri
— `--primary`, `--card`, `--foreground`, dst), yang TIDAK terhitung di
"Berkas sumber" atau di angka 69 di atas: berkas itu ditambahkan sesudah
commit `4dbe377`, dan menghitungnya ulang di luar cakupan kampanye ini —
lihat spec § 11 dan `docs/superpowers/plans/2026-09-26-fondasi-desain.md`.
Bagian yang terpengaruh ditandai eksplisit di tempatnya masing-masing. Bagian
yang TIDAK disebut kampanye ini (spasi, radius, elevasi, warna kategori
produk, §6, §7) belum diverifikasi ulang terhadap kode setelah 15 September
2026 — perlakukan sebagai potret pada tanggalnya, bukan keadaan sekarang.

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

⛔ **Digantikan Nunito Sans** (keputusan kampanye Hidupkan desain, 26
September 2026 — `docs/RENCANA-HIDUPKAN-DESAIN.md`, Task 3). `ds-bundle/tokens/typography.css`
(VENDOR, tidak pernah disunting) masih menulis:

```css
--font-sans: 'Inter', system-ui, -apple-system, sans-serif;
```

dimuat lewat `@import` Google Fonts di `ds-bundle/tokens/fonts.css`, bobot
`400;500;600` saja — dan itu tetap benar sebagai isi berkas VENDOR. Yang
berubah adalah nilai yang MENANG di peramban: `packages/ds/lumi.css`
menuliskan ulang `--font-sans` ke `'Nunito Sans', system-ui, sans-serif`
(diimpor paling akhir di `packages/ds/styles.css`, spesifisitas sama,
deklarasi belakangan menang), dan font-nya di-self-host lewat
`@fontsource/nunito-sans` (bobot 400/600/700/800 — tanpa 500, lihat § Bobot di
bawah), bukan lewat `@import` Google Fonts. Nilai efektif WAJIB diukur
(`getComputedStyle(body).fontFamily`), bukan disimpulkan dari berkas token —
dijaga `tests/kasir-dom/font.test.js`.

Alasan Inter yang tercatat di berkas vendor (tabular numerals — di POS angka
tersusun dalam kolom dan font proporsional membuat kolom bergoyang) tidak
gugur begitu saja: Nunito Sans dipilih sebagai nilai MOCKUP untuk alasan
tampilan yang sama, dan `.num` (kelas tabular-nums) tidak bergantung pada
keluarga font yang dipakainya.

⛔ **Keputusan produk lama yang tidak terbaca dari token:** sebelum kampanye
ini, `CLAUDE.md` gate F0 mencatat Inter **di-self-host** untuk menggantikan
`@import` Google Fonts — pencapaian itu tetap tercatat sebagai riwayat gate
F0, bukan keadaan font saat ini.

### Ukuran — tujuh terdeklarasi di bundle, EMPAT sah, nilai mockup

⛔ **Digantikan** (keputusan kampanye Hidupkan desain, 26 September 2026,
Task 4 — `docs/RENCANA-HIDUPKAN-DESAIN.md`). Nilai EFEKTIF tiga token inti
yang bertabrakan nama dengan mockup (`--text-display`, `--text-title`,
`--text-body`) bukan lagi `calc(<px> * var(--scale))`: `packages/ds/tokens-mockup.css`
mendefinisikan ulang ketiganya sebagai nilai mockup TETAP, tanpa `--scale`,
dan menang lewat urutan `@import` (sesudah token bundle, sebelum `lumi.css`).
`--text-caption` (nama bundle) diarahkan ke `--text-small` (nama mockup, 13px)
lewat `packages/ds/lumi.css`.

| Token (nama bundle) | Nilai bundle (`calc`) | Nilai EFEKTIF | Status di skala final |
|---|---|---:|---|
| `--text-hero` | `calc(40px * var(--scale))` | 40 — tidak berubah | **orphan, dilarang** |
| `--text-heading` | `calc(28px * var(--scale))` | 28 — tidak berubah | **orphan, dilarang** |
| `--text-display` | `calc(32px * var(--scale))` | 32, TETAP (nilai mockup, bobot 700) | **inti** |
| `--text-title-lg` | `calc(24px * var(--scale))` | 24 di bundle, DIIKAT ke `var(--text-display)` (32) di dalam `.stat` | **khusus**, hanya lewat `<StatCard>` |
| `--text-title` | `calc(20px * var(--scale))` | 20, TETAP (bobot 600) | **inti** |
| `--text-body` | `calc(15px * var(--scale))` | 15, TETAP (bobot 400, 600 label tombol) | **inti** |
| `--text-caption` | `calc(12px * var(--scale))` | diarahkan ke `--text-small` = 13 (bobot 400, 600 header tabel) | **inti** |

⛔ **Skala final sekarang EMPAT token, bukan lima** — `--t-metric` (token
khusus kelima, keputusan 31 Agustus 2026 "Opsi A") **DIHAPUS**, bukan
diarahkan ulang. Lihat § Token khusus di bawah.

⛔ **Yang orphan tidak dihapus, dan itu TIDAK berubah oleh kampanye ini.**
Keduanya hidup di `ds-bundle/tokens/typography.css` — vendor, tidak dapat
disunting. Larangan adalah satu-satunya penegakan yang tersedia, dan ia
dipasang di `tools/oxlint-plugins/ds-adherence.mjs` (menolak kelas
`t-hero`/`t-heading`/`t-title-lg` yang ditulis sendiri di `apps/` dan
`packages/`) serta di `tests/runtime/token-css-ada.test.js`.

⛔ **`.kds-scale` tidak lagi memperbesar `--text-display`/`--text-title`/
`--text-body`/`--text-caption`** — ketiganya (plus alias caption) sekarang
nilai TETAP di `tokens-mockup.css`/`lumi.css`, bukan `calc(<px> * var(--scale))`.
KDS tetap 0× dipakai di `apps/`/`packages/` (daftar "jangan bangun" v1.1+),
jadi ini konsekuensi yang belum punya konsumen — dicatat supaya orang
berikutnya yang membangun KDS tidak salah kira mekanismenya masih hidup untuk
keempat token inti.

**Keputusan produk:** skala EMPAT token adalah keputusan kampanye Hidupkan
desain, 26 September 2026, menggantikan skala LIMA token 31 Agustus 2026
("Opsi A") — tercatat di `CLAUDE.md` § Skala teks final.

### Token khusus — `--t-metric` DIHAPUS

⛔ **Digantikan** (Task 4, kampanye Hidupkan desain, 26 September 2026).
`--t-metric` tidak lagi didefinisikan di `packages/ds/lumi.css` maupun di
berkas mana pun. Cakupan `.stat .t-title-lg` sekarang mengikat LANGSUNG ke
`var(--text-display)`:

```css
.stat .t-title-lg { font-size: var(--text-display); }
```

Nilainya tetap bukan `32px` yang diketik ulang — ia referensi ke token
display, yang nilainya sendiri kini mockup (§ Ukuran di atas). Angka KPI
kartu dasbor B-01 karena itu memakai ukuran DISPLAY yang sama dengan
total/kembalian kasir, bukan ukuran kelima.

### Bobot

⛔ **Digantikan** (Task 4, kampanye Hidupkan desain, 26 September 2026).
Kosakata bobot MOCKUP hanya 400/600/700/800 (tidak ada 500 — subset font yang
di-self-host, § Keluarga font, juga tidak memuatnya), jadi kedua alias bundle
diarahkan ke wajah TERDEKAT yang perannya cocok, bukan ke nilai yang sama
artinya:

| Token | Nilai bundle | Nilai EFEKTIF (mockup) | Catatan |
|---|---:|---:|---|
| `--weight-regular` | `400` | `400` — tidak berubah | — |
| `--weight-medium` | `500` | `600` (`--font-weight-semibold` mockup) | label tombol, chip kategori aktif, `.t-body-md` ikut menebal |
| `--weight-bold` | `600` | `700` (`--font-weight-bold` mockup) | dipakai `--text-display` |

Konsekuensinya dinyatakan (spec § 5): setiap kelas bundle yang sudah memakai
`var(--weight-medium)` untuk label tombol ikut merender 600 tanpa satu baris
pun disentuh di `lumi.css` — itu yang DIMAKSUD, bukan efek samping.

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

⛔ **Nilai EFEKTIF (yang sungguh dirender) DIGANTIKAN keputusan kampanye
Hidupkan desain, 26 September 2026** (`docs/RENCANA-HIDUPKAN-DESAIN.md`,
Task 1–2). Setiap tabel warna di bawah menunjukkan DUA kolom sejak sini:
nilai yang `ds-bundle/tokens/colors.css` deklarasikan di bawah nama-nama ini
(isi berkas VENDOR, tidak berubah oleh kampanye), dan nilai EFEKTIF yang
sungguh menang di peramban — token mockup, lewat pengarahan eksplisit
`packages/ds/lumi.css` untuk sebagian nama, dan lewat urutan `@import` untuk
nama yang bertabrakan PERSIS dengan mockup (`--accent-hover`, `--border`).
`getComputedStyle` wajib untuk memverifikasi, bukan membaca nama token —
dijaga `tests/kasir-dom/palet-berlaku.test.js` (nilai di peramban) dan
`tests/runtime/token-mockup.test.js` (nilai di berkas mockup).

### Aksen — satu, dan hanya satu

| Token | Nilai bundle (deklarasi lama) | Nilai EFEKTIF (mockup) | Cara menang |
|---|---|---|---|
| `--accent` | `#0D5C63` | `#14706b` (`--primary`) | diarahkan eksplisit, `lumi.css` |
| `--accent-hover` | `#0A4A50` | `#0f5b57` (`--accent-hover` mockup) | nama SAMA PERSIS di kedua berkas, menang lewat urutan `@import` |
| `--accent-soft` | `#E6F2F2` | `#d9edf0` (`--accent-subtle`) | diarahkan eksplisit |
| `--accent-border` | `#9CC9CB` | `#9fc5c4` (`--card-outline-hover`) | diarahkan eksplisit |
| `--on-accent` | `#FFFFFF` | `#ffffff` (`--primary-foreground`) | diarahkan eksplisit — nilai kebetulan sama |

**Keputusan produk (lama, komentar bundle):** deep teal `#0D5C63` dipilih
karena bertahan terhadap glare layar counter yang kena matahari, tidak
bentrok dengan semantik hijau/merah, dan tidak dipakai kompetitor Indonesia —
alasan itu berlaku untuk `#0D5C63`, bukan untuk `#14706b`; keputusan kampanye
tidak mengulang alasan barunya di sini, hanya nilainya. Kuota dan disiplin
TIDAK berubah: < 5% area, satu aksi utama per layar (`CLAUDE.md` § Aturan
design system #2).

### Semantik — hanya untuk status, tidak pernah dekoratif

| Token | Nilai bundle | Nilai EFEKTIF (mockup) | Catatan |
|---|---|---|---|
| `--success` | `#137535` | `#2c6b3f` (`--status-success-text`) | diarahkan eksplisit |
| `--success-soft` | `#E8F5EC` | `#dff3e4` (`--status-success-bg`) | diarahkan eksplisit |
| `--success-border` | `#B6DCC3` | `#B6DCC3` — TIDAK diarahkan | mockup tidak punya token border sukses tersendiri |
| `--danger` | `#B91C1C` | `#9a3535` (`--status-danger-text`) | diarahkan eksplisit |
| `--danger-soft` | `#FDEAEA` | `#f9e1e1` (`--status-danger-bg`) | diarahkan eksplisit |
| `--danger-border` | `#EFB4B4` | `#EFB4B4` — TIDAK diarahkan | sama alasannya |
| `--warning` | `#B45309` | `#8a6520` (`--status-warning-text`) | diarahkan eksplisit |
| `--warning-soft` | `#FDF3E7` | `#fbf0d9` (`--status-warning-bg`) | diarahkan eksplisit |
| `--warning-border` | `#E8C79B` | `#E8C79B` — TIDAK diarahkan | sama alasannya |

### Warna modul

| Token | Nilai bundle | Nilai EFEKTIF (mockup) | Catatan |
|---|---|---|---|
| `--info` | `#1D4ED8` | `#1f5a7a` (`--status-info-text`) | diarahkan eksplisit |
| `--info-soft` | `#EAF0FD` | `#d6eaf5` (`--status-info-bg`) | diarahkan eksplisit |
| `--info-border` | `#BCD0F5` | `#BCD0F5` — TIDAK diarahkan | mockup tidak punya padanan |
| `--violet` | `#6D5AE0` | `#6D5AE0` — TIDAK diarahkan | mockup tidak punya token "modul reservasi" |
| `--violet-soft` | `#EFEDFB` | `#EFEDFB` — TIDAK diarahkan | sama alasannya |
| `--violet-border` | `#CFC8F2` | `#CFC8F2` — TIDAK diarahkan | sama alasannya |

Komentar di berkas membatasi keduanya: *"Dipakai HANYA untuk identitas modul &
kartu statistik, tidak untuk aksi utama (aksi utama tetap teal)."* Ketiganya
tidak punya konsumen aktif — lihat § 6.

### Netral hangat

| Token | Nilai bundle | Nilai EFEKTIF (mockup) | Catatan |
|---|---|---|---|
| `--ink` | `#14110F` | `#16282c` (`--foreground`) | diarahkan eksplisit |
| `--ink-muted` | `#5C5450` | `#5e747a` (`--muted-foreground`) | diarahkan eksplisit |
| `--ink-subtle` | `#6E6560` | `#5e747a` (`--muted-foreground`, SAMA dengan `--ink-muted`) | diarahkan eksplisit — mockup tidak punya token abu ketiga terpisah; dua peran repo lama kini satu nilai mockup |

### Permukaan dan pembatas

| Token | Nilai bundle | Nilai EFEKTIF (mockup) | Cara menang |
|---|---|---|---|
| `--surface` | `#FFFFFF` | `#ffffff` (`--card`) | diarahkan eksplisit — nilai kebetulan sama |
| `--surface-sunk` | `#F7F5F3` | `#f0f6f7` (`--background`) | diarahkan eksplisit |
| `--surface-alt` | `#F0EDEA` | `#f7fafb` (`--secondary`) | diarahkan eksplisit |
| `--border` | `#E2DDD8` | `#e3ecee` (`--border` mockup) | nama SAMA PERSIS di kedua berkas, menang lewat urutan `@import` |
| `--border-strong` | `#C9C2BB` | `#c9dcdf` (`--input-border`) | diarahkan eksplisit |

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
| `--t-metric` DIHAPUS dari `lumi.css` dan tidak disebut di mana pun; `.stat .t-title-lg` memakai `var(--text-display)` — digantikan keputusan kampanye Hidupkan desain, 26 September 2026, baris lama "`--t-metric` hanya dipakai di dalam `.stat`" | `tests/runtime/token-css-ada.test.js` |
| Skala teks final (32/20/15/13) benar-benar dirender di peramban, di seluruh layar galeri | `tests/kasir-dom/skala-teks.test.js` |
| Nilai palet mockup benar-benar dirender di peramban (bukan hanya di berkas token) | `tests/kasir-dom/palet-berlaku.test.js` |
| Nol warna hardcoded (hex/`rgb()`/`hsl()`/nama warna) di `apps/*/src/**/*.css` dan `packages/ds/*.css` selain `lumi.css`/`tokens-mockup.css` | `tests/runtime/nol-hex-css.test.js` |
| `packages/ds/tokens-mockup.css` identik dengan `docs/referensi-visual/sumber/tokens/*.css`, kecuali empat koreksi AA yang dipaku | `tests/runtime/token-mockup.test.js` |
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

⛔ **Sebagian verdict di bawah DIGANTIKAN, 26 September 2026** (keputusan
kampanye Hidupkan desain — `docs/RENCANA-HIDUPKAN-DESAIN.md`). Nilai aksen
(`#14706b`), `--accent-hover` (`#0f5b57`), `--border` (`#e3ecee`),
`--radius-control` (`10px`), dan `--shadow-card` yang zip di bawah usulkan
pada 15 September — dan yang saat itu ditolak sebagai "perkiraan visual yang
keliru atas sebuah screenshot" — kini MENANG sebagai nilai EFEKTIF repo,
lewat rute yang sama sekali berbeda: bukan zip ini, melainkan
`docs/referensi-visual/sumber/design-explorer.html`, ekspor Claude Design
yang diverifikasi sebagai mockup asli (`docs/referensi-visual/README.md`).
Kebetulan nilainya identik dengan zip yang ditolak di sini **tidak berarti**
keputusan 15 September itu salah pada waktunya — asal-usul zip itu tetap
tidak terverifikasi, dan penolakannya tetap dicatat apa adanya sebagai
riwayat di bawah. Yang berubah adalah keputusan user 26 September 2026
menerima nilai yang SAMA dari sumber yang BERBEDA dan terverifikasi. Lihat
§ 2 dan § 3 di atas untuk nilai EFEKTIF saat ini; seluruh isi § 7 di bawah
tetap potret 15 September 2026, tidak disunting.

Pada 15 September 2026 sebuah design system eksternal diterima sebagai zip
(`LumiPOS_design_system.zip`, 90 token: 68 warna, 9 tipografi, 13 bentuk/spasi)
dan disaring terhadap repo ini.

**Hasil penyaringan PADA TANGGAL ITU: 0 diadopsi · 55 dipetakan ke token repo
yang sudah ada · 20 ditolak.** (Lihat catatan di atas untuk apa yang berubah
sejak lewat jalur yang berbeda.)

⛔ **Palet design system eksternal itu bernada dingin kebiruan karena berasal
dari perkiraan visual yang keliru atas sebuah screenshot, lalu perkiraan itu
dieksekusi jadi kode dan dibaca balik sebagai nilai asli — sementara palet repo
bernada hangat, dan itulah yang benar.** (Keputusan user, bukan fakta yang
terbaca dari token — dan keputusan itu sendiri, untuk beberapa nilai, dibalik
11 hari kemudian oleh keputusan user yang lain, dari sumber yang berbeda.
Lihat catatan di atas.)

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
seluruhnya, karena alasan palet di atas — **pada 15 September 2026.**

⛔ **Kelima baris ini DIBALIK 26 September 2026** oleh keputusan kampanye
Hidupkan desain — bukan lewat zip ini, tapi lewat mockup
`design-explorer.html` yang kebetulan membawa nilai yang sama persis. Kolom
ketiga sekarang menunjukkan nilai EFEKTIF setelah pembalikan itu.

| Token | Nilai eksternal (15 Sept, ditolak) | "Nilai repo — yang berlaku" (15 Sept) | Nilai EFEKTIF sejak 26 Sept |
|---|---|---|---|
| `--accent` | `#14706b` | `#0D5C63` | `#14706b` (mockup menang) |
| `--accent-hover` | `#0f5b57` | `#0A4A50` | `#0f5b57` (mockup menang) |
| `--border` | `#e3ecee` | `#E2DDD8` | `#e3ecee` (mockup menang) |
| `--radius-control` | `10px` | `8px` | `10px` (mockup menang) |
| `--shadow-card` | `0 1px 2px rgba(22,40,44,.04), 0 2px 8px rgba(22,40,44,.04)` | `0 1px 2px rgba(20,17,15,0.05)` | `0 1px 2px rgba(22,40,44,.04), 0 2px 8px rgba(22,40,44,.04)` (mockup menang) |

Ditolak juga pada 15 September: keluarga font Nunito Sans (repo memakai Inter
sejak gate F0), dan skala empat ukuran teks (repo mengunci lima). ⛔ **Keduanya
juga DIBALIK 26 September 2026** — repo memakai Nunito Sans (§ Keluarga font)
dan skala EMPAT token (§ Ukuran), keputusan kampanye Hidupkan desain, sekali
lagi lewat mockup, bukan lewat zip yang ditolak di sini.

---

## 8. Ikon

Ditambahkan kampanye Hidupkan desain, Task 6–7, 26 September 2026 —
`docs/RENCANA-HIDUPKAN-DESAIN.md`. Rincian lengkap ada di
`packages/ds/README.md`; ringkasannya di sini.

`packages/ds/ikon.tsx` (dan datanya, `ikon-data.ts`/`ikon-peta.ts`) adalah set
ikon **Lucide `lucide-react@0.468.0` apa adanya**, tanpa dependency npm baru —
50 path disalin byte demi byte dari paket segar, mencakup 48 nama yang
`ds-bundle/components/forms/Icon.jsx` (bundle, "gaya Lucide" gambar ulang, 42
ikon) pakai. Diekspor lewat `packages/ds/index.ts` sebagai
`Icon`/`iconNames`/`IconName`; pemakai di `apps/**` memakai yang ini.

⛔ **`ds-bundle/components/**` (Modal, AppShell, StatCard, SyncIndicator,
Ticket, Stepper) sendiri masih memanggil `Icon` dari `forms/Icon.jsx` BUNDEL
secara INTERNAL** — dan `ds-bundle/` tidak pernah disunting langsung.
`packages/ds/vite-ikon.ts` (`ikonLumi()`, Task 7) adalah override itu: plugin
Vite yang mencegat impor relatif `forms/Icon.jsx` di dalam
`ds-bundle/components/` lewat `resolveId` dan mengalihkannya ke `ikon.tsx`,
sehingga ikon yang dirender komponen bundel sendiri juga node Lucide, bukan
gambar ulang bundel yang proporsinya berbeda.

⛔ **Plugin ini SENGAJA TIDAK disembunyikan** (keputusan user, 26 September
2026). Dipasang secara eksplisit, dengan komentar, di setiap config Vite yang
merender komponen bundel: `apps/kasir/vite*.config.ts` (×3),
`apps/backoffice/vite.config.ts`, `apps/hp/vite.config.ts`. Dijaga
`tests/runtime/ikon-lucide.test.js` (config yang lupa memasangnya, dan
konsumen lain yang membaca `Icon.jsx` bundel langsung) dan
`tests/kasir-dom/ikon-bundle.test.js` (pengukuran DOM sungguhan).

## 9. Wordmark

Ditambahkan kampanye Hidupkan desain, Task 8, 26 September 2026 — menggantikan
aturan lama "logo, nama 'Lumi POS' tidak boleh disentuh sama sekali"
(`CLAUDE.md`). Satu komponen, `packages/ds/Wordmark.tsx`, dipakai di ketiga
aplikasi:

- ikon `store` (set Lucide, § 8 di atas), 20px, dalam kotak `36×36` — disusun
  dari token spasi (`--space-8` 32 + `--space-1` 4), bukan `36px` yang
  diketik ulang — radius `--radius-control`, latar `--primary` (§ 3, nilai
  mockup), warna ikon `--primary-foreground`;
- teks "LumiPOS" (satu kata, ejaan berubah dari "Lumi POS"), 20px bobot 600 —
  token PERSIS sama dengan `.t-title` (`--text-title` + `--weight-medium`)
  tanpa memakai kelasnya, karena wordmark adalah bentuk merek, bukan judul
  layar.

Dipasang di `ShellKasir` (topbar kasir), `AppShell.brand.logo` back-office
(menggantikan `LogoLumi`), dan kedua layar masuk (back-office, HP). `AppShell`
bundel (VENDOR) merender `brand.logo` DAN `brand.name` sebagai teks terpisah
tanpa syarat; span kedua disembunyikan lewat CSS di `packages/ds/lumi.css`
(`.shell-brand > .wordmark + .t-body-md.truncate { display: none; }`) supaya
nama tidak tampil dua kali berdampingan.

Palet, ikon, dan bobot yang dipakai wordmark semuanya nilai mockup — lihat
§ 2, § 3, § 8 di atas.

## 10. Tata letak aplikasi kasir (sub-proyek 2)

Keputusan kampanye Hidupkan desain, 26 September 2026; rancangan di
`docs/superpowers/specs/2026-09-28-kasir-design.md`. Bagian ini deskriptif
terhadap kode di branch `hidupkan-desain-2d-kasir`; angka diukur oleh test yang
disebut, bukan dibaca dari CSS.

- **Tinggi baris (`line-height`) empat token** — display 1,15 · title 1,3 ·
  body 1,5 · small 1,4 (`--leading-display`/`-title`/`-small` di
  `packages/ds/lumi.css`; body mengikuti `--leading-body` bundle). Diterapkan
  pada kelas bundle yang memetakan ke token itu. Dijaga G-LH (`tests/kasir-dom/skala-teks.test.js`).
- **Header satu baris, 68 px**, sama di setiap layar ber-shell
  (`apps/kasir/src/kasir.css`, `ShellKasir.tsx`), menggantikan topbar + bilah
  navigasi dua lapis. Isi: wordmark · empat tab berikon (Kasir · Riwayat · Laci
  kas · Tutup shift) · indikator sinkron · lonceng · menu pengguna (nama,
  Status sinkronisasi, Perangkat, Keluar). Jarak antar-elemen 16 px dan
  antar-tab 8 px (mockup 20/4: token spasi tidak punya 20). Nama pengguna
  panjang dipotong ellipsis, tab tidak. Dijaga `tests/kasir-dom/header.test.js`
  dan `k14-tata-letak.test.js`.
- **Toolbar K-03** — delapan tombol ikon-di-atas-label (70×44, ikon 17 px,
  label 13/600). Bilahnya natural ~44 px, **bukan 68 px mockup**: memaksanya
  membuat K-03 kehilangan kartu pada 1024×768 (IA:62, `k03-kepadatan.test.js`).
- **Baris keranjang** satu tombol (min-tinggi 58 px) dengan lencana qty, tanpa
  stepper; qty diubah di layar Edit Item (tombol −/+ 56 px).
- **`.kasir-aksi-bawah`** — bilah aksi bawah generik, SAUDARA area yang
  menggulir (bukan anaknya) supaya aksi utama tetap terlihat tanpa menggulir:
  flex `none`, `padding: --space-3 --space-4`, `border-top: 1px solid --border`,
  latar `--surface`, aksi rata kanan. Dipakai K-12 tahap `review` ("Hitung
  ulang" + "Tutup Shift"). Dijaga `k12-aksi-slot.test.js`.
- **Pratinjau struk** — kertas putih (`--surface`) dengan `--shadow-raised`,
  `--font-mono` (`'Courier New', ui-monospace, monospace`) pada
  `--text-small` (13 px). **Satu-satunya pemakaian monospace di produk**
  (komentar di `tokens-mockup.css`); angka uang di layar lain tetap
  `tabular-nums`. Perataan tengah/kanan lewat `text-align`, bukan spasi.
- **K-07** — kartu dengan ikon centang, panel kembalian `--accent-soft`
  berangka 32/700 berwarna `--primary` (angka, bukan aksi kedua; aksen tetap
  satu aksi utama per layar), grid dua tombol.
- **K-12 tahap `review`** — dua kartu berdampingan (Rekonsiliasi kas ·
  Ringkasan shift); tahap `hitung` tidak berubah (hitungan buta).
- **Kolom nominal** (K-02 "Saldo awal kas", K-06 "Nominal diterima", K-12,
  Laci kas) — awalan `Rp`, rata kanan, dibaca `bacaRupiah`. `.field-lg` belum
  `tabular-nums` (DS #4) — utang di ledger.

---

## Verifikasi dokumen ini

- **69 token terdokumentasi pada commit `4dbe377`, 15 September 2026** — lihat
  catatan di kepala dokumen: sebagian nilainya digantikan keputusan kampanye
  Hidupkan desain, 26 September 2026, dan `packages/ds/tokens-mockup.css`
  (berkas sumber baru) tidak terhitung di angka ini.
- **Nol nilai diperkirakan pada commit itu.** Setiap hex, px, dan angka bobot
  yang TIDAK ditandai "digantikan"/"EFEKTIF" di atas dibaca dari berkas token
  pada commit `4dbe377`, bukan dari dokumen lain dan bukan dari ingatan. Nilai
  EFEKTIF yang ditandai demikian dibaca dari `packages/ds/tokens-mockup.css`
  dan `packages/ds/lumi.css` pada branch `hidupkan-desain-1-fondasi`.
- **Dua token dinyatakan belum terdefinisi** alih-alih diberi nilai karangan:
  `--chip` dan `--chip-soft`, yang disuntikkan inline oleh `gayaKategori`.
- **12 token dipisahkan** sebagai terdefinisi tanpa jalan ke layar, alih-alih
  didokumentasikan seolah aktif — potret 15 September, belum diverifikasi
  ulang terhadap kampanye ini.
- **Alasan di balik keputusan ditandai eksplisit** sebagai keputusan produk di
  setiap tempat ia muncul, karena ia tidak terbaca dari nilai token.
- **§ 10 ditambahkan Oktober 2026** (sub-proyek 2, kasir): deskriptif terhadap
  branch `hidupkan-desain-2d-kasir`; nilai yang tidak diukur test yang disebut
  di bagian itu tidak diklaim.
- **§ 8 dan § 9 ditambahkan 26 September 2026**, di luar audit token commit
  `4dbe377` — keduanya deskriptif terhadap kode yang ada di branch ini pada
  tanggal itu, bukan hasil pemindaian ulang seluruh dokumen.
