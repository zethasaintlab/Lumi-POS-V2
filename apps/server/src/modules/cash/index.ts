import type { Pool } from '../../db.ts';
import { createShiftHandlers } from './handlers/shifts.ts';

// Modul cash lahir kecil dan disengaja demikian (keputusan Q1,
// PLAN-ordering-fondasi.md §8.0): hanya "buka shift". Tutup shift, hitung
// kas, selisih, cash_movement, no-sale tetap F3 -- lihat
// apps/server/src/modules/README.md untuk kepemilikan tabel modul ini
// (cash_drawer_shift, cash_movement).
export function createCashHandlers(pool: Pool): Record<string, unknown> {
  return {
    ...createShiftHandlers(pool),
  };
}
