'use strict';

// K-06/K-07 — menyimpan penjualan di perangkat.
//
// ⛔ Ini pertama kalinya invariant #1 berlaku di KLIEN dengan uang sungguhan:
// order + check + line + modifier + payment + DUA item outbox, semuanya dalam
// satu `writeTransaction`. Yang tersimpan setengah adalah penjualan yang
// uangnya sudah masuk laci tapi tidak ada di mana pun.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../apps/kasir/src/kasir/penjualan.ts';

const OUTLET = {
  id: 'o1', tenant_id: 't1', name: 'Outlet Pusat',
  timezone: 'Asia/Jakarta', business_day_ends_at: '04:00:00',
  rounding_increment: 100, rounding_mode: 'half_up', service_charge_rate: 0,
};

const KONFIG = {
  deviceId: 'd1', deviceCode: 'K1', tenantId: 't1', outletId: 'o1',
  baseUrl: 'http://server', tokenSecret: 'rahasia',
};

const SESI = { userId: 'u-sari', nama: 'Sari', peran: ['cashier'], masukPada: '', wajibGantiPin: false };
const SHIFT = { id: 's1', businessDate: '2026-08-11', openingFloat: 200000 };

// PB1 10% EKSKLUSIF — menambah total.
const TARIF = [{
  id: 'tr1', tenant_id: 't1', outlet_id: 'o1', name: 'PB1', type: 'pbjt',
  rate: 1000, is_inclusive: 0, phase: 'subtotal', channel: 'all',
  applies_to: 'all_items', applies_to_ids: null,
  effective_from: '2026-01-01T00:00:00Z', effective_to: null,
}];

function dbPalsu({ tarif = TARIF, urutan = 0, tanggalUrutan = null, lacakStok = { v1: 1 } } = {}) {
  const state = {
    tulis: [], transaksi: 0, diDalamTransaksi: false,
    device_config: { receipt_sequence: urutan, sequence_business_date: tanggalUrutan },
  };
  const db = {
    state,
    async getAll(sql) {
      if (/FROM tax_rate/.test(sql)) return tarif;
      if (/FROM outlet/.test(sql)) return [OUTLET];
      if (/FROM device_config/.test(sql)) return [state.device_config];
      // FR-E2: `sale` hanya untuk variation ber-`track_stock = true`. Nilainya
      // dibaca dari katalog SAAT MENULIS, bukan dari keranjang — keranjang
      // hidup di memori dan dapat basi terhadap katalog yang baru turun.
      if (/FROM item_variation/.test(sql)) {
        return Object.entries(lacakStok).map(([id, t]) => ({ id, track_stock: t }));
      }
      return [];
    },
    async execute(sql, params = []) {
      // `dalam` DIREKAM per penulisan, bukan hanya dihitung sekali. Tanpa
      // ini, `simpanHlc` yang dipindah ke luar transaksi tetap terlihat
      // "ditulis" dan test hijau untuk kode yang melanggar I10.
      state.tulis.push({ sql: sql.trim().split('\n')[0], params, dalam: state.diDalamTransaksi });
      if (/UPDATE device_config/.test(sql)) {
        state.device_config.receipt_sequence = params[0];
        state.device_config.sequence_business_date = params[1];
      }
      return { rowsAffected: 1 };
    },
    async transaction(fn) {
      state.transaksi += 1;
      state.diDalamTransaksi = true;
      try {
        return await fn(db);
      } finally {
        state.diDalamTransaksi = false;
      }
    },
  };
  return db;
}

const BARIS = [{
  id: 'b1', variationId: 'v1', itemName: 'Kopi Susu', variationName: 'Regular',
  unitPrice: 20000, quantityMilli: 1000, modifier: [],
}];

const JAM = () => new Date('2026-08-11T07:00:00Z');
const ID = (() => { let n = 0; return () => `id-${++n}`; })();

function args(over = {}) {
  return {
    konfig: KONFIG, sesi: SESI, shift: SHIFT,
    keranjang: { baris: BARIS, diskon: null },
    pembayaran: { metode: 'cash', tendered: 25000 },
    waktu: JAM, idBaru: ID, hlc: () => 42n,
    ...over,
  };
}

