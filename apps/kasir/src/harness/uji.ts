// Harness browser -- yang TIDAK dapat dibuktikan `node --test`.
//
// Keputusan user 8 Agustus 2026 (PLAN-pondasi-kasir §3.1): "Gunakan
// `node --test` & browser harness sungguhan. Tolak happy-dom." Alasannya
// tertulis di rencana: happy-dom tidak punya OPFS maupun Web Worker
// sungguhan, jadi suite hijau di atasnya tidak menyentuh satu pun hal yang
// berbahaya di aplikasi ini.
//
// Pola pelaporannya sama dengan prototipe 04/05: satu baris per klaim,
// LULUS/GAGAL, dan hasilnya ditempel apa adanya ke laporan -- termasuk saat
// merah. Harness seperti inilah yang menemukan cacat `tax_rate.rate`.

import { bukaDbLokal } from '../lokal/db.ts';
import { enqueue } from '../../../../packages/sync-client/src/enqueue.ts';
import { kirimBatch } from '../../../../packages/sync-client/src/relay.ts';
import { buatPenjadwal } from '../../../../packages/sync-client/src/penjadwal.ts';

export interface Hasil {
  nama: string;
  nilai: string;
  lulus: boolean;
}

let lapor: (h: Hasil) => void = () => {};
export function setPelapor(fn: (h: Hasil) => void) {
  lapor = fn;
}
function catat(nama: string, nilai: string, lulus: boolean) {
  lapor({ nama, nilai, lulus });
}

