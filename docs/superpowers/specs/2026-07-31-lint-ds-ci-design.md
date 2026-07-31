# `npm run lint:ds` hijau dan masuk CI — F0 gate

**Status:** Disetujui · **Tanggal:** 31 Juli 2026
**Bagian dari:** Gate F0, item terakhir yang tersisa — `CLAUDE.md` § F0-checklist ("`_adherence.oxlintrc.json` wajib masuk CI sejak commit pertama") dan `HANDOFF.md`.

## Konteks

`npm run lint:ds` (`oxlint --config ds-bundle/_adherence.oxlintrc.json apps packages`) gagal total saat ini — oxlint 1.76.0 (versi terpasang) menolak parse config dengan `unknown field \`x-omelette\``. Investigasi lebih dalam menemukan masalah yang jauh lebih mendasar dari sekadar field tak dikenal:

1. **`x-omelette`** — blok metadata besar (daftar 21 komponen + daftar ~50 token CSS) di root config. oxlint ≤1.0.0 mentolerir field tak dikenal secara diam-diam; oxlint 1.76.0 menolaknya. Pinning versi *teknisnya* menghindari error ini.

2. **Tapi pinning tidak memperbaiki apa pun, karena `no-restricted-syntax` — rule di balik seluruh pengecekan hex/px/font-family mentah dan whitelist prop per-komponen — tidak diimplementasikan oxlint sama sekali.** Dikonfirmasi lewat dokumentasi resmi oxlint (Context7) dan uji langsung: menjalankannya eksplisit menghasilkan `Rule 'no-restricted-syntax' not found in plugin 'eslint'`. oxlint mengimplementasikan >700 rule inti ESLint, tapi bukan `no-restricted-syntax` — rule generik berbasis AST-selector yang butuh engine selector penuh (mirip esquery), yang beda arsitektur dari cara oxlint (Rust, native) mengimplementasikan rule.
   Ini berarti **seluruh whitelist prop per-komponen dan pengecekan hex/px/font-family mentah di file ini belum pernah benar-benar berjalan, di versi oxlint manapun** — bukan regresi dari commit terbaru. `x-omelette` cuma checker pertama yang kebetulan menyadari ada yang salah.

3. **`no-restricted-imports`** (rule asli oxlint, benar-benar ada) tidak terbukti menyala di uji langsung saya — pola glob-nya (`"components/forms/**"`, dst.) berbentuk bare specifier, sedangkan import nyata di repo ini selalu relatif (`../../ds-bundle/components/forms/Button.jsx` dari `packages/ds/index.ts`). Kemungkinan besar tidak pernah cocok terhadap import path yang sesungguhnya dipakai repo ini.

4. **Tidak ada CI sama sekali** di repo ini — tidak ada `.github/workflows/`, tidak ada git remote (dikonfirmasi sejak sub-project A: repo belum pernah di-push). "Masuk CI" berarti membuat pipeline dari nol.

`ds-bundle/_adherence.oxlintrc.json` **final, tidak boleh diubah** (`CLAUDE.md`) — jadi perbaikan apa pun harus hidup di luar `ds-bundle/`.

**Keputusan yang dikonfirmasi user:**
- Rule yang hilang (`no-restricted-syntax`) diperbaiki dengan menulis **JS Plugin oxlint pendamping** yang mengimplementasikan ulang pengecekan yang sama, bukan mempersempit cakupan atau menyerahkannya sebagai cacat upstream.
- Plugin yang sama **juga** menangani pembatasan import (bukan mengandalkan `no-restricted-imports` native oxlint yang belum terbukti jalan) — satu mekanisme konsisten untuk semua aturan `x-omelette`.
- File workflow CI **tetap ditulis sekarang** meski belum ada remote GitHub untuk menjalankannya end-to-end — sama polanya dengan gap Rust/Tauri di sub-project B (persiapan + verifikasi lokal semaksimal mungkin, eksekusi nyata jadi langkah manual user).

## Keputusan desain

### 1. Struktur — dua bagian baru, aditif, di luar `ds-bundle/`

```
tools/
  oxlint-plugins/
    ds-adherence.js        # JS Plugin oxlint: parse selector dari ds-bundle/_adherence.oxlintrc.json,
                            # implementasikan sebagai rule oxlint asli
  generate-oxlint-config.js  # baca ds-bundle/_adherence.oxlintrc.json (read-only),
                              # tulis config turunan (git-ignored) yang oxlint bisa parse

.github/
  workflows/
    lint-ds.yml             # trigger push/pull_request, Node 22, npm ci, npm run lint:ds

tests/
  oxlint-ds-adherence/
    plugin.test.js           # unit test tiap bentuk selector
    integration.test.js      # end-to-end: oxlint asli + config turunan + fixture pelanggaran
```

`ds-bundle/_adherence.oxlintrc.json` tidak disentuh sama sekali — tetap satu-satunya sumber kebenaran untuk *apa* yang di-enforce. `tools/` yang menyediakan mesin enforcement yang oxlint sanggup jalankan.

### 2. `generate-oxlint-config.js` — config turunan, bukan config baru yang ditulis tangan

