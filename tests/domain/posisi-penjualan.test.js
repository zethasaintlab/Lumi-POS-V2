'use strict';

// FR-G3 — satu fungsi untuk posisi penjualan bersih.
//
// `spec-g:29`: "Bila setiap laporan mengimplementasikan logikanya sendiri,
// laporan akan saling bertentangan — dan laporan yang saling bertentangan
// menghancurkan kepercayaan merchant lebih cepat daripada fitur yang hilang."
//
// ⛔ Definisi kanonik di `spec-g:34` ditulis untuk skema yang BUKAN skema ini:
//
//     omzet_kotor = SUM(order.total) WHERE status IN ('PAID','CLOSED','REFUNDED')
//     void_amount = SUM(order.total) WHERE status = 'VOIDED'
//
// Di sini void TIDAK mengubah status order aslinya. AC FR-B7 pertama melarang
// `UPDATE` pada order asli, jadi yang lahir adalah order PEMBATAL ber-status
// `voided` dengan `voided_by_order_id` menunjuk order yang dibatalkan; order
// aslinya tetap `closed`. Membaca definisi itu harfiah berarti order yang
// SUDAH dibatalkan tetap masuk omzet kotor — persis yang `spec-g:39`
// ("TIDAK termasuk dalam omzet kotor maupun bersih") larang.
//
// Yang dipertahankan di sini adalah MAKSUD definisinya.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../packages/domain/src/posisi-penjualan.ts';

const jual = (id, total, over = {}) => ({
  id,
  status: 'closed',
  total,
  taxAmount: 0,
  voidedByOrderId: null,
  ...over,
});

/** Order pembatal, seperti yang ditulis `pembatalan.ts` dan `cancel.ts`. */
const pembatal = (id, total, targetId) => ({
  id,
  status: 'voided',
  total,
  taxAmount: 0,
  voidedByOrderId: targetId,
});

test('omzet kotor menjumlahkan order yang terjual, bukan yang lain', async () => {
  const { posisiPenjualan } = await import(MOD);
  const p = posisiPenjualan({
    orders: [
      jual('a', 100000),
      jual('b', 50000, { status: 'paid' }),
      jual('c', 25000, { status: 'refunded' }),
      // Tidak dihitung: belum dibayar, dan ditinggalkan.
      jual('d', 999999, { status: 'open' }),
      jual('e', 888888, { status: 'abandoned' }),
    ],
    refunds: [],
  });
  assert.equal(p.omzetKotor, 175000n);
  assert.equal(p.jumlahTransaksi, 3);
});

test('⛔ order yang DIBATALKAN keluar dari omzet kotor, bukan hanya dari bersih', async () => {
  // `spec-g:39`: void "TIDAK termasuk dalam omzet kotor maupun bersih".
  const { posisiPenjualan } = await import(MOD);
  const p = posisiPenjualan({
    orders: [jual('a', 100000), jual('b', 60000), pembatal('v1', 60000, 'b')],
    refunds: [],
  });
  assert.equal(p.omzetKotor, 100000n, 'order yang dibatalkan masih terhitung di omzet kotor');
  assert.equal(p.voidAmount, 60000n);
  assert.equal(p.omzetBersih, 100000n);
  assert.equal(p.jumlahTransaksi, 1, 'transaksi yang dibatalkan tidak ikut dihitung');
});

test('⛔ order pembatal sendiri tidak pernah menjadi penjualan', async () => {
  // Ia ber-status `voided`, jadi ia tersaring lewat status. Tapi kalau
  // seseorang kelak menambahkan `voided` ke daftar status penjualan, nilainya
  // akan MENAMBAH omzet — dan nilainya disalin dari order aslinya, jadi
  // omzetnya justru naik saat penjualan dibatalkan.
  const { posisiPenjualan } = await import(MOD);
  const p = posisiPenjualan({
    orders: [jual('b', 60000), pembatal('v1', 60000, 'b')],
    refunds: [],
  });
  assert.equal(p.omzetKotor, 0n);
});

test('omzet bersih = omzet kotor − refund (spec-g:43)', async () => {
  const { posisiPenjualan } = await import(MOD);
  const p = posisiPenjualan({
    orders: [jual('a', 100000)],
    refunds: [{ orderId: 'a', amount: 30000 }],
  });
  assert.equal(p.omzetKotor, 100000n);
  assert.equal(p.refundAmount, 30000n);
  assert.equal(p.omzetBersih, 70000n);
});

test('⛔ omzet bersih boleh NEGATIF, dan ditampilkan apa adanya', async () => {
  // `spec-g:283`: refund transaksi hari lalu dapat melebihi penjualan hari
  // ini. Menjepitnya ke nol menyembunyikan hari yang justru paling perlu
  // dilihat owner.
  const { posisiPenjualan } = await import(MOD);
  const p = posisiPenjualan({
    orders: [jual('a', 10000)],
    refunds: [{ orderId: 'lama', amount: 50000 }],
  });
  assert.equal(p.omzetBersih, -40000n);
});

test('⛔ refund atas order yang DIBATALKAN tidak mengurangi dua kali', async () => {
  // Order yang dibatalkan sudah keluar dari omzet kotor. Kalau refundnya juga
  // dikurangkan, penjualan yang sama dihapus dua kali dan omzet bersih turun
  // di bawah kebenarannya.
  const { posisiPenjualan } = await import(MOD);
  const p = posisiPenjualan({
    orders: [jual('a', 100000), jual('b', 60000), pembatal('v1', 60000, 'b')],
    refunds: [{ orderId: 'b', amount: 60000 }],
  });
  assert.equal(p.omzetBersih, 100000n);
});

