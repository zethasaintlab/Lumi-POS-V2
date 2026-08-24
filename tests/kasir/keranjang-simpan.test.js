'use strict';

// KEP-21 — keranjang K-03 yang BERTAHAN melewati muat ulang.
//
// ⛔ Di atas SQLite sungguhan (`node:sqlite`), bukan fake. Yang diuji di sini
// adalah bentuk SQL — `ON CONFLICT(id) DO UPDATE`, `DELETE`, dan bahwa satu
// baris tetap satu baris setelah puluhan penulisan. Fake `DbLokal` tidak
// menegakkan primary key sama sekali, jadi ia akan hijau untuk kode yang
// meninggalkan seratus keranjang yatim.
//
// Tetap berlaku: bentuk SQL baru wajib dijalankan di BROWSER sebelum
// dipercaya — `ON CONFLICT(id)` diterima `node:sqlite` dan pernah DITOLAK
// `wa-sqlite` (8 Agustus 2026).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const MOD = '../../apps/kasir/src/kasir/keranjang-simpan.ts';

const DDL = `
CREATE TABLE keranjang_lokal (
  id TEXT PRIMARY KEY NOT NULL,
  shift_id TEXT NOT NULL,
  isi TEXT NOT NULL,
  diperbarui_pada TEXT NOT NULL
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
        const hasil = await fn(api);
        sqlite.exec('COMMIT');
        return hasil;
      } catch (e) {
        sqlite.exec('ROLLBACK');
        throw e;
      }
    },
  };
  return api;
}

const JAM = () => new Date('2026-08-24T10:00:00Z');

function baris(over = {}) {
  return {
    id: 'b1',
    variationId: 'v1',
    itemName: 'Kopi Susu',
    variationName: 'Regular',
    unitPrice: 20000,
    quantityMilli: 1000,
    modifier: [],
    ...over,
  };
}

const KERANJANG = { baris: [baris()], diskon: null };

const jumlahBaris = (d) => d.sqlite.prepare('SELECT COUNT(*) AS n FROM keranjang_lokal').get().n;

// ---------------------------------------------------------------------------

test('keranjang tersimpan dipulihkan utuh untuk shift yang sama', async () => {
  const { simpanKeranjang, pulihkanKeranjang } = await import(MOD);
  const d = db();
  await simpanKeranjang(d, 's1', KERANJANG, JAM);

  const pulih = await pulihkanKeranjang(d, 's1');
  assert.equal(pulih.status, 'dipulihkan');
  assert.deepEqual(pulih.keranjang, KERANJANG);
});

test('tanpa baris tersimpan, pemulihan menjawab kosong', async () => {
  const { pulihkanKeranjang } = await import(MOD);
  const pulih = await pulihkanKeranjang(db(), 's1');
  assert.equal(pulih.status, 'kosong');
});

test('⛔ SATU baris, berapa pun kali disimpan', async () => {
  // Kunci konstan membuat "simpan keranjang" satu UPSERT yang tidak dapat
  // meninggalkan baris yatim — dan membuat mustahil ada dua keranjang yang
  // keduanya mengaku sedang berjalan.
  const { simpanKeranjang } = await import(MOD);
  const d = db();
  for (let i = 1; i <= 30; i += 1) {
    await simpanKeranjang(d, 's1', { baris: [baris({ quantityMilli: i * 1000 })], diskon: null }, JAM);
  }
  assert.equal(jumlahBaris(d), 1);
});

test('⛔ keranjang milik shift LAIN tidak dipulihkan, dan barisnya DIBUANG', async () => {
  // Kasir berikutnya yang membuka shift baru dan menemukan pesanan pelanggan
  // kemarin di layarnya akan menjualnya kepada orang yang salah — dan ia
  // tidak punya cara mengetahui bahwa baris itu bukan miliknya.
  const { simpanKeranjang, pulihkanKeranjang } = await import(MOD);
  const d = db();
  await simpanKeranjang(d, 's1', KERANJANG, JAM);

  const pulih = await pulihkanKeranjang(d, 's2');
  assert.equal(pulih.status, 'shift_berbeda');
  assert.equal(jumlahBaris(d), 0, 'barisnya harus dibuang, bukan ditinggalkan menunggu');

  // Dan ia tidak bangkit bila shift lama kebetulan dibuka lagi.
  assert.equal((await pulihkanKeranjang(d, 's1')).status, 'kosong');
});

test('⛔ keranjang KOSONG menghapus barisnya, tidak menyimpan {baris:[]}', async () => {
  const { simpanKeranjang, pulihkanKeranjang } = await import(MOD);
  const d = db();
  await simpanKeranjang(d, 's1', KERANJANG, JAM);
  assert.equal(jumlahBaris(d), 1);

  await simpanKeranjang(d, 's1', { baris: [], diskon: null }, JAM);
  assert.equal(jumlahBaris(d), 0);
  assert.equal((await pulihkanKeranjang(d, 's1')).status, 'kosong');
});

test('⛔ keranjang BERDISKON dapat disimpan — JSON.stringify melempar pada bigint', async () => {
  // Tanpa replacer, `TypeError: Do not know how to serialize a BigInt`
  // membuat keranjang berdiskon SATU-SATUNYA yang tidak dapat disimpan —
  // persis keranjang yang paling mahal untuk dimasukkan ulang, karena ia
  // menuntut PIN manajer lagi.
  const { simpanKeranjang, pulihkanKeranjang } = await import(MOD);
  const d = db();
  const berdiskon = {
    baris: [baris()],
    diskon: {
      minta: { tipe: 'persen', nilai: 3000n },
      alasanKode: 'pelanggan_setia',
      alasanCatatan: null,
      approverId: 'u-budi',
      nominalDisetujui: 6000n,
    },
  };
  await simpanKeranjang(d, 's1', berdiskon, JAM);

  const pulih = await pulihkanKeranjang(d, 's1');
  assert.equal(pulih.status, 'dipulihkan');
  // ⛔ Kembali sebagai `bigint`, bukan string dan bukan number. Uang yang
  // pulih sebagai float membawa aritmetika yang berbeda dari seluruh jalur
  // uang ke dalam perhitungan diskon.
  assert.equal(typeof pulih.keranjang.diskon.minta.nilai, 'bigint');
  assert.equal(pulih.keranjang.diskon.minta.nilai, 3000n);
  assert.equal(typeof pulih.keranjang.diskon.nominalDisetujui, 'bigint');
  assert.equal(pulih.keranjang.diskon.nominalDisetujui, 6000n);
  assert.equal(pulih.keranjang.diskon.approverId, 'u-budi');
});

test('diskon TANPA penyetuju dipulihkan apa adanya', async () => {
  const { simpanKeranjang, pulihkanKeranjang } = await import(MOD);
  const d = db();
  await simpanKeranjang(
    d,
    's1',
    {
      baris: [baris()],
      diskon: {
        minta: { tipe: 'nominal', nilai: 2000n },
        alasanKode: 'promo',
        alasanCatatan: 'promo pagi',
        approverId: null,
        nominalDisetujui: null,
      },
    },
    JAM
  );
  const pulih = await pulihkanKeranjang(d, 's1');
  assert.equal(pulih.keranjang.diskon.approverId, null);
  assert.equal(pulih.keranjang.diskon.nominalDisetujui, null);
  assert.equal(pulih.keranjang.diskon.alasanCatatan, 'promo pagi');
});

test('⛔ penyetuju TANPA nominalnya membuang diskonnya, bukan memulihkannya setengah', async () => {
  // Yang manajer setujui adalah ANGKANYA. `approverId` tanpa
  // `nominalDisetujui` tidak menutup apa pun — keranjang yang tumbuh setelah
  // pemulihan akan memakai persetujuan yang tidak dapat dibandingkan dengan
  // apa pun, dan potongannya melewati angka yang manajer benar-benar lihat.
  const { pulihkanKeranjang } = await import(MOD);
  const d = db();
  d.sqlite
    .prepare('INSERT INTO keranjang_lokal (id, shift_id, isi, diperbarui_pada) VALUES (?,?,?,?)')
    .run(
      'kini',
      's1',
      JSON.stringify({
        baris: [baris()],
        diskon: {
          minta: { tipe: 'persen', nilai: '3000' },
          alasanKode: 'promo',
          alasanCatatan: null,
          approverId: 'u-budi',
          nominalDisetujui: null,
        },
      }),
      '2026-08-24T10:00:00Z'
    );

  const pulih = await pulihkanKeranjang(d, 's1');
  assert.equal(pulih.status, 'dipulihkan');
  assert.equal(pulih.keranjang.baris.length, 1, 'barisnya tetap dipulihkan');
  assert.equal(pulih.keranjang.diskon, null, 'diskonnya dibuang');
});

test('⛔ uang yang tersimpan sebagai NUMBER ditolak — float tidak pernah masuk jalur uang', async () => {
  const { pulihkanKeranjang } = await import(MOD);
  const d = db();
  d.sqlite
    .prepare('INSERT INTO keranjang_lokal (id, shift_id, isi, diperbarui_pada) VALUES (?,?,?,?)')
    .run(
      'kini',
      's1',
      JSON.stringify({
        baris: [baris()],
        diskon: {
          minta: { tipe: 'persen', nilai: 3000 },
          alasanKode: 'promo',
          alasanCatatan: null,
          approverId: null,
          nominalDisetujui: null,
        },
      }),
      '2026-08-24T10:00:00Z'
    );
  assert.equal((await pulihkanKeranjang(d, 's1')).keranjang.diskon, null);
});

test('⛔ isi yang RUSAK dibuang, tidak melempar — kasir tidak boleh kehilangan aplikasinya', async () => {
  const { pulihkanKeranjang } = await import(MOD);
  for (const isi of [
    'bukan json',
    'null',
    '[]',
    '{"baris":"bukan larik"}',
    '{"baris":[{"id":"b1"}]}',
    '{"baris":[{"id":"b1","variationId":"v1","itemName":"K","variationName":"R","unitPrice":"20000","quantityMilli":1000,"modifier":[]}]}',
    '{"baris":[{"id":"b1","variationId":"v1","itemName":"K","variationName":"R","unitPrice":20000,"quantityMilli":1000,"modifier":[{"id":"m1"}]}]}',
  ]) {
    const d = db();
    d.sqlite
      .prepare('INSERT INTO keranjang_lokal (id, shift_id, isi, diperbarui_pada) VALUES (?,?,?,?)')
      .run('kini', 's1', isi, '2026-08-24T10:00:00Z');

    const pulih = await pulihkanKeranjang(d, 's1');
    assert.equal(pulih.status, 'kosong', isi);
    assert.equal(jumlahBaris(d), 0, `${isi}: baris rusak harus dibuang`);
  }
});

test('modifier dipulihkan lengkap dengan kuantitasnya', async () => {
  // ⛔ `qtyMilli` masuk sidik jari keranjang: "Extra Shot ×1" dan "×2" adalah
  // baris berbeda. Pemulihan yang menjatuhkannya menggabungkan dua pesanan
  // menjadi satu, dan pelanggan kedua menerima kopi pelanggan pertama.
  const { simpanKeranjang, pulihkanKeranjang } = await import(MOD);
  const d = db();
  const k = {
    baris: [
      baris({ modifier: [{ id: 'm1', nama: 'Extra Shot', harga: 5000, qtyMilli: 2000 }] }),
    ],
    diskon: null,
  };
  await simpanKeranjang(d, 's1', k, JAM);
  const pulih = await pulihkanKeranjang(d, 's1');
  assert.deepEqual(pulih.keranjang.baris[0].modifier, k.baris[0].modifier);
});

test('bersihkanKeranjangDi menghapus, dan aman dipanggil saat sudah kosong', async () => {
  const { simpanKeranjang, bersihkanKeranjangDi } = await import(MOD);
  const d = db();
  await simpanKeranjang(d, 's1', KERANJANG, JAM);
  await bersihkanKeranjangDi(d);
  assert.equal(jumlahBaris(d), 0);
  await bersihkanKeranjangDi(d);
  assert.equal(jumlahBaris(d), 0);
});

test('⛔ pembersihan yang di-ROLLBACK tidak menghapus keranjang', async () => {
  // Konsekuensi dari menaruh pembersihan DI DALAM transaksi penjualan:
  // penjualan yang gagal harus meninggalkan keranjangnya utuh. Kasir yang
  // penjualannya gagal DAN keranjangnya hilang kehilangan keduanya.
  const { simpanKeranjang, bersihkanKeranjangDi, pulihkanKeranjang } = await import(MOD);
  const d = db();
  await simpanKeranjang(d, 's1', KERANJANG, JAM);

  await assert.rejects(
    d.transaction(async (tx) => {
      await bersihkanKeranjangDi(tx);
      throw new Error('penjualan gagal di tengah');
    })
  );

  const pulih = await pulihkanKeranjang(d, 's1');
  assert.equal(pulih.status, 'dipulihkan');
  assert.deepEqual(pulih.keranjang, KERANJANG);
});
