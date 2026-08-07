'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

let db;

before(() => {
  db = new DatabaseSync(':memory:');
  const schema = fs.readFileSync(
    path.join(__dirname, '..', '..', 'db', 'local', '001-initial.sql'),
    'utf8'
  );
  db.exec(schema);
});

after(() => {
  db.close();
});

test('stock_snapshot: 5 kolom NOT NULL, PK komposit (tenant_id, outlet_id, variation_id)', () => {
  const cols = db.prepare('PRAGMA table_info(stock_snapshot)').all();
  assert.equal(cols.length, 5, 'stock_snapshot harus punya persis 5 kolom');

  const byName = Object.fromEntries(cols.map((c) => [c.name, c]));
  for (const name of ['tenant_id', 'outlet_id', 'variation_id', 'balance', 'checkpoint_hlc']) {
    assert.ok(byName[name], `kolom ${name} harus ada`);
    assert.equal(byName[name].notnull, 1, `kolom ${name} harus NOT NULL`);
  }

  const pkCols = cols.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
  assert.deepEqual(pkCols, ['tenant_id', 'outlet_id', 'variation_id']);
});

test('stock_snapshot: WITHOUT ROWID', () => {
  const row = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'stock_snapshot'`)
    .get();
  assert.ok(row, 'stock_snapshot harus ada di sqlite_master');
  assert.match(row.sql, /WITHOUT ROWID/i);
});

test('stock_movement: index ix_mv_hlc pada (tenant_id, outlet_id, hlc)', () => {
  const indexes = db.prepare('PRAGMA index_list(stock_movement)').all();
  const ixMvHlc = indexes.find((i) => i.name === 'ix_mv_hlc');
  assert.ok(ixMvHlc, 'index ix_mv_hlc harus ada di stock_movement');

  const indexCols = db
    .prepare('PRAGMA index_info(ix_mv_hlc)')
    .all()
    .sort((a, b) => a.seqno - b.seqno)
    .map((c) => c.name);
  assert.deepEqual(indexCols, ['tenant_id', 'outlet_id', 'hlc']);
});

// --- item_modifier_list: kolom `id` (prasyarat raw table PowerSync) ---
//
// Bentuk lokal HARUS mengikuti PostgreSQL (migrasi 0018), bukan sekadar
// "punya id". Kalau lokal memakai PK berbeda dari server, baris yang turun
// lewat PowerSync akan bertabrakan dengan cara yang hanya muncul di perangkat
// merchant -- tempat paling mahal untuk menemukannya.

test('item_modifier_list: id sebagai PRIMARY KEY tunggal', () => {
  const cols = db.prepare('PRAGMA table_info(item_modifier_list)').all();
  const byName = Object.fromEntries(cols.map((c) => [c.name, c]));

  assert.ok(byName.id, 'kolom id harus ada -- PowerSync menolak raw table tanpanya');
  assert.equal(byName.id.notnull, 1, 'id harus NOT NULL');

  const pk = cols.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
  assert.deepEqual(pk, ['id'], 'primary key harus pindah ke id, sama seperti PostgreSQL');
});

// Yang menggantikan jaminan PK komposit yang dilepas. Tanpa ini satu item
// dapat menunjuk modifier list yang sama dua kali dan kasir melihat daftar
// modifier ganda -- cacat data yang lahir dari perbaikan masalah PowerSync.
test('item_modifier_list: pasangan (item_id, modifier_list_id) tetap unik', () => {
  // `origin !== 'pk'` bukan kerewelan. Tanpa syarat itu test ini LULUS pada
  // bentuk LAMA juga -- PRIMARY KEY (item_id, modifier_list_id) sendiri sudah
  // menghasilkan index unik atas pasangan itu, jadi test-nya hijau sebelum
  // satu baris pun diubah dan tidak membuktikan apa-apa. Yang harus dijamin
  // adalah pasangan itu terjaga TERPISAH dari primary key, karena primary
  // key-nya kini `id`.
  const idx = db
    .prepare('PRAGMA index_list(item_modifier_list)')
    .all()
    .filter((i) => i.unique === 1 && i.origin !== 'pk');
  const pasangan = idx.find((i) => {
    const cols = db.prepare(`PRAGMA index_info(${JSON.stringify(i.name)})`).all().map((c) => c.name);
    return cols.length === 2 && cols.includes('item_id') && cols.includes('modifier_list_id');
  });
  assert.ok(pasangan, 'tidak ada index unik atas (item_id, modifier_list_id) di luar primary key');
});

// Bentuk saja tidak cukup: index unik yang terdaftar tapi tidak menahan apa
// pun tetap lolos test di atas.
test('item_modifier_list: SQLite MENOLAK pasangan ganda dengan id berbeda', () => {
  db.exec(`INSERT INTO category (id,tenant_id,name) VALUES ('c1','t1','Kopi')`);
  db.exec(`INSERT INTO item (id,tenant_id,name,category_id) VALUES ('i1','t1','Kopi Susu','c1')`);
  db.exec(
    `INSERT INTO modifier_list (id,tenant_id,name,selection_type) VALUES ('m1','t1','Gula','single')`
  );
  db.exec(
    `INSERT INTO item_modifier_list (id,item_id,modifier_list_id,sort_order) VALUES ('b1','i1','m1',0)`
  );

  assert.throws(
    () =>
      db.exec(
        `INSERT INTO item_modifier_list (id,item_id,modifier_list_id,sort_order) VALUES ('b2','i1','m1',1)`
      ),
    /UNIQUE constraint failed/,
    'pasangan ganda tersimpan di database lokal'
  );
});
