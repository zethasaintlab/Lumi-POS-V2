'use strict';

// ⛔ ALAT YANG MEMBUAT TENANT-NYA SENDIRI TIDAK BOLEH MEMINTA DATABASE
// MENEBAK TENANT ITU KEMBALI.
//
// ## Kejadian yang melahirkannya, 11 September 2026
//
// `npm run seed:explore` mati di run KEDUA:
//
//     tenant + outlet + owner : 201
//     Error: login gagal: 401 {"code":"INVALID_CREDENTIALS", ...}
//
// Rantainya, dan tidak satu pun mata rantainya adalah bug:
//
// 1. Seed memakai email TETAP (`owner@lumipos.test`) kecuali diberi `--unik`.
//    Run kedua karena itu membuat tenant KEDUA dengan email owner yang sama.
//    Tidak ada UNIQUE global pada `"user".email` — dan tidak dapat ada tanpa
//    melanggar isolasi (migrasi `0023`), jadi ini SAH.
// 2. Sejak itu `resolve_login_tenant` menghitung dua baris dan mengembalikan
//    `NULL` — **sesuai rancangan**: "Email ganda lintas tenant → NULL, bukan
//    tebakan". Menebak berarti memasukkan orang ke tenant yang SALAH dengan
//    password yang BENAR, tanpa satu pun error.
// 3. Seed login TANPA `x-tenant-id` di langkah 2, menerima 401, lalu mati —
//    meninggalkan tenant kedua setengah jadi.
//
// ⛔ Yang salah adalah langkah 3, dan hanya langkah 3. Seed **memegang** id
// tenant yang baru saja ia buat sendiri; memintanya diresolusi ulang dari
// email adalah tebakan yang tidak perlu ia lakukan. Perbaikannya menghapus
// tebakan, bukan melonggarkan aturan yang menolak menebak.
//
// ## Kenapa penjaganya berbentuk begini
//
// Pesan 401-nya SATU untuk setiap sebab kegagalan (`spec-f:148`) — itu juga
// disengaja, dan akibatnya kegagalan ini terbaca sebagai "password salah".
// Sesi sebelumnya benar-benar salah membacanya begitu, lalu mencatat "password
// seed tidak terverifikasi" sebagai cacat kedua yang sebenarnya tidak ada.
// Penjaga yang menunggu gejalanya karena itu tidak akan pernah menolong; yang
// menolong adalah yang menolak BENTUK panggilannya.
//
// Aturannya diturunkan, bukan didaftar: setiap pemanggilan `/auth/login` di
// `tools/` wajib menyertakan `x-tenant-id`. Tidak ada daftar nama berkas yang
// dapat diperpanjang orang berikutnya — alat berikutnya yang lahir diperiksa
// tanpa siapa pun mengingat penjaga ini ada.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const AKAR = path.resolve(__dirname, '..', '..');
const DIR_ALAT = path.join(AKAR, 'tools');

/** Setiap `.mjs`/`.js` di `tools/`, rekursif. */
function berkasAlat(dir = DIR_ALAT) {
  const hasil = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) hasil.push(...berkasAlat(p));
    else if (/\.m?js$/.test(e.name)) hasil.push(p);
  }
  return hasil;
}

/**
 * Potongan sumber untuk setiap pemanggilan `fetch(... /auth/login ...)`,
 * sampai kurung tutup panggilannya.
 *
 * ⛔ Dipotong dari posisi `fetch`, bukan per baris: muatan dan header sebuah
 * `fetch` tersebar di belasan baris, dan penjaga yang hanya melihat baris
 * ber-`auth/login` tidak pernah melihat headernya sama sekali — ia akan
 * MERAH selamanya, lalu dimatikan.
 */
function panggilanLogin(sumber) {
  const hasil = [];
  const pola = /fetch\s*\(/g;
  for (const m of sumber.matchAll(pola)) {
    let i = m.index + m[0].length;
    let dalam = 1;
    while (i < sumber.length && dalam > 0) {
      if (sumber[i] === '(') dalam += 1;
      else if (sumber[i] === ')') dalam -= 1;
      i += 1;
    }
    const potongan = sumber.slice(m.index, i);
    if (/\/auth\/login/.test(potongan)) hasil.push(potongan);
  }
  return hasil;
}

test('⛔ alat di tools/ tidak login tanpa tenant yang sudah ia pegang', () => {
  const berkas = berkasAlat();
  // Sentinel: penjaga yang memindai NOL berkas hijau selamanya, dan hijaunya
  // adalah bentuk kekosongan yang sama dengan yang `KELAS-GAGAL.md` catat.
  assert.ok(berkas.length > 3, `pemindai hanya melihat ${berkas.length} berkas di tools/`);

  const salah = [];
  let dilihat = 0;
  for (const f of berkas) {
    const sumber = fs.readFileSync(f, 'utf8');
    for (const panggilan of panggilanLogin(sumber)) {
      dilihat += 1;
      if (!/['"]x-tenant-id['"]\s*:/i.test(panggilan)) {
        salah.push(path.relative(AKAR, f));
      }
    }
  }

  // Sentinel kedua: kalau tidak ada satu pun panggilan login ditemukan,
  // assertion di bawah lulus tanpa memeriksa apa pun.
  assert.ok(dilihat > 0, 'tidak ada pemanggilan /auth/login ditemukan — apakah polanya berubah?');

  assert.deepEqual(
    salah,
    [],
    'Alat ini login tanpa `x-tenant-id` padahal ia SENDIRI yang membuat ' +
      'tenantnya:\n  ' +
      salah.join('\n  ') +
      '\n\nResolusi dari email mengembalikan NULL begitu email itu ada di dua ' +
      'tenant — keadaan yang alat ini ciptakan sendiri pada run keduanya. ' +
      'Kirim id tenant yang sudah kamu pegang; jangan minta database menebaknya.'
  );
});
