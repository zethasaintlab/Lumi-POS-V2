'use strict';

// Pembayaran campuran — satu order, banyak payment. FR-C1 [P0], `spec-c:195`.
//
// "Pembayaran campuran (tunai + QRIS) adalah alur harian di kafe Indonesia,
// bukan edge case." Server sudah mendukungnya sejak Modul C; jalur perangkat
// hanya pernah menulis SATU payment.
//
// ⛔ Yang paling menentukan di berkas ini: yang dibulatkan adalah SISA TUNAI
// setelah bagian non-tunai (`spec-c:181`), bukan totalnya. Membulatkan total
// lebih dulu membuat angka yang ditagihkan berbeda dari angka yang dijumlahkan
// dari bagian-bagiannya — dan selisihnya beberapa rupiah per transaksi, yaitu
// tepat besaran yang tidak pernah dilaporkan siapa pun tapi muncul di
// rekonsiliasi.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../packages/domain/src/pembayaran-campuran.ts';

const OUTLET = { roundingIncrement: 100n, roundingMode: 'half_up' };

function rencana(total, bagian) {
  return { total, bagian, ...OUTLET };
}

test('⛔ yang dibulatkan SISA TUNAI, bukan total (`spec-c:181`)', async () => {
  const { rencanakanPembayaran } = await import(MOD);

  // Contoh terhitung dari spec: total 93.555, QRIS 50.000 → sisa 43.555
  // dibulatkan menjadi 43.600.
  const h = rencanakanPembayaran(
    rencana(93_555n, [
      { metode: 'qris_static', nominal: 50_000n },
      { metode: 'cash', tendered: 50_000n },
    ])
  );

  assert.equal(h.ok, true, h.ok ? '' : h.pesan);
  assert.equal(h.rencana.tunaiDitagih, 43_600n);
  assert.equal(h.rencana.amountDue, 93_600n);
  assert.equal(h.rencana.roundingAdjustment, 45n);
  assert.equal(h.rencana.kembalian, 6_400n);
});

test('membulatkan TOTAL lebih dulu memberi angka yang berbeda', async () => {
  const { rencanakanPembayaran } = await import(MOD);
  const { computeCashRounding } = await import('../../packages/domain/src/money.ts');

  // Bukti bahwa urutannya benar-benar berpengaruh, bukan kebetulan sama.
  //
  // ⛔ Yang membuatnya berbeda adalah nominal non-tunai yang BUKAN kelipatan
  // pembulatan — dan itu keadaan biasa, bukan sudut: QRIS menagih angka
  // persis, jadi pelanggan yang membayar sebagian lewat QRIS hampir selalu
  // menyisakan pecahan di bawah Rp 100.
  const total = 93_555n;
  const nonTunai = 50_020n;
  const salah = computeCashRounding({ outstanding: total, ...OUTLET }).roundedOutstanding - nonTunai;
  const h = rencanakanPembayaran(
    rencana(total, [
      { metode: 'qris_static', nominal: nonTunai },
      { metode: 'cash', tendered: 50_000n },
    ])
  );
  assert.equal(h.ok, true);
  assert.equal(h.rencana.tunaiDitagih, 43_500n, 'sisa 43.535 dibulatkan salah');
  assert.equal(salah, 43_580n);
  assert.notEqual(h.rencana.tunaiDitagih, salah, 'kedua urutan memberi angka yang sama');
});

test('⛔ kelebihan bayar NON-TUNAI ditolak, dengan angkanya', async () => {
  const { rencanakanPembayaran } = await import(MOD);

  // `spec-c:225`: tidak ada mekanisme mengembalikan kembalian non-tunai. QRIS
  // yang kelebihan berarti merchant berutang lewat saluran yang tidak dapat
  // mengembalikannya — dan yang mengetahuinya hanya pelanggan.
  const h = rencanakanPembayaran(rencana(50_000n, [{ metode: 'qris_static', nominal: 60_000n }]));
  assert.equal(h.ok, false);
  assert.equal(h.kode, 'KELEBIHAN_NON_TUNAI');
  assert.match(h.pesan, /10000/, 'pesannya tidak menyebut selisihnya');
});

test('kelebihan bayar TUNAI menghasilkan kembalian, bukan penolakan', async () => {
  const { rencanakanPembayaran } = await import(MOD);
  const h = rencanakanPembayaran(rencana(20_000n, [{ metode: 'cash', tendered: 50_000n }]));
  assert.equal(h.ok, true);
  assert.equal(h.rencana.kembalian, 30_000n);
});

