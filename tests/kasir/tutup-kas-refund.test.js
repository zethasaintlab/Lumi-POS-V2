'use strict';

// Saldo seharusnya vs refund tunai — di atas SQLite SUNGGUHAN.
//
// ⛔ Kenapa berkas ini terpisah dari `tutup-kas.test.js`: berkas itu memberi
// makan `pembayaranTunai` lewat `dbPalsu`, dan yang diberikannya adalah
//
//     { method: 'cash', amount: 25000, arah: -1 }
//
// dengan komentar "refund tunai 25.000". Baris itu TIDAK DAPAT dihasilkan
// query sungguhannya: refund tidak pernah menulis baris `payment`
// (`payment.amount` punya `CHECK (amount > 0)`, dan arah berlawanan
// dinyatakan lewat tabel `refund` — keputusan 7 Agustus 2026). Fake-nya
// mengarang bentuk data yang skemanya sendiri tidak bisa menghasilkan, jadi
// aritmetikanya diuji terhadap dunia yang tidak ada.
//
// Karena itu di sini tidak ada fake sama sekali. Skema lokal yang sungguhan
// dimuat ke `node:sqlite`, barisnya ditulis lewat SQL, dan yang dipanggil
// adalah fungsi yang sama yang dipakai layar K-12.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const MOD = '../../apps/kasir/src/kas/tutup.ts';
const SKEMA = join(__dirname, '..', '..', 'db', 'local', '001-initial.sql');

/** `DbLokal` di atas `node:sqlite` — tanpa satu pun jawaban yang dikarang. */
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
  return db;
}

const SHIFT_ID = 's1';
const TENANT = 't1';
const OUTLET = 'o1';
const DEVICE = 'd1';

/**
 * Satu penjualan tunai, lalu refund tunai seluruhnya.
 *
 * Ditulis persis seperti jalur produksi menulisnya: penjualan menghasilkan
 * `order` + `payment`; refund menghasilkan baris `refund` dan TIDAK menyentuh
 * `payment` sama sekali.
 */
function isiSatuPenjualanTunai(db, nilai) {
  const s = db.sqlite;
  s.exec(`
    INSERT INTO cash_drawer_shift
      (id, tenant_id, outlet_id, device_id, business_date, status, opening_float, opened_by, opened_at)
    VALUES ('${SHIFT_ID}','${TENANT}','${OUTLET}','${DEVICE}','2026-08-13','open',500000,'u-sari','2026-08-13T07:00:00Z')
  `);
  s.exec(`
    INSERT INTO "order"
      (id, tenant_id, outlet_id, device_id, shift_id, receipt_number, business_date, sequence,
       status, channel, subtotal, order_discount, service_charge_amount, tax_amount,
       rounding_adjustment, total, amount_due, created_by, occurred_at, hlc)
    VALUES ('ord-1','${TENANT}','${OUTLET}','${DEVICE}','${SHIFT_ID}','K1-20260813-0001','2026-08-13',1,
            'closed','dine_in',${nilai},0,0,0,0,${nilai},${nilai},'u-sari','2026-08-13T10:00:00Z',1)
  `);
  s.exec(`INSERT INTO "check" (id, order_id, subtotal, total) VALUES ('chk-1','ord-1',${nilai},${nilai})`);
  s.exec(`
    INSERT INTO payment
      (id, order_id, check_id, method, amount, tendered_amount, change_amount, status, tendered_at)
    VALUES ('pay-1','ord-1','chk-1','cash',${nilai},${nilai},0,'confirmed','2026-08-13T10:00:00Z')
  `);
}

/**
 * Refund SELURUH nilainya. Tidak ada baris `payment` di sini — dan itu bukan
 * penyederhanaan test, itu memang bentuknya di produksi.
 */
