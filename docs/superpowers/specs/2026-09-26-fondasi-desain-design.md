# Spec — Sub-proyek 1: Fondasi desain

Kampanye "Hidupkan desain LumiPOS apa adanya". Keputusan kampanye:
`docs/RENCANA-HIDUPKAN-DESAIN.md`. Rancangan disetujui user 26 September 2026,
bersama tiga jawaban (ikon opsi b, keempat token AA dinaikkan, wordmark
"LumiPOS").

## 1. Tujuan dan batas

Mengganti **kulit** desain ketiga aplikasi (`apps/kasir`, `apps/backoffice`,
`apps/hp`) dengan nilai mockup `docs/referensi-visual/sumber/`: palet, aksen,
font, skala teks, radius, bayangan, spasi, ikon, wordmark, dan tampilan
komponen dasar.

**Di luar sub-proyek ini** (sub-proyek 2 dan 3): tata letak layar, header satu
baris, toolbar delapan tombol, kartu pembayaran bertoggle, keranjang tanpa
stepper, pratinjau struk, layar back-office baru. Markup layar tidak diubah
kecuali di tiga tempat wordmark (§ 8).

**Selesai bila:**

1. Setiap penjaga di § 10 hijau di CI, termasuk invarian yang diukur ulang.
2. Preview Vercel galeri kasir, termasuk halaman `?layar=fondasi`, disetujui
   user. Sampai saat itu PR **tidak di-merge** (gerbang visual).

## 2. Arsitektur: nilai mockup di satu berkas, nama bundle diarahkan ke sana

```
docs/referensi-visual/sumber/tokens/*.css     (sumber, tidak disunting)
        │  disalin nilai per nilai
        ▼
packages/ds/tokens-mockup.css                 (nama mockup, SATU tempat nilai)
        │  var()
        ▼
packages/ds/lumi.css                          (nama bundle → nama mockup + kulit komponen)
        │
        ▼
ds-bundle/components.css + CSS aplikasi       (tidak berubah; memakai nama bundle)
```

- `packages/ds/styles.css` mengimpor `tokens-mockup.css` **sesudah** token
  bundle dan **sebelum** `lumi.css`.
- `ds-bundle/` tidak disunting satu byte pun (`ds-bundle-vendor.test.js`).
- Nilai warna, ukuran, radius, dan bayangan hanya ditulis di
  `tokens-mockup.css`. `lumi.css` hanya berisi `var(...)`, tidak pernah literal.
  Satu-satunya pengecualian adalah angka yang bukan token (misalnya
  `opacity: 0.4`).

Alternatif yang ditolak:

- Mengganti nama token di seluruh aplikasi ke nama mockup. Diff-nya besar, dan
  `components.css` bundle tetap memakai nama lama, jadi pengarah nama tetap
  dibutuhkan.
- Menulis ulang `components.css`. Ini mengulang kesalahan yang dicatat
  `CLAUDE.md` § "Datar BUKAN karena design system-nya austere".

## 3. Token warna

`tokens-mockup.css` memuat seluruh token `sumber/tokens/colors.css` dengan
nama dan nilai mockup, **kecuali empat koreksi AA**. Koreksinya digelapkan
seminimal mungkin dengan rona yang sama:

| Token | Mockup | Kontras | Nilai repo | Kontras | Latar yang diukur |
|---|---|---|---|---|---|
| `--status-pending-text` | `#5e747a` | 4,37 | `#5c7177` | 4,55 | `--status-pending-bg` |
| `--sidebar-label` | `#789194` | 3,35 | `#5e7477` | ≥ 4,53 | `--card`, `--secondary`, `--background` |
| `--step-inactive-text` | `#7b9597` | 2,71 | `#596f71` | 4,53 | `--step-inactive-bg` |
| `--icon-muted` | `#9ab4b5` | 2,19 | `#789b9c` | 3,01 (ambang non-teks 3:1) | `--card` |

⛔ **Penyimpangan tampilan yang terlihat hanya dua:** `--sidebar-label` dan
`--step-inactive-text` terlihat sedikit lebih gelap dari mockup. Keduanya
dicatat di `docs/referensi-visual/README.md`.

