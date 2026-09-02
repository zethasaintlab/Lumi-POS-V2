'use strict';

// Batas gambar produk — aturan murni, DAN penjaga silang terhadap migrasi.
//
// ⛔ Penjaga silangnya yang paling penting: batas hidup di DUA tempat yang
// tidak ada apa pun menyatukannya — konstanta TypeScript yang klien dan server
// pakai, dan `CHECK` di `db/migrations/0036_item_image.sql`. Keduanya
// menyimpang tanpa satu pun error: klien mengompres ke 30 KB, database menerima
// 60 KB, dan anggaran unduhan armada diam-diam menjadi dua kali lipat.
//
// Round-trip byte-per-byte diuji terpisah di
// `tests/kasir/gambar-round-trip.test.js` — ia menuntut SQLite, bukan hanya
// aritmetika.
//
// Bentuk penjaga yang sama dengan sync-rules ↔ DDL dan `var(--x)` ↔ token.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modul = () => import('../../packages/domain/src/gambar-produk.ts');
const AKAR = path.resolve(__dirname, '..', '..');

/** Base64 sah yang hasil decode-nya TEPAT `n` byte. */
const b64 = (n) => Buffer.alloc(n, 0x41).toString('base64');

test('⛔ batas byte domain SAMA dengan CHECK di migrasi 0036', async () => {
  const { BATAS_BYTE } = await modul();
  const sql = fs.readFileSync(path.join(AKAR, 'db/migrations/0036_item_image.sql'), 'utf8');

  const m = /length\(data_base64\)\s*<=\s*(\d+)/.exec(sql);
  assert.ok(m, 'CHECK batas base64 tidak ditemukan di migrasi — apakah ia dihapus?');
  assert.equal(
    Number(m[1]),
    4 * Math.ceil(BATAS_BYTE / 3),
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
    base64: b64(BATAS_BYTE - 3),
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
  assert.equal(periksaGambar({ mime: MIME_SIMPAN, base64: b64(BATAS_BYTE) }).ok, true);
  assert.equal(
    periksaGambar({ mime: MIME_SIMPAN, base64: b64(BATAS_BYTE + 3) }).kode,
    'TERLALU_BESAR'
  );
});

test('⛔ KOSONG diperiksa SEBELUM batas atas', async () => {
  const { periksaGambar, MIME_SIMPAN } = await modul();
  // Nol byte lolos `<= BATAS` dengan mudah lalu tersimpan sebagai baris yang
  // ADA tetapi tidak dapat dirender — kartu yang gambarnya gagal muat, tanpa
  // satu pun error, dan tanpa keadaan "tanpa gambar" yang punya bentuknya
  // sendiri.
  assert.equal(periksaGambar({ mime: MIME_SIMPAN, base64: '' }).kode, 'KOSONG');
  // ⛔ Dan base64 CACAT dibedakan dari kosong: yang pertama menuntut merchant
  // mengunggah ulang, yang kedua berarti berkasnya memang kosong.
  assert.equal(
    periksaGambar({ mime: MIME_SIMPAN, base64: 'bukan base64!!' }).kode,
    'BASE64_TIDAK_SAH'
  );
});

test('mime selain WebP ditolak, termasuk sumber yang sah', async () => {
  const { periksaGambar, MIME_SUMBER } = await modul();
  // JPEG/PNG SAH sebagai yang merchant pilih, dan TIDAK sah sebagai yang
  // tersimpan: yang tersimpan selalu hasil kanvas. Meneruskannya apa adanya
  // berarti berkas 8 MB dari kamera ponsel lolos ke setiap perangkat.
  for (const m of MIME_SUMBER) {
    if (m === 'image/webp') continue;
    assert.equal(periksaGambar({ mime: m, base64: b64(999) }).kode, 'MIME_TIDAK_DIDUKUNG');
  }
});

test('dimensi diperiksa HANYA bila disebutkan', async () => {
  const { periksaGambar, MIME_SIMPAN, SISI_PIKSEL } = await modul();
  // Server tidak men-decode gambar (nol dependensi native), jadi dimensinya
  // datang dari klien. Ketiadaannya bukan kegagalan; yang salah adalah.
  assert.equal(periksaGambar({ mime: MIME_SIMPAN, base64: b64(999) }).ok, true);
  assert.equal(
    periksaGambar({ mime: MIME_SIMPAN, base64: b64(999), lebar: 800, tinggi: 800 }).kode,
    'DIMENSI_SALAH'
  );
  assert.equal(
    periksaGambar({
      mime: MIME_SIMPAN,
      base64: b64(999),
      lebar: SISI_PIKSEL,
      tinggi: SISI_PIKSEL,
    }).ok,
    true
  );
});

test('pesan galat menyebut apa yang harus merchant LAKUKAN', async () => {
  const { periksaGambar, MIME_SIMPAN, BATAS_BYTE } = await modul();
  const p = periksaGambar({ mime: MIME_SIMPAN, base64: b64(BATAS_BYTE * 2) }).pesan;
  // Pesan yang hanya menyebut kodenya membuat merchant menelepon support.
  assert.match(p, /KB/, 'pesan tidak menyebut ukurannya');
  assert.match(p, /latar|potong/i, 'pesan tidak menyebut apa yang harus dilakukan');
});

test('⛔ anggaran dihitung dari BATAS BASE64, bukan dari byte mentah', async () => {
  const { anggaranByte, anggaranTampil, BATAS_BASE64 } = await modul();
  // ⛔ Yang MELINTAS jaringan adalah teksnya. Memakai `BATAS_BYTE` di sini
  // melaporkan anggaran 25% lebih kecil daripada yang merchant benar-benar
  // unduh — dan angka yang terlalu kecil adalah yang membuat seseorang
  // menyetujui fitur yang tidak akan ia setujui.
  assert.equal(anggaranByte(500), BATAS_BASE64 * 500);
  // 40 KB × 500 = 19,5 MB — di bawah ambang ~20 MB yang user tetapkan.
  assert.equal(anggaranTampil(500), '19,5 MB');
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
