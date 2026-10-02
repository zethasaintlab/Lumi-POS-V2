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

test('property G-TRF-KAS: transfer + tunai menutup tagihan tepat; pembulatan hanya pada sisa tunai', async () => {
  const { rencanakanPembayaran } = await import(MOD);
  let kasus = 0;
  for (const total of [9_950n, 64_120n, 93_555n]) {
    for (const transfer of [0n, 1n, total / 2n, total - 1n, total]) {
      for (const increment of [1n, 100n, 500n]) {
        kasus += 1;
        const bagian = [];
        if (transfer > 0n) bagian.push({ metode: 'other', nominal: transfer });
        if (transfer < total) bagian.push({ metode: 'cash', tendered: total * 2n });
        const h = rencanakanPembayaran({
          total,
          bagian,
          roundingIncrement: increment,
          roundingMode: 'half_up',
        });
        const ket = `total=${total} transfer=${transfer} inc=${increment}`;
        assert.equal(h.ok, true, `rencana ditolak: ${ket}`);
        const r = h.rencana;
        assert.equal(r.amountDue, transfer + r.tunaiDitagih, `amountDue != transfer + tunai: ${ket}`);
        assert.equal(r.tunaiDitagih % increment, 0n, `tunai tidak kelipatan increment: ${ket}`);
        assert.equal(r.amountDue, total + r.roundingAdjustment, `amountDue != total + pembulatan: ${ket}`);
        if (transfer === total) {
          assert.equal(r.roundingAdjustment, 0n, `transfer penuh tidak boleh dibulatkan: ${ket}`);
          assert.equal(r.tunaiDitagih, 0n, ket);
        }
        // Pembulatan hanya pada SISA: selisihnya tidak lebih dari setengah increment.
        const mutlak = r.roundingAdjustment < 0n ? -r.roundingAdjustment : r.roundingAdjustment;
        assert.ok(mutlak * 2n <= increment, `pembulatan melebihi setengah increment: ${ket}`);
        // Nominal bagian transfer tidak disentuh pembulatan.
        if (transfer > 0n) assert.equal(r.nominalBagian[0], transfer, `bagian transfer berubah: ${ket}`);
      }
    }
  }
  assert.equal(kasus, 45, 'jumlah kasus enumerasi berubah — property menyempit diam-diam');
});

test('⛔ kelebihan bayar transfer ditolak', async () => {
  const { rencanakanPembayaran } = await import(MOD);
  const h = rencanakanPembayaran(rencana(50_000n, [{ metode: 'other', nominal: 60_000n }]));
  assert.equal(h.ok, false, 'transfer melebihi tagihan diterima');
  assert.equal(h.kode, 'KELEBIHAN_NON_TUNAI');
  // Tunai + transfer yang melebihi total juga ditolak.
  const h2 = rencanakanPembayaran(
    rencana(50_000n, [
      { metode: 'other', nominal: 50_001n },
      { metode: 'cash', tendered: 100_000n },
    ])
  );
  assert.equal(h2.ok, false);
  assert.equal(h2.kode, 'KELEBIHAN_NON_TUNAI');
});
