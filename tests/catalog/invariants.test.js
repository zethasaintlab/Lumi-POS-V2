'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { readdir, readFile } = require('node:fs/promises');
const path = require('node:path');
const { connectAsOwner, connectAsApp } = require('../isolation/helpers/db');
const { resetAll } = require('../isolation/helpers/reset');
const { seedBareTenant } = require('../isolation/helpers/seed');

// Task 6 — spec-a-katalog.md § A.8: property test + grep guard yang tidak
// dicakup test lain (tests/catalog/items.test.js dkk menguji perilaku HTTP
// per-endpoint, bukan invariant lintas-modul).

const CATALOG_MODULE_DIR = path.join(__dirname, '../../apps/server/src/modules/catalog');
const OPENAPI_PATH = path.join(__dirname, '../../packages/contracts/openapi.yaml');

// Rekursif: kumpulkan semua file .ts di bawah `dir`. Disebut di
// task-6-brief.md tapi tidak didefinisikan di sana -- modules/catalog punya
// subdirektori handlers/, jadi versi non-rekursif tidak cukup.
async function collectTsFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectTsFiles(full)));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
}

// Koneksi DB hanya dipakai oleh test property di bawah (satu-satunya dari
// keempat test yang butuh server + database). Tiga test grep guard murni
// baca file, jadi sengaja TIDAK ditaruh di beforeEach global -- supaya tetap
// jalan cepat dan tidak butuh DB kalau suatu saat dipisah/dijalankan sendiri.
let owner, appSetup, app;

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

// spec-a-katalog.md § A.8 property test: "Untuk Item apa pun: jumlah
// variation >= 1" -- createItem menyisipkan item + variation pertamanya
// dalam satu transaksi (invariant #1), jadi tidak boleh pernah ada state
// Item-tanpa-variation yang tersimpan, untuk berapa pun jumlah variation
// awal yang diminta.
test('property: setiap Item yang berhasil dibuat selalu punya >= 1 variation', async () => {
  await resetAll(owner);
  // seedBareTenant (bukan seedTenantBase) dengan sengaja: seedTenantBase juga
  // menyisipkan item2 ("Kopi Hitam") lewat SQL langsung TANPA variation --
  // fixture itu punya tujuannya sendiri (target impersonation lintas-tenant
  // untuk item_modifier_list di tests/isolation/helpers/tables.js), bukan
  // pelanggaran invariant createItem. Property test ini menguji jalur API
  // createItem, bukan "setiap baris item di DB manapun asalnya", jadi
  // tenant harus mulai kosong supaya listing di bawah cuma berisi item yang
  // dibuat lewat request POST /items di sini.
  const tenant = await seedBareTenant(appSetup, { suffix: 'InvariantTest' });
  const { buildApp } = await import('../../apps/server/src/app.ts');
  if (app) await app.close();
  app = await buildApp();

  function req(method, url, payload) {
    return app.inject({ method, url, payload, headers: { 'x-tenant-id': tenant.id } });
  }

  for (let n = 1; n <= 5; n += 1) {
    const itemId = crypto.randomUUID();
    const variations = Array.from({ length: n }, () => ({ id: crypto.randomUUID(), price: 1000 }));
    const res = await req('POST', '/items', { id: itemId, name: `Item ${n}`, variations });
    assert.equal(res.statusCode, 201);
    assert.ok(JSON.parse(res.body).variations.length >= 1);
  }

  // n=0 secara eksplisit: brief (task-6-brief.md) hanya mencontohkan loop
  // n=1..5, yang TIDAK PERNAH memanggil ITEM_NO_VARIATION -- jadi menghapus
  // guard itu tidak akan membuat loop di atas merah sama sekali (dibuktikan
  // saat sabotase, lihat task-6-report.md). Baris ini yang benar-benar
  // membuktikan invariant "jumlah variation >= 1 untuk Item apa pun": kalau
  // guard ITEM_NO_VARIATION hilang/rusak, request ini akan diterima (201)
  // dengan 0 variation dan assert di bawah gagal.
  const zeroRes = await req('POST', '/items', { id: crypto.randomUUID(), name: 'Kosong', variations: [] });
  assert.equal(
    zeroRes.statusCode,
    400,
    'item dengan 0 variation harus ditolak -- guard ITEM_NO_VARIATION hilang atau rusak'
  );

  const listed = await req('GET', '/items');
  assert.equal(listed.statusCode, 200);
  const items = JSON.parse(listed.body).items;
  assert.ok(items.length >= 5, 'kelima item yang dibuat harus muncul di listing');
  for (const item of items) {
    assert.ok(item.variations.length >= 1, `item ${item.id} tanpa variation`);
  }
});

