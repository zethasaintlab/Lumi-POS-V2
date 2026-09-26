# Fondasi desain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Di repo ini nama skill ditulis tanpa awalan `superpowers:` (lihat `CLAUDE.md` § Workflow Superpowers).

**Goal:** Mengganti kulit desain ketiga aplikasi dengan nilai mockup: palet, aksen, font, skala teks, radius, bayangan, ikon, wordmark, dan tampilan komponen. Tata letak layar tidak berubah.

**Architecture:** Nilai mockup ditulis di satu berkas, `packages/ds/tokens-mockup.css`. `packages/ds/lumi.css` mengarahkan nama token bundle ke nama mockup lewat `var()` dan menimpa kulit komponen. `ds-bundle/` tidak disunting. Ikon adalah salinan node Lucide 0.468.0 di `packages/ds/ikon.tsx`, dan impor ikon internal bundle dialihkan lewat plugin Vite.

**Tech Stack:** CSS custom properties, React 19 + Vite, `@fontsource/nunito-sans@5.3.0`, `node:test`, Playwright (Chromium di `/opt/pw-browsers`).

**Spec:** `docs/superpowers/specs/2026-09-26-fondasi-desain-design.md`. Keputusan kampanye: `docs/RENCANA-HIDUPKAN-DESAIN.md`.

## Global Constraints

Disalin kata demi kata dari sumbernya.

Dari `docs/RENCANA-HIDUPKAN-DESAIN.md`:

- Untuk **tampilan**, mockup adalah sumber kebenaran: palet, aksen, font, skala teks, radius, bayangan, spasi, komponen, tata letak, struktur navigasi, dan layar-layarnya.
- Untuk **perilaku** yang memindahkan uang, mengontrol kas, atau menyinkronkan data, spec dan test tetap menang.
- **Palet** — nilai mockup. Pengecualian: status netral dinaikkan minimal dari 4,37 ke 4,5 supaya lolos AA.
- **Font** — Nunito Sans, di-self-host sesuai kebijakan repo sejak F0.
- **Target sentuh:** elemen yang di mockup lebih kecil dari 44px tampil persis ukuran mockup, dengan area sentuh diperluas tanpa terlihat ke 44px, dan 56px untuk aksi uang.
- K-03 minimal 12 kartu pada 1024x768 (IA:62). Kalau ukuran mockup tidak memenuhinya, laporkan.
- Posisi Bayar sama untuk 0, 3, dan 20 item
- K-14 minimal 3 baris tabel
- Tinggi bilah nav sama di semua layar
- Nol hex hardcoded di komponen
- Ratchet `test:schema`
- Suite PostgreSQL berurutan
- **Penjaga yang memaku nilai lama:** Diubah dalam commit tersendiri yang menyebut keputusan kampanye ini, tidak pernah dicampur dengan kode yang membuatnya merah.

Dari `CLAUDE.md`:

- ⛔ **`ds-bundle/` adalah artefak VENDOR dan tidak pernah disunting langsung** (keputusan user, 31 Agustus 2026). Seluruh perubahan lewat override di `packages/ds`.
- ⛔ **Penjaga dulu, merah dulu.** Untuk setiap perubahan perilaku atau tata letak, tulis penjaganya lebih dulu dan buktikan ia MERAH terhadap kode lama, baru perbaiki.
- ⛔ **Sabotase setiap penjaga baru.** Kembalikan perubahannya dan pastikan penjaga merah **karena alasan yang benar**.
- ⛔ **Ukur, jangan baca.** Klaim tata letak dibuktikan lewat pengukuran DOM (`getBoundingClientRect`, `getComputedStyle`), bukan lewat membaca CSS.
- ⛔ **Penjaga invarian yang merah adalah pelanggaran**, bukan test yang perlu disesuaikan.
- **Periksa `ds-bundle/components.css` sebelum menulis satu pun kelas baru.**

Dari spec (nilai yang dipaku):

- Empat koreksi AA: `--status-pending-text #5c7177` · `--sidebar-label #5e7477` · `--step-inactive-text #596f71` · `--icon-muted #789b9c`. Tidak ada nilai warna lain yang menyimpang dari `sumber/tokens/colors.css`.
- Skala teks 32/20/15/13. Bobot: display 700, judul 600, body 400, label tombol 600. `--t-metric` dihapus.
- Ikon: node `lucide-react@0.468.0` apa adanya, tanpa dependency npm baru.
- Wordmark "LumiPOS": ikon `store` 20 px di kotak 36×36 `--radius-control` berlatar `--primary`, teks 20 px bobot 600.

## Prasyarat eksekusi