test('non-tunai yang belum menutup tagihan DITOLAK bila tidak ada tunai', async () => {
  const { rencanakanPembayaran } = await import(MOD);
  // Jalur perangkat menulis penjualan hanya saat lunas: order `open` yang
  // tidak pernah dibayar akan muncul di laporan dan belum punya jalan
  // penutupan (KEP-21, belum dibangun).
  const h = rencanakanPembayaran(rencana(50_000n, [{ metode: 'qris_static', nominal: 30_000n }]));
  assert.equal(h.ok, false);
  assert.equal(h.kode, 'KURANG_BAYAR');
});

test('dua bagian NON-TUNAI yang persis menutup tagihan diterima', async () => {
  const { rencanakanPembayaran } = await import(MOD);
  const h = rencanakanPembayaran(
    rencana(50_000n, [
      { metode: 'qris_static', nominal: 30_000n },
      { metode: 'card_edc', nominal: 20_000n },
    ])
  );
  assert.equal(h.ok, true);
  assert.equal(h.rencana.amountDue, 50_000n);
  // ⛔ Tanpa tunai TIDAK ADA pembulatan sama sekali — bukan "nol karena
  // kebetulan". Tidak ada lembaran yang perlu dibulatkan.
  assert.equal(h.rencana.roundingAdjustment, 0n);
  assert.deepEqual(h.rencana.nominalBagian, [30_000n, 20_000n]);
});

test('⛔ tanpa tunai, total berpecahan TIDAK dibulatkan', async () => {
  const { rencanakanPembayaran } = await import(MOD);
  const h = rencanakanPembayaran(rencana(93_555n, [{ metode: 'qris_static', nominal: 93_555n }]));
  assert.equal(h.ok, true);
  assert.equal(h.rencana.amountDue, 93_555n);
  assert.equal(h.rencana.roundingAdjustment, 0n);
});

test('uang tunai kurang dari sisa yang dibulatkan ditolak', async () => {
  const { rencanakanPembayaran } = await import(MOD);
  const h = rencanakanPembayaran(
    rencana(93_555n, [
      { metode: 'qris_static', nominal: 50_000n },
      { metode: 'cash', tendered: 43_500n },
    ])
  );
  assert.equal(h.ok, false);
  assert.equal(h.kode, 'KURANG_BAYAR');
  // Kurangnya dihitung dari 43.600, bukan dari 43.555.
  assert.match(h.pesan, /100/);
});

test('⛔ hanya SATU bagian tunai per transaksi', async () => {
  const { rencanakanPembayaran } = await import(MOD);
  // Dua baris tunai tidak menambah informasi apa pun — uang tunai tidak punya
  // identitas yang membedakan — sementara "berapa kembaliannya" jadi punya
  // lebih dari satu jawaban yang sama benarnya.
  const h = rencanakanPembayaran(
    rencana(50_000n, [
      { metode: 'cash', tendered: 30_000n },
      { metode: 'cash', tendered: 30_000n },
    ])
  );
  assert.equal(h.ok, false);
  assert.equal(h.kode, 'BANYAK_TUNAI');
});

test('nominal non-tunai nol atau negatif ditolak', async () => {
  const { rencanakanPembayaran } = await import(MOD);
  for (const nominal of [0n, -1n, undefined]) {
    const h = rencanakanPembayaran(rencana(50_000n, [{ metode: 'qris_static', nominal }]));
    assert.equal(h.ok, false, `nominal ${nominal} diterima`);
    assert.equal(h.kode, 'NOMINAL_TIDAK_SAH');
  }
});

test('tanpa satu pun bagian: ditolak, bukan dianggap lunas', async () => {
  const { rencanakanPembayaran } = await import(MOD);
  const h = rencanakanPembayaran(rencana(50_000n, []));
  assert.equal(h.ok, false);
  assert.equal(h.kode, 'TANPA_PEMBAYARAN');
});

test('sisa tagihan terhitung meski masukannya belum lengkap', async () => {
  const { sisaTagihan } = await import(MOD);
  // AC FR-C1 kedua menuntut sisa tagihan TERLIHAT, dan kasir paling
  // membutuhkannya justru saat masukannya belum lengkap.
  assert.equal(sisaTagihan(50_000n, []), 50_000n);
  assert.equal(sisaTagihan(50_000n, [{ metode: 'qris_static', nominal: 30_000n }]), 20_000n);
  // Bagian tunai tidak mengurangi sisa: nominalnya justru DITURUNKAN dari sisa.
  assert.equal(sisaTagihan(50_000n, [{ metode: 'cash', tendered: 50_000n }]), 50_000n);
  // Tidak pernah negatif — angka merah di layar untuk keadaan yang sudah
  // ditolak di tempat lain hanya membingungkan.
  assert.equal(sisaTagihan(50_000n, [{ metode: 'qris_static', nominal: 80_000n }]), 0n);
});
