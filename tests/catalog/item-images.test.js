'use strict';

// ⛔ `PUT/GET/DELETE /items/{itemId}/image` — dan yang paling penting di sini
// BUKAN bahwa unggahannya berhasil, melainkan bahwa `byte` dan `checksum` yang
// tersimpan dihitung SERVER dari teks yang benar-benar ia simpan.
//
// Klien yang mengirim checksumnya sendiri membuat verifikasi perangkat
// memeriksa klaim klien terhadap dirinya sendiri: muatan yang rusak DI KLIEN
// datang dengan checksum yang cocok dengan kerusakannya, dan perangkat
// menyebutnya utuh. Yang dilindungi adalah perjalanan dari SERVER ke
// perangkat, jadi titik awalnya harus di server.

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
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
  base = await seedTenantBase(appSetup, { suffix: 'GbrTest' });
  tenant = base.tenant;
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();
});

const hdr = () => ({ 'x-tenant-id': tenant.id, authorization: base.authHeader });

/**
 * Pembacaan langsung ke tabel, DI DALAM konteks tenant.
 *
 * ⛔ `SET LOCAL app.tenant_id` berlaku PER TRANSAKSI (invariant #8), jadi
 * `query()` telanjang menjalankan transaksi implisit tanpa tenant dan RLS
 * mengembalikan NOL BARIS — bukan error. Test yang mengabaikannya hijau
 * dengan alasan yang salah kalau ekspektasinya kebetulan nol, dan merah
 * dengan sebab yang menyesatkan kalau bukan.
 */
async function baris(sql, params = []) {
  await appSetup.query('BEGIN');
  await appSetup.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenant.id]);
  try {
    const { rows } = await appSetup.query(sql, params);
    return rows;
  } finally {
    await appSetup.query('COMMIT');
  }
}
const put = (url, payload) => app.inject({ method: 'PUT', url, payload, headers: hdr() });
const get = (url) => app.inject({ method: 'GET', url, headers: hdr() });
const del = (url) => app.inject({ method: 'DELETE', url, headers: hdr() });

/** Muatan base64 sah `n` byte. Isinya tidak penting — server tidak men-decode. */
const b64 = (n, isi = 0x57) => Buffer.alloc(n, isi).toString('base64');

test('PUT menyimpan gambar; GET mengembalikan byte yang IDENTIK', async () => {
  const isi = b64(2000, 0x5a);
  const res = await put(`/items/${base.item.id}/image`, {
    data: isi,
    width: 400,
    height: 400,
  });
  assert.equal(res.statusCode, 201, res.body);

  const baca = await get(`/items/${base.item.id}/image`);
  assert.equal(baca.statusCode, 200);
  assert.equal(baca.headers['content-type'], 'image/webp');
  // ⛔ Dibandingkan BYTE PER BYTE, bukan lewat panjang. Panjang yang sama
  // dengan isi yang berbeda adalah persis bentuk kerusakan yang `checksum` ada
  // untuk menangkap.
  assert.deepEqual(baca.rawPayload, Buffer.from(isi, 'base64'));
});

test('⛔ `byte` dan `checksum` DIHITUNG SERVER, bukan diterima dari klien', async () => {
  const isi = b64(1200);
  await put(`/items/${base.item.id}/image`, { data: isi, width: 400, height: 400 });

  const rows = await baris(
    `SELECT byte, checksum, data_base64, mime FROM item_image WHERE id = $1`,
    [base.item.id]
  );
  assert.equal(rows.length, 1);

  const { byteDariBase64, checksumGambar } = await import(
    '../../packages/domain/src/gambar-produk.ts'
  );
  assert.equal(Number(rows[0].byte), byteDariBase64(isi));
  assert.equal(rows[0].checksum, checksumGambar(isi));
  // Dan teksnya disimpan APA ADANYA — server tidak pernah men-decode lalu
  // menyandikan ulang. Setiap pertukaran biner↔teks adalah satu titik lagi
  // tempat 15 byte dapat menjadi 4.
  assert.equal(rows[0].data_base64, isi);
  assert.equal(rows[0].mime, 'image/webp');
});

test('⛔ nilai `byte`/`checksum` dari KLIEN diabaikan sepenuhnya', async () => {
  // Sabotase: klien mengirim angka yang cocok dengan kerusakannya sendiri.
  const isi = b64(900);
  await put(`/items/${base.item.id}/image`, {
    data: isi,
    width: 400,
    height: 400,
    byte: 4,
    checksum: 'deadbeef',
  });

  const rows = await baris(
    'SELECT byte, checksum FROM item_image WHERE id = $1', [
    base.item.id,
  ]);
  const { byteDariBase64, checksumGambar } = await import(
    '../../packages/domain/src/gambar-produk.ts'
  );
  assert.equal(Number(rows[0].byte), byteDariBase64(isi));
  assert.notEqual(rows[0].checksum, 'deadbeef');
  assert.equal(rows[0].checksum, checksumGambar(isi));
});

test('unggah ulang MEMPERBARUI barisnya (UPSERT), 200 bukan 201', async () => {
  const item = base.item.id;
  assert.equal((await put(`/items/${item}/image`, { data: b64(800) })).statusCode, 201);

  const kedua = b64(1600, 0x31);
  const res = await put(`/items/${item}/image`, { data: kedua });
  // ⛔ 200, bukan 409 `ID_ALREADY_EXISTS`. Invariant #2 menjaga transaksi
  // selesai dan katalog; gambar bukan keduanya — ia setelan tampilan, sejajar
  // `peripheral` yang pengiriman ulangnya memperbarui barisnya.
  assert.equal(res.statusCode, 200, res.body);

  const rows = await baris(
    'SELECT count(*)::int n FROM item_image WHERE id = $1', [
    item,
  ]);
  assert.equal(rows[0].n, 1, 'unggah ulang membuat baris KEDUA');
  assert.deepEqual((await get(`/items/${item}/image`)).rawPayload, Buffer.from(kedua, 'base64'));
});