// ---------------------------------------------------------------------------

test('⛔ SATU transaksi untuk seluruh penjualan (invariant #1)', async () => {
  const { simpanPenjualan } = await import(MOD);
  const db = dbPalsu();

  const hasil = await simpanPenjualan({ db, ...args() });
  assert.equal(hasil.status, 'tersimpan', hasil.status);
  assert.equal(db.state.transaksi, 1, 'seluruhnya HARUS satu writeTransaction');

  const tabel = db.state.tulis.map((t) => t.sql);
  for (const wajib of ['"order"', '"check"', 'order_line', 'payment', 'outbox_local']) {
    assert.ok(tabel.some((s) => s.includes(wajib)), `tidak ada penulisan ke ${wajib}`);
  }

  // ⛔ SETIAP penulisan harus di dalam transaksi itu — termasuk `hlc_state`.
  // Yang di luar adalah jendela tempat perangkat bisa mati dan meninggalkan
  // keadaan yang tidak konsisten dengan order yang sudah ter-commit.
  for (const t of db.state.tulis) {
    assert.equal(t.dalam, true, `penulisan di LUAR transaksi: ${t.sql}`);
  }
  assert.ok(tabel.some((s) => /hlc_teks/.test(s)), 'keadaan HLC harus ikut disimpan (I10)');
});

test('pajak EKSKLUSIF menambah total; order.tax_amount = seluruh pajak', async () => {
  const { simpanPenjualan } = await import(MOD);
  const hasil = await simpanPenjualan({ db: dbPalsu(), ...args() });

  // 20.000 + 10% = 22.000
  assert.equal(hasil.total, 22000n);
  assert.equal(hasil.taxAmount, 2000n);
});

test('⛔ pajak INKLUSIF tidak menambah total, tapi tetap tercatat', async () => {
  const { simpanPenjualan } = await import(MOD);

  // `CLAUDE.md`: "order.tax_amount = totalTax (seluruh pajak, untuk struk);
  // yang MENAMBAH total hanya totalTaxExclusive. Menukar keduanya
  // menggandakan pajak inklusif."
  const inklusif = [{ ...TARIF[0], is_inclusive: 1 }];
  const hasil = await simpanPenjualan({ db: dbPalsu({ tarif: inklusif }), ...args() });

  assert.equal(hasil.total, 20000n, 'harga sudah termasuk pajak');
  assert.ok(hasil.taxAmount > 0n, 'pajaknya tetap tercatat untuk struk');
});

test('⛔ pembulatan HANYA pada amount_due tunai, bukan pada total', async () => {
  const { simpanPenjualan } = await import(MOD);

  // FR-C9. `CLAUDE.md`: "total tidak pernah dibulatkan. Yang dibulatkan
  // amount_due, dan hanya saat ada pembayaran tunai."
  const baris = [{ ...BARIS[0], unitPrice: 20050 }];
  const hasil = await simpanPenjualan({
    db: dbPalsu(),
    ...args({ keranjang: { baris, diskon: null }, pembayaran: { metode: 'cash', tendered: 25000 } }),
  });

  // 20.050 + 10% = 22.055 -> dibulatkan ke 22.100 (increment 100, half_up)
  assert.equal(hasil.total, 22055n, 'total TIDAK dibulatkan');
  assert.equal(hasil.amountDue, 22100n);
  assert.equal(hasil.roundingAdjustment, 45n);
});

test('kembalian dihitung dari amount_due yang SUDAH dibulatkan', async () => {
  const { simpanPenjualan } = await import(MOD);
  const baris = [{ ...BARIS[0], unitPrice: 20050 }];
  const hasil = await simpanPenjualan({
    db: dbPalsu(),
    ...args({ keranjang: { baris, diskon: null }, pembayaran: { metode: 'cash', tendered: 25000 } }),
  });

  // 25.000 - 22.100 = 2.900. Menghitungnya dari `total` yang tidak dibulatkan
  // memberi kembalian 45 rupiah lebih banyak, setiap transaksi.
  assert.equal(hasil.kembalian, 2900n);
});

