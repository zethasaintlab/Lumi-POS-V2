import { defineConfig } from 'vite';

// Konfigurasi ini menuruni pelajaran prototipe 03 dua kali — sekali untuk
// `@sqlite.org/sqlite-wasm`, sekali lagi untuk `@journeyapps/wa-sqlite`.
// Gejala keduanya identik dan menyesatkan: "WebAssembly.instantiate():
// expected magic word", yang terbaca seperti berkas .wasm rusak padahal
// berkasnya tidak pernah dikirim — permintaannya dijawab HTML fallback.
export default defineConfig({
  server: {
    // 5174, bukan 5173 — prototipe 03 memakai 5173, dan keduanya perlu bisa
    // hidup bersamaan saat angkanya dibandingkan.
    port: 5174,
    strictPort: true,
    // AKAR REPO. `fs.allow` MENGGANTI daftar bawaan Vite, bukan menambahnya;
    // menyebut folder yang lebih sempit memutus akses ke node_modules.
    // Dua hal ada di luar folder prototipe: skema lokal di db/local/, dan
    // .wasm milik PowerSync di node_modules/.
    fs: { allow: ['../..'] },
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  // WAJIB untuk `@powersync/web`, dan hanya terlihat saat BUILD PRODUKSI —
  // `vite dev` berjalan hijau tanpanya. Default Vite untuk worker adalah
  // `iife`, sementara worker PowerSync memakai code-splitting:
  //
  //   Invalid value "iife" for option "worker.format" — UMD and IIFE output
  //   formats are not supported for code-splitting builds.
  //
  // `apps/kasir` akan menabrak ini juga.
  worker: { format: 'es' },
  // `@powersync/web` memuat worker DAN .wasm-nya sendiri saat runtime,
  // relatif terhadap URL modulnya. Pre-bundling memindahkannya ke .vite/deps
  // dan resolusi itu meleset.
  optimizeDeps: {
    exclude: ['@powersync/web', '@journeyapps/wa-sqlite'],
  },
});
