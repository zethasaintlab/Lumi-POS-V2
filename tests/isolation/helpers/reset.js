'use strict';

const { TABLES, EXEMPT } = require('./tables');

// TRUNCATE is not subject to RLS at all (unlike ordinary DML) — FORCE ROW
// LEVEL SECURITY does not block it, so this is the correct tool for a full
// reset even though lumi_owner cannot bypass RLS for SELECT/INSERT/UPDATE/DELETE.
async function resetAll(ownerClient) {
  const names = [...TABLES.map((t) => t.name), ...EXEMPT];
  const quoted = names.map((n) => `"${n}"`).join(', ');
  await ownerClient.query(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
}

module.exports = { resetAll };
