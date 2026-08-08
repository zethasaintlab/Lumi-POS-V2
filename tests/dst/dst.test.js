'use strict';

// Gate F2 (`ARCH` § 14): **0 transaksi hilang atau duplikat di bawah fault
// injection, 10.000 iterasi.**
//
// Berkas ini menjalankan gate itu apa adanya, dan sekaligus membuktikan bahwa
// invariant yang dipakainya tidak kosong — kelima mode cacat dari
// `prototypes/02-dst-sinkronisasi/FINDINGS.md` ikut dijalankan permanen.
//
// Tanpa database, tanpa jaringan, tanpa `Date.now()`, tanpa `Math.random()`.
// Kegagalan apa pun menyebutkan SEED-nya, dan seed itu mereproduksinya persis.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { jalankanSatuIterasi } = require('./harness');

const DOMAIN_HLC = '../../packages/domain/src/hlc.ts';

// 10.000 adalah angka gate, bukan angka yang dipilih karena enak. Ia dijalankan
// penuh di CI; menurunkannya berarti menurunkan gate-nya.
const ITERASI_GATE = 10000;

// Iterasi untuk mode cacat: cukup untuk membuktikan invariantnya menangkap,
// tanpa membayar 10.000 kali lima. FINDINGS memakai 300 dan seluruh mode gagal
// 300/300 — kalau sebuah cacat baru lolos 400 iterasi, ia bukan cacat yang
// invariant ini janjikan tangkap.
const ITERASI_CACAT = 400;

async function muatHlc() {
  const { createHlc } = await import(DOMAIN_HLC);
  return createHlc;
}

function jalankanBanyak({ mode, iterasi, createHlc }) {
  let gagal = 0;
  let seedGagalPertama = null;
  let contohPelanggaran = null;

  for (let seed = 1; seed <= iterasi; seed += 1) {
    const { pelanggaran } = jalankanSatuIterasi({ seed, mode, createHlc });
    if (pelanggaran.length > 0) {
      gagal += 1;
      if (seedGagalPertama === null) {
        seedGagalPertama = seed;
        contohPelanggaran = pelanggaran;
      }
    }
  }
  return { gagal, seedGagalPertama, contohPelanggaran };
}

// ============================================================
// Gate F2
// ============================================================

test(`protokol bertahan ${ITERASI_GATE} iterasi fault injection`, async (t) => {
  const createHlc = await muatHlc();
  const hasil = jalankanBanyak({ mode: 'none', iterasi: ITERASI_GATE, createHlc });

  assert.equal(
    hasil.gagal,
    0,
    hasil.seedGagalPertama === null
      ? ''
      : `gagal ${hasil.gagal}/${ITERASI_GATE}. Reproduksi: seed=${hasil.seedGagalPertama}\n` +
        (hasil.contohPelanggaran ?? []).join('\n')
  );
  t.diagnostic(`mode=none iterasi=${ITERASI_GATE} gagal=0`);
});

// Determinisme adalah SYARAT gate, bukan properti yang menyenangkan. Kalau dua
// run dengan seed sama menghasilkan jalan yang berbeda, angka 10.000 di atas
// tidak berarti apa-apa dan kegagalan tidak dapat direproduksi.
test('seed yang sama menghasilkan hasil yang sama persis', async () => {
  const createHlc = await muatHlc();
  for (const seed of [1, 42, 9999]) {
    const a = jalankanSatuIterasi({ seed, mode: 'none', createHlc });
    const b = jalankanSatuIterasi({ seed, mode: 'none', createHlc });
    assert.deepEqual(
      [...a.server.orders.keys()].sort(),
      [...b.server.orders.keys()].sort(),
      `seed ${seed} tidak deterministik`
    );
    assert.deepEqual(a.pelanggaran, b.pelanggaran);
  }
});

test('seed berbeda menjalankan jalan yang berbeda', async () => {
  const createHlc = await muatHlc();
  const a = jalankanSatuIterasi({ seed: 1, mode: 'none', createHlc });
  const b = jalankanSatuIterasi({ seed: 2, mode: 'none', createHlc });
  assert.notDeepEqual([...a.server.orders.keys()], [...b.server.orders.keys()]);
});

// Simulasi yang tidak menghasilkan apa-apa akan lolos seluruh invariant tanpa
// menguji satu pun. Ini penjaga terhadap harness yang diam-diam mati.
test('simulasi benar-benar menghasilkan transaksi dan benar-benar kehilangan paket', async () => {
  const createHlc = await muatHlc();
  const { server, devices } = jalankanSatuIterasi({ seed: 7, mode: 'none', createHlc });

  assert.ok(server.orders.size > 5, `terlalu sedikit order sampai: ${server.orders.size}`);
  const dibuat = devices.reduce((n, d) => n + d.dibuat.length, 0);
  assert.ok(dibuat > 5, `terlalu sedikit order dibuat: ${dibuat}`);
  // Dan idempotency benar-benar terpakai -- kalau tidak ada retry sama sekali,
  // seluruh protokol dedup tidak pernah dieksekusi.
  assert.ok(server.idempotencyKeys.size > 0);
});

// ============================================================
// Mode cacat: bukti bahwa kedelapan invariant tidak kosong
// ============================================================
//
// FINDINGS menemukan bahwa daftar invariant awal (I1-I5) hanya menangkap 1
// dari 5 cacat. Empat lolos. Kalau harness itu dipakai apa adanya untuk
// memvalidasi kode produksi, ia akan memberi rasa aman palsu.
//
// Ketiga test di bawah menjaga supaya itu tidak terulang: masing-masing
// menuntut cacatnya TERTANGKAP, dan menyebut invariant mana yang harus
// menangkapnya.

