import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MINGGU_PEMBANDING,
  MINIMUM_HARI_PEMBANDING,
  rataRataPerTransaksi,
  tanggalPembanding,
  trenHarian,
} from '../../packages/domain/src/tren-harian.ts';

/**
 * FR-G6 — delta omzet harian.
 *
 * ⛔ Yang paling penting diuji: pembandingnya HARI YANG SAMA. Delta terhadap
 * hari sebelumnya membuat setiap Senin terlihat seperti bencana dan setiap
 * Jumat seperti rekor — dua sinyal palsu setiap minggu, selamanya.
 */

const hari = (tanggal, omzet) => ({ tanggal, omzet });

// ---------------------------------------------------------------------------

test('⛔ pembandingnya HARI YANG SAMA, tujuh hari kelipatan ke belakang', async () => {
  // 24 Agustus 2026 adalah Senin. Keempat pembandingnya harus Senin juga.
  const t = tanggalPembanding('2026-08-24');
  assert.deepEqual(t, ['2026-08-17', '2026-08-10', '2026-08-03', '2026-07-27']);
  for (const tgl of t) {
    assert.equal(
      new Date(`${tgl}T00:00:00Z`).getUTCDay(),
      new Date('2026-08-24T00:00:00Z').getUTCDay(),
      `${tgl} bukan hari yang sama`
    );
  }
});

test('pembanding menyeberangi batas bulan dan tahun dengan benar', () => {
  assert.deepEqual(tanggalPembanding('2027-01-04'), [
    '2026-12-28',
    '2026-12-21',
    '2026-12-14',
    '2026-12-07',
  ]);
});

test('tanggal tidak sah DILEMPAR, tidak menghasilkan NaN diam-diam', () => {
  // Tanggal yang salah bentuk menghasilkan `Invalid Date`, dan aritmetika
  // atasnya menghasilkan string "NaN-NaN-NaN" tanpa satu pun error.
  assert.throws(() => tanggalPembanding('bukan-tanggal'), TypeError);
});

test('⛔ delta null bila belum ada cukup hari pembanding', () => {
  // Merchant yang baru dua minggu berjualan tidak punya empat Senin
  // sebelumnya. "0%" untuknya adalah pernyataan yang SALAH — ia mengaku omzet
  // hari ini persis sama dengan kebiasaannya, dan kebiasaan itu belum ada.
  const kosong = trenHarian(1_000_000n, []);
  assert.equal(kosong.deltaPersen, null);
  assert.equal(kosong.rataRata, null);
  assert.equal(kosong.basisMinggu, 0);

  const satu = trenHarian(1_000_000n, [hari('2026-08-17', 900_000n)]);
  assert.equal(satu.deltaPersen, null, `minimum ${MINIMUM_HARI_PEMBANDING} hari`);
});

test('dua hari pembanding sudah cukup, dan basisnya dinyatakan', () => {
  const t = trenHarian(1_100_000n, [
    hari('2026-08-17', 1_000_000n),
    hari('2026-08-10', 1_000_000n),
  ]);
  assert.equal(t.deltaPersen, 10);
  assert.equal(t.arah, 'naik');
  assert.equal(t.basisMinggu, 2, 'layar harus dapat menyatakan seberapa kasar pembandingnya');
});

test('delta dihitung dari RATA-RATA, bukan dari yang terakhir', () => {
  // Rata-rata 1.000.000; minggu terakhir 1.900.000. Kalau yang dipakai minggu
  // terakhir, deltanya −47% alih-alih 0%.
  const t = trenHarian(1_000_000n, [
    hari('2026-08-17', 1_900_000n),
    hari('2026-08-10', 900_000n),
    hari('2026-08-03', 600_000n),
    hari('2026-07-27', 600_000n),
  ]);
  assert.equal(t.rataRata, 1_000_000n);
  assert.equal(t.deltaPersen, 0);
  assert.equal(t.arah, 'datar');
});

test('⛔ hanya EMPAT minggu yang dipakai, meski diberi lebih', () => {
  const banyak = Array.from({ length: 10 }, (_, i) => hari(`2026-0${i}-01`, 1_000_000n));
  banyak[0] = hari('2026-08-17', 1_000_000n);
  const t = trenHarian(1_000_000n, banyak);
  assert.equal(t.basisMinggu, MINGGU_PEMBANDING);
});

