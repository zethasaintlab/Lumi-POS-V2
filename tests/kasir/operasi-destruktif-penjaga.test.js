'use strict';

// FR-H4 AC ketiga — "Blokir ditegakkan di lapisan domain, bukan hanya
// menyembunyikan tombol."
//
// ⛔ Penjaga STRUKTURAL, dan ia perlu ada karena bentuk pelanggarannya tidak
// menghasilkan error apa pun: layar baru yang menulis `device_config` atau
// menghapus `sesi_lokal` tanpa memeriksa antrean akan lolos seluruh test
// fungsional, lolos review, dan baru terlihat sebagai penjualan yang hilang
// di perangkat merchant.
//
// Ia memindai KODE, pola yang sama dengan `telemetri-batas-etis.test.js` dan
// penjaga satu-sumber omzet: lapisan ketiga yang menjaga hal yang tidak dapat
// dijaga tipe maupun test perilaku.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const AKAR = path.join(__dirname, '..', '..', 'apps', 'kasir', 'src');

function berkasSumber(dir = AKAR, hasil = []) {
  for (const entri of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entri.name);
    if (entri.isDirectory()) berkasSumber(p, hasil);
    else if (/\.tsx?$/.test(entri.name)) hasil.push(p);
  }
  return hasil;
}

const SUMBER = berkasSumber().map((p) => ({ p, isi: fs.readFileSync(p, 'utf8') }));

/** Berkas yang MENULIS identitas perangkat. */
const PENULIS_IDENTITAS = /simpanKonfigPerangkat\s*\(/;

/** Berkas yang menghapus sesi kasir. */
const PENGHAPUS_SESI = /DELETE FROM sesi_lokal/;

test('⛔ hanya SATU berkas yang menulis identitas perangkat', async () => {
  const { OPERASI_DESTRUKTIF } = await import('../../packages/domain/src/operasi-destruktif.ts');
  assert.ok(OPERASI_DESTRUKTIF.includes('ganti_identitas_perangkat'));

  const penulis = SUMBER.filter((f) => PENULIS_IDENTITAS.test(f.isi));
  assert.ok(penulis.length > 0, 'penjaga ini kehilangan sasarannya — tidak ada penulis identitas');

  // ⛔ Penjaga ini menuntut SATU pintu, bukan menuntut setiap pintu punya
  // pemeriksaannya sendiri. Versi pertamanya menuntut yang kedua, dan sabotase
  // membuktikan ia lolos saat pemanggilnya dihapus sementara import-nya
  // tertinggal — pemeriksaan yang dapat dipalsukan oleh satu baris import
  // bukan pemeriksaan. Yang menjaga perilakunya adalah
  // `tests/kasir/simpan-identitas.test.js`, yang benar-benar menjalankannya.
  assert.deepEqual(
    penulis.map((f) => path.relative(AKAR, f.p)),
    ['perangkat/simpan-identitas.ts'],
    'ada pintu KEDUA ke `device_config`. Satu-satunya penulis harus lewat ' +
      '`simpanIdentitasPerangkat`, yang memeriksa antrean lebih dulu (FR-H4).'
  );
});

test('⛔ setiap penghapus sesi memeriksa antrean lebih dulu', async () => {
  const penghapus = SUMBER.filter((f) => PENGHAPUS_SESI.test(f.isi));
  assert.ok(penghapus.length > 0, 'penjaga ini kehilangan sasarannya — tidak ada penghapus sesi');

  for (const f of penghapus) {
    assert.match(
      f.isi,
      /bolehLogout|periksaOperasiDestruktif/,
      `${path.relative(AKAR, f.p)} menghapus sesi kasir tanpa memeriksa antrean (FR-H4).`
    );
  }
});

test('⛔ pesan blokir tidak ditulis ulang di layar mana pun', async () => {
  // Kalimat yang disalin ke komponen akan menyimpang dari kalimat domain pada
  // perubahan berikutnya, dan yang menyimpang adalah yang lupa menyebut
  // jumlahnya — persis AC kedua yang gagal tanpa satu pun test merah.
  for (const f of SUMBER) {
    assert.equal(
      /belum terkirim ke server/.test(f.isi),
      false,
      `${path.relative(AKAR, f.p)} menyalin pesan blokir FR-H4. Pakai pesan dari ` +
        '`periksaOperasiDestruktif`, jangan menuliskannya ulang.'
    );
  }
});

test('⛔ operasi destruktif yang BELUM punya jalur di aplikasi tetap tercatat', async () => {
  const { OPERASI_DESTRUKTIF } = await import('../../packages/domain/src/operasi-destruktif.ts');
  // `resync` dan `hapus_data` belum punya tombol di mana pun — dan justru itu
  // sebabnya keduanya ada di daftar sekarang, bukan nanti. Aturan yang ditulis
  // bersamaan dengan tombolnya adalah aturan yang ditulis oleh orang yang
  // sedang terburu-buru membuat tombolnya jalan.
  for (const op of ['resync', 'hapus_data']) {
    assert.ok(OPERASI_DESTRUKTIF.includes(op), `${op} hilang dari daftar`);
    assert.equal(
      SUMBER.some((f) => f.isi.includes(`'${op}'`)),
      false,
      `${op} kini punya pemanggil di aplikasi — pastikan ia benar-benar diblokir, ` +
        'lalu hapus baris ini dari penjaga.'
    );
  }
});
