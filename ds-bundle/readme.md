# Lumi-POS — Design System

Design system untuk aplikasi **Point of Sale kafe di Indonesia**. Web-based responsive, satu codebase untuk tiga konteks fisik yang sangat berbeda:

- **Tablet 10" di counter** (kasir berdiri, satu tangan, tangan sering basah) — target utama, 1024×768
- **Monitor dapur** (Kitchen Display, dibaca dari 2 meter, tanpa login) — 1920×1080, `--scale 1.6`
- **HP owner** (dibuka jam 23:00 untuk satu pertanyaan) — 390×844, hanya laporan + otorisasi

**Offline-first.** Kasir harus berfungsi penuh tanpa internet, jadi setiap komponen punya keadaan **tersinkron / mengantre-sync / gagal-sync** — bukan hanya keadaan normal.

**Prinsip pengikat.** Setiap keputusan visual harus bisa dijelaskan dengan menunjuk perilaku pengguna nyata. Kalau sebuah aturan tidak bisa dijelaskan begitu, aturan itu dibuang.

> **Nama aplikasi = Lumi-POS** (per brief) — ini nama produk/design system. **Contoh nama kedai = The Cafe by ORIGEN** — tenant fiktif yang dipakai di seluruh layar contoh (Laporan, Landing, QR, dsb.), bukan nama produk. Folder sumber memakai nama sementara "Lunas"/"POS Multi-Device" dan folder kit `ui_kits/rekanara/` adalah nama path internal; keduanya merujuk hal yang sama. Jangan campur keduanya: Lumi-POS = aplikasi, The Cafe by ORIGEN = kedai.ta contoh, bukan brand produk.

---

## Sumber

Semua nilai di sistem ini diangkat dari codebase read-only yang dilampirkan user (File System Access API), path `design-system/`:

| File sumber | Perannya |
|---|---|
| `tokens.css` | Sumber kebenaran token — warna, 4 ukuran teks, spacing, target sentuh, beserta alasan tiap keputusan sebagai komentar. **Diangkat verbatim** ke `tokens/*.css` + `components.css`. |
| `CONTEXT.md` | Ekstrak design-relevant PRD: persona + konteks fisik, viewport, format angka/tanggal Indonesia, katalog state (kosong/offline/gagal/ekstrem). Sumber untuk katalog state komponen. |
| `kasir.html`, `kds.html`, `tutup-kas.html`, `laporan.html` | Empat layar acuan — direkreasi di `ui_kits/pos/`. |
| `index.html` | Dokumentasi rasional (kenapa teal, kenapa Inter, kenapa 44/56px). |
| `tailwind.tokens.ts` | Pemetaan token → Tailwind theme (referensi konsumen React/Vite). |

Tidak ada Figma, tidak ada GitHub repo milik user. Tidak ada file logo.

---

## ATURAN YANG MENGIKAT

Bukan preferensi. Kalau sebuah layar tampak butuh melanggarnya, yang salah adalah layarnya.

1. **Tepat 4 ukuran teks:** 32 / 20 / 15 / 12 px. Tidak ada yang kelima. KDS membesar lewat `--scale` (1.6×), bukan token baru.
2. **Satu warna aksen:** deep teal `#0D5C63`, < 5% area layar, menandai satu aksi utama per layar. Warna semantik hanya untuk status, tidak pernah dekoratif.
3. **Target sentuh ≥ 44×44 px**, termasuk tombol kecil (stepper). Aksi menyangkut uang (Bayar, Tutup Kas, konfirmasi void): **56 px**.
4. **Semua angka uang tabular-nums.** Alasan Inter dipilih. Kelas `.num` wajib.
5. **Status tidak pernah warna saja** — selalu ada teks; di KDS ditambah ikon.
6. **Tidak ada nilai warna/ukuran/spacing ditulis langsung di komponen.** Semuanya lewat token → revisi satu file.
7. **Kontras minimal WCAG AA**, diuji di atas `#F0EDEA` (baris zebra), bukan putih. 8/8 pasangan lolos.
8. **Bahasa antarmuka: Indonesia.**
9. **Setiap komponen punya keadaan kosong & error**, bukan hanya normal.

