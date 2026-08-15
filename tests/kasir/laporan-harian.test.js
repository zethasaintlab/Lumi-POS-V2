'use strict';

// FR-G1 / FR-G2 / FR-G4 — laporan operasional dari data LOKAL.
//
// Di atas SQLite sungguhan dengan skema lokal sungguhan, dengan alasan yang
// sama seperti `tutup-kas-refund.test.js`: fake tidak menegakkan constraint,
// tidak menegakkan `ORDER BY`, dan — yang paling merugikan di laporan — dapat
// mengembalikan bentuk baris yang query sungguhannya tidak akan pernah
// hasilkan.
//
// Yang benar-benar diuji di sini adalah gate F3: "buka toko → jual → tutup
// buku dengan angka KONSISTEN ANTAR LAPORAN."

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const MOD = '../../apps/kasir/src/laporan/harian.ts';
const TUTUP = '../../apps/kasir/src/kas/tutup.ts';
const SKEMA = join(__dirname, '..', '..', 'db', 'local', '001-initial.sql');

const TENANT = 't1';
const OUTLET = 'o1';
const DEVICE = 'd1';
const SHIFT = 's1';
const TANGGAL = '2026-08-13';

function dbSungguhan() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(SKEMA, 'utf8'));
  const db = {
    sqlite,
    async getAll(sql, params = []) {
      return sqlite.prepare(sql).all(...params);
    },
    async execute(sql, params = []) {
      sqlite.prepare(sql).run(...params);
      return { rowsAffected: 1 };
    },
    async transaction(fn) {
      return fn(db);
    },
  };
  sqlite.exec(`
    INSERT INTO cash_drawer_shift
      (id, tenant_id, outlet_id, device_id, business_date, status, opening_float, opened_by, opened_at)
    VALUES ('${SHIFT}','${TENANT}','${OUTLET}','${DEVICE}','${TANGGAL}','open',500000,'u-sari','${TANGGAL}T07:00:00Z')
  `);
  return db;
}

let seq = 0;

/**
 * Satu penjualan lengkap: order + check + baris + payment.
 *
 * `baris` = [{ itemName, variationName, unitPrice, qty }] dengan qty dalam
 * satuan utuh (dikali 1000 di sini, sesuai konvensi kuantitas).
 */
function jual(db, { id, baris, metode = 'cash', jam = '10', taxAmount = 0, businessDate = TANGGAL, statusBayar = 'confirmed' }) {
  const s = db.sqlite;
  seq += 1;
  const total = baris.reduce((t, b) => t + b.unitPrice * b.qty, 0);
  s.exec(`
    INSERT INTO "order"
      (id, tenant_id, outlet_id, device_id, shift_id, receipt_number, business_date, sequence,
       status, channel, subtotal, order_discount, service_charge_amount, tax_amount,
       rounding_adjustment, total, amount_due, created_by, occurred_at, hlc)
    VALUES ('${id}','${TENANT}','${OUTLET}','${DEVICE}','${SHIFT}','K1-${seq}','${businessDate}',${seq},
            'closed','takeaway',${total},0,0,${taxAmount},0,${total},${total},'u-sari',
            '${businessDate}T${jam}:00:00Z',${seq})
  `);
  s.exec(`INSERT INTO "check" (id, order_id, subtotal, total) VALUES ('chk-${id}','${id}',${total},${total})`);
  baris.forEach((b, i) => {
    s.exec(`
      INSERT INTO order_line
        (id, order_id, check_id, variation_id, item_name, variation_name,
         unit_price, quantity, line_total)
      VALUES ('ln-${id}-${i}','${id}','chk-${id}','${b.variationId}','${b.itemName}','${b.variationName}',
              ${b.unitPrice}, ${b.qty * 1000}, ${b.unitPrice * b.qty})
    `);
  });
  s.exec(`
    INSERT INTO payment (id, order_id, check_id, method, amount, status, tendered_at)
    VALUES ('pay-${id}','${id}','chk-${id}','${metode}',${total},'${statusBayar}','${businessDate}T${jam}:00:00Z')
  `);
  return total;
}

function refund(db, { id, orderId, amount, metode = 'cash' }) {
  db.sqlite.exec(`
    INSERT INTO refund (id, order_id, amount, reason_code, method, created_by, approved_by, occurred_at, hlc)
    VALUES ('${id}','${orderId}',${amount},'salah_input','${metode}','u-sari','u-budi','${TANGGAL}T12:00:00Z',99)
  `);
}

const KOPI = { variationId: 'v-kopi', itemName: 'Kopi Susu', variationName: 'Reguler' };
const ROTI = { variationId: 'v-roti', itemName: 'Roti Bakar', variationName: 'Cokelat' };

