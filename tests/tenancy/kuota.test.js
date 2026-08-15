'use strict';

// Penegakan kuota di keempat titik administratif — `research/09` § 6.
//
// ⛔ Yang TIDAK diuji di sini karena tidak boleh ada: kuota di jalur kasir.
// Itu penjaga tersendiri di `tests/domain/kuota-tidak-di-jalur-kasir.test.js`.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');

let owner, appDb, app, tenant;

before(async () => {
  owner = await connectAsOwner();
  appDb = await connectAsApp();
});

after(async () => {
  await resetAll(owner);
  await owner.end();
  await appDb.end();
  if (app) await app.close();
});

beforeEach(async () => {
  await resetAll(owner);
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();
  tenant = await daftarkanMerchant();
});

/** Mendaftar lewat endpoint sungguhan — tenant selalu lahir di paket `free`. */
async function daftarkanMerchant() {
  const b = {
    tenant: { id: crypto.randomUUID(), name: 'Kopi Kuota' },
    outlet: { id: crypto.randomUUID(), name: 'Pusat', timezone: 'Asia/Jakarta' },
    owner: {
      id: crypto.randomUUID(),
      name: 'Pemilik',
      email: `owner+${crypto.randomUUID()}@contoh.id`,
      password: 'kopi susu gula aren',
    },
  };
  const res = await app.inject({
    method: 'POST',
    url: '/tenants',
    payload: b,
    headers: { 'content-type': 'application/json' },
  });
  assert.equal(res.statusCode, 201, res.body);
  return { id: b.tenant.id, outletId: b.outlet.id, ownerId: b.owner.id };
}

function H(extra = {}) {
  return {
    'content-type': 'application/json',
    'x-tenant-id': tenant.id,
    'x-actor-id': tenant.ownerId,
    ...extra,
  };
}

function post(url, payload, headers = {}) {
  return app.inject({ method: 'POST', url, payload, headers: H(headers) });
}

/**
 * Membaca tabel ber-RLS untuk verifikasi.
 *
 * ⛔ `app.tenant_id` WAJIB di-set. Tanpanya kebijakan RLS jatuh dengan
 * `unrecognized configuration parameter` — bukan mengembalikan nol baris.
 * Tabel `tenant` adalah satu-satunya yang dapat dibaca telanjang, karena ia
 * dikecualikan RLS.
 */
async function lihat(sql, params = []) {
  await appDb.query('BEGIN');
  await appDb.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  const { rows } = await appDb.query(sql, params);
  await appDb.query('COMMIT');
  return rows;
}

/** Menaikkan kuota satu dimensi tanpa lewat endpoint — tabel `tenant` RLS-exempt. */
async function setelKuota(kolom, nilai) {
  await appDb.query(`UPDATE tenant SET ${kolom} = $2 WHERE id = $1`, [tenant.id, nilai]);
}

function csvBaris(n) {
  const baris = ['nama,kategori,harga'];
  for (let i = 1; i <= n; i += 1) baris.push(`Produk Impor ${i},Minuman Impor,10000`);
  return baris.join('\n');
}

// --- max_products: impor, lubang yang paling mudah terlewat ----------------

test('⛔ CSV 201 baris DITOLAK di paket free (kuota 200), dan nol baris masuk', async () => {
  // Ini yang membuat kuota berarti. Impor menambah ribuan baris dalam satu
  // request; kuota yang hanya dipasang di POST /items dilewati sepenuhnya
  // oleh jalur yang justru dirancang untuk volume.
  const res = await post('/catalog/import', { csv: csvBaris(201), dryRun: false });

  assert.equal(res.statusCode, 403, res.body);
  const b = JSON.parse(res.body);
  assert.equal(b.error.code, 'QUOTA_EXCEEDED');
  assert.match(b.error.message, /200/, 'pesan tidak menyebut batasnya');
  assert.match(b.error.message, /201/, 'pesan tidak menyebut jumlah yang ditambahkan');

  const rows = await lihat('SELECT count(*) AS n FROM item');
  assert.equal(rows[0].n, '0', '⛔ IMPOR PARSIAL — sebagian baris masuk sebelum kuota menolak');
});

test('CSV 200 baris DITERIMA di paket free — batasnya inklusif', async () => {
  const res = await post('/catalog/import', { csv: csvBaris(200), dryRun: false });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(JSON.parse(res.body).diimpor, 200);

  const rows = await lihat('SELECT count(*) AS n FROM item');
  assert.equal(rows[0].n, '200');
});

