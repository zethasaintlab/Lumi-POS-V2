import type { FastifyRequest } from 'fastify';
import type { Pool } from '../../../db.ts';
import { withTenantTransaction } from '../../../db.ts';
import { getActorId, getTenantId } from '../../../tenant-context.ts';
import { assertUserVisible, assertBoleh } from '../../identity/index.ts';
import { assertOutletVisible } from '../../tenancy/index.ts';
import { assertRentang } from './rentang.ts';
import { ambilPeristiwaException, ringkasPerAktor } from './exceptions-data.ts';

/**
 * `GET /reports/exceptions/voids` — FR-G5 X1: void & refund per pelaku.
 *
 * ## ⛔ Ia menjawab pertanyaan yang B-18 sengaja tidak jawab
 *
 * `/reports/cashiers` melekatkan `voidAmount` pada kasir yang **penjualannya**
 * dibatalkan — supaya jumlah seluruh kasir sama dengan laporan global. Di sini
 * yang dilacak adalah **yang menekan tombol** (`audit_event.actor_user_id`).
 *
 * Keduanya benar untuk pertanyaan yang berbeda. Sejak keputusan 1 Agustus 2026
 * menghapus PIN manajer dari void, ini satu-satunya kontrol yang tersisa
 * terhadap penyalahgunaannya (`CLAUDE.md`).
 *
 * ## ⛔ `report_exception`, dan kasir TIDAK dapat membukanya
 *
 * AC `spec-g`: *"Kasir tidak dapat mengakses laporan exception"*. Matriks
 * `spec-f` memberi operasi itu kepada owner, area_manager, outlet_manager, dan
 * accountant — bukan cashier.
 *
 * ⛔ Ini SATU-SATUNYA endpoint laporan yang menuntut operasi RBAC eksplisit.
 * Keempat laporan lain hanya menuntut sesi yang sah, dan itu benar: omzet
 * outletnya sendiri bukan rahasia dari kasir. Daftar siapa-membatalkan-apa
 * adalah.
 *
 * ## ⛔ Tanpa bahasa menuduh
 *
 * Tidak ada field skor, tidak ada label. Ada test yang memindai nama field
 * keluaran; `spec-g` menyebut alasannya: *"produk yang menuduh karyawan
 * merchant akan merusak hubungan merchant dengan stafnya"*.
 */

export function createExceptionReportHandlers(pool: Pool): Record<string, unknown> {
  return {
    async getVoidExceptionReport(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const q = req.query as { from?: string; to?: string; outlet_id?: string };
      const { from, to, outletId } = assertRentang(q);

      return withTenantTransaction(pool, tenantId, async (client) => {
        await assertUserVisible(client, actorId);
        // ⛔ Penjaga yang tidak dimiliki laporan lain. Lihat catatan kepala.
        await assertBoleh(client, actorId, 'report_exception', 'melihat laporan exception');
        if (outletId !== null) await assertOutletVisible(client, outletId);

        const peristiwa = await ambilPeristiwaException(client, { from, to, outletId });
        return { from, to, outletId, perAktor: ringkasPerAktor(peristiwa), peristiwa };
      });
    },
  };
}