- Container baru: `bash tools/siapkan-dev.sh`, lalu `export PATH="/opt/nvm/versions/node/v24.7.0/bin:$PATH"`.
- Setiap penjaga `tests/kasir-dom/*` butuh `npm run build:galeri` lebih dulu.
- Sumber Lucide diunduh sekali ke scratchpad: `npm pack lucide-react@0.468.0` lalu ekstrak. Yang di-commit hanya node-nya (Task 6).
- Bahan dari PR #60 (tidak di-merge) dibaca lewat `git show d20e814:<path>`; ref `pr60` dapat diambil dengan `git fetch origin refs/pull/60/head:pr60`.

## Review Focus

1. **Tombol nonaktif** (`opacity .4`) di atas `--primary`. Kasir harus tetap dapat membaca label tombol Bayar yang nonaktif beserta alasannya. Task 9 mengukur kontras efektif teks alasan, yang tidak ikut transparan, di K-03 keranjang kosong.
2. **Teks 13 px yang lebih tinggi dari 12 px** di tabel padat K-14 dan K-08. Baris dapat bertambah tinggi sampai K-14 kurang dari 3 baris. Task 4 menjalankan `k14-tata-letak` sesudah perubahan skala, bukan hanya di akhir.
3. **Nama ikon lama yang tidak punya padanan Lucide persis** (misalnya `register`, `swap`). Pemanggil lama tidak boleh mendapat `null`, yang membuat ikon hilang tanpa error. Task 6 menguji setiap nama di `iconNames` merender `<svg>` dengan ≥ 1 anak.
4. **Layar HP 390 px** memakai wordmark dan Nunito. Teks masuk HP tidak boleh meluap secara horizontal. Task 8 mengukur `scrollWidth <= clientWidth` pada layar masuk HP di 390 px.
5. **Komponen bundle yang tetap memakai glyph lama** karena satu config Vite tidak memasang plugin ikon, misalnya harness yang ditambahkan kelak. Task 7 memindai setiap `apps/**/vite*.config.ts`, bukan daftar tetap.

---

### Task 1: Token mockup dan koreksi AA

**Files:**
- Create: `packages/ds/tokens-mockup.css`
- Create: `tests/runtime/token-mockup.test.js`
- Create: `tests/runtime/palet-kontras.test.js` (dari `git show d20e814:tests/runtime/palet-kontras.test.js`, ditulis ulang untuk palet mockup)

**Interfaces:**
- Produces: seluruh token mockup dengan nama mockup di `:root` (`--primary`, `--foreground`, `--card`, `--text-small`, `--radius`, `--shadow-raised`, …). Task 2–9 memakainya lewat `var()`.

- [ ] **Step 1: Tulis `token-mockup.test.js`**
  - `test('setiap token sumber ada di tokens-mockup.css dengan nilai yang sama, kecuali koreksi AA')`: parse ketiga berkas `docs/referensi-visual/sumber/tokens/*.css`, abaikan `@import` dan `font-family`. Assert jumlah token sumber `=== 90`, supaya penjaga tidak hijau karena memindai nol token. Assert setiap token sama persis setelah dinormalkan huruf kecil, kecuali `KOREKSI_AA`.
  - `KOREKSI_AA = { '--status-pending-text': '#5c7177', '--sidebar-label': '#5e7477', '--step-inactive-text': '#596f71', '--icon-muted': '#789b9c' }`.
  - `test('koreksi AA adalah SATU-SATUNYA penyimpangan')`: himpunan token yang berbeda dari sumber `deepEqual` kunci `KOREKSI_AA`.
  - `test('tokens-mockup.css tidak memuat @import')`: sumber mockup mengimpor Google Fonts, dan itu tidak boleh ikut. Font di-self-host.
- [ ] **Step 2: Tulis `palet-kontras.test.js`** dengan rumus luminans dari #60. Pasangan (teks, latar, ambang) dideklarasikan sebagai data:
  - `--foreground`, `--muted-foreground`, `--muted-foreground-strong` di atas `--background`, `--card`, `--secondary` → 4,5;
  - `--primary-foreground`/`--primary`, `--primary`/`--accent-subtle`, `--ghost-foreground`/`--card` → 4,5;
  - kelima pasangan status `-text`/`-bg`, `--offline-badge-text`/`-bg`, `--offline-banner-text`/`-bg`, putih di `--destructive` → 4,5;
  - `--sidebar-label` di `--card`, `--secondary`, `--background` → 4,5;
  - `--step-inactive-text`/`--step-inactive-bg` → 4,5;
  - `--icon-muted`/`--card` → 3,0.

  Assert juga jumlah pasangan yang diperiksa ≥ 20.
