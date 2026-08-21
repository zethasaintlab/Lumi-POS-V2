/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * FR-H8 — ambang antrean menua, tiga bilangan jam dipisah koma:
   * `"4,24,72"` (peringatan, kritis, darurat).
   *
   * AC FR-H8 pertama menuntut ambang **dapat dikonfigurasi**. Invariant #5:
   * perbedaan lingkungan HANYA lewat environment variable, tidak pernah lewat
   * `if` di kode aplikasi.
   *
   * Satu variabel, bukan tiga — ketiganya hanya berarti bersama-sama, dan
   * ambang campuran adalah tangga yang tidak pernah ditinjau siapa pun. Apa
   * pun yang cacat jatuh ke bawaan `spec-h:308` secara UTUH
   * (`bacaAmbangAntrean`).
   */
  readonly VITE_AMBANG_ANTREAN_JAM?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