test('uang tunai kurang DITOLAK, dan tidak menulis apa pun', async () => {
  const { simpanPenjualan } = await import(MOD);
  const db = dbPalsu();

  const hasil = await simpanPenjualan({
    db, ...args({ pembayaran: { metode: 'cash', tendered: 10000 } }),
  });
  assert.equal(hasil.status, 'kurang_bayar');
  assert.equal(db.state.tulis.length, 0, 'tidak boleh ada penulisan sebagian');
});

test('⛔ nomor struk: counter LOKAL, dan reset per tanggal bisnis', async () => {
  const { simpanPenjualan } = await import(MOD);

  // `CLAUDE.md`: "Counter LOKAL, tidak pernah minta ke server."
  const db = dbPalsu({ urutan: 6, tanggalUrutan: '2026-08-11' });
  const hasil = await simpanPenjualan({ db, ...args() });
  assert.equal(hasil.receiptNumber, 'K1-20260811-0007');
  assert.equal(hasil.sequence, 7);

  // Tanggal bisnis BARU memulai urutan dari 1 lagi. Tanpa reset, nomor struk
  // tumbuh selamanya dan tidak lagi berarti "penjualan ke-N hari ini".
  const dbBaru = dbPalsu({ urutan: 40, tanggalUrutan: '2026-08-10' });
  const besok = await simpanPenjualan({ db: dbBaru, ...args() });
  assert.equal(besok.sequence, 1);
  assert.equal(besok.receiptNumber, 'K1-20260811-0001');
});

test('DUA item outbox: order lalu payment, payment BERGANTUNG pada order', async () => {
  const { simpanPenjualan } = await import(MOD);
  const db = dbPalsu();
  await simpanPenjualan({ db, ...args() });

  const outbox = db.state.tulis.filter((t) => /outbox_local/.test(t.sql));
  assert.equal(outbox.length, 2);

  const [order, payment] = outbox.map((t) => t.params);
  assert.equal(order[1], 'order');
  assert.equal(payment[1], 'payment');
  // `depends_on` menunjuk item outbox order. Tanpa itu, payment dapat terkirim
  // lebih dulu ke order yang belum ada di server -- 404, lalu gagal permanen
  // untuk penjualan yang sempurna.
  //
  // Indeks 7 mengikuti urutan bind `enqueue` (id, entityType, entityId,
  // operation, payload, idempotencyKey, createdAt, dependsOn, actorId) --
  // BUKAN urutan kolom di SQL, yang berbeda karena beberapa kolom diisi
  // literal.
  assert.equal(payment[7], order[0], 'payment harus depends_on item order');
  assert.equal(order[7], null, 'order tidak bergantung pada apa pun');
});

test('payload order cocok dengan kontrak POST /orders', async () => {
  const { simpanPenjualan } = await import(MOD);
  const db = dbPalsu();
  await simpanPenjualan({ db, ...args() });

  const item = db.state.tulis.find((t) => /outbox_local/.test(t.sql));
  const payload = JSON.parse(item.params[4]);
  for (const k of ['id', 'outletId', 'deviceId', 'shiftId', 'receiptNumber', 'businessDate', 'sequence', 'channel', 'checkId', 'lines']) {
    assert.ok(k in payload, `payload kehilangan ${k}`);
  }
  assert.match(payload.receiptNumber, /^[A-Za-z0-9]+-\d{8}-\d+$/);
  assert.equal(payload.lines[0].variationId, 'v1');
  assert.equal(payload.lines[0].quantityMilli, 1000);
  // FR-H6: harga dan total yang DIPAKAI KLIEN ikut, supaya server dapat
  // membedakan klien yang belum tersinkron dari selisih tak terjelaskan.
  assert.equal(payload.lines[0].unitPrice, 20000);
  // NUMBER, bukan string: `assertClientTotalValid` di server menuntut
  // `Number.isInteger`. Versi pertama test ini mengharapkan string dan
  // MENGUNCI bug — ketahuan hanya saat menembak server sungguhan.
  assert.equal(payload.total, 22000);
  assert.equal(typeof payload.total, 'number');
  // `hlc` sebaliknya TETAP string: ia 57-bit dan tidak muat di double.
  assert.equal(typeof payload.hlc, 'string');
  assert.equal(payload.hlc, '42');
});