function refundPenuh(db, nilai, metodeRefund) {
  db.sqlite.exec(`
    INSERT INTO refund
      (id, order_id, amount, reason_code, method, created_by, approved_by, occurred_at, hlc)
    VALUES ('ref-1','ord-1',${nilai},'salah_input','${metodeRefund}','u-sari','u-budi','2026-08-13T11:00:00Z',2)
  `);
  // Movement refund HANYA untuk yang tunai — sejajar aturan `sale` di
  // `spec-d:200`.
  if (metodeRefund === 'cash') {
    db.sqlite.exec(`
      INSERT INTO cash_movement
        (id, shift_id, type, delta, order_id, counterpart_type, created_by, occurred_at, hlc)
      VALUES ('cm-ref-1','${SHIFT_ID}','refund',${-nilai},'ord-1','refund','u-sari','2026-08-13T11:00:00Z',2)
    `);
  }
}

/** Movement tunai untuk shift ini, ditulis seperti jalur produksi menulisnya. */
function catatMovement(db, { id, tipe, delta, orderId = null, counterpart }) {
  db.sqlite.exec(`
    INSERT INTO cash_movement
      (id, shift_id, type, delta, order_id, counterpart_type, created_by, occurred_at, hlc)
    VALUES ('${id}','${SHIFT_ID}','${tipe}',${delta},${orderId ? `'${orderId}'` : 'NULL'},
            '${counterpart}','u-sari','2026-08-13T10:00:00Z',1)
  `);
}

test('⛔ saldo seharusnya IKUT NAIK oleh penjualan tunai', async () => {
  // ⛔ Test ini ada supaya test refund di bawah tidak dapat hijau karena
  // KOSONG. Kalau `saldoSeharusnya` membaca `cash_movement` sementara tidak
  // ada satu pun baris yang ditulis, hasilnya 500.000 — persis jawaban yang
  // dituntut test refund, dan ia akan hijau tanpa satu pun uang dihitung.
  const { catatHitungan } = await import(MOD);
  const db = dbSungguhan();
  isiSatuPenjualanTunai(db, 300000);
  catatMovement(db, {
    id: 'cm-1', tipe: 'sale', delta: 300000, orderId: 'ord-1', counterpart: 'sales_revenue',
  });

  const hasil = await catatHitungan({
    db, shiftId: SHIFT_ID, hitungan: 800000, waktu: () => new Date('2026-08-13T22:00:00Z'),
  });

  assert.equal(hasil.saldoSeharusnya, 800000, 'penjualan tunai tidak menambah saldo seharusnya');
});

test('⛔ refund NON-TUNAI tidak menyentuh laci', async () => {
  // Uang yang kembali lewat transfer tidak keluar dari laci. Mengurangkannya
  // membuat kasir terlihat KELEBIHAN sebesar nilai refund — cacat yang sama
  // besarnya dengan yang sedang diperbaiki, hanya berlawanan arah.
  const { catatHitungan } = await import(MOD);
  const db = dbSungguhan();
  isiSatuPenjualanTunai(db, 300000);
  catatMovement(db, {
    id: 'cm-1', tipe: 'sale', delta: 300000, orderId: 'ord-1', counterpart: 'sales_revenue',
  });
  refundPenuh(db, 300000, 'qris_dynamic');

  const hasil = await catatHitungan({
    db, shiftId: SHIFT_ID, hitungan: 800000, waktu: () => new Date('2026-08-13T22:00:00Z'),
  });

  assert.equal(hasil.saldoSeharusnya, 800000, 'refund non-tunai ikut mengurangi laci');
});

