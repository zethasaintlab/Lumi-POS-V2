import type { PoolClient } from '../../db.ts';
import { HttpError } from '../../http-error.ts';

// Permukaan publik modul tenancy (apps/server/src/modules/README.md --
// kepemilikan tabel DITEGAKKAN). Modul catalog DILARANG query `outlet`
// langsung; `price_history.outlet_id` mereferensi outlet(id) lintas modul,
// jadi validasi keberadaannya harus lewat sini.
//
// KENAPA ini perlu, bukan sekadar hiasan: FK PostgreSQL (price_history.
// outlet_id REFERENCES outlet(id)) TIDAK tunduk RLS -- referential integrity
// check Postgres berjalan dengan hak pemilik tabel yang direferensikan,
// bukan peran yang dibatasi RLS. Temuan F1 (CLAUDE.md) membuktikan ini
// empiris untuk item.category_id: createItem sempat menerima categoryId
// tenant lain dan mengembalikan 201. FK hanya membuktikan baris outlet itu
// ada di SUATU tenant, bukan tenant pemanggil.
//
// `client` WAJIB berasal dari transaksi pemanggil yang sudah men-SET LOCAL
// app.tenant_id (withTenantTransaction) -- SELECT ini baru tunduk RLS kalau
// dijalankan lewat client itu, bukan lewat `pool` mentah.
export async function assertOutletVisible(client: PoolClient, outletId: string): Promise<void> {
  const { rows } = await client.query('SELECT id FROM outlet WHERE id = $1 AND archived_at IS NULL', [outletId]);
  if (rows.length === 0) {
    throw new HttpError(404, 'OUTLET_NOT_FOUND', `Outlet ${outletId} tidak ditemukan.`);
  }
}

export interface OutletSettings {
  roundingIncrement: bigint;
  serviceChargeRate: number;
}

// T3 (PLAN-ordering-fondasi.md) -- dipakai modul ordering di jalur createOrder
// SEBAGAI PENGGANTI assertOutletVisible: ordering butuh rounding_increment
// (packages/domain/src/money.ts:computeOrderTotals) di transaksi yang sama
// tempat ia sudah harus membuktikan outlet ada dan milik tenant pemanggil --
// jadi satu SELECT yang tunduk RLS ini menjawab keduanya sekaligus, alih-alih
// assertOutletVisible lalu SELECT kedua untuk kolomnya.
//
// `rounding_increment` bertipe `int` di skema (db/migrations/0002_tenancy.sql)
// -- pg mengembalikannya sebagai JS number, aman di-BigInt() langsung.
// `service_charge_rate` bertipe `numeric(6,4)` -- pg mengembalikannya sebagai
// string (presisi penuh), jadi Number() di sini, BUKAN karena diabaikan:
// sub-project ini menulis service_charge_amount = 0 di order (§3.6 PLAN),
// nilainya belum dipakai tapi bentuknya sudah benar untuk B-2.
export async function getOutletSettings(client: PoolClient, outletId: string): Promise<OutletSettings> {
  const { rows } = await client.query<{ rounding_increment: number; service_charge_rate: string }>(
    'SELECT rounding_increment, service_charge_rate FROM outlet WHERE id = $1 AND archived_at IS NULL',
    [outletId]
  );
  if (rows.length === 0) {
    throw new HttpError(404, 'OUTLET_NOT_FOUND', `Outlet ${outletId} tidak ditemukan.`);
  }
  return {
    roundingIncrement: BigInt(rows[0].rounding_increment),
    serviceChargeRate: Number(rows[0].service_charge_rate),
  };
}
