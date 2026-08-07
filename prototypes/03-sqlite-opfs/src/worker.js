// Engine SQLite + OPFS hidup DI SINI, di Web Worker.
//
// `research/03-TECH-STACK-EVALUATION.md`:187 mencatatnya sebagai pola yang
// direkomendasikan -- engine dan filesystem dipindahkan ke worker supaya UI
// tetap 60 FPS terlepas dari beban database. Prototipe ini mengikutinya, bukan
// menyederhanakannya, karena yang diukur harus berbentuk sama dengan yang akan
// dipakai.

import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
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

/**
 * SATU PENJUALAN = SATU TRANSAKSI (invariant #1).
 *
 * Yang ditulis di sini bukan satu baris `INSERT` yang enak diukur, melainkan
 * bentuk yang sebenarnya: order + check + dua order_line + satu modifier +
 * payment + dua stock_movement + audit_event + outbox_local. Sepuluh baris di
 * sembilan tabel, dalam satu transaksi.
 *
 * Mengukur satu INSERT tunggal akan menghasilkan angka yang bagus dan tidak
 * berarti apa-apa.
 */
function tulisSatuPenjualan(db, n) {
  const id = `ord-${n}`;
  const checkId = `chk-${n}`;
  db.exec('BEGIN');
  try {
    db.exec({
      sql: `INSERT INTO "order" (id, tenant_id, outlet_id, device_id, shift_id, receipt_number,
              business_date, sequence, status, channel, subtotal, order_discount,
              service_charge_amount, tax_amount, rounding_adjustment, total, amount_due,
              has_calculation_variance, created_by, occurred_at, recorded_at, hlc)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      bind: [id, 'ten-1', 'out-1', 'dev-1', 'shf-1', `K1-20260807-${String(n).padStart(4, '0')}`,
        '2026-08-07', n, 'closed', 'takeaway', 40000, 0, 0, 4400, 0, 44400, 44400, 0,
        'usr-1', '2026-08-07T10:00:00Z', '2026-08-07T10:00:00Z', n],
    });
    db.exec({
      sql: `INSERT INTO "check" (id, order_id, label, subtotal, total) VALUES (?,?,?,?,?)`,
      bind: [checkId, id, null, 40000, 44400],
    });
    for (let i = 0; i < 2; i += 1) {
      const lineId = `${id}-l${i}`;
      db.exec({
        sql: `INSERT INTO order_line (id, order_id, check_id, variation_id, item_name,
                variation_name, unit_price, quantity, modifier_snapshot, discount_amount,
                tax_rate_id, tax_rate, tax_amount, is_tax_inclusive, cost_at_sale, line_total)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        bind: [lineId, id, checkId, `var-${i}`, 'Kopi Susu', 'Regular',
          20000, 1000, '[]', 0, 'tax-1', 1100, 2200, 0, 8000, 20000],
      });
      if (i === 0) {
        db.exec({
          sql: `INSERT INTO order_line_modifier (id, order_line_id, modifier_id, name, price, quantity)
                VALUES (?,?,?,?,?,?)`,
          bind: [`${lineId}-m0`, lineId, 'mod-1', 'Extra shot', 5000, 1000],
        });
      }
      db.exec({
        sql: `INSERT INTO stock_movement (id, tenant_id, outlet_id, device_id, variation_id, type,
                delta, order_id, reason_code, created_by, occurred_at, recorded_at, hlc)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        bind: [`${lineId}-s`, 'ten-1', 'out-1', 'dev-1', `var-${i}`, 'sale', -1000, id, null,
          'usr-1', '2026-08-07T10:00:00Z', '2026-08-07T10:00:00Z', n],
      });
    }
    db.exec({
      sql: `INSERT INTO payment (id, order_id, check_id, method, amount, tendered_amount,
              change_amount, status, confirmed_manually, tendered_at)
            VALUES (?,?,?,?,?,?,?,?,?,?)`,
      bind: [`${id}-p`, id, checkId, 'cash', 44400, 50000, 5600, 'confirmed', 0,
        '2026-08-07T10:00:00Z'],
    });
    db.exec({
      sql: `INSERT INTO audit_event (id, tenant_id, outlet_id, device_id, actor_user_id,
              approver_user_id, event_type, entity_type, entity_id, reason_code, occurred_at,
              recorded_at, hlc) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      bind: [`${id}-a`, 'ten-1', 'out-1', 'dev-1', 'usr-1', null, 'order.created', 'order', id,
        null, '2026-08-07T10:00:00Z', '2026-08-07T10:00:00Z', n],
    });
    db.exec({
      sql: `INSERT INTO outbox_local (id, entity_type, entity_id, operation, payload,
              idempotency_key, status, attempts, created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
      bind: [`${id}-o`, 'order', id, 'create', '{}', `key-${n}`, 'pending', 0,
        '2026-08-07T10:00:00Z'],
    });
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

async function ukur(sqlite3, namaVfs, bukaDb) {
  const label = `vfs=${namaVfs}`;
  let db;
  try {
    db = bukaDb();
  } catch (e) {
    catat(`${label} tersedia`, `TIDAK — ${e.message}`);
    return;
  }
  catat(`${label} tersedia`, 'ya');
  // Kegagalan SETELAH titik ini bukan soal ketersediaan VFS. Versi pertama
  // melaporkannya sebagai "tersedia: TIDAK" dan menyembunyikan penyebab
  // aslinya -- kolom yang tidak cocok terbaca seperti OPFS yang tidak jalan.

  try {
    // Bersihkan supaya angka tidak tergantung sisa run sebelumnya.
    const tabel = db.selectValues(`SELECT name FROM sqlite_master WHERE type='table'`);
    for (const t of tabel) {
      if (t !== 'sqlite_sequence') db.exec(`DROP TABLE IF EXISTS "${t}"`);
    }

    const t0 = performance.now();
    db.exec(SKEMA);
    catat(`${label} pasang skema (20 tabel)`, `${(performance.now() - t0).toFixed(1)} ms`);

    // Pemanasan: run pertama memuat halaman dan membuat berkas jurnal.
    for (let i = 0; i < 20; i += 1) tulisSatuPenjualan(db, -i - 1);

    const N = 200;
    const durasi = [];
    for (let i = 0; i < N; i += 1) {
      const a = performance.now();
      tulisSatuPenjualan(db, i);
      durasi.push(performance.now() - a);
    }
    catat(`${label} tulis 1 penjualan (10 baris, 8 tabel) p50`, `${persentil(durasi, 50).toFixed(2)} ms`);
    catat(`${label} tulis 1 penjualan p95`, `${persentil(durasi, 95).toFixed(2)} ms`);
    catat(`${label} tulis 1 penjualan p99`, `${persentil(durasi, 99).toFixed(2)} ms`);
    catat(`${label} throughput`, `${(1000 / (durasi.reduce((a, b) => a + b, 0) / N)).toFixed(0)} penjualan/detik`);

    // Baca: laporan penjualan hari ini -- query yang kasir jalankan saat
    // tutup shift, dan satu-satunya yang harus cepat dengan data menumpuk.
    const b0 = performance.now();
    const total = db.selectValue(
      `SELECT SUM(total) FROM "order" WHERE business_date = '2026-08-07' AND status = 'closed'`
    );
    catat(`${label} baca total hari ini (${N + 20} order)`, `${(performance.now() - b0).toFixed(2)} ms — total ${total}`);

    const c0 = performance.now();
    db.selectObjects(
      `SELECT o.id, o.receipt_number, o.total, COUNT(l.id) AS baris
         FROM "order" o LEFT JOIN order_line l ON l.order_id = o.id
        WHERE o.business_date = '2026-08-07' GROUP BY o.id ORDER BY o.sequence DESC LIMIT 50`
    );
    catat(`${label} baca 50 order + join baris`, `${(performance.now() - c0).toFixed(2)} ms`);

    const jumlah = db.selectValue('SELECT COUNT(*) FROM "order"');
    catat(`${label} order tersimpan`, String(jumlah));
  } catch (e) {
    catat(`${label} GAGAL saat mengukur`, `${e.name}: ${e.message}`);
  } finally {
    if (db) db.close();
  }
}

onmessage = async (ev) => {
  // Mode `tahan`: buka pool SAHPool lalu biarkan terbuka.
  //
  // Ini satu-satunya cara menguji pertanyaan yang benar-benar penting: apa
  // yang terjadi ketika kasir membuka TAB KEDUA. Dua koneksi di dalam satu
  // worker tidak menjawabnya -- keduanya berbagi pool yang sama, dan hasilnya
  // "diizinkan" yang menyesatkan.
  if (ev.data === 'tahan') {
    try {
      const sqlite3 = await sqlite3InitModule();
      const pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'lumi-pool' });
      const db = new pool.OpfsSAHPoolDb('/lumi.sqlite3');
      postMessage({ jenis: 'progres', nama: 'tab ini memegang pool', nilai: 'ya' });
      // Sengaja TIDAK ditutup.
      self.__tahan = { pool, db };
    } catch (e) {
      postMessage({ jenis: 'progres', nama: 'tab ini memegang pool', nilai: `GAGAL — ${e.name}: ${e.message}` });
    }
    return;
  }
  if (ev.data !== 'jalankan') return;
  try {
    catat('crossOriginIsolated', String(self.crossOriginIsolated));
    catat('OPFS tersedia', String(typeof navigator?.storage?.getDirectory === 'function'));

    const t0 = performance.now();
    const sqlite3 = await sqlite3InitModule();
    catat('inisialisasi WASM', `${(performance.now() - t0).toFixed(0)} ms`);
    catat('versi SQLite', sqlite3.version.libVersion);

    // VFS OPFS resmi -- butuh SharedArrayBuffer, jadi butuh COOP/COEP.
    try {
      if (!sqlite3.oo1.OpfsDb) throw new Error('OpfsDb tidak ada di build ini');
      await ukur(sqlite3, 'opfs', () => new sqlite3.oo1.OpfsDb('/lumi-opfs.sqlite3'));
    } catch (e) {
      catat('vfs=opfs tersedia', `TIDAK — ${e.message}`);
    }

    // VFS SAHPool -- TIDAK butuh COOP/COEP. Kalau ia cukup cepat, dashboard
    // owner tidak perlu membayar header itu sama sekali.
    //
    // Ia diukur BELAKANGAN dan dibongkar setelahnya, karena SAHPool memesan
    // access handle secara EKSKLUSIF di muka. Pool yang tidak dilepas membuat
    // run berikutnya gagal dengan "Access Handles cannot be created if there
    // is another open Access Handle" -- dan itu bukan gangguan prototipe,
    // melainkan sifat OPFS yang menentukan arsitektur klien (lihat pengukuran
    // eksklusivitas di bawah).
    let pool = null;
    try {
      pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'lumi-pool' });
      await ukur(sqlite3, 'opfs-sahpool', () => new pool.OpfsSAHPoolDb('/lumi.sqlite3'));
    } catch (e) {
      catat('vfs=opfs-sahpool tersedia', `TIDAK — ${e.message}`);
    }

    // Eksklusivitas OPFS, diukur SENGAJA.
    //
    // Ini pertanyaan arsitektur, bukan detail: kalau dua tab tidak dapat
    // menulis ke database yang sama, klien WAJIB memakai pola "hanya tab aktif
    // yang menulis" -- persis yang dilakukan Notion menurut
    // research/03-TECH-STACK-EVALUATION.md:185. Mengetahuinya sekarang lebih
    // murah daripada menemukannya saat kasir membuka tab kedua.
    if (pool !== null) {
      try {
        const db2 = new pool.OpfsSAHPoolDb('/lumi.sqlite3');
        db2.close();
        catat('dua koneksi ke berkas yang sama (VFS sama)', 'DIIZINKAN');
      } catch (e) {
        catat('dua koneksi ke berkas yang sama (VFS sama)', `DITOLAK — ${e.message}`);
      }
      try {
        const poolKedua = await sqlite3.installOpfsSAHPoolVfs({ name: 'lumi-pool-2' });
        const db3 = new poolKedua.OpfsSAHPoolDb('/lumi.sqlite3');
        db3.close();
        await poolKedua.removeVfs();
        catat('pool KEDUA atas berkas yang sama', 'DIIZINKAN — tidak eksklusif');
      } catch (e) {
        catat('pool KEDUA atas berkas yang sama', `DITOLAK — ${e.name}`);
      }
      // Dilepas supaya run berikutnya bersih. Kalau ini dilupakan, kegagalan
      // berikutnya terbaca seperti OPFS yang rusak.
      await pool.removeVfs();
      catat('pool dilepas', 'ya');
    }

    // Kuota: berapa ruang yang dijanjikan browser, dan berapa yang terpakai.
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      catat('kuota penyimpanan', `${(est.quota / 1024 / 1024).toFixed(0)} MB, terpakai ${(est.usage / 1024 / 1024).toFixed(1)} MB`);
    }
    if (navigator.storage?.persisted) {
      catat('penyimpanan persisted', String(await navigator.storage.persisted()));
    }

    postMessage({ jenis: 'selesai', hasil });
  } catch (e) {
    postMessage({ jenis: 'gagal', pesan: `${e.name}: ${e.message}` });
  }
};