// spec-a-katalog.md § A.8 / FR-A6: "Tidak ada DELETE pada tabel katalog di
// seluruh kode modul". Satu pengecualian yang disetujui: item_modifier_list
// (bridge N:M tanpa kolom archived_at -- lihat detachModifierList di
// handlers/item-modifier-lists.ts dan task-5-report.md). Setiap tabel
// katalog lain (item, item_variation, category, modifier_list, modifier)
// hanya boleh archived_at, tidak pernah DELETE.
test('tidak ada DELETE SQL pada tabel katalog di modules/catalog, kecuali item_modifier_list', async () => {
  const files = await collectTsFiles(CATALOG_MODULE_DIR);
  assert.ok(files.length > 0, 'collectTsFiles tidak menemukan file .ts -- cek path CATALOG_MODULE_DIR');
  let deleteStatementsSeen = 0;
  for (const file of files) {
    const src = await readFile(file, 'utf8');
    // \s+ (bukan hanya spasi) supaya statement yang diformat lintas baris --
    // DELETE dan FROM di baris berbeda -- tetap tertangkap, bukan cuma
    // bentuk satu-baris yang kebetulan ada di kode saat ini.
    const deletes = src.match(/DELETE\s+FROM\s+(\w+)/gi) ?? [];
    for (const stmt of deletes) {
      deleteStatementsSeen += 1;
      const table = stmt.trim().split(/\s+/)[2].toLowerCase();
      assert.equal(
        table,
        'item_modifier_list',
        `DELETE FROM ${table} di ${file} melanggar FR-A6 -- tabel katalog hanya diarsipkan, tidak dihapus`
      );
    }
  }
  assert.ok(deleteStatementsSeen > 0, 'tidak ada DELETE ditemukan sama sekali -- pastikan guard ini benar-benar memeriksa sesuatu');
});

// ARCH invariant #4 dan #8: tidak ada akses database lintas modul, dan
// aplikasi connect sebagai user yang tunduk RLS lewat SET LOCAL per
// transaksi -- keduanya hanya terjamin kalau setiap tulis lewat
// withTenantTransaction, bukan pool.query/pool.connect langsung.
test('tidak ada pool.query / pool.connect langsung di modules/catalog', async () => {
  const files = await collectTsFiles(CATALOG_MODULE_DIR);
  for (const file of files) {
    const src = await readFile(file, 'utf8');
    assert.equal(/pool\.(query|connect)\s*\(/.test(src), false, `akses pool langsung di ${file}`);
  }
});

// CLAUDE.md -- larangan kolom image_url (tidak ada di konvensi data / design
// system Lumi POS). Harus tidak pernah bocor ke kode modul maupun ke
// kontrak OpenAPI publik.
test('image_url tidak pernah muncul di kode modul maupun kontrak OpenAPI', async () => {
  const files = await collectTsFiles(CATALOG_MODULE_DIR);
  for (const file of files) {
    assert.equal((await readFile(file, 'utf8')).includes('image_url'), false, `image_url di ${file}`);
  }
  const spec = await readFile(OPENAPI_PATH, 'utf8');
  assert.equal(/imageUrl|image_url/.test(spec), false, 'image_url bocor ke kontrak OpenAPI');
});
