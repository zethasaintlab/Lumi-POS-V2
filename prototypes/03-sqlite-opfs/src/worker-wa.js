// Pengukuran pembanding: `@journeyapps/wa-sqlite` — driver yang dipakai
// `@powersync/web@2.1.1`.
//
// ## Kenapa ini diukur sama sekali
//
// Diverifikasi 7 Agustus 2026: `@powersync/web` bergantung pada
// `@journeyapps/wa-sqlite`, bukan `@sqlite.org/sqlite-wasm`. Dan prototipe ini
// sendiri sudah membuktikan dua koneksi independen ke berkas OPFS yang sama
// **mustahil** (`NoModificationAllowedError`).
//
// Konsekuensinya salah satu harus MEMILIKI database lokal. Angka 3,97 ms per
// penjualan yang terukur berlaku untuk `opfs-sahpool` di
// `@sqlite.org/sqlite-wasm`; kalau PowerSync yang memiliki DB-nya, angka itu
// tidak berlaku. Berkas ini mengukur jalur tulis YANG SAMA PERSIS dengan
// driver PowerSync supaya keputusannya punya angka, bukan dugaan.

import SQLiteESMFactory from '@journeyapps/wa-sqlite/dist/wa-sqlite.mjs';
import * as SQLite from '@journeyapps/wa-sqlite/src/sqlite-api.js';
import { AccessHandlePoolVFS } from '@journeyapps/wa-sqlite/src/examples/AccessHandlePoolVFS.js';
import { OPFSCoopSyncVFS } from '@journeyapps/wa-sqlite/src/examples/OPFSCoopSyncVFS.js';
import SKEMA from '../../../db/local/001-initial.sql?raw';

const hasil = [];
function catat(nama, nilai) {
  hasil.push({ nama, nilai });
  postMessage({ jenis: 'progres', nama, nilai });
}

function persentil(arr, p) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

// Jalur tulis IDENTIK dengan worker.js: 10 baris di 8 tabel, satu transaksi
// (invariant #1). Membandingkan dua driver dengan beban yang berbeda tidak
// menghasilkan perbandingan apa pun.
function sqlPenjualan(n) {
  const id = `ord-${n}`;
  const c = `chk-${n}`;
  const w = '2026-08-07T10:00:00Z';
  const pernyataan = [
    `INSERT INTO "order" (id,tenant_id,outlet_id,device_id,shift_id,receipt_number,business_date,
      sequence,status,channel,subtotal,order_discount,service_charge_amount,tax_amount,
      rounding_adjustment,total,amount_due,has_calculation_variance,created_by,occurred_at,
      recorded_at,hlc) VALUES ('${id}','ten-1','out-1','dev-1','shf-1',
      'K1-20260807-${String(n).padStart(4, '0')}','2026-08-07',${n},'closed','takeaway',
      40000,0,0,4400,0,44400,44400,0,'usr-1','${w}','${w}',${n})`,
    `INSERT INTO "check" (id,order_id,label,subtotal,total) VALUES ('${c}','${id}',NULL,40000,44400)`,
  ];
  for (let i = 0; i < 2; i += 1) {
    const l = `${id}-l${i}`;
    pernyataan.push(
      `INSERT INTO order_line (id,order_id,check_id,variation_id,item_name,variation_name,
        unit_price,quantity,modifier_snapshot,discount_amount,tax_rate_id,tax_rate,tax_amount,
        is_tax_inclusive,cost_at_sale,line_total) VALUES ('${l}','${id}','${c}','var-${i}',
        'Kopi Susu','Regular',20000,1000,'[]',0,'tax-1',1100,2200,0,8000,20000)`
    );
    if (i === 0) {
      pernyataan.push(
        `INSERT INTO order_line_modifier (id,order_line_id,modifier_id,name,price,quantity)
         VALUES ('${l}-m0','${l}','mod-1','Extra shot',5000,1000)`
      );
    }
    pernyataan.push(
      `INSERT INTO stock_movement (id,tenant_id,outlet_id,device_id,variation_id,type,delta,
        order_id,reason_code,created_by,occurred_at,recorded_at,hlc) VALUES ('${l}-s','ten-1',
        'out-1','dev-1','var-${i}','sale',-1000,'${id}',NULL,'usr-1','${w}','${w}',${n})`
    );
  }
  pernyataan.push(
    `INSERT INTO payment (id,order_id,check_id,method,amount,tendered_amount,change_amount,
      status,confirmed_manually,tendered_at) VALUES ('${id}-p','${id}','${c}','cash',44400,
      50000,5600,'confirmed',0,'${w}')`,
    `INSERT INTO audit_event (id,tenant_id,outlet_id,device_id,actor_user_id,approver_user_id,
      event_type,entity_type,entity_id,reason_code,occurred_at,recorded_at,hlc) VALUES
      ('${id}-a','ten-1','out-1','dev-1','usr-1',NULL,'order.created','order','${id}',NULL,
      '${w}','${w}',${n})`,
    `INSERT INTO outbox_local (id,entity_type,entity_id,operation,payload,idempotency_key,
      status,attempts,created_at) VALUES ('${id}-o','order','${id}','create','{}','key-${n}',
      'pending',0,'${w}')`
  );
  return `BEGIN;${pernyataan.join(';')};COMMIT;`;
}