### Pemetaan nama bundle → nama mockup (di `lumi.css`)

| Bundle | Mockup |
|---|---|
| `--accent` | `var(--primary)` |
| `--accent-hover` | `var(--accent-hover)` (mockup) |
| `--accent-soft` | `var(--accent-subtle)` |
| `--accent-border` | `var(--card-outline-hover)` |
| `--on-accent` | `var(--primary-foreground)` |
| `--ink` | `var(--foreground)` |
| `--ink-muted` | `var(--muted-foreground)` |
| `--ink-subtle` | `var(--muted-foreground)` |
| `--surface` | `var(--card)` |
| `--surface-sunk` | `var(--background)` |
| `--surface-alt` | `var(--secondary)` |
| `--border` | `var(--border)` (mockup menimpa nama yang sama) |
| `--border-strong` | `var(--input-border)` |
| `--success` / `--success-soft` | `var(--status-success-text)` / `var(--status-success-bg)` |
| `--danger` / `--danger-soft` | `var(--status-danger-text)` / `var(--status-danger-bg)` |
| `--warning` / `--warning-soft` | `var(--status-warning-text)` / `var(--status-warning-bg)` |
| `--info` / `--info-soft` | `var(--status-info-text)` / `var(--status-info-bg)` |

⛔ **Tabrakan nama.** Mockup dan bundle sama-sama punya `--accent`,
`--accent-hover`, dan `--border`, dengan arti berbeda. `--accent` mockup
bernilai sama dengan `--primary`, jadi pengarahan `--accent: var(--primary)`
tidak mengubah artinya. Urutan impor di § 2 menjamin nilai mockup yang menang.
Implementer wajib mengukur nilai yang dihitung browser, bukan membaca CSS.

Token bundle **tanpa padanan** di mockup mempertahankan nilai bundle, dan
daftarnya ditulis sebagai komentar di `lumi.css`: `--success-border`,
`--danger-border`, `--warning-border`, `--info-border`, `--violet`,
`--violet-soft`, `--violet-border`.

Token milik `lumi.css` yang sudah ada:

- **Gradien permukaan** sudah disusun dari token (`--surface`, `--accent-soft`,
  …), jadi ia ikut berubah lewat pengarahan tanpa disunting.
- **`--overlay`** (`rgba(20, 17, 15, .45)`, rona tinta bundle) diganti rona
  `--foreground` mockup: `rgba(22, 40, 44, .45)`, rona yang sama dengan
  bayangan mockup. `.overlay` bundle, yang menulis warnanya literal, ditimpa
  ke `var(--overlay)`.
- **Warna kategori `--kat-1…6`** tidak punya padanan di mockup, yang memakai
  chip netral (keputusan kampanye). Nilainya **tidak diubah** di sub-proyek 1;
  nasibnya diputuskan sub-proyek 2 saat chip K-03 dibangun ulang.

## 4. Font

- `@fontsource/nunito-sans@5.3.0` bobot 400, 600, 700, 800, subset latin,
  menggantikan `@fontsource/inter`. Dependency Inter dihapus dari
  `package.json`.
- `--font-sans: 'Nunito Sans', system-ui, sans-serif`.
- **Angka tabular terukur, bukan diasumsikan.** Diukur di Chromium
  26 September 2026, 15 px: `1111111111`, `0000000000`, `8888888888` masing-masing
  90,02 px dengan dan tanpa `tabular-nums`. Digit Nunito Sans sama lebar
  secara bawaan. Aturan DS #4 (`.num`) tetap terpenuhi, dan penjaga § 10
  mengukurnya ulang.
- Font mono tetap hanya untuk pratinjau struk (`--font-mono`), yang dibangun
  di sub-proyek 2.

## 5. Skala teks — 32 / 20 / 15 / 13