---

## CONTENT FUNDAMENTALS

**Bahasa.** 100% Bahasa Indonesia, tanpa terjemahan kikuk. Kalimat instruksional pendek dan langsung ("Hitung dulu, baru sistem menampilkan angkanya"). Nada tenang dan operasional — ini alat kerja jam sibuk, bukan aplikasi konsumen yang ramah-berlebihan.

**Sudut pandang & sapaan.** Sistem berbicara netral/imperatif ke operator ("Pilih produk dari katalog", "Perlu diselesaikan sebelum menutup"). Tidak ada "kamu/Anda" yang cerewet, tidak ada sapaan personal. Owner dan kasir diperlakukan sebagai profesional yang sudah tahu konteksnya — tidak ada onboarding in-app, tidak ada tooltip, tidak ada wizard basa-basi.

**Casing.** Sentence case di mana-mana (label, tombol, judul). Tidak ada ALL-CAPS kecuali kode teknis (SKU `KOP-01`, `ORD-0231`). Judul layar ringkas: "Kasir", "Tutup Kas", "Laporan".

**Angka & format (Indonesia — wajib, langsung terlihat salah kalau keliru):**
- Uang: `Rp` + spasi + titik ribuan, **tanpa desimal** → `Rp 1.847.000`
- Uang negatif/diskon: minus di depan, warna danger → `− Rp 8.000`
- Persen tanpa spasi → `11%` · Jam 24-jam → `14:32` · Durasi KDS → `12m 04s`
- Tanggal → `26 Jul 2026` · Rentang → `11 Mei – 17 Mei 2026` · Qty → `2×`
- No. struk → `K1-20260726-0007` · No. meja → `A04`

**Empty & error copy.** Selalu tawarkan jalan keluar, bukan status buntu. Bedakan "belum ada data" dari "tidak ada yang cocok dengan filter". Kegagalan menjelaskan **alasan**, bukan spinner tanpa akhir ("Offline · 3 menunggu", "Gagal kirim (2) · Coba lagi").

**Emoji:** tidak dipakai. **Vibe:** tenang, jujur, fungsional — angka yang bisa dipercaya, bukan dashboard yang mengesankan.

---

## VISUAL FOUNDATIONS

**Warna.** Satu aksen deep teal `#0D5C63` (< 5% area, satu aksi utama/layar). Dipilih karena (1) bertahan terhadap glare layar counter, (2) tidak bentrok dengan semantik hijau/merah, (3) tidak dipakai kompetitor ID. Semantik: success `#137535`, warning `#B45309`, danger `#B91C1C` — hanya untuk status. Netral **hangat** (ink `#14110F`, surface `#F7F5F3`/`#F0EDEA`) — abu murni terasa klinis; sedikit kehangatan agar tidak terasa software rumah sakit. Tidak ada dark mode (di luar scope).

**Tipografi.** Inter, berat 400/500/600. Empat ukuran, titik. Angka uang selalu tabular (kelas `.num`) — alasan fungsional Inter dipilih, kolom angka tidak boleh bergoyang. Display 32/600, title 20/500, body 15/400, caption 12/400. KDS menskalakan seluruhnya ×1.6 lewat `.kds-scale`.