// ---------------------------------------------------------------------------

test('laporan harian: omzet, transaksi, rata-rata', async () => {
  const { laporanHarian } = await import(MOD);
  const db = dbSungguhan();
  jual(db, { id: 'o1', baris: [{ ...KOPI, unitPrice: 25000, qty: 2 }] });
  jual(db, { id: 'o2', baris: [{ ...ROTI, unitPrice: 30000, qty: 1 }] });

  const l = await laporanHarian(db, { businessDate: TANGGAL });

  assert.equal(l.penjualan.omzetKotor, 80000n);
  assert.equal(l.penjualan.omzetBersih, 80000n);
  assert.equal(l.penjualan.jumlahTransaksi, 2);
  assert.equal(l.penjualan.rataRataPerTransaksi, 40000n);
});

test('⛔ tanggal bisnis, bukan tanggal kalender (spec-g:92)', async () => {
  // Kafe yang tutup pukul 01:00 mengharapkan penjualan pukul 00:30 masuk hari
  // SEBELUMNYA. Yang menentukan adalah kolom `business_date` yang sudah
  // distempel saat penjualan ditulis — laporan tidak menghitung ulang dari
  // `occurred_at`, karena itu berarti dua tempat memutuskan hal yang sama.
  const { laporanHarian } = await import(MOD);
  const db = dbSungguhan();
  jual(db, { id: 'o1', baris: [{ ...KOPI, unitPrice: 25000, qty: 1 }], jam: '10' });
  // Penjualan pukul 00:30 waktu kalender berikutnya, tapi tanggal bisnisnya
  // masih hari ini.
  jual(db, { id: 'o2', baris: [{ ...KOPI, unitPrice: 25000, qty: 1 }], jam: '00', businessDate: TANGGAL });
  // Dan satu yang benar-benar hari lain.
  jual(db, { id: 'o3', baris: [{ ...KOPI, unitPrice: 99000, qty: 1 }], businessDate: '2026-08-14' });

  const l = await laporanHarian(db, { businessDate: TANGGAL });
  assert.equal(l.penjualan.omzetKotor, 50000n, 'hari lain ikut terhitung');
  assert.equal(l.penjualan.jumlahTransaksi, 2);
});

test('rincian per metode pembayaran (FR-G1)', async () => {
  const { laporanHarian } = await import(MOD);
  const db = dbSungguhan();
  jual(db, { id: 'o1', baris: [{ ...KOPI, unitPrice: 25000, qty: 1 }], metode: 'cash' });
  jual(db, { id: 'o2', baris: [{ ...KOPI, unitPrice: 40000, qty: 1 }], metode: 'qris_dynamic' });
  jual(db, { id: 'o3', baris: [{ ...KOPI, unitPrice: 10000, qty: 1 }], metode: 'cash' });

  const l = await laporanHarian(db, { businessDate: TANGGAL });
  const tunai = l.perMetode.find((m) => m.metode === 'cash');
  const qris = l.perMetode.find((m) => m.metode === 'qris_dynamic');
  assert.equal(tunai.total, 35000n);
  assert.equal(tunai.jumlah, 2);
  assert.equal(qris.total, 40000n);
});

test('distribusi per jam untuk perencanaan staf (FR-G1)', async () => {
  const { laporanHarian } = await import(MOD);
  const db = dbSungguhan();
  jual(db, { id: 'o1', baris: [{ ...KOPI, unitPrice: 10000, qty: 1 }], jam: '08' });
  jual(db, { id: 'o2', baris: [{ ...KOPI, unitPrice: 10000, qty: 1 }], jam: '08' });
  jual(db, { id: 'o3', baris: [{ ...KOPI, unitPrice: 10000, qty: 1 }], jam: '14' });

  const l = await laporanHarian(db, { businessDate: TANGGAL });
  const delapan = l.perJam.find((j) => j.jam === 8);
  assert.equal(delapan.jumlahTransaksi, 2);
  assert.equal(l.perJam.find((j) => j.jam === 14).jumlahTransaksi, 1);
  // Jam tanpa transaksi TIDAK dilaporkan sebagai nol yang memenuhi layar —
  // hanya jam yang benar-benar punya transaksi.
  assert.equal(l.perJam.length, 2);
});

// --- Gate F3: angka yang konsisten antar laporan ---------------------------

