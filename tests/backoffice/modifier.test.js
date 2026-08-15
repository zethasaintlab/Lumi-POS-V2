'use strict';

// B-09 — Modifier List dan opsinya.
//
// Dua kelompok aturan, dan keduanya datang dari spec, bukan dari selera:
//
//   FR-A3 — kombinasi selectionType/min/max/allowDuplicate menentukan
//           perilaku dialog di layar KASIR. Merchant yang mengonfigurasinya
//           di sini tidak melihat dialog itu, jadi layar harus menerjemahkan.
//
//   FR-A5 — "Kesalahan penempatan adalah jebakan #1 di modul ini. UI harus
//           MENCEGAHNYA, bukan mendokumentasikannya." Ukuran/rasa seharusnya
//           variation (punya stok sendiri), bukan modifier.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../apps/backoffice/src/katalog/modifier.ts';

const ID = '018f2a10-0000-7000-8000-0000000000m1';

const FORM = {
  nama: 'Tingkat Gula',
  selectionType: 'single',
  minSelections: '1',
  maxSelections: '',
  allowDuplicate: false,
  isRequired: true,
};

// ---------------------------------------------------------------------------
// Muatan list
// ---------------------------------------------------------------------------

test('form lengkap menghasilkan muatan createModifierList', async () => {
  const { buatMuatanList } = await import(MOD);
  const hasil = buatMuatanList(FORM, ID);
  assert.equal(hasil.ok, true, hasil.ok === false ? hasil.pesan : '');
  assert.deepEqual(hasil.muatan, {
    id: ID,
    name: 'Tingkat Gula',
    selectionType: 'single',
    minSelections: 1,
    // ⛔ `null`, bukan dihilangkan: `max_selections IS NULL` berarti "tanpa
    // batas atas", dan itu keadaan yang bermakna — bukan field yang lupa
    // diisi.
    maxSelections: null,
    allowDuplicate: false,
    isRequired: true,
  });
});

test('⛔ minSelections > maxSelections ditolak — dialognya tidak akan pernah dapat dikonfirmasi', async () => {
  // Kalimat itu dari server (`modifier-lists.ts`). Ditolak juga di sini supaya
  // penolakannya menunjuk field, bukan mendarat sebagai pesan lepas.
  const { buatMuatanList } = await import(MOD);
  const hasil = buatMuatanList({ ...FORM, minSelections: '3', maxSelections: '2' }, ID);
  assert.equal(hasil.ok, false);
  assert.equal(hasil.bidang, 'maxSelections');
  assert.match(hasil.pesan, /dikonfirmasi/i);
});

test('min == max SAH — itu cara menyatakan "pilih tepat N"', async () => {
  const { buatMuatanList } = await import(MOD);
  assert.equal(buatMuatanList({ ...FORM, minSelections: '2', maxSelections: '2' }, ID).ok, true);
});

test('maxSelections kosong berarti tanpa batas atas, dan selalu sah', async () => {
  const { buatMuatanList } = await import(MOD);
  const hasil = buatMuatanList({ ...FORM, minSelections: '9', maxSelections: '' }, ID);
  assert.equal(hasil.ok, true);
  assert.equal(hasil.muatan.maxSelections, null);
});

test('selectionType di luar single/multi ditolak', async () => {
  const { buatMuatanList } = await import(MOD);
  const hasil = buatMuatanList({ ...FORM, selectionType: 'radio' }, ID);
  assert.equal(hasil.ok, false);
  assert.equal(hasil.bidang, 'selectionType');
});

test('angka pecahan dan negatif ditolak, bukan dibulatkan diam-diam', async () => {
  const { buatMuatanList } = await import(MOD);
  for (const buruk of ['-1', '1.5', 'abc']) {
    assert.equal(buatMuatanList({ ...FORM, minSelections: buruk }, ID).ok, false, `"${buruk}" diterima`);
  }
});

// ---------------------------------------------------------------------------
// Muatan modifier — Rp 0 SAH
// ---------------------------------------------------------------------------

test('⛔ modifier berharga Rp 0 SAH — "Less Sugar" mengubah pesanan tanpa mengubah harga', async () => {
  // AC FR-A3: "Modifier dengan harga Rp 0 tetap tercetak di struk". Menolak
  // nol akan membuat seluruh kelas modifier tidak dapat dibuat.
  const { buatMuatanModifier } = await import(MOD);
  const hasil = buatMuatanModifier({ nama: 'Less Sugar', harga: '0', isDefault: false }, ID);
  assert.equal(hasil.ok, true, hasil.ok === false ? hasil.pesan : '');
  assert.equal(hasil.muatan.price, 0);
});

test('harga modifier kosong dianggap NOL, bukan ditolak', async () => {
  // Berbeda dari harga varian, yang wajib. Modifier tanpa biaya tambahan
  // adalah kasus paling umum ("Tanpa es", "Extra pedas").
  const { buatMuatanModifier } = await import(MOD);
  assert.equal(buatMuatanModifier({ nama: 'Tanpa es', harga: '', isDefault: false }, ID).muatan.price, 0);
});

test('harga modifier yang tidak dapat dibaca tetap ditolak', async () => {
  const { buatMuatanModifier } = await import(MOD);
  const hasil = buatMuatanModifier({ nama: 'X', harga: '25.5', isDefault: false }, ID);
  assert.equal(hasil.ok, false);
  assert.equal(hasil.bidang, 'harga');
});

