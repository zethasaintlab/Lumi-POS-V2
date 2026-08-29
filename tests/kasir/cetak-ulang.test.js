'use strict';

// FR-B11 — cetak ulang struk, di atas SQLite sungguhan.
//
// AC yang diuji di sini adalah `spec-b:145` ("cetak ulang struk tidak
// melakukan query ke tabel katalog") dan skenario `spec-b:131`: produk yang
// di-rename, dinaikkan harganya, lalu diarsipkan tetap tercetak dengan nama
// dan harga SAAT TRANSAKSI TERJADI.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const MOD = '../../apps/kasir/src/cetak/ulang.ts';
const ESCPOS = '../../apps/kasir/src/cetak/escpos.ts';
const SKEMA = join(__dirname, '..', '..', 'db', 'local', '001-initial.sql');

const ESC = String.fromCharCode(0x1b);
const GS = String.fromCharCode(0x1d);
const bersih = (bytes) =>
  Buffer.from(bytes)
    .toString('latin1')
    .replace(new RegExp(ESC + 'p[^]{3}', 'g'), '')
    .replace(new RegExp(ESC + '@', 'g'), '')
    .replace(new RegExp(ESC + '[aE][^]', 'g'), '')
    .replace(new RegExp(GS + 'V[^]', 'g'), '');

const PROFIL = {
  id: 'p', nama: 'x', paperWidthMm: 58, charsPerLine: 32, codepage: 'cp437',
  hasCutter: false, initCommand: '1B 40', cutCommand: '',
  drawerCommand: '1B 70 00 19 FA', imageSupport: false,
};