test('⛔ dua impor yang MASING-MASING muat, tapi bersama tidak, ditolak di yang kedua', async () => {
  // Kuota dibaca dari keadaan sekarang, bukan dari ukuran satu berkas. Impor
  // yang hanya memeriksa ukuran berkas akan meloloskan keduanya.
  assert.equal((await post('/catalog/import', { csv: csvBaris(150), dryRun: false })).statusCode, 200);

  const kedua = ['nama,kategori,harga'];
  for (let i = 1; i <= 60; i += 1) kedua.push(`Kue ${i},Makanan Impor,5000`);
  const res = await post('/catalog/import', { csv: kedua.join('\n'), dryRun: false });

  assert.equal(res.statusCode, 403, res.body);
  assert.match(JSON.parse(res.body).error.message, /150/, 'pesan tidak menyebut yang sudah terpakai');
});

test('⛔ CSV 150 baris berisi SKU EKSISTING lolos — pembaruan tidak dihitung kuota', async () => {
  // Revisi atas rumus pertama. Versi awal menilai kuota terhadap SELURUH
  // baris berkas, dan itu menabrak `spec-a:288` secara langsung: alur yang
  // spec sebut adalah "unduh baris gagal → perbaiki → unggah ulang", dan
  // unggah-ulang berkas yang sama akan selalu menghitung ulang seluruh
  // barisnya. Merchant dihukum karena memperbaiki datanya sendiri.
  //
  // Kuota mengukur BERAPA PRODUK YANG AKAN ADA, dan baris yang memperbarui
  // produk lama tidak menambah satu pun.
  const csv = csvBaris(150);
  assert.equal((await post('/catalog/import', { csv, dryRun: false })).statusCode, 200);

  // Berkas yang sama persis, diunggah ulang. 150 + 150 = 300 > 200 pada
  // rumus lama; 150 + 0 = 150 pada rumus yang benar.
  const ulang = await post('/catalog/import', { csv, dryRun: false });
  assert.equal(ulang.statusCode, 200, ulang.body);
  const b = JSON.parse(ulang.body);
  assert.equal(b.dilewati, 150, 'seluruh baris seharusnya dilewati — tidak ada produk baru');
  assert.equal(b.diimpor, 0);

  const rows = await lihat('SELECT count(*) AS n FROM item');
  assert.equal(rows[0].n, '150', 'produk bertambah padahal seluruh baris sudah ada');
});

test('⛔ bilaSudahAda=perbarui juga tidak dihitung kuota', async () => {
  // Jalur `perbarui` menaruh baris di `valid` (bukan `dilewati`), jadi ia
  // lolos dari penyaringan yang hanya melihat `dilewati`. Ia tetap tidak
  // membuat produk baru — yang disentuhnya hanya `category_id`.
  const csv = csvBaris(150);
  assert.equal((await post('/catalog/import', { csv, dryRun: false })).statusCode, 200);

  const ulang = await post('/catalog/import', { csv, dryRun: false, bilaSudahAda: 'perbarui' });
  assert.equal(ulang.statusCode, 200, ulang.body);

  const rows = await lihat('SELECT count(*) AS n FROM item');
  assert.equal(rows[0].n, '150');
});

test('⛔ berkas CAMPURAN: hanya baris baru yang dihitung', async () => {
  // Berkas berisi 190 baris: 150 yang sudah ada + 40 baru.
  //
  //   rumus lama  : 150 terpakai + 190 baris  = 340 > 200  → DITOLAK
  //   rumus benar : 150 terpakai +  40 baru   = 190 ≤ 200  → diterima
  //
  // Angkanya dipilih supaya kedua rumus memberi jawaban BERBEDA. Test yang
  // angkanya lolos di kedua rumus tidak membuktikan yang mana yang berjalan.
  const csv = csvBaris(150);
  assert.equal((await post('/catalog/import', { csv, dryRun: false })).statusCode, 200);

  const campur = [csv];
  for (let i = 1; i <= 40; i += 1) campur.push(`Kue Baru ${i},Makanan Impor,5000`);
  const res = await post('/catalog/import', { csv: campur.join('\n'), dryRun: false });

  assert.equal(res.statusCode, 200, res.body);
  assert.equal(JSON.parse(res.body).diimpor, 40);

  const rows = await lihat('SELECT count(*) AS n FROM item');
  assert.equal(rows[0].n, '190');
});