test('⛔ laporan per produk berjumlah SAMA dengan laporan harian (AC FR-G3 kedua)', async () => {
  const { laporanHarian, laporanPerProduk } = await import(MOD);
  const db = dbSungguhan();
  jual(db, {
    id: 'o1',
    baris: [
      { ...KOPI, unitPrice: 25000, qty: 2 },
      { ...ROTI, unitPrice: 30000, qty: 1 },
    ],
  });
  jual(db, { id: 'o2', baris: [{ ...KOPI, unitPrice: 25000, qty: 1 }] });

  const harian = await laporanHarian(db, { businessDate: TANGGAL });
  const produk = await laporanPerProduk(db, { businessDate: TANGGAL });

  const jumlahProduk = produk.baris.reduce((t, b) => t + b.omzet, 0n);
  assert.equal(
    jumlahProduk,
    harian.penjualan.omzetKotor,
    'laporan per produk dan laporan harian tidak sepakat — inilah yang spec-g:29 sebut ' +
      'menghancurkan kepercayaan merchant'
  );
});

test('⛔ laporan harian sepakat dengan laporan shift untuk shift yang sama (AC FR-G3 ketiga)', async () => {
  const { laporanHarian } = await import(MOD);
  const { laporanShift } = await import(TUTUP);
  const db = dbSungguhan();
  jual(db, { id: 'o1', baris: [{ ...KOPI, unitPrice: 25000, qty: 2 }] });
  jual(db, { id: 'o2', baris: [{ ...ROTI, unitPrice: 30000, qty: 1 }] });
  refund(db, { id: 'r1', orderId: 'o2', amount: 30000 });

  const harian = await laporanHarian(db, { businessDate: TANGGAL });
  const shift = await laporanShift(db, SHIFT);

  assert.deepEqual(
    harian.penjualan,
    shift.penjualan,
    'satu shift, satu hari — posisinya harus identik, bukan sekadar mirip'
  );
});

test('per produk: kuantitas, omzet, dan kontribusi persen', async () => {
  const { laporanPerProduk } = await import(MOD);
  const db = dbSungguhan();
  jual(db, {
    id: 'o1',
    baris: [
      { ...KOPI, unitPrice: 25000, qty: 3 }, // 75.000
      { ...ROTI, unitPrice: 25000, qty: 1 }, // 25.000
    ],
  });

  const l = await laporanPerProduk(db, { businessDate: TANGGAL });
  const kopi = l.baris.find((b) => b.variationId === 'v-kopi');
  assert.equal(kopi.kuantitasMilli, 3000, 'kuantitas x1000, bukan dibulatkan ke satuan');
  assert.equal(kopi.omzet, 75000n);
  assert.equal(kopi.kontribusiPersen, 75);
  // Terurut menurun: baris teratas adalah yang paling besar omzetnya.
  assert.equal(l.baris[0].variationId, 'v-kopi');
});

test('⛔ tidak ada kolom margin maupun HPP di laporan perangkat (FR-F5)', async () => {
  // `spec-f:66`: "kolom dan field yang memuat cost/margin TIDAK ADA di
  // respons — bukan sekadar disembunyikan di UI." Di perangkat ini bahkan
  // tidak mungkin ada: `item_variation.cost` sudah dibuang dari skema lokal
  // dan dari sync rules (14 Agustus 2026), jadi datanya tidak pernah turun.
  const { laporanPerProduk } = await import(MOD);
  const db = dbSungguhan();
  jual(db, { id: 'o1', baris: [{ ...KOPI, unitPrice: 25000, qty: 1 }] });

  const l = await laporanPerProduk(db, { businessDate: TANGGAL });
  for (const b of l.baris) {
    for (const terlarang of ['margin', 'cost', 'hpp', 'costAtSale', 'marginPersen']) {
      assert.equal(
        Object.keys(b).includes(terlarang),
        false,
        `laporan per produk memuat ${terlarang}`
      );
    }
  }
});

// --- FR-G2 dan FR-G4 -------------------------------------------------------

test('⛔ setiap laporan menyatakan angkanya BERSIH atau KOTOR (FR-G2)', async () => {
  // `spec-g:64`: labelnya "tidak dapat dilewatkan" — dan itu berarti ia ada di
  // DATA, bukan hanya di teks layar. Laporan yang mengirim angka tanpa
  // basisnya memaksa setiap pemanggil menebak, dan ekspor CSV kehilangannya
  // sepenuhnya (`spec-g:74`).
  const { laporanHarian, laporanPerProduk } = await import(MOD);
  const db = dbSungguhan();
  jual(db, { id: 'o1', baris: [{ ...KOPI, unitPrice: 25000, qty: 1 }] });

  const harian = await laporanHarian(db, { businessDate: TANGGAL });
  const produk = await laporanPerProduk(db, { businessDate: TANGGAL });

  assert.equal(harian.basis, 'setelah void & refund');
  assert.equal(produk.basis, 'sebelum void & refund');
});

