import pg from 'pg';

const { Pool } = pg;
export type { Pool, PoolClient } from 'pg';

export function createPool(): InstanceType<typeof Pool> {
  return new Pool({ connectionString: process.env.DATABASE_URL });
}

export async function withTenantTransaction<T>(
  pool: InstanceType<typeof Pool>,
  tenantId: string,
  fn: (client: import('pg').PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