function tunggu(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Menunggu sebuah syarat sampai batas waktu, bukan tidur selama waktu tetap.
 *
 * Versi pertama T7 memakai `await tunggu(500)` dan MELAPORKAN GAGAL saat
 * mesinnya sedang sibuk -- `watch()` sebenarnya menyala, hanya lebih lambat
 * dari 500 ms. Test yang gagal ke arah "produk rusak" lebih buruk daripada
 * tidak ada test: ia mengirim orang memburu cacat yang tidak ada. Diperiksa
 * ulang secara manual: dengan 1.500 ms, notifikasinya datang.
 */
async function tungguSampai(
  syarat: () => boolean,
  { batasMs = 5_000, tiapMs = 50 } = {}
): Promise<boolean> {
  const batas = performance.now() + batasMs;
  while (performance.now() < batas) {
    if (syarat()) return true;
    await tunggu(tiapMs);
  }
  return syarat();
}

/**
 * Menghapus sisa database harness dari run sebelumnya.
 *
 * Bukan kerapian. Versi pertama harness ini memakai nama berkas tetap, dan
 * T9a ("boot pertama memutuskan bangun ulang") GAGAL pada run kedua karena
 * `skema_lokal` dari run sebelumnya masih ada -- test yang hasilnya bergantung
 * pada riwayat mesin, bukan pada kode.
 *
 * Menyapu DUA tempat, dan itu sendiri sebuah temuan: versi pertama fungsi ini
 * hanya menyapu OPFS, dan ia selalu menemukan nol berkas -- karena PowerSync
 * web menyimpan databasenya di IndexedDB, bukan OPFS. Lihat `periksaPenyimpanan`.
 */
const AWALAN_HARNESS = ['lumi-harness', 'lumi-vfs-', 'lumi-duatab-', 'lumi-probe-'];
/** `lumi-kasir.db` adalah database aplikasi SUNGGUHAN. Ia tidak pernah disapu. */
const sisaHarness = (n: string) => AWALAN_HARNESS.some((a) => n.startsWith(a));

async function bersihkanSisaHarness(): Promise<string[]> {
  const dibuang: string[] = [];

  if (navigator.storage?.getDirectory) {
    const akar = await navigator.storage.getDirectory();
    // @ts-expect-error `entries()` belum ada di lib DOM TypeScript ini.
    for await (const [nama] of akar.entries()) {
      if (typeof nama === 'string' && sisaHarness(nama)) {
        await akar.removeEntry(nama, { recursive: true }).catch(() => {});
        dibuang.push(`opfs:${nama}`);
      }
    }
  }

  for (const db of await indexedDB.databases()) {
    if (db.name && sisaHarness(db.name)) {
      await new Promise((r) => {
        const req = indexedDB.deleteDatabase(db.name as string);
        req.onsuccess = r;
        req.onerror = r;
        req.onblocked = r;
      });
      dibuang.push(`idb:${db.name}`);
    }
  }

  return dibuang;
}

/**
 * ⛔ Di mana database lokal BENAR-BENAR disimpan.
 *
 * Tidak ada yang meng-assert di sini dengan sengaja -- yang dilakukan fungsi
 * ini adalah MELAPORKAN, karena pilihannya milik pemilik produk.
 *
 * Temuan 8 Agustus 2026: `@powersync/web@2.1.1` default-nya
 * `WASQLiteVFS.IDBBatchAtomicVFS` -- IndexedDB, BUKAN OPFS
 * (`node_modules/@powersync/web/lib/db/adapters/resolveAndValidateOptions.js`).
 * Prototipe 04 dan 05 tidak pernah menyetel `vfs`, jadi seluruh angkanya --
 * termasuk 12,33 ms per penjualan -- adalah angka IndexedDB. Prototipe 03
 * mengukur OPFS pada pustaka yang BERBEDA (`@sqlite.org/sqlite-wasm`,
 * `opfs-sahpool`), jadi kedua kumpulan angka itu tidak sebanding.
 */
async function periksaPenyimpanan(namaDb: string): Promise<string> {
  const idb = (await indexedDB.databases()).map((d) => d.name).filter((n): n is string => !!n);
  const opfs: string[] = [];
  if (navigator.storage?.getDirectory) {
    const akar = await navigator.storage.getDirectory();
    // @ts-expect-error `entries()` belum ada di lib DOM TypeScript ini.
    for await (const [nama] of akar.entries()) opfs.push(nama as string);
  }
  const persisted = await navigator.storage?.persisted?.();
  return (
    `IndexedDB: ${idb.includes(namaDb) ? 'YA' : 'tidak'} (${idb.length} db) · ` +
    `OPFS: ${opfs.includes(namaDb) ? 'YA' : 'tidak'} (${opfs.length} entri) · ` +
    `persisted=${persisted}`
  );
}

export async function jalankan(vfs?: string): Promise<number> {
  const dibuang = await bersihkanSisaHarness();
  const NAMA_DB = `lumi-harness-${dibuang.length}-${performance.now().toFixed(0)}.db`;
  const opsiVfs = vfs ? { vfs: vfs as never } : {};
  let gagal = 0;
  const periksa = (nama: string, nilai: string, lulus: boolean) => {
    if (!lulus) gagal += 1;
    catat(nama, nilai, lulus);
  };

  // --- T9-lite: keputusan migrasi terhadap penyimpanan SUNGGUHAN ---------
  //
  // Yang dibuktikan di sini bukan bahwa `disconnectAndClear()` memulihkan
  // katalog -- itu sudah diukur di prototipe 05 §T5 dan butuh layanan sync.
  // Yang dibuktikan: `bukaDbLokal` mengambil keputusan yang benar di atas
  // OPFS sungguhan, dan keputusan itu STABIL pada boot kedua.
  const pertama = await bukaDbLokal({ dbFilename: NAMA_DB, ...opsiVfs });
  periksa(
    `T9a boot pertama memutuskan bangun ulang + bersihkan sync (${dibuang.length} sisa dibuang)`,
    JSON.stringify(pertama.keputusanMigrasi),
    pertama.keputusanMigrasi.perluBangunUlang && pertama.keputusanMigrasi.perluBersihkanSync
  );

  // Bukan assertion -- laporan. Pilihan VFS milik pemilik produk, dan baris
  // ini ada supaya ia tidak pernah lagi menjadi asumsi yang tidak diperiksa.
  periksa(`T0 di mana database lokal disimpan (${NAMA_DB})`, await periksaPenyimpanan(NAMA_DB), true);

  const sidik = await pertama.ps.getAll<{ sidik_raw_table: string }>(
    'SELECT sidik_raw_table FROM skema_lokal WHERE id = 1'
  );
  periksa(
    'T9b sidik jari skema tersimpan di perangkat',
    sidik[0]?.sidik_raw_table ?? '(kosong)',
    Boolean(sidik[0]?.sidik_raw_table)
  );

  // --- T2/T3 di atas database nyata: tabel kami, bukan tabel PowerSync ----
  const tabel = await pertama.ps.getAll<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`
  );
  const nama = tabel.map((t) => t.name);
  const psData = nama.filter((n) => n.startsWith('ps_data'));
  periksa(
    'T3a nol tabel ps_data__* -- raw table, bukan tabel PowerSync biasa',
    psData.length === 0 ? 'tidak ada' : psData.join(', '),
    psData.length === 0
  );
  const view = await pertama.ps.getAll<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'view'`
  );
  periksa(
    'T3b nol VIEW bikinan PowerSync di atas nama tabel kami',
    view.length === 0 ? 'tidak ada' : view.map((v) => v.name).join(', '),
    view.length === 0
  );
  periksa(
    'T3c outbox_local ada dan TIDAK dikenal PowerSync',
    nama.includes('outbox_local') ? 'ada' : 'HILANG',
    nama.includes('outbox_local')
  );

  // --- T8: adapter DbLokal di atas writeTransaction SUNGGUHAN -------------
  //
  // Inilah klaim yang `HANDOFF.md` sebut belum pernah dibuktikan dengan
  // menjalankan kode: bahwa port `DbLokal` dan `writeTransaction` PowerSync
  // cocok tanpa adaptor tebal.
  const db = pertama.db;
  await db.execute(`DELETE FROM outbox_local`);
  await db.execute(`DELETE FROM "order"`);

  const t0 = performance.now();
  await db.transaction(async (tx) => {
    await tx.execute(
      `INSERT INTO "order" (id, tenant_id, outlet_id, device_id, shift_id, receipt_number,
         business_date, sequence, status, subtotal, total, amount_due, created_by,
         occurred_at, hlc)
       VALUES ('ord-h1','ten-1','out-1','dev-1','shf-1','K1-20260808-0001','2026-08-08',1,
               'open', 44400, 44400, 44400, 'usr-1', '2026-08-08T10:00:00.000Z', 1)`
    );
    await enqueue(tx, {
      id: 'obx-h1',
      entityType: 'order',
      entityId: 'ord-h1',
      operation: 'create',
      payload: { total: 44400 },
      idempotencyKey: 'key-h1',
      createdAt: '2026-08-08T10:00:00.000Z',
    });
  });
  const msSatuPenjualan = performance.now() - t0;

  const [{ n: nOrder }] = await db.getAll<{ n: number }>(`SELECT count(*) AS n FROM "order"`);
  const [{ n: nOutbox }] = await db.getAll<{ n: number }>(`SELECT count(*) AS n FROM outbox_local`);
  periksa(
    'T8a satu penjualan = satu writeTransaction (order + outbox)',
    `order=${nOrder} outbox=${nOutbox} · ${msSatuPenjualan.toFixed(2)} ms`,
    nOrder === 1 && nOutbox === 1
  );

  // Rollback SUNGGUHAN. Invariant #1 tidak berarti apa-apa kalau kegagalan di
  // tengah meninggalkan separuh penjualan.
  let melempar = false;
  try {
    await db.transaction(async (tx) => {
      await tx.execute(
        `INSERT INTO "order" (id, tenant_id, outlet_id, device_id, shift_id, receipt_number,
           business_date, sequence, status, subtotal, total, amount_due, created_by,
           occurred_at, hlc)
         VALUES ('ord-h2','ten-1','out-1','dev-1','shf-1','K1-20260808-0002','2026-08-08',2,
                 'open', 1, 1, 1, 'usr-1', '2026-08-08T10:00:01.000Z', 2)`
      );
      throw new Error('gagal sebelum commit');
    });
  } catch {
    melempar = true;
  }
  const sisa = await db.getAll<{ id: string }>(`SELECT id FROM "order" WHERE id = 'ord-h2'`);
  periksa(
    'T8b kegagalan di tengah transaksi benar-benar rollback',
    `melempar=${melempar} baris tersisa=${sisa.length}`,
    melempar && sisa.length === 0
  );

  // --- FR-B7: bentuk SQL sisa refund per baris, di atas wa-sqlite ---------
  //
  // ⛔ `CLAUDE.md`: *"Test klien berjalan di atas SQLite yang BERBEDA dari
  // aplikasi. `ON CONFLICT(id)` diterima `node:sqlite` dan DITOLAK
  // `wa-sqlite` — seluruh test hijau, hanya aplikasinya yang gagal. Bentuk
  // SQL baru wajib dijalankan di browser sebelum dipercaya."*
  //
  // Yang baru di sini: `SUM(...) ... WHERE type IN (...) GROUP BY`. Ia
  // menentukan berapa banyak dari tiap baris yang masih boleh dikembalikan —
  // query yang gagal berarti pemilihan baris refund tidak dapat dibatasi sama
  // sekali, dan stok mengembang diam-diam.
  await db.execute(`DELETE FROM stock_movement WHERE order_id = 'ord-h1'`);
  for (const [id, variasi, tipe, delta] of [
    ['sm-h1', 'var-1', 'sale', -2000],
    ['sm-h2', 'var-1', 'refund', 1000],
    ['sm-h3', 'var-2', 'void', 500],
  ] as const) {
    await db.execute(
      `INSERT INTO stock_movement
         (id, tenant_id, outlet_id, device_id, variation_id, type, delta, order_id,
          created_by, occurred_at, hlc)
       VALUES (?, 'ten-1', 'out-1', 'dev-1', ?, ?, ?, 'ord-h1', 'usr-1',
               '2026-08-08T10:00:00.000Z', 1)`,
      [id, variasi, tipe, delta]
    );
  }
  let bentukSql = '(gagal)';
  let sqlLulus = false;
  try {
    const kembali = await db.getAll<{ variation_id: string; total: number | bigint | string }>(
      `SELECT variation_id, SUM(delta) AS total
         FROM stock_movement
        WHERE order_id = ? AND type IN ('refund', 'void')
        GROUP BY variation_id`,
      ['ord-h1']
    );
    // ⛔ `sale` (-2000) TIDAK ikut: yang dihitung adalah barang yang KEMBALI.
    // Kalau ia ikut, sisa per baris menjadi negatif dan setiap pemilihan
    // ditolak — gejalanya "tidak bisa refund apa pun", bukan error.
    const peta = new Map(kembali.map((k) => [k.variation_id, BigInt(k.total ?? 0)]));
    bentukSql = kembali
      .map((k) => `${k.variation_id}=${k.total} (${typeof k.total})`)
      .sort()
      .join(' · ');
    sqlLulus = peta.get('var-1') === 1000n && peta.get('var-2') === 500n && peta.size === 2;
  } catch (e) {
    bentukSql = `${(e as Error).name}: ${(e as Error).message}`;
  }
  periksa('T14 sisa refund per variasi terbaca di wa-sqlite', bentukSql, sqlLulus);

  // Transaksi bersarang harus DITOLAK, bukan menggantung menunggu kuncinya
  // sendiri. Yang diuji di sini adalah bahwa penolakannya datang cepat.
  let pesanBersarang = '(tidak ditolak)';
  try {
    await db.transaction(async (tx) => {
      await tx.transaction(async () => {});
    });
  } catch (e) {
    pesanBersarang = (e as Error).message;
  }
  periksa(
    'T8c transaksi bersarang ditolak, tidak menggantung',
    pesanBersarang,
    /bersarang/i.test(pesanBersarang)
  );

  // --- T8d: relay sungguhan berjalan di atas PowerSync --------------------
  const hasilBatch = await kirimBatch({
    db,
    now: () => Date.parse('2026-08-08T10:00:05.000Z'),
    kirim: async () => ({ status: 201 }),
  });
  const [{ status }] = await db.getAll<{ status: string }>(
    `SELECT status FROM outbox_local WHERE id = 'obx-h1'`
  );
  periksa(
    'T8d kirimBatch memindahkan item ke `sent` di database PowerSync',
    `terkirim=${hasilBatch.terkirim} status=${status}`,
    hasilBatch.terkirim === 1 && status === 'sent'
  );

  // --- T7: reaktivitas -- `watch`, bukan polling -------------------------
  //
  // Prototipe 05 memakai `setInterval` 500 ms; API ini BELUM PERNAH kami
  // jalankan. Keputusan §3.3 (tanpa state library) bersandar padanya.
  let pemberitahuan = 0;
  const berhentiPantau = new AbortController();
  pertama.ps.watch(
    `SELECT count(*) AS n FROM outbox_local`,
    [],
    {
      onResult: () => {
        pemberitahuan += 1;
      },
    },
    { signal: berhentiPantau.signal, tables: ['outbox_local'] }
  );

  // Hasil pertama datang saat berlangganan; ia ditunggu sampai muncul,
  // supaya `awal` tidak terbaca nol hanya karena mesinnya lambat.
  await tungguSampai(() => pemberitahuan > 0);
  const awal = pemberitahuan;
  const t7Mulai = performance.now();
  await db.execute(
    `INSERT INTO outbox_local (id, entity_type, entity_id, operation, payload,
       idempotency_key, status, attempts, created_at)
     VALUES ('obx-h2','order','ord-h9','create','{}','key-h2','pending',0,'2026-08-08T10:00:06.000Z')`
  );
  const menyala = await tungguSampai(() => pemberitahuan > awal);
  const t7Ms = performance.now() - t7Mulai;
  berhentiPantau.abort();
  periksa(
    'T7 watch() memicu pembaruan setelah penulisan lokal (tanpa polling)',
    `pemberitahuan: ${awal} -> ${pemberitahuan} dalam ${t7Ms.toFixed(0)} ms`,
    menyala
  );

  // --- T6 di browser: penjadwal dengan timer SUNGGUHAN --------------------
  let dikirim = 0;
  const penjadwal = buatPenjadwal({
    db,
    now: () => Date.now(),
    kirim: async () => {
      dikirim += 1;
      return { status: 201 };
    },
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as number),
    intervalMs: 100,
  });
  await penjadwal.mulai();
  penjadwal.berhenti();
  const [{ n: sisaAntre }] = await db.getAll<{ n: number }>(
    `SELECT count(*) AS n FROM outbox_local WHERE status IN ('pending','sending')`
  );
  periksa(
    'T6e penjadwal mengosongkan antrean lalu menganggur',
    `dikirim=${dikirim} sisa=${sisaAntre} menganggur=${penjadwal.menganggur}`,
    sisaAntre === 0 && penjadwal.menganggur
  );

  // --- Boot kedua: keputusan migrasi harus BERUBAH ------------------------
  await pertama.ps.close();
  const kedua = await bukaDbLokal({ dbFilename: NAMA_DB, ...opsiVfs });
  periksa(
    'T9c boot kedua: skema tidak dibangun ulang, sync tidak dibersihkan',
    JSON.stringify(kedua.keputusanMigrasi),
    !kedua.keputusanMigrasi.perluBangunUlang && !kedua.keputusanMigrasi.perluBersihkanSync
  );

  // Antrean HARUS selamat melewati boot kedua -- kalau `outbox_local` ikut
  // dibangun ulang, penjualan yang belum terkirim hilang tanpa jejak.
  const [{ n: outboxSetelahBoot }] = await kedua.db.getAll<{ n: number }>(
    `SELECT count(*) AS n FROM outbox_local`
  );
  periksa(
    'T9d outbox_local selamat melewati boot ulang',
    `${outboxSetelahBoot} baris`,
    outboxSetelahBoot === 2
  );

  await kedua.ps.close();
  return gagal;
}
