import type { Pool, PoolClient } from '../../db.ts';
import type { Hlc } from '../../../../../packages/domain/src/hlc.ts';
import { HttpError } from '../../http-error.ts';
import { createShiftHandlers } from './handlers/shifts.ts';
import { createTutupHandlers } from './handlers/tutup.ts';

// Modul cash lahir kecil dan disengaja demikian (keputusan Q1,
// PLAN-ordering-fondasi.md §8.0): hanya "buka shift". Tutup shift, hitung
// kas, selisih, cash_movement, no-sale tetap F3 -- lihat
// apps/server/src/modules/README.md untuk kepemilikan tabel modul ini
// (cash_drawer_shift, cash_movement).
//  masuk sejak tutup shift ada: penutupan menulis audit event, dan
// monotonisitas HLC dijaga LINTAS request oleh satu instance di buildApp.
export function createCashHandlers(pool: Pool, hlc: Hlc): Record<string, unknown> {
  return {
    ...createShiftHandlers(pool),
    ...createTutupHandlers(pool, hlc),
  };
}

// T7 (PLAN-ordering-fondasi.md) -- guard BARU, permukaan publik modul cash
// (apps/server/src/modules/README.md, invariant #4): `order.shift_id`
// (modul ordering) menunjuk cash_drawer_shift(id) lintas modul, jadi
// keberadaan/kepemilikan/status HARUS dibuktikan lewat SELECT yang tunduk
// RLS di sini, bukan lewat FK -- sama alasan dengan assertOutletVisible/
// assertUserVisible/assertDeviceVisible (FK PostgreSQL tidak tunduk RLS,
// temuan F1 CLAUDE.md).
//
// Tiga syarat sekaligus, ditegakkan sebagai satu guard (bukan tiga fungsi
// terpisah) karena ketiganya HARUS diperiksa dalam urutan yang sama demi
// pesan error yang bisa ditindaklanjuti klien: shift tidak ada sama sekali
// (404, kemungkinan salah id atau milik tenant lain -- RLS menyembunyikannya
// sebagai "tidak ada baris", bukan "ada tapi ditolak") berbeda dari shift
// ADA tapi sudah tidak open (409 -- kasir mencoba jual setelah tutup kas)
// berbeda lagi dari shift ADA dan open tapi milik DEVICE LAIN (409 -- dua
// kasir berbagi satu shift, yang v1 tidak izinkan; lihat FR-B2 "device_id
// wajib konsisten dengan shift_id").
export async function assertShiftOpen(client: PoolClient, shiftId: string, deviceId: string): Promise<void> {
  const { rows } = await client.query<{ status: string; device_id: string }>(
    'SELECT status, device_id FROM cash_drawer_shift WHERE id = $1',
    [shiftId]
  );
  if (rows.length === 0) {
    throw new HttpError(404, 'SHIFT_NOT_FOUND', `Shift ${shiftId} tidak ditemukan.`);
  }
  if (rows[0].status !== 'open') {
    throw new HttpError(409, 'SHIFT_NOT_OPEN', `Shift ${shiftId} tidak lagi berstatus open.`);
  }
  if (rows[0].device_id !== deviceId) {
    throw new HttpError(409, 'SHIFT_DEVICE_MISMATCH', `Shift ${shiftId} bukan milik device ${deviceId}.`);
  }
}
