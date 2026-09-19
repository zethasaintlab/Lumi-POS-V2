'use strict';

// ⛔ ROUND-TRIP gambar: PostgreSQL → transport → SQLite lokal → dibaca kembali.
//
// ## Kenapa test ini ada, dan kenapa ia murah sekarang
//
// User menuntutnya sebagai syarat sebelum UI apa pun, dengan alasan yang
// tepat: kalau byte-nya rusak di perangkat, yang muncul adalah kartu tanpa
// gambar — **tidak dapat dibedakan dari item yang memang belum punya gambar**.
// Kekosongan yang menyamar.
//
// Versi `bytea` menuntut PowerSync sungguhan untuk diukur, dan image-nya tidak
// dapat ditarik di lingkungan ini. Versi base64 tidak menuntutnya sama sekali:
// yang melintas adalah TEKS, dan teks yang melintas jalur teks tidak punya
// representasi kedua yang harus ditebak.
//
// Itulah keuntungan sebenarnya dari pencabutan `bytea` — bukan "lebih aman",
// melainkan **dapat diuji tanpa menjalankan seluruh stack**.
//
// ## Yang diuji
//
// 1. Byte yang biasanya merusak jalur teks: `0x00`, `0xFF`, dan urutan yang
//    BUKAN UTF-8 valid.
// 2. Identik BYTE PER BYTE, bukan "ada isinya". Plus panjangnya.
// 3. Kerusakan yang DISENGAJA harus TERDETEKSI — bukan lolos diam-diam.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');

const modul = () => import('../../packages/domain/src/gambar-produk.ts');

/**
 * Muatan uji.
 *
 * ⛔ Bukan string acak: setiap byte di sini dipilih karena ia merusak jalur
 * teks dengan cara yang BERBEDA.
 */
const MUATAN = Buffer.from([
  0x52, 0x49, 0x46, 0x46, // "RIFF" — header WebP sungguhan
  0x00, // NUL: pemotong string di C, dan pemisah di banyak protokol
  0xff, 0xfe, // BOM terbalik / bukan awal urutan UTF-8 yang sah
  0x80, // byte lanjutan tanpa byte awal
  0xc3, 0x28, // byte awal 2-oktet diikuti yang BUKAN lanjutan
  0xed, 0xa0, 0x80, // surrogate UTF-16 yang disandikan UTF-8 — dilarang
  0x00, 0x7f,
  0xf4, 0x90, 0x80, 0x80, // di atas U+10FFFF
]);

function dbLokal() {
  const db = new DatabaseSync(':memory:');
  // Bentuknya PERSIS `db/local/001-initial.sql`.
  db.exec(`CREATE TABLE item_image (
    item_id TEXT PRIMARY KEY, data_base64 TEXT NOT NULL, byte INTEGER NOT NULL,
    checksum TEXT NOT NULL, mime TEXT NOT NULL,
    width INTEGER NOT NULL, height INTEGER NOT NULL, updated_at TEXT NOT NULL)`);
  return db;
}

test('⛔ muatan uji BENAR-BENAR bukan UTF-8 yang sah', async () => {
  // Penjaga untuk penjaganya: kalau muatannya kebetulan UTF-8 sah, seluruh
  // test di bawah menguji kasus yang mudah dan hijaunya tidak berarti apa-apa.
  const bolakBalik = Buffer.from(MUATAN.toString('utf8'), 'utf8');
  assert.notEqual(
    Buffer.compare(bolakBalik, MUATAN),
    0,
    'muatan uji selamat dari perjalanan UTF-8 — ia tidak menguji apa pun'
  );
  assert.ok(MUATAN.includes(0x00), 'tidak ada NUL di muatan uji');
  assert.ok(MUATAN.includes(0xff), 'tidak ada 0xFF di muatan uji');
});

test('⛔ round-trip IDENTIK byte per byte, termasuk panjangnya', async () => {
  const { checksumGambar, byteDariBase64, verifikasiGambar } = await modul();
  const db = dbLokal();

  // Sisi server: sandikan.
  const base64 = MUATAN.toString('base64');
  const checksum = checksumGambar(base64);

  // Transport + tulis lokal.
  db.prepare(
    `INSERT INTO item_image VALUES (?,?,?,?,?,?,?,?)`
  ).run('i1', base64, MUATAN.byteLength, checksum, 'image/webp', 400, 400, '2026-09-02T00:00:00Z');

  // Sisi perangkat: baca, verifikasi, decode.
  const baris = db.prepare('SELECT data_base64 d, byte b, checksum c, typeof(data_base64) t FROM item_image').get();
  assert.equal(baris.t, 'text', 'kolomnya harus TEXT — tidak ada biner di jalur ini');
  assert.equal(
    verifikasiGambar({ base64: baris.d, byte: baris.b, checksum: baris.c }),
    'utuh'
  );

  const keluar = Buffer.from(baris.d, 'base64');
  assert.equal(keluar.byteLength, MUATAN.byteLength, 'panjang berubah');
  assert.equal(
    Buffer.compare(keluar, MUATAN),
    0,
    'byte BERBEDA setelah round-trip — inilah yang membuat kartu jadi kotak kosong'
  );
  // Dan panjang yang dihitung TANPA decode sepakat dengan yang sebenarnya.
  assert.equal(byteDariBase64(baris.d), MUATAN.byteLength);
});

