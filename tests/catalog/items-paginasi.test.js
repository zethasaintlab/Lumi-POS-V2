'use strict';

// Utang G1 — paginasi & pencarian katalog sisi server (B-06/B-08/B-09/B-10).
//
// ⛔ Test terpenting di berkas ini adalah yang PERTAMA: tanpa `limit`, seluruh
// baris dikembalikan. `limit` dengan nilai bawaan membuat klien lama menerima
// 100 dari 5.000 produk lalu menampilkan katalog yang terpotong TANPA satu pun
// error — dan kasir yang tidak menemukan produknya akan menyalahkan
// katalognya, bukan aplikasinya.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedTenantBase } = require('../isolation/helpers/seed');

let owner, appSetup, app, tenant, base;

before(async () => {
  owner = await connectAsOwner();
  appSetup = await connectAsApp();
});

after(async () => {
  await resetAll(owner);
  await owner.end();
  await appSetup.end();
  if (app) await app.close();
});

beforeEach(async () => {
  await resetAll(owner);
  base = await seedTenantBase(appSetup, { suffix: 'Paginasi' });
  tenant = base.tenant;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();
});

function req(method, url, payload) {
  return app.inject({
    method,
    url,
    payload,
    headers: { 'x-tenant-id': tenant.id, authorization: base.authHeader },
  });
}

async function buatItem(nama, { deskripsi } = {}) {
  const id = crypto.randomUUID();
  const res = await req('POST', '/items', {
    id,
    name: nama,
    description: deskripsi,
    variations: [{ id: crypto.randomUUID(), price: 25000 }],
  });
  assert.equal(res.statusCode, 201, res.body);
  return id;
}

async function daftar(qs = '') {
  const res = await req('GET', `/items${qs}`);
  assert.equal(res.statusCode, 200, res.body);
  return JSON.parse(res.body);
}

/**
 * ⛔ `seedTenantBase` sudah membuat item sendiri, dan jumlahnya bukan urusan
 * berkas ini. Setiap test memakai TOKEN unik dalam nama produknya lalu
 * menghitung yang cocok saja — angka absolut akan merah pada hari seed
 * berubah, dan itu kegagalan yang menunjuk ke tempat yang salah.
 */
let urutanToken = 0;
const tokenBaru = () => `zq${++urutanToken}${Date.now().toString(36)}`;

async function jumlahAwal() {
  return (await daftar()).items.length;
}

// ---------------------------------------------------------------------------

test('⛔ TANPA `limit`, seluruh baris dikembalikan — klien N-1 tidak terpotong', async () => {
  const awal = await jumlahAwal();
  for (let i = 0; i < 12; i += 1) await buatItem(`Produk ${i}`);

  const b = await daftar();
  assert.equal(b.items.length, awal + 12);
  assert.equal(b.nextCursor, null, 'tanpa paginasi tidak ada kursor');
});

test('limit memotong, dan nextCursor menyusuri SELURUH katalog tepat sekali', async () => {
  const dibuat = [];
  for (let i = 0; i < 7; i += 1) dibuat.push(await buatItem(`Produk ${i}`));
  const total = (await daftar()).items.length;

  const terlihat = [];
  let kursor = null;
  let halaman = 0;
  for (; halaman < 50; halaman += 1) {
    const qs = kursor ? `?limit=3&after=${encodeURIComponent(kursor)}` : '?limit=3';
    const h = await daftar(qs);
    assert.ok(h.items.length <= 3, 'limit dihormati');
    terlihat.push(...h.items.map((i) => i.id));
    kursor = h.nextCursor;
    // ⛔ `null` di halaman terakhir. Kursor yang tetap terisi membuat klien
    // meminta halaman kosong selamanya.
    if (!kursor) break;
  }
  assert.ok(halaman < 49, 'penyusuran berhenti sendiri');

  // ⛔ Tanpa satu pun baris hilang atau ganda.
  assert.equal(terlihat.length, total, 'tidak ada baris yang hilang');
  assert.equal(new Set(terlihat).size, total, 'tidak ada baris yang muncul dua kali');
  for (const id of dibuat) assert.ok(terlihat.includes(id), `item ${id} hilang`);
});

