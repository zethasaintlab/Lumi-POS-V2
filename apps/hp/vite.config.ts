import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { ikonLumi } from '../../packages/ds/vite-ikon.ts';

/**
 * Owner mobile (`IA:§4`). Konfigurasinya menyalin `apps/backoffice` — dan itu
 * disengaja: keduanya SPA online-only tanpa PowerSync, tanpa SQLite lokal,
 * tanpa Tauri, tanpa COOP/COEP.
 *
 * Yang TIDAK ada di sini, sama seperti di back-office dan dengan alasan yang
 * sama: `worker: { format: 'es' }` · `optimizeDeps.exclude` · header
 * COOP/COEP · `server.fs.allow`. Semuanya ada di kasir hanya karena PowerSync
 * dan OPFS.
 *
 * Port 1421 dipakai HMR Tauri (`apps/kasir`), 1422 back-office, jadi HP
 * mengambil 1423 — ketiganya harus dapat berjalan bersamaan saat pengembangan.
 */
export default defineConfig({
  // `ikonLumi()` (Task 7, `packages/ds/vite-ikon.ts`) — alih impor INTERNAL
  // `ds-bundle/components/**` ke set Lucide `packages/ds/ikon.tsx` (Task 6).
  // HP tidak memakai satu pun komponen bundel yang menyentuh `Icon.jsx`
  // internal hari ini (`grep -rln 'AppShell\|Modal\|StatCard\|
  // SyncIndicator\|Ticket\|Stepper' apps/hp/src` → hanya `App.tsx`,
  // sebagai KOMENTAR yang menjelaskan kenapa `AppShell` TIDAK dipakai) —
  // dipasang untuk KONSISTENSI dan supaya layar HP berikutnya yang memakai
  // salah satunya otomatis benar, bukan menunggu seseorang mengingat plugin
  // ini ada. Tidak disembunyikan (keputusan user 26 September 2026) — lihat
  // `CLAUDE.md` § Aturan design system dan `packages/ds/README.md`.
  plugins: [react(), ikonLumi()],
  server: {
    port: 1423,
    strictPort: true,
  },
});
