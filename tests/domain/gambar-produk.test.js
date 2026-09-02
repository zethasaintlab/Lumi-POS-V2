'use strict';

// Batas gambar produk — aturan murni, DAN penjaga silang terhadap migrasi.
//
// ⛔ Penjaga silangnya yang paling penting: batas byte hidup di DUA tempat
// yang tidak ada apa pun menyatukannya — konstanta TypeScript yang klien dan
// server pakai, dan `CHECK` di `db/migrations/0036_item_image.sql`. Keduanya
// menyimpang tanpa satu pun error: klien mengompres ke 32 KB, database menerima
// 64 KB, dan anggaran unduhan armada diam-diam menjadi dua kali lipat.
//
// Bentuk penjaga yang sama dengan sync-rules ↔ DDL dan `var(--x)` ↔ token.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modul = () => import('../../packages/domain/src/gambar-produk.ts');
const AKAR = path.resolve(__dirname, '..', '..');

test('⛔ batas byte domain SAMA dengan CHECK di migrasi 0036', async () => {
  const { BATAS_BYTE } = await modul();
  const sql = fs.readFileSync(path.join(AKAR, 'db/migrations/0036_item_image.sql'), 'utf8');

  const m = /octet_length\(bytes\)\s*<=\s*(\d+)/.exec(sql);
  assert.ok(m, 'CHECK batas byte tidak ditemukan di migrasi — apakah ia dihapus?');
  assert.equal(
    Number(m[1]),
    BATAS_BYTE,
    'Batas di database berbeda dari batas di domain. Yang lebih longgar menang ' +
      'diam-diam, dan anggaran unduhan setiap perangkat di armada ikut naik.'
  );
});

test('⛔ mime yang database terima SAMA dengan yang domain simpan', async () => {
  const { MIME_SIMPAN } = await modul();
  const sql = fs.readFileSync(path.join(AKAR, 'db/migrations/0036_item_image.sql'), 'utf8');
  assert.ok(
    new RegExp(`mime = '${MIME_SIMPAN}'`).test(sql),
    `migrasi tidak membatasi mime ke ${MIME_SIMPAN}`
  );
});

test('gambar sah diterima', async () => {
  const { periksaGambar, MIME_SIMPAN, BATAS_BYTE, SISI_PIKSEL } = await modul();
  const h = periksaGambar({
    mime: MIME_SIMPAN,
    byte: BATAS_BYTE - 1,
    lebar: SISI_PIKSEL,
    tinggi: SISI_PIKSEL,
  });
  assert.equal(h.ok, true);
  assert.equal(h.kode, null);
});

test('⛔ batasnya INKLUSIF — tepat di batas diterima', async () => {
  const { periksaGambar, MIME_SIMPAN, BATAS_BYTE } = await modul();
  // Klien mengompres SAMPAI muat, jadi hasil yang tepat menyentuh batas adalah
  // keadaan normal, bukan tepian. Batas eksklusif menolak kompresi yang
  // berhasil sempurna.
  assert.equal(periksaGambar({ mime: MIME_SIMPAN, byte: BATAS_BYTE }).ok, true);
  assert.equal(periksaGambar({ mime: MIME_SIMPAN, byte: BATAS_BYTE + 1 }).kode, 'TERLALU_BESAR');
});

test('⛔ KOSONG diperiksa SEBELUM batas atas', async () => {
  const { periksaGambar, MIME_SIMPAN } = await modul();
  // Nol byte lolos `<= BATAS` dengan mudah lalu tersimpan sebagai baris yang
  // ADA tetapi tidak dapat dirender — kartu yang gambarnya gagal muat, tanpa
  // satu pun error, dan tanpa keadaan "tanpa gambar" yang punya bentuknya
  // sendiri.
  assert.equal(periksaGambar({ mime: MIME_SIMPAN, byte: 0 }).kode, 'KOSONG');
  assert.equal(periksaGambar({ mime: MIME_SIMPAN, byte: -5 }).kode, 'KOSONG');
});

