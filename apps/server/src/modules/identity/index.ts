import type { Pool, PoolClient } from '../../db.ts';
import { HttpError } from '../../http-error.ts';
import { createDeviceHandlers } from './handlers/devices.ts';

// Permukaan publik modul identity (apps/server/src/modules/README.md --
// kepemilikan tabel DITEGAKKAN). Modul catalog DILARANG query `"user"`
// langsung; `price_history.changed_by` menunjuk user(id) lintas modul --
// dan, tidak seperti FK lain di sistem ini, kolom itu bahkan TIDAK PUNYA FK
// sama sekali (db/migrations/0004_catalog.sql). Tanpa guard ini, id karangan
// apa pun akan masuk begitu saja ke kolom audit finansial.
//
// KENAPA `client` (bukan `pool`): SELECT ini harus tunduk RLS supaya "user
// ini ada" berarti "user ini ada DI TENANT PEMANGGIL", bukan di tenant mana
// pun. Sama seperti assertOutletVisible di modules/tenancy, dan sama seperti
// temuan F1 (CLAUDE.md) yang membuktikan FK PostgreSQL tidak tunduk RLS --
// di sini malah tidak ada FK sama sekali untuk jadi jaring pengaman kedua.
export async function assertUserVisible(client: PoolClient, userId: string): Promise<void> {
  const { rows } = await client.query('SELECT id FROM "user" WHERE id = $1 AND is_active = true', [userId]);
  if (rows.length === 0) {
    throw new HttpError(404, 'ACTOR_NOT_FOUND', `Aktor ${userId} tidak ditemukan atau tidak aktif.`);
  }
}

// T0c (PLAN-ordering-fondasi.md §T0c) -- guard BARU, sama alasan dengan
// assertOutletVisible/assertUserVisible di atas: modul cash BARU
// (cash_drawer_shift.device_id) menunjuk device(id) lintas modul (invariant
// #4, CLAUDE.md). FK PostgreSQL tidak tunduk RLS (temuan F1) -- device
// milik tenant lain hanya bisa ditolak lewat SELECT yang tunduk RLS di
// transaksi pemanggil, bukan lewat FK device_id REFERENCES device(id).
//
// `revoked_at IS NULL` disertakan -- sama seperti assertOutletVisible
// menyaring archived_at -- supaya shift baru tidak bisa dibuka atas nama
// device yang sudah dicabut. Tidak ada AC eksplisit yang menuntut ini,
// tapi membiarkan device tercabut membuka shift baru adalah cacat yang
// sama bentuknya dengan mengizinkan kategori terarsip jadi induk baru.
export async function assertDeviceVisible(client: PoolClient, deviceId: string): Promise<void> {
  const { rows } = await client.query('SELECT id FROM device WHERE id = $1 AND revoked_at IS NULL', [deviceId]);
  if (rows.length === 0) {
    throw new HttpError(404, 'DEVICE_NOT_FOUND', `Device ${deviceId} tidak ditemukan atau sudah dicabut.`);
  }
}

export function createIdentityHandlers(pool: Pool): Record<string, unknown> {
  return {
    ...createDeviceHandlers(pool),
  };
}