| Token | px | Bobot | Line-height | Peran |
|---|---|---|---|---|
| `--text-display` | 32 | 700 | 1.15 | total, kembalian, angka KPI |
| `--text-title` | 20 | 600 | 1.3 | judul layar dan kartu |
| `--text-body` | 15 | 400 (600 label tombol) | 1.5 | teks, sel tabel |
| `--text-small` | 13 | 400 (600 kepala tabel) | 1.4 | label sekunder, keterangan, waktu |

- `--text-caption` (bundle) diarahkan ke `var(--text-small)`. Kelas `t-caption`
  karena itu merender 13 px.
- Bobot bundle diarahkan: `--weight-bold` → 700 untuk display, `--weight-medium`
  → 600 untuk judul. Mockup tidak punya bobot 500, dan subset font yang dimuat
  juga tidak.
  - ⛔ Konsekuensinya: kelas `t-body-md`, yang dipakai luas di kasir untuk
    teks body yang ditekankan, ikut merender 600. Ini terlihat di preview dan
    diputuskan di gerbang visual. Alternatifnya, `t-body-md` diarahkan ke 400,
    membuang penekanannya.
- ⛔ **`--t-metric` DIHAPUS.** Angka KPI di mockup memakai 32 px bobot 700
  (`ui_kits/backoffice/index.html`, `SummaryCard`). `.stat .t-title-lg`
  diarahkan ke `var(--text-display)`. Skala final kembali empat token.
- Token bundle 24, 28, dan 40 (`--text-title-lg`, `--text-heading`,
  `--text-hero`) tetap tidak dapat dihapus (vendor) dan tetap dilarang lint.
- 11 px di mockup hanya muncul di bilah Penjelajah (bukan produk) dan di dua
  lencana aplikasi pelanggan. Ia tidak masuk fondasi; sub-proyek 4 yang
  memutuskannya.

## 6. Radius, bayangan, spasi, target sentuh

- Radius: `--radius` 12 (kartu, panel, modal), `--radius-control` 10 (tombol,
  input, kotak ikon), `--radius-pill` 999 (lencana, chip). Bundle
  `--radius-card` diarahkan ke `var(--radius)`, `--radius-control` ditimpa
  nilai mockup.
- Bayangan: `--shadow-card` dan `--shadow-raised` mockup. Bundle
  `--shadow-sheet` diarahkan ke `var(--shadow-raised)`.
- Spasi: skala mockup identik dengan bundle (4/8/12/16/24/32). Bundle
  `--space-12` (48) dipertahankan.
- Target sentuh: `--touch-primary` mockup (56) diarahkan dari bundle
  `--touch-critical`.

### Mekanisme area sentuh tak terlihat

Kelas `.sentuh` dan `.sentuh-uang` di `lumi.css`: `position: relative` plus
`::before` absolut yang terpusat, minimal 44×44 (atau 56×56), tanpa warna.
Tampilan elemen tetap seukuran mockup; area tekannya yang meluas.

Kelas ini disiapkan di sini dan **dipakai di sub-proyek 2**. Penjaganya
mengukur area tekan lewat `document.elementFromPoint` di tepi kotak 44 dan 56
pada halaman fondasi, bukan membaca CSS.

## 7. Ikon — path Lucide 0.468.0 apa adanya, tanpa dependency

- Berkas `packages/ds/ikon.tsx` berisi set glyph dengan node disalin apa
  adanya dari `lucide-react@0.468.0` `dist/esm/icons/*.js` (elemen dan
  atributnya, termasuk `circle`, `line`, `rect`, `polyline`).
- Atribut SVG sama dengan Lucide: `viewBox="0 0 24 24"`, `fill="none"`,
  `stroke="currentColor"`, `stroke-width="2"`, `stroke-linecap="round"`,
  `stroke-linejoin="round"`.
- `packages/ds/LISENSI-LUCIDE` memuat lisensi ISC Lucide, dan kepala
  `ikon.tsx` mencatat versi sumbernya.
