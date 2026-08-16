import type { FastifyRequest } from 'fastify';
import type { Pool } from '../../db.ts';
import { withTenantTransaction } from '../../db.ts';
import { HttpError } from '../../http-error.ts';
import { getActorId, getTenantId } from '../../tenant-context.ts';
import { assertUserVisible } from '../identity/index.ts';
import { assertOutletVisible } from '../tenancy/index.ts';
import { assertRentang } from '../ordering/handlers/rentang.ts';
import { ambilDetail } from './handlers/detail-transaksi.ts';
import { ambilStok } from './handlers/stok.ts';
import { ambilDaftarShift, ambilDetailShift } from './handlers/shift.ts';
import { ambilOversell, ambilSelisihKas } from './handlers/perlu-diperiksa.ts';
import { ambilDasbor } from './handlers/dasbor.ts';

/**
 * Modul `reporting` — agregator baca-saja.
 *
 * `apps/server/src/modules/README.md` sudah menyediakan tempatnya sejak awal
 * ("`reporting` | — (baca lewat view yang disediakan modul lain)"), dan ia
 * kosong sampai sekarang. B-03 adalah kebutuhan pertama yang benar-benar
 * menuntutnya: satu struk **menurut definisi** menggabungkan empat modul.
 *
 * ⛔ Ia tidak memiliki satu tabel pun, dan tidak menulis apa pun. Kedua sifat
 * itulah yang membuat izin bacanya aman — bukan sekadar diberikan.
 *
 * Yang TIDAK dipindahkan ke sini: tujuh pelanggaran batas modul yang sudah ada
 * di `ordering` (endpoint laporan agregat). Memindahkannya adalah refactor
 * tersendiri dengan risikonya sendiri, dan menumpangkannya pada PR B-03 akan
 * membuat keduanya sulit ditinjau.
 */
export function createReportingHandlers(pool: Pool): Record<string, unknown> {
  return {
    async getTransactionDetail(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const { order_id: orderId } = req.params as { order_id: string };

      return withTenantTransaction(pool, tenantId, async (client) => {
        await assertUserVisible(client, actorId);

        const detail = await ambilDetail(client, orderId);
        if (detail === null) {
          // ⛔ Pesan yang SAMA untuk "tidak ada" dan "milik tenant lain".
          // Membedakannya memberi tahu penyerang bahwa id yang ia tebak
          // benar-benar ada di suatu tempat.
          throw new HttpError(404, 'NOT_FOUND', `Transaksi ${orderId} tidak ditemukan.`);
        }
        return detail;
      });
    },

    async getInventoryStocks(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const q = req.query as { outlet_id?: string; only_negative?: string; include_zero?: string };
      const outletId = q.outlet_id === undefined || q.outlet_id === '' ? null : q.outlet_id;

      return withTenantTransaction(pool, tenantId, async (client) => {
        await assertUserVisible(client, actorId);
        if (outletId !== null) await assertOutletVisible(client, outletId);

        const items = await ambilStok(client, {
          outletId,
          hanyaNegatif: q.only_negative === 'true',
          sertakanNol: q.include_zero === 'true',
        });
        return { outletId, items };
      });
    },

    async getShiftReport(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const q = req.query as { from?: string; to?: string; outlet_id?: string; include_open?: string };
      const { from, to, outletId } = assertRentang(q);

      return withTenantTransaction(pool, tenantId, async (client) => {
        await assertUserVisible(client, actorId);
        if (outletId !== null) await assertOutletVisible(client, outletId);
        const items = await ambilDaftarShift(client, {
          from,
          to,
          outletId,
          // ⛔ Bawaan: HANYA yang tertutup. Shift berjalan tidak punya angka
          // selisih, dan menampilkannya kosong di kolom uang membuat
          // manajer mengira hitungannya nol.
          hanyaTertutup: q.include_open !== 'true',
        });
        return { from, to, outletId, items };
      });
    },

    async getShiftDetail(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const { shift_id: shiftId } = req.params as { shift_id: string };

      return withTenantTransaction(pool, tenantId, async (client) => {
        await assertUserVisible(client, actorId);
        const detail = await ambilDetailShift(client, shiftId);
        if (detail === null) {
          throw new HttpError(404, 'NOT_FOUND', `Shift ${shiftId} tidak ditemukan.`);
        }
        return detail;
      });
    },

    async getInventoryOversells(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const q = req.query as {
        from?: string;
        to?: string;
        outlet_id?: string;
        include_resolved?: string;
      };
      const { from, to, outletId } = assertRentang(q);

      return withTenantTransaction(pool, tenantId, async (client) => {
        await assertUserVisible(client, actorId);
        if (outletId !== null) await assertOutletVisible(client, outletId);
        const filter = {
          from,
          to,
          outletId,
          sertakanSelesai: q.include_resolved === 'true',
        };
        // ⛔ Dua daftar dalam SATU respons. `IA:§3.3` menamai layarnya
        // "Perlu Diperiksa (oversell + selisih)"; mengirimnya terpisah
        // berarti layar harus menjahitnya sendiri, dan ringkasan
        // "berapa yang perlu diperiksa" jadi punya dua sumber.
        const [oversell, selisihKas] = await Promise.all([
          ambilOversell(client, filter),
          ambilSelisihKas(client, filter),
        ]);
        return { from, to, outletId, oversell, selisihKas };
      });
    },

    async getDashboardSummary(req: FastifyRequest) {
      const tenantId = getTenantId(req);
      const actorId = getActorId(req);
      const q = req.query as { from?: string; to?: string; outlet_id?: string };
      const { from, to, outletId } = assertRentang(q);

      return withTenantTransaction(pool, tenantId, async (client) => {
        await assertUserVisible(client, actorId);
        if (outletId !== null) await assertOutletVisible(client, outletId);
        return ambilDasbor(client, { from, to, outletId });
      });
    },
  };
}
