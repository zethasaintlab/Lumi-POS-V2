import pg from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';

const { Pool } = pg;
export type { Pool, PoolClient } from 'pg';

const activeTransaction = new AsyncLocalStorage<true>();

export function createPool(): InstanceType<typeof Pool> {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
  });
}

export async function withTenantTransaction<T>(
  pool: InstanceType<typeof Pool>,
  tenantId: string,
  fn: (client: import('pg').PoolClient) => Promise<T>
): Promise<T> {
  if (activeTransaction.getStore()) {
    throw new Error(
      'withTenantTransaction: dipanggil bersarang di dalam withTenantTransaction lain -- ' +
      'ini akan diam-diam memecah satu operasi logis jadi dua transaksi terpisah. ' +
      'Refactor supaya query tambahan memakai client yang sudah ada, bukan memanggil helper ini lagi.'
    );
  }
  return activeTransaction.run(true, () => runInTenantTransaction(pool, tenantId, fn));
}

async function runInTenantTransaction<T>(
  pool: InstanceType<typeof Pool>,
  tenantId: string,
  fn: (client: import('pg').PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  let clientError: Error | undefined;
  const onClientError = (err: Error) => {
    clientError = err;
  };
  client.on('error', onClientError);

  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    const result = await fn(client);
    const commitResult = await client.query('COMMIT');
    if (commitResult.command === 'ROLLBACK') {
      throw new Error(
        'withTenantTransaction: transaksi di-ROLLBACK oleh PostgreSQL (bukan di-COMMIT) -- ' +
        'kemungkinan ada query yang gagal di dalam fn() dan errornya ditelan tanpa dilaporkan'
      );
    }
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Rolling back on an already-broken connection is expected to fail too;
      // the original `err` is what matters and must not be masked by this one.
    }
    throw err;
  } finally {
    client.removeListener('error', onClientError);
    client.release(clientError);
  }
}