test('keranjang kosong ditolak', async () => {
  const { simpanPenjualan } = await import(MOD);
  const db = dbPalsu();
  const hasil = await simpanPenjualan({ db, ...args({ keranjang: { baris: [], diskon: null } }) });
  assert.equal(hasil.status, 'keranjang_kosong');
  assert.equal(db.state.tulis.length, 0);
});

test('modifier ikut ke baris DAN ke harga', async () => {
  const { simpanPenjualan } = await import(MOD);
  const db = dbPalsu();
  const baris = [{
    ...BARIS[0],
    modifier: [{ id: 'm3', nama: 'Ekstra', harga: 3000, bawaan: false }],
  }];
  const hasil = await simpanPenjualan({
    db,
    ...args({ keranjang: { baris, diskon: null }, pembayaran: { metode: 'cash', tendered: 30000 } }),
  });

  // (20.000 + 3.000) + 10% = 25.300 — melebihi Rp 25.000, jadi uang yang
  // diserahkan dinaikkan. Versi pertama test ini justru tertangkap guard
  // `kurang_bayar`, yang berarti guard itu bekerja.
  assert.equal(hasil.total, 25300n);
  const tulisModifier = db.state.tulis.filter((t) => /order_line_modifier/.test(t.sql));
  assert.equal(tulisModifier.length, 1);
  assert.equal(tulisModifier[0].params[3], 'Ekstra');
});

// --- FR-E3: stock cutting otomatis ---

function movement(db) {
  return db.state.tulis.filter((t) => /INSERT INTO stock_movement/.test(t.sql));
}

test('⛔ penjualan MENGURANGI stok, di transaksi yang sama (FR-E3)', async () => {
  // Sampai sekarang tidak ada satu pun movement `sale` ditulis — di klien
  // maupun server. Stok karena itu hanya pernah NAIK: void dan refund
  // mengembalikan barang yang tidak pernah dikurangi. Kafe yang menjual 200
  // kopi sehari melihat stoknya tetap, lalu naik setiap kali ada pembatalan.
  //
  // `CLAUDE.md` invariant #1 menyebut stock movement sebagai bagian dari satu
  // transaksi penjualan, dan `spec-e:112`: "kegagalan menulis movement
  // me-rollback seluruh penjualan".
  const { simpanPenjualan } = await import(MOD);
  const db = dbPalsu();
  await simpanPenjualan({ db, ...args() });

  const m = movement(db);
  assert.equal(m.length, 1, 'penjualan tidak menulis stock_movement sama sekali');
  assert.equal(m[0].dalam, true, 'movement ditulis DI LUAR transaksi penjualan');
  // Kuantitas ×1000 (konvensi), dan NEGATIF: barang keluar dari rak.
  assert.ok(
    m[0].params.includes(-1000),
    `delta harus −1000 (1 unit keluar), dapat ${JSON.stringify(m[0].params)}`
  );
  assert.ok(m[0].params.includes('v1'), 'movement tidak menunjuk variation yang terjual');
});

test('⛔ variation dengan track_stock = false TIDAK menghasilkan movement (FR-E2)', async () => {
  // `spec-e:88`: "Produk jasa atau produk yang stoknya tidak dilacak tidak
  // menghasilkan movement." Menulisnya tetap membuat stok produk jasa turun
  // selamanya, dan laporan stok penuh baris yang tidak berarti apa pun.
  const { simpanPenjualan } = await import(MOD);
  const db = dbPalsu({ lacakStok: { v1: 0 } });
  await simpanPenjualan({ db, ...args() });

  assert.equal(movement(db).length, 0, 'produk yang stoknya tidak dilacak ikut menulis movement');
});

