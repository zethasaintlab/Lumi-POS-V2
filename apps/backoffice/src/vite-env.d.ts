/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Alamat server API. Invariant #5: perbedaan lingkungan HANYA lewat
   * environment variable, tidak pernah lewat `if` di kode aplikasi.
   *
   * Kosong berarti `http://localhost:3000` — bawaan pengembangan, dan
   * satu-satunya nilai yang masuk akal untuk mesin yang tidak menyetelnya.
   */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
