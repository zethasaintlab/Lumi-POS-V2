# kasir

React 19 + Vite SPA, dibungkus Tauri 2. SELURUH layar offline-capable. Komponen dari `/ds-bundle` lewat `packages/ds` (lihat README di sana) — jangan import `ds-bundle` langsung.

```bash
npm run dev          # Vite dev server saja (browser)
npm run build         # tsc + vite build -> dist/
npm run tauri dev     # app desktop penuh -- BUTUH Rust/Cargo terpasang
```