- **Isi set:**
  - Kelima puluh ikon yang dipakai mockup, dengan nama kebab Lucide (`circle-alert`,
    `layout-grid`, …).
  - Keempat puluh delapan nama bundle (`alert`, `refresh`, `register`, …) tetap
    ada supaya pemanggil lama tidak rusak, masing-masing menunjuk glyph Lucide
    asli yang menjadi sumbernya. Tabel pemetaan 48 nama ditetapkan di plan
    dengan membandingkan path bundle ke sumber Lucide, dan ditulis di kepala
    `ikon.tsx`.
- `packages/ds/index.ts` mengekspor `Icon`, `iconNames`, dan `IconName` dari
  `ikon.tsx`, bukan dari bundle.
- ⛔ **Komponen bundle mengimpor ikonnya sendiri** (`Modal`, `AppShell`,
  `StatCard`, `SyncIndicator`, `Ticket`, `Stepper` → `../forms/Icon.jsx`), dan
  berkas itu tidak dapat disunting. Impor itu dialihkan ke `ikon.tsx` lewat
  satu plugin Vite di `packages/ds/vite-ikon.ts`. Plugin itu dipasang di
  **setiap** config Vite: kasir, galeri, k06, backoffice, dan hp. Penjaga
  memeriksa kedua hal: setiap config memasangnya, dan SVG yang dirender di
  dalam komponen bundle memakai path Lucide.
- Tanpa dependency npm baru. Aturan kampanye untuk dependency: hanya boleh
  bila hasilnya tidak dapat didapat dengan menyalin. Encoder QR di
  sub-proyek 2 adalah kasus yang boleh diusulkan.

## 8. Wordmark "LumiPOS"

Keputusan user 26 September 2026 menggantikan aturan "logo, nama 'Lumi POS'
tidak disentuh".

- Komponen `packages/ds/Wordmark.tsx` berisi ikon `store` 20 px di kotak
  36×36 `--radius-control` berlatar `--primary`, lalu teks "LumiPOS" 20 px
  bobot 600. Ini mengikuti kepala `ui_kits/kasir/index.html`.
- Dipakai di tiga tempat yang sekarang menulis nama:
  - `ShellKasir.tsx` (`kasir-wordmark`);
  - `apps/backoffice/src/App.tsx` (`brand`, menggantikan `LogoLumi`);
  - layar masuk back-office dan HP.
- `<title>` halaman menjadi "LumiPOS — …". Teks "Lumi POS" di dalam dokumen
  dan komentar kode tidak diubah.

## 9. Kulit komponen

Override di `lumi.css`, hanya tampilan, tanpa perubahan markup, mengikuti
`sumber/components/*.jsx`:

| Kelas bundle | Mengikuti | Yang berubah |
|---|---|---|
| `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.btn-danger` | `Button.jsx` | tinggi `--touch-min`, radius 10, bobot 600, warna per varian, hover, nonaktif `opacity .4`, tekan `translateY(1px)` |
| `.btn-critical` | `Button.jsx` `primaryAction` | tinggi `--touch-primary` |
| `.badge-*` | `Badge.jsx` | pill, `4px 10px`, 13 px bobot 400, enam nada mockup. Bundle `neutral` → `pending`, `accent` → `accent` |
| `.field`, `input` | `Input.jsx` | tinggi 44, radius 10, tepi `--input-border`, galat `--destructive` |
| `.card` | kartu mockup | radius 12, tepi `--border`, `--shadow-card` |
| `.chip` | chip kategori mockup | pill netral, aktif `--primary` |
| `.product-card` | `ProductCard.jsx` | radius, tepi `--card-outline`, hover `--card-outline-hover` |
| `.tabs-underline`, `.shell-link` | `CashierNav.jsx` | aktif `--primary` dengan garis bawah 2 px, 13 px bobot 600 |
| `.shell-group` | label grup di `ui_kits/backoffice` | 13 px (`--text-small`) bobot 600 huruf kapital, warna `--sidebar-label`. Bundle menulis `font-size: 11px` literal, satu-satunya ukuran teks literal di CSS yang dimuat aplikasi |

Penjaga `warna-tombol` yang sudah ada tetap berlaku. Perbaikan sentinel dari
PR #60 dipakai ulang bila nilainya dibutuhkan.

