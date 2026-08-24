'use strict';

// FR-C3 + FR-C14 — jalur penjualan ONLINE-FIRST untuk QRIS dinamis.
//
// ⛔ Di atas SQLite sungguhan (`node:sqlite`). Yang diuji sebagian adalah
// bentuk SQL — `ON CONFLICT(id) DO UPDATE` dan satu baris yang tetap satu —
// dan fake `DbLokal` tidak menegakkan primary key sama sekali.
//
// Tetap berlaku: bentuk SQL baru wajib dijalankan di BROWSER sebelum
// dipercaya (`ON CONFLICT(id)` pernah ditolak `wa-sqlite`, 8 Agustus 2026).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const MOD = '../../apps/kasir/src/kasir/qris-dinamis.ts';

const DDL = `
CREATE TABLE device_config (
  id INTEGER PRIMARY KEY, receipt_sequence INTEGER NOT NULL DEFAULT 0,
  sequence_business_date TEXT
);
INSERT INTO device_config (id, receipt_sequence, sequence_business_date) VALUES (1, 0, NULL);
CREATE TABLE draf_qris_lokal (
  id TEXT PRIMARY KEY NOT NULL, order_id TEXT NOT NULL, payment_id TEXT NOT NULL,
  shift_id TEXT NOT NULL, draf TEXT NOT NULL, muatan TEXT NOT NULL,
  qr_string TEXT, dibuat_pada TEXT NOT NULL
);`;

function db() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(DDL);
  const api = {
    sqlite,
    async getAll(sql, params = []) {
      return sqlite.prepare(sql).all(...params);
    },
    async execute(sql, params = []) {
      sqlite.prepare(sql).run(...params);
    },
    async transaction(fn) {
      sqlite.exec('BEGIN');
      try {
        const h = await fn(api);
        sqlite.exec('COMMIT');
        return h;
      } catch (e) {
        sqlite.exec('ROLLBACK');
        throw e;
      }
    },
  };
  return api;
}

const KONFIG = {
  deviceId: 'd1', deviceCode: 'K1', tenantId: 't1', outletId: 'o1',
  baseUrl: 'http://server', tokenSecret: 'r',
};
const KERANJANG = {
  baris: [
    {
      id: 'b1', variationId: 'v1', itemName: 'Kopi', variationName: 'Regular',
      unitPrice: 20000, quantityMilli: 1000, modifier: [],
    },
  ],
  diskon: null,
};

const draf = (over = {}) => ({
  orderId: 'ord-1',
  checkId: 'chk-1',
  receiptNumber: 'K1-20260824-0001',
  sequence: 1,
  businessDate: '2026-08-24',
  paymentIds: ['pay-1'],
  occurredAt: '2026-08-24T10:00:00.000Z',
  hlc: 12345678901234n,
  ...over,
});

/** Perekam permintaan dengan jawaban yang dapat diatur per jalur. */
function pengirim(jawaban = {}) {
  const dikirim = [];
  const kirim = async (jalur, opsi) => {
    dikirim.push({ jalur, ...opsi });
    // ⛔ Kunci TERPANJANG yang cocok, bukan yang pertama. `/orders/x/payments`
    // memuat `/orders` DAN `/payments`; memilih yang pertama membuat jawaban
    // untuk order dipakai untuk permintaan gateway — dan test-nya gagal karena
    // fake-nya salah, bukan karena kodenya.
    const cocok = Object.keys(jawaban)
      .filter((k) => jalur.includes(k))
      .sort((a, b) => b.length - a.length)[0];
    const j = cocok === undefined ? { status: 201, body: {} } : jawaban[cocok];
    if (typeof j === 'function') return j();
    return j;
  };
  kirim.dikirim = dikirim;
  return kirim;
}

const argMinta = (d, over = {}) => ({
  db: over.db,
  kirim: over.kirim,
  konfig: KONFIG,
  shiftId: 's1',
  keranjang: KERANJANG,
  draf: d,
  channel: 'takeaway',
  total: 22000n,
  idBaru: (() => {
    let n = 0;
    return () => `gen-${++n}`;
  })(),
  sekarang: '2026-08-24T10:00:00.000Z',
});

// ---------------------------------------------------------------------------
// Pencadangan nomor struk
// ---------------------------------------------------------------------------

