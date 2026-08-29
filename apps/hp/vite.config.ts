import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

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
  plugins: [react()],
  server: {
    port: 1423,
    strictPort: true,
  },
});
