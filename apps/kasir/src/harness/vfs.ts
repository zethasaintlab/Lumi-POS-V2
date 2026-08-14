// Pengukuran VFS -- yang menentukan di mana database lokal benar-benar hidup.
//
// Latar belakangnya: `@powersync/web@2.1.1` default-nya `IDBBatchAtomicVFS`
// (IndexedDB), dan prototipe 04/05 tidak pernah menyetelnya. Artinya 12,33 ms
// per penjualan -- angka yang dipakai menyimpulkan "PowerSync 3,8× lebih
// lambat" -- adalah angka IndexedDB, bukan angka lapisan PowerSync.
//
// Beban kerjanya SAMA PERSIS dengan prototipe 03 §5b dan prototipe 04:
// 10 baris di 8 tabel dalam satu transaksi. Ia diimpor, bukan disalin --
// beban yang disalin akan hanyut, dan perbandingan dengan angka lama menjadi
// tidak berarti. Halaman ini hanya ada di `vite dev`.

import { PowerSyncDatabase, Schema, WASQLiteVFS } from '@powersync/web';
import SKEMA_SQL from '../../../../db/local/001-initial.sql?raw';
import { pernyataanPenjualan } from '../../../../prototypes/04-powersync-raw-tables/src/penjualan.js';
import { rencanaDdl } from '../lokal/migrasi.ts';
import { buatDefinisiRaw, kolomPerTabel } from '../lokal/skema.ts';

export interface BarisHasil {
  vfs: string;
  status: string;
  pasangSkemaMs: number | null;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  penjualanPerDetik: number | null;
  disimpanDi: string;
}

const JUMLAH_PENJUALAN = 60;

/** Keempat VFS yang PowerSync sebut sudah teruji. `InMemoryVFS` dilewati -- ia tanpa persistensi. */
const KANDIDAT: WASQLiteVFS[] = [
  WASQLiteVFS.IDBBatchAtomicVFS,
  WASQLiteVFS.OPFSCoopSyncVFS,
  WASQLiteVFS.AccessHandlePoolVFS,
  WASQLiteVFS.OPFSWriteAheadVFS,
];

function persentil(urut: number[], p: number): number {
  return urut[Math.min(urut.length - 1, Math.floor((urut.length - 1) * p))];
}

async function dimanaDisimpan(namaDb: string): Promise<string> {
  const idb = (await indexedDB.databases()).some((d) => d.name === namaDb);
  let opfs = false;
  if (navigator.storage?.getDirectory) {
    const akar = await navigator.storage.getDirectory();
    // @ts-expect-error `entries()` belum ada di lib DOM TypeScript ini.
    for await (const [nama] of akar.entries()) {
      // AccessHandlePoolVFS memakai nama berkas buram; ia membuat DIREKTORI
      // bernama database. Keduanya dihitung sebagai "OPFS".
      if (nama === namaDb || String(nama).startsWith(namaDb)) opfs = true;
    }
  }
  if (idb && opfs) return 'IndexedDB + OPFS';
  if (idb) return 'IndexedDB';
  if (opfs) return 'OPFS';
  return 'tidak ditemukan';
}

async function ukurSatu(vfs: WASQLiteVFS, nomor: number): Promise<BarisHasil> {
  const namaDb = `lumi-vfs-${nomor}-${vfs}.db`;
  const hasil: BarisHasil = {
    vfs,
    status: 'gagal',
    pasangSkemaMs: null,
    p50: null,
    p95: null,
    p99: null,
    penjualanPerDetik: null,
    disimpanDi: '-',
  };

  const schema = new Schema({});
  schema.withRawTables(buatDefinisiRaw(kolomPerTabel(SKEMA_SQL)));

  let ps: PowerSyncDatabase | null = null;
  try {
    ps = new PowerSyncDatabase({
      schema,
      // `enableMultiTabs: true` DIPERTAHANKAN di setiap kandidat. Prototipe 04
      // §7 menyandarkan pola satu-penulis padanya, dan VFS yang hanya jalan
      // dengan `false` bukan kandidat yang setara -- itu bagian dari yang
      // diukur di sini, bukan variabel yang boleh diseragamkan diam-diam.
      database: { dbFilename: namaDb, enableMultiTabs: true, vfs },
    });
    await ps.init();

    const rencana = rencanaDdl(SKEMA_SQL);
    const t0 = performance.now();
    for (const p of rencana.pragma) await ps.execute(p);
    for (const p of rencana.drop) await ps.execute(p);
    for (const p of rencana.buat) await ps.execute(p);
    hasil.pasangSkemaMs = performance.now() - t0;

    const durasi: number[] = [];
    for (let n = 1; n <= JUMLAH_PENJUALAN; n += 1) {
      const s = pernyataanPenjualan(n);
      const mulai = performance.now();
      await ps.writeTransaction(async (tx) => {
        for (const [sql, params] of s) await tx.execute(sql, params);
      });
      durasi.push(performance.now() - mulai);
    }

    durasi.sort((a, b) => a - b);
    hasil.p50 = persentil(durasi, 0.5);
    hasil.p95 = persentil(durasi, 0.95);
    hasil.p99 = persentil(durasi, 0.99);
    hasil.penjualanPerDetik = 1000 / (durasi.reduce((a, b) => a + b, 0) / durasi.length);
    hasil.disimpanDi = await dimanaDisimpan(namaDb);
    hasil.status = 'ok';
  } catch (e) {
    hasil.status = `${(e as Error).name}: ${(e as Error).message}`;
  } finally {
    await ps?.close().catch(() => {});
  }

  return hasil;
}

export async function ukurSemuaVfs(
  lapor: (b: BarisHasil) => void
): Promise<BarisHasil[]> {
  const semua: BarisHasil[] = [];
  // Nomor run dipakai di nama berkas supaya run kedua tidak mengukur database
  // yang sudah berisi 60 penjualan dari run sebelumnya.
  const nomor = Math.floor(performance.now());
  for (const vfs of KANDIDAT) {
    const b = await ukurSatu(vfs, nomor);
    semua.push(b);
    lapor(b);
  }
  return semua;
}