Membaca `ds-bundle/_adherence.oxlintrc.json`, lalu:
- Membuang field `x-omelette` (bikin oxlint bisa parse sama sekali).
- Mengganti entry `rules["no-restricted-syntax"]` dan `rules["no-restricted-imports"]` dengan nama rule dari plugin kita (`ds-adherence/no-restricted-syntax`, `ds-adherence/no-restricted-imports`).
- Menambahkan `"jsPlugins": ["./tools/oxlint-plugins/ds-adherence.js"]`.
- Mempertahankan `react/forbid-elements` dan `overrides` apa adanya (rule native yang sudah berfungsi).
- Menulis hasil ke `.oxlintrc.generated.json` (root repo, ditambahkan ke `.gitignore` — dibuat ulang tiap kali `lint:ds` jalan, bukan artefak yang di-commit).

`npm run lint:ds` menjadi dua langkah: `node tools/generate-oxlint-config.js && oxlint --config .oxlintrc.generated.json apps packages`.

### 3. `ds-adherence.js` — JS Plugin, parse selector dari sumber aslinya

Alih-alih menyalin ~20 whitelist prop komponen dengan tangan ke JS (rawan drift dari `ds-bundle/`, rawan salah ketik), plugin **membaca ulang** `ds-bundle/_adherence.oxlintrc.json` saat load dan mem-parse tiap string selector di `rules["no-restricted-syntax"]`. Semua selector di file ini mengikuti persis 4 bentuk:

1. `Literal[value=/regex/]` tanpa scope komponen → larangan literal generik (hex/px/font-family).
2. `JSXOpeningElement[name.name='X'] > JSXAttribute > JSXIdentifier[name!=/^(?:...)$/]` → whitelist nama prop untuk komponen X.
3. `JSXOpeningElement[name.name='X'] > JSXAttribute[name.name='Y'] > Literal[value!=/^(?:...)$/]` → whitelist nilai enum untuk prop Y di komponen X.
4. `patterns[].group` di `rules["no-restricted-imports"]` → pola import terlarang.

Plugin mengenali ke-4 bentuk ini dan menerjemahkannya jadi pengecekan AST asli (visitor `JSXOpeningElement`, `ImportDeclaration`, `Literal`). **Selector yang tidak cocok salah satu dari 4 bentuk ini membuat plugin gagal load dengan pesan error yang menyebutkan selector persis yang bermasalah** — bukan diam-diam dilewati. Ini strategi fail-loud yang sama dipakai di seluruh proyek ini (lihat invariant CLAUDE.md soal `[ASUMSI]` — jangan menebak lalu lanjut).

Untuk pembatasan import: plugin mencocokkan pola `group` (mis. `"components/forms/**"`) terhadap **path import yang sudah di-resolve** (relatif terhadap `ds-bundle/`), bukan string specifier mentah — jadi `../../ds-bundle/components/forms/Button.jsx` dari manapun sumbernya tetap cocok terhadap `components/forms/**`. Override yang aslinya mengecualikan `**/index.js` diperluas mencakup `packages/ds/index.ts` juga (file wrapper resmi yang justru dirancang untuk melakukan deep-import ini — file itu belum ada saat `_adherence.oxlintrc.json` pertama ditulis).

### 4. CI — `.github/workflows/lint-ds.yml`

Trigger `push` dan `pull_request`, job tunggal: checkout → setup Node 22 (cocok `engines` di `package.json` root) → `npm ci` → `npm run lint:ds`. Tidak ada matrix, tidak ada caching custom di luar default `actions/setup-node` — YAGNI untuk satu job lint yang berjalan dalam hitungan detik.

## Di luar scope (sengaja tidak disentuh)

- SQLite WASM+OPFS berjalan di browser — bukan item gate F0 (dicek ulang: `CLAUDE.md` cuma mensyaratkan header COOP/COEP sebagai *prasyarat*, bukan OPFS itu sendiri berjalan) — F1+.
- `react/forbid-elements` — sudah berfungsi native, daftar `forbid` masih kosong, tidak ada yang perlu diperbaiki.
- Membangun ulang esquery/selector engine generik — plugin ini cuma mengenali 4 bentuk selector yang benar-benar ada di file, bukan AST-selector language lengkap.
- Menjalankan workflow CI ini secara nyata di GitHub — tidak ada remote, jadi tidak bisa diverifikasi end-to-end di lingkungan ini (sama seperti gap `cargo tauri dev` di sub-project B).

## Verifikasi

- `node tools/generate-oxlint-config.js` menghasilkan JSON valid tanpa `x-omelette`, dicek dengan `JSON.parse`.
- `npx oxlint --config .oxlintrc.generated.json apps packages` keluar exit 0 pada kondisi kode saat ini (`apps/kasir`, `packages/ds` — hasil sub-project B, sudah bersih).
- Test unit: tiap satu dari 4 bentuk selector diuji menyala pada fixture pelanggaran dan diam pada fixture yang patuh (dua arah, supaya false-positive juga ketahuan).
- Test: selector bentuk ke-5 yang sengaja tidak dikenali membuat plugin gagal load dengan error yang jelas, bukan lolos diam-diam.
- Test integrasi: `npx oxlint` sungguhan (bukan simulasi) dijalankan terhadap file fixture nyata memakai config turunan + plugin.
- `npm run lint:ds` dari root, exit 0.
- `.github/workflows/lint-ds.yml` — YAML valid (`js-yaml` parse atau setara), dan command yang sama persis (`npm ci && npm run lint:ds`) dijalankan manual secara lokal dan dipastikan hijau. Eksekusi nyata di GitHub Actions **tidak bisa diverifikasi di sini** — langkah manual user setelah repo di-push, dicatat eksplisit di `HANDOFF.md`, bukan diklaim selesai begitu saja.