test('nomor struk dicadangkan dari counter LOKAL, tanpa bertanya ke server', async () => {
  const { cadangkanNomor } = await import(MOD);
  const d = db();
  const satu = await cadangkanNomor(d, '2026-08-24', 'K1');
  assert.equal(satu.sequence, 1);
  assert.equal(satu.receiptNumber, 'K1-20260824-0001');

  const dua = await cadangkanNomor(d, '2026-08-24', 'K1');
  assert.equal(dua.sequence, 2, 'counter harus benar-benar naik');
});

test('⛔ counter direset saat TANGGAL BISNIS berganti, bukan saat tengah malam', async () => {
  const { cadangkanNomor } = await import(MOD);
  const d = db();
  await cadangkanNomor(d, '2026-08-24', 'K1');
  await cadangkanNomor(d, '2026-08-24', 'K1');
  const baru = await cadangkanNomor(d, '2026-08-25', 'K1');
  assert.equal(baru.sequence, 1);
});

test('⛔ pencadangan TIDAK menulis baris order lokal apa pun', async () => {
  // Penjualan baru ada setelah `simpanPenjualan`. Menulis order lokal
  // berstatus `open` di sini mengembalikan persis masalah yang KEP-21 hindari:
  // order yang tidak pernah dibayar muncul di laporan tanpa jalan penutupan.
  const { cadangkanNomor } = await import(MOD);
  const d = db();
  await cadangkanNomor(d, '2026-08-24', 'K1');
  const tabel = d.sqlite
    .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
    .all()
    .map((r) => r.name);
  assert.ok(!tabel.includes('order'), 'test ini tidak boleh punya tabel order sama sekali');
  const draf = d.sqlite.prepare('SELECT COUNT(*) n FROM draf_qris_lokal').get().n;
  assert.equal(draf, 0, 'draf belum dibuat pada tahap ini');
});

// ---------------------------------------------------------------------------
// Permintaan QR
// ---------------------------------------------------------------------------

test('⛔ draf disimpan LOKAL SEBELUM permintaan gateway dikirim', async () => {
  // Alasan yang sama dengan kenapa server meng-commit payment
  // `pending_confirmation` sebelum memanggil gateway: kegagalan di tengah
  // tidak boleh menghapus satu-satunya jejak bahwa QR pernah diminta —
  // sementara pelanggan mungkin sudah membayar.
  const { mintaQr } = await import(MOD);
  const d = db();
  let adaSaatGateway = null;
  const kirim = pengirim({
    '/payments': () => {
      adaSaatGateway = d.sqlite.prepare('SELECT COUNT(*) n FROM draf_qris_lokal').get().n;
      return { status: 201, body: { qrString: 'QR123' } };
    },
  });
  await mintaQr(argMinta(draf(), { db: d, kirim }));
  assert.equal(adaSaatGateway, 1, 'draf harus SUDAH tersimpan saat gateway dipanggil');
});

test('QR yang berhasil dikembalikan dan disimpan bersama drafnya', async () => {
  const { mintaQr, pulihkanDraf } = await import(MOD);
  const d = db();
  const kirim = pengirim({ '/payments': { status: 201, body: { qrString: 'QR123' } } });
  const hasil = await mintaQr(argMinta(draf(), { db: d, kirim }));

  assert.equal(hasil.status, 'qr');
  assert.equal(hasil.qrString, 'QR123');
  assert.equal(hasil.paymentId, 'pay-1');

  const pulih = await pulihkanDraf(d, 's1');
  assert.equal(pulih.qrString, 'QR123');
});

test('⛔ kunci idempotensi pembayaran TETAP SAMA pada setiap percobaan', async () => {
  // `spec-c:326`: retry memakai kunci yang sama dan tidak membuat transaksi
  // gateway baru. QR kedua untuk uang yang sama adalah cara paling langsung
  // menagih pelanggan dua kali.
  const { mintaQr } = await import(MOD);
  const kunci = [];
  for (let i = 0; i < 3; i += 1) {
    const kirim = pengirim({ '/payments': { status: 201, body: { qrString: 'QR' } } });
    await mintaQr(argMinta(draf(), { db: db(), kirim }));
    kunci.push(kirim.dikirim.find((r) => r.jalur.includes('/payments')).idempotencyKey);
  }
  assert.deepEqual(kunci, ['pay-1', 'pay-1', 'pay-1']);
});

