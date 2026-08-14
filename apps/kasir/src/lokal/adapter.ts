// Adapter dari database PowerSync ke port `DbLokal` milik `packages/sync-client`.
//
// Ia sengaja TIDAK mengimpor `@powersync/web`. Yang dibutuhkan hanya tiga
// metode, dan menuliskannya sebagai interface struktural membuat adapter ini
// dapat diuji di `node --test` -- sementara yang tersisa untuk browser tinggal
// satu klaim: bahwa `PowerSyncDatabase` sungguhan memenuhi interface ini
// (harness T8).
//
// `CLAUDE.md` bagian F2 mencatat bahwa kecocokan port ini "belum dibuktikan
// dengan menjalankan kode -- hanya `node:sqlite` yang pernah mengisinya".
// Berkas ini memisahkan dua hal yang selama ini tercampur di klaim itu:
// bentuk pemakaiannya (di sini, diuji) dan perilaku runtime-nya (harness).

// Impor relatif ke sumber paket, sejajar dengan cara `apps/server` memakai
// `packages/domain`. Bukan impor bare-specifier: paket-paket ini tidak punya
// `main`/`exports`, dan `tsc` maupun Vite hanya menemukannya lewat jalur.
import type { DbLokal } from '../../../../packages/sync-client/src/ports.ts';

/** Irisan `PowerSyncDatabase` yang benar-benar kami pakai. */
export interface SumberPowerSync {
  getAll<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<unknown>;
  writeTransaction<T>(fn: (tx: TransaksiPowerSync) => Promise<T>): Promise<T>;
}

export interface TransaksiPowerSync {
  getAll<T>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<unknown>;
}

/**
 * Menerjemahkan `PowerSyncDatabase` menjadi `DbLokal`.
 *
 * `transaction` dipetakan ke `writeTransaction`, bukan ke `readLock` atau
 * `execute('BEGIN')`. Prototipe 04 sudah membuktikan `writeTransaction` adalah
 * `BEGIN IMMEDIATE`/`COMMIT` sungguhan dengan kunci global dan rollback yang
 * nyata -- itu yang membuat invariant #1 (satu penjualan = satu transaksi)
 * tetap berbentuk sama di klien.
 */
export function adaptDbLokal(ps: SumberPowerSync): DbLokal {
  return {
    getAll: (sql, params) => ps.getAll(sql, params ?? []),
    async execute(sql, params) {
      await ps.execute(sql, params ?? []);
    },
    transaction(fn) {
      return ps.writeTransaction(async (tx) => fn(bungkusTransaksi(tx)));
    },
  };
}

function bungkusTransaksi(tx: TransaksiPowerSync): DbLokal {
  return {
    getAll: (sql, params) => tx.getAll(sql, params ?? []),
    async execute(sql, params) {
      await tx.execute(sql, params ?? []);
    },
    // SQLite tidak punya transaksi bersarang, dan `writeTransaction` di dalam
    // `writeTransaction` akan menggantung menunggu kunci yang dipegang
    // dirinya sendiri. Gagal keras di sini menghasilkan pesan yang menunjuk
    // penyebabnya; membiarkannya menghasilkan aplikasi kasir yang membeku di
    // tengah penjualan tanpa error apa pun.
    transaction() {
      return Promise.reject(
        new Error(
          'Transaksi bersarang tidak didukung: satu penjualan sudah berjalan di dalam writeTransaction.'
        )
      );
    },
  };
}