test('⛔ refund tunai MENGURANGI saldo seharusnya', async () => {
  // Kasir menjual Rp 300.000 tunai, lalu merefundnya penuh — uangnya
  // dikeluarkan dari laci dan diserahkan kembali ke pelanggan. Laci karena
  // itu kembali ke saldo awal.
  //
  // Kalau refund tidak dihitung, saldo seharusnya tetap 800.000 sementara
  // laci berisi 500.000: kasir terlihat kurang Rp 300.000. Itu di atas ambang
  // Rp 20.000, jadi ia juga menuntut otorisasi manajer — untuk selisih yang
  // tidak pernah ada.
  const { catatHitungan, butuhOtorisasiSelisih } = await import(MOD);
  const db = dbSungguhan();
  isiSatuPenjualanTunai(db, 300000);
  catatMovement(db, {
    id: 'cm-1', tipe: 'sale', delta: 300000, orderId: 'ord-1', counterpart: 'sales_revenue',
  });
  refundPenuh(db, 300000, 'cash');

  // Kasir menghitung isi laci apa adanya: 500.000, persis saldo awal.
  const hasil = await catatHitungan({
    db,
    shiftId: SHIFT_ID,
    hitungan: 500000,
    waktu: () => new Date('2026-08-13T22:00:00Z'),
  });

  assert.equal(
    hasil.saldoSeharusnya,
    500000,
    'refund tunai tidak dikurangkan dari saldo seharusnya — kasir akan terlihat ' +
      'kurang sebesar nilai refund, setiap kali'
  );
  assert.equal(hasil.selisih, 0, 'selisih yang dilaporkan bukan nol padahal laci benar');
  assert.equal(
    butuhOtorisasiSelisih(hasil.selisih),
    false,
    'shift yang lacinya benar menuntut otorisasi manajer'
  );
});

// --- FR-G3: laporan shift memakai posisi penjualan kanonik ---

test('⛔ laporan shift membawa posisi penjualan, dan angkanya dari FR-G3', async () => {
  // AC FR-G3 ketiga: "Laporan shift dan laporan harian untuk shift yang sama
  // konsisten." Itu hanya mungkin bila keduanya memanggil fungsi yang sama.
  const { laporanShift } = await import(MOD);
  const { posisiPenjualan } = await import('../../packages/domain/src/posisi-penjualan.ts');
  const db = dbSungguhan();
  isiSatuPenjualanTunai(db, 300000);
  catatMovement(db, {
    id: 'cm-1', tipe: 'sale', delta: 300000, orderId: 'ord-1', counterpart: 'sales_revenue',
  });
  refundPenuh(db, 120000, 'cash');

  const l = await laporanShift(db, SHIFT_ID);

  // Dibandingkan dengan hasil fungsi kanonik atas data yang sama — bukan
  // dengan angka yang ditulis ulang di test, yang hanya akan menguji bahwa
  // saya menyalin aritmetikanya dengan benar dua kali.
  const harusnya = posisiPenjualan({
    orders: [{ id: 'ord-1', status: 'closed', total: 300000, taxAmount: 0, voidedByOrderId: null }],
    refunds: [{ orderId: 'ord-1', amount: 120000 }],
  });
  assert.equal(l.penjualan.omzetKotor, harusnya.omzetKotor);
  assert.equal(l.penjualan.omzetBersih, harusnya.omzetBersih);
  assert.equal(l.penjualan.refundAmount, 120000n);
  assert.equal(l.penjualan.jumlahTransaksi, 1);
});

test('⛔ order yang dibatalkan tidak masuk omzet laporan shift', async () => {
  const { laporanShift } = await import(MOD);
  const db = dbSungguhan();
  isiSatuPenjualanTunai(db, 300000);
  // Order pembatal, seperti yang ditulis `pembatalan.ts`.
  db.sqlite.exec(`
    INSERT INTO "order"
      (id, tenant_id, outlet_id, device_id, shift_id, receipt_number, business_date, sequence,
       status, channel, subtotal, order_discount, service_charge_amount, tax_amount,
       rounding_adjustment, total, amount_due, voided_by_order_id, created_by, occurred_at, hlc)
    VALUES ('v1','${TENANT}','${OUTLET}','${DEVICE}','${SHIFT_ID}','K1-20260813-0002','2026-08-13',2,
            'voided','dine_in',300000,0,0,0,0,300000,300000,'ord-1','u-sari','2026-08-13T11:00:00Z',3)
  `);

  const l = await laporanShift(db, SHIFT_ID);
  assert.equal(l.penjualan.omzetKotor, 0n, 'penjualan yang dibatalkan masih terhitung');
  assert.equal(l.penjualan.voidAmount, 300000n);
  assert.equal(l.penjualan.jumlahTransaksi, 0);
});
