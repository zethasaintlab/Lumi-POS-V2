'use strict';

// Penegakan kuota — `research/09` § 6.
//
// ⛔ Aturan mutlak dokumen itu: "tidak ada kuota yang boleh menghentikan
// penjualan. Semua penegakan terjadi pada operasi administratif (membuat
// outlet, menambah produk), tidak pernah pada alur kasir."
//
// Yang diuji di sini adalah aturannya sebagai fungsi murni. Bahwa jalur kasir
// benar-benar tidak menyentuhnya diuji sebagai PENJAGA di
// `tests/domain/kuota-tidak-di-jalur-kasir.test.js`.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../packages/domain/src/kuota.ts';

test('di bawah batas → boleh', async () => {
  const { periksaKuota } = await import(MOD);
  assert.deepEqual(
    periksaKuota({ dimensi: 'produk', terpakai: 10, batas: 200, tambahan: 1 }),
    { ok: true }
  );
});

test('⛔ tepat DI batas boleh; satu lebih tidak', async () => {
  const { periksaKuota } = await import(MOD);
  assert.equal(
    periksaKuota({ dimensi: 'produk', terpakai: 199, batas: 200, tambahan: 1 }).ok,
    true,
    'produk ke-200 harus muat di kuota 200'
  );
  assert.equal(
    periksaKuota({ dimensi: 'produk', terpakai: 200, batas: 200, tambahan: 1 }).ok,
    false,
    'produk ke-201 harus ditolak'
  );
});

test('⛔ batas `null` berarti tanpa batas, bukan nol', async () => {
  // Kalau `null` diperlakukan sebagai 0 lewat `Number(null)`, tier enterprise
  // menjadi tier yang tidak dapat menambah apa pun — kebalikan persis dari
  // maksudnya, tanpa satu pun error.
  const { periksaKuota } = await import(MOD);
  assert.deepEqual(
    periksaKuota({ dimensi: 'produk', terpakai: 1_000_000, batas: null, tambahan: 5_000 }),
    { ok: true }
  );
});

test('⛔ penambahan borongan dinilai UTUH, bukan per satuan', async () => {
  // Inilah lubang impor: 201 baris ke dalam kuota 200 harus ditolak sebagai
  // satu kesatuan. Memeriksa satu-satu akan meloloskan 200 baris pertama dan
  // menolak yang terakhir — impor parsial, tepat yang dilarang.
  const { periksaKuota } = await import(MOD);
  const hasil = periksaKuota({ dimensi: 'produk', terpakai: 0, batas: 200, tambahan: 201 });
  assert.equal(hasil.ok, false);
  assert.equal(hasil.kode, 'QUOTA_EXCEEDED');
});

test('⛔ pesan membawa ANGKANYA — terpakai, tambahan, dan batas', async () => {
  // `spec-e:152` menetapkan pola yang sama untuk peringatan stok: pesan yang
  // hanya berkata "kuota habis" memaksa merchant menebak berapa yang harus
  // dihapus, di layar yang tidak menampilkan angka itu.
  const { periksaKuota } = await import(MOD);
  const hasil = periksaKuota({ dimensi: 'produk', terpakai: 150, batas: 200, tambahan: 100 });

  assert.equal(hasil.ok, false);
  assert.match(hasil.pesan, /150/, 'pesan tidak menyebut jumlah terpakai');
  assert.match(hasil.pesan, /100/, 'pesan tidak menyebut jumlah yang ditambahkan');
  assert.match(hasil.pesan, /200/, 'pesan tidak menyebut batasnya');
});

test('⛔ pesan menyebut UPGRADE — penolakan tanpa jalan keluar bukan penolakan', async () => {
  // `research/09` § 6: "Tolak dengan pesan upgrade". Kuota adalah lever
  // monetisasi; penolakan yang tidak menunjuk jalan keluarnya membuang
  // satu-satunya momen merchant merasakan batas itu.
  const { periksaKuota } = await import(MOD);
  const hasil = periksaKuota({ dimensi: 'outlet', terpakai: 1, batas: 1, tambahan: 1 });
  assert.match(hasil.pesan, /paket/i);
});

test('tambahan nol selalu boleh, bahkan saat sudah melewati batas', async () => {
  // Merchant yang turun paket dapat berada DI ATAS kuota barunya. Operasi
  // yang tidak menambah apa pun tidak boleh ikut ditolak — kalau tidak,
  // penurunan paket mengunci katalog yang sudah ada.
  const { periksaKuota } = await import(MOD);
  assert.equal(periksaKuota({ dimensi: 'produk', terpakai: 500, batas: 200, tambahan: 0 }).ok, true);
});

test('⛔ dimensi tak dikenal MELEMPAR, tidak diam-diam meloloskan', async () => {
  // Fail-closed, seperti `bolehkah` di rbac.ts. Dimensi yang salah ketik dan
  // diam-diam lolos adalah kuota yang tidak ditegakkan di satu tempat —
  // tepat kelas cacat yang tidak menghasilkan error di mana pun.
  const { periksaKuota } = await import(MOD);
  assert.throws(
    () => periksaKuota({ dimensi: 'produkk', terpakai: 0, batas: 1, tambahan: 1 }),
    /produkk/
  );
});

test('⛔ volume transaksi BUKAN dimensi kuota, dan tidak akan pernah', async () => {
  // `research/09` § 6: membatasi transaksi = menghentikan penjualan.
  const { DIMENSI_KUOTA } = await import(MOD);
  assert.deepEqual([...DIMENSI_KUOTA].sort(), ['device', 'outlet', 'pengguna', 'produk']);
  for (const terlarang of ['transaksi', 'order', 'penjualan', 'omzet']) {
    assert.ok(!DIMENSI_KUOTA.includes(terlarang), `${terlarang} tidak boleh jadi dimensi kuota`);
  }
});
