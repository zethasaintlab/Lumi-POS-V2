// One-time-per-cluster bootstrap: creates the lumi_owner/lumi_app roles and
// the lumi database. Must run with real superuser privileges (DATABASE_ADMIN_URL).
// Role/database creation can't live in the numbered migration chain — lumi_owner
// can't create itself, and CREATE DATABASE can't run inside a transaction block.
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

function parsePgUrl(str, label) {
  if (!str) throw new Error(`${label} tidak di-set di .env`);
  const u = new URL(str);
  return {
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    host: u.hostname,
    port: u.port ? Number(u.port) : 5432,
    database: decodeURIComponent(u.pathname.slice(1)),
  };
}

function escapeSqlLiteral(value) {
  return value.replace(/'/g, "''");
}

async function main() {
  const admin = parsePgUrl(process.env.DATABASE_ADMIN_URL, 'DATABASE_ADMIN_URL');
  const owner = parsePgUrl(process.env.DATABASE_MIGRATION_URL, 'DATABASE_MIGRATION_URL');
  const app = parsePgUrl(process.env.DATABASE_URL, 'DATABASE_URL');

  if (!IDENTIFIER_RE.test(owner.database) || owner.database !== app.database) {
    throw new Error('DATABASE_MIGRATION_URL dan DATABASE_URL harus menunjuk ke database yang sama, nama valid.');
  }
  const dbName = owner.database;

  const client = new Client({
    host: admin.host,
    port: admin.port,
    user: admin.user,
    password: admin.password,
    database: admin.database,
  });
  await client.connect();

  try {
    const template = fs.readFileSync(path.join(__dirname, 'bootstrap.sql'), 'utf8');
    const roleSql = template
      .replace(":'lumi_owner_password'", `'${escapeSqlLiteral(owner.password)}'`)
      .replace(":'lumi_app_password'", `'${escapeSqlLiteral(app.password)}'`);
    await client.query(roleSql);
    console.log('Role lumi_owner/lumi_app siap.');

    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (rowCount === 0) {
      // CREATE DATABASE tidak bisa berjalan di dalam blok transaksi — query terpisah.
      await client.query(`CREATE DATABASE "${dbName}" OWNER lumi_owner`);
      console.log(`Database "${dbName}" dibuat, owner lumi_owner.`);
    } else {
      console.log(`Database "${dbName}" sudah ada, dilewati.`);
    }

    await client.query(`GRANT CONNECT ON DATABASE "${dbName}" TO lumi_app`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
