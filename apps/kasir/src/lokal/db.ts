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

import { PowerSyncDatabase, Schema } from '@powersync/web';
import SKEMA_SQL from '../../../../db/local/001-initial.sql?raw';
import type { DbLokal } from '../../../../packages/sync-client/src/ports.ts';
import { adaptDbLokal } from './adapter.ts';
import { jalankanMigrasi, type KeputusanMigrasi, type RencanaDdl } from './migrasi.ts';
import { buatDefinisiRaw, kolomPerTabel } from './skema.ts';

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
}: { dbFilename?: string; waktu?: () => Date } = {}): Promise<DbLokalTerbuka> {
  const schema = buatSchema();
  const ps = new PowerSyncDatabase({
    schema,
    database: {
      dbFilename,
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

  await ps.updateSchema(schema);

  return { ps, db: adaptDbLokal(ps), keputusanMigrasi };
}
