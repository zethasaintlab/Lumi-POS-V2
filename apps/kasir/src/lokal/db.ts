// Pembuka database lokal. Satu-satunya berkas di `lokal/` yang mengimpor
// `@powersync/web` -- sisanya murni, dan itu disengaja: yang tidak dapat
// diuji di node dijaga sekecil mungkin.
//
// ⛔ Sepuluh aturan mengikat di `CLAUDE.md` bagian F2 diterapkan di sini.
// Tiga yang paling mudah hilang saat berkas ini disunting kelak:
//
//   - `enableMultiTabs` di-set EKSPLISIT, tidak diandalkan pada default;
//   - tabel murni lokal tidak pernah didaftarkan (`buatDefinisiRaw` hanya
//     mengembalikan `TABEL_RAW`);
//   - TIDAK ada `powersync_create_raw_table_crud_trigger`. Jalur naik tetap
//     milik `outbox_local` + REST idempoten. Memasang trigger itu berarti
//     membangun jalur naik kedua yang diam-diam.

import { PowerSyncDatabase, Schema, WASQLiteVFS } from '@powersync/web';
import SKEMA_SQL from '../../../../db/local/001-initial.sql?raw';
import type { DbLokal } from '../../../../packages/sync-client/src/ports.ts';
import { adaptDbLokal } from './adapter.ts';
import {
  jalankanMigrasi,
  rencanaAlterLokal,
  type KeputusanMigrasi,
  type RencanaDdl,
  rencanaBuatLokalHilang,
} from './migrasi.ts';
import { TABEL_LOKAL_SAJA, buatDefinisiRaw, kolomPerTabel } from './skema.ts';

/**
 * VFS yang dipakai aplikasi.
 *
 * ⛔ Ini BUKAN default `@powersync/web`. Defaultnya `IDBBatchAtomicVFS`
 * (IndexedDB), dan itu ditemukan 8 Agustus 2026 saat harness pondasi berjalan
 * -- pembersih OPFS selalu menemukan nol berkas sementara databasenya jelas
 * ada. Konsekuensinya: seluruh angka prototipe 04 dan 05, termasuk 12,33 ms
 * per penjualan, adalah angka IndexedDB.
 *
 * `OPFSWriteAheadVFS` dipilih setelah keempat kandidat diukur lewat PowerSync
 * di `apps/kasir/harness-vfs.html`, tiga run, beban kerja yang sama persis
 * dengan prototipe 03/04 (10 baris di 8 tabel, satu writeTransaction):
 *
 *   p50 per penjualan  IDBBatchAtomic 26,8-28,5 ms · OPFSCoopSync 7,0-9,1 ms
 *                      AccessHandlePool 9,0-11,8 ms · OPFSWriteAhead 4,5-5,1 ms
 *
 * Ia juga satu-satunya VFS yang mendukung `additionalReaders` -- koneksi baca
 * tambahan, yang kelak dapat dipakai grid produk K-03 tanpa menyentuh jalur
 * tulis sama sekali.
 *
 * Dua tab diuji terpisah (`harness-dua-tab.html`): keduanya menulis 20 baris
 * dan saling melihat seluruh 40. Pola satu-penulis yang disandarkan prototipe
 * 04 §7 pada `enableMultiTabs` karena itu tetap berlaku di atas OPFS -- itu
 * BUKAN sesuatu yang boleh diasumsikan, karena prototipe 04 mengukurnya di
 * atas IndexedDB.
 *
 * Kalau kelak ekor latensi jadi masalah, `AccessHandlePoolVFS` adalah
 * cadangan dengan ekor paling rapat, dan menggantinya satu konstanta.
 */
export const VFS_TERPILIH = WASQLiteVFS.OPFSWriteAheadVFS;

export interface DbLokalTerbuka {
  /** Objek PowerSync mentah -- untuk `connect`, `watch`, `disconnectAndClear`. */
  ps: PowerSyncDatabase;
  /** Port yang dipakai `packages/sync-client`. */
  db: DbLokal;
  keputusanMigrasi: KeputusanMigrasi;
}

function buatSchema(): Schema {
  const schema = new Schema({});
  schema.withRawTables(buatDefinisiRaw(kolomPerTabel(SKEMA_SQL)));
  return schema;
}

