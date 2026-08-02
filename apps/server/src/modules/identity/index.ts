import type { PoolClient } from '../../db.ts';
import { HttpError } from '../../http-error.ts';

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
