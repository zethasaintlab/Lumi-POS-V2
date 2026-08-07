import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },

  // Dipasang SEBELUM `@powersync/web` masuk, bukan sesudah.
  //
  // Default Vite untuk worker adalah `iife`, sementara worker PowerSync
  // memakai code-splitting. `vite dev` berjalan hijau tanpa baris ini;
  // yang gagal hanya `vite build`:
  //
  //   Invalid value "iife" for option "worker.format" — UMD and IIFE output
  //   formats are not supported for code-splitting builds.
  //
  // Diukur di prototypes/04-powersync-raw-tables (FINDINGS §6b). Jebakannya
  // bukan kegagalannya melainkan waktunya: ia muncul saat build rilis, jauh
  // setelah pengembangan sehari-hari menyatakan semuanya beres.
  worker: { format: "es" },
}));
