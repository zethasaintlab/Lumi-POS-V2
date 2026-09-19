import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Build TERPISAH untuk harness DOM K-06 — hanya untuk test, nol infrastruktur.
 *
 * ## ⛔ Kenapa config sendiri, dan bukan entry kedua di config galeri
 *
 * `dist-galeri/` adalah pratinjau yang user tinjau dari HP. Menambah entry ke
 * sana mengubah keluaran yang ia lihat, dan harness ini bukan sesuatu yang
 * layak dilihat siapa pun kecuali penjaga. Direktori keluarannya sendiri
 * membuat keduanya tidak dapat saling menyeret.
 *
 * ## ⛔ Kenapa BUKAN entry di `vite.config.ts` produksi
 *
 * Alasan yang sama persis dengan galeri: berkas ini mengimpor
 * `src/galeri/db-palsu.ts`, yang berisi katalog karangan dan shift karangan.
 * Perangkat kasir yang memuatnya di samping data sungguhan adalah kecelakaan
 * yang tidak menghasilkan satu pun error sampai seseorang membukanya.
 *
 * Pemisahannya STRUKTURAL: `npm run build` di `apps/kasir` tidak tahu harness
 * ini ada.
 */
export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [react()],

  build: {
    outDir: '../../dist-harness-k06',
    emptyOutDir: true,
    rollupOptions: {
      input: `${__dirname}/harness-k06.html`,
    },
  },

  // Sama alasannya dengan kedua config lain: default worker Vite adalah `iife`,
  // dan `@powersync/web` (yang ikut lewat rantai impor `DbLokalProvider`)
  // memakai code-splitting.
  worker: { format: 'es' },

  optimizeDeps: {
    exclude: ['@powersync/web', '@journeyapps/wa-sqlite'],
  },

  // `db/local/001-initial.sql` diimpor `?raw` dari akar repo, di luar root Vite.
  server: {
    fs: { allow: ['../..'] },
  },
});
