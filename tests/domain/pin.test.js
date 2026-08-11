'use strict';

// T3.2 (docs/superpowers/plans/PLAN-modul-f-identitas.md) -- aturan PIN.
//
// Murni: tanpa I/O, tanpa waktu, tanpa database. Ia ada di packages/domain
// karena AC `spec-f:206` menuntut login berfungsi dengan jaringan dimatikan
// sepenuhnya -- klien memvalidasi bentuk PIN yang sama persis dengan server,
// dan dua salinan aturan "PIN lemah" adalah cara paling langsung untuk
// membuat PIN yang ditolak server diterima perangkat.
//
// Hashing-nya TIDAK di sini. `node:crypto` tidak ada di webview, dan berkas
// ini harus dapat dimuat keduanya. Yang ada di sini hanya aturan dan format;
// hashing hidup di balik port `PengunciPin`.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../packages/domain/src/pin.ts';

test('isValidPinShape: tepat 6 digit (spec-f:143)', async () => {
  const { isValidPinShape } = await import(MOD);

  assert.equal(isValidPinShape('482913'), true);
  assert.equal(isValidPinShape('4829'), false, '4 digit ditolak');
  assert.equal(isValidPinShape('48291'), false, '5 digit ditolak');
  assert.equal(isValidPinShape('4829134'), false, '7 digit ditolak');

  // Bukan digit sama sekali. `48291a` panjangnya 6 -- pemeriksaan panjang
  // saja akan meloloskannya.
  assert.equal(isValidPinShape('48291a'), false);
  assert.equal(isValidPinShape('4829 1'), false);
  assert.equal(isValidPinShape(''), false);

  // Nol di depan WAJIB dipertahankan. Kalau PIN pernah melewati Number(),
  // '048291' menjadi 48291 dan berubah jadi PIN 5 digit yang ditolak --
  // pengguna yang PIN-nya dimulai nol tidak akan pernah bisa masuk.
  assert.equal(isValidPinShape('048291'), true);
});

test('detectWeakPin: kelima pola spec-f:131-137 ditolak, dan pesannya menyebut pola mana', async () => {
  const { detectWeakPin } = await import(MOD);

  // AC `spec-f:144`: "Kelima pola PIN lemah ditolak dengan pesan yang
  // MENJELASKAN POLA MANA". Pesan seragam "PIN terlalu lemah" tidak memenuhi
  // AC itu -- manajer yang mengganti PIN tiga kali berturut-turut tanpa tahu
  // apa yang salah akan berakhir memilih PIN lemah yang keenam.
  const berulang = detectWeakPin('000000');
  assert.equal(berulang.pattern, 'repeated_digit');
  assert.match(berulang.message, /berulang/i);

  const naik = detectWeakPin('123456');
  assert.equal(naik.pattern, 'sequence');
  assert.match(naik.message, /urutan/i);

  assert.equal(detectWeakPin('654321').pattern, 'sequence', 'urutan turun');
  assert.equal(detectWeakPin('345678').pattern, 'sequence', 'urutan naik yang tidak mulai dari 1');

  const siklus = detectWeakPin('121212');
  assert.equal(siklus.pattern, 'repeating_block');
  assert.match(siklus.message, /pola/i);
  assert.equal(detectWeakPin('123123').pattern, 'repeating_block');

  // Pola keypad yang TIDAK tertangkap aturan struktural mana pun --
  // inilah kenapa daftar statis harus ada di samping keempat aturan lain.
  const umum = detectWeakPin('159753');
  assert.equal(umum.pattern, 'common_pin', '159753 adalah diagonal keypad');
  assert.equal(detectWeakPin('789456').pattern, 'common_pin');
});

test('detectWeakPin: tanggal lahir pengguna, bila diketahui', async () => {
  const { detectWeakPin } = await import(MOD);

  // Contoh spec-f:135 sendiri: 170890 untuk kelahiran 17 Agustus 1990.
  const lahir = '1990-08-17';
  const temuan = detectWeakPin('170890', { birthDate: lahir });
  assert.equal(temuan.pattern, 'birth_date');
  assert.match(temuan.message, /lahir/i);

  // Susunan lain dari tanggal yang sama.
  assert.equal(detectWeakPin('081790', { birthDate: lahir }).pattern, 'birth_date', 'MMDDYY');
  assert.equal(detectWeakPin('900817', { birthDate: lahir }).pattern, 'birth_date', 'YYMMDD');

  // Tanpa tanggal lahir, PIN yang sama LOLOS. Aturannya bersyarat
  // ("jika diketahui") -- menolaknya tanpa data berarti menolak PIN acak
  // yang kebetulan berbentuk tanggal.
  assert.equal(detectWeakPin('170890'), null);
});