test('⛔ melewati batas ditolak dengan kode TERLALU_BESAR, bukan VALIDATION_ERROR', async () => {
  const { BATAS_BYTE } = await import('../../packages/domain/src/gambar-produk.ts');
  const res = await put(`/items/${base.item.id}/image`, { data: b64(BATAS_BYTE + 3000) });
  assert.equal(res.statusCode, 400);
  const galat = JSON.parse(res.body).error;
  // ⛔ Kodenya DIBEDAKAN: `TERLALU_BESAR` menuntut merchant memotong fotonya,
  // `KOSONG` menuntut ia mengulang unggahannya. Menyamakannya membuang
  // satu-satunya sinyal yang membedakan keduanya.
  assert.equal(galat.code, 'TERLALU_BESAR');
  assert.match(galat.message, /KB/);
});

test('base64 CACAT ditolak, dan dibedakan dari kosong', async () => {
  const rusak = await put(`/items/${base.item.id}/image`, { data: 'bukan base64!!!' });
  assert.equal(JSON.parse(rusak.body).error.code, 'BASE64_TIDAK_SAH');

  const kosong = await put(`/items/${base.item.id}/image`, { data: '' });
  assert.equal(kosong.statusCode, 400);
  assert.notEqual(JSON.parse(kosong.body).error.code, 'BASE64_TIDAK_SAH');
});

test('⛔ dimensi yang salah ditolak — kartu kasir 1:1, sumbernya harus persegi', async () => {
  const res = await put(`/items/${base.item.id}/image`, {
    data: b64(900),
    width: 800,
    height: 600,
  });
  assert.equal(JSON.parse(res.body).error.code, 'DIMENSI_SALAH');
});

test('GET pada item tanpa gambar → 404, dan DELETE kedua kalinya juga', async () => {
  // ⛔ 404, bukan 200 ber-body kosong. "Item ini belum punya gambar" dan
  // "gambar ini gagal dikirim" harus dapat dibedakan pemanggilnya; body kosong
  // menyamakan keduanya.
  assert.equal((await get(`/items/${base.item.id}/image`)).statusCode, 404);

  await put(`/items/${base.item.id}/image`, { data: b64(700) });
  assert.equal((await del(`/items/${base.item.id}/image`)).statusCode, 204);
  // Merchant yang menekan "Hapus gambar" dua kali harus tahu yang kedua tidak
  // melakukan apa-apa; 204 untuk keduanya membuat "masih ada" dan "sudah
  // hilang" terlihat sama.
  assert.equal((await del(`/items/${base.item.id}/image`)).statusCode, 404);
});

test('⛔ item milik tenant LAIN tidak dapat diberi gambar (FK tidak tunduk RLS)', async () => {
  // Kemunculan KELIMA dari kelas ini di repo ini (`CLAUDE.md` § Temuan F1).
  // FK ke `item(id)` hanya membuktikan barisnya ada di SUATU tenant — dan
  // gambar yang menempel pada item tenant lain akan TURUN ke armada mereka.
  const lain = await seedTenantBase(appSetup, { suffix: 'GbrLain' });
  const res = await put(`/items/${lain.item.id}/image`, { data: b64(900) });
  assert.equal(res.statusCode, 404, 'gambar menempel pada item tenant lain');

  const rows = await baris(
    'SELECT count(*)::int n FROM item_image');
  assert.equal(rows[0].n, 0);
});

test('audit mencatat METADATA saja — tidak pernah byte-nya', async () => {
  await put(`/items/${base.item.id}/image`, { data: b64(1500) });

  const rows = await baris(
    `SELECT before, after FROM audit_event
      WHERE entity_type = 'item_image' AND event_type = 'item_updated'`
  );
  assert.equal(rows.length, 1, 'audit tidak dipancarkan');
  // ⛔ Trail bertahan lima tahun. Menyalin gambar ke dalamnya menggandakan
  // SELURUH anggaran penyimpanan ke tabel yang tidak pernah dibaca untuk itu.
  const teks = JSON.stringify(rows[0]);
  assert.ok(!/data_base64|[A-Za-z0-9+/]{200}/.test(teks), `audit memuat muatan gambar: ${teks}`);
  // `before` menyatakan bahwa sebelumnya tidak ada gambar — bukan menyalin
  // nilai barunya, yang akan lolos setiap test yang hanya memeriksa kolomnya
  // terisi.
  assert.deepEqual(rows[0].before, { gambar: null });
});

test('GET /item-images: metadata untuk daftar produk, TANPA byte-nya', async () => {
  await put(`/items/${base.item.id}/image`, { data: b64(1100) });
  const res = await get('/item-images');
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);

  assert.equal(body.gambar.length, 1);
  assert.equal(body.gambar[0].itemId, base.item.id);
  // ⛔ Layar daftar hanya perlu tahu item mana yang sudah punya gambar.
  // Mengirim blob-nya berarti back-office mengunduh seluruh katalog gambar
  // setiap kali daftar produk dibuka — 19,5 MB untuk sebuah tabel.
  assert.equal(body.gambar[0].data, undefined);
  assert.equal(body.gambar[0].dataBase64, undefined);
  assert.ok(body.gambar[0].byte > 0);
  assert.match(body.gambar[0].checksum, /^[0-9a-f]{8}$/);
});
