import type { EventTelemetri } from '../../../../packages/domain/src/telemetri.ts';

/**
 * Titik panggil telemetri — satu fungsi, sinkron, tidak pernah melempar.
 *
 * ## ⛔ Kenapa singleton, padahal repo ini meng-inject dependensi
 *
 * Pemanggil telemetri tersebar: jalur cetak, layar kasir, penangan crash,
 * pendengar `online`. Menyalurkan `DbLokal` ke semuanya berarti mengubah
 * tanda tangan fungsi-fungsi yang tidak ada urusannya dengan telemetri —
 * termasuk `cetakStruk`, yang justru harus tetap sesederhana mungkin karena
 * invariant #3 bergantung padanya.
 *
 * Yang membuat singleton aman DI SINI, dan hanya di sini: tidak ada satu pun
 * keputusan yang bergantung pada hasilnya. `catat()` yang tidak terpasang
 * adalah no-op, dan no-op adalah jawaban yang benar — sebelum `pasang()`
 * berjalan, memang tidak ada tempat menyimpan apa pun.
 *
 * ## ⛔ Sinkron, dan `void` — pemanggil tidak boleh `await`
 *
 * `ARCH:307`: telemetri tidak pernah menghambat aplikasi. Penulisannya
 * asinkron di balik layar; yang dikembalikan ke pemanggil tidak pernah
 * sebuah `Promise`, supaya tidak ada yang dapat menunggunya bahkan bila mau.
 */

export type Catat = (event: EventTelemetri, nilai: number, tipe?: string | null) => void;

let aktif: Catat | null = null;

/** Dipasang sekali saat boot oleh `pasang()`. */
export function pasangSink(fn: Catat): void {
  aktif = fn;
}

export function lepasSink(): void {
  aktif = null;
}

/**
 * Mencatat satu peristiwa. Tidak pernah melempar, tidak pernah menunggu, dan
 * tidak mengembalikan apa pun yang dapat ditunggu.
 */
export function catat(event: EventTelemetri, nilai: number, tipe: string | null = null): void {
  try {
    aktif?.(event, nilai, tipe);
  } catch {
    // ⛔ DITELAN. Pemanggilnya jalur penjualan dan jalur cetak.
  }
}