test('⛔ modifier TIDAK menghasilkan movement di v1 (FR-E3)', async () => {
  // KEP-04: modifier tidak punya SKU dan tidak dilacak stoknya. Deplesi bahan
  // lewat resep/BOM adalah v1.2.
  const { simpanPenjualan } = await import(MOD);
  const db = dbPalsu();
  await simpanPenjualan({
    db,
    ...args({
      keranjang: {
        diskon: null,
        baris: [{
          id: 'b1', variationId: 'v1', itemName: 'Kopi Susu', variationName: 'Regular',
          unitPrice: 20000, quantityMilli: 1000,
          modifier: [{ id: 'm1', nama: 'Extra shot', harga: 5000 }],
        }],
      },
      // Cukup untuk menutupi baris + modifier + pajak. Versi pertama test ini
      // memakai `tendered` bawaan dan penjualannya ditolak `kurang_bayar` —
      // nol movement, tapi karena TIDAK ADA yang ditulis sama sekali.
      pembayaran: { metode: 'cash', tendered: 100000 },
    }),
  });

  const hasil = movement(db);
  assert.equal(hasil.length, 1, 'modifier ikut menghasilkan movement');
});

test('jumlah movement = jumlah baris yang dilacak stoknya (FR-E3)', async () => {
  const { simpanPenjualan } = await import(MOD);
  const db = dbPalsu({ lacakStok: { v1: 1, v2: 1, v3: 0 } });
  await simpanPenjualan({
    db,
    ...args({
      keranjang: {
        diskon: null,
        baris: [
          { id: 'b1', variationId: 'v1', itemName: 'Kopi', variationName: 'R', unitPrice: 10000, quantityMilli: 2000, modifier: [] },
          { id: 'b2', variationId: 'v2', itemName: 'Roti', variationName: 'C', unitPrice: 10000, quantityMilli: 1000, modifier: [] },
          { id: 'b3', variationId: 'v3', itemName: 'Jasa', variationName: '-', unitPrice: 10000, quantityMilli: 1000, modifier: [] },
        ],
      },
      pembayaran: { metode: 'cash', tendered: 100000 },
    }),
  });

  const m = movement(db);
  assert.equal(m.length, 2, 'jumlah movement tidak sama dengan baris yang dilacak');
  assert.ok(m[0].params.includes(-2000), 'kuantitas 2 unit harus jadi delta −2000');
});

// ---------------------------------------------------------------------------
// FR-B8 — diskon tingkat order di perangkat
// ---------------------------------------------------------------------------
//
// ⛔ Sebelum ini `order_discount` selalu nol di KEDUA sisi. Server sudah
// menerimanya sejak `fc6fde5`; yang di sini adalah separuh yang membuat kasir
// benar-benar dapat memberikannya — dan yang harus menghitung angka yang SAMA,
// karena struk dicetak dari hitungan perangkat.

const DISKON_KECIL = {
  minta: { tipe: 'persen', nilai: 500n }, // 5%
  alasanKode: 'promo_berjalan',
  alasanCatatan: null,
  approverId: null,
  nominalDisetujui: null,
};

/** 30% atas subtotal 20.000 = 6.000, disetujui pada angka itu. */
const DISKON_DISETUJUI = {
  ...DISKON_KECIL,
  minta: { tipe: 'persen', nilai: 3000n },
  approverId: 'u-budi',
  nominalDisetujui: 6000n,
};

function nilaiKolom(db, cocok, indeks) {
  const baris = db.state.tulis.find((t) => cocok.test(t.sql));
  return baris ? baris.params[indeks] : undefined;
}

test('diskon di bawah ambang: tersimpan dan MENGURANGI total', async () => {
  const { simpanPenjualan } = await import(MOD);
  const db = dbPalsu();
  const hasil = await simpanPenjualan({
    db,
    ...args({ keranjang: { baris: BARIS, diskon: DISKON_KECIL } }),
  });

  assert.equal(hasil.status, 'tersimpan');
  // 20.000 − 5% = 19.000; PB1 10% eksklusif → 19.000 + 1.900 = 20.900.
  assert.equal(hasil.total, 20900n, 'diskon tidak masuk hitungan total');
});

