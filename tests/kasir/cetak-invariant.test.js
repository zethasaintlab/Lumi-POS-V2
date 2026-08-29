'use strict';

// ⛔ INVARIANT #3 — "Simpan sebelum cetak, SELALU. Cetak dan buka laci adalah
// efek samping yang BOLEH gagal. Struk bisa dicetak ulang; penjualan yang
// hilang tidak bisa dipulihkan."
//
// Ini separuh gate F4 yang dapat dibuktikan tanpa printer: `ARCH:398`
// menuntut "penjualan tetap tersimpan saat cetak gagal". Separuh lainnya
// ("cetak berhasil di ≥5 model") menuntut perangkat fisik dan TETAP TERBUKA.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../apps/kasir/src/kasir/penjualan.ts';
const PORT = '../../apps/kasir/src/cetak/port.ts';

const KONFIG = { tenantId: 't1', outletId: 'o1', deviceId: 'd1', deviceCode: 'K1' };
const SESI = { userId: 'u-sari' };
const SHIFT = { id: 's1', businessDate: '2026-08-13' };
const OUTLET = {
  name: 'LUMI KOPI',
  timezone: 'Asia/Jakarta',
  business_day_ends_at: '04:00',
  rounding_increment: 100,
  rounding_mode: 'half_up',
  service_charge_rate: 0,
};

const PROFIL = {
  id: 'p', nama: 'Generic 58mm', paperWidthMm: 58, charsPerLine: 32,
  codepage: 'cp437', hasCutter: false, initCommand: '1B 40', cutCommand: '',
  drawerCommand: '1B 70 00 19 FA', imageSupport: false,
};

function dbPalsu() {
  const state = { tulis: [], transaksi: 0, device_config: { receipt_sequence: 0, sequence_business_date: null } };
  const db = {
    state,
    async getAll(sql) {
      if (/FROM tax_rate/.test(sql)) return [];
      if (/FROM outlet/.test(sql)) return [OUTLET];
      if (/FROM device_config/.test(sql)) return [state.device_config];
      if (/FROM item_variation/.test(sql)) return [{ id: 'v1', track_stock: 1 }];
      return [];
    },
    async execute(sql, params = []) {
      state.tulis.push({ sql: sql.trim().split('\n')[0], params });
      if (/UPDATE device_config/.test(sql)) {
        state.device_config.receipt_sequence = params[0];
        state.device_config.sequence_business_date = params[1];
      }
      return { rowsAffected: 1 };
    },
    async transaction(fn) {
      state.transaksi += 1;
      return fn(db);
    },
  };
  return db;
}

const BARIS = [{
  id: 'b1', variationId: 'v1', itemName: 'Kopi Susu', variationName: 'Regular',
  unitPrice: 20000, quantityMilli: 1000, modifier: [],
}];

function args(over = {}) {
  return {
    konfig: KONFIG, sesi: SESI, shift: SHIFT,
    keranjang: { baris: BARIS, diskon: null },
    pembayaran: { metode: 'cash', tendered: 25000 },
    waktu: () => new Date('2026-08-13T07:00:00Z'),
    idBaru: (() => { let n = 0; return () => `id-${++n}`; })(),
    hlc: () => 42n,
    printerProfile: PROFIL,
    ...over,
  };
}

const tersimpan = (db) => db.state.tulis.some((t) => /INSERT INTO "order"/.test(t.sql));

// ---------------------------------------------------------------------------

test('⛔ printer yang MELEMPAR tidak menghilangkan penjualan', async () => {
  // Kertas habis, printer mati, USB dicabut — apa pun. Uangnya sudah masuk
  // laci; penjualan yang hilang di sini tidak dapat dipulihkan dari mana pun.
  const { simpanPenjualan } = await import(MOD);
  const db = dbPalsu();

  const hasil = await simpanPenjualan({
    db,
    ...args({
      peripheral: {
        async printReceipt() {
          throw new Error('kertas habis');
        },
        async openCashDrawer() {},
        async listDevices() { return []; },
        async testDevice() { return false; },
        onBarcodeScanned() { return () => {}; },
      },
    }),
  });

  assert.equal(hasil.status, 'tersimpan', 'penjualan ditolak karena printer gagal');
  assert.equal(tersimpan(db), true, 'order tidak tertulis');
  assert.equal(hasil.cetak.status, 'gagal');
  assert.match(hasil.cetak.pesan, /kertas habis/);
});

test('⛔ kegagalan cetak DILAPORKAN, tidak didiamkan', async () => {
  // Layar harus dapat berkata "struk gagal dicetak, transaksi tersimpan".
  // Diam berarti kasir mengira struk keluar; menuduh penjualannya gagal
  // berarti kasir menjual ulang barang yang sudah dibayar.
  const { simpanPenjualan } = await import(MOD);
  const db = dbPalsu();
  const hasil = await simpanPenjualan({
    db,
    ...args({
      peripheral: {
        async printReceipt() { throw new Error('printer tidak ditemukan'); },
        async openCashDrawer() {},
        async listDevices() { return []; },
        async testDevice() { return false; },
        onBarcodeScanned() { return () => {}; },
      },
    }),
  });
  assert.equal(hasil.cetak.status, 'gagal');
  assert.ok(hasil.cetak.pesan.length > 0, 'pesan kegagalan kosong');
});

