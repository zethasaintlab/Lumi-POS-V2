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