## 10. Penjaga

Aturan repo: penjaga ditulis dulu, dibuktikan merah terhadap kode lama, lalu
disabotase. Penjaga yang memaku nilai lama diubah dalam **commit tersendiri**
yang menyebut keputusan kampanye.

| # | Penjaga | Berkas | Jenis |
|---|---|---|---|
| G1 | Nilai `tokens-mockup.css` sama dengan `sumber/tokens/*.css`, kecuali empat koreksi AA terdaftar. Penjaga juga membuktikan ia memindai ke-90 token sumber (68 warna, 13 spasi dan bentuk, 9 tipografi) | `tests/runtime/token-mockup.test.js` | dua sumber |
| G2 | Setiap pasangan teks/latar yang dideklarasikan ≥ 4,5, ikon ≥ 3,0. Dipakai ulang dari `palet-kontras` PR #60 | `tests/runtime/palet-kontras.test.js` | aritmetika |
| G3 | Warna yang dihitung browser di galeri (tombol utama, teks, latar, lencana) sama dengan nilai mockup. Dipakai ulang dari `palet-berlaku` PR #60 | `tests/kasir-dom/palet-berlaku.test.js` | DOM |
| G4 | Aksen yang dihitung browser sama dengan `--primary` mockup. Menggantikan invarian "aksen `#0D5C63`", yang belum punya penjaga | bagian dari G3 | DOM |
| G5 | Nol literal hex, `rgb()`, dan `hsl()` di CSS `apps/*/src/**`. Di `packages/ds/lumi.css` literal hanya boleh sebagai nilai deklarasi custom property di `:root` (hari ini `--overlay` dan `--kat-*`); di luar itu nol. Komentar diabaikan. Penjaga membuktikan ia memindai ≥ 1 berkas per aplikasi | `tests/runtime/nol-hex-css.test.js` | pindai |
| G6 | `font-family` yang dihitung adalah Nunito Sans, `document.fonts.check` benar, dan digit `.num` sama lebar | `tests/kasir-dom/font.test.js` | DOM |
| G7 | Setiap `font-size` yang dihitung di semua layar galeri termasuk {32, 20, 15, 13} | `tests/kasir-dom/skala-teks.test.js` | DOM |
| G8 | Setiap ikon yang dipakai mockup: node di `ikon.tsx` identik dengan `lucide-react@0.468.0`. Sumber pembandingnya salinan node Lucide yang di-commit di `tests/fixture/lucide-0.468.0/`, jadi tanpa jaringan. Penjaga juga menolak nama mockup yang tidak ada di set | `tests/runtime/ikon-lucide.test.js` | dua sumber |
| G9 | Setiap config Vite memasang `vite-ikon`, dan SVG di dalam komponen bundle yang dirender di galeri memakai path Lucide | `tests/runtime/ikon-lucide.test.js` + DOM | pindai + DOM |
| G10 | Area tekan `.sentuh` ≥ 44 dan `.sentuh-uang` ≥ 56, lewat `elementFromPoint` | `tests/kasir-dom/area-sentuh.test.js` | DOM |
| G11 | Wordmark tampil di ShellKasir: teks "LumiPOS" dan kotak ikon berlatar `--primary` | bagian dari G3 | DOM |

**Invarian yang diukur ulang sesudah token dan font berganti.** Lebar huruf
Nunito Sans berbeda dari Inter. Penjaganya sudah ada dan wajib hijau tanpa
disunting:

- ≥ 12 kartu pada 1024 dan 1280 (`k03-kepadatan`, `k03-chrome`);
- posisi Bayar tetap untuk 0, 3, dan 20 item (`k03-bayar-tetap`);
- K-14 ≥ 3 baris (`k14-tata-letak`);
- tinggi bilah nav sama (`k14-tata-letak`);
- hitungan buta K-12 (`k12-hitungan-buta`);
- QRIS layar penuh dan pembulatan (`k06-penjaga`).

Bila salah satunya merah karena ukuran mockup, itu kondisi berhenti: laporkan,
jangan kurangi apa pun diam-diam.