test('pajak terkumpul berkurang sebanding porsi yang direfund (spec-g:45)', async () => {
  const { posisiPenjualan } = await import(MOD);
  const penuh = posisiPenjualan({
    orders: [jual('a', 100000, { taxAmount: 11000 })],
    refunds: [],
  });
  assert.equal(penuh.pajakTerkumpul, 11000n);

  const separuh = posisiPenjualan({
    orders: [jual('a', 100000, { taxAmount: 11000 })],
    refunds: [{ orderId: 'a', amount: 50000 }],
  });
  assert.equal(separuh.pajakTerkumpul, 5500n, 'porsi yang direfund harus ikut berkurang');

  const habis = posisiPenjualan({
    orders: [jual('a', 100000, { taxAmount: 11000 })],
    refunds: [{ orderId: 'a', amount: 100000 }],
  });
  assert.equal(habis.pajakTerkumpul, 0n);
});

test('rata-rata per transaksi memakai omzet BERSIH dan jumlah transaksi', async () => {
  const { posisiPenjualan } = await import(MOD);
  const p = posisiPenjualan({
    orders: [jual('a', 100000), jual('b', 50000)],
    refunds: [],
  });
  assert.equal(p.rataRataPerTransaksi, 75000n);
});

test('tanpa transaksi: nol di mana-mana, bukan pembagian dengan nol', async () => {
  const { posisiPenjualan } = await import(MOD);
  const p = posisiPenjualan({ orders: [], refunds: [] });
  assert.equal(p.omzetKotor, 0n);
  assert.equal(p.omzetBersih, 0n);
  assert.equal(p.jumlahTransaksi, 0);
  assert.equal(p.rataRataPerTransaksi, 0n);
});

test('⛔ menerima bigint, number, DAN string — ketiganya dari driver berbeda', async () => {
  // Pelajaran yang sudah tercatat di CLAUDE.md: `@powersync/web` mengembalikan
  // kolom INTEGER besar sebagai `bigint`, `node:sqlite` sebagai `number`, dan
  // `pg` mengembalikan `bigint` PostgreSQL sebagai STRING. Fungsi yang hanya
  // menerima satu bentuk akan hijau di test dan salah di salah satu aplikasi.
  const { posisiPenjualan } = await import(MOD);
  const p = posisiPenjualan({
    orders: [
      jual('a', 100000n, { taxAmount: '11000' }),
      jual('b', '50000', { taxAmount: 5500 }),
    ],
    refunds: [{ orderId: 'a', amount: 100000n }],
  });
  assert.equal(p.omzetKotor, 150000n);
  assert.equal(p.refundAmount, 100000n);
  assert.equal(p.omzetBersih, 50000n);
});

test('⛔ property: omzet bersih = omzet kotor − refund, untuk kombinasi apa pun', async () => {
  // `spec-g:294`, dan ia harus berlaku juga saat void dan refund bercampur.
  const { posisiPenjualan } = await import(MOD);

  let acak = 987654321;
  const berikut = () => {
    acak = (acak * 1103515245 + 12345) % 2147483648;
    return acak;
  };

  for (let iterasi = 0; iterasi < 400; iterasi += 1) {
    const orders = [];
    const refunds = [];
    const n = 1 + (berikut() % 8);
    for (let i = 0; i < n; i += 1) {
      const id = `o${i}`;
      const total = (berikut() % 500) * 1000;
      orders.push(jual(id, total));
      if (berikut() % 3 === 0) {
        orders.push(pembatal(`v${i}`, total, id));
      } else if (berikut() % 3 === 1 && total > 0) {
        refunds.push({ orderId: id, amount: berikut() % total });
      }
    }

    const p = posisiPenjualan({ orders, refunds });
    assert.equal(
      p.omzetBersih,
      p.omzetKotor - p.refundAmount,
      `bersih != kotor - refund untuk ${JSON.stringify({ orders, refunds })}`
    );
    assert.ok(p.voidAmount >= 0n);
    assert.ok(p.jumlahTransaksi >= 0);
  }
});

test('⛔ property: urutan baris tidak mengubah satu angka pun', async () => {
  // Laporan membaca baris lewat SQL, dan urutannya tidak dijamin tanpa
  // `ORDER BY` — pelajaran yang sudah tercatat: fake tidak menegakkan
  // `ORDER BY` sama sekali, jadi ketergantungan pada urutan tidak akan
  // pernah terlihat di test yang memakai fake.
  const { posisiPenjualan } = await import(MOD);
  const orders = [
    jual('a', 100000, { taxAmount: 11000 }),
    jual('b', 60000),
    pembatal('v1', 60000, 'b'),
    jual('c', 25000),
  ];
  const refunds = [{ orderId: 'a', amount: 40000 }, { orderId: 'c', amount: 5000 }];

  const lurus = posisiPenjualan({ orders, refunds });
  const terbalik = posisiPenjualan({
    orders: [...orders].reverse(),
    refunds: [...refunds].reverse(),
  });
  assert.deepEqual(terbalik, lurus);
});
