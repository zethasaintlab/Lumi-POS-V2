import { defineConfig } from 'vite';

// Header COOP/COEP sama persis dengan apps/kasir/vite.config.ts.
//
// Ia dibutuhkan VFS OPFS berbasis SharedArrayBuffer. VFS SAHPool TIDAK
// membutuhkannya — dan salah satu hal yang diukur prototipe ini adalah
// apakah perbedaan itu penting bagi kita, karena dashboard owner (yang tidak
// butuh database lokal) lebih murah dilayani tanpa header ini.
export default defineConfig({
  server: {
    // AKAR REPO, bukan daftar folder yang lebih sempit.
    //
    // `fs.allow` MENGGANTI daftar bawaan Vite, bukan menambahnya. Versi
    // pertama menyebut ['..', '../../db'] dan justru memutus akses ke
    // node_modules -- permintaan sqlite3.wasm dijawab HTML fallback, dan
    // WebAssembly.instantiate gagal dengan "expected magic word". Kegagalan
    // yang terbaca seperti berkas .wasm rusak, padahal berkasnya tidak pernah
    // dikirim.
    //
    // Akar repo dibutuhkan karena DUA hal ada di luar folder prototipe:
    // skema lokal di db/local/, dan .wasm di node_modules/.
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
  // `@sqlite.org/sqlite-wasm` memuat berkas .wasm-nya sendiri saat runtime;
  // pre-bundling Vite mengacaukan resolusi path-nya.
  optimizeDeps: {
    exclude: ['@sqlite.org/sqlite-wasm'],
  },
});
