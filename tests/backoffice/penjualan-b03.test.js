'use strict';

// B-03 — aturan tampilan Detail Transaksi.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const B03 = '../../apps/backoffice/src/penjualan/b03.ts';

const DASAR = {
  id: 'o1',
  receiptNumber: 'K1-20260810-0007',
  businessDate: '2026-08-10',
  sequence: 7,
  outletId: 'out1',
  channel: 'takeaway',
  status: 'closed',
  createdBy: 'u1',
  createdByNama: 'Ani',
  occurredAt: '2026-08-10T03:00:00.000Z',
  subtotal: '100000',
  orderDiscount: '0',
  serviceChargeAmount: '0',
  taxAmount: '11000',
  roundingAdjustment: '0',
  total: '111000',
  amountDue: '111000',
  hasCalculationVariance: false,
  varianceAmount: null,
  dibatalkanOleh: null,
  dibatalkanPada: null,
  lines: [],
  payments: [],
  refunds: [],
  totalDibayar: '0',
  totalRefund: '0',
};

// ---------------------------------------------------------------------------
// Ringkasan uang
// ---------------------------------------------------------------------------

test('⛔ baris bernilai nol dibuang, kecuali subtotal dan total', async () => {
  // Struk yang mencantumkan "Diskon Rp 0" dan "Pembulatan Rp 0" untuk setiap
  // transaksi membuat baris yang benar-benar penting tenggelam.
  const { barisRingkasan } = await import(B03);
  const label = barisRingkasan(DASAR).map((b) => b.label);
  assert.deepEqual(label, ['Subtotal', 'Pajak', 'Total']);
});

test('subtotal dan total tetap tampil walau nol', async () => {
  const { barisRingkasan } = await import(B03);
  const label = barisRingkasan({ ...DASAR, subtotal: '0', taxAmount: '0', total: '0' })
    .map((b) => b.label);
  assert.deepEqual(label, ['Subtotal', 'Total']);
});

test('baris yang terisi muncul dalam urutan FR-C8', async () => {
  const { barisRingkasan } = await import(B03);
  const label = barisRingkasan({
    ...DASAR,
    orderDiscount: '5000',
    serviceChargeAmount: '3000',
    roundingAdjustment: '100',
  }).map((b) => b.label);
  assert.deepEqual(label, ['Subtotal', 'Diskon', 'Biaya layanan', 'Pajak', 'Pembulatan', 'Total']);
});

test('⛔ total TIDAK dihitung ulang dari komponennya', async () => {
  // Menghitungnya ulang menciptakan sumber kedua yang akan menyimpang dari
  // server. Yang ditampilkan harus persis apa yang server kirim, bahkan ketika
  // komponennya terlihat tidak menjumlah — karena kalau itu terjadi, yang
  // salah bukan penjumlahannya melainkan datanya, dan itu harus terlihat.
  const { barisRingkasan } = await import(B03);
  const aneh = { ...DASAR, subtotal: '1', taxAmount: '1', total: '999999' };
  const total = barisRingkasan(aneh).find((b) => b.label === 'Total');
  assert.equal(total.nilai, '999999');
});

// ---------------------------------------------------------------------------
// Sisa tagihan
// ---------------------------------------------------------------------------

test('⛔ sisa tagihan dihitung sebagai bigint', async () => {
  const { sisaTagihan } = await import(B03);
  assert.equal(sisaTagihan({ ...DASAR, amountDue: '111000', totalDibayar: '111000' }), '0');
  assert.equal(sisaTagihan({ ...DASAR, amountDue: '111000', totalDibayar: '50000' }), '61000');
});

test('⛔ presisi sisa tagihan utuh di atas 2^53', async () => {
  const { sisaTagihan } = await import(B03);
  assert.equal(
    sisaTagihan({ ...DASAR, amountDue: '9007199254740993', totalDibayar: '1' }),
    '9007199254740992'
  );
});

test('nilai cacat tidak merender NaN', async () => {
  const { sisaTagihan } = await import(B03);
  assert.equal(sisaTagihan({ ...DASAR, amountDue: '', totalDibayar: '0' }), '0');
});

// ---------------------------------------------------------------------------
// Kuantitas
// ---------------------------------------------------------------------------

test('kuantitas x1000 terbaca manusia', async () => {
  const { kuantitasTampil } = await import(B03);
  assert.equal(kuantitasTampil(1000), '1');
  assert.equal(kuantitasTampil(2500), '2,5');
  assert.equal(kuantitasTampil(500), '0,5');
  assert.equal(kuantitasTampil(12000), '12');
});

test('⛔ kuantitas klien SEPAKAT dengan server', async () => {
  // Dua fungsi dengan nama sama di dua sisi adalah undangan untuk menyimpang.
  // Kalau salah satunya berubah, angka di layar berbeda dari angka di ekspor.
  const { kuantitasTampil: klien } = await import(B03);
  const { kuantitasTampil: server } = await import(
    '../../apps/server/src/modules/reporting/handlers/detail-transaksi.ts'
  );
  for (const n of [1000, 2500, 500, 12000, 3000, 1]) {
    assert.equal(klien(n), server(n), `berbeda untuk ${n}`);
  }
});

// ---------------------------------------------------------------------------
// Label
// ---------------------------------------------------------------------------

test('metode dan status pembayaran terbaca merchant', async () => {
  const { labelMetode, labelStatusBayar } = await import(B03);
  assert.equal(labelMetode('cash'), 'Tunai');
  assert.equal(labelMetode('qris_dynamic'), 'QRIS (dinamis)');
  assert.equal(labelStatusBayar('confirmed'), 'Terkonfirmasi');
});

test('⛔ pending TIDAK disebut gagal maupun lunas', async () => {
  // Ia keadaan ketiga yang nyata: QRIS yang QR-nya sudah diminta tapi gateway
  // belum menjawab, sementara pelanggan mungkin sudah membayar (FR-C14).
  const { labelStatusBayar } = await import(B03);
  const teks = labelStatusBayar('pending_confirmation');
  assert.doesNotMatch(teks, /gagal|lunas|selesai/i);
  assert.match(teks, /menunggu/i);
});

test('kode tak dikenal tampil apa adanya, bukan kosong', async () => {
  const { labelMetode, labelStatusBayar } = await import(B03);
  assert.equal(labelMetode('metode_baru'), 'metode_baru');
  assert.equal(labelStatusBayar('status_baru'), 'status_baru');
});

// ---------------------------------------------------------------------------
// Keadaan panel
// ---------------------------------------------------------------------------

test('⛔ MEMUAT dibedakan dari TIDAK DITEMUKAN', async () => {
  // Yang membuka panel ini biasanya sedang melayani pelanggan yang memegang
  // struknya. Panel kosong yang sebenarnya masih memuat membuat kasir berkata
  // "transaksi Anda tidak ada di sistem kami".
  const { pesanDetail } = await import(B03);
  const muat = pesanDetail({ jenis: 'memuat' });
  const galat = pesanDetail({ jenis: 'galat', pesan: 'Transaksi x tidak ditemukan.' });

  assert.notEqual(muat.judul, galat.judul);
  assert.match(muat.judul, /memuat/i);
  assert.match(galat.badan, /tidak ditemukan/i);
});

test('detail siap → tidak ada pesan', async () => {
  const { pesanDetail } = await import(B03);
  assert.equal(pesanDetail({ jenis: 'siap', detail: DASAR }), null);
});
