---
name: lumi-design
description: Use this skill to generate well-branded interfaces and assets for Lumi POS (design system untuk aplikasi Point of Sale kafe di Indonesia), either for production or throwaway prototypes/mocks/etc. Contains essential design guidelines, colors, type, fonts, assets, and UI kit components for prototyping.
user-invocable: true
---

Read the `readme.md` file within this skill, and explore the other available files.

If creating visual artifacts (slides, mocks, throwaway prototypes, etc), copy assets out and create static HTML files for the user to view. If working on production code, you can copy assets and read the rules here to become an expert in designing with this brand.

If the user invokes this skill without any other guidance, ask them what they want to build or design, ask some questions, and act as an expert designer who outputs HTML artifacts _or_ production code, depending on the need.

## Non-negotiables for Lumi (baca `readme.md` § ATURAN YANG MENGIKAT)

1. Tepat 4 ukuran teks (32/20/15/12); KDS membesar lewat `--scale`, bukan token baru.
2. Satu aksen teal `#0D5C63`, < 5% area, satu aksi utama/layar. Semantik hanya untuk status.
3. Target sentuh ≥ 44px; aksi menyangkut uang = 56px.
4. Angka uang selalu `tabular-nums` (kelas `.num`).
5. Status tidak pernah warna saja — selalu ada teks; di KDS + ikon.
6. Semua styling lewat token; tidak ada nilai warna/ukuran hardcoded di komponen.
7. Bahasa Indonesia. Setiap komponen punya keadaan kosong & error.

## Peta file

- `styles.css` — link satu file ini; ia meng-`@import` seluruh token + lapisan kelas.
- `tokens/` — colors, typography (+ `.kds-scale`), spacing, effects, fonts (Inter).
- `components.css` — kelas `.btn` `.field` `.card` `.badge` `.sync` `.product-card` `.stepper` `.chip` `.segmented` `.table` `.ticket` `.dialog`.
- `components/` — 15 komponen React (forms · data · pos · overlays); baca `*.prompt.md` tiap komponen untuk contoh pakai.
- `ui_kits/pos/` — rekreasi empat surface (Kasir · Kitchen Display · Tutup Kas · Laporan).
- `guidelines/` — kartu spesimen fondasi.

Untuk mock cepat tanpa build: link `styles.css` lalu pakai kelas dari `components.css` langsung (`<button class="btn btn-primary btn-critical">Bayar</button>`).
