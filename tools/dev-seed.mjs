/**
 * Seed data dev — HANYA baris yang belum punya endpoint.
 *
 * Modul identity (F3) dan tenancy (F5) belum dibangun, jadi tidak ada
 * `POST /tenants`, `POST /outlets`, atau `POST /users`. Tanpa baris-baris itu
 * tidak ada `X-Tenant-Id` maupun `X-Actor-Id` yang sah, dan **seluruh** API
 * menolak setiap request. Skrip ini menutup celah itu supaya API bisa dicoba.
 *
 * Yang SENGAJA TIDAK di-seed di sini: device, shift, katalog, dan order.
 * Semuanya sudah punya endpoint, dan justru itulah yang ingin kamu coba
 * sendiri. Menyeed-nya lewat SQL akan melewati jalur yang sedang diuji.
 *
 * Jalankan:  node --env-file=.env tools/dev-seed.mjs
 *
 * Aman diulang: setiap run membuat tenant BARU dengan id baru. Ia tidak
 * pernah menghapus apa pun.
 */

import pg from 'pg';
import crypto from 'node:crypto';

const { Client } = pg;

// Sengaja memakai DATABASE_URL (role aplikasi yang tunduk RLS), BUKAN
// migration/admin URL. Kalau seed ini butuh privilese lebih tinggi daripada
// yang dipakai aplikasi, itu tanda ada yang salah dengan kebijakan RLS-nya --
// lebih baik ketahuan di sini daripada tersembunyi.
const client = new Client({ connectionString: process.env.DATABASE_URL });

const id = () => crypto.randomUUID();

async function insert(table, row) {
  const cols = Object.keys(row);
  const vals = cols.map((c) => row[c]);
  const params = cols.map((_, i) => `$${i + 1}`).join(', ');
  const quoted = cols.map((c) => `"${c}"`).join(', ');
  const { rows } = await client.query(
    `INSERT INTO "${table}" (${quoted}) VALUES (${params}) RETURNING *`,
    vals
  );
  return rows[0];
}

async function main() {
  await client.connect();

  const tenantId = id();
  const outletId = id();
  const profileId = id();
  const cashierId = id();
  const managerId = id();
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');

  // `tenant` adalah satu-satunya tabel yang RLS-exempt — ia harus bisa
  // ditulis sebelum app.tenant_id punya nilai, kalau tidak tidak akan pernah
  // ada tenant pertama.
  await insert('tenant', {
    id: tenantId,
    name: `Kafe Dev ${stamp}`,
    plan: 'standard',
    status: 'active',
    deployment_mode: 'cloud',
    max_outlets: 5,
    max_devices: 5,
    max_users: 10,
    max_products: 100,
    features: {},
  });

  // Sisanya tunduk RLS, jadi harus di dalam transaksi ber-app.tenant_id --
  // pola yang sama dengan yang dipakai aplikasi (SET LOCAL per transaksi,
  // invariant #8).
  await client.query('BEGIN');
  await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);

  await insert('vertical_profile', {
    id: profileId,
    tenant_id: tenantId,
    name: 'fnb',
    modules_enabled: [],
    default_channel: 'takeaway',
    allow_negative_stock: true,
    requires_barcode_flow: false,
    default_tax_type: 'pbjt',
    is_tenant_default: true,
  });

  await insert('outlet', {
    id: outletId,
    tenant_id: tenantId,
    name: 'Outlet Pusat',
    address: 'Jl. Contoh No. 1',
    timezone: 'Asia/Jakarta',
    business_day_ends_at: '04:00',
    rounding_increment: 100,
    rounding_mode: 'half_up',
    service_charge_rate: 0,
    vertical_profile_id: profileId,
  });

  await insert('role', { id: id(), tenant_id: tenantId, code: 'cashier', name: 'Kasir' });

  await insert('user', {
    id: cashierId,
    tenant_id: tenantId,
    name: 'Sari (kasir)',
    pin_hash: 'dev-placeholder',
    is_active: true,
  });

  await insert('user', {
    id: managerId,
    tenant_id: tenantId,
    name: 'Budi (manajer)',
    pin_hash: 'dev-placeholder',
    is_active: true,
  });

  await client.query('COMMIT');
  await client.end();

  const businessDate = new Date().toISOString().slice(0, 10);

  console.log(`
Seed selesai. Tenant baru dibuat; data lama tidak disentuh.

  X-Tenant-Id : ${tenantId}
  X-Actor-Id  : ${cashierId}    (Sari, kasir)
  manajer     : ${managerId}    (Budi — belum dipakai, untuk otorisasi nanti)
  outletId    : ${outletId}
  businessDate: ${businessDate}

Tempel blok di bawah ke DevTools Console pada tab http://localhost:3000/health
(harus origin yang sama — server belum memasang CORS):

const T = ${JSON.stringify(tenantId)};
const A = ${JSON.stringify(cashierId)};
const OUTLET = ${JSON.stringify(outletId)};
const H = { 'content-type': 'application/json', 'x-tenant-id': T, 'x-actor-id': A };
const uid = () => crypto.randomUUID();
const api = async (m, p, b) => {
  const r = await fetch(p, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined });
  const t = await r.text();
  console.log(m, p, '->', r.status, t.slice(0, 400));
  return t ? JSON.parse(t) : null;
};
`);
}

main().catch(async (err) => {
  console.error('seed gagal:', err.message);
  try { await client.query('ROLLBACK'); } catch {}
  try { await client.end(); } catch {}
  process.exit(1);
});