**Latar & imagery.** Tidak ada gambar, foto, gradien, tekstur, atau pola. Latar halaman `surface-sunk` (#F7F5F3), panel `surface` putih. Bidang datar penuh warna — kafe terang, apa pun yang halus hilang di bawah glare. Full-bleed hanya untuk warna panel, bukan imagery.

**Border & elevasi.** Kartu dibedakan oleh **border** (`#E2DDD8`), bukan bayangan. Bayangan minim: `shadow-card` nyaris tak terlihat (0 1px 2px / 5%); hanya bottom sheet keranjang punya bayangan jelas (`shadow-sheet`) karena ia mengambang. Tidak ada glow, tidak ada inner shadow dekoratif.

**Radius.** Dua saja: control 8px (tombol, input), card 12px (kartu, panel). Badge & chip pill penuh (999px).

**Animasi.** Sangat terkendali. Transition 0.12s pada `background-color`/`border-color` untuk hover/press — tidak ada bounce, tidak ada gerakan besar, tidak ada easing dramatis. Layar kerja: umpan balik cepat, bukan pertunjukan.

**Hover / press.** Hover: penggelapan halus (`btn-primary` → `accent-hover`; secondary/ghost → `surface-alt`); product-card → border+bg jadi `accent-soft`. Press/active: product-card border `accent`. Fokus keyboard: outline 2px `accent`, offset 2px. Tidak ada efek shrink/scale.

**Layout.** Elemen tetap: topbar & panel keranjang di kasir; header & kolom di KDS; tombol kritis sticky di dasar form. Density mengikat: min 12 kartu produk (tinggi 96px) tanpa scroll di 1024×768. Keranjang berubah dari bottom sheet (HP) jadi kolom kanan (≥900px). Transparansi & blur hanya pada overlay dialog (scrim `rgba(20,17,15,.45)`), tidak untuk dekorasi.

---

## ICONOGRAPHY

Ikon = **stroke SVG inline, gaya Lucide**: `viewBox="0 0 24 24"`, `stroke-width="2"`, round cap/join, tanpa fill, mewarisi `currentColor`. Sumber tidak menyertakan file SVG/icon-font/sprite terpisah — ikon ditulis inline di HTML. Keputusan sadar: satu file lebih sedikit, dan ikon POS yang dibutuhkan tidak banyak.

Diangkat ke komponen `Icon` (lihat "Intentional additions") dengan glyph yang benar-benar dipakai: `search`, `chevron-down/left/right`, `alert` (peringatan segitiga), `check`, `x`, `plus`, `minus`, `wifi-off`, `refresh`, `clock`, `receipt`, `lock`. Path `search`/`chevron-down`/`alert`/`check` diangkat verbatim dari SVG inline sumber; sisanya glyph Lucide setara dengan gaya stroke yang sama.

Emoji **tidak** dipakai. Unicode dipakai hemat hanya untuk simbol angka (`×`, `−`, `↑`/`↓` pada delta laporan). Ikon selalu mendampingi teks, tidak pernah menggantikannya (aturan status). **Tidak ada file logo** — logo sengaja dibuat setelah nama produk pasti; sampai itu brand dirender sebagai wordmark Inter 600 (lihat kartu Brand → Wordmark).

**Intentional additions.** `Icon` bukan primitif eksplisit di sumber (ikon di sana inline), tetapi diangkat jadi satu wrapper agar konsumen memakai set glyph & gaya stroke yang konsisten alih-alih menulis ulang SVG. Tidak ada primitif lain yang ditambahkan di luar yang tersirat oleh `tokens.css` + empat layar.

---

## Komponen

Semua di `components/<group>/` sebagai `Name.jsx` + `Name.d.ts` + `Name.prompt.md`; kartu grup di `*.card.html`. Memancarkan className dari `components.css` — tidak ada nilai warna/ukuran di JSX.

**forms/** — `Button` (primary/secondary/ghost/danger + `critical` 56px), `Field` (input/textarea, `size=lg` nominal uang, prefix Rp, error), `Stepper` (qty, tombol 44px), `Chip` (filter pilihan-tunggal), `SegmentedControl` (mode Dine In/Takeaway), `Switch` (toggle setelan, track 44px), `Icon` (glyph stroke Lucide).

**data/** — `Card`, `Badge` (5 tone status + info/violet, teks wajib), `SyncIndicator` (ok/queued/failed/offline-only), `Table` (zebra, kolom uang tabular, empty bawaan), `EmptyState` (CTA / jam berjalan), `StatCard` (KPI, garis-atas tone modul), `Avatar` (inisial).

**navigation/** — `AppShell` (kerangka admin: sidebar berkelompok + topbar breadcrumb + konten), `Tabs` (pill / underline).

**pos/** — `ProductCard` (96px, state habis), `CartRow` (baris keranjang + stepper), `Ticket` (tiket KDS, fulfillment per item, penanda terlambat).

**overlays/** — `Modal` (form/detail umum: New Customer, Add Table), `ConfirmDialog` (aksi merusak: void/refund/tutup kas — PIN owner + alasan dari daftar tertutup, "Lainnya" wajib catatan, konfirmasi danger 56px).

## UI Kit

**`ui_kits/pos/`** — rekreasi interaktif empat surface inti Lumi: Kasir, Kitchen Display, Tutup Kas, Laporan. Buka `ui_kits/pos/index.html`.

**`ui_kits/rekanara/`** (kedai contoh **The Cafe by ORIGEN**) — produk penuh (referensi FreeKasir) **di-reskin ke bahasa Lumi** (teal · Inter · netral hangat), bukan disalin apa adanya. Buka `ui_kits/rekanara/index.html`; bilah konteks atas beralih antara: **Admin** (AppShell + sidebar penuh: Dashboard, Shift & Schedule, Settings, Access Control, Reservations, Customers, Table Management, Table Monitoring), **POS**, **Kitchen Display**, **QR Sticker**, **Landing**, **Customer Order**. Item sidebar yang tidak punya layar contoh menampilkan placeholder jujur, bukan layar palsu. Warna asli produk (hijau/biru/oranye) diganti aksen teal; primary tetap satu per layar.

> **Catatan pelonggaran aturan (kit The Cafe by ORIGEN).** Atas permintaan, produk penuh melonggarkan dua aturan inti: skala tipografi diperluas (tambah `--text-hero/heading/title-lg` untuk halaman marketing & dasbor) dan palet ditambah warna modul (`--info` biru, `--violet` reservasi) **khusus untuk identitas modul & kartu KPI, bukan aksi utama**. Empat surface inti di `ui_kits/pos/` tetap patuh penuh pada aturan asli Lumi. Aksi utama di seluruh kit tetap satu-per-layar dan tetap teal.

---

## Index / manifest (root)

- `styles.css` — entry konsumen (daftar `@import` saja)
- `tokens/` — `fonts.css` (Inter), `colors.css`, `typography.css` (+ kelas `.t-*`, `.kds-scale`), `spacing.css`, `effects.css`
- `base.css` — reset, body, `.num`, utilitas layout
- `components.css` — lapisan kelas (`.btn`, `.field`, `.card`, `.badge`, `.sync`, `.product-card`, `.stepper`, `.chip`, `.segmented`, `.table`, `.empty`, `.ticket`, `.dialog`)
- `components/` — forms · data · navigation · pos · overlays (21 komponen)
- `ui_kits/pos/` — empat surface inti Lumi + README
- `ui_kits/rekanara/` — produk penuh kedai contoh The Cafe by ORIGEN, di-reskin ke Lumi (data.js + 13 layar + index)
- `guidelines/` — kartu spesimen fondasi (Colors, Type, Spacing, Brand)
- `thumbnail.html` — tile homepage design system
- `SKILL.md` — pembungkus Agent Skill

## Fonts

Inter dimuat dari Google Fonts (`@import` di `tokens/fonts.css`), persis seperti sumber. Tidak ada file font lokal dan **tidak ada substitusi** — sumber memang memakai Inter dari Google Fonts. Kalau ingin self-host, ambil dari rsms.me/inter.