- [ ] **Step 3: Jalankan keduanya, harus MERAH.** `node --test tests/runtime/token-mockup.test.js tests/runtime/palet-kontras.test.js`. Yang diharapkan: `ENOENT` untuk `tokens-mockup.css`.
- [ ] **Step 4: Tulis `packages/ds/tokens-mockup.css`.** Satu blok `:root` yang menyalin ketiga berkas sumber apa adanya, beserta komentarnya, tanpa `@import` dan tanpa `font-family`. Keempat koreksi AA masing-masing diberi komentar yang menyebut kontras lama → baru.
- [ ] **Step 5: Jalankan lagi, harus HIJAU.** Lalu sabotase satu per satu, masing-masing dipulihkan sesudahnya, dan catat pesannya:
  - kembalikan `--status-pending-text` ke `#5e747a`: `palet-kontras` merah dengan pesan yang menyebut 4,37;
  - ubah satu nilai non-koreksi: `token-mockup` merah dengan pesan yang menyebut nama tokennya;
  - hapus satu token: merah.
- [ ] **Step 6: Commit** `feat(ds): token mockup di tokens-mockup.css dengan empat koreksi AA`.

### Task 2: Pengarahan nama bundle, halaman fondasi galeri, dan nol hex

**Files:**
- Modify: `packages/ds/styles.css` (impor `./tokens-mockup.css` sesudah `effects.css`, sebelum `base.css`)
- Modify: `packages/ds/lumi.css` (blok pengarahan warna, `--overlay`, `.overlay`)
- Create: `apps/kasir/src/galeri/Fondasi.tsx`
- Modify: `apps/kasir/src/galeri/Galeri.tsx` (entri `{ id: 'fondasi', nama: 'Fondasi desain', render: () => <Fondasi />, tanpaShell: true }`)
- Create: `tests/kasir-dom/palet-berlaku.test.js` (dari `git show d20e814:tests/kasir-dom/palet-berlaku.test.js`)
- Create: `tests/runtime/nol-hex-css.test.js`
- Modify: `tests/kasir-dom/warna-tombol.test.js` (sentinel dari `d20e814`, **commit tersendiri**)
- Modify: `tests/kasir-dom/galeri-cakupan.test.js` bila ia menolak layar baru

**Interfaces:**
- Consumes: token Task 1.
- Produces:
  - `Fondasi.tsx` mengekspor `Fondasi()` dengan bagian bertanda `data-fondasi="warna" | "teks" | "bentuk" | "ikon" | "wordmark" | "komponen"`. Task 3–9 menambah isi ke bagiannya dan mengukurnya di `?layar=fondasi`.
  - Pengarahan nama bundle sesuai tabel spec § 3.

- [ ] **Step 1: Commit tersendiri sentinel `warna-tombol`.** Terapkan perubahan `d20e814` pada `warna-tombol.test.js` (`bawaan.ink` dibaca dari halaman, bukan `rgb(20, 17, 15)`). Pesan commit: `test(kasir-dom): sentinel warna-tombol membaca --ink halaman — keputusan kampanye Hidupkan desain 26 Sep 2026`. Jalankan dan pastikan tetap hijau di kode lama.
- [ ] **Step 2: Tulis `palet-berlaku.test.js`.** Di layar galeri `K-03`, `K-08`, `K-12`, `K-14`, dan `fondasi`, `getComputedStyle` harus menghasilkan:
  - `body` color `rgb(22, 40, 44)` dan background `rgb(240, 246, 247)`;
  - `.btn-primary` background `rgb(20, 112, 107)` dan color `rgb(255, 255, 255)`. Ini G4, pengganti invarian aksen `#0D5C63`;
  - `.card` background `rgb(255, 255, 255)`.

  Warna lencana tidak diperiksa di sini, karena ia bergantung pada kulit komponen Task 9.

  Nilai pembanding dibaca dari `tokens-mockup.css` dan dikonversi ke `rgb()` di test, tidak diketik ulang. Assert setiap layar menemukan ≥ 1 elemen per selektor, kecuali selektor yang ditandai opsional per layar.
- [ ] **Step 3: Tulis `nol-hex-css.test.js`.**
  - Pindai `apps/*/src/**/*.css` dengan komentar dibuang. Nol `#[0-9a-f]{3,8}\b`, `rgba?\(`, dan `hsla?\(`.
  - Di `packages/ds/lumi.css`, literal hanya sah sebagai nilai deklarasi `--nama:` di dalam blok `:root`.
  - Assert ≥ 1 berkas dipindai untuk `kasir`, `backoffice`, dan `hp`.
