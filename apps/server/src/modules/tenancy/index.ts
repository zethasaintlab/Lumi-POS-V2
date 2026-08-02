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