test('nama modifier kosong ditolak', async () => {
  const { buatMuatanModifier } = await import(MOD);
  assert.equal(buatMuatanModifier({ nama: '  ', harga: '0', isDefault: false }, ID).ok, false);
});

// ---------------------------------------------------------------------------
// ⛔ FR-A5 — guardrail variation versus modifier
// ---------------------------------------------------------------------------

test('⛔ nama bermuatan ukuran/rasa memicu peringatan pola', async () => {
  // `spec-a:157` menyebut daftarnya persis. Ukuran dan rasa hampir selalu
  // variation: keduanya punya stok sendiri, dan modifier tidak pernah punya.
  const { polaMencurigakan } = await import(MOD);
  for (const nama of ['Ukuran Gelas', 'SIZE', 'Pilihan Varian', 'Rasa Sirup', 'Flavor']) {
    const temuan = polaMencurigakan(nama, []);
    assert.ok(temuan.length > 0, `"${nama}" tidak memicu peringatan`);
  }
});

test('nama biasa tidak memicu peringatan', async () => {
  const { polaMencurigakan } = await import(MOD);
  assert.deepEqual(polaMencurigakan('Tingkat Gula', []), []);
});

test('⛔ semua opsi berharga BEDA dan tidak ada yang Rp 0 → peringatan', async () => {
  // `spec-a:158`. Pola itu adalah bentuk daftar harga, bukan daftar tambahan —
  // tanda kuat bahwa yang dimaksud merchant sebenarnya variation.
  const { polaMencurigakan } = await import(MOD);
  const temuan = polaMencurigakan('Pilihan', [
    { price: 5000 },
    { price: 8000 },
    { price: 12000 },
  ]);
  assert.ok(temuan.length > 0);
});

test('satu opsi Rp 0 sudah cukup membatalkan peringatan harga', async () => {
  const { polaMencurigakan } = await import(MOD);
  assert.deepEqual(
    polaMencurigakan('Pilihan', [{ price: 0 }, { price: 5000 }, { price: 8000 }]),
    []
  );
});

test('harga yang SAMA di beberapa opsi tidak memicu peringatan', async () => {
  const { polaMencurigakan } = await import(MOD);
  assert.deepEqual(polaMencurigakan('Topping', [{ price: 5000 }, { price: 5000 }]), []);
});

test('⛔ daftar dengan SATU opsi tidak memicu peringatan harga', async () => {
  // "semua harga berbeda" secara teknis benar untuk satu elemen, dan itu akan
  // memperingatkan setiap list yang baru diisi opsi pertamanya — peringatan
  // yang muncul untuk keadaan normal akan diabaikan orang, termasuk saat ia
  // benar.
  const { polaMencurigakan } = await import(MOD);
  assert.deepEqual(polaMencurigakan('Topping', [{ price: 5000 }]), []);
});

test('⛔ peringatan TIDAK MEMBLOKIR — ia bukan penolakan', async () => {
  // AC `spec-a:163`: "Peringatan pola tidak memblokir penyimpanan."
  // `polaMencurigakan` mengembalikan daftar teks, dan `buatMuatanList` tidak
  // pernah memanggilnya. Kedua fungsi itu sengaja tidak saling tahu.
  const { buatMuatanList, polaMencurigakan } = await import(MOD);
  const nama = 'Ukuran Gelas';
  assert.ok(polaMencurigakan(nama, []).length > 0);
  assert.equal(buatMuatanList({ ...FORM, nama }, ID).ok, true, 'peringatan ikut memblokir');
});

// ---------------------------------------------------------------------------
// FR-A3 — terjemahan konfigurasi ke perilaku kasir
// ---------------------------------------------------------------------------

test('⛔ konfigurasi diterjemahkan jadi kalimat perilaku kasir', async () => {
  // Merchant yang mengonfigurasi di back-office TIDAK melihat dialog kasir.
  // Tabel `spec-a:119-125` adalah lima kombinasi yang mustahil dinalar dari
  // empat field mentah.
  const { ringkasPerilaku } = await import(MOD);

  const wajibTunggal = ringkasPerilaku({
    selectionType: 'single', isRequired: true, minSelections: 1, maxSelections: null, allowDuplicate: false,
  });
  assert.match(wajibTunggal, /wajib/i);

  const opsionalTunggal = ringkasPerilaku({
    selectionType: 'single', isRequired: false, minSelections: 0, maxSelections: null, allowDuplicate: false,
  });
  assert.match(opsionalTunggal, /tanpa pilihan/i);

  const banyakBerbatas = ringkasPerilaku({
    selectionType: 'multi', isRequired: false, minSelections: 0, maxSelections: 3, allowDuplicate: false,
  });
  assert.match(banyakBerbatas, /3/);

  const gandaan = ringkasPerilaku({
    selectionType: 'multi', isRequired: false, minSelections: 0, maxSelections: null, allowDuplicate: true,
  });
  assert.match(gandaan, /×2|jumlah|ganda/i);
});

test('minSelections > 0 disebut dalam ringkasan', async () => {
  const { ringkasPerilaku } = await import(MOD);
  const teks = ringkasPerilaku({
    selectionType: 'multi', isRequired: false, minSelections: 2, maxSelections: null, allowDuplicate: false,
  });
  assert.match(teks, /2/);
});