- [ ] **Step 4: Jalankan, harus MERAH.** `palet-berlaku` merah karena warna lama. `nol-hex-css` merah pada `.overlay` bila ia ditulis di luar `:root`; bila ia sudah hijau, catat itu di laporan sebagai "hijau sejak awal". Layar `fondasi` belum ada.
- [ ] **Step 5: Implementasi.**
  - Impor di `styles.css`.
  - Blok pengarahan di `lumi.css` sesuai tabel spec § 3, beserta komentar daftar token bundle tanpa padanan.
  - `--overlay: rgba(22, 40, 44, .45)` dan `.overlay { background: var(--overlay); }`.
  - `Fondasi.tsx` bagian `warna`: satu swatch per token warna mockup, dengan nama dan nilai. Nilai dibaca `getComputedStyle(document.documentElement)` saat render, bukan diketik.
- [ ] **Step 6: Jalankan** `npm run build:galeri && node --test tests/kasir-dom/palet-berlaku.test.js tests/kasir-dom/warna-tombol.test.js tests/kasir-dom/galeri-cakupan.test.js && node --test tests/runtime/nol-hex-css.test.js`. Harus HIJAU.
- [ ] **Step 7: Sabotase**, masing-masing dipulihkan sesudahnya:
  - impor `tokens-mockup.css` dipindah ke sebelum token bundle: `palet-berlaku` merah dan menyebut `--primary`;
  - `color: #000` ditambahkan di `apps/hp/src/hp.css`: `nol-hex` merah dan menyebut berkasnya;
  - pengarahan `--accent` dihapus: merah.
- [ ] **Step 8: Invarian.** `node --test tests/kasir-dom/*.test.js` hijau. Pengecualian yang diharapkan hanya penjaga yang memaku bobot 500/600, yang diubah di Task 4. Catat yang merah beserta pesannya.
- [ ] **Step 9: Commit** `feat(ds): token bundle diarahkan ke nilai mockup; halaman fondasi galeri`.

### Task 3: Font Nunito Sans

**Files:**
- Modify: `package.json` (`@fontsource/nunito-sans` `5.3.0` masuk, `@fontsource/inter` keluar), lalu `npm install` untuk memperbarui lockfile
- Modify: `packages/ds/styles.css` (impor `@fontsource/nunito-sans/latin-{400,600,700,800}.css`)
- Modify: `packages/ds/lumi.css` (`--font-sans: 'Nunito Sans', system-ui, sans-serif`)
- Modify: `Fondasi.tsx` bagian `teks`
- Create: `tests/kasir-dom/font.test.js`

**Interfaces:**
- Produces: `--font-sans` bernilai Nunito Sans.

- [ ] **Step 1: Tulis `font.test.js`.**
  - Di `?layar=K-03` dan `?layar=fondasi`, `getComputedStyle(body).fontFamily` diawali `"Nunito Sans"`.
  - `document.fonts.check('600 15px "Nunito Sans"')` dan `'400 15px "Nunito Sans"'` bernilai `true` sesudah `document.fonts.ready`.
  - Setiap elemen `.num` di K-03 memakai `font-variant-numeric` yang memuat `tabular-nums`.
  - Tiga `<span class="num">` uji berisi `1111111111`, `0000000000`, dan `8888888888` sama lebarnya dengan selisih ≤ 0,5 px.
  - Cari dan assert tidak ada satu pun berkas `inter-*.woff2` di `dist-galeri`.
- [ ] **Step 2: Jalankan, harus MERAH** (font Inter).
- [ ] **Step 3: Implementasi** sesuai Files. Bagian `teks` di Fondasi menampilkan keempat ukuran beserta bobotnya dan satu baris angka `.num`.
- [ ] **Step 4: Jalankan, harus HIJAU.** Sabotase: `--font-sans` dikembalikan ke Inter, dan impor 600 dihapus. Keduanya harus merah.
- [ ] **Step 5: Invarian** `k03-kepadatan`, `k03-chrome`, `k03-bayar-tetap`, dan `k14-tata-letak` hijau. Bila merah karena lebar huruf: **berhenti dan laporkan**, jangan menyunting tata letak.
- [ ] **Step 6: Commit** `feat(ds): Nunito Sans di-self-host menggantikan Inter`.

### Task 4: Skala teks dan bobot, `--t-metric` dihapus