test('⛔ `order_discount` benar-benar DITULIS ke baris order', async () => {
  const { simpanPenjualan } = await import(MOD);
  const db = dbPalsu();
  await simpanPenjualan({ db, ...args({ keranjang: { baris: BARIS, diskon: DISKON_KECIL } }) });

  // Kolom ke-11 pada INSERT "order" (setelah subtotal) — lihat urutan
  // kolomnya di `penjualan.ts`. Yang diperiksa NILAI yang di-bind, bukan
  // sekadar bahwa tabelnya disentuh: fake `DbLokal` tidak menegakkan satu pun
  // constraint (`CLAUDE.md`).
  const order = db.state.tulis.find((t) => /INSERT INTO "order"/.test(t.sql));
  assert.ok(order, 'baris order tidak ditulis');
  assert.equal(order.params[10], 1000, 'order_discount bukan 5% dari 20.000');
});

test('tanpa diskon, `order_discount` nol dan total tidak berubah', async () => {
  const { simpanPenjualan } = await import(MOD);
  const db = dbPalsu();
  const hasil = await simpanPenjualan({ db, ...args() });
  assert.equal(hasil.total, 22000n);
  const order = db.state.tulis.find((t) => /INSERT INTO "order"/.test(t.sql));
  assert.equal(order.params[10], 0);
});

test('⛔ diskon di ATAS ambang tanpa penyetuju DITOLAK, dan tidak menulis apa pun', async () => {
  const { simpanPenjualan } = await import(MOD);
  const db = dbPalsu();
  const hasil = await simpanPenjualan({
    db,
    ...args({
      keranjang: {
        baris: BARIS,
        // 30% > ambang 20%.
        diskon: { ...DISKON_KECIL, minta: { tipe: 'persen', nilai: 3000n } },
      },
    }),
  });

  assert.equal(hasil.status, 'butuh_penyetuju_diskon');
  assert.equal(hasil.nominal, 6000n);
  // ⛔ Berbeda dari selisih hitungan (`spec-h:95`): di sana uangnya sudah
  // diterima merchant. Di sini kasir belum menerima apa pun, dan yang ditahan
  // adalah potongan yang belum disetujui siapa pun.
  assert.equal(db.state.tulis.length, 0, 'ada yang tertulis padahal ditolak');
});

test('diskon di atas ambang DENGAN penyetuju tersimpan', async () => {
  const { simpanPenjualan } = await import(MOD);
  const db = dbPalsu();
  const hasil = await simpanPenjualan({
    db,
    ...args({
      keranjang: { baris: BARIS, diskon: DISKON_DISETUJUI },
    }),
  });
  assert.equal(hasil.status, 'tersimpan');
  // 20.000 − 30% = 14.000; + PB1 10% = 15.400.
  assert.equal(hasil.total, 15400n);
});

test('⛔ penyetuju IKUT di baris outbox — tanpanya diskon offline berhenti permanen', async () => {
  const { simpanPenjualan } = await import(MOD);
  const db = dbPalsu();
  await simpanPenjualan({
    db,
    ...args({
      keranjang: { baris: BARIS, diskon: DISKON_DISETUJUI },
    }),
  });

  // Bentuk cacat yang SAMA dengan refund offline: server menuntut
  // `X-Approver-Id`, relay hanya mengirimkannya bila barisnya membawanya.
  const outbox = db.state.tulis.filter((t) => /INSERT INTO outbox_local/.test(t.sql));
  const order = outbox.find((t) => t.params.includes('order'));
  assert.ok(order, 'item outbox order tidak ada');
  assert.ok(
    order.params.includes('u-budi'),
    `approver_id tidak dibekukan di baris outbox: ${JSON.stringify(order.params)}`
  );
});

