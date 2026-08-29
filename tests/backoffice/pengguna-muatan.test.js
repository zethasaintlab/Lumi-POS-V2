'use strict';

// B-27 — muatan `POST /users` dan pra-periksa PIN.
//
// Murni: form masuk → muatan keluar. Yang di sini dapat diuji tanpa DOM dan
// tanpa server, dan yang tidak dapat diuji begitu tidak ada di sini.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const MOD = '../../apps/backoffice/src/pengguna/muatan.ts';

const TENANT = '018f2a10-0000-7000-8000-0000000000t1';
const OUTLET_A = '018f2a10-0000-7000-8000-0000000000a1';
const OUTLET_B = '018f2a10-0000-7000-8000-0000000000b1';
const ID_BARU = '018f2a10-0000-7000-8000-0000000000u1';

const FORM = {
  nama: 'Rina Kasir',
  email: '',
  peran: 'cashier',
  outletIds: [OUTLET_A],
  tanggalLahir: '',
};

const KONTEKS = { tenantId: TENANT, userId: ID_BARU };

// ---------------------------------------------------------------------------

test('kasir satu outlet menghasilkan SATU baris peran ber-scope outlet', async () => {
  const { buatMuatanPengguna } = await import(MOD);
  const hasil = buatMuatanPengguna(FORM, KONTEKS);

  assert.equal(hasil.ok, true, hasil.ok === false ? hasil.pesan : '');
  assert.deepEqual(hasil.muatan, {
    id: ID_BARU,
    name: 'Rina Kasir',
    email: null,
    birthDate: null,
    roles: [{ role: 'cashier', scopeType: 'outlet', scopeId: OUTLET_A }],
    outletIds: [OUTLET_A],
  });
});

test('⛔ peran ber-cakupan TENANT memakai scopeId tenant, bukan outlet', async () => {
  // `spec-f:29` dan `spec-f:33`: Owner dan Akuntan bercakupan Tenant. Menulis
  // scope outlet untuk keduanya menghasilkan baris yang terbaca sebagai hak
  // yang lebih sempit daripada yang diberikan — dan `user_role` adalah tempat
  // pertama yang akan dibaca orang saat menjawab "kenapa dia bisa/tidak bisa".
  const { buatMuatanPengguna } = await import(MOD);

  for (const peran of ['owner', 'accountant']) {
    const hasil = buatMuatanPengguna({ ...FORM, peran, outletIds: [OUTLET_A, OUTLET_B] }, KONTEKS);
    assert.equal(hasil.ok, true, `${peran} ditolak`);
    assert.deepEqual(
      hasil.muatan.roles,
      [{ role: peran, scopeType: 'tenant', scopeId: TENANT }],
      `${peran} tidak ber-scope tenant`
    );
    // Keanggotaan outlet TETAP ditulis: ia yang membuat pengguna terlihat
    // perangkat outlet (jalur turun mengirim pengguna per outlet).
    assert.deepEqual(hasil.muatan.outletIds, [OUTLET_A, OUTLET_B]);
  }
});

test('⛔ Manajer Area mendapat SATU baris peran per outlet', async () => {
  // `spec-f:30`: cakupannya "Beberapa outlet" — bukan tenant, dan bukan satu.
  // Satu baris ber-scope tenant akan memberinya hak di outlet yang tidak
  // pernah ditugaskan kepadanya.
  const { buatMuatanPengguna } = await import(MOD);
  const hasil = buatMuatanPengguna(
    { ...FORM, peran: 'area_manager', outletIds: [OUTLET_A, OUTLET_B] },
    KONTEKS
  );
  assert.deepEqual(hasil.muatan.roles, [
    { role: 'area_manager', scopeType: 'outlet', scopeId: OUTLET_A },
    { role: 'area_manager', scopeType: 'outlet', scopeId: OUTLET_B },
  ]);
});