test('⛔ laporan menyatakan CAKUPANNYA: perangkat ini saja (FR-G4)', async () => {
  // `spec-g:111`: "Laporan ini hanya mencakup transaksi dari perangkat ini."
  // Tanpa pernyataan itu, owner multi-perangkat membaca angka satu tablet
  // sebagai angka outletnya.
  const { laporanHarian } = await import(MOD);
  const db = dbSungguhan();
  const l = await laporanHarian(db, { businessDate: TANGGAL });
  assert.equal(l.cakupan, 'perangkat-ini');
});

test('hari tanpa transaksi: nol, dan itu keadaan yang sah', async () => {
  // `spec-g:274` membedakannya dari "tidak ada yang cocok dengan filter".
  const { laporanHarian, laporanPerProduk } = await import(MOD);
  const db = dbSungguhan();

  const harian = await laporanHarian(db, { businessDate: TANGGAL });
  assert.equal(harian.penjualan.omzetKotor, 0n);
  assert.equal(harian.penjualan.jumlahTransaksi, 0);
  assert.deepEqual(harian.perMetode, []);
  assert.deepEqual(harian.perJam, []);

  const produk = await laporanPerProduk(db, { businessDate: TANGGAL });
  assert.deepEqual(produk.baris, []);
});

test('⛔ baris order yang DIBATALKAN tidak muncul di laporan per produk', async () => {
  // Kalau ia tetap muncul, jumlah per produk melampaui omzet harian — dan
  // test konsistensi di atas justru yang akan merah lebih dulu.
  const { laporanHarian, laporanPerProduk } = await import(MOD);
  const db = dbSungguhan();
  jual(db, { id: 'o1', baris: [{ ...KOPI, unitPrice: 25000, qty: 1 }] });
  jual(db, { id: 'o2', baris: [{ ...ROTI, unitPrice: 60000, qty: 1 }] });
  db.sqlite.exec(`
    INSERT INTO "order"
      (id, tenant_id, outlet_id, device_id, shift_id, receipt_number, business_date, sequence,
       status, channel, subtotal, order_discount, service_charge_amount, tax_amount,
       rounding_adjustment, total, amount_due, voided_by_order_id, created_by, occurred_at, hlc)
    VALUES ('v1','${TENANT}','${OUTLET}','${DEVICE}','${SHIFT}','K1-v','${TANGGAL}',99,
            'voided','takeaway',60000,0,0,0,0,60000,60000,'o2','u-sari','${TANGGAL}T13:00:00Z',100)
  `);

  const produk = await laporanPerProduk(db, { businessDate: TANGGAL });
  assert.equal(produk.baris.length, 1, 'produk dari order yang dibatalkan masih muncul');
  assert.equal(produk.baris[0].variationId, 'v-kopi');

  const harian = await laporanHarian(db, { businessDate: TANGGAL });
  assert.equal(
    produk.baris.reduce((t, b) => t + b.omzet, 0n),
    harian.penjualan.omzetKotor
  );
});

// ---------------------------------------------------------------------------
// ⛔ Status pembayaran
// ---------------------------------------------------------------------------

test('⛔ payment pending dan failed TIDAK dihitung di ringkasan per metode', async () => {
  // `spec-c:223` — hanya `confirmed` yang boleh dianggap uang masuk.
  //
  // Cacat yang ini perbaiki: `harian.ts` tidak menyaring status sama sekali,
  // jadi QRIS dinamis yang masih `pending_confirmation` dan payment `failed`
  // ikut terjumlahkan. Laporan di tablet menampilkan uang masuk LEBIH BESAR
  // daripada back-office, dan selisihnya muncul saat rekonsiliasi sebagai uang
  // yang seolah hilang di tangan kasir.
  //
  // 272 test kasir hijau tanpa satu pun menyentuh status payment — itulah
  // kenapa cacatnya tidak terlihat.
  const db = dbSungguhan();
  jual(db, { id: 'o-lunas', baris: [{ ...KOPI, unitPrice: 25000, qty: 1 }], metode: 'cash' });
  jual(db, { id: 'o-pending', baris: [{ ...ROTI, unitPrice: 90000, qty: 1 }], metode: 'qris_dynamic', statusBayar: 'pending_confirmation' });
  jual(db, { id: 'o-gagal', baris: [{ ...KOPI, unitPrice: 80000, qty: 1 }], metode: 'card_edc', statusBayar: 'failed' });

  const { laporanHarian } = await import(MOD);
  const hasil = await laporanHarian(db, { businessDate: TANGGAL });

  assert.deepEqual(
    hasil.perMetode.map((m) => m.metode),
    ['cash'],
    'metode dengan payment belum/tidak terkonfirmasi ikut dilaporkan'
  );
  assert.equal(hasil.perMetode[0].total, 25000n);
});