test('⛔ muatan outbox mengirim PERMINTAAN diskon, bukan nominalnya', async () => {
  const { simpanPenjualan } = await import(MOD);
  const db = dbPalsu();
  await simpanPenjualan({ db, ...args({ keranjang: { baris: BARIS, diskon: DISKON_KECIL } }) });

  const outbox = db.state.tulis.filter((t) => /INSERT INTO outbox_local/.test(t.sql));
  const order = outbox.find((t) => t.params.includes('order'));
  const muatan = JSON.parse(order.params.find((p) => typeof p === 'string' && p.startsWith('{')));

  // Server menghitung ulang dari subtotalnya SENDIRI. Mengirim nominal
  // membuatnya tidak dapat membedakan diskon yang wajar dari yang dikarang —
  // dan membuat jalur pemeriksaan selisih FR-H6 salah menandai perangkat yang
  // harganya basi.
  assert.deepEqual(muatan.discount, { tipe: 'persen', nilai: 500 });
  assert.equal(muatan.discountReasonCode, 'promo_berjalan');
  assert.equal(muatan.orderDiscount, undefined, 'nominal ikut terkirim');
});

test('⛔ persetujuan TIDAK berlaku untuk potongan yang TUMBUH melewatinya', async () => {
  const { simpanPenjualan } = await import(MOD);
  const db = dbPalsu();
  const hasil = await simpanPenjualan({
    db,
    ...args({
      keranjang: {
        // Keranjang DUA KALI lipat: 30% kini Rp 12.000, bukan Rp 6.000 yang
        // manajer lihat. Tanpa aturan ini, satu persetujuan atas "30%"
        // berlaku untuk keranjang berapa pun sesudahnya — kasir tinggal
        // menambah barang setelah manajer pergi.
        baris: [...BARIS, { ...BARIS[0], id: 'baris-2' }],
        diskon: DISKON_DISETUJUI,
      },
    }),
  });

  assert.equal(hasil.status, 'butuh_penyetuju_diskon');
  assert.equal(hasil.nominal, 12000n);
  assert.equal(db.state.tulis.length, 0, 'ada yang tertulis padahal ditolak');
});

test('potongan yang MENGECIL tetap sah dengan persetujuan yang sama', async () => {
  const { simpanPenjualan } = await import(MOD);
  const db = dbPalsu();
  const hasil = await simpanPenjualan({
    db,
    ...args({
      keranjang: {
        baris: BARIS,
        // Manajer menyetujui Rp 9.000; potongan sesungguhnya Rp 6.000.
        // Meminta persetujuan ulang untuk yang lebih kecil hanya melatih
        // manajer mengetik PIN tanpa membaca.
        diskon: { ...DISKON_DISETUJUI, nominalDisetujui: 9000n },
      },
    }),
  });
  assert.equal(hasil.status, 'tersimpan');
  assert.equal(hasil.total, 15400n);
});

test('⛔ diskon MUNCUL di struk — subtotal kotor tanpa barisnya tidak dapat dijelaskan', async () => {
  const { simpanPenjualan } = await import(MOD);
  const db = dbPalsu();
  const { PROFIL_58MM } = await import('../../apps/kasir/src/cetak/profil.ts');
  const dicetak = [];
  const hasil = await simpanPenjualan({
    db,
    ...args({ keranjang: { baris: BARIS, diskon: DISKON_KECIL } }),
    printerProfile: PROFIL_58MM,
    peripheral: {
      printReceipt: async (bytes) => {
        dicetak.push(bytes);
      },
      openCashDrawer: async () => {},
      listDevices: async () => [],
      testDevice: async () => false,
      onBarcodeScanned: () => () => {},
    },
  });

  assert.equal(hasil.status, 'tersimpan');
  assert.equal(hasil.cetak.status, 'tercetak', JSON.stringify(hasil.cetak));
  const teks = Buffer.from(dicetak.flatMap((b) => [...b])).toString('latin1');
  // `computeOrderTotals` TIDAK mengurangi subtotal, jadi struk mencetak
  // 20.000 lalu TOTAL 20.900 — selisih yang mustahil dijelaskan pelanggan
  // mana pun tanpa baris ini.
  assert.match(teks, /Diskon/, 'baris diskon tidak dicetak');
  assert.match(teks, /1\.000/, 'nominal diskon tidak muncul di struk');
});