test('⛔ Kasir dan Manajer Outlet DITOLAK bila diberi lebih dari satu outlet', async () => {
  // `spec-f:31` dan `spec-f:32` menulis cakupannya "Satu outlet".
  //
  // ⛔ Server TIDAK menegakkan ini — `POST /users` menerima berapa pun outlet.
  // Penjaga di sini karena itu adalah penjaga UI, bukan batas keamanan, dan
  // dinyatakan begitu supaya tidak ada yang menyimpulkan sebaliknya dari
  // keberadaannya.
  const { buatMuatanPengguna } = await import(MOD);
  for (const peran of ['cashier', 'outlet_manager']) {
    const hasil = buatMuatanPengguna({ ...FORM, peran, outletIds: [OUTLET_A, OUTLET_B] }, KONTEKS);
    assert.equal(hasil.ok, false, `${peran} dengan dua outlet diterima`);
    assert.equal(hasil.bidang, 'outletIds');
  }
});

test('⛔ pengguna TANPA outlet ditolak', async () => {
  // Keanggotaan outlet yang kosong menghasilkan pengguna yang tidak terlihat
  // perangkat mana pun: jalur turun mereplikasi pengguna PER OUTLET. Kasirnya
  // dibuat, PIN-nya disetel, dan namanya tidak pernah muncul di layar login
  // tablet — tanpa satu pun error di mana pun.
  const { buatMuatanPengguna } = await import(MOD);
  const hasil = buatMuatanPengguna({ ...FORM, outletIds: [] }, KONTEKS);
  assert.equal(hasil.ok, false);
  assert.equal(hasil.bidang, 'outletIds');
  assert.match(hasil.pesan, /outlet/i);
});

test('nama kosong ditolak dan penolakannya menunjuk fieldnya', async () => {
  const { buatMuatanPengguna } = await import(MOD);
  const hasil = buatMuatanPengguna({ ...FORM, nama: '  ' }, KONTEKS);
  assert.equal(hasil.ok, false);
  assert.equal(hasil.bidang, 'nama');
});

test('peran di luar daftar yang dikenal ditolak', async () => {
  // `PERAN_DIKENAL` harus sama persis dengan CHECK di migrasi 0003. Peran
  // karangan lolos sampai database, dan jawabannya 500.
  const { buatMuatanPengguna } = await import(MOD);
  const hasil = buatMuatanPengguna({ ...FORM, peran: 'supervisor' }, KONTEKS);
  assert.equal(hasil.ok, false);
  assert.equal(hasil.bidang, 'peran');
});

test('email dan tanggal lahir kosong dikirim sebagai null, bukan string kosong', async () => {
  // Kolomnya nullable. String kosong di `email` membuat baris yang terlihat
  // punya email — dan `resolve_login_tenant` menyaring `email IS NOT NULL`,
  // jadi dua pengguna ber-email '' akan bertabrakan di sana.
  const { buatMuatanPengguna } = await import(MOD);
  const hasil = buatMuatanPengguna({ ...FORM, email: '   ', tanggalLahir: '' }, KONTEKS);
  assert.equal(hasil.muatan.email, null);
  assert.equal(hasil.muatan.birthDate, null);
});

test('email diisi ikut terpangkas', async () => {
  const { buatMuatanPengguna } = await import(MOD);
  const hasil = buatMuatanPengguna({ ...FORM, email: ' rina@kopi.id ' }, KONTEKS);
  assert.equal(hasil.muatan.email, 'rina@kopi.id');
});

// --- PIN --------------------------------------------------------------------

test('⛔ pra-periksa PIN memakai FUNGSI domain, bukan salinannya', async () => {
  // Server menegakkan `isValidPinShape` + `detectWeakPin` yang sama
  // (`users.ts`). Salinan di klien akan menyimpang, dan yang menyimpang di
  // sini menghasilkan form yang menerima PIN lalu server menolaknya — atau
  // sebaliknya, yang lebih buruk: pesan "PIN disetel" untuk PIN yang tidak
  // pernah tersimpan.
  const { periksaPinBaru } = await import(MOD);
  const { isValidPinShape, detectWeakPin } = await import('../../packages/domain/src/pin.ts');

  for (const pin of ['000000', '123456', '121212', '048291', '12345', 'abcdef', '']) {
    const bentukOk = isValidPinShape(pin);
    const lemah = bentukOk ? detectWeakPin(pin, {}) : null;
    const diharapkan = bentukOk && lemah === null;

    const hasil = periksaPinBaru(pin, {});
    assert.equal(hasil.ok, diharapkan, `beda putusan untuk "${pin}"`);
    if (bentukOk && lemah) {
      assert.equal(hasil.pesan, lemah.message, 'pesan klien menyimpang dari pesan domain');
    }
  }
});

