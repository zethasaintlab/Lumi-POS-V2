// Uji dua tab.
//
// Prototipe 03 §3 mengukur bahwa dua koneksi ke berkas OPFS yang sama
// mustahil (`NoModificationAllowedError`). Prototipe 04 §7 lalu mengukur
// bahwa `enableMultiTabs: true` menyelesaikannya -- tapi ia mengukurnya di
// atas VFS default, yang ternyata IndexedDB. Pindah ke VFS berbasis OPFS
// mengembalikan pertanyaan itu, dan jawabannya tidak dapat ditebak: tab kedua
// yang mati adalah aplikasi kasir yang mati.
//
// Halaman ini dibuka DI DUA TAB sekaligus. Masing-masing menulis 20 baris
// bertanda tab-nya sendiri, lalu menghitung total. Kalau keduanya hidup dan
// saling melihat, polanya aman.

import { PowerSyncDatabase, Schema, WASQLiteVFS } from '@powersync/web';
import SKEMA_SQL from '../../../../db/local/001-initial.sql?raw';
import { rencanaDdl } from '../lokal/migrasi.ts';
import { buatDefinisiRaw, kolomPerTabel } from '../lokal/skema.ts';

const JUMLAH = 20;

export interface HasilDuaTab {
  tab: string;
  vfs: string;
  status: string;
  ditulis: number;
  totalTerlihat: number;
  tabLainTerlihat: number;
}

export async function jalankanDuaTab(vfsNama: string, tab: string): Promise<HasilDuaTab> {
  const vfs = vfsNama as WASQLiteVFS;
  const hasil: HasilDuaTab = {
    tab,
    vfs: vfsNama,
    status: 'gagal',
    ditulis: 0,
    totalTerlihat: 0,
    tabLainTerlihat: 0,
  };

  const schema = new Schema({});
  schema.withRawTables(buatDefinisiRaw(kolomPerTabel(SKEMA_SQL)));

  const ps = new PowerSyncDatabase({
    schema,
    database: { dbFilename: `lumi-duatab-${vfsNama}.db`, enableMultiTabs: true, vfs },
  });

  try {
    await ps.init();

    // Tabel dibuat `IF NOT EXISTS` -- tab kedua tidak boleh menghapus tabel
    // yang sedang dipakai tab pertama. Ini juga alasan uji ini tidak memakai
    // `rencanaDdl().drop`.
    const rencana = rencanaDdl(SKEMA_SQL);
    for (const p of rencana.pragma) await ps.execute(p);
    for (const p of rencana.buat) {
      // `IF NOT EXISTS` ditambahkan hanya bila belum ada -- `rencanaDdl` sudah
      // menyisipkannya untuk tabel murni lokal, dan menyisipkannya dua kali
      // menghasilkan syntax error. Versi pertama uji ini menelan galat itu
      // dengan `.catch(() => {})` dan melaporkan "no such table: outbox_local"
      // sebagai kegagalan dua-tab -- padahal tabelnya memang tidak pernah
      // dibuat. Galat DDL karena itu TIDAK ditelan di sini.
      await ps.execute(p.replace(/^CREATE (UNIQUE )?(TABLE|INDEX) (?!IF NOT EXISTS)/i, 'CREATE $1$2 IF NOT EXISTS '));
    }

    for (let n = 1; n <= JUMLAH; n += 1) {
      await ps.writeTransaction(async (tx) => {
        await tx.execute(
          `INSERT OR REPLACE INTO outbox_local (id, entity_type, entity_id, operation, payload,
             idempotency_key, status, attempts, created_at)
           VALUES (?, 'order', ?, 'create', '{}', ?, 'pending', 0, ?)`,
          [`${tab}-${n}`, `ent-${tab}-${n}`, `key-${tab}-${n}`, new Date().toISOString()]
        );
      });
      hasil.ditulis += 1;
    }

    const [{ n: total }] = await ps.getAll<{ n: number }>(
      `SELECT count(*) AS n FROM outbox_local`
    );
    const [{ n: lain }] = await ps.getAll<{ n: number }>(
      `SELECT count(*) AS n FROM outbox_local WHERE id NOT LIKE ? || '-%'`,
      [tab]
    );
    hasil.totalTerlihat = total;
    hasil.tabLainTerlihat = lain;
    hasil.status = 'ok';
  } catch (e) {
    hasil.status = `${(e as Error).name}: ${(e as Error).message}`;
  }

  return hasil;
}