test('mime selain WebP ditolak, termasuk sumber yang sah', async () => {
  const { periksaGambar, MIME_SUMBER } = await modul();
  // JPEG/PNG SAH sebagai yang merchant pilih, dan TIDAK sah sebagai yang
  // tersimpan: yang tersimpan selalu hasil kanvas. Meneruskannya apa adanya
  // berarti berkas 8 MB dari kamera ponsel lolos ke setiap perangkat.
  for (const m of MIME_SUMBER) {
    if (m === 'image/webp') continue;
    assert.equal(periksaGambar({ mime: m, byte: 1000 }).kode, 'MIME_TIDAK_DIDUKUNG');
  }
});

test('dimensi diperiksa HANYA bila disebutkan', async () => {
  const { periksaGambar, MIME_SIMPAN, SISI_PIKSEL } = await modul();
  // Server tidak men-decode gambar (nol dependensi native), jadi dimensinya
  // datang dari klien. Ketiadaannya bukan kegagalan; yang salah adalah.
  assert.equal(periksaGambar({ mime: MIME_SIMPAN, byte: 1000 }).ok, true);
  assert.equal(
    periksaGambar({ mime: MIME_SIMPAN, byte: 1000, lebar: 800, tinggi: 800 }).kode,
    'DIMENSI_SALAH'
  );
  assert.equal(
    periksaGambar({ mime: MIME_SIMPAN, byte: 1000, lebar: SISI_PIKSEL, tinggi: SISI_PIKSEL }).ok,
    true
  );
});

test('pesan galat menyebut apa yang harus merchant LAKUKAN', async () => {
  const { periksaGambar, MIME_SIMPAN, BATAS_BYTE } = await modul();
  const p = periksaGambar({ mime: MIME_SIMPAN, byte: BATAS_BYTE * 2 }).pesan;
  // Pesan yang hanya menyebut kodenya membuat merchant menelepon support.
  assert.match(p, /KB/, 'pesan tidak menyebut ukurannya');
  assert.match(p, /latar|potong/i, 'pesan tidak menyebut apa yang harus dilakukan');
});

test('⛔ anggaran dihitung dari BATAS, bukan dari gambar yang sudah ada', async () => {
  const { anggaranByte, anggaranTampil, BATAS_BYTE } = await modul();
  assert.equal(anggaranByte(500), BATAS_BYTE * 500);
  // 32 KB × 500 = 15,6 MB — angka yang `docs/verifikasi/GAMBAR-ANGGARAN.md`
  // laporkan, dan yang menjaga fitur ini di bawah ambang ~20 MB.
  assert.equal(anggaranTampil(500), '15,6 MB');
  assert.equal(anggaranByte(0), 0, 'merchant tanpa gambar mengunduh nol byte');
  assert.equal(anggaranByte(-3), 0);
});

test('tangga kualitas menurun dan berhenti sebelum artefak blok', async () => {
  const { KUALITAS_TURUN_PERSEN } = await modul();
  for (let i = 1; i < KUALITAS_TURUN_PERSEN.length; i += 1) {
    assert.ok(KUALITAS_TURUN_PERSEN[i] < KUALITAS_TURUN_PERSEN[i - 1], 'tangga tidak menurun');
  }
  // ⛔ PERSEN bilangan bulat: pecahan 0..1 di `packages/domain` BERBENTUK tarif
  // pajak, dan penjaga invariant #7 menandainya — dengan benar, karena ia tidak
  // dapat tahu ini kualitas WebP. Yang salah adalah menambahkan pengecualian.
  assert.ok(
    KUALITAS_TURUN_PERSEN.at(-1) >= 50,
    'di bawah 0,5 WebP menghasilkan artefak blok yang terlihat sebagai KOTOR ' +
      'pada foto makanan — dan gambar yang membuat produk terlihat buruk lebih ' +
      'merugikan daripada kartu tanpa gambar'
  );
});