/** Mencatat tabel mana saja yang benar-benar disentuh. */
function dbSungguhan() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(SKEMA, 'utf8'));
  const tabelDisentuh = new Set();
  const db = {
    sqlite,
    tabelDisentuh,
    async getAll(sql, params = []) {
      for (const m of sql.matchAll(/(?:FROM|JOIN)\s+"?(\w+)"?/gi)) tabelDisentuh.add(m[1]);
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

function isiOrder(db) {
  const s = db.sqlite;
  s.exec(`
    INSERT INTO "order"
      (id, tenant_id, outlet_id, device_id, shift_id, receipt_number, business_date, sequence,
       status, channel, subtotal, order_discount, service_charge_amount, tax_amount,
       rounding_adjustment, total, amount_due, created_by, occurred_at, hlc)
    VALUES ('ord-1','t1','o1','d1','s1','K1-20260726-0007','2026-07-26',7,
            'closed','takeaway',50000,0,0,5000,0,55000,55000,'Sari','26 Jul 2026  14:32',1)
  `);
  s.exec(`INSERT INTO "check" (id, order_id, subtotal, total) VALUES ('chk','ord-1',50000,55000)`);
  s.exec(`
    INSERT INTO order_line
      (id, order_id, check_id, variation_id, item_name, variation_name, unit_price, quantity, line_total)
    VALUES ('ln-1','ord-1','chk','v1','Kopi Susu','Regular',25000,2000,50000)
  `);
  s.exec(`
    INSERT INTO order_line_modifier (id, order_line_id, modifier_id, name, price, quantity)
    VALUES ('m-1','ln-1','mod-1','Extra Shot',5000,1000)
  `);
  s.exec(`
    INSERT INTO payment (id, order_id, check_id, method, amount, tendered_amount, change_amount, status, tendered_at)
    VALUES ('pay-1','ord-1','chk','cash',55000,60000,5000,'confirmed','2026-07-26T14:32:00Z')
  `);
}

async function cetak(db) {
  const { bangunUlangStruk } = await import(MOD);
  const { renderEscPos } = await import(ESCPOS);
  const dok = await bangunUlangStruk(db, 'ord-1', { namaMerchant: 'LUMI KOPI' });
  return dok === null ? null : bersih(renderEscPos(dok, PROFIL));
}

// ---------------------------------------------------------------------------

test('⛔ cetak ulang TIDAK menyentuh satu pun tabel katalog (spec-b:145)', async () => {
  // Janji ini mudah dilanggar satu JOIN kemudian — misalnya untuk mengambil
  // nama tarif pajak. Karena itu yang diperiksa adalah daftar tabel yang
  // benar-benar disentuh, bukan pembacaan kode.
  const db = dbSungguhan();
  isiOrder(db);
  await cetak(db);

  const katalog = ['item', 'item_variation', 'category', 'modifier', 'modifier_list', 'tax_rate', 'price_history'];
  for (const t of katalog) {
    assert.equal(
      db.tabelDisentuh.has(t),
      false,
      `cetak ulang menyentuh tabel katalog ${t}: ${[...db.tabelDisentuh].join(', ')}`
    );
  }
});

test('⛔ skenario spec-b:131 — nama dan harga SAAT TRANSAKSI, bukan saat ini', async () => {
  // Produk di-rename, dinaikkan harganya, lalu diarsipkan setelah transaksi.
  // Struk lama harus tetap berbunyi "Kopi Susu" seharga yang dulu.
  const db = dbSungguhan();
  isiOrder(db);
  db.sqlite.exec(`
    INSERT INTO item (id, tenant_id, name, archived_at)
    VALUES ('i1','t1','Kopi Susu Gula Aren','2026-08-10T00:00:00Z')
  `);
  db.sqlite.exec(`
    INSERT INTO item_variation (id, item_id, name, price, track_stock)
    VALUES ('v1','i1','Regular',28000,1)
  `);

  const out = await cetak(db);
  assert.ok(out.includes('Kopi Susu'), 'nama saat transaksi hilang');
  assert.equal(out.includes('Gula Aren'), false, 'nama BARU ikut tercetak');
  assert.ok(out.includes('50.000'), 'harga saat transaksi hilang');
  assert.equal(out.includes('28.000'), false, 'harga BARU ikut tercetak');
});

test('⛔ ditandai CETAK ULANG', async () => {
  const db = dbSungguhan();
  isiOrder(db);
  const out = await cetak(db);
  assert.ok(out.includes('** CETAK ULANG **'));
});

test('cetakan pertama TIDAK ditandai — penandanya opsional', async () => {
  const { bangunUlangStruk } = await import(MOD);
  const { renderEscPos } = await import(ESCPOS);
  const db = dbSungguhan();
  isiOrder(db);
  const dok = await bangunUlangStruk(db, 'ord-1', { namaMerchant: 'LUMI KOPI', cetakUlang: false });
  assert.equal(bersih(renderEscPos(dok, PROFIL)).includes('CETAK ULANG'), false);
});

test('modifier dan pembayaran ikut terbangun ulang', async () => {
  const db = dbSungguhan();
  isiOrder(db);
  const out = await cetak(db);
  assert.ok(out.includes('Extra Shot'), 'modifier hilang');
  assert.ok(out.includes('Tunai'), 'metode pembayaran hilang');
  assert.ok(out.includes('Kembali'), 'kembalian hilang');
});

test('order yang TIDAK ADA menjawab null, bukan melempar', async () => {
  // Riwayat lokal hanya memuat jendela 90 hari; order yang lebih tua bukan
  // kesalahan, dan layar riwayat tidak boleh jatuh karenanya.
  const { bangunUlangStruk } = await import(MOD);
  const db = dbSungguhan();
  assert.equal(await bangunUlangStruk(db, 'tidak-ada', { namaMerchant: 'X' }), null);
});

test('⛔ cetakUlangStruk tidak pernah melempar (invariant #3)', async () => {
  const { cetakUlangStruk } = await import(MOD);
  const db = dbSungguhan();
  isiOrder(db);

  const hasil = await cetakUlangStruk(db, 'ord-1', {
    namaMerchant: 'LUMI KOPI',
    profil: PROFIL,
    peripheral: {
      async printReceipt() { throw new Error('kertas habis'); },
      async openCashDrawer() {},
      async listDevices() { return []; },
      async testDevice() { return false; },
      onBarcodeScanned() { return () => {}; },
    },
  });
  assert.equal(hasil.status, 'gagal');
  assert.match(hasil.pesan, /kertas habis/);
});

test('cetak ulang order yang tidak ada dilaporkan, bukan didiamkan', async () => {
  const { cetakUlangStruk } = await import(MOD);
  const db = dbSungguhan();
  const hasil = await cetakUlangStruk(db, 'hilang', {
    namaMerchant: 'X', profil: PROFIL, peripheral: null,
  });
  assert.equal(hasil.status, 'tidak_ditemukan');
});

test('⛔ dua kali cetak ulang menghasilkan byte IDENTIK', async () => {
  // Struk yang berubah antar cetakan tidak dapat dipakai membuktikan apa pun.
  const db = dbSungguhan();
  isiOrder(db);
  assert.equal(await cetak(db), await cetak(db));
});

// --- F5: nama tarif dari SNAPSHOT, bukan dari tabel katalog ---

function isiPajakBernama(db, nama) {
  db.sqlite.exec(`
    UPDATE order_line SET tax_rate_id = 'tr-1', tax_amount = 5000, tax_rate_name = '${nama}'
     WHERE order_id = 'ord-1'
  `);
}

test('⛔ cetak ulang memakai NAMA tarif tersimpan, bukan "Pajak" generik', async () => {
  // Keputusan user 15 Agustus 2026: denormalisasi di F5. Larangan
  // `spec-b:145` TIDAK dilonggarkan — yang berubah adalah apa yang tersimpan
  // sebagai snapshot.
  const db = dbSungguhan();
  isiOrder(db);
  isiPajakBernama(db, 'PBJT 10%');

  const out = await cetak(db);
  assert.ok(out.includes('PBJT 10%'), `nama tarif hilang:${String.fromCharCode(10)}${out}`);
  assert.equal(/^Pajak\s/m.test(out), false, 'masih memakai label generik');
});

test('⛔ dan ia tetap TIDAK menyentuh tabel katalog', async () => {
  // Perbaikan ini mudah dilakukan dengan cara yang salah: satu JOIN ke
  // `tax_rate` menghasilkan hasil yang sama di test ini, dan melanggar
  // `spec-b:145` diam-diam.
  const db = dbSungguhan();
  isiOrder(db);
  isiPajakBernama(db, 'PBJT 10%');
  await cetak(db);

  assert.equal(db.tabelDisentuh.has('tax_rate'), false, 'cetak ulang menyentuh tax_rate');
});

test('baris LAMA tanpa nama tarif jatuh ke "Pajak", bukan mengarang', async () => {
  // Transaksi yang ditulis sebelum F5 tidak punya namanya dan tidak dapat
  // direkonstruksi tanpa menebak.
  const db = dbSungguhan();
  isiOrder(db);
  db.sqlite.exec(`
    UPDATE order_line SET tax_rate_id = 'tr-1', tax_amount = 5000, tax_rate_name = NULL
     WHERE order_id = 'ord-1'
  `);

  const out = await cetak(db);
  assert.ok(/^Pajak\s/m.test(out), 'baris pajak hilang seluruhnya');
});

test('⛔ dua tarif berbeda menghasilkan DUA baris, digabung per tarif', async () => {
  const db = dbSungguhan();
  isiOrder(db);
  db.sqlite.exec(`
    INSERT INTO order_line
      (id, order_id, check_id, variation_id, item_name, variation_name, unit_price,
       quantity, line_total, tax_rate_id, tax_amount, tax_rate_name)
    VALUES ('ln-2','ord-1','chk','v2','Roti','Cokelat',30000,1000,30000,'tr-2',3000,'PPN 11%')
  `);
  db.sqlite.exec(`
    UPDATE order_line SET tax_rate_id = 'tr-1', tax_amount = 5000, tax_rate_name = 'PBJT 10%'
     WHERE id = 'ln-1'
  `);

  const out = await cetak(db);
  assert.ok(out.includes('PBJT 10%'));
  assert.ok(out.includes('PPN 11%'));
});

// ---------------------------------------------------------------------------
// FR-A3 — kuantitas modifier pada cetak ulang
// ---------------------------------------------------------------------------

test('⛔ cetak ulang menyebut kuantitas modifier dan MENGALIKAN harganya', async () => {
  const db = dbSungguhan();
  isiOrder(db);
  db.sqlite.exec(
    `UPDATE order_line_modifier SET quantity = 2000 WHERE id = 'm-1'`
  );

  const out = await cetak(db);
  // `spec-b:145` menuntut cetak ulang IDENTIK dengan cetakan pertama. Yang
  // melewatkan kuantitas mencetak "Extra Shot" seharga satu shot pada struk
  // yang totalnya memuat dua — dan selisihnya hanya muncul pada cetakan kedua.
  // `×` ditransliterasi jadi `x` oleh renderer SEBELUM lebar dihitung —
  // aturan yang sama dengan `…`, dan alasan struk ini tetap muat 32 kolom.
  assert.match(out, /Extra Shot 2x/, `kuantitas modifier hilang: ${out}`);
  assert.match(out, /10\.000/, 'harga modifier tidak dikalikan kuantitasnya');
});

test('⛔ cetak ulang mencetak DISKON, bukan nol', async () => {
  const db = dbSungguhan();
  isiOrder(db);
  db.sqlite.exec(`UPDATE "order" SET order_discount = 5000 WHERE id = 'ord-1'`);

  const out = await cetak(db);
  // `order.subtotal` adalah subtotal KOTOR — cetak ulang yang menulis nol
  // menyodorkan dua angka yang selisihnya tidak dapat dijelaskan.
  assert.match(out, /Diskon/, `baris diskon hilang: ${out}`);
});