test('⛔ tanggal lahir ikut diperiksa bila diketahui', async () => {
  // `spec-f:135`. Aturannya BERSYARAT — tanpa tanggal lahir, pemeriksaan ini
  // tidak berjalan sama sekali, dan itu berarti PIN yang ditolak untuk satu
  // pengguna diterima untuk pengguna lain. Perilaku yang benar, tapi hanya
  // dapat dijelaskan kalau layar meneruskan tanggalnya.
  const { periksaPinBaru } = await import(MOD);
  assert.equal(periksaPinBaru('170892', {}).ok, true);
  assert.equal(periksaPinBaru('170892', { tanggalLahir: '1992-08-17' }).ok, false);
});

test('PIN yang sah diterima', async () => {
  const { periksaPinBaru } = await import(MOD);
  assert.equal(periksaPinBaru('048291', {}).ok, true);
});

// ---------------------------------------------------------------------------
// ⛔ Jalur UBAH peran memakai aturan yang SAMA
// ---------------------------------------------------------------------------

test('⛔ tambah dan ubah memakai SATU aturan cakupan, bukan dua salinan', async () => {
  // Dua salinan aturan cakupan menyimpang tepat pada kasus yang paling jarang
  // dicoba — dan yang menyimpang menghasilkan form tambah yang menolak apa
  // yang form ubah terima, di layar yang sama.
  //
  // Dibuktikan dengan menjalankan keduanya atas masukan yang sama dan
  // membandingkan hasilnya, bukan dengan membaca kodenya.
  const { buatMuatanPengguna, buatMuatanPeran } = await import(MOD);

  for (const kasus of [
    { peran: 'cashier', outletIds: [OUTLET_A] },
    { peran: 'cashier', outletIds: [OUTLET_A, OUTLET_B] },
    { peran: 'area_manager', outletIds: [OUTLET_A, OUTLET_B] },
    { peran: 'owner', outletIds: [OUTLET_A] },
    { peran: 'accountant', outletIds: [OUTLET_A, OUTLET_B] },
    { peran: 'outlet_manager', outletIds: [] },
    { peran: 'peran_karangan', outletIds: [OUTLET_A] },
  ]) {
    const lewatTambah = buatMuatanPengguna({ ...FORM, ...kasus }, KONTEKS);
    const lewatUbah = buatMuatanPeran(kasus.peran, kasus.outletIds, TENANT);

    assert.equal(lewatTambah.ok, lewatUbah.ok, `beda putusan untuk ${JSON.stringify(kasus)}`);
    if (lewatTambah.ok) {
      assert.deepEqual(lewatTambah.muatan.roles, lewatUbah.muatan.roles, JSON.stringify(kasus));
      assert.deepEqual(
        lewatTambah.muatan.outletIds,
        lewatUbah.muatan.outletIds,
        JSON.stringify(kasus)
      );
    } else {
      assert.equal(lewatTambah.pesan, lewatUbah.pesan, JSON.stringify(kasus));
    }
  }
});

test('muatan ubah peran TIDAK memuat nama, email, atau id', async () => {
  // `PATCH /users/:id` mengganti apa yang dikirim. Menyertakan `name` yang
  // dibaca dari daftar berarti menimpanya dengan nilai yang mungkin sudah
  // basi — dan menimpa nama orang saat mengubah perannya adalah kegagalan yang
  // tidak seorang pun hubungkan dengan tombol yang ia tekan.
  const { buatMuatanPeran } = await import(MOD);
  const hasil = buatMuatanPeran('cashier', [OUTLET_A], TENANT);
  assert.ok(hasil.ok);
  assert.deepEqual(Object.keys(hasil.muatan).sort(), ['outletIds', 'roles']);
});

test('duplikat outlet dibuang sebelum cakupan dihitung', async () => {
  // `['o1','o1']` adalah SATU outlet. Penjaga yang menghitung panjang array
  // mentah menolak permintaan yang sah.
  const { buatMuatanPeran } = await import(MOD);
  const hasil = buatMuatanPeran('cashier', [OUTLET_A, OUTLET_A], TENANT);
  assert.ok(hasil.ok, hasil.ok ? '' : hasil.pesan);
  assert.deepEqual(hasil.muatan.outletIds, [OUTLET_A]);
});