test('⛔ 409 ID_ALREADY_EXISTS pada order adalah SUKSES, bukan kegagalan', async () => {
  // Percobaan kedua atas draf yang sama — kasir menekan ulang setelah jaringan
  // menggantung — harus melanjutkan ke permintaan QR, bukan menyerah pada
  // order yang sudah benar-benar ada di server.
  const { mintaQr } = await import(MOD);
  const kirim = pengirim({
    '/orders': { status: 409, body: { error: { code: 'ID_ALREADY_EXISTS' } } },
    '/payments': { status: 201, body: { qrString: 'QR123' } },
  });
  const hasil = await mintaQr(argMinta(draf(), { db: db(), kirim }));
  assert.equal(hasil.status, 'qr', hasil.status === 'gagal' ? hasil.pesan : '');
});

test('409 LAIN pada order tetap gagal — tidak semua konflik berarti sudah ada', async () => {
  const { mintaQr } = await import(MOD);
  const kirim = pengirim({
    '/orders': { status: 409, body: { error: { code: 'SHIFT_NOT_OPEN', message: 'Shift tutup.' } } },
  });
  const hasil = await mintaQr(argMinta(draf(), { db: db(), kirim }));
  assert.equal(hasil.status, 'gagal');
  assert.match(hasil.pesan, /Shift tutup/);
});

test('⛔ gateway yang gagal tetap MENGEMBALIKAN paymentId', async () => {
  // Payment mungkin sudah ada di server sebagai `pending_confirmation`, dan
  // tombol "Cek status" adalah satu-satunya jalan menemukannya lagi
  // (`spec-c:313`). Kehilangan idnya berarti kehilangan uang yang mungkin
  // sudah dibayar.
  const { mintaQr } = await import(MOD);
  const kirim = pengirim({
    '/payments': { status: 502, body: { error: { message: 'Gateway timeout.' } } },
  });
  const hasil = await mintaQr(argMinta(draf(), { db: db(), kirim }));
  assert.equal(hasil.status, 'gagal');
  assert.equal(hasil.paymentId, 'pay-1', 'paymentId harus tetap dikembalikan');
});

test('⛔ draf TETAP tersimpan meski gateway gagal', async () => {
  const { mintaQr, pulihkanDraf } = await import(MOD);
  const d = db();
  const kirim = pengirim({ '/payments': { status: 502, body: {} } });
  await mintaQr(argMinta(draf(), { db: d, kirim }));
  const pulih = await pulihkanDraf(d, 's1');
  assert.ok(pulih, 'jejaknya tidak boleh hilang');
  assert.equal(pulih.qrString, null, 'QR belum ada, dan itu dinyatakan');
});

// ---------------------------------------------------------------------------
// Pemulihan setelah restart — `spec-c:328`
// ---------------------------------------------------------------------------

test('⛔ draf dipulihkan utuh setelah restart, termasuk HLC bertipe bigint', async () => {
  const { mintaQr, pulihkanDraf } = await import(MOD);
  const d = db();
  const kirim = pengirim({ '/payments': { status: 201, body: { qrString: 'QR123' } } });
  await mintaQr(argMinta(draf(), { db: d, kirim }));

  const pulih = await pulihkanDraf(d, 's1');
  assert.equal(pulih.orderId, 'ord-1');
  assert.equal(pulih.paymentId, 'pay-1');
  // ⛔ `JSON.stringify` MELEMPAR pada bigint. Tanpa replacer, draf tidak dapat
  // disimpan sama sekali — dan HLC yang pulih sebagai `number` kehilangan
  // presisi di atas 2^53, yang setiap nilai HLC nyata lampaui.
  assert.equal(typeof pulih.draf.hlc, 'bigint');
  assert.equal(pulih.draf.hlc, 12345678901234n);
  assert.equal(pulih.draf.receiptNumber, 'K1-20260824-0001');
});

test('⛔ draf milik shift LAIN tidak dipulihkan, dan barisnya DIBUANG', async () => {
  const { mintaQr, pulihkanDraf } = await import(MOD);
  const d = db();
  const kirim = pengirim({ '/payments': { status: 201, body: { qrString: 'QR' } } });
  await mintaQr(argMinta(draf(), { db: d, kirim }));

  assert.equal(await pulihkanDraf(d, 's2'), null);
  assert.equal(d.sqlite.prepare('SELECT COUNT(*) n FROM draf_qris_lokal').get().n, 0);
});

test('⛔ SATU baris, berapa pun kali disimpan', async () => {
  const { simpanDraf } = await import(MOD);
  const d = db();
  for (let i = 0; i < 20; i += 1) {
    await simpanDraf(
      d,
      { draf: draf(), muatan: {}, orderId: 'ord-1', paymentId: 'pay-1', shiftId: 's1', qrString: null },
      '2026-08-24T10:00:00.000Z'
    );
  }
  assert.equal(d.sqlite.prepare('SELECT COUNT(*) n FROM draf_qris_lokal').get().n, 1);
});