test('⛔ rata-rata NOL menghasilkan null, bukan pembagian dengan nol', () => {
  // Merchant yang empat Senin sebelumnya benar-benar nol tidak punya kebiasaan
  // untuk dibandingkan. "Naik tak hingga" bukan jawaban.
  const t = trenHarian(1_000_000n, [
    hari('2026-08-17', 0n),
    hari('2026-08-10', 0n),
    hari('2026-08-03', 0n),
  ]);
  assert.equal(t.deltaPersen, null);
  assert.equal(t.rataRata, 0n, 'rata-ratanya tetap dilaporkan — ia fakta');
  assert.equal(Number.isFinite(t.deltaPersen ?? 0), true);
});

test('⛔ hari yang TIDAK ADA tidak dihitung nol', () => {
  // Outlet yang tutup pada satu Senin tidak punya baris untuk hari itu.
  // Memperlakukannya sebagai omzet nol menyeret rata-rata ke bawah — lalu
  // Senin berikutnya terlihat naik 40% karena outletnya kebetulan buka.
  const tigaHari = trenHarian(1_000_000n, [
    hari('2026-08-17', 1_000_000n),
    hari('2026-08-10', 1_000_000n),
    hari('2026-08-03', 1_000_000n),
  ]);
  assert.equal(tigaHari.rataRata, 1_000_000n, 'hari keempat yang hilang tidak menyeret rata-rata');
  assert.equal(tigaHari.deltaPersen, 0);
  assert.equal(tigaHari.basisMinggu, 3);
});

test('⛔ omzet NEGATIF ditangani, tidak di-clamp', () => {
  // Omzet bersih boleh negatif (`spec-g:283`) — hari yang refundnya melebihi
  // penjualannya. Menjepitnya ke nol menyembunyikan hari yang paling perlu
  // dilihat owner pukul 23:00.
  const t = trenHarian(-500_000n, [
    hari('2026-08-17', 1_000_000n),
    hari('2026-08-10', 1_000_000n),
  ]);
  assert.equal(t.arah, 'turun');
  assert.equal(t.deltaPersen, -150);
});

test('arah `datar` HANYA untuk selisih nol', () => {
  // Ambang "kekecilan" adalah angka yang harus dipilih seseorang, dan tidak
  // ada di dokumen mana pun — jadi ia tidak dikarang di kode.
  const sedikit = trenHarian(1_000_001n, [
    hari('2026-08-17', 1_000_000n),
    hari('2026-08-10', 1_000_000n),
  ]);
  assert.equal(sedikit.arah, 'naik');
  const persis = trenHarian(1_000_000n, [
    hari('2026-08-17', 1_000_000n),
    hari('2026-08-10', 1_000_000n),
  ]);
  assert.equal(persis.arah, 'datar');
});

test('property: arah SELALU sepakat dengan tanda deltaPersen', () => {
  for (let n = -3_000_000; n <= 3_000_000; n += 137_777) {
    const t = trenHarian(BigInt(n), [
      hari('a', 1_000_000n),
      hari('b', 1_000_000n),
    ]);
    if (t.deltaPersen === null) continue;
    if (t.deltaPersen > 0) assert.equal(t.arah, 'naik', String(n));
    else if (t.deltaPersen < 0) assert.equal(t.arah, 'turun', String(n));
    else assert.equal(t.arah, 'datar', String(n));
  }
});

// ---------------------------------------------------------------------------

test('⛔ rata-rata per transaksi null untuk NOL transaksi', () => {
  // "Rp 0 per transaksi" mengaku ada transaksi yang nilainya nol; yang benar
  // adalah belum ada transaksi sama sekali.
  assert.equal(rataRataPerTransaksi(0n, 0), null);
  assert.equal(rataRataPerTransaksi(1_000_000n, 0), null);
  assert.equal(rataRataPerTransaksi(1_000_000n, -1), null);
  assert.equal(rataRataPerTransaksi(1_000_000n, 1.5), null);
});

test('rata-rata per transaksi memotong, dan tetap bigint', () => {
  const r = rataRataPerTransaksi(12_450_000n, 187);
  assert.equal(typeof r, 'bigint', 'uang tidak pernah float');
  assert.equal(r, 66_577n, '12.450.000 / 187 = 66.577,54 → dipotong');
});
