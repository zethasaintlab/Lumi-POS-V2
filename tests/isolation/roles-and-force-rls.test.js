'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { connectAsOwner } = require('./helpers/db');
const { TABLES, EXEMPT } = require('./helpers/tables');

// Requirement 2 & 3 dari tests/README.md: user aplikasi tidak BYPASSRLS dan
// bukan owner tabel; FORCE ROW LEVEL SECURITY aktif di setiap tabel ber-RLS.
let owner;

before(async () => {
  owner = await connectAsOwner();
});

after(async () => {
  await owner.end();
});

test('lumi_app tidak punya BYPASSRLS', async () => {
  const { rows } = await owner.query('SELECT rolbypassrls FROM pg_roles WHERE rolname = $1', ['lumi_app']);
  assert.equal(rows.length, 1, 'role lumi_app harus ada');
  assert.equal(rows[0].rolbypassrls, false);
});

test('lumi_app bukan owner tabel apa pun di schema public', async () => {
  const { rows } = await owner.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tableowner = $1`,
    ['lumi_app']
  );
  assert.deepEqual(rows, []);
});

for (const { name } of TABLES) {
  test(`FORCE ROW LEVEL SECURITY aktif di "${name}"`, async () => {
    const { rows } = await owner.query(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class
       WHERE relname = $1 AND relnamespace = 'public'::regnamespace`,
      [name]
    );
    assert.equal(rows.length, 1, `tabel "${name}" harus ada`);
    assert.equal(rows[0].relrowsecurity, true, `"${name}" harus ENABLE ROW LEVEL SECURITY`);
    assert.equal(rows[0].relforcerowsecurity, true, `"${name}" harus FORCE ROW LEVEL SECURITY`);
  });
}

for (const name of EXEMPT) {
  test(`"${name}" sengaja dikecualikan dari RLS (bukan lupa)`, async () => {
    const { rows } = await owner.query(
      `SELECT relrowsecurity FROM pg_class WHERE relname = $1 AND relnamespace = 'public'::regnamespace`,
      [name]
    );
    assert.equal(rows.length, 1, `tabel "${name}" harus ada`);
    assert.equal(rows[0].relrowsecurity, false);
  });
}