async function bacaSidik(ps: PowerSyncDatabase): Promise<string | null> {
  try {
    const baris = await ps.getAll<{ sidik_raw_table: string }>(
      'SELECT sidik_raw_table FROM skema_lokal WHERE id = 1'
    );
    return baris[0]?.sidik_raw_table ?? null;
  } catch {
    // Tabelnya belum ada -- perangkat baru, atau skema belum pernah dipasang.
    // Ditangkap, bukan dicegah dengan `CREATE TABLE IF NOT EXISTS` di sini:
    // definisi tabelnya hanya boleh ada di `db/local/001-initial.sql`.
    return null;
  }
}

async function jalankanDdl(ps: PowerSyncDatabase, rencana: RencanaDdl): Promise<void> {
  for (const p of rencana.pragma) await ps.execute(p);
  for (const p of rencana.drop) await ps.execute(p);
  for (const p of rencana.buat) await ps.execute(p);
}

async function migrasiAditifLokal(ps: PowerSyncDatabase): Promise<void> {
  const aktual: Record<string, string[]> = {};
  for (const tabel of TABEL_LOKAL_SAJA) {
    const kolom = await ps.getAll<{ name: string }>(`PRAGMA table_info("${tabel}")`);
    if (kolom.length > 0) aktual[tabel] = kolom.map((k) => k.name);
  }
  // ⛔ CREATE lebih dulu, baru ALTER. Tabel murni lokal BARU tidak pernah
  // dibuat oleh `jalankanDdl` — ia hanya berjalan saat sidik jari raw table
  // berubah, dan sidik jari itu tidak menghitung tabel lokal sama sekali.
  // Lihat catatan panjang di `rencanaBuatLokalHilang`.
  for (const buat of rencanaBuatLokalHilang(SKEMA_SQL, aktual)) {
    await ps.execute(buat);
  }
  for (const alter of rencanaAlterLokal(SKEMA_SQL, aktual)) {
    await ps.execute(alter);
  }
}

/**
 * Membuka database lokal, menjalankan migrasi, dan mengembalikan port.
 *
 * Urutannya mengikuti prototipe 04/05 apa adanya: `init()`, lalu migrasi
 * (yang di dalamnya `disconnectAndClear()` mendahului DDL), lalu
 * `updateSchema`.
 */
export async function bukaDbLokal({
  dbFilename = 'lumi-kasir.db',
  waktu = () => new Date(),
  vfs = VFS_TERPILIH,
}: { dbFilename?: string; waktu?: () => Date; vfs?: WASQLiteVFS } = {}): Promise<DbLokalTerbuka> {
  const schema = buatSchema();
  const ps = new PowerSyncDatabase({
    schema,
    database: {
      dbFilename,
      // Disetel EKSPLISIT. Nilai default paket adalah IndexedDB, dan
      // membiarkannya berarti memilih penyimpanan tanpa pernah memutuskannya.
      vfs,
      // Eksplisit, bukan default. Prototipe 04 §7: dengan `true`, dua tab
      // dapat menulis bersamaan (koneksi pindah ke SharedWorker) -- tempat
      // prototipe 03 mendapat `NoModificationAllowedError`. Dokumentasi
      // PowerSync menyebut nilai ini mati di Safari, jadi ia tidak boleh
      // diandalkan diam-diam.
      enableMultiTabs: true,
    },
  });
  await ps.init();

  const keputusanMigrasi = await jalankanMigrasi({
    sqlSkema: SKEMA_SQL,
    bacaSidik: () => bacaSidik(ps),
    bersihkanSync: () => ps.disconnectAndClear(),
    jalankanDdl: (rencana) => jalankanDdl(ps, rencana),
    simpanSidik: async (sidik) => {
      await ps.execute(
        'INSERT OR REPLACE INTO skema_lokal (id, sidik_raw_table, dipasang_pada) VALUES (1, ?, ?)',
        [sidik, waktu().toISOString()]
      );
    },
  });

  // ⛔ Dijalankan di SETIAP boot, bukan hanya saat sidik jari berubah.
  //
  // Sidik jari hanya menghitung raw table -- perubahan bentuk tabel murni
  // lokal tidak terlihat olehnya sama sekali. Ditemukan dengan menjalankan
  // aplikasi: `device_config` mendapat kolom baru dan database yang sudah ada
  // menolaknya dengan "table device_config has no column named id".
  //
  // Aditif, tidak pernah membangun ulang: `outbox_local` memegang penjualan
  // yang belum terkirim, dan `device_config` memegang `receipt_sequence`.
  await migrasiAditifLokal(ps);

  await ps.updateSchema(schema);

  return { ps, db: adaptDbLokal(ps), keputusanMigrasi };
}