test('⛔ draf RUSAK dibuang, tidak melempar', async () => {
  const { pulihkanDraf } = await import(MOD);
  for (const isi of ['bukan json', '{}', '{"hlc":123}', '{"hlc":"bukan-angka"}']) {
    const d = db();
    d.sqlite
      .prepare(
        `INSERT INTO draf_qris_lokal (id, order_id, payment_id, shift_id, draf, muatan, qr_string, dibuat_pada)
         VALUES ('kini','o','p','s1',?,'{}',NULL,'t')`
      )
      .run(isi);
    assert.equal(await pulihkanDraf(d, 's1'), null, isi);
  }
});

// ---------------------------------------------------------------------------
// Polling status
// ---------------------------------------------------------------------------

test('⛔ status TAK DIKENAL dibaca pending, TIDAK PERNAH confirmed', async () => {
  // Aturan yang sama dengan adapter gateway di server: menandai lunas
  // berdasarkan kata yang tidak dimengerti adalah menyerahkan barang tanpa
  // uang.
  const { cekStatus } = await import(MOD);
  for (const status of ['settlement', 'capture', 'entah', '', null]) {
    const hasil = await cekStatus(pengirim({ 'check-status': { status: 200, body: { status } } }), 'p');
    assert.equal(hasil, 'pending', JSON.stringify(status));
  }
});

test('confirmed / failed / expired dipetakan apa adanya', async () => {
  const { cekStatus } = await import(MOD);
  const peta = { confirmed: 'confirmed', failed: 'gagal', expired: 'kedaluwarsa' };
  for (const [server, kita] of Object.entries(peta)) {
    const hasil = await cekStatus(
      pengirim({ 'check-status': { status: 200, body: { status: server } } }),
      'p'
    );
    assert.equal(hasil, kita, server);
  }
});

test('⛔ kegagalan JARINGAN dibaca pending, bukan gagal', async () => {
  // Jaringan yang putus tidak mengatakan apa pun tentang apakah pelanggan
  // sudah membayar. Menandainya `gagal` membatalkan transaksi yang uangnya
  // mungkin sudah masuk.
  const { cekStatus } = await import(MOD);
  const meledak = async () => {
    throw new Error('ECONNRESET');
  };
  assert.equal(await cekStatus(meledak, 'p'), 'pending');

  const limaRatus = pengirim({ 'check-status': { status: 503, body: {} } });
  assert.equal(await cekStatus(limaRatus, 'p'), 'pending');
});

test('status juga terbaca dari bentuk bersarang `payment.status`', async () => {
  const { cekStatus } = await import(MOD);
  const hasil = await cekStatus(
    pengirim({ 'check-status': { status: 200, body: { payment: { status: 'confirmed' } } } }),
    'p'
  );
  assert.equal(hasil, 'confirmed');
});

// ---------------------------------------------------------------------------
// Pembatalan
// ---------------------------------------------------------------------------

test('tinggalkanDraf menembak /abandon dan melaporkan hasilnya', async () => {
  const { tinggalkanDraf } = await import(MOD);
  const kirim = pengirim({ '/abandon': { status: 200, body: { status: 'abandoned' } } });
  assert.equal(await tinggalkanDraf(kirim, 'ord-1', 'qris_dibatalkan'), true);
  const req = kirim.dikirim.find((r) => r.jalur.includes('/abandon'));
  assert.equal(req.jalur, '/orders/ord-1/abandon');
  assert.equal(req.body.reasonCode, 'qris_dibatalkan');
});

test('⛔ pembatalan yang GAGAL dilaporkan false, tidak melempar', async () => {
  // Layar harus tetap dapat melanjutkan: draf yang gagal dibatalkan akan
  // ditangkap pembersihan massal 24 jam. Melempar di sini membuat kasir
  // terjebak di layar yang tidak dapat ditutup.
  const { tinggalkanDraf } = await import(MOD);
  assert.equal(await tinggalkanDraf(pengirim({ '/abandon': { status: 500, body: {} } }), 'o', 'x'), false);
  const meledak = async () => {
    throw new Error('offline');
  };
  assert.equal(await tinggalkanDraf(meledak, 'o', 'x'), false);
});
