import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Build TERPISAH untuk galeri komponen — situs statis, nol infrastruktur.
 *
 * ## ⛔ Kenapa config sendiri dan bukan entry kedua di `vite.config.ts`
 *
 * Menambahkan `harness-galeri.html` ke `rollupOptions.input` produksi akan
 * memasukkan galeri ke bundel yang dikirim ke perangkat merchant — termasuk
 * `db-palsu.ts`, yang berisi katalog karangan dan shift karangan. Perangkat
 * kasir yang memuat data palsu di sampingnya adalah tepat jenis kecelakaan yang
 * tidak menghasilkan error sampai seseorang membukanya.
 *
 * Config terpisah membuat pemisahan itu STRUKTURAL: `npm run build` di
 * `apps/kasir` tidak tahu galeri ada, dan `npm run build:galeri` tidak
 * menghasilkan satu pun berkas di `dist/`. Dijaga
 * `tests/runtime/galeri-di-luar-produksi.test.js`.
 *
 * ## ⛔ Kenapa galeri BOLEH menjadi situs statis
 *
 * Ia memakai `DbLokal` palsu: nol PostgreSQL, nol PowerSync, nol token, nol
 * rahasia. Tidak ada satu pun permintaan jaringan yang dibuatnya, dan tidak ada
 * satu pun data merchant di dalamnya. Yang di-deploy adalah tampilan layar,
 * bukan aplikasinya.
 *
 * `base: './'` — path relatif, jadi build yang sama berjalan di root domain
 * preview MAUPUN di sub-path, tanpa satu variabel lingkungan pun (invariant #5).
 */
export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [react()],

  build: {
    outDir: '../../dist-galeri',
    emptyOutDir: true,
    rollupOptions: {
      // SATU entry, dan ia bukan `index.html`.
      input: `${__dirname}/harness-galeri.html`,
    },
  },

  // Sama alasannya dengan `vite.config.ts`: default worker Vite adalah `iife`,
  // dan `@powersync/web` (yang ikut lewat rantai impor `DbLokalProvider`)
  // memakai code-splitting. `vite dev` hijau tanpanya; hanya build yang gagal.
  worker: { format: 'es' },

  optimizeDeps: {
    exclude: ['@powersync/web', '@journeyapps/wa-sqlite'],
  },

  // `db/local/001-initial.sql` diimpor `?raw` dari akar repo, di luar root
  // Vite. Tanpa ini build menolak melayaninya.
  server: {
    fs: { allow: ['../..'] },
  },
});
