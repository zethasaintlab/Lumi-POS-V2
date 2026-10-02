import type { DbLokal } from '../../../../packages/sync-client/src/ports.ts';

/* Satu perangkat menunggu paling banyak satu QR (DDL `draf_qris_lokal`). Modul ini ada supaya
   `qris-dinamis.ts` dan `penjualan.ts` (yang saling mengimpor) berbagi satu kunci tanpa siklus. */
export const KUNCI_DRAF_QRIS = 'kini';

/** Dipanggil DI DALAM transaksi penjualan (KEP-21): draf tak pernah tertinggal untuk penjualan yang tersimpan. */
export async function hapusDrafQrisDi(db: DbLokal): Promise<void> {
  await db.execute('DELETE FROM draf_qris_lokal WHERE id = ?', [KUNCI_DRAF_QRIS]);
}