test('cacat outbox_in_memory tertangkap I1 dan I5', async () => {
  const createHlc = await muatHlc();
  const hasil = jalankanBanyak({ mode: 'outbox_in_memory', iterasi: ITERASI_CACAT, createHlc });
  assert.ok(hasil.gagal > 0, 'antrean yang hilang saat crash HARUS terdeteksi');
  const nama = hasil.contohPelanggaran.join(' ');
  assert.match(nama, /I1|I5/, `harus dilanggar I1 atau I5, dapat: ${nama}`);
});

// Ini yang lolos I1-I5 di prototipe. ULID PK mencegah duplikasinya, jadi tidak
// ada yang hilang dan tidak ada yang ganda -- tapi tabel idempotency membengkak
// dan deteksi 422 rusak. I8 lahir dari sini.
test('cacat regen_idem_on_retry tertangkap I8, bukan I1-I5', async () => {
  const createHlc = await muatHlc();
  const hasil = jalankanBanyak({ mode: 'regen_idem_on_retry', iterasi: ITERASI_CACAT, createHlc });
  assert.ok(hasil.gagal > 0, 'key yang di-regenerate tiap retry HARUS terdeteksi');
  const nama = hasil.contohPelanggaran.join(' ');
  assert.match(nama, /I8/, `harus dilanggar I8, dapat: ${nama}`);
});

// Lolos I1-I5 karena perangkatnya sekadar TIDAK BERJUALAN. Tidak ada yang
// hilang karena tidak ada yang pernah ada -- dan bisnisnya tetap gagal. I6
// lahir dari sini, dan ia satu-satunya invariant yang menjaga janji utama
// produk ini.
test('cacat seq_from_server tertangkap I6', async () => {
  const createHlc = await muatHlc();
  const hasil = jalankanBanyak({ mode: 'seq_from_server', iterasi: ITERASI_CACAT, createHlc });
  assert.ok(hasil.gagal > 0, 'perangkat yang tidak bisa menjual offline HARUS terdeteksi');
  const nama = hasil.contohPelanggaran.join(' ');
  assert.match(nama, /I6/, `harus dilanggar I6, dapat: ${nama}`);
});

// Lolos I1-I5 karena tidak ada yang membandingkan record dengan tulisan
// PERTAMANYA. Membandingkan record dengan dirinya sendiri tidak akan pernah
// melihat mutasi. I7 lahir dari sini, dan ia yang menjaga invariant #2.
test('cacat void_as_update tertangkap I7', async () => {
  const createHlc = await muatHlc();
  const hasil = jalankanBanyak({ mode: 'void_as_update', iterasi: ITERASI_CACAT, createHlc });
  assert.ok(hasil.gagal > 0, 'void yang mengubah record HARUS terdeteksi');
  const nama = hasil.contohPelanggaran.join(' ');
  assert.match(nama, /I7|I5/, `harus dilanggar I7 atau I5, dapat: ${nama}`);
});

// Mode ini sengaja LOLOS, dan itu temuan, bukan lubang.
//
// Menulis idempotency key setelah transaksi adalah urutan yang salah -- tapi
// ULID client-generated menyelamatkannya: order kedua menabrak primary key
// sebelum sempat menjadi duplikat. FINDINGS menyebutnya bukti KEP-16 benar,
// bahwa dedup berdiri di atas DUA mekanisme, bukan satu.
//
// Test ini menjaga temuan itu tetap benar. Kalau ia suatu hari GAGAL, artinya
// jaring pengaman kedua sudah hilang dan seseorang perlu tahu.
test('cacat server_idem_after_tx TIDAK melanggar invariant -- ULID PK menyelamatkannya', async () => {
  const createHlc = await muatHlc();
  const hasil = jalankanBanyak({ mode: 'server_idem_after_tx', iterasi: ITERASI_CACAT, createHlc });
  assert.equal(
    hasil.gagal,
    0,
    `mode ini seharusnya selamat berkat ULID PK. Kalau ia gagal, jaring pengaman kedua hilang. ` +
      `seed=${hasil.seedGagalPertama} ${(hasil.contohPelanggaran ?? []).join(' ')}`
  );
});

// ============================================================
// Waktu dan keacakan benar-benar di-inject
// ============================================================

// `ARCH` §11 menuntutnya, dan tuntutan itu tidak berarti apa-apa kalau tidak
// ada yang memeriksanya. Pemeriksaan ini membaca berkas harness-nya sendiri --
// murni, tanpa menjalankan apa pun.
test('harness tidak memuat sumber waktu atau keacakan global', async () => {
  const { readFile } = require('node:fs/promises');
  const path = require('node:path');
  const mentah = await readFile(path.join(__dirname, 'harness.js'), 'utf8');

  // Komentar dibuang lebih dulu. Versi pertama pemeriksaan ini membaca berkas
  // apa adanya dan gagal karena komentarnya sendiri menyebut `Date.now()`
  // untuk menjelaskan kenapa ia dilarang -- pemeriksa yang tersandung pada
  // penjelasannya sendiri.
  const isi = mentah
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((baris) => !baris.trim().startsWith('//'))
    .join('\n');

  const terlarang = [
    ['Date.now(', 'jam nyata'],
    ['Math.random(', 'keacakan global'],
    ['new Date(', 'jam nyata'],
    ['require(\'node:fs', 'I/O'],
    ['fetch(', 'jaringan'],
  ];
  for (const [pola, alasan] of terlarang) {
    assert.ok(
      !isi.includes(pola),
      `harness memuat ${pola} (${alasan}) -- determinisme hilang, dan gate 10.000 iterasi tidak berarti apa-apa`
    );
  }
});
