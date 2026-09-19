import pg from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';

const { Pool } = pg;
export type { Pool, PoolClient } from 'pg';

const activeTransaction = new AsyncLocalStorage<true>();

/**
 * ⛔ SATU-SATUNYA tempat `new Pool()` dipanggil di repo ini, dan itu dijaga
 * `tests/runtime/pool-punya-penangan-error.test.js`. Pool yang dibuat di
 * tempat lain melewati penangan di bawah, dan ketiadaannya MEMATIKAN PROSES.
 */
export function createPool(): InstanceType<typeof Pool> {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
  });

  /* ⛔ TANPA baris ini, satu koneksi IDLE yang mati MEMBUNUH SELURUH SERVER.
   *
   * `pg-pool` memancarkan `'error'` pada POOL saat klien yang sedang menganggur
   * gagal (`pg-pool/index.js`, `idleListener`). `'error'` adalah nama peristiwa
   * istimewa di Node: `EventEmitter` yang tidak punya pendengar untuknya
   * MELEMPAR, dan lemparan dari dalam callback soket tidak dapat ditangkap
   * `try/catch` siapa pun. Prosesnya mati dengan `Unhandled 'error' event`.
   *
   * Terukur 12 September 2026: `npm run db:reset` dijalankan sementara server
   * hidup menjalankan `pg_terminate_backend` atas setiap koneksi ke database
   * itu — memang itu tugasnya — dan server mati seketika. Bukan restart, bukan
   * hang: proses hilang, dan `curl /health` menjawab 000.
   *
   * ⛔ INI BUKAN `try/catch` YANG MENELAN ERROR, dan bedanya ada di urutan
   * `pg-pool` sendiri:
   *
   *     pool._remove(client)      ← pemulihan SUDAH selesai di sini
   *     pool.emit('error', …)     ← baru kemudian ia memberi tahu
   *
   * Komentar `pg-pool` menyatakannya: *"once the pool emits an error the client
   * has already been closed & purged and is unusable"*. Jadi yang hilang bukan
   * penanganannya — pool sudah membuang klien matinya sendiri — melainkan
   * PENGAKUANNYA. Koneksi berikutnya dibuat baru oleh `pool.connect()`, dan
   * itulah kenapa tidak ada strategi reconnect yang perlu ditulis di sini.
   *
   * ⛔ Ia TIDAK melempar ulang dan TIDAK memanggil `process.exit`. Keduanya
   * mengembalikan persis cacat yang baris ini hapus.
   *
   * Yang memicunya di lapangan bukan hanya `db:reset`: PostgreSQL yang
   * di-restart, failover, proxy yang memutus koneksi menganggur, dan gangguan
   * jaringan sesaat semuanya berbentuk sama. Di produksi ia berarti seluruh
   * outlet kehilangan servernya karena satu koneksi menganggur — sementara
   * yang sebenarnya dibutuhkan hanya membuang koneksi itu.
   *
   * DICATAT, tidak didiamkan: koneksi menganggur yang mati adalah peristiwa
   * nyata, dan yang hilang tanpa jejak akan dicari di tempat yang salah.
   */
  pool.on('error', (err: Error) => {
    console.error(
      '[db] koneksi idle di pool gagal dan sudah dibuang pool; server tetap jalan:',
      err.message
    );
  });

  return pool;
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
