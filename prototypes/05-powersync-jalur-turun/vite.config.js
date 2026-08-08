import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // 5173 dipakai prototipe 03, 5174 prototipe 04.
    port: 5175,
    strictPort: true,
    // AKAR REPO. `fs.allow` MENGGANTI daftar bawaan Vite, bukan menambahnya;
    // menyebut folder yang lebih sempit memutus akses ke node_modules dan
    // membuat .wasm dijawab HTML fallback. Pelajaran prototipe 03, dua kali.
    fs: { allow: ['../..'] },
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  // Wajib untuk `@powersync/web`, dan hanya terlihat saat build produksi.
  // Lihat prototypes/04-powersync-raw-tables/FINDINGS.md §6b.
  worker: { format: 'es' },
  optimizeDeps: {
    exclude: ['@powersync/web', '@journeyapps/wa-sqlite'],
  },
});