test('⛔ baris BERMASALAH tidak menghabiskan kuota', async () => {
  // Baris yang tidak dapat diparse tidak akan pernah menjadi produk. Kuota
  // yang menghitungnya menolak impor karena data yang justru DIBUANG.
  const baris = ['nama,kategori,harga'];
  for (let i = 1; i <= 195; i += 1) baris.push(`Produk Sah ${i},Minuman Impor,10000`);
  for (let i = 1; i <= 50; i += 1) baris.push(`Produk Rusak ${i},Minuman Impor,bukan-angka`);

  const res = await post('/catalog/import', { csv: baris.join('\n'), dryRun: false });
  assert.equal(res.statusCode, 200, res.body);

  const b = JSON.parse(res.body);
  assert.equal(b.diimpor, 195);
  assert.equal(b.masalah.length, 50);
});

test('⛔ dryRun juga ditolak — pratinjau harus mencerminkan yang akan dijalankan', async () => {
  // Pratinjau yang berkata "201 akan diimpor" lalu ditolak saat dijalankan
  // adalah pratinjau yang berbohong tentang satu-satunya hal yang ditanyakan.
  const res = await post('/catalog/import', { csv: csvBaris(201) });
  assert.equal(res.statusCode, 403, res.body);
});

test('berkas yang tidak dapat dibaca tetap 400, bukan penolakan kuota', async () => {
  // Urutannya penting: berkas rusak adalah permintaan yang cacat, dan
  // menjawabnya dengan "kuota habis" mengirim merchant memburu masalah yang
  // salah.
  const res = await post('/catalog/import', { csv: 'produk;kategori;harga', dryRun: false });
  assert.equal(res.statusCode, 400, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'IMPORT_FILE_INVALID');
});

// --- max_products: jalur satuan --------------------------------------------

test('POST /items ditolak saat kuota produk penuh', async () => {
  await setelKuota('max_products', 1);

  const buat = (nama) =>
    post('/items', {
      id: crypto.randomUUID(),
      name: nama,
      variations: [{ id: crypto.randomUUID(), name: 'Regular', price: '10000' }],
    });

  assert.equal((await buat('Kopi Satu')).statusCode, 201);
  const res = await buat('Kopi Dua');
  assert.equal(res.statusCode, 403, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'QUOTA_EXCEEDED');
});

test('⛔ produk yang DIARSIPKAN mengembalikan slotnya', async () => {
  // Katalog tidak pernah di-DELETE (invariant #2). Kalau item terarsip tetap
  // dihitung, kuota menjadi penghitung seumur hidup yang tidak dapat
  // dipulihkan dengan cara apa pun yang tersedia bagi merchant.
  await setelKuota('max_products', 1);
  const id = crypto.randomUUID();
  assert.equal(
    (
      await post('/items', {
        id,
        name: 'Kopi Arsip',
        variations: [{ id: crypto.randomUUID(), name: 'Regular', price: '10000' }],
      })
    ).statusCode,
    201
  );

  assert.equal((await post(`/items/${id}/archive`, {})).statusCode, 200);

  const res = await post('/items', {
    id: crypto.randomUUID(),
    name: 'Kopi Baru',
    variations: [{ id: crypto.randomUUID(), name: 'Regular', price: '10000' }],
  });
  assert.equal(res.statusCode, 201, res.body);
});

// --- max_outlets -----------------------------------------------------------

test('⛔ outlet kedua ditolak di paket free (kuota 1)', async () => {
  // Outlet pertama lahir bersama tenant, jadi tier gratis sudah penuh sejak
  // detik pendaftaran — dan itu memang maksudnya.
  const res = await post('/outlets', {
    id: crypto.randomUUID(),
    name: 'Cabang Dua',
    timezone: 'Asia/Jakarta',
  });
  assert.equal(res.statusCode, 403, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'QUOTA_EXCEEDED');
});

test('outlet kedua diterima setelah kuota dinaikkan', async () => {
  await setelKuota('max_outlets', 2);
  const id = crypto.randomUUID();
  const res = await post('/outlets', { id, name: 'Cabang Dua', timezone: 'Asia/Makassar' });
  assert.equal(res.statusCode, 201, res.body);

  const rows = await lihat('SELECT timezone FROM outlet WHERE id = $1', [id]);
  assert.equal(rows[0].timezone, 'Asia/Makassar');
});