**Files:**
- Modify (**commit tersendiri**): `tests/kasir-dom/k01-login.test.js:157`, `k03-kepadatan.test.js:208-209`, `k06-tata-letak.test.js:178-179`; `tests/runtime/token-css-ada.test.js` (bagian `--t-metric`, baris ~145–180); `tools/oxlint-plugins/ds-adherence.mjs:55-82` (pesan)
- Modify: `packages/ds/lumi.css` (bagian skala teks)
- Modify: `Fondasi.tsx` bagian `teks`
- Create: `tests/kasir-dom/skala-teks.test.js`

**Interfaces:**
- Produces:
  - `--text-caption: var(--text-small)` (13);
  - `--weight-medium: var(--font-weight-semibold)` (600);
  - `--weight-bold: var(--font-weight-bold)` (700);
  - `.stat .t-title-lg { font-size: var(--text-display) }`;
  - `.shell-group { font-size: var(--text-small); font-weight: var(--font-weight-semibold); color: var(--sidebar-label) }`.

- [ ] **Step 1: Commit tersendiri, penjaga yang memaku nilai lama.**
  - `'20px/500'` menjadi `'20px/600'` dan `'32px/600'` menjadi `'32px/700'` di keempat assert.
  - `token-css-ada`: test `--t-metric` diganti `test('--t-metric tidak didefinisikan lagi; .stat .t-title-lg memakai --text-display')`.
  - `ds-adherence`: pesan menyebut "skala 32/20/15/13".

  Pesan commit: `test: penjaga skala teks mengikuti mockup — keputusan kampanye Hidupkan desain 26 Sep 2026`. Penjaga ini sekarang MERAH terhadap kode. Itu yang diharapkan, dan ia dicatat di laporan.
- [ ] **Step 2: Tulis `skala-teks.test.js`.** Kunjungi setiap entri galeri (daftar dibaca dari `LAYAR` lewat halaman, bukan diketik). Kumpulkan `fontSize` setiap elemen yang punya node teks tidak kosong. Assert himpunan ⊆ `{32px, 20px, 15px, 13px}`, dan jumlah elemen yang diperiksa ≥ 200. Pesan galat menyebut layar, selektor, dan ukurannya.
- [ ] **Step 3: Jalankan, harus MERAH** (12 px).
- [ ] **Step 4: Implementasi** pengarahan di Interfaces. Hapus definisi `--t-metric` beserta komentarnya, dan tulis ulang komentar kepala skala teks di `lumi.css`.
- [ ] **Step 5: Jalankan** `skala-teks`, keempat penjaga Step 1, dan `test:oxlint-ds-adherence` + `test:runtime`. Semua harus HIJAU. Sabotase: `--text-caption` dikembalikan ke 12 px. `skala-teks` harus merah dan menyebut `12px`.
- [ ] **Step 6: Invarian** `k14-tata-letak` (≥ 3 baris), `k08-riwayat`, `k03-kepadatan`. Bila merah, **berhenti dan laporkan**.
- [ ] **Step 7: Commit** `feat(ds): skala teks 32/20/15/13 dan bobot mockup; --t-metric dihapus`.

### Task 5: Radius, bayangan, target sentuh, dan area sentuh tak terlihat

**Files:**
- Modify: `packages/ds/lumi.css` (`--radius-card: var(--radius)`, `--shadow-sheet: var(--shadow-raised)`, `--touch-critical: var(--touch-primary)`, kelas `.sentuh` dan `.sentuh-uang`)
- Modify: `Fondasi.tsx` bagian `bentuk` (tiga radius, dua bayangan, dua tombol kecil 28×28 ber-`.sentuh` dan `.sentuh-uang`)
- Create: `tests/kasir-dom/area-sentuh.test.js`

**Interfaces:**
- Produces: kelas `.sentuh` (area tekan ≥ 44×44) dan `.sentuh-uang` (≥ 56×56). Keduanya dipakai sub-proyek 2.

- [ ] **Step 1: Tulis `area-sentuh.test.js`** di `?layar=fondasi`.
  - Untuk elemen `.sentuh` 28×28 yang terlihat, `document.elementFromPoint` di titik ±21 px dari pusatnya (horizontal dan vertikal) mengembalikan elemen itu.
  - Di ±23 px, elemen itu tidak dikembalikan. Ini membuktikan yang diukur adalah area 44, bukan seluruh halaman.
  - Untuk `.sentuh-uang` dipakai ±27 dan ±29.
  - `getBoundingClientRect` tetap 28×28, jadi tampilannya tidak membesar.
  - `getComputedStyle(el).borderRadius` sesuai: tombol 10 px, kartu 12 px.