async function ukur(sqlite3, namaVfs, db) {
  const label = `wa-sqlite ${namaVfs}`;
  try {
    const tabel = [];
    await sqlite3.exec(db, `SELECT name FROM sqlite_master WHERE type='table'`, (row) => tabel.push(row[0]));
    for (const t of tabel) {
      if (t !== 'sqlite_sequence') await sqlite3.exec(db, `DROP TABLE IF EXISTS "${t}"`);
    }

    const t0 = performance.now();
    await sqlite3.exec(db, SKEMA);
    catat(`${label} pasang skema (20 tabel)`, `${(performance.now() - t0).toFixed(1)} ms`);

    for (let i = 0; i < 20; i += 1) await sqlite3.exec(db, sqlPenjualan(-i - 1));

    const N = 200;
    const durasi = [];
    for (let i = 0; i < N; i += 1) {
      const a = performance.now();
      await sqlite3.exec(db, sqlPenjualan(i));
      durasi.push(performance.now() - a);
    }
    catat(`${label} tulis 1 penjualan (10 baris, 8 tabel) p50`, `${persentil(durasi, 50).toFixed(2)} ms`);
    catat(`${label} tulis 1 penjualan p95`, `${persentil(durasi, 95).toFixed(2)} ms`);
    catat(`${label} tulis 1 penjualan p99`, `${persentil(durasi, 99).toFixed(2)} ms`);
    catat(`${label} throughput`, `${(1000 / (durasi.reduce((a, b) => a + b, 0) / N)).toFixed(0)} penjualan/detik`);

    const b0 = performance.now();
    let total = null;
    await sqlite3.exec(
      db,
      `SELECT SUM(total) FROM "order" WHERE business_date='2026-08-07' AND status='closed'`,
      (row) => { total = row[0]; }
    );
    catat(`${label} baca total hari ini (${N + 20} order)`, `${(performance.now() - b0).toFixed(2)} ms — total ${total}`);

    const c0 = performance.now();
    let baris = 0;
    await sqlite3.exec(
      db,
      `SELECT o.id,o.receipt_number,o.total,COUNT(l.id) FROM "order" o
         LEFT JOIN order_line l ON l.order_id=o.id WHERE o.business_date='2026-08-07'
        GROUP BY o.id ORDER BY o.sequence DESC LIMIT 50`,
      () => { baris += 1; }
    );
    catat(`${label} baca 50 order + join baris`, `${(performance.now() - c0).toFixed(2)} ms — ${baris} baris`);
  } catch (e) {
    catat(`${label} GAGAL saat mengukur`, `${e.name}: ${e.message}`);
  }
}

onmessage = async (ev) => {
  if (ev.data !== 'jalankan') return;
  try {
    const t0 = performance.now();
    const modul = await SQLiteESMFactory();
    const sqlite3 = SQLite.Factory(modul);
    catat('wa-sqlite inisialisasi WASM', `${(performance.now() - t0).toFixed(0)} ms`);
    catat('wa-sqlite versi SQLite', sqlite3.libversion());

    // AccessHandlePoolVFS -- padanan terdekat `opfs-sahpool`: kolam
    // FileSystemSyncAccessHandle yang dipesan di muka.
    try {
      const vfs = await AccessHandlePoolVFS.create('lumi-ahp', modul);
      sqlite3.vfs_register(vfs, false);
      const db = await sqlite3.open_v2('lumi-wa.db', undefined, 'lumi-ahp');
      await ukur(sqlite3, 'AccessHandlePoolVFS', db);
      await sqlite3.close(db);
      await vfs.close?.();
    } catch (e) {
      catat('wa-sqlite AccessHandlePoolVFS', `TIDAK — ${e.name}: ${e.message}`);
    }

    // OPFSCoopSyncVFS -- yang dipakai PowerSync sendiri. Ia yang paling
    // relevan bagi keputusan, karena itulah yang akan berjalan bila PowerSync
    // memiliki database lokalnya.
    try {
      const vfs = await OPFSCoopSyncVFS.create('lumi-coop', modul);
      sqlite3.vfs_register(vfs, false);
      const db = await sqlite3.open_v2('lumi-coop.db', undefined, 'lumi-coop');
      await ukur(sqlite3, 'OPFSCoopSyncVFS', db);
      await sqlite3.close(db);
      await vfs.close?.();
    } catch (e) {
      catat('wa-sqlite OPFSCoopSyncVFS', `TIDAK — ${e.name}: ${e.message}`);
    }

    postMessage({ jenis: 'selesai', hasil });
  } catch (e) {
    postMessage({ jenis: 'gagal', pesan: `${e.name}: ${e.message}` });
  }
};
