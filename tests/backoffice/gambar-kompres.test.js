'use strict';

// ⛔ Tangga kualitas — aturan PRODUK, diuji tanpa DOM.
//
// Encoder di-inject justru supaya ini mungkin. Berapa kali mencoba, kapan
// berhenti, dan apa yang dilaporkan saat gagal adalah keputusan produk; aturan
// yang hanya dapat diuji lewat kanvas browser biasanya tidak diuji sama sekali
// (bentuk yang sama dengan `modifier-pilihan` yang keluar dari komponen React).
//
// Yang TIDAK diuji di sini, dan dinyatakan: apakah Chromium benar-benar
// menghasilkan ukuran yang diperkirakan. Itu diukur, sekali, dan hasilnya ada
// di `docs/verifikasi/GAMBAR-ANGGARAN.md` § 2.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const kompres = () => import('../../apps/backoffice/src/katalog/gambar-kompres.ts');
const domain = () => import('../../packages/domain/src/gambar-produk.ts');

/** Encoder palsu: menghasilkan base64 sah sepanjang `ukuran(persen)` byte. */
function encoderPalsu(ukuran, jejak = []) {
  return async (persen) => {
    jejak.push(persen);
    return Buffer.alloc(Math.max(1, ukuran(persen)), 0x41).toString('base64');
  };
}

test('berhenti pada kualitas TERTINGGI yang muat — tidak turun lebih jauh', async () => {
  const { kompresBertahap } = await kompres();
  const { BATAS_BYTE, KUALITAS_TURUN_PERSEN } = await domain();

  // Muat sejak percobaan pertama.
  const jejak = [];
  const h = await kompresBertahap(encoderPalsu(() => BATAS_BYTE - 300, jejak));
  assert.equal(h.ok, true);
  assert.equal(h.kualitasPersen, KUALITAS_TURUN_PERSEN[0]);
  assert.equal(h.percobaan, 1);
  assert.deepEqual(jejak, [KUALITAS_TURUN_PERSEN[0]], 'encoder dipanggil lebih dari sekali');
});

test('turun bertahap sampai muat, dan hanya sejauh yang perlu', async () => {
  const { kompresBertahap } = await kompres();
  const { BATAS_BYTE, KUALITAS_TURUN_PERSEN } = await domain();

  // Muat mulai anak tangga KETIGA.
  const jejak = [];
  const h = await kompresBertahap(
    encoderPalsu((q) => (q > KUALITAS_TURUN_PERSEN[2] ? BATAS_BYTE * 2 : BATAS_BYTE - 100), jejak)
  );
  assert.equal(h.ok, true);
  assert.equal(h.kualitasPersen, KUALITAS_TURUN_PERSEN[2]);
  assert.equal(h.percobaan, 3);
  assert.deepEqual(jejak, KUALITAS_TURUN_PERSEN.slice(0, 3));
});

test('⛔ batas INKLUSIF — hasil yang tepat menyentuh batas diterima', async () => {
  // Klien mengompres SAMPAI muat, jadi hasil yang persis di batas adalah
  // keadaan normal. Batas eksklusif menolak kompresi yang berhasil sempurna,
  // lalu memaksa satu anak tangga turun tanpa alasan.
  const { kompresBertahap } = await kompres();
  const { BATAS_BYTE } = await domain();
  const h = await kompresBertahap(encoderPalsu(() => BATAS_BYTE));
  assert.equal(h.ok, true);
  assert.equal(h.byte, BATAS_BYTE);
});