- [ ] **Step 2: MERAH** (kelas belum ada).
- [ ] **Step 3: Implementasi.** `::before` absolut, `inset` negatif dihitung dengan `calc((var(--touch-min) - 100%) / -2)` atau `min-width`/`min-height` terpusat, transparan, dan tetap menerima pointer.
- [ ] **Step 4: HIJAU.** Sabotase: `::before` dihapus. Test ±21 harus merah dan menyebut 44.
- [ ] **Step 5: Invarian** `k06-penjaga` dan `k12-aksi-slot` hijau, karena tinggi tombol kritis berubah lewat `--touch-critical`.
- [ ] **Step 6: Commit** `feat(ds): radius, bayangan mockup, dan area sentuh tak terlihat`.

### Task 6: Ikon Lucide 0.468.0

**Files:**
- Create: `tests/fixture/lucide-0.468.0/nodes.json`, berisi node mentah untuk kelima puluh ikon mockup dan setiap ikon sumber pemetaan 48 nama bundle, diekstrak dari `dist/esm/icons/*.js`
- Create: `tools/ekstrak-lucide.mjs` (`node tools/ekstrak-lucide.mjs <dir-paket-lucide> <daftar-nama>` → `nodes.json`)
- Create: `packages/ds/ikon.tsx`, `packages/ds/LISENSI-LUCIDE` (dari `LICENSE` paket)
- Modify: `packages/ds/index.ts` (`Icon`, `iconNames`, `IconName` dari `./ikon.tsx`)
- Create: `tests/runtime/ikon-lucide.test.js`

**Interfaces:**
- Produces:
  - `export function Icon(props: { name: IconName; size?: number; strokeWidth?: number; className?: string; style?: CSSProperties } & SVGProps<SVGSVGElement>): JSX.Element`;
  - `export const iconNames: IconName[]`;
  - `export type IconName`.

  API-nya sama dengan `ds-bundle/components/forms/Icon.jsx`: `size` default 20, `aria-hidden="true"`.

- [ ] **Step 1: Ekstrak node.** Daftar nama mockup (50, kebab) dibaca dari impor `lucide-react` di `docs/referensi-visual/sumber/ui_kits/*/index.html` dan `sumber/components/**/*.jsx`.
  - Tentukan pemetaan 48 nama bundle ke nama Lucide dengan membandingkan path bundle dengan sumber Lucide. Ambil yang identik atau paling dekat bentuknya.
  - Tulis tabelnya sebagai `PETA_BUNDLE` di `ikon.tsx` beserta komentar untuk yang tidak identik.
- [ ] **Step 2: Tulis `ikon-lucide.test.js`.**
  - (a) Himpunan nama mockup yang diparse dari berkas mockup `=== 50`, dan setiap nama ada di `iconNames`.
  - (b) Untuk setiap nama di `nodes.json`, node yang dipakai `ikon.tsx` `deepEqual` node fixture. Ikon diimpor lewat `--experimental-strip-types`, atau node diekspor sebagai data `NODES` dari berkas `.ts` terpisah yang diimpor `ikon.tsx`; pilih yang membuat test tidak butuh JSX.
  - (c) Setiap entri `PETA_BUNDLE` menunjuk nama yang ada di `nodes.json`, dan ke-48 nama bundle ada di `iconNames`.
  - (d) Setiap nama di `iconNames` punya ≥ 1 node. Ini Review Focus 3.
  - (e) Atribut SVG induk: `viewBox 0 0 24 24`, `fill none`, `stroke currentColor`, `stroke-linecap round`, `stroke-linejoin round`, stroke-width bawaan 2.
- [ ] **Step 3: MERAH.**
- [ ] **Step 4: Implementasi.** `ikon.tsx` merender node dengan `createElement(tag, attrs)`, dengan atribut `key` dibuang. Kepala berkas mencatat versi, sumber, dan lisensi.
- [ ] **Step 5: HIJAU**, plus `npm run typecheck` dan `npm run lint:ds`. Sabotase: satu koordinat di node `circle-alert` diubah. (b) harus merah dan menyebut `circle-alert`.
- [ ] **Step 6: Commit** `feat(ds): set ikon dari node Lucide 0.468.0 apa adanya, tanpa dependency`.

### Task 7: Plugin Vite pengalih ikon bundle

**Files:**
- Create: `packages/ds/vite-ikon.ts`, dengan `export function ikonLumi(): Plugin` yang me-`resolveId` setiap impor `…/forms/Icon.jsx` dari dalam `ds-bundle/components/` ke `packages/ds/ikon.tsx`
- Modify: `apps/kasir/vite.config.ts`, `apps/kasir/vite.galeri.config.ts`, `apps/kasir/vite.k06.config.ts`, `apps/backoffice/vite.config.ts`, `apps/hp/vite.config.ts`
- Modify: `tests/runtime/ikon-lucide.test.js` (test pindai config)
- Create: `tests/kasir-dom/ikon-bundle.test.js`
- Modify: `Fondasi.tsx` bagian `ikon`

