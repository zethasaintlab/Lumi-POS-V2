'use strict';

const { TABLES, EXEMPT } = require('./tables');

/**
 * ⛔ `lock_timeout`, dan ia bukan kerapian — ia mengubah HANG menjadi KEGAGALAN.
 *
 * `TRUNCATE` menuntut `ACCESS EXCLUSIVE` pada SETIAP tabel yang disebut. Kalau
 * ada satu koneksi lain yang menahan lock — dan pola `BEGIN` ... `COMMIT` di
 * berkas test ini banyak dipakai, sehingga assertion yang gagal DI ANTARA
 * keduanya meninggalkan koneksi "idle in transaction" — maka `beforeEach`
 * berikutnya menunggu lock itu SELAMANYA.
 *
 * Akibatnya bukan test merah melainkan job yang menggantung sampai batas waktu
 * CI: 21 Agustus 2026 suite `catalog` berhenti di sana selama ~55 menit
 * sementara 19 langkah sebelumnya hijau, dan tidak ada satu pun baris log yang
 * menyebut penyebabnya. Kegagalan sungguhan yang memicunya tidak pernah
 * terbaca siapa pun.
 *
 * Angkanya sama dengan yang dipakai setiap migrasi (`SET LOCAL lock_timeout =
 * '5s'`), dan alasannya juga sama: yang tidak bisa mendapat lock harus gagal
 * CEPAT, bukan memblokir.
 */
const LOCK_TIMEOUT = '5s';

// TRUNCATE is not subject to RLS at all (unlike ordinary DML) — FORCE ROW
// LEVEL SECURITY does not block it, so this is the correct tool for a full
// reset even though lumi_owner cannot bypass RLS for SELECT/INSERT/UPDATE/DELETE.
async function resetAll(ownerClient) {
  const names = [...TABLES.map((t) => t.name), ...EXEMPT];
  const quoted = names.map((n) => `"${n}"`).join(', ');

  // ⛔ `SET`, bukan `SET LOCAL`: `TRUNCATE` di bawah berjalan sebagai
  // pernyataan tunggal tanpa transaksi eksplisit, dan `SET LOCAL` di luar
  // transaksi tidak berlaku untuk pernyataan berikutnya.
  await ownerClient.query(`SET lock_timeout = '${LOCK_TIMEOUT}'`);
  try {
    await ownerClient.query(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
  } catch (err) {
    // Pesan bawaan PostgreSQL ("canceling statement due to lock timeout")
    // benar tapi tidak menyebut apa yang harus diperiksa. Yang membuat
    // seseorang menemukan penyebabnya adalah kalimat berikutnya.
    if (err && err.code === '55P03') {
      throw new Error(
        'resetAll: TRUNCATE tidak mendapat lock dalam ' + LOCK_TIMEOUT + '.\n' +
          'Ada koneksi lain yang menahan lock — hampir selalu sebuah test yang ' +
          'gagal DI ANTARA `BEGIN` dan `COMMIT`, sehingga koneksinya tertinggal ' +
          '"idle in transaction".\n' +
          'Cari test yang gagal SEBELUM ini di suite yang sama; kegagalan itu ' +
          'penyebabnya, dan yang ini hanya akibatnya.'
      );
    }
    throw err;
  }
}

module.exports = { resetAll };