test('detectWeakPin: PIN yang sah lolos', async () => {
  const { detectWeakPin } = await import(MOD);

  // Kalau daftar/aturan terlalu rakus, ini yang menangkapnya. Tanpa test ini
  // `detectWeakPin` yang selalu mengembalikan temuan akan membuat seluruh
  // test di atas hijau -- dan tidak ada satu pun PIN yang dapat dibuat.
  for (const pin of ['482913', '739154', '048291', '905172', '316847']) {
    assert.equal(detectWeakPin(pin), null, `${pin} seharusnya sah`);
  }
});

test('detectWeakPin: urutan dinilai per-langkah, bukan dari ujung ke ujung', async () => {
  const { detectWeakPin } = await import(MOD);

  // 135790 naik dari 1 ke 0 secara keseluruhan, tapi langkahnya +2 --
  // bukan urutan berturut. Pemeriksaan yang hanya membandingkan digit
  // pertama dan terakhir akan salah menolaknya.
  assert.equal(detectWeakPin('135790'), null);
  // 122345 punya lima digit berturut tapi tidak seluruhnya.
  assert.equal(detectWeakPin('122345'), null);
});

test('formatPhc/parsePhc: round-trip, dan bentuk yang ditolak', async () => {
  const { formatPhc, parsePhc, ARGON2_PARAMS } = await import(MOD);

  // Format PHC dipilih supaya hash yang dicetak server dapat diverifikasi
  // implementasi Argon2 mana pun di klien -- parameternya ikut di dalam
  // string, jadi tidak ada satu pun konstanta yang harus cocok di dua
  // tempat. Ia juga yang membuat rotasi parameter kelak mungkin: hash lama
  // tetap dapat diverifikasi dengan parameter lamanya sendiri.
  const salt = 'c2FsdHNhbHRzYWx0c2ExMg';
  const tag = 'dGFndGFndGFndGFndGFndGFndGFndGFndGFndGFndGFn';
  const phc = formatPhc({ ...ARGON2_PARAMS, salt, tag });

  assert.equal(phc, `$argon2id$v=19$m=19456,t=2,p=1$${salt}$${tag}`);

  const terurai = parsePhc(phc);
  assert.equal(terurai.algorithm, 'argon2id');
  assert.equal(terurai.version, 19);
  assert.equal(terurai.memory, 19456);
  assert.equal(terurai.passes, 2);
  assert.equal(terurai.parallelism, 1);
  assert.equal(terurai.salt, salt);
  assert.equal(terurai.tag, tag);

  // Base64 PHC TANPA padding. Padding '=' membuat string tidak cocok dengan
  // yang dicetak pustaka Argon2 lain, dan perbandingan hash akan gagal
  // dengan gejala "PIN salah" -- kegagalan yang menunjuk ke tempat keliru.
  //
  // Diperiksa pada salt dan tag, BUKAN pada seluruh string: `v=19`, `m=`,
  // `t=`, dan `p=` memuat '=' sebagai bagian sah dari format.
  assert.equal(terurai.salt.includes('='), false, 'salt tanpa padding');
  assert.equal(terurai.tag.includes('='), false, 'tag tanpa padding');

  // Dan round-trip byte-nya utuh, termasuk untuk panjang yang TIDAK habis
  // dibagi tiga -- di situlah padding base64 muncul dan harus dipangkas.
  const { toBase64NoPad, fromBase64NoPad } = await import(MOD);
  for (const panjang of [15, 16, 17, 32]) {
    const asli = new Uint8Array(panjang).map((_, i) => (i * 37 + 11) % 256);
    const kembali = fromBase64NoPad(toBase64NoPad(asli));
    assert.deepEqual([...kembali], [...asli], `round-trip ${panjang} byte`);
    assert.equal(toBase64NoPad(asli).includes('='), false, `${panjang} byte tanpa padding`);
  }

  for (const rusak of [
    '',
    'bukan-phc',
    '$argon2i$v=19$m=19456,t=2,p=1$c2FsdA$dGFn',   // algoritma lain
    '$argon2id$m=19456,t=2,p=1$c2FsdA$dGFn',        // tanpa versi
    '$argon2id$v=19$m=19456,t=2$c2FsdA$dGFn',       // parameter kurang
    '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA',        // tanpa tag
  ]) {
    assert.throws(() => parsePhc(rusak), /PHC/i, `harus menolak: ${JSON.stringify(rusak)}`);
  }
});

test('ARGON2_PARAMS: satu sumber untuk kedua sisi', async () => {
  const { ARGON2_PARAMS } = await import(MOD);

  // Rekomendasi OWASP untuk Argon2id. Diukur di mesin pengembangan:
  // 23 ms per hash. Angka ini ada di test supaya penurunannya kelak menjadi
  // keputusan yang terlihat, bukan penyuntingan diam-diam.
  assert.equal(ARGON2_PARAMS.memory, 19456, '19 MiB');
  assert.equal(ARGON2_PARAMS.passes, 2);
  assert.equal(ARGON2_PARAMS.parallelism, 1);
  assert.equal(ARGON2_PARAMS.tagLength, 32);
  assert.equal(ARGON2_PARAMS.saltLength, 16);
});