**Interfaces:**
- Consumes: `ikon.tsx` Task 6.
- Produces: `ikonLumi()`.

- [ ] **Step 1: Test pindai.** Setiap berkas `apps/**/vite*.config.ts` (glob, bukan daftar tetap; ini Review Focus 5) memuat `ikonLumi()` di `plugins`. Assert ≥ 5 berkas dipindai.
- [ ] **Step 2: Test DOM `ikon-bundle.test.js`.**
  - Di galeri K-03, `SyncIndicator` bundle merender `<svg>`. Anak pertamanya harus sama dengan node Lucide untuk nama itu dari `nodes.json`, bukan path bundle lama. Pembandingnya atribut `d`, `cx`, `r`, dan seterusnya.
  - Di `?layar=fondasi` bagian `ikon`, setiap nama di `iconNames` merender `<svg>` dengan jumlah anak sama dengan node fixture-nya.
- [ ] **Step 3: MERAH.**
- [ ] **Step 4: Implementasi.**
- [ ] **Step 5: HIJAU**, lalu `npm run build:galeri`. Sabotase: plugin dicabut dari `vite.galeri.config.ts`. Kedua test harus merah dan menyebut config serta ikonnya.
- [ ] **Step 6: Commit** `feat(ds): impor ikon internal bundle dialihkan ke set Lucide`.

### Task 8: Wordmark "LumiPOS"

**Files:**
- Create: `packages/ds/Wordmark.tsx`, dengan `export function Wordmark(): JSX.Element` yang merender `<span class="wordmark"><span class="wordmark-ikon"><Icon name="store" size={20}/></span><span class="wordmark-teks">LumiPOS</span></span>`
- Modify: `packages/ds/index.ts`, `packages/ds/lumi.css` (`.wordmark*`)
- Modify:
  - `apps/kasir/src/ShellKasir.tsx:70-86`, termasuk komentar yang menyebut aturan lama;
  - `apps/backoffice/src/App.tsx:230` (`brand={{ name: 'LumiPOS', logo: <Wordmark/> }}` atau bentuk yang dirender `AppShell`, diperiksa di DOM supaya nama tidak tampil dua kali);
  - `apps/backoffice/src/Masuk.tsx:116`, `apps/hp/src/Masuk.tsx:84`;
  - `<title>` di `apps/*/index.html` dan `apps/kasir/harness-galeri.html`: "LumiPOS — …"
- Modify: `Fondasi.tsx` bagian `wordmark`
- Create: `tests/kasir-dom/wordmark.test.js`
- Create: `tests/hp/masuk-lebar.test.js`, atau perluasan harness yang ada bila `tests/hp` punya harness DOM. Bila tidak ada, pengukuran HP 390 px dilakukan terhadap dev server `:1423` dan dicatat sebagai bukti di laporan, bukan test CI.

**Interfaces:**
- Consumes: `Icon` (`store`) Task 6.
- Produces: `Wordmark`.

- [ ] **Step 1: Test.** Di galeri K-03 (dengan shell):
  - `.wordmark-teks` berbunyi "LumiPOS", 20 px bobot 600;
  - `.wordmark-ikon` 36×36, background sama dengan `--primary`, border-radius 10 px, berisi `<svg>` dengan node `store`;
  - teks "Lumi POS" tidak ada di mana pun di DOM galeri.
- [ ] **Step 2: MERAH.**
- [ ] **Step 3: Implementasi.**
- [ ] **Step 4: HIJAU.** Sabotase: nama dikembalikan ke "Lumi POS". Test harus merah.
- [ ] **Step 5: Review Focus 4.** Layar masuk HP pada 390×844 memenuhi `document.documentElement.scrollWidth <= 390`.
- [ ] **Step 6: Invarian** tinggi bilah nav (`k14-tata-letak`) hijau.
- [ ] **Step 7: Commit** `feat(ds): wordmark LumiPOS di ketiga aplikasi`.

### Task 9: Kulit komponen

**Files:**
- Modify: `packages/ds/lumi.css` (bagian kulit komponen, sesuai tabel spec § 9)
- Modify: `Fondasi.tsx` bagian `komponen`. Setiap varian tombol ditampilkan normal, hover (kelas paksa `.paksa-hover` yang hanya ada di galeri), nonaktif, dan kritis. Juga keenam lencana, field normal dan galat, kartu, chip normal dan aktif, `product-card`, tab garis bawah, dan `.shell-group`.
- Create: `tests/kasir-dom/kulit-komponen.test.js`