test('round-trip utuh untuk muatan berukuran nyata (30 KB)', async () => {
  const { checksumGambar, verifikasiGambar, BATAS_BYTE } = await modul();
  const db = dbLokal();

  // Isi pseudo-acak deterministik — mendekati entropi WebP terkompresi.
  const besar = Buffer.alloc(BATAS_BYTE);
  let s = 1;
  for (let i = 0; i < besar.length; i += 1) {
    s = (s * 1664525 + 1013904223) >>> 0;
    besar[i] = s >>> 24;
  }
  const base64 = besar.toString('base64');
  db.prepare('INSERT INTO item_image VALUES (?,?,?,?,?,?,?,?)').run(
    'i1', base64, besar.byteLength, checksumGambar(base64), 'image/webp', 400, 400, 'x'
  );

  const b = db.prepare('SELECT data_base64 d, byte, checksum c FROM item_image').get();
  assert.equal(verifikasiGambar({ base64: b.d, byte: b.byte, checksum: b.c }), 'utuh');
  assert.equal(Buffer.compare(Buffer.from(b.d, 'base64'), besar), 0);
});

test('⛔ kerusakan TERDETEKSI — tidak satu pun lolos diam-diam', async () => {
  const { checksumGambar, verifikasiGambar } = await modul();
  const base64 = MUATAN.toString('base64');
  const checksum = checksumGambar(base64);
  const byte = MUATAN.byteLength;

  const rusak = [
    ['dipotong di tengah', { base64: base64.slice(0, base64.length - 4), byte, checksum }],
    ['satu karakter berubah', {
      base64: base64.slice(0, -2) + (base64.at(-2) === 'A' ? 'B' : 'A') + base64.at(-1),
      byte,
      checksum,
    }],
    ['panjang tidak cocok', { base64, byte: byte + 1, checksum }],
    ['checksum tidak cocok', { base64, byte, checksum: '00000000' }],
    ['kosong', { base64: '', byte, checksum }],
    ['bukan base64', { base64: 'bukan base64!!', byte, checksum }],
  ];

  for (const [nama, b] of rusak) {
    assert.equal(verifikasiGambar(b), 'rusak', `TIDAK terdeteksi: ${nama}`);
  }

  // ⛔ Dan yang UTUH tetap lolos — verifikator yang menolak segalanya
  // "mendeteksi" semua kerusakan dan tidak berguna.
  assert.equal(verifikasiGambar({ base64, byte, checksum }), 'utuh');
});

test('⛔ pemotongan yang TETAP SAH base64 tertangkap panjangnya', async () => {
  const { checksumGambar, verifikasiGambar, base64Sah } = await modul();
  const base64 = MUATAN.toString('base64');
  // Potong tepat pada batas 4 karakter: bentuknya masih sah base64, dan
  // decoder tidak akan protes. Yang menangkapnya HANYA panjang + checksum —
  // dan inilah kerusakan yang paling mungkin terjadi di transport.
  const dipotong = base64.slice(0, base64.length - (base64.length % 4) - 4);
  assert.ok(base64Sah(dipotong), 'potongan uji tidak sah base64 — ia menguji hal lain');
  assert.equal(
    verifikasiGambar({ base64: dipotong, byte: MUATAN.byteLength, checksum: checksumGambar(base64) }),
    'rusak'
  );
});

test('checksum stabil dan peka terhadap perubahan satu karakter', async () => {
  const { checksumGambar } = await modul();
  const a = MUATAN.toString('base64');
  assert.equal(checksumGambar(a), checksumGambar(a), 'checksum tidak deterministik');
  assert.match(checksumGambar(a), /^[0-9a-f]{8}$/, 'bentuknya harus heks 8 karakter');
  const b = a.slice(0, -1) + (a.at(-1) === 'A' ? 'B' : 'A');
  assert.notEqual(checksumGambar(a), checksumGambar(b));
});

test('⛔ batas base64 di domain SAMA dengan CHECK di migrasi 0036', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { BATAS_BASE64, BATAS_BYTE } = await modul();
  const sql = fs.readFileSync(
    path.join(__dirname, '..', '..', 'db/migrations/0036_item_image.sql'),
    'utf8'
  );
  const m = /length\(data_base64\)\s*<=\s*(\d+)/.exec(sql);
  assert.ok(m, 'CHECK panjang base64 tidak ditemukan di migrasi');
  assert.equal(
    Number(m[1]),
    BATAS_BASE64,
    'Batas di database berbeda dari batas di domain. Yang lebih longgar menang ' +
      'diam-diam, dan anggaran unduhan setiap perangkat ikut naik.'
  );
  // Dan `BATAS_BASE64` benar-benar DITURUNKAN dari `BATAS_BYTE`, bukan diketik.
  assert.equal(BATAS_BASE64, 4 * Math.ceil(BATAS_BYTE / 3));
});