test('⛔ item ber-`sort_order` SERI tidak hilang antar halaman', async () => {
  // `sort_order` DEFAULT 0, jadi katalog yang belum diurutkan seluruhnya seri.
  // Keyset yang membandingkan `sort_order` saja akan melompati sisa baris
  // ber-nilai sama — dan gejalanya adalah produk yang lenyap dari daftar
  // tanpa satu pun error.
  const dibuat = [];
  for (let i = 0; i < 6; i += 1) dibuat.push(await buatItem(`Seri ${i}`));

  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  await appSetup.query('UPDATE item SET sort_order = 0');
  await appSetup.query('COMMIT');

  const total = (await daftar()).items.length;
  const terlihat = [];
  let kursor = null;
  for (let putaran = 0; putaran < 50; putaran += 1) {
    const qs = kursor ? `?limit=2&after=${encodeURIComponent(kursor)}` : '?limit=2';
    const h = await daftar(qs);
    terlihat.push(...h.items.map((i) => i.id));
    kursor = h.nextCursor;
    if (!kursor) break;
  }

  assert.equal(new Set(terlihat).size, total, 'seluruh baris terlihat meski sort_order seri');
  for (const id of dibuat) assert.ok(terlihat.includes(id), `item ${id} hilang`);
});

test('pencarian `q` mencocokkan POTONGAN kata, tanpa peka huruf besar', async () => {
  const t = tokenBaru();
  await buatItem(`Kopi Susu ${t}`);
  await buatItem(`Teh Tarik ${t}`);

  const b = await daftar(`?q=${t}`);
  assert.equal(b.items.length, 2, 'token unik menyaring item dari seed');

  // Potongan kata, bukan kata utuh.
  assert.equal((await daftar(`?q=${t.slice(0, 4)}`)).items.length, 2);
  // Tidak peka huruf besar.
  assert.equal((await daftar(`?q=${t.toUpperCase()}`)).items.length, 2);
  assert.equal((await daftar('?q=zzzTidakAdaSamaSekali')).items.length, 0);
});

test('pencarian juga menyentuh deskripsi', async () => {
  const t = tokenBaru();
  await buatItem('Menu Rahasia', { deskripsi: `kopi dingin ${t}` });
  const b = await daftar(`?q=${t}`);
  assert.equal(b.items.length, 1);
  assert.equal(b.items[0].name, 'Menu Rahasia');
});

test('⛔ `%` dan `_` di masukan di-ESCAPE, bukan diteruskan sebagai wildcard', async () => {
  // Merchant yang mencari "50%" tidak boleh mendapat SELURUH katalog.
  await buatItem('Diskon 50% Akhir Tahun');
  await buatItem('Teh Tarik');
  await buatItem('Kopi Susu');
  const total = (await daftar()).items.length;

  const persen = await daftar('?q=' + encodeURIComponent('50%'));
  assert.equal(persen.items.length, 1, '`%` harus literal, bukan "cocokkan apa saja"');
  assert.notEqual(persen.items.length, total, 'wildcard yang lolos mengembalikan SELURUH katalog');
  assert.match(persen.items[0].name, /50%/);

  // `_` mencocokkan satu karakter apa pun bila tidak di-escape: "T_h" akan
  // mencocokkan "Teh".
  const garis = await daftar('?q=' + encodeURIComponent('T_h'));
  assert.equal(garis.items.length, 0, '`_` harus literal');
});

test('⛔ pencarian menemukan SKU dan BARCODE varian, sama seperti B-06', async () => {
  // `saringProduk` di back-office sudah mencarinya sejak B-06 lahir:
  // "merchant mencari produk lewat kode yang tertempel di rak". Server yang
  // hanya mencari nama item membuat layar yang berpindah ke pencarian sisi
  // server diam-diam berhenti menemukan barcode — kasir memindai, tidak ada
  // yang muncul, tanpa satu pun error.
  const t = tokenBaru();
  const id = crypto.randomUUID();
  const res = await req('POST', '/items', {
    id,
    name: 'Produk Tanpa Petunjuk',
    variations: [
      { id: crypto.randomUUID(), name: 'Regular', price: 1000, sku: `SKU-${t}`, barcode: `899${t}` },
    ],
  });
  assert.equal(res.statusCode, 201, res.body);
  await buatItem('Pengecoh');

  const lewatSku = await daftar(`?q=${encodeURIComponent(`SKU-${t}`)}`);
  assert.equal(lewatSku.items.length, 1);
  assert.equal(lewatSku.items[0].id, id);

  const lewatBarcode = await daftar(`?q=${encodeURIComponent(`899${t}`)}`);
  assert.equal(lewatBarcode.items.length, 1);
  assert.equal(lewatBarcode.items[0].id, id);

  // Nama varian juga — "Besar" adalah kata yang merchant ketik.
  const idBesar = crypto.randomUUID();
  const r2 = await req('POST', '/items', {
    id: idBesar,
    name: 'Es Teh',
    variations: [{ id: crypto.randomUUID(), name: `Jumbo${t}`, price: 1000 }],
  });
  assert.equal(r2.statusCode, 201, r2.body);
  const lewatVarian = await daftar(`?q=${encodeURIComponent(`Jumbo${t}`)}`);
  assert.equal(lewatVarian.items.length, 1);
  assert.equal(lewatVarian.items[0].id, idBesar);
});