**Penjaga lama yang memaku nilai lama**, diubah dalam commit tersendiri:

- `tests/runtime/token-css-ada.test.js`: bagian `--t-metric`;
- `tools/oxlint-plugins/ds-adherence.mjs`: pesan yang menyebut 32/20/15/12 dan
  `--t-metric`;
- `tests/kasir-dom/warna-tombol.test.js` dan `k01-login.test.js`, bila memaku
  nilai lama (diperiksa di plan).

## 11. Dokumen yang ditulis ulang

Semuanya menyebut keputusan kampanye 26 September 2026:

- `CLAUDE.md`:
  - § Aturan design system: #1 (empat ukuran 32/20/15/13, tanpa token khusus),
    #2 (aksen `--primary` mockup), dan #8 (baris "tanpa gambar" yang sudah
    basi);
  - baris "Tidak boleh disentuh sama sekali: logo, nama 'Lumi POS', aksen
    teal";
  - § Skala teks final;
  - § Pelonggaran DS #8 ("palet tidak disentuh");
  - § Rebuild UI: baris invarian aksen dan nol hex, yang kini punya penjaga.
- `docs/DESIGN.md`: nilai token, font, skala, ikon, wordmark.
- `docs/referensi-visual/README.md`: bagian "Palet mockup ini BELUM
  DIPUTUSKAN" menjadi "diputuskan", dengan dua penyimpangan terlihat. Tabel
  "yang ditolak" disesuaikan dengan keputusan kampanye:
  - Yang kini **diterima**, untuk sub-proyek 2: QR di kartu, Transfer,
    toolbar, keranjang tanpa stepper, tombol konfirmasi bayar dengan perilaku
    yang dijaga, dan ukuran chip dengan area sentuh tak terlihat.
  - Yang **tetap ditolak** atau **diubah**: nomor `TRX-…`, saldo sebelum
    hitungan di K-12, dan kata "Pajak" (menjadi "Pajak" + nama tarif).
  - Ikon notifikasi tetap tercatat sebagai pertanyaan untuk sub-proyek 2.
- `docs/referensi-visual/PALET.md`: keputusan dan keempat koreksi.

## 12. Gerbang visual dan preview

- Galeri mendapat halaman `?layar=fondasi`. Isinya swatch setiap token warna
  dengan nama dan nilai, skala teks, radius, bayangan, set ikon dengan
  namanya, wordmark, dan setiap komponen di § 9 dalam semua keadaannya
  (normal, hover lewat kelas paksa, nonaktif, galat).
  - Halaman ini di luar bundel produksi, sama dengan galeri.
- PR menyertakan link preview Vercel per layar galeri, ditambah
  `?layar=fondasi`.
- Back-office dan HP tidak ada di preview Vercel. PR menyertakan tangkapan
  Playwright dari dev server (layar masuk dan satu layar isi masing-masing),
  dan dinyatakan **bukan** bagian gerbang.
- PR tidak di-merge sebelum user menyetujui preview.

## 13. Risiko yang dinyatakan

- **Lebar huruf.** Digit Nunito Sans sedikit lebih sempit dari digit tabular
  Inter (90,0 lawan 97,3 px per sepuluh digit pada 15 px), tetapi lebar huruf
  dan ukuran kecil 13 px (sebelumnya 12) belum diukur di layar. Kartu K-03,
  kolom tabel, dan tombol dapat meluap atau berpindah baris.
  Penjaga invarian yang menangkapnya; perbaikan tata letak di luar kulit
  adalah kondisi berhenti, bukan tambalan diam.
- **Warna komponen bundle yang ditulis literal** di `components.css` tidak
  ikut pengarahan token. Terhitung tiga baris (26 September 2026): `.switch
  .thumb`, `.overlay`, dan `.dialog`. Plan memeriksa ketiganya dan menimpa yang
  berupa warna di `lumi.css`.
- **HP dan back-office** berubah tampilan tanpa gerbang visual preview.
  Tangkapan di PR adalah satu-satunya bukti visualnya.
