import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { ikonLumi } from '../../packages/ds/vite-ikon.ts';

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
  // `ikonLumi()` (Task 7, `packages/ds/vite-ikon.ts`) — alih impor INTERNAL
  // `ds-bundle/components/**` (mis. `AppShell`, `Modal`, `StatCard`) dari
  // `forms/Icon.jsx` bundel ke set Lucide `packages/ds/ikon.tsx` (Task 6).
  // Back-office memakai `AppShell` di setiap layar; tanpa plugin ini bilah
  // navnya merender ikon bundel lama di sebelah ikon Lucide yang benar di
  // `<Icon>` publik. Tidak disembunyikan (keputusan user 26 September 2026)
  // — lihat `CLAUDE.md` § Aturan design system dan `packages/ds/README.md`.
  plugins: [react(), ikonLumi()],
  server: {
    port: 1422,
    strictPort: true,
  },
});