test('pencarian dan kategori dapat digabung', async () => {
  const kategoriId = crypto.randomUUID();
  const k = await req('POST', '/categories', { id: kategoriId, name: 'Minuman' });
  assert.equal(k.statusCode, 201, k.body);

  const id = crypto.randomUUID();
  const res = await req('POST', '/items', {
    id,
    name: 'Kopi Kategori',
    categoryId: kategoriId,
    variations: [{ id: crypto.randomUUID(), price: 1000 }],
  });
  assert.equal(res.statusCode, 201, res.body);
  await buatItem('Kopi Tanpa Kategori');

  const b = await daftar(`?q=Kopi&categoryId=${kategoriId}`);
  assert.equal(b.items.length, 1);
  assert.equal(b.items[0].id, id);
});

test('arsip tetap disaring saat mencari', async () => {
  const id = await buatItem('Kopi Arsip');
  const arsip = await req('POST', `/items/${id}/archive`, {});
  assert.equal(arsip.statusCode, 200, arsip.body);

  assert.equal((await daftar('?q=arsip')).items.length, 0);
  assert.equal((await daftar('?q=arsip&includeArchived=true')).items.length, 1);
});

test('⛔ limit di luar batas ditolak 400, bukan diterima diam-diam', async () => {
  // `limit` yang diteruskan apa adanya membuat satu permintaan menarik seluruh
  // katalog ke memori server.
  for (const nilai of ['0', '-1', '201', '1000000', 'banyak', '1.5']) {
    const res = await req('GET', `/items?limit=${encodeURIComponent(nilai)}`);
    assert.equal(res.statusCode, 400, `${nilai}: ${res.body}`);
  }
  assert.equal((await req('GET', '/items?limit=200')).statusCode, 200, 'batas atas diterima');
});

test('kursor cacat ditolak 400, bukan 500', async () => {
  for (const nilai of ['bukan-kursor', ':abc', '5:', 'abc:def']) {
    const res = await req('GET', `/items?limit=2&after=${encodeURIComponent(nilai)}`);
    assert.equal(res.statusCode, 400, `${nilai}: ${res.body}`);
  }
});

test('⛔ varian ikut LENGKAP meski diambil dalam satu query', async () => {
  // N+1 yang dihapus tidak boleh menghapus datanya juga. Ini yang membedakan
  // "lebih cepat" dari "lebih cepat karena tidak mengambil apa-apa".
  const id = crypto.randomUUID();
  const res = await req('POST', '/items', {
    id,
    name: 'Kopi Tiga Ukuran',
    variations: [
      { id: crypto.randomUUID(), name: 'Kecil', price: 18000 },
      { id: crypto.randomUUID(), name: 'Sedang', price: 25000 },
      { id: crypto.randomUUID(), name: 'Besar', price: 32000 },
    ],
  });
  assert.equal(res.statusCode, 201, res.body);
  await buatItem('Teh');

  const b = await daftar();
  const kopi = b.items.find((i) => i.id === id);
  assert.equal(kopi.variations.length, 3);
  assert.deepEqual(
    kopi.variations.map((v) => v.name),
    ['Kecil', 'Sedang', 'Besar'],
    'urutannya tetap sort_order, bukan urutan yang kebetulan dikembalikan scan'
  );

  // Item lain tidak kebagian varian milik tetangganya — kesalahan paling
  // mudah dilakukan saat membatch: satu Map yang salah kunci.
  const teh = b.items.find((i) => i.id !== id && i.name === 'Teh');
  assert.equal(teh.variations.length, 1);
});

test('⛔ isolasi tenant: pencarian tidak menembus tenant lain', async () => {
  await buatItem('Kopi Rahasia');
  const lain = await seedTenantBase(appSetup, { suffix: 'PaginasiLain' });

  const res = await app.inject({
    method: 'GET',
    url: '/items?q=rahasia',
    headers: { 'x-tenant-id': lain.tenant.id, authorization: lain.authHeader },
  });
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(JSON.parse(res.body).items, []);
});
