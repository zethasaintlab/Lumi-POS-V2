# Aplikasi kosong di Tauri dengan design system — F0 gate

**Status:** Disetujui · **Tanggal:** 31 Juli 2026
**Bagian dari:** Gate F0 — kriteria gate utama di `ARCH-lumi-pos-v1.md` §14 ("aplikasi kosong berjalan di Tauri"), sekaligus menutup item HANDOFF.md "self-host font Inter" dan separuh sisi-klien dari "header COOP/COEP".

## Konteks

`apps/kasir` dan `packages/ds` saat ini hanya berisi `README.md` placeholder. Tidak ada Vite config, tidak ada Tauri config/`src-tauri/`, tidak ada kode React sama sekali di repo manapun. `ds-bundle/` di root repo berisi design system final (token, 20 komponen React, CSS) — `CLAUDE.md` menyatakan ini **final, tidak boleh diubah**.

Masalah yang harus diselesaikan sebelum menulis kode: `ds-bundle/tokens/fonts.css` saat ini `@import` Google Fonts untuk Inter — persis hal yang menurut gate F0 harus diganti jadi self-hosted (prasyarat offline), tapi mengedit file itu langsung melanggar aturan "final, jangan diubah". Resolusi (dikonfirmasi user): **`packages/ds` yang menyediakan override, `ds-bundle` tidak tersentuh sama sekali.**

Batasan lingkungan yang ditemukan sebelum desain: **Rust/Cargo tidak terpasang** di mesin pengembangan ini, jadi `cargo tauri dev`/`build` tidak bisa dijalankan atau diverifikasi oleh saya. Ini ditangani secara eksplisit di bagian Verifikasi, bukan diabaikan.

## Keputusan desain

### 1. Struktur — tiga bagian baru, aditif

```
apps/kasir/
  package.json              # workspace package baru, nama "kasir"
  vite.config.ts
  tsconfig.json
  tsconfig.node.json
  index.html
  src/
    main.tsx
    App.tsx
  src-tauri/                # Tauri 2, config lengkap ditulis manual (lihat §4)
    Cargo.toml
    tauri.conf.json
    build.rs
    src/main.rs
    capabilities/default.json
    icons/                  # ikon placeholder minimal — Tauri mewajibkannya untuk build

packages/ds/
  package.json              # workspace package baru, nama "ds"
  index.ts                  # re-export tiap komponen dari ../../ds-bundle/components/**
  styles.css                # import token/base/components dari ds-bundle KECUALI fonts.css,
                             # + font-face lokal packages/ds sendiri sebagai gantinya
```

Tidak ada file di `ds-bundle/` yang diubah. Tidak ada file di-copy dari `ds-bundle/` ke `packages/ds/` — semua re-export lewat import relatif, `ds-bundle` tetap satu sumber kebenaran.

### 2. Font self-hosting — `@fontsource/inter`

Dependency npm (terverifikasi tersedia di registry, versi terbaru 5.3.0), bukan file font di-commit manual atau di-fetch runtime. Package ini membawa file `.woff2` Inter asli + `@font-face` CSS, di-bundle Vite ke output build seperti aset lain — genuinely offline setelah build, tanpa dependency CDN saat runtime.

`packages/ds` hanya mengimpor berat 400/500/600 (sama seperti yang sudah dinyatakan `ds-bundle/tokens/fonts.css` sebelumnya), lalu tetap memuat seluruh token/base/components CSS lain dari `ds-bundle` apa adanya.

### 3. Header COOP/COEP — dua tempat

Per `ARCH-lumi-pos-v1.md` §7 ("OPFS butuh header COOP/COEP — di-set di server dan konfigurasi Tauri"):
- Vite dev server: `server.headers` di `vite.config.ts`.
- Tauri: config keamanan di `tauri.conf.json`.

Kunci config Tauri 2 yang tepat akan dicek lewat dokumentasi terkini (Context7/WebFetch) saat implementasi, bukan ditebak dari memori — Tauri 2 mengubah banyak hal dari Tauri 1 dan detail config gampang basi.

Sisi server (Fastify) untuk COOP/COEP **di luar scope** — belum ada kode server sama sekali di `apps/server`, itu gap terpisah, bukan bagian sub-project ini.

### 4. Tauri 2 — ditulis manual, tidak lewat `cargo tauri init`

Karena Rust/Cargo tidak ada di mesin ini, `src-tauri/` ditulis manual mengikuti struktur Tauri 2 yang terdokumentasi (dicek lewat Context7/WebFetch saat implementasi untuk versi terkini), bukan hasil scaffold CLI. Konsekuensi: file-file ini **tidak bisa dikompilasi/diverifikasi** oleh saya sampai user memasang Rust dan menjalankan `cargo tauri dev` sendiri.

### 5. Isi layar kosong

`App.tsx` merender `<AppShell>` (kosong, tanpa konten bisnis) dari `packages/ds` plus satu baris status kecil bertuliskan "Lumi POS — F0" memakai kelas `.num`/token typography dari design system — cukup untuk membuktikan CSS, font, dan import komponen semuanya resolve dengan benar secara visual, tanpa logika atau layar bisnis apa pun.

## Di luar scope (sengaja tidak disentuh)

- Layar kasir sungguhan (F1+).
- `packages/domain`, `packages/contracts` — belum diintegrasikan.
- `apps/server` — belum ada kode Fastify sama sekali; sisi server COOP/COEP adalah gap terpisah.
- `apps/backoffice`.
- `npm run lint:ds` masuk CI (sub-project C terpisah, belum dikerjakan).

## Verifikasi

- `npm run dev` / `vite build` di `apps/kasir` — dijalankan dan diverifikasi sebagai bagian implementasi.
- `cargo tauri dev` — **tidak bisa dijalankan di lingkungan ini** (Rust/Cargo tidak terpasang). Ini adalah langkah verifikasi manual yang harus dilakukan user setelah memasang Rust — bukan langkah yang dilewati diam-diam, dicatat eksplisit di HANDOFF.md sebagai gate yang masih perlu bukti manual.
- Visual: halaman menampilkan `AppShell` kosong + teks status ter-render dengan font Inter (self-hosted, bisa dicek DevTools Network tab menunjukkan nol request ke fonts.googleapis.com) dan token warna/spacing dari `ds-bundle`.