test('⛔ yang tetap tidak muat GAGAL BERNAMA — bukan dipaksa lebih rendah', async () => {
  const { kompresBertahap } = await kompres();
  const { BATAS_BYTE, KUALITAS_TURUN_PERSEN } = await domain();

  const jejak = [];
  const h = await kompresBertahap(encoderPalsu(() => BATAS_BYTE * 3, jejak));
  assert.equal(h.ok, false);
  assert.equal(h.kode, 'TETAP_TERLALU_BESAR');
  // Seluruh tangga dicoba lebih dulu — menyerah di tengah membuang kualitas
  // yang sebenarnya masih tersedia.
  assert.deepEqual(jejak, [...KUALITAS_TURUN_PERSEN]);
  // ⛔ Pesannya membawa ANGKANYA dan menyebut apa yang merchant dapat lakukan.
  // Latar polos dan potongan lebih rapat memangkas WebP jauh lebih banyak
  // daripada kualitas; pesan yang hanya menyebut kodenya membuat merchant
  // menelepon support.
  assert.match(h.pesan, /KB/);
  assert.match(h.pesan, /latar|potong/i);
});

test('⛔ tidak ada kualitas di bawah 50 yang dicoba diam-diam', async () => {
  // Di bawah 50, WebP menghasilkan artefak blok yang terlihat sebagai KOTOR
  // pada foto makanan. Gambar yang membuat produk terlihat buruk lebih
  // merugikan daripada kartu tanpa gambar — jadi berhentinya di sini adalah
  // keputusan, bukan batas teknis.
  const { kompresBertahap } = await kompres();
  const { BATAS_BYTE } = await domain();
  const jejak = [];
  await kompresBertahap(encoderPalsu(() => BATAS_BYTE * 9, jejak));
  assert.ok(jejak.length > 0, 'penjaga tidak mencatat satu pun percobaan');
  for (const q of jejak) assert.ok(q >= 50, `kualitas ${q} dicoba — di bawah ambang artefak blok`);
});

test('encoder yang melempar maupun mengembalikan kosong → ENCODER_GAGAL', async () => {
  const { kompresBertahap } = await kompres();

  const melempar = await kompresBertahap(async () => {
    throw new Error('toBlob null');
  });
  assert.equal(melempar.kode, 'ENCODER_GAGAL');

  // ⛔ String kosong DIBEDAKAN dari kegagalan diam. `canvas.toBlob` memanggil
  // callbacknya dengan `null` saat format tidak didukung — tanpa satu pun
  // lemparan. Yang lolos dari sini akan tersimpan sebagai baris `item_image`
  // kosong, dan kartu yang gagal muat selamanya.
  const kosong = await kompresBertahap(async () => '');
  assert.equal(kosong.kode, 'ENCODER_GAGAL');
});

test('⛔ yang dibandingkan byte DECODE, bukan panjang base64', async () => {
  // Base64 membengkak 33%. Membandingkan panjang teksnya dengan `BATAS_BYTE`
  // menolak setiap gambar di atas ~22 KB — 25% lebih ketat daripada yang
  // merchant diberi tahu di layar, tanpa satu pun pesan yang menjelaskannya.
  const { kompresBertahap } = await kompres();
  const { BATAS_BYTE, BATAS_BASE64 } = await domain();

  // Muatan yang byte-nya persis di batas: teksnya `BATAS_BASE64` — lebih
  // panjang dari `BATAS_BYTE`, jadi pembanding yang salah akan menolaknya.
  const h = await kompresBertahap(encoderPalsu(() => BATAS_BYTE));
  assert.equal(h.ok, true, 'muatan tepat di batas ditolak — pembandingnya panjang teks');
  assert.equal(h.base64.length, BATAS_BASE64);
});

test('mime sumber: JPG/PNG/WebP diterima, sisanya tidak', async () => {
  const { mimeSumberSah } = await kompres();
  for (const m of ['image/jpeg', 'image/png', 'image/webp']) {
    assert.equal(mimeSumberSah(m), true, `${m} ditolak`);
  }
  // HEIC adalah bawaan kamera iPhone dan kanvas tidak dapat men-decode-nya di
  // sebagian besar peramban; menerimanya berarti merchant menunggu kompresi
  // yang pasti gagal.
  for (const m of ['image/heic', 'image/svg+xml', 'application/pdf', 'text/html']) {
    assert.equal(mimeSumberSah(m), false, `${m} diterima`);
  }
});
