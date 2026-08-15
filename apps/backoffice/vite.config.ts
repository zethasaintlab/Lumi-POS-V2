import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Back-office. SENGAJA jauh lebih sederhana daripada `apps/kasir`, dan setiap
 * hal yang TIDAK ada di sini adalah keputusan:
 *
 * - **Tanpa `worker: { format: 'es' }`.** Itu ada di kasir hanya karena
 *   PowerSync memakai worker ber-code-splitting. Tidak ada PowerSync di sini.
 * - **Tanpa `optimizeDeps.exclude`.** Idem — ia menahan Vite menulis ulang
 *   `@powersync/web` dan `@journeyapps/wa-sqlite`.
 * - **Tanpa header COOP/COEP.** Keduanya ada di kasir untuk SQLite WASM +
 *   OPFS. Back-office adalah ONLINE-ONLY (`IA:§3.3`: setiap layar B-* bertanda
 *   ❌ offline); ia tidak menyimpan apa pun secara lokal.
 * - **Tanpa `server.fs.allow`.** Itu ada supaya `db/local/001-initial.sql`
 *   dapat diimpor `?raw` dari luar root Vite. Tidak ada skema lokal di sini.
 * - **Tanpa apa pun yang menyangkut Tauri.** Back-office berjalan di browser.
 *
 * ⛔ Menyalin config kasir apa adanya akan bekerja — dan itu justru
 * masalahnya. Ia akan menyeret PowerSync, wa-sqlite, dan seluruh rantai OPFS
 * ke dalam bundle yang tidak pernah memakainya, di aplikasi yang seluruh
 * nilainya adalah ringan.
 *
 * Port 1421 dipakai HMR Tauri (`apps/kasir/vite.config.ts`), jadi back-office
 * mengambil 1422 — dua aplikasi harus dapat berjalan bersamaan saat
 * pengembangan.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 1422,
    strictPort: true,
  },
});
