import test from 'node:test';
import assert from 'node:assert/strict';

import {
  METODE_BUTUH_ONLINE,
  alasanNonaktif,
  butuhOnline,
  metodeTersedia,
} from '../../packages/domain/src/pembayaran-manual.ts';

/**
 * FR-C3 — metode online-only dinonaktifkan saat offline.
 *
 * Aturannya di domain supaya layar dan (kelak) server memutuskan hal yang
 * sama. Layar yang memakai daftarnya sendiri akan menyalakan metode yang
 * server tolak, dan kasir menemukannya di depan pelanggan.
 */

const SEMUA = ['cash', 'qris_static', 'card_edc', 'qris_dynamic'];

test('⛔ hanya QRIS DINAMIS yang butuh online', () => {
  // QRIS statis juga digital dan tetap berfungsi offline: QR-nya dicetak
  // merchant dan yang mengonfirmasi adalah orang. Yang membuat dinamis berbeda
  // adalah `spec-c:320` — lunas menuntut konfirmasi GATEWAY.
  assert.deepEqual([...METODE_BUTUH_ONLINE], ['qris_dynamic']);
  assert.equal(butuhOnline('qris_dynamic'), true);
  for (const m of ['cash', 'qris_static', 'card_edc']) {
    assert.equal(butuhOnline(m), false, m);
  }
});

test('⛔ metode yang TIDAK dikenal dianggap berfungsi offline', () => {
  // Daftarnya POSITIF, dan itu yang membuat metode berikutnya gagal ke arah
  // yang benar. Daftar negatif akan membuat metode baru diam-diam hilang dari
  // layar setiap kali Wi-Fi mati.
  assert.equal(butuhOnline('metode_yang_belum_ada'), false);
  assert.equal(metodeTersedia('metode_yang_belum_ada', 'tidak'), true);
});

test('saat terjangkau, SELURUH metode tersedia', () => {
  for (const m of SEMUA) {
    assert.equal(metodeTersedia(m, 'terjangkau'), true, m);
    assert.equal(alasanNonaktif(m, 'terjangkau'), null, m);
  }
});

test('⛔ saat TIDAK terjangkau, hanya QRIS dinamis yang mati', () => {
  // `spec-c:273`: "metode tunai, QRIS statis, kartu (EDC), dan lainnya tetap
  // aktif". Offline adalah keadaan NORMAL untuk produk ini; mematikan lebih
  // dari yang perlu berarti menghentikan penjualan.
  assert.equal(metodeTersedia('qris_dynamic', 'tidak'), false);
  for (const m of ['cash', 'qris_static', 'card_edc']) {
    assert.equal(metodeTersedia(m, 'tidak'), true, m);
  }
});

test('⛔ "memeriksa" diperlakukan sebagai TIDAK terjangkau', () => {
  // `spec-c:272`: tidak ada jalur yang memungkinkan kasir memilih QRIS dinamis
  // saat offline lalu gagal. Selama jendela pemeriksaan, jawabannya belum
  // diketahui — dan salah ke arah aman di sana tidak menghilangkan satu pun
  // penjualan, karena metode lain tetap aktif.
  assert.equal(metodeTersedia('qris_dynamic', 'memeriksa'), false);
  assert.equal(metodeTersedia('cash', 'memeriksa'), true);
});

test('⛔ metode nonaktif SELALU membawa alasan yang terbaca', () => {
  // `spec-c:271` menuntut teksnya, dan aturan design system #5 menuntut status
  // tidak pernah warna saja. Tombol yang mati tanpa penjelasan adalah tombol
  // yang kasir simpulkan rusak.
  for (const jangkauan of ['tidak', 'memeriksa']) {
    const alasan = alasanNonaktif('qris_dynamic', jangkauan);
    assert.equal(typeof alasan, 'string', jangkauan);
    assert.notEqual(alasan.trim(), '', jangkauan);
  }
  assert.match(alasanNonaktif('qris_dynamic', 'tidak'), /internet/i);
});

test('⛔ alasan MEMBEDAKAN "belum tahu" dari "pasti tidak"', () => {
  // Keduanya membuat tombolnya mati, dan keduanya berarti hal yang berbeda
  // bagi kasir: yang pertama akan berubah sendiri dalam hitungan detik, yang
  // kedua menuntut ia melakukan sesuatu (atau memakai metode lain).
  assert.notEqual(
    alasanNonaktif('qris_dynamic', 'memeriksa'),
    alasanNonaktif('qris_dynamic', 'tidak')
  );
});

test('property: metode non-online tidak pernah punya alasan, apa pun jangkauannya', () => {
  for (const m of ['cash', 'qris_static', 'card_edc']) {
    for (const j of ['terjangkau', 'tidak', 'memeriksa', 'entah']) {
      assert.equal(alasanNonaktif(m, j), null, `${m}/${j}`);
    }
  }
});