test('⛔ cetak terjadi SETELAH order tertulis, bukan sebelum', async () => {
  // Urutannya yang menjadikan invariant #3 nyata. Printer yang dipanggil
  // lebih dulu lalu melempar akan menghentikan eksekusi sebelum satu baris
  // pun tersimpan.
  const { simpanPenjualan } = await import(MOD);
  const db = dbPalsu();
  let orderSudahAda = null;

  await simpanPenjualan({
    db,
    ...args({
      peripheral: {
        async printReceipt() {
          orderSudahAda = tersimpan(db);
        },
        async openCashDrawer() {},
        async listDevices() { return []; },
        async testDevice() { return false; },
        onBarcodeScanned() { return () => {}; },
      },
    }),
  });

  assert.equal(orderSudahAda, true, 'printer dipanggil sebelum order tersimpan');
});

test('perangkat TANPA printer: penjualan normal, status tanpa_printer', async () => {
  // Merchant yang menjual lewat QRIS tanpa printer adalah kasus nyata.
  // `tanpa_printer` berbeda dari `gagal` — tidak ada yang salah.
  const { simpanPenjualan } = await import(MOD);
  const db = dbPalsu();
  const hasil = await simpanPenjualan({ db, ...args({ peripheral: null }) });

  assert.equal(hasil.status, 'tersimpan');
  assert.equal(hasil.cetak.status, 'tanpa_printer');
});

test('printer ada tapi PROFIL belum dipilih: tanpa_printer, bukan gagal', async () => {
  const { simpanPenjualan } = await import(MOD);
  const db = dbPalsu();
  const hasil = await simpanPenjualan({
    db,
    ...args({
      printerProfile: null,
      peripheral: {
        async printReceipt() { throw new Error('tidak boleh dipanggil'); },
        async openCashDrawer() {},
        async listDevices() { return []; },
        async testDevice() { return false; },
        onBarcodeScanned() { return () => {}; },
      },
    }),
  });
  assert.equal(hasil.cetak.status, 'tanpa_printer');
});

test('jalur bahagia: struk tercetak, dan byte-nya memuat nomor struk', async () => {
  const { simpanPenjualan } = await import(MOD);
  const db = dbPalsu();
  let diterima = null;

  const hasil = await simpanPenjualan({
    db,
    ...args({
      peripheral: {
        async printReceipt(bytes) { diterima = bytes; },
        async openCashDrawer() {},
        async listDevices() { return []; },
        async testDevice() { return false; },
        onBarcodeScanned() { return () => {}; },
      },
    }),
  });

  assert.equal(hasil.cetak.status, 'tercetak');
  assert.ok(diterima instanceof Uint8Array);
  const teks = Buffer.from(diterima).toString('latin1');
  assert.ok(teks.includes(hasil.receiptNumber), 'nomor struk tidak ada di byte');
  assert.ok(teks.includes('LUMI KOPI'), 'nama outlet tidak ada di byte');
  assert.ok(teks.includes('Kopi Susu'), 'nama produk tidak ada di byte');
});

// --- port: `cetakStruk` sendiri ---

test('⛔ cetakStruk tidak pernah melempar, apa pun yang port lakukan', async () => {
  const { cetakStruk } = await import(PORT);
  for (const lempar of [new Error('x'), 'string mentah', null, undefined]) {
    const hasil = await cetakStruk(
      {
        async printReceipt() { throw lempar; },
        async openCashDrawer() {},
        async listDevices() { return []; },
        async testDevice() { return false; },
        onBarcodeScanned() { return () => {}; },
      },
      { baris: [] },
      PROFIL
    );
    assert.equal(hasil.status, 'gagal', `lemparan ${String(lempar)} tidak jadi hasil`);
  }
});

test('noopPeripheral berjalan penuh tanpa melempar', async () => {
  const { noopPeripheral, cetakStruk, bukaLaci } = await import(PORT);
  const p = noopPeripheral();
  assert.equal((await cetakStruk(p, { baris: [] }, PROFIL)).status, 'tercetak');
  assert.equal((await bukaLaci(p, PROFIL)).status, 'tercetak');
  assert.deepEqual(await p.listDevices(), []);
  assert.equal(await p.testDevice('x'), false);
  assert.equal(typeof p.onBarcodeScanned(() => {}), 'function');
});

test('⛔ buka laci memakai perintah PROFIL dan tidak pernah melempar', async () => {
  const { bukaLaci } = await import(PORT);
  let bytes = null;
  const hasil = await bukaLaci(
    {
      async printReceipt() {},
      async openCashDrawer(b) { bytes = b; },
      async listDevices() { return []; },
      async testDevice() { return false; },
      onBarcodeScanned() { return () => {}; },
    },
    PROFIL
  );
  assert.equal(hasil.status, 'tercetak');
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ');
  assert.ok(hex.includes('1b 70 00 19 fa'), `perintah laci tidak ada: ${hex}`);

  const gagal = await bukaLaci(
    {
      async printReceipt() {},
      async openCashDrawer() { throw new Error('laci macet'); },
      async listDevices() { return []; },
      async testDevice() { return false; },
      onBarcodeScanned() { return () => {}; },
    },
    PROFIL
  );
  assert.equal(gagal.status, 'gagal');
});