**Interfaces:**
- Consumes: token Task 1–5.

- [ ] **Step 1: Test.** Di `?layar=fondasi`, `getComputedStyle` per komponen sama dengan nilai `sumber/components/*.jsx`. Nilai pembanding dibaca dari `tokens-mockup.css` di test:
  - `.btn`: height 44, radius 10, weight 600, font 15;
  - `.btn-critical`: height 56;
  - `.btn-secondary`: border `1px solid` `--input-border`;
  - `.btn-ghost`: color `--ghost-foreground`;
  - `.btn-danger`: background `--destructive`;
  - `.btn:disabled`: opacity 0.4;
  - `.badge`: radius ≥ 999 atau `9999px`, padding `4px 10px`, font 13 weight 400; keenam nada sesuai pasangan `-bg`/`-text`, dengan `neutral` → `pending`;
  - `.field input`: height 44, radius 10, border `--input-border`; galat → `--destructive`;
  - `.card`: radius 12, border `--border`, box-shadow `--shadow-card`;
  - `.chip[aria-pressed=true]`: background `--primary`; chip normal background `--card`;
  - `.shell-group`: font 13 weight 600.

  Assert jumlah komponen yang diukur ≥ 20.
- [ ] **Step 2: Review Focus 1.** Di galeri K-03 dengan keranjang kosong, teks alasan di samping Bayar yang nonaktif punya kontras ≥ 4,5 terhadap latarnya. Hitung dari warna yang dihitung browser, dengan opacity leluhur dikalikan.
- [ ] **Step 3: MERAH.**
- [ ] **Step 4: Implementasi.** Hanya selektor kelas bundle dan `var()`. Hover memakai `:hover` sungguhan dan `.paksa-hover` untuk galeri.
- [ ] **Step 5: HIJAU.** Sabotase dua kali: radius `.btn` dan warna `.badge-neutral`. Keduanya harus merah dan menyebut komponennya.
- [ ] **Step 6: Seluruh `tests/kasir-dom` hijau.** Termasuk `warna-tombol`, `k03-*`, `k06-*`, `k12-*`, dan `k14-*`.
- [ ] **Step 7: Commit** `feat(ds): kulit komponen mengikuti mockup`.

### Task 10: Dokumen

**Files:**
- Modify: `CLAUDE.md`, pada bagian yang disebut spec § 11
- Modify: `docs/DESIGN.md`, `docs/referensi-visual/README.md`, `docs/referensi-visual/PALET.md`
- Modify: `packages/ds/README.md` bila ia menyebut Inter, 12 px, atau ikon bundle

- [ ] **Step 1: Tulis ulang** sesuai spec § 11. Setiap bagian yang diganti menyebut "keputusan kampanye Hidupkan desain, 26 September 2026" dan menunjuk `docs/RENCANA-HIDUPKAN-DESAIN.md`.
  - Riwayat keputusan lama (Opsi A, 31 Agustus) diringkas menjadi satu kalimat "digantikan", tidak dihapus tanpa jejak.
  - `README.md` referensi-visual mencatat dua penyimpangan tampilan yang terlihat (`--sidebar-label`, `--step-inactive-text`).
- [ ] **Step 2: Periksa silang.** `grep -rn "0D5C63\|Inter\b\|--t-metric\|32/20/15/12\|\"Lumi POS\"" CLAUDE.md docs/DESIGN.md docs/referensi-visual/README.md packages/ds`. Setiap sisa kemunculan harus berupa kalimat riwayat yang menyatakan dirinya digantikan.
- [ ] **Step 3:** `npm run test:runtime` hijau. Ada penjaga yang membaca `CLAUDE.md`.
- [ ] **Step 4: Commit** `docs: aturan design system mengikuti keputusan kampanye Hidupkan desain`.

### Sesudah Task 10 (controller, bukan implementer)

- Jalankan seluruh suite secara berurutan: `test:runtime`, `test:domain`, `test:kasir`, `test:backoffice`, `test:hp`, `test:oxlint-ds-adherence`, `lint:ds`, `lint:react`, `typecheck`, `build:galeri` + `test:kasir-dom`, `test:schema`, dan suite PostgreSQL.
- Tangkap back-office dan HP dari dev server (layar masuk dan satu layar isi), lalu simpan di `docs/referensi-visual/fondasi/`.
- Tinjauan akhir branch (Opus 5.5). Setelah itu buka PR dengan link preview Vercel per layar galeri, ditambah `?layar=fondasi`. **Tidak di-merge sebelum user menyetujui preview.**
