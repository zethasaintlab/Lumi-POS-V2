// Minimal migration runner: applies db/migrations/*.sql in filename order,
// each in its own transaction, tracked in schema_migrations (version + the
// app version that shipped it — needed to diagnose on-prem installs that
// are several releases behind, per research/09-MULTITENANCY-DEPLOYMENT.md).
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const pkg = require('../package.json');

async function main() {
  const url = process.env.DATABASE_MIGRATION_URL;
  if (!url) throw new Error('DATABASE_MIGRATION_URL tidak di-set di .env');

  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version     text PRIMARY KEY,
        app_version text NOT NULL,
        applied_at  timestamptz NOT NULL DEFAULT now()
      )
    `);

    const dir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

    const { rows: applied } = await client.query('SELECT version FROM schema_migrations');
    const appliedSet = new Set(applied.map((r) => r.version));

    for (const file of files) {
      const version = file.replace(/\.sql$/, '');
      if (appliedSet.has(version)) {
        console.log(`skip  ${version} (sudah diterapkan)`);
        continue;
      }

      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version, app_version) VALUES ($1, $2)', [
          version,
          pkg.version,
        ]);
        await client.query('COMMIT');
        console.log(`apply ${version}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migrasi ${version} gagal: ${err.message}`);
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