test('⛔ hanya Owner yang boleh membuat outlet (spec-f:29-30)', async () => {
  await setelKuota('max_outlets', 5);
  await setelKuota('max_users', 5);

  const kasirId = crypto.randomUUID();
  assert.equal(
    (
      await post('/users', {
        id: kasirId,
        name: 'Kasir',
        roles: [{ role: 'cashier', scopeType: 'outlet', scopeId: tenant.outletId }],
        outletIds: [tenant.outletId],
      })
    ).statusCode,
    201
  );

  const res = await post(
    '/outlets',
    { id: crypto.randomUUID(), name: 'Cabang Kasir', timezone: 'Asia/Jakarta' },
    { 'x-actor-id': kasirId }
  );
  assert.equal(res.statusCode, 403, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'FORBIDDEN', 'kuota menutupi penolakan RBAC');
});

// --- max_users -------------------------------------------------------------

test('⛔ pengguna ketiga ditolak di paket free (kuota 3, owner sudah satu)', async () => {
  const buat = (nama) =>
    post('/users', {
      id: crypto.randomUUID(),
      name: nama,
      roles: [{ role: 'cashier', scopeType: 'outlet', scopeId: tenant.outletId }],
      outletIds: [tenant.outletId],
    });

  assert.equal((await buat('Kasir Satu')).statusCode, 201);
  assert.equal((await buat('Kasir Dua')).statusCode, 201);

  const res = await buat('Kasir Tiga');
  assert.equal(res.statusCode, 403, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'QUOTA_EXCEEDED');
});

test('⛔ pengguna yang dinonaktifkan mengembalikan slotnya', async () => {
  const id = crypto.randomUUID();
  const buat = (userId, nama) =>
    post('/users', {
      id: userId,
      name: nama,
      roles: [{ role: 'cashier', scopeType: 'outlet', scopeId: tenant.outletId }],
      outletIds: [tenant.outletId],
    });

  assert.equal((await buat(id, 'Kasir Satu')).statusCode, 201);
  assert.equal((await buat(crypto.randomUUID(), 'Kasir Dua')).statusCode, 201);
  assert.equal((await buat(crypto.randomUUID(), 'Kasir Tiga')).statusCode, 403);

  const nonaktif = await app.inject({
    method: 'PATCH',
    url: `/users/${id}`,
    payload: { isActive: false },
    headers: H(),
  });
  assert.equal(nonaktif.statusCode, 200, nonaktif.body);

  assert.equal((await buat(crypto.randomUUID(), 'Kasir Empat')).statusCode, 201);
});

// --- max_devices -----------------------------------------------------------

test('⛔ perangkat ketiga ditolak di paket free (kuota 2)', async () => {
  const buat = (kode) =>
    post('/devices', { id: crypto.randomUUID(), outletId: tenant.outletId, code: kode });

  assert.equal((await buat('K1')).statusCode, 201);
  assert.equal((await buat('K2')).statusCode, 201);

  const res = await buat('K3');
  assert.equal(res.statusCode, 403, res.body);
  assert.equal(JSON.parse(res.body).error.code, 'QUOTA_EXCEEDED');
});

test('⛔ perangkat yang DICABUT mengembalikan slotnya', async () => {
  // `research/09` § 6 menulis perilakunya: "Tolak; tawarkan mencabut device
  // lama". Tawaran itu tidak menyelesaikan apa pun kalau yang dicabut tetap
  // dihitung.
  const idPertama = crypto.randomUUID();
  const buat = (id, kode) => post('/devices', { id, outletId: tenant.outletId, code: kode });

  assert.equal((await buat(idPertama, 'K1')).statusCode, 201);
  assert.equal((await buat(crypto.randomUUID(), 'K2')).statusCode, 201);
  assert.equal((await buat(crypto.randomUUID(), 'K3')).statusCode, 403);

  assert.equal((await post(`/devices/${idPertama}/revoke`, {})).statusCode, 200);
  assert.equal((await buat(crypto.randomUUID(), 'K4')).statusCode, 201);
});

// --- isolasi ---------------------------------------------------------------

test('⛔ kuota dibaca dari tenant PEMANGGIL, bukan tenant mana pun', async () => {
  // `tenant` adalah satu-satunya tabel yang DIKECUALIKAN dari RLS. Setiap
  // tabel lain menyaring dirinya sendiri walau `WHERE tenant_id` lupa
  // ditulis; di sini tidak. `SELECT max_products FROM tenant` tanpa WHERE
  // mengembalikan baris setiap merchant.
  const lain = await daftarkanMerchant();
  await appDb.query('UPDATE tenant SET max_products = 5000 WHERE id = $1', [lain.id]);

  const res = await post('/catalog/import', { csv: csvBaris(201), dryRun: false });
  assert.equal(res.statusCode, 403, 'kuota tenant lain terbaca sebagai kuota tenant ini');
  assert.match(JSON.parse(res.body).error.message, /200/);
});
